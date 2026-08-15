import { createHash } from 'node:crypto';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface GeocodeRequest {
  addressText: string;
  landmark?: string | null;
  cityId: number;
}

/**
 * Turning human address text into coordinates.
 *
 * Behind an interface from day one so the real provider (Ola Maps) can be
 * dropped in later without touching a single caller. Nothing in the codebase
 * may depend on which implementation is wired in.
 */
export interface GeoService {
  readonly name: string;
  geocode(request: GeocodeRequest): Promise<GeoPoint>;
}

/**
 * Rough bounding box for Jabalpur. Used by the stub so fake coordinates land
 * somewhere plausible rather than in the Bay of Bengal, and by validation to
 * catch obviously wrong client-supplied points.
 */
export const JABALPUR_BOUNDS = {
  minLat: 23.09,
  maxLat: 23.26,
  minLng: 79.83,
  maxLng: 80.03,
} as const;

export const JABALPUR_CENTRE: GeoPoint = { lat: 23.1815, lng: 79.9864 };

/** Coordinates that are at least on Earth. Per-city sanity lives above this. */
export function isValidLatLng(point: GeoPoint): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lng >= -180 &&
    point.lng <= 180
  );
}

/** Reads `bytes` bytes of the digest at `offset` as a fraction in [0, 1). */
function fractionAt(digest: Buffer, offset: number): number {
  return digest.readUInt32BE(offset) / 0x1_0000_0000;
}

function round6(value: number): number {
  // ~11 cm of precision; more digits would be false confidence from a hash.
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Deterministic fake geocoder: the same text always yields the same point, and
 * every point lands inside the city bounds.
 *
 * Deterministic on purpose — tests can assert exact coordinates, and a developer
 * re-running the seed gets the same map every time. It is emphatically not a
 * real geocoder: nothing here understands streets.
 */
export function createStubGeoService(): GeoService {
  return {
    name: 'stub',

    async geocode({ addressText, landmark }) {
      const seed = `${addressText.trim().toLowerCase()}|${(landmark ?? '').trim().toLowerCase()}`;
      const digest = createHash('sha256').update(seed).digest();

      const { minLat, maxLat, minLng, maxLng } = JABALPUR_BOUNDS;

      return {
        lat: round6(minLat + fractionAt(digest, 0) * (maxLat - minLat)),
        lng: round6(minLng + fractionAt(digest, 4) * (maxLng - minLng)),
      };
    },
  };
}

/**
 * Great-circle distance in metres. Only used for assertions and seed sanity —
 * real proximity queries are PostGIS `ST_DWithin`, which accounts for the
 * spheroid properly.
 */
export function haversineMetres(a: GeoPoint, b: GeoPoint): number {
  const EARTH_RADIUS_M = 6_371_008.8;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
