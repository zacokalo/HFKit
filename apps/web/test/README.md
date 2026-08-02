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
| `chart.spec.mjs` | 24-hour chart from a popup without any grid run · 24×9 grid shape · every cell a margin or an explicit dash · current hour marked · station gain re-renders · cache on reopen |

## Three bugs these caught

Worth keeping in mind — all three looked fine by eye:

1. **`[hidden]` did not hide the overlay.** `.hint` and `.run` set
   `display:flex`, and an author `display` beats the UA stylesheet's `[hidden]`
   rule. The "pick a transmitter" card covered the map permanently.
2. **An unshaded stripe at the antimeridian.** Layers were drawn copy-by-copy,
   and the grid image overhangs half a cell past its copy's edge, so one copy's
   image landed on top of the previous copy's night shading.
3. **The first-visit overlay came back and blocked the map.** Setting the
   transmitter from a map click re-showed the full overlay to say "press
   Generate" — covering the map the user had just been working with. It is a
   non-blocking banner now.

Both were found by asserting on pixels. A test that only checked "the element
exists" would have passed.

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
