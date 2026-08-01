# HFKit web — Phase 1 demo

A working end-to-end demonstration: **ITU-R P.533 runs in the browser via
WebAssembly**. No server computes anything.

Measured in headless Chromium: 216 predictions (24 h × 9 frequencies) in
**~315 ms**, engine init ~13 ms, 11 MB of ITU data mounted in ~113 ms.

## What it shows, and what it deliberately doesn't

It renders **SNR margin in dB** against a 24 dB requirement, using isotropic
antennas — a deliberately pessimistic budget, so values are mostly negative.

It does **not** render the engine's reliability column, which reads 0 for every
circuit, hour and frequency tested and does not respond to `requiredSnrDb`. That
is an open defect (`packages/engine/README.md`). SNR, field strength, received
power and MUF are all verified responsive and physically sensible.

It is also **not the A-score** (`docs/07-scoring-spec.md`), which is a calibrated
probability and does not exist yet.

## Build

`vendor/` and `data/itu/` are generated, not committed:

```sh
npm --workspace @hfkit/theme run build
npm --workspace @hfkit/engine run build
node apps/web/build.mjs          # assembles vendor/ and fetches ITU data
```

The ~10.7 MB `ionosNN.bin` for the current month is fetched at build time.
Committing twelve of them would put 128 MB in git for no benefit — they are
immutable published artifacts, so the CDN caches them indefinitely.

## Hosting: Cloudflare Pages

A good fit for the Tier 0 architecture (`docs/11-operating-constraints.md` §3a):

| Constraint | Limit | Us |
|---|---|---|
| Max file size | 25 MiB | 10.7 MB (`ionosNN.bin`) ✓ |
| Files per deployment | 20,000 | ~40 ✓ |
| Storage | 10 GB | ~140 MB with all 12 months ✓ |
| Bandwidth | no hard cap (fair use) | the reason this stays free ✓ |

`_headers` sets long-lived immutable caching on the WASM and ITU data, so a
returning visitor downloads neither again.

Deploy: point Cloudflare Pages at this repo, build command
`npm run build:web`, output directory `apps/web`.
