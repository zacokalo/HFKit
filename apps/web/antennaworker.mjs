// Module worker: evaluates antennas against paths off the main thread.
//
// One pattern analysis is 20–70 ms; the comms planner runs one per antenna per
// band, which for a handful of antennas and ten bands is several seconds. On
// the main thread that is several seconds of a frozen page while someone is
// trying to drag a slider. Here it is several seconds of a progress bar.
//
// The model is pure ESM, so this imports the same file the page and the unit
// tests use. Results are plain data (see evaluateAntenna), which is what lets
// them cross the worker boundary unchanged.
import { byId, evaluateAntenna } from './vendor/antenna-model.mjs';

self.onmessage = (e) => {
  const m = e.data;
  if (m.cmd !== 'evaluate') return;
  const antenna = byId(m.antennaId);
  if (!antenna) {
    self.postMessage({ id: m.id, error: `unknown antenna ${m.antennaId}` });
    return;
  }
  try {
    const result = evaluateAntenna({
      antenna,
      params: m.params ?? {},
      freqsMHz: m.freqsMHz,
      paths: m.paths,
      orientationDeg: m.orientationDeg ?? null,
      designMHz: m.designMHz ?? null,
      perWavelength: m.perWavelength ?? 16,
      siteNames: m.siteNames ?? null,
    });
    self.postMessage({ id: m.id, result });
  } catch (err) {
    self.postMessage({ id: m.id, error: err.message });
  }
};
