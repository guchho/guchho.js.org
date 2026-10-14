// Local, like-for-like bundler speed benchmark for guchho.js.org.
//
// This is NOT part of the published site. It measures each bundler on THIS
// machine, on the same inputs, with the same minify + source-map settings, and
// writes the raw results to benchmark/results.json. scripts/benchmark.mjs then
// turns only the valid local measurements into the homepage chart.
//
// Methodology (mirrors esbuild's "10 copies of three.js" benchmark):
//   1. Use three@0.108.0's src/ and duplicate it into copy1..copy10.
//   2. entry.js re-exports src/Three.js from each copy.
//   3. Bundle entry.js to a single file with minification + source maps.
//   4. Time the whole process (including process start-up), best of RUNS.
//
// The workload lives in the OS temp directory so it never syncs or ships.

import { spawnSync } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const RESULTS = path.join(HERE, 'results.json')
const WORK = path.join(os.tmpdir(), 'guchho-benchmark')
const THREE_VERSION = '0.108.0'
const COPIES = 10
const RUNS = Number(process.env.BENCH_RUNS || 3)
const TIMEOUT = Number(process.env.BENCH_TIMEOUT_MS || 600000)

async function exists(p) {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

// --- Package resolution -----------------------------------------------------

// Benchmark deps are installed under benchmark/node_modules (see benchmark/package.json);
// fall back to the site's node_modules if a tool is already present there.
async function packageDir(pkg) {
  for (const base of [path.join(HERE, 'node_modules'), path.join(ROOT, 'node_modules')]) {
    const dir = path.join(base, pkg)
    if (await exists(path.join(dir, 'package.json'))) return dir
  }
  return null
}

async function packageBin(pkg, binName) {
  const dir = await packageDir(pkg)
  if (!dir) return null
  const meta = JSON.parse(await fsp.readFile(path.join(dir, 'package.json'), 'utf8'))
  const bin = meta.bin
  let rel
  if (typeof bin === 'string') rel = bin
  else if (bin && binName && bin[binName]) rel = bin[binName]
  else if (bin) rel = bin[Object.keys(bin)[0]]
  if (!rel) return null
  const abs = path.join(dir, rel)
  return (await exists(abs)) ? abs : null
}

async function packageModuleEntry(pkg) {
  const dir = await packageDir(pkg)
  if (!dir) return null
  const meta = JSON.parse(await fsp.readFile(path.join(dir, 'package.json'), 'utf8'))
  const rel = meta.module || meta.main || 'index.js'
  const abs = path.join(dir, rel)
  return (await exists(abs)) ? abs : null
}

function guchhoBinary() {
  const candidates = []
  if (process.env.GUCHO_BINARY) candidates.push(process.env.GUCHO_BINARY)
  const platformKey = { win32: 'win32', darwin: 'darwin', linux: 'linux' }[process.platform]
  const exe = process.platform === 'win32' ? 'guchho.exe' : 'guchho'
  candidates.push(path.join(ROOT, 'node_modules', '@guchho', `${platformKey}-${process.arch}`, 'bin', exe))
  candidates.push(path.join(ROOT, 'node_modules', 'guchho', 'bin', exe))
  const probe = process.platform === 'win32'
    ? spawnSync('where.exe', ['guchho'], { encoding: 'utf8' })
    : spawnSync('which', ['guchho'], { encoding: 'utf8' })
  const found = (probe.stdout || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.includes('node_modules'))
  candidates.push(...found)
  if (process.platform === 'win32') candidates.push('C:\\Users\\heman\\bin\\guchho.exe')
  for (const c of candidates) {
    if (!c) continue
    try {
      const res = spawnSync(c, ['--version'], { encoding: 'utf8', timeout: 30000 })
      if (!res.error && (res.status === 0 || /guchho/i.test(res.stdout || ''))) return c
    } catch {
      // try the next candidate
    }
  }
  return null
}

// --- Workload ---------------------------------------------------------------

async function prepareWorkload() {
  const threeDir = await packageDir('three')
  if (!threeDir) {
    throw new Error(`three@${THREE_VERSION} not installed. Run: (cd benchmark && npm install)`)
  }
  const threeSrc = path.join(threeDir, 'src')
  if (!(await exists(path.join(threeSrc, 'Three.js')))) {
    throw new Error(`three ${THREE_VERSION} src/Three.js not found under ${threeSrc}`)
  }

  await fsp.rm(WORK, { recursive: true, force: true })
  await fsp.mkdir(WORK, { recursive: true })
  for (let i = 1; i <= COPIES; i++) {
    await fsp.cp(threeSrc, path.join(WORK, `copy${i}`), { recursive: true })
  }
  const lines = []
  for (let i = 1; i <= COPIES; i++) {
    lines.push(`import * as copy${i} from './copy${i}/Three.js'; export {copy${i}}`)
  }
  await fsp.writeFile(path.join(WORK, 'entry.js'), lines.join('\n') + '\n', 'utf8')

  // Rollup config (plugin resolved by absolute path, since WORK has no node_modules).
  const terserEntry = await packageModuleEntry('@rollup/plugin-terser')
  if (terserEntry) {
    const cfg = [
      `import terser from ${JSON.stringify(pathToFileURL(terserEntry).href)}`,
      'export default {',
      "  input: 'entry.js',",
      "  output: { file: 'entry.rollup.js', format: 'iife', name: 'THREE', sourcemap: true },",
      '  plugins: [terser()],',
      '}',
      '',
    ].join('\n')
    await fsp.writeFile(path.join(WORK, 'rollup.config.mjs'), cfg, 'utf8')
  }

  // Webpack config.
  const wp = [
    "const path = require('node:path')",
    'module.exports = {',
    "  mode: 'production',",
    "  devtool: 'source-map',",
    "  entry: path.resolve(__dirname, 'entry.js'),",
    "  output: { path: path.resolve(__dirname, 'out-webpack'), filename: 'entry.webpack5.js', library: { name: 'THREE', type: 'var' } },",
    '}',
    '',
  ].join('\n')
  await fsp.writeFile(path.join(WORK, 'webpack.config.cjs'), wp, 'utf8')
}

// --- Tool definitions -------------------------------------------------------

async function buildTools() {
  const tools = []

  const gb = guchhoBinary()
  tools.push({
    id: 'guchho',
    name: 'guchho',
    url: 'https://guchho.js.org/',
    command: gb,
    argv: (out) => ['build', 'entry.js', '--bundle', '--minify', '--sourcemap', '--format=iife', '--name=THREE', '--platform=browser', `--outfile=${out}`],
    outfile: 'entry.guchho.js',
    description: 'guchho 1.0.6 (this repo)',
  })

  const esbuildBin = await packageBin('esbuild', 'esbuild')
  tools.push({
    id: 'esbuild',
    name: 'esbuild',
    url: 'https://esbuild.github.io/',
    command: esbuildBin,
    node: true,
    argv: (out) => ['entry.js', '--bundle', '--minify', '--sourcemap', '--format=iife', '--global-name=THREE', '--platform=browser', `--outfile=${out}`],
    outfile: 'entry.esbuild.js',
    description: 'esbuild (installed)',
  })

  const rollupBin = await packageBin('rollup', 'rollup')
  tools.push({
    id: 'rollup',
    name: 'rollup 4 + terser',
    url: 'https://rollupjs.org/',
    command: rollupBin,
    node: true,
    argv: () => ['-c', 'rollup.config.mjs'],
    outfile: 'entry.rollup.js',
    description: 'rollup + @rollup/plugin-terser',
  })

  const parcelBin = await packageBin('parcel', 'parcel')
  tools.push({
    id: 'parcel',
    name: 'parcel 2',
    url: 'https://parceljs.org/',
    command: parcelBin,
    node: true,
    // Parcel 2 removed esbuild's old `--global` flag; the esbuild benchmark also
    // notes Parcel is run with its default options, so no library/global wrapper.
    argv: () => ['build', 'entry.js', '--dist-dir', 'out-parcel', '--public-url', './', '--no-autoinstall', '--no-cache'],
    outfile: path.join('out-parcel', 'entry.js'),
    description: 'parcel 2 (default options)',
  })

  const webpackBin = await packageBin('webpack-cli', 'webpack')
  tools.push({
    id: 'webpack',
    name: 'webpack 5',
    url: 'https://webpack.js.org/',
    command: webpackBin,
    node: true,
    argv: () => ['--config', 'webpack.config.cjs'],
    outfile: path.join('out-webpack', 'entry.webpack5.js'),
    description: 'webpack 5 --mode=production --devtool=sourcemap',
  })

  return tools
}

// --- Execution --------------------------------------------------------------

function timeOnce(tool) {
  const out = tool.outfile
  const args = tool.argv(out)
  const started = process.hrtime.bigint()
  const res = tool.node
    ? spawnSync(process.execPath, [tool.command, ...args], { cwd: WORK, encoding: 'utf8', timeout: TIMEOUT, maxBuffer: 64 * 1024 * 1024 })
    : spawnSync(tool.command, args, { cwd: WORK, encoding: 'utf8', timeout: TIMEOUT, maxBuffer: 64 * 1024 * 1024 })
  const seconds = Number(process.hrtime.bigint() - started) / 1e9
  const ok = !res.error && res.status === 0
  return { seconds, ok, status: res.status, error: res.error ? String(res.error.message || res.error) : '', stderr: (res.stderr || '').slice(-2000) }
}

async function runTool(tool, results) {
  if (!tool.command) {
    results.skipped.push({ id: tool.id, name: tool.name, reason: 'not installed' })
    console.log(`- ${tool.id}: SKIPPED (not installed)`)
    return
  }

  // A discarded warm-up run populates the OS file cache for the 10 source
  // copies so the timed runs are not dominated by cold-cache noise.
  const warm = timeOnce(tool)
  if (!warm.ok) {
    results.failed.push({
      id: tool.id,
      name: tool.name,
      error: warm.error || `exit code ${warm.status}`,
      stderr: warm.stderr || '',
    })
    console.log(`- ${tool.id}: FAILED (${warm.error || 'exit ' + warm.status})`)
    return
  }

  const runs = []
  let last = null
  for (let i = 0; i < RUNS; i++) {
    last = timeOnce(tool)
    if (!last.ok) break
    runs.push(Number(last.seconds.toFixed(3)))
  }

  if (!last || !last.ok || runs.length === 0) {
    results.failed.push({
      id: tool.id,
      name: tool.name,
      error: last?.error || `exit code ${last?.status}`,
      stderr: last?.stderr || '',
    })
    console.log(`- ${tool.id}: FAILED (${last?.error || 'exit ' + last?.status})`)
    return
  }

  const sorted = [...runs].sort((a, b) => a - b)
  const seconds = sorted[0]
  const median = sorted[Math.floor(sorted.length / 2)]
  const outPath = path.join(WORK, tool.outfile)
  const bytes = (await exists(outPath)) ? (await fsp.stat(outPath)).size : null

  results.measured.push({
    id: tool.id,
    name: tool.name,
    url: tool.url,
    description: tool.description,
    seconds: Number(seconds.toFixed(3)),
    median: Number(median.toFixed(3)),
    runs,
    outputBytes: bytes,
  })
  console.log(`- ${tool.id}: ${seconds.toFixed(3)}s (median ${median.toFixed(3)}s; runs: ${runs.join(', ')})`)
}

// --- Main -------------------------------------------------------------------

async function main() {
  console.log('Preparing workload …')
  await prepareWorkload()

  const results = {
    schema: 1,
    workload: {
      description: `${COPIES} copies of three.js bundled into one file`,
      threeVersion: THREE_VERSION,
      entry: 'entry.js',
      minify: true,
      sourcemap: true,
      bundle: true,
    },
    environment: {
      platform: process.platform,
      arch: process.arch,
      os: `${os.type()} ${os.release()}`,
      cpu: os.cpus()[0]?.model || 'unknown',
      cores: os.cpus().length,
      memoryBytes: os.totalmem(),
      node: process.version,
    },
    method: {
      runs: RUNS,
      statistic: 'best',
      warmupRuns: 1,
      includesProcessStartup: true,
      measuredOn: new Date().toISOString(),
      sameMachine: true,
    },
    measured: [],
    skipped: [],
    failed: [],
    // External, published numbers from other machines are deliberately NOT mixed
    // in here. See benchmark/README.md for why they are not comparable.
    references: [],
  }

  console.log('Running benchmarks …')
  const tools = await buildTools()
  for (const tool of tools) {
    try {
      await runTool(tool, results)
    } catch (err) {
      results.failed.push({ id: tool.id, name: tool.name, error: String(err.message || err), stderr: '' })
      console.log(`- ${tool.id}: FAILED (${err.message || err})`)
    }
  }

  await fsp.writeFile(RESULTS, JSON.stringify(results, null, 2) + '\n', 'utf8')
  console.log(`\nWrote ${path.relative(ROOT, RESULTS)}`)
  console.log(`measured: ${results.measured.length}, skipped: ${results.skipped.length}, failed: ${results.failed.length}`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
