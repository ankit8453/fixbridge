import type Redis from 'ioredis';
import {
  JABALPUR_BOUNDS,
  type GeoPoint,
  type GeoService,
  type PlaceSuggestion,
} from './geo';
import type { AppLogger } from './logger';

/**
 * Geocoding through Nominatim, OpenStreetMap's own service.
 *
 * Free, no key, no billing account — which is the whole reason it is here.
 * The cost is paid in other currencies:
 *
 *   - **One request per second, globally.** Not per user: their policy counts
 *     the whole application. Exceeded, they block the IP, and the block is
 *     manual to lift. So every call goes through a queue below, and nothing
 *     may call Nominatim except this file.
 *   - **A real User-Agent is mandatory.** An anonymous request is refused.
 *     `GEO_USER_AGENT` carries the app name and a contact address, which is
 *     what their policy asks for and what stops us being blocked silently.
 *   - **Indian address coverage is thinner than Google's.** A locality like
 *     "Vijay Nagar" is mapped; "Gupta Kirana Store" very likely is not. That
 *     is survivable only because search is a convenience here and the pin is
 *     the mechanism — a customer who finds nothing can still drag the map.
 *
 * Everything is cached in Redis. Addresses repeat far more than they vary, and
 * a cache hit is both faster and one request further from the rate limit.
 */

export interface NominatimOptions {
  baseUrl: string;
  /** Must identify the app and carry a contact. Nominatim refuses without it. */
  userAgent: string;
  redis: Redis;
  logger: AppLogger;
  cacheTtlSeconds: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  /**
   * Gap between outbound calls. Defaults to just over a second, which is the
   * policy. Overridden only by tests — a suite that actually waits a second
   * per assertion stops being run.
   */
  minIntervalMs?: number;
}

/** Nominatim's own shape, narrowed to what is used. */
interface NominatimPlace {
  lat?: string;
  lon?: string;
  display_name?: string;
  name?: string;
  address?: Record<string, string>;
}

/**
 * Serialises every outbound call, one per second.
 *
 * A token bucket would be more elegant and would be wrong: the limit is not
 * "on average one per second", it is "never two at once". A promise chain with
 * a delay is the smallest thing that actually guarantees that, and the queue
 * depth is bounded by how many people are typing in a search box in Jabalpur.
 */
function createRateLimiter(minIntervalMs: number): <T>(work: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();

  return <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(async () => {
      const value = await work();
      await new Promise((resolve) => setTimeout(resolve, minIntervalMs));
      return value;
    });

    // The chain must not break on a failure, or one bad request stops every
    // later one. Errors still reach the caller through `result`.
    tail = result.catch(() => undefined);
    return result;
  };
}

export function createNominatimGeoService(options: NominatimOptions): GeoService {
  const { baseUrl, userAgent, redis, logger, cacheTtlSeconds, timeoutMs } = options;
  const doFetch = options.fetchImpl ?? fetch;
  const limited = createRateLimiter(options.minIntervalMs ?? 1_100);

  if (!userAgent || !userAgent.includes('@')) {
    // Their policy asks for a contact address. Without one we are an anonymous
    // scraper, and the first they will tell us is a block.
    throw new Error('GEO_USER_AGENT must name the app and include a contact email address');
  }

  async function cached<T>(key: string, produce: () => Promise<T>): Promise<T> {
    try {
      const hit = await redis.get(key);
      if (hit !== null) return JSON.parse(hit) as T;
    } catch {
      // A cache that is down is not a reason to stop geocoding.
    }

    const value = await produce();

    try {
      await redis.set(key, JSON.stringify(value), 'EX', cacheTtlSeconds);
    } catch {
      // Same.
    }

    return value;
  }

  /** One call, rate limited, with the headers their policy requires. */
  async function call(pathAndQuery: string): Promise<unknown> {
    return limited(async () => {
      const response = await doFetch(`${baseUrl.replace(/\/+$/, '')}${pathAndQuery}`, {
        headers: {
          'User-Agent': userAgent,
          'Accept-Language': 'en-IN,en',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`nominatim ${response.status}`);
      }

      return response.json();
    });
  }

  function toPoint(place: NominatimPlace): GeoPoint | null {
    const lat = Number(place.lat);
    const lng = Number(place.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  return {
    name: 'nominatim',

    /**
     * Candidates for the search box.
     *
     * Bounded to Jabalpur and `bounded=1`, so a search for "Vijay Nagar" cannot
     * offer the Vijay Nagar in Indore. The product serves one city; suggesting
     * a place in another one only produces an address nobody can be sent to.
     */
    async search(query, cityId) {
      const trimmed = query.trim();
      if (trimmed.length < 3) return [];

      return cached(`geo:search:${cityId}:${trimmed.toLowerCase()}`, async () => {
        const params = new URLSearchParams({
          q: trimmed,
          format: 'jsonv2',
          addressdetails: '1',
          limit: '6',
          countrycodes: 'in',
          bounded: '1',
          viewbox: [
            JABALPUR_BOUNDS.minLng,
            JABALPUR_BOUNDS.maxLat,
            JABALPUR_BOUNDS.maxLng,
            JABALPUR_BOUNDS.minLat,
          ].join(','),
        });

        try {
          const places = (await call(`/search?${params.toString()}`)) as NominatimPlace[];

          return places.flatMap((place): PlaceSuggestion[] => {
            const point = toPoint(place);
            if (!point || !place.display_name) return [];
            return [{ label: place.display_name, point }];
          });
        } catch (cause) {
          // An empty list, not an error. A search box that shows "something
          // went wrong" stops somebody mid-address; one that shows nothing
          // leaves them dragging the map, which still works.
          logger.warn({ cause: String(cause) }, 'nominatim search failed');
          return [];
        }
      });
    },

    /**
     * Names a point the customer has already chosen.
     *
     * Most specific first — the neighbourhood is what somebody in Jabalpur
     * would actually say, and the city is right for anybody just outside it.
     * House numbers and roads are skipped: a header reading "113" helps nobody.
     */
    async reverse(point) {
      const key = `geo:reverse:${point.lat.toFixed(4)}:${point.lng.toFixed(4)}`;

      return cached(key, async () => {
        const params = new URLSearchParams({
          lat: String(point.lat),
          lon: String(point.lng),
          format: 'jsonv2',
          zoom: '16',
          addressdetails: '1',
        });

        try {
          const place = (await call(`/reverse?${params.toString()}`)) as NominatimPlace;
          const address = place.address ?? {};

          return (
            address.suburb ??
            address.neighbourhood ??
            address.village ??
            address.town ??
            address.city ??
            address.county ??
            null
          );
        } catch (cause) {
          logger.warn({ cause: String(cause) }, 'nominatim reverse failed');
          return null;
        }
      });
    },

    /**
     * The no-human-in-the-loop path: an address saved with no pin at all.
     *
     * Takes the first candidate, and only inside Jabalpur. If nothing matches,
     * it throws rather than inventing — the caller decides what an unlocatable
     * address means, and for the address form that is "ask them to drop a pin".
     */
    async geocode({ addressText, landmark, cityId }) {
      const query = [addressText, landmark].filter(Boolean).join(', ');
      const [first] = await this.search(query, cityId);

      if (!first) {
        throw new Error(`nominatim found nothing for ${JSON.stringify(query.slice(0, 80))}`);
      }

      return first.point;
    },
  };
}
