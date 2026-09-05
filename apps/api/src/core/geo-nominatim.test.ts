import { describe, expect, it, vi } from 'vitest';
import type Redis from 'ioredis';
import { createNominatimGeoService } from './geo-nominatim';
import { JABALPUR_BOUNDS } from './geo';
import type { AppLogger } from './logger';

/**
 * The things that get an application banned, and the things that quietly
 * ruin an address.
 *
 * Nominatim's limit is one request per second for the **whole app**, enforced
 * by them, with a manual unban. So the queue is not a nicety — it is the only
 * thing standing between us and a dead geocoder on a Saturday.
 */

function fakeLogger(): AppLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as AppLogger;
}

/** A Redis that always misses, so the network path is what gets tested. */
function missingRedis(): Redis {
  return { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') } as unknown as Redis;
}

function options(fetchImpl: typeof fetch, redis: Redis = missingRedis()) {
  return {
    baseUrl: 'https://nominatim.test',
    userAgent: 'FixBridge/0.1 (raj@example.com)',
    redis,
    logger: fakeLogger(),
    cacheTtlSeconds: 60,
    timeoutMs: 5_000,
    fetchImpl,
    // The policy interval is 1.1s; the queue behaviour is identical at 5ms and
    // the suite stays runnable. The 'never two at once' test still proves it.
    minIntervalMs: 5,
  };
}

const place = (lat: string, lon: string, name: string) => ({
  lat,
  lon,
  display_name: name,
  address: { suburb: 'Surtalai', city: 'Jabalpur' },
});

function jsonFetch(body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
}

describe('createNominatimGeoService', () => {
  it('refuses to start without a contact in the user agent', () => {
    // Their policy asks for one. Without it we are an anonymous scraper, and
    // the first they will tell us is a block that takes a human to lift.
    expect(() =>
      createNominatimGeoService({ ...options(jsonFetch([])), userAgent: 'FixBridge' }),
    ).toThrow(/contact email/);
  });

  it('sends the user agent on every request', async () => {
    const impl = jsonFetch([]);
    await createNominatimGeoService(options(impl)).search('Vijay Nagar', 1);

    const [, init] = vi.mocked(impl).mock.calls[0]!;
    expect((init?.headers as Record<string, string>)['User-Agent']).toContain('@');
  });

  it('never issues two requests at once', async () => {
    // The limit is not "one per second on average", it is "never two at once".
    let inFlight = 0;
    let overlapped = false;

    const impl = vi.fn(async () => {
      inFlight += 1;
      if (inFlight > 1) overlapped = true;
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return new Response('[]', { status: 200 });
    }) as unknown as typeof fetch;

    const geo = createNominatimGeoService(options(impl));
    await Promise.all([geo.search('one', 1), geo.search('two', 1), geo.search('three', 1)]);

    expect(overlapped).toBe(false);
  });

  it('keeps serving after a request fails', async () => {
    // A rejected promise must not break the queue, or one bad lookup stops
    // every later one for the life of the process.
    let call = 0;
    const impl = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new Error('network');
      return new Response(JSON.stringify([place('23.18', '79.98', 'Surtalai, Jabalpur')]), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const geo = createNominatimGeoService(options(impl));

    expect(await geo.search('first', 1)).toEqual([]);
    expect(await geo.search('second', 1)).toHaveLength(1);
  });

  it('bounds the search to Jabalpur', async () => {
    // Without this, "Vijay Nagar" offers the one in Indore — an address nobody
    // can be sent to, saved as if they could.
    const impl = jsonFetch([]);
    await createNominatimGeoService(options(impl)).search('Vijay Nagar', 1);

    const url = new URL(String(vi.mocked(impl).mock.calls[0]![0]));
    expect(url.searchParams.get('bounded')).toBe('1');
    expect(url.searchParams.get('countrycodes')).toBe('in');
    expect(url.searchParams.get('viewbox')).toContain(String(JABALPUR_BOUNDS.minLng));
  });

  it('does not spend a request on a query too short to identify anything', async () => {
    const impl = jsonFetch([]);
    const geo = createNominatimGeoService(options(impl));

    expect(await geo.search('vi', 1)).toEqual([]);
    expect(impl).not.toHaveBeenCalled();
  });

  it('answers an empty list rather than throwing when the provider fails', async () => {
    // A search box that says "something went wrong" stops somebody mid-address.
    // One that shows nothing leaves them dragging the pin, which still works.
    const impl = vi.fn(async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;

    await expect(createNominatimGeoService(options(impl)).search('anything', 1)).resolves.toEqual(
      [],
    );
  });

  it('names a point by its neighbourhood, not its house number', async () => {
    const geo = createNominatimGeoService(
      options(jsonFetch(place('23.18', '79.98', 'ignored'))),
    );

    expect(await geo.reverse({ lat: 23.18, lng: 79.98 })).toBe('Surtalai');
  });

  it('serves a repeat lookup from the cache without a request', async () => {
    const store = new Map<string, string>();
    const redis = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
    } as unknown as Redis;

    const impl = jsonFetch([place('23.18', '79.98', 'Surtalai, Jabalpur')]);
    const geo = createNominatimGeoService(options(impl, redis));

    await geo.search('Surtalai', 1);
    await geo.search('Surtalai', 1);

    // Addresses repeat far more than they vary, and every hit is one request
    // further from a limit we do not control.
    expect(vi.mocked(impl)).toHaveBeenCalledTimes(1);
  });

  it('throws rather than inventing a point when nothing matches', async () => {
    // The one path with no human in the loop. Returning something plausible
    // here is exactly the bug the whole rewrite existed to remove.
    await expect(
      createNominatimGeoService(options(jsonFetch([]))).geocode({
        addressText: 'nowhere at all',
        landmark: null,
        cityId: 1,
      }),
    ).rejects.toThrow(/found nothing/);
  });
});
