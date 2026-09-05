/**
 * Browser geolocation, and the two lookups the map picker needs.
 *
 * The browser fix is only ever a *starting point* now — it opens the map where
 * the person is standing, and the coordinates that get saved are the ones they
 * confirmed on it. Before the picker this was the only source of coordinates,
 * and skipping it left the server guessing from the address text.
 *
 * Search and naming go through our own API rather than OpenStreetMap directly:
 * their free service allows the whole application one request per second, and
 * only a server can hold a queue across every browser and phone at once.
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

import { apiRequest } from '@/lib/api';

/** One place the customer could mean. */
export interface PlaceSuggestion {
  label: string;
  point: GeoCoords;
}

export interface PlaceName {
  /** The neighbourhood — "Surtalai". Null when nothing could name it. */
  label: string | null;
  /** False when the point is outside Jabalpur. The picker refuses to confirm. */
  servedHere: boolean;
}

/**
 * Candidates for what was typed.
 *
 * Never throws for a query that simply matched nothing — an empty list is a
 * normal answer, and an error here would stop somebody mid-address over a
 * provider hiccup they cannot do anything about.
 */
export async function searchPlaces(query: string): Promise<PlaceSuggestion[]> {
  if (query.trim().length < 3) return [];

  try {
    const { results } = await apiRequest<{ results: PlaceSuggestion[] }>(
      `/api/v1/geo/search?q=${encodeURIComponent(query.trim())}`,
    );
    return results ?? [];
  } catch {
    return [];
  }
}

/** What this point is called, and whether we serve it. */
export async function describePlace(point: GeoCoords): Promise<PlaceName> {
  try {
    return await apiRequest<PlaceName>(
      `/api/v1/geo/reverse?lat=${point.lat}&lng=${point.lng}`,
    );
  } catch {
    // A failed name must not stop somebody confirming a pin they can see.
    return { label: null, servedHere: true };
  }
}
