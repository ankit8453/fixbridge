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
  /**
   * It answers the city centre for everything, and that is the point.
   *
   * The version before it hashed the address text into a distinct point inside
   * Jabalpur — deterministic, well spread, six decimal places, and a lie. The
   * coordinate was indistinguishable from a GPS fix and pointed at a street the
   * customer had never heard of, and the partner app navigated to it.
   *
   * These tests pin the honest behaviour, so a future "improvement" that makes
   * the guesses look more realistic has to delete an assertion that says why
   * not to.
   */
  it('answers the city centre, whatever the address says', async () => {
    for (const address of ['212 Shastri Nagar', 'Vijay Nagar', '113 Surtalai']) {
      expect(await geo.geocode(request(address))).toEqual(JABALPUR_CENTRE);
    }
  });

  it('gives two different addresses the *same* point', async () => {
    // Precisely what the old one avoided. Distinct points implied knowledge
    // that does not exist; one shared point is visibly a fallback.
    const first = await geo.geocode(request('212 Shastri Nagar'));
    const second = await geo.geocode(request('Somewhere else entirely'));

    expect(first).toEqual(second);
  });

  it('ignores the landmark, rather than folding it into a fake seed', async () => {
    const withLandmark = await geo.geocode(request('212 Shastri Nagar', 'near Gupta Kirana'));
    const without = await geo.geocode(request('212 Shastri Nagar'));

    expect(withLandmark).toEqual(without);
  });

  it('lands inside Jabalpur, so distances stay sane', async () => {
    // Search measures from whatever this returns. A fallback outside the city
    // would put every unpinned customer kilometres from every technician.
    expect(inBounds(await geo.geocode(request('anything at all')))).toBe(true);
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
