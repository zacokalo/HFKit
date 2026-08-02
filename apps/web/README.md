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
- Reach maps are precomputed for three sample sites. Generating one for an
  arbitrary QTH is on-device work: measured ~87 ms per grid point, so ~21 s for a
  12° grid across four workers. See the roadmap.
- Receiver positions on the reach map snap to the nearest 6° cell (~330 km).
