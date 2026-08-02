# HFKit web

The deployable site. ITU-R P.533 runs in the browser via WebAssembly; no server
computes anything.

| Page | What it is |
|---|---|
| `index.html` | Landing, with an honest note on what is real and what is not |
| `planner.html` | **Live engine.** Two points → 24 h × 9 bands of SNR margin, computed on-device. "Use my location" sets the transmitter. |
| `reach.html` | **Live engine.** Reach map for any transmitter, computed across a worker pool and painted progressively as passes land. Adjustable detail, 4- or 24-hour span, night-shading opacity. Click the map for a detail panel (per-band margins, MUF, add-as-receiver / set-as-transmitter, 24-hour circuit chart); hover a receiver for its circuit. Pan and zoom. |
| `styleguide.html` | Every design token in all three themes |

## Build

```sh
npm install
npm run build:web
```

`build:web` builds `@hfkit/theme` and `@hfkit/engine`, then assembles
`apps/web/vendor/` and `apps/web/data/`. Both are gitignored — they are derived,
and the ITU data is ~11 MB per month, which belongs on a CDN rather than in git.

**ITU data resolution:** set `ITU_DATA_DIR` to a local checkout of
`ITU-R-HF/ITURHFProp/Data` to copy from disk; otherwise the build fetches the
files it needs from GitHub, so it works unchanged in CI where no checkout
exists. The build fails loudly if any data file is missing or truncated rather
than shipping a site whose engine cannot start.

`ITU_MONTHS=all` publishes all twelve months (~128 MB) instead of the current
one.

## Deploy to Cloudflare (Workers with static assets)

Cloudflare now defaults Git-connected projects to **Workers with static assets**
rather than Pages. `wrangler.jsonc` at the repo root declares the site; there is
no Worker script, because everything runs in the browser.

In the Cloudflare dashboard, connect the repo and set:

| Field | Value |
|---|---|
| Project name | `hfkit` |
| Build command | `npm install && npm run build:web` |
| Deploy command | `npx wrangler deploy` |
| Non-production branch deploy command | `npx wrangler versions upload` |
| Build variable | `NODE_VERSION` = `22` |

There is no "build output directory" field in this flow — the output path lives
in `wrangler.jsonc` (`assets.directory`). The build must run before the deploy
because `apps/web/vendor/` and `apps/web/data/` are generated and gitignored.

### Custom domain

`wrangler.jsonc` declares `hfkit.caldwell.tech` as a custom domain route, so the
deploy creates and maintains the DNS record. This requires the deploying API
token to hold **Workers Scripts:Edit**, plus **Zone:Read** and **DNS:Edit** on
the zone. A Workers-only token deploys fine but cannot attach the route — add
the domain under the Worker's *Domains & Routes* instead.

### Fits the free tier with room to spare

| Constraint | Limit | This site |
|---|---|---|
| Max asset size | 25 MiB | 10.7 MB (`ionos08.bin`) |
| Assets per deployment | 20,000 | 71 |
| Total upload | 100 MiB | ~14 MB (one month) |

`_headers` is honoured by Workers static assets, so the WASM and ITU data are
marked immutable and a returning visitor skips the ~11 MB download.

### Anywhere else

It is plain static files, so any static host works — `python3 -m http.server`
locally, Netlify, GitHub Pages, S3. Two requirements: serve `.wasm` as
`application/wasm`, and serve over HTTP rather than `file://`, since the engine
fetches its data files.

## Known limitations

- The engine's **reliability** output is a defect (reads zero for every circuit,
  ignores required SNR — see `packages/engine/README.md`), so every page shows
  **SNR margin** instead. The A-score does not exist yet.
- Reach maps are computed on-device, so they cost real time: measured ~87 ms per
  grid point in one worker and a 1.74x speedup across four, giving ~5 s at 24°,
  ~21 s at 12° and ~81 s at 6° for a four-hour span. A 24-hour span is roughly
  six times that. The page estimates before you start and refines the estimate
  from live throughput.
- A coarse pass paints each sample across the whole 24° or 12° block it stands
  for, so an early frame is a sketch, not a per-point prediction.
- Grids are cached in IndexedDB (12 most recent) and the last session in
  localStorage, so a return visit redraws instantly. Nothing is recomputed on
  load without an explicit Generate.
- Receiver positions on the reach map snap to the nearest 6° cell (~330 km), so the
  popup for a clicked point describes its cell, not the exact spot.
- A pinned popup is a real element and swallows pointer events where it sits, so
  the map cannot be dragged through it. Close it or grab elsewhere.
- The 24-hour chart is one `predict` call on an already-booted worker, so it is
  sub-second — but it needs the engine up. The first one on a cold page pays the
  ~11 MB ITU download. It is disabled while a grid run holds the workers.
