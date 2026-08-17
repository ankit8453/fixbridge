/**
 * Browser geolocation, promisified. This is the *only* source of coordinates
 * in this v1 — there is no map picker and no geocode-as-you-type. The address
 * form says so explicitly rather than implying a pin was placed on a map.
 * Ported verbatim from `legacy-next-src/components/customer/data/geo.ts`.
 */
export interface GeoCoords {
  lat: number;
  lng: number;
}

export type GeoErrorReason = 'unsupported' | 'denied' | 'unavailable' | 'timeout';

export class GeoError extends Error {
  readonly reason: GeoErrorReason;
  constructor(reason: GeoErrorReason) {
    super(reason);
    this.reason = reason;
  }
}

export function getCurrentLocation(): Promise<GeoCoords> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new GeoError('unsupported'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({ lat: position.coords.latitude, lng: position.coords.longitude });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) reject(new GeoError('denied'));
        else if (error.code === error.TIMEOUT) reject(new GeoError('timeout'));
        else reject(new GeoError('unavailable'));
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}
