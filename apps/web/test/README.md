# Browser tests

End-to-end tests for the reach map, driven through a real Chromium against the
real engine.

```sh
npm run build:web     # required — these need vendor/ and ~11 MB of ITU data
npm run test:web
```

A full run takes about two minutes, most of it real P.533 computation.

## Why these are not in CI

`CLAUDE.md` requires CI to be hermetic: no network, fixtures only. These tests
are the opposite by design — they boot the WebAssembly engine in four workers and
compute actual predictions, because the things worth guarding here only exist at
that level:

- that a coarse pass reaches the screen *before* the fine one finishes,
- that night shading darkens rather than brightens,
- that a reload redraws from cache without silently recomputing.

None of those can be asserted against a fixture. Run them locally before a
release; the exit code is meaningful.

## Dependencies

`playwright` is not a declared dependency — adding one is a 🟡 decision under
`CLAUDE.md`, and the tests are not part of the default `npm test`. Install it
where you need it:

```sh
npm i -D playwright
```

`harness.mjs` uses Playwright's own browser resolution first, and falls back to
`PLAYWRIGHT_BROWSERS_PATH` for sandboxes that pre-install Chromium.

## What each suite covers

| Suite | Guards |
|---|---|
| `reach.spec.mjs` | Blank first visit · geolocation · cost estimate · progressive fill · night-shading direction · receivers · session and grid restore · stale-grid invalidation |
| `popup.spec.mjs` | Click popup before and after a run · per-band margin strip · add/remove receiver · set transmitter · hover popup is transient and button-free · popup tracks a pan |
| `chart.spec.mjs` | 24-hour chart from a popup without any grid run · 24×9 grid shape · every cell a margin or an explicit dash · current hour marked · station controls inside the modal write through · cache on reopen |
| `spacewx.spec.mjs` | Every fallback tier · live beats snapshot · HTML-with-200 falls through · SSN reaches the engine via the cache key · aurora overlay lazy-loads, paints, and draws nothing in the tropics |
| `space.spec.mjs` | Headline figures carry provenance · storm copy leads with the storm · alerts verbatim · missing source stated not blanked |
| `station.spec.mjs` | Power/antenna arithmetic to 0.1 dB · non-preset wattages · bad input falls back · 10× power is exactly +10 dB · never triggers a recompute · restore on reload · pre-split sessions migrate |
| `field.spec.mjs` | Mode switch shortens the antenna list · frequency entry in MHz, kHz and with suffixes · duplicate and out-of-band rejection · cut lengths in either unit · distance stays metric · NVIS verdict and per-frequency rows · whip efficiency caution · low NVIS height reported as design not fault · interactive diagram parts |
| `patterngain.spec.mjs` | Fixed-gain path unchanged · modelled antennas change coverage without re-running P.533 · height and orientation both redraw · vertical hides the controls it has no use for · popup names the take-off angle and the gain there · selection survives a reload |
| `antenna.spec.mjs` | Dimensions match the handbook · lobe angle tracks height · take-off verdict and its advice · ground-loss cautions attach to the antennas that earn them · multiband lobing · every antenna on every band · no hardcoded colour, all three themes · per-antenna parameter memory |

## Five bugs these caught

Worth keeping in mind — none of these were visible in the code:

1. **`[hidden]` did not hide the overlay.** `.hint` and `.run` set
   `display:flex`, and an author `display` beats the UA stylesheet's `[hidden]`
   rule. The "pick a transmitter" card covered the map permanently.
2. **An unshaded stripe at the antimeridian.** Layers were drawn copy-by-copy,
   and the grid image overhangs half a cell past its copy's edge, so one copy's
   image landed on top of the previous copy's night shading.
3. **NOAA publishes aurora at the equator.** OVATION's grid carried 325 non-zero
   cells between 0° and 10°N and 635 between 0° and 10°S, which drew a bright
   band straight across the tropics. There is no aurora there; it is an artifact
   of the model output. Caught by screenshotting the overlay, not by reading the
   data — and the test for it had to be rewritten as a difference, because an
   absolute colour check flagged the terminator instead.
4. **The first-visit overlay came back and blocked the map.** Setting the
   transmitter from a map click re-showed the full overlay to say "press
   Generate" — covering the map the user had just been working with. It is a
   non-blocking banner now.
5. **`watchErrors` let every favicon 404 through as a page error.** The response
   handler filtered them by URL, but the console handler filtered on the message
   text — and Chromium's text for one is the generic "Failed to load resource",
   with the URL only in `location()`. It also meant a *real* resource failure
   was reported as that same unattributed string. Both fixed together.

All of them were found by asserting on pixels, by looking at a render, or by
chasing down an error the suite itself was reporting. A test that only checked
"the element exists" would have passed every one.

## Writing more

- Sample the canvas rather than trusting the DOM — most of this page's output is
  pixels.
- Wait for a run to *start* before waiting for it to finish. `#run` is still
  hidden while `generate()` awaits the cache lookup, so checking only for
  "finished" passes instantly and tests nothing.
- Dismiss the first-visit overlay with `dismissHint()`, which waits for boot
  first. Hiding it earlier does nothing — boot finishes and puts it back, and it
  covers the canvas, so every later click lands on the overlay.
- `page.waitForFunction(fn, arg, options)` — the timeout goes in the **third**
  argument. Passing `{ timeout }` second makes it an argument to `fn` and leaves
  the default 30 s in force, which silently truncates a long run.
- Poll for a repaint, do not sleep for one. Pattern rebuilds are async and the
  redraw after them is scheduled on a frame, so a wait long enough on an idle
  machine is not long enough on a loaded one. `patterngain.spec.mjs` has a
  `waitForRepaint` helper that samples the canvas until it changes.
- Do not assert wall-clock timings. `catalogue.test.mjs` used to fail a 700 ms
  budget at ~780 ms on a slower sandbox, which said nothing about the code. It
  measures the worst case as a multiple of the simplest one now, which catches a
  superlinear regression on any machine.
- `dismissHint()` only works on a *first* visit. A reload that restores a
  session with a transmitter never shows the first-visit card, so waiting for it
  hangs for the full timeout. Wait for something the restored state implies
  instead.
