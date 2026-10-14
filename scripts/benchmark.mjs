// Turn locally-measured benchmark results (benchmark/results.json) into the
// homepage chart. Only real, valid local measurements are rendered; if there
// are none the function returns an empty string and no chart appears.
//
// The output is a self-contained <figure> (no runtime script) with a CSS-only
// bar grow-in animation. Numbers from other machines are never shown as if they
// were measured here.

import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RESULTS = path.join(ROOT, 'benchmark', 'results.json')
const RESULTS_URL = 'https://github.com/guchho/guchho.js.org/blob/main/benchmark/results.json'

const BAR = '#b153fc'
const TRACK = 'rgba(191,191,191,0.2)'
const GRID = 'rgba(127,127,127,0.25)'

// The load animation duration scales with each bar's value (longer bar = slower
// grow), clamped so even tiny bars stay visible and huge bars stay snappy.
const MIN_BAR_DURATION = 1.5
const MAX_BAR_DURATION = 9

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// A "nice" step (1, 2, 2.5, 5, 10 × 10ⁿ) so ticks stay readable at any scale.
function niceStep(x) {
  if (!(x > 0) || !Number.isFinite(x)) return 1
  const exp = Math.floor(Math.log10(x))
  const f = x / 10 ** exp
  let nf
  if (f <= 1) nf = 1
  else if (f <= 2) nf = 2
  else if (f <= 2.5) nf = 2.5
  else if (f <= 5) nf = 5
  else nf = 10
  return nf * 10 ** exp
}

function formatTick(value, axisMax) {
  if (axisMax <= 2) return `${value.toFixed(1).replace(/\.0$/, '')}s`
  return `${Math.round(value)}s`
}

function formatValue(seconds) {
  if (seconds < 10) return `${seconds.toFixed(2)}s`
  return `${seconds.toFixed(1)}s`
}

function selectMeasured(results) {
  const seen = new Set()
  const out = []
  for (const item of results.measured || []) {
    if (!item || typeof item.id !== 'string' || seen.has(item.id)) continue
    const seconds = Number(item.seconds)
    if (!Number.isFinite(seconds) || seconds <= 0) continue
    seen.add(item.id)
    out.push({ id: item.id, name: item.name || item.id, url: item.url || '', seconds })
  }
  out.sort((a, b) => a.seconds - b.seconds)
  return out
}

export async function renderBenchmark() {
  let results
  try {
    results = JSON.parse(await fsp.readFile(RESULTS, 'utf8'))
  } catch {
    return ''
  }

  const measured = selectMeasured(results)
  if (measured.length === 0) return ''

  const max = Math.max(...measured.map((m) => m.seconds))
  const step = niceStep(max / 4)
  const axisMax = Number((step * Math.ceil((max * 1.05) / step)).toFixed(6))
  const ticks = []
  for (let k = 0; k * step <= axisMax + 1e-9; k++) ticks.push(Number((k * step).toFixed(6)))

  const rows = measured.length
  const rowH = 26
  const barH = 20
  const plotH = rowH * rows
  const totalH = plotH + 30
  const maxChars = Math.max(1, ...measured.map((m) => (m.name || '').length))

  const gridlines = ticks
    .map(
      (t) =>
        `<div style="position:absolute;left:${((t / axisMax) * 100).toFixed(3)}%;top:0;width:1px;bottom:0;background:${GRID}"></div>`,
    )
    .join('')

  const bars = measured
    .map((m, i) => {
      const top = i * rowH + 3
      const pct = (m.seconds / axisMax) * 100
      const duration = Math.min(MAX_BAR_DURATION, Math.max(MIN_BAR_DURATION, (m.seconds / max) * MAX_BAR_DURATION))
      const label = m.url
        ? `<a href="${escapeHtml(m.url)}">${escapeHtml(m.name)}</a>`
        : escapeHtml(m.name)
      const value = formatValue(m.seconds)
      const valueBase = `position:absolute;top:${i * rowH}px;height:${rowH}px;line-height:${rowH}px;white-space:nowrap;`
      const valueEl =
        pct >= 65
          ? `<div style="${valueBase}left:${pct.toFixed(3)}%;transform:translateX(calc(-100% - 8px));color:#fff;">${value}</div>`
          : `<div style="${valueBase}left:${pct.toFixed(3)}%;margin-left:8px;">${value}</div>`
      return (
        `<div class="bench-track" style="position:absolute;left:0;top:${top}px;width:${pct.toFixed(3)}%;height:${barH}px;background:${TRACK}"></div>` +
        `<div class="bench-fill" style="position:absolute;left:0;top:${top}px;width:${pct.toFixed(3)}%;height:${barH}px;background:${BAR};animation-duration:${duration.toFixed(2)}s;animation-delay:${(i * 0.06).toFixed(2)}s"></div>` +
        `<div style="position:absolute;right:100%;top:${i * rowH}px;width:calc(var(--bench-gutter) - 8px);height:${rowH}px;line-height:${rowH}px;text-align:right;white-space:nowrap;margin-right:8px;">${label}</div>` +
        valueEl
      )
    })
    .join('')

  const axis = ticks
    .map((t) => {
      const style = `position:absolute;top:${plotH + 4}px;white-space:nowrap;`
      const tickLabel = formatTick(t, axisMax)
      if (t <= 1e-9) return `<div style="${style}left:0;">${tickLabel}</div>`
      if (Math.abs(t - axisMax) <= 1e-9) return `<div style="${style}right:0;">${tickLabel}</div>`
      return `<div style="${style}left:${((t / axisMax) * 100).toFixed(3)}%;transform:translateX(-50%);">${tickLabel}</div>`
    })
    .join('')

  const cpu = results.environment?.cpu || 'this machine'
  const date = results.method?.measuredOn ? results.method.measuredOn.slice(0, 10) : ''
  const runs = results.method?.runs || 1
  const caption = `Time to produce a production bundle of 10 copies of three.js (minified, with source maps), measured locally on ${escapeHtml(cpu)}${date ? ` on ${escapeHtml(date)}` : ''}. Best of ${runs} runs; lower is better. <a href="${RESULTS_URL}">benchmark/results.json</a>`

  return [
    `<figure class="bench" style="--bench-chars:${maxChars};">`,
    `<div style="position:relative;height:${totalH}px;">`,
    `<div role="presentation" aria-hidden="true" style="position:absolute;left:0;top:0;right:0;height:${plotH}px;">`,
    `<div style="position:absolute;left:var(--bench-gutter);top:0;right:0;height:${plotH}px;">`,
    gridlines,
    bars,
    axis,
    '</div>',
    '</div>',
    '</div>',
    `<figcaption class="bench-caption">${caption}</figcaption>`,
    '</figure>',
  ].join('')
}
