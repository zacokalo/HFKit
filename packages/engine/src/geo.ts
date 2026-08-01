// Great-circle geometry helpers. Kept dependency-free and simple: this
// package's only use of it is the >10,000 km validity guard (see
// docs/CLAUDE.md "never hide uncertainty" and
// spike/engine-compare/FINDINGS.md #2), so precision beyond a spherical-earth
// model is not needed -- we are drawing a line, not navigating one.

import type { GeoPosition, PathDirection } from './types.js';

/** Mean earth radius, km (IUGG). */
export const EARTH_RADIUS_KM = 6371.0088;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine great-circle distance between two positions, km. */
export function greatCircleDistanceKm(a: GeoPosition, b: GeoPosition): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  return EARTH_RADIUS_KM * c;
}

/**
 * Path distance actually used for prediction: the short great-circle
 * distance, or its complement around the full circumference for the long
 * path. This matters for the validity check -- a "long path" request between
 * two nearby points can be a ~40,000 km circuit even though the short
 * distance is small.
 */
export function pathDistanceKm(
  transmitter: GeoPosition,
  receiver: GeoPosition,
  direction: PathDirection,
): number {
  const shortKm = greatCircleDistanceKm(transmitter, receiver);
  if (direction === 'long') {
    const circumferenceKm = 2 * Math.PI * EARTH_RADIUS_KM;
    return circumferenceKm - shortKm;
  }
  return shortKm;
}
