import { test } from 'node:test'
import assert from 'node:assert/strict'

import { LANGUAGES, getLanguage } from '../src/playground/languages.js'
import { EXAMPLES, exampleFor } from '../src/playground/examples.js'
import { buildArgs, transformArgs, TARGETS, FORMATS, PLATFORMS, LOADERS } from '../src/playground/args.js'
import { parseDiagnostics, formatBytes } from '../src/playground/parse.js'

test('languages: every entry has the fields the UI needs', () => {
  const ids = LANGUAGES.map((l) => l.id)
  assert.deepEqual(ids, ['html', 'css', 'js', 'ts', 'jsx', 'tsx', 'json'])
  for (const lang of LANGUAGES) {
    assert.equal(typeof lang.label, 'string')
    assert.equal(typeof lang.entry, 'string')
    assert.equal(typeof lang.output, 'string')
    assert.ok(LOADERS.includes(lang.loader) || lang.loader === 'html')
    assert.equal(typeof lang.hljs, 'string')
    assert.equal(typeof lang.capabilities, 'object')
  }
})

test('languages: getLanguage falls back to JavaScript', () => {
  assert.equal(getLanguage('tsx').id, 'tsx')
  assert.equal(getLanguage('nonsense').id, 'js')
  assert.equal(getLanguage(undefined).id, 'js')
})

test('languages: HTML opts out of Print, everything else opts in', () => {
  assert.equal(getLanguage('html').capabilities.print, false)
  for (const id of ['js', 'ts', 'jsx', 'tsx', 'css', 'json']) {
    assert.notEqual(getLanguage(id).capabilities.print, false)
  }
})

test('examples: a non-empty starter exists for every language', () => {
  for (const lang of LANGUAGES) {
    const src = exampleFor(lang.id)
    assert.equal(typeof src, 'string')
    assert.ok(src.trim().length > 0)
    assert.equal(src, EXAMPLES[lang.id])
  }
  assert.equal(exampleFor('missing'), EXAMPLES.js)
})

test('buildArgs: JavaScript maps options to real CLI flags', () => {
  const lang = getLanguage('js')
  const args = buildArgs(
    { target: 'es2022', minify: true, format: 'iife', platform: 'browser', loader: 'tsx', bundle: true },
    lang,
  )
  assert.deepEqual(args.slice(0, 3), ['build', 'app.js', '--outdir=dist'])
  assert.ok(args.includes('--minify'))
  assert.ok(args.includes('--target=es2022'))
  assert.ok(args.includes('--format=iife'))
  assert.ok(args.includes('--name=App'))
  assert.ok(args.includes('--platform=browser'))
  assert.ok(args.includes('--bundle'))
  assert.ok(args.includes('--loader:.js=tsx'))
})

test('buildArgs: esm format needs no global name', () => {
  const args = buildArgs({ format: 'esm' }, getLanguage('js'))
  assert.ok(args.includes('--format=esm'))
  assert.ok(!args.some((a) => a.startsWith('--name=')))
})

test('buildArgs: HTML ignores format and platform', () => {
  const args = buildArgs({ target: 'es2020', minify: true, format: 'cjs', platform: 'node', bundle: true }, getLanguage('html'))
  assert.deepEqual(args.slice(0, 3), ['build', 'index.html', '--outdir=dist'])
  assert.ok(args.includes('--minify'))
  assert.ok(args.includes('--target=es2020'))
  assert.ok(args.includes('--bundle'))
  assert.ok(!args.some((a) => a.startsWith('--format=')))
  assert.ok(!args.some((a) => a.startsWith('--platform=')))
})

test('buildArgs: CSS only supports minify', () => {
  const args = buildArgs({ minify: true, format: 'esm', platform: 'node', target: 'es2020', bundle: true }, getLanguage('css'))
  assert.deepEqual(args, ['build', 'style.css', '--outdir=dist', '--minify'])
})

test('buildArgs: skips invalid target and auto loader', () => {
  const args = buildArgs({ target: 'nonsense', loader: 'auto' }, getLanguage('ts'))
  assert.ok(!args.some((a) => a.startsWith('--target=')))
  assert.ok(!args.some((a) => a.startsWith('--loader')))
})

test('transformArgs: JavaScript passes minify, target and format only', () => {
  const args = transformArgs({ minify: true, target: 'es2020', format: 'esm', platform: 'node', bundle: true }, getLanguage('ts'))
  assert.ok(args.includes('--minify'))
  assert.ok(args.includes('--target=es2020'))
  assert.ok(args.includes('--format=esm'))
  assert.ok(!args.some((a) => a.startsWith('--platform=')))
  assert.ok(!args.includes('--bundle'))
})

test('transformArgs: never emits sourcemap and respects HTML capabilities', () => {
  const args = transformArgs({ minify: true, target: 'es2020', format: 'esm' }, getLanguage('html'))
  assert.ok(args.includes('--minify'))
  assert.ok(args.includes('--target=es2020'))
  assert.ok(!args.some((a) => a.includes('sourcemap')))
  assert.ok(!args.some((a) => a.startsWith('--format=')))
})

test('option enums match the documented values', () => {
  assert.ok(TARGETS.includes('es2020'))
  assert.ok(TARGETS.includes('esnext'))
  assert.ok(TARGETS.includes('chrome80'))
  assert.ok(TARGETS.includes('node16'))
  assert.deepEqual(FORMATS, ['esm', 'cjs', 'iife', 'umd', 'amd', 'system'])
  assert.deepEqual(PLATFORMS, ['browser', 'node', 'neutral'])
  assert.ok(LOADERS.includes('auto'))
  assert.ok(LOADERS.includes('dataurl'))
})

test('parse: extracts errors and warnings', () => {
  const log = [
    '▲ [WARNING] "format" is ignored for HTML entries',
    '✘ [ERROR] Could not resolve "./missing.js"',
    '⚡ Done in 38ms',
  ].join('\n')
  const parsed = parseDiagnostics(log)
  assert.equal(parsed.errors.length, 1)
  assert.match(parsed.errors[0], /Could not resolve/)
  assert.equal(parsed.warnings.length, 1)
  assert.match(parsed.warnings[0], /ignored for HTML/)
})

test('parse: empty input yields no diagnostics', () => {
  const parsed = parseDiagnostics('')
  assert.deepEqual(parsed.errors, [])
  assert.deepEqual(parsed.warnings, [])
})

test('parse: formatBytes', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(2048), '2.0 KB')
  assert.equal(formatBytes(1048576), '1.0 MB')
  assert.equal(formatBytes(NaN), '')
})
