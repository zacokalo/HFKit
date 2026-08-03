// Helpers shared by the amateur catalogue and the field catalogue.
//
// Small, but they must not be duplicated: clampDroop is what keeps wire ends
// off the ground, and two copies of that rule would eventually disagree.

export const MIN_END_HEIGHT = 0.5;      // wire ends people can walk into are a hazard

export const rad = (d) => (d * Math.PI) / 180;

/** Largest droop that keeps a wire end off the ground, in degrees. */
export function clampDroop(apexHeight, legLength, wantDeg) {
  const usable = Math.max(0, apexHeight - MIN_END_HEIGHT);
  const maxSin = Math.min(1, usable / legLength);
  return Math.min(wantDeg, (Math.asin(maxSin) * 180) / Math.PI);
}

/** A dimension with a length, rendered in whichever units the reader chose. */
export const m = (label, metres, note) => ({ label, metres, note });

/** A dimension that is a fact rather than a measurement. */
export const t = (label, text, note) => ({ label, text, note });
