# Bundler speed benchmarks

Local, like-for-like bundler timings used for the benchmark chart on the
homepage. **This directory is not part of the published website** — none of it
is copied into `dist/`, and `scripts/benchmark.mjs` only reads the produced
`results.json` at build time.

## What is measured

A single production bundle of **10 copies of three.js**, minified, with source
maps — the same workload esbuild's own "bench/three" benchmark uses.

1. Take `three@0.108.0` (three.js `r108`) and duplicate its `src/` folder into
   `copy1/` … `copy10/`.
2. `entry.js` re-exports `src/Three.js` from every copy:
   ```js
   import * as copy1 from './copy1/Three.js'; export {copy1}
   // … through copy10
   ```
3. Bundle `entry.js` to one file with minification and source maps.

The generated workload lives in the OS temp directory (`guchho-benchmark/`), so
it never syncs or ships with the repo.

## How to run

```sh
cd benchmark
npm install            # benchmark-only dependencies (isolated from the site)
npm run bench          # == node run-benchmarks.mjs
```

`npm install` may need to approve native build scripts (npm ≥ 12 blocks them by
default):

```sh
npm install-scripts approve esbuild "@parcel/watcher" "@swc/core" lmdb msgpackr-extract
```

Tuning: `BENCH_RUNS` (default 3) and `BENCH_TIMEOUT_MS` (default 600000).
The guchho binary is located from `GUCHO_BINARY`, the repo's
`node_modules/@guchho/*`, the `guchho` shim, or `PATH`.

## Per-bundler invocations

All tools run on the same inputs with the same goals (bundle + minify + source
maps). Where a tool cannot express a setting exactly, the difference is noted.

| Bundler | Command / config |
| --- | --- |
| guchho | `guchho build entry.js --bundle --minify --sourcemap --format=iife --name=THREE --platform=browser --outfile=entry.guchho.js` |
| esbuild | `esbuild entry.js --bundle --minify --sourcemap --format=iife --global-name=THREE --platform=browser --outfile=entry.esbuild.js` |
| rollup 4 | `rollup -c rollup.config.mjs` → `input: entry.js`, `output { file, format: 'iife', name: 'THREE', sourcemap: true }`, `plugins: [terser()]` |
| parcel 2 | `parcel build entry.js --dist-dir out-parcel --public-url ./ --no-autoinstall --no-cache` |
| webpack 5 | `webpack --config webpack.config.cjs` → `mode: 'production'`, `devtool: 'source-map'`, `output.library { name: 'THREE', type: 'var' }` |

## Method

- **Timing** is wall-clock around the whole process, so it includes interpreter
  and process start-up (self-reported times exclude this and are misleading).
- One discarded **warm-up run** per tool populates the OS file cache, then
  `BENCH_RUNS` timed runs. The reported figure is the **best** run; the median is
  also stored.
- All tools are measured on **the same machine, in the same session**, so the
  numbers are comparable to each other — and only to each other.

## Output (`results.json`)

```jsonc
{
  "schema": 1,
  "workload":    { "threeVersion": "0.108.0", "minify": true, "sourcemap": true, ... },
  "environment": { "os": "...", "cpu": "...", "cores": 4, "node": "...", ... },
  "method":      { "runs": 3, "statistic": "best", "warmupRuns": 1, "sameMachine": true, ... },
  "measured":    [ { "id", "name", "url", "seconds", "median", "runs", "outputBytes" } ],
  "skipped":     [ { "id", "name", "reason": "not installed" } ],
  "failed":      [ { "id", "name", "error", "stderr" } ],
  "references":  []
}
```

Only entries in `measured` — real, finite, positive timings from this machine —
feed the chart. `scripts/benchmark.mjs` returns an empty string (no chart) when
there are no valid measurements, and reports `skipped`/`failed` tools rather
than hiding them.

## Limitations

- **Machine-specific.** Timings depend on CPU, disk, OS and background load.
  They are **not** comparable to esbuild's published numbers, which were taken
  on a different machine; `references` is intentionally left empty rather than
  mixing foreign measurements into the chart.
- **Windows variance.** Timing noise on this host is significant (see the `runs`
  arrays); the warm-up run plus best-of-N reduces but does not eliminate it.
- **Parcel 2** has no esbuild-style `--global`/IIFE flag, so it runs with its
  default options and is not wrapped as a library global. Bundling/minifying the
  same sources is unaffected.
- **rollup** needs `@rollup/plugin-terser` for minification (Rollup itself does
  not minify); webpack emits a `var` library, while guchho/esbuild use a named
  IIFE — these wrappers are effectively identical in cost.
- Source maps are written for every tool (sizes in `outputBytes` may differ).

## Latest run

See `results.json` for the authoritative data. The most recent local run
(i3-4150, Windows 10, Node 26) produced, best of 3 after warm-up:

| Bundler | Time |
| --- | ---: |
| guchho | 7.05 s |
| esbuild | 8.16 s |
| parcel 2 | 21.9 s |
| rollup 4 + terser | 69.6 s |
| webpack 5 | 92.0 s |
