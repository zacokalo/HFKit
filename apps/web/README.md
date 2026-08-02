# HFKit web

The deployable site. ITU-R P.533 runs in the browser via WebAssembly; no server
computes anything.

| Page | What it is |
|---|---|
| `index.html` | Landing, with an honest note on what is real and what is not |
| `planner.html` | **Live engine.** Two points → 24 h × 9 bands of SNR margin, computed on-device. "Use my location" sets the transmitter. |
| `reach.html` | Reach map: precomputed coverage, day/night overlay, receivers with per-circuit MUF and usable band range. Pan and zoom. |
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

## Deploy to Cloudflare Pages

Point Pages at this repository and set:

| Setting | Value |
|---|---|
| Build command | `npm install && npm run build:web` |
| Build output directory | `apps/web` |
| Node version | 22 |

Nothing else is required — no environment variables, no server, no database.

`_headers` marks the WASM and ITU data immutable, so a returning visitor skips
the ~11 MB download entirely.

### Fits the free tier with room to spare

| Constraint | Limit | This site |
|---|---|---|
| Max file size | 25 MiB | 10.7 MB (`ionos08.bin`) |
| Files per deployment | 20,000 | ~40 |
| Storage | 10 GB | ~12 MB (one month) / ~140 MB (all twelve) |
| Bandwidth | no hard cap | the reason this stays free |

### Anywhere else

It is plain static files, so any static host works — `python3 -m http.server`
locally, Netlify, GitHub Pages, S3. Two requirements: serve `.wasm` as
`application/wasm`, and serve over HTTP rather than `file://`, since the engine
fetches its data files.

## Known limitations

- The engine's **reliability** output is a defect (reads zero for every circuit,
  ignores required SNR — see `packages/engine/README.md`), so every page shows
  **SNR margin** instead. The A-score does not exist yet.
- Reach maps are precomputed for three sample sites. Generating one for an
  arbitrary QTH is on-device work: measured ~87 ms per grid point, so ~21 s for a
  12° grid across four workers. See the roadmap.
- Receiver positions on the reach map snap to the nearest 6° cell (~330 km).
