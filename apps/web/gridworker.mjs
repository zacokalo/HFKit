// Module worker: computes a slice of a reach grid on-device.
// The Emscripten glue is CommonJS and assigns to a global, so it is fetched and
// evaluated into the worker scope rather than imported.
import { HFEngine, BrowserDataProvider, setModuleFactory } from './vendor/engine/browser.js';

let engine = null;
async function boot(dataUrl) {
  const src = await (await fetch('./vendor/iturhfprop.js')).text();
  (0, eval)(src);
  // Emscripten locates its .wasm relative to the script that loaded the glue.
  // In a worker there is no currentScript, and the glue is eval'd besides, so
  // it would look beside the worker rather than in vendor/. locateFile pins it.
  const raw = self.Module;
  setModuleFactory((opts = {}) =>
    raw({ ...opts, locateFile: (f) => new URL('./vendor/' + f, self.location.href).href }));
  engine = await HFEngine.create({ dataProvider: new BrowserDataProvider(dataUrl) });
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.cmd === 'boot') { await boot(m.dataUrl); self.postMessage({ ok: true, booted: true }); return; }
  if (m.cmd === 'grid') {
    const { tx, points, freqs, hours, month, year, ssn, powerW, reqSnr } = m;
    const out = [];
    for (const [lat, lon] of points) {
      try {
        const r = await engine.predict({
          transmitter: tx, receiver: { latitude: lat, longitude: lon },
          time: { year, month, hoursUtc: hours }, frequenciesMHz: freqs,
          transmitPowerWatts: powerW, requiredSnrDb: reqSnr, requiredSnrBandwidthHz: 3000,
          manMadeNoise: 'residential', modulation: 'analog', solarDriver: { ssn },
        });
        const per = hours.map((h) => {
          let muf = null; const marg = [];
          for (const f of freqs) {
            const p = r.predictions.find((x) => x.hourUtc === h && Math.abs(x.frequencyMHz - f) < 0.01);
            if (!p || p.snrAtReliabilityDb == null) { marg.push(null); continue; }
            if (muf === null && p.basicMufMHz != null) muf = Math.round(p.basicMufMHz * 10) / 10;
            marg.push(Math.round(p.snrAtReliabilityDb - reqSnr));
          }
          return [marg, muf];
        });
        out.push([lat, lon, per]);
      } catch { /* skip unpredictable cells */ }
      if (out.length % 20 === 0) self.postMessage({ progress: out.length });
    }
    self.postMessage({ ok: true, cells: out });
  }
};
