import { describe, expect, it } from 'vitest';

import { EARTH_RADIUS_KM, greatCircleDistanceKm, pathDistanceKm } from '../src/geo.js';
import { P533_MAX_VALID_DISTANCE_KM } from '../src/types.js';

describe('greatCircleDistanceKm', () => {
  it('returns ~0 for identical points', () => {
    const p = { latitude: 51.5, longitude: -0.1 };
    expect(greatCircleDistanceKm(p, p)).toBeCloseTo(0, 6);
  });

  it('matches the known Luxembourg -> Bockhacken short-path distance used in the golden fixture', () => {
    const tx = { latitude: 49.6666666667, longitude: 6.31666666667 };
    const rx = { latitude: 51.1166666667, longitude: 7.26666666667 };
    // Engine reports 174.728941 km for this exact circuit.
    expect(greatCircleDistanceKm(tx, rx)).toBeCloseTo(174.73, 0);
  });

  it('is symmetric', () => {
    const a = { latitude: 40, longitude: -74 };
    const b = { latitude: 51.5, longitude: -0.1 };
    expect(greatCircleDistanceKm(a, b)).toBeCloseTo(greatCircleDistanceKm(b, a), 9);
  });

  it('antipodal points are ~half the circumference apart', () => {
    const a = { latitude: 10, longitude: 20 };
    const b = { latitude: -10, longitude: -160 };
    const halfCircumference = Math.PI * EARTH_RADIUS_KM;
    expect(greatCircleDistanceKm(a, b)).toBeCloseTo(halfCircumference, 0);
  });
});

describe('pathDistanceKm', () => {
  const tx = { latitude: 0, longitude: 0 };
  const rx = { latitude: 0, longitude: 10 };

  it('long path is the circumference complement of the short path', () => {
    const shortKm = pathDistanceKm(tx, rx, 'short');
    const longKm = pathDistanceKm(tx, rx, 'long');
    const circumferenceKm = 2 * Math.PI * EARTH_RADIUS_KM;
    expect(shortKm + longKm).toBeCloseTo(circumferenceKm, 6);
  });

  it('nearby points: long path exceeds the P.533 validity ceiling even though short path does not', () => {
    const longKm = pathDistanceKm(tx, rx, 'long');
    expect(longKm).toBeGreaterThan(P533_MAX_VALID_DISTANCE_KM);
    const shortKm = pathDistanceKm(tx, rx, 'short');
    expect(shortKm).toBeLessThan(P533_MAX_VALID_DISTANCE_KM);
  });
});
