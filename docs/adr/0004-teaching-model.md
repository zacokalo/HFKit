# 4. The Learn page uses its own teaching model, not the prediction engine

Date: 2026-09-24

## Status

Accepted.

## Context

HFKit's audience includes newcomers, and existing tools are "hostile to
newcomers" (`docs/02`). A beginner's guide — the Learn page — explains HF by
letting people play: send a signal at an angle and watch it bounce, slide
through a day and watch the bands open and close.

The obvious engine for that is the one the site already runs, ITU-R P.533.
It does not fit:

- **It answers a different question.** P.533 returns field strength and SNR
  for a circuit. It does not expose the things a lesson needs to *draw*: the
  path of a ray, which layer turned it back, the skip zone, how much the D
  layer took on the way. Those are internal to its method, if they exist in it
  at all.
- **Cost.** The first prediction pays an ~11 MB data download. A page meant
  to be skimmed on a phone should not, and sliders need an answer per frame,
  not per worker round-trip.
- **Its answers are specific.** Real month, real geography, today's sunspot
  number. A lesson has to read the same for everyone, or "try 3.6 MHz at noon"
  shows something different depending on where and when you read it.

## Decision

We will teach with a separate, deliberately simple model in `packages/learn`:
the textbook mirror-and-secant ionosphere, using the published CCIR formulas
for foE and D-layer absorption and round mid-latitude values for foF2, with
one ionosphere everywhere at 45° latitude on an equinox.

It is kept honest by construction:

1. **Only the Learn page imports it.** No tool page, no score, no map.
2. **Every widget drawing from it is labelled** "teaching model", with a
   caption naming its simplifications and pointing to the planner for real
   answers. The landing page's "what is real here" list says the same.
3. **It never silently uses today's conditions.** Live space weather is
   *offered* with its source and age ("Use today's sun — KC2G, 20 minutes
   ago"), and where none is available the page says so.
4. **Its lessons are tested as behaviours** (`packages/learn/test/`): the MUF
   climbs with distance, the skip zone grows with frequency and vanishes below
   foF2, 80 m is absorbed at noon and heard at midnight, M(3000) lands near 3.
   Geometry is pinned to the antenna package's so the two pages cannot
   disagree on a take-off angle.

The antenna chapter uses the real antenna model and the space weather chapter
uses the same rules-of-thumb copy as the space weather page, so only
propagation has a second implementation.

## Consequences

- Two ionosphere models exist in the codebase. Anyone changing either must
  know the other is there; `packages/learn/ionosphere.mjs` opens by saying
  what it is not.
- The teaching model will disagree with P.533 in its numbers, sometimes by a
  lot (it has no geography, no season, no noise). That is acceptable for
  explaining shapes and not acceptable for anything a person would plan with,
  which is why point 1 above is a rule rather than a habit.
- Reversal is cheap: the package is self-contained and has one consumer.

## Alternatives considered

- **Precomputed P.533 output**, like `explorer.html`. Real, but it cannot
  show rays, layers or the skip zone, and freezes the interaction to whatever
  grid was precomputed.
- **Static diagrams.** Zero risk of misleading numbers, but the request was
  specifically for interactive tools that help the subject click, and the
  moving parts (angle, frequency, time of day) are exactly what a static
  picture cannot convey.
