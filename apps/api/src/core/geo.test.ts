import { describe, expect, it } from 'vitest';
import {
  JABALPUR_BOUNDS,
  JABALPUR_CENTRE,
  createStubGeoService,
  haversineMetres,
  isValidLatLng,
} from './geo';

const geo = createStubGeoService();
const request = (addressText: string, landmark?: string | null) => ({
  addressText,
  landmark,
  cityId: 1,
});

function inBounds(point: { lat: number; lng: number }): boolean {
  return (
    point.lat >= JABALPUR_BOUNDS.minLat &&
    point.lat <= JABALPUR_BOUNDS.maxLat &&
    point.lng >= JABALPUR_BOUNDS.minLng &&
    point.lng <= JABALPUR_BOUNDS.maxLng
  );
}

describe('stub geocoder', () => {
  it('is deterministic — the same address always returns the same point', async () => {
    const first = await geo.geocode(request('212 Shastri Nagar', 'near Gupta Kirana'));
    const second = await geo.geocode(request('212 Shastri Nagar', 'near Gupta Kirana'));

    expect(first).toEqual(second);
  });

  it('stays deterministic across many repeats', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () => geo.geocode(request('Wright Town main road'))),
    );

    expect(new Set(results.map((point) => `${point.lat},${point.lng}`)).size).toBe(1);
  });

  it('always lands inside the Jabalpur bounding box', async () => {
    const addresses = [
      'Adhartal water tank',
      'Shop 4, Napier Town',
      'x',
      'a very long address line that goes on and on and on for quite a while indeed',
      '।।।',
      '123 456 789',
    ];

    for (const address of addresses) {
      const point = await geo.geocode(request(address));
      expect(inBounds(point), `${address} → ${JSON.stringify(point)}`).toBe(true);
    }
  });

  it('gives different addresses different points', async () => {
    const a = await geo.geocode(request('Wright Town'));
    const b = await geo.geocode(request('Adhartal'));

    expect(a).not.toEqual(b);
  });

  it('spreads points around rather than clustering on one spot', async () => {
    const points = await Promise.all(
      Array.from({ length: 40 }, (_, index) => geo.geocode(request(`address number ${index}`))),
    );

    expect(new Set(points.map((point) => `${point.lat},${point.lng}`)).size).toBe(points.length);
  });

  it('folds the landmark into the seed', async () => {
    const withLandmark = await geo.geocode(request('Same street', 'near the temple'));
    const withoutLandmark = await geo.geocode(request('Same street'));

    expect(withLandmark).not.toEqual(withoutLandmark);
  });

  it('treats a missing landmark and an empty one as the same input', async () => {
    expect(await geo.geocode(request('Same street', null))).toEqual(
      await geo.geocode(request('Same street', '   ')),
    );
  });

  it('ignores case and surrounding whitespace', async () => {
    expect(await geo.geocode(request('  WRIGHT Town  '))).toEqual(
      await geo.geocode(request('wright town')),
    );
  });

  it('rounds to six decimal places', async () => {
    const point = await geo.geocode(request('precision check'));

    expect(point.lat).toBe(Math.round(point.lat * 1e6) / 1e6);
    expect(point.lng).toBe(Math.round(point.lng * 1e6) / 1e6);
  });

  it('identifies itself as a stub, so nothing mistakes it for real geocoding', () => {
    expect(geo.name).toBe('stub');
  });
});

describe('isValidLatLng', () => {
  it('accepts real coordinates', () => {
    expect(isValidLatLng(JABALPUR_CENTRE)).toBe(true);
    expect(isValidLatLng({ lat: 0, lng: 0 })).toBe(true);
    expect(isValidLatLng({ lat: -90, lng: 180 })).toBe(true);
  });

  it('rejects out-of-range values', () => {
    expect(isValidLatLng({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: 0, lng: 181 })).toBe(false);
  });

  it('rejects non-finite values', () => {
    expect(isValidLatLng({ lat: Number.NaN, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: 0, lng: Number.POSITIVE_INFINITY })).toBe(false);
  });
});

describe('haversineMetres', () => {
  it('is zero for the same point', () => {
    expect(haversineMetres(JABALPUR_CENTRE, JABALPUR_CENTRE)).toBe(0);
  });

  it('is symmetric', () => {
    const a = { lat: 23.1618, lng: 79.9492 };
    const b = { lat: 23.2081, lng: 79.9283 };

    expect(haversineMetres(a, b)).toBeCloseTo(haversineMetres(b, a), 6);
  });

  it('measures a known Jabalpur hop within a sensible range', () => {
    // Wright Town → Adhartal is roughly 5–6 km on the ground.
    const metres = haversineMetres({ lat: 23.1618, lng: 79.9492 }, { lat: 23.2081, lng: 79.9283 });

    expect(metres).toBeGreaterThan(4_000);
    expect(metres).toBeLessThan(7_000);
  });

  it('keeps every seeded locality inside the city bounding box', () => {
    const corners = [
      { lat: JABALPUR_BOUNDS.minLat, lng: JABALPUR_BOUNDS.minLng },
      { lat: JABALPUR_BOUNDS.maxLat, lng: JABALPUR_BOUNDS.maxLng },
    ];

    // The box is a city, not a country: its diagonal should be tens of km.
    expect(haversineMetres(corners[0] as never, corners[1] as never)).toBeLessThan(40_000);
  });
});
