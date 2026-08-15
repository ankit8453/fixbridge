import type { GeoPoint } from '../../src/core/geo';

/**
 * Real Jabalpur localities with approximate centre coordinates.
 *
 * Approximate on purpose — these are seed fixtures for development and for
 * Phase 5's distance-ranking tests, not a survey. They are close enough that
 * relative distances between localities are realistic, which is the property
 * the search tests actually depend on.
 */
export interface Locality extends GeoPoint {
  name: string;
}

export const JABALPUR_LOCALITIES: Locality[] = [
  { name: 'Wright Town', lat: 23.1618, lng: 79.9492 },
  { name: 'Napier Town', lat: 23.1563, lng: 79.9376 },
  { name: 'Adhartal', lat: 23.2081, lng: 79.9283 },
  { name: 'Vijay Nagar', lat: 23.2172, lng: 79.9081 },
  { name: 'Madan Mahal', lat: 23.1487, lng: 79.9214 },
  { name: 'Gorakhpur', lat: 23.1662, lng: 79.9331 },
  { name: 'Ranjhi', lat: 23.1934, lng: 79.8853 },
  { name: 'Garha', lat: 23.1421, lng: 79.9043 },
  { name: 'Civil Lines', lat: 23.1694, lng: 79.9407 },
  { name: 'Sadar', lat: 23.1808, lng: 79.9337 },
];

export function localityByName(name: string): Locality {
  const found = JABALPUR_LOCALITIES.find((locality) => locality.name === name);
  if (!found) throw new Error(`unknown Jabalpur locality: ${name}`);
  return found;
}
