
export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface GeocodeRequest {
  addressText: string;
  landmark?: string | null;
  cityId: number;
}

/** One candidate from a search box. */
export interface PlaceSuggestion {
  /** What to show in the list — "Vijay Nagar, Jabalpur, Madhya Pradesh". */
  label: string;
  point: GeoPoint;
}

/**
 * Everything the address picker needs, behind one interface.
 *
 * Three operations, and each has exactly one caller shape:
 *
 *   - `search` backs the search box on the map. It answers *candidates*, not a
 *     point, because the customer picks — this is the one place where guessing
 *     is honest, since a person confirms the guess.
 *   - `reverse` names a point the customer has already chosen, so the header
 *     can say "Surtalai" instead of "Current location".
 *   - `geocode` is the fallback for an address saved with no pin at all. It is
 *     the only one that answers without a human in the loop, which is why the
 *     stub deliberately gives a useless answer rather than a plausible one.
 *
 * Behind an interface so the provider can change without touching a caller.
 * Nothing in the codebase may depend on which implementation is wired in.
 */
export interface GeoService {
  readonly name: string;
  geocode(request: GeocodeRequest): Promise<GeoPoint>;
  /** Candidates for a typed query. Empty when nothing matches — not an error. */
  search(query: string, cityId: number): Promise<PlaceSuggestion[]>;
  /** A human name for a point, or null when the provider has none. */
  reverse(point: GeoPoint): Promise<string | null>;
}

/** Whether a point is inside the one city this product actually serves. */
export function isInsideJabalpur(point: GeoPoint): boolean {
  return (
    point.lat >= JABALPUR_BOUNDS.minLat &&
    point.lat <= JABALPUR_BOUNDS.maxLat &&
    point.lng >= JABALPUR_BOUNDS.minLng &&
    point.lng <= JABALPUR_BOUNDS.maxLng
  );
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

/**
 * Deterministic fake geocoder: the same text always yields the same point, and
 * every point lands inside the city bounds.
 *
 * Deterministic on purpose — tests can assert exact coordinates, and a developer
 * re-running the seed gets the same map every time. It is emphatically not a
 * real geocoder: nothing here understands streets.
 */
/**
 * Geocoding, until there is real geocoding.
 *
 * It answers the **city centre**, and says so. That is deliberately a worse
 * answer than it could easily give, and the reason is worth stating.
 *
 * The previous version hashed the address text into a point inside Jabalpur's
 * bounding box, so every address got a distinct, six-decimal-place coordinate.
 * It was tidy, deterministic and testable, and it was a lie: the number looked
 * exactly like a GPS fix and pointed at a street the customer had never heard
 * of. Nothing downstream could tell the two apart, so a technician was handed
 * that pin and drove to it.
 *
 * A city centre cannot be mistaken for a doorstep. Search still works — every
 * unpinned customer is measured from the same known point rather than from
 * somewhere invented — and the `isPinned` flag stored beside it tells every
 * consumer to search the address text instead of navigating.
 *
 * Replace this with Ola Maps and the flag stops mattering. Until then, being
 * uselessly honest beats being convincingly wrong.
 */
export function createStubGeoService(): GeoService {
  return {
    // Named so nothing mistakes it for real geocoding, in a log or a test.
    name: 'stub',

    async geocode() {
      return { ...JABALPUR_CENTRE };
    },

    // No results rather than invented ones. An empty search box says "type an
    // address instead"; a fabricated suggestion says "this place exists".
    async search() {
      return [];
    },

    async reverse() {
      return null;
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
