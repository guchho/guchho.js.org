// Playground UI: a two-panel, single-file playground. The left panel is the
// source editor; the right panel shows generated output, diagnostics, the
// lexer's token stream, and the parse tree summary. Build runs the real WASM
// engine in a Web Worker — it emits files, and the Lexer/AST tabs run the
// engine's `lex`/`parse` service commands over the same worker.

import { LANGUAGES, getLanguage } from './languages.js'
import { exampleFor } from './examples.js'
import { createEditor } from './editor.js'
import { createEngineClient } from './engine.js'
import { buildArgs, transformArgs, TARGETS, FORMATS, PLATFORMS, LOADERS, OUTDIR } from './args.js'
import { parseDiagnostics } from './parse.js'

const DEFAULT_OPTIONS = {
  target: 'es2020',
  minify: false,
  format: 'esm',
  platform: 'browser',
  loader: 'auto',
  bundle: true,
}

export function initPlayground() {
  const root = document.querySelector('[data-playground]')
  if (!root) return

  const $ = (sel) => root.querySelector(sel)
  const $$ = (sel) => [...root.querySelectorAll(sel)]

  const engine = createEngineClient(root.getAttribute('data-worker'))

  const els = {
    lang: $('[data-pg-lang]'),
    build: $('[data-pg-build]'),

    reset: $('[data-pg-reset]'),
    copy: $('[data-pg-copy]'),
    settings: $('[data-pg-settings]'),
    settingsToggle: $('[data-pg-settings-toggle]'),
    status: $('[data-pg-status]'),
    version: $('[data-pg-version]'),
    filename: $('[data-pg-filename]'),
    textarea: $('[data-pg-textarea]'),
    highlight: $('[data-pg-highlight]'),
    gutter: $('[data-pg-gutter]'),
    outputEmpty: $('[data-pg-output-empty]'),
    files: $('[data-pg-files]'),
    filelist: $('[data-pg-filelist]'),
    filecode: $('[data-pg-filecode]'),
    errors: $('[data-pg-errors]'),
    lexer: $('[data-pg-lexer]'),
    ast: $('[data-pg-ast]'),
    optTarget: $('[data-pg-opt-target]'),
    optMinify: $('[data-pg-opt-minify]'),
    optFormat: $('[data-pg-opt-format]'),
    optPlatform: $('[data-pg-opt-platform]'),
    optLoader: $('[data-pg-opt-loader]'),

  }

  let language = getLanguage('html')
  let options = { ...DEFAULT_OPTIONS }
  let editor = null
  let dirty = false
  let busy = false
  let currentOutput = ''
  let inspectKey = ''

  init()

  function init() {
    populateLanguages()
    populateOptions()
    editor = createEditor({
      textarea: els.textarea,
      highlight: els.highlight,
      gutter: els.gutter,
      language: language.hljs,
    })
    loadExample()
    bindEvents()
    applyCapabilities()
    renderErrors(null, null)
    renderInspectEmpty()
    showOutTab('output')
  }

  function populateLanguages() {
    if (!els.lang) return
    for (const lang of LANGUAGES) {
      const opt = document.createElement('option')
      opt.value = lang.id
      opt.textContent = lang.label
      els.lang.appendChild(opt)
    }
    els.lang.value = language.id
  }

  function populateOptions() {
    fillSelect(els.optTarget, TARGETS)
    fillSelect(els.optFormat, FORMATS)
    fillSelect(els.optPlatform, PLATFORMS)
    fillSelect(els.optLoader, LOADERS)

    if (els.optTarget) els.optTarget.value = options.target
    if (els.optFormat) els.optFormat.value = options.format
    if (els.optPlatform) els.optPlatform.value = options.platform
    if (els.optLoader) els.optLoader.value = options.loader
    if (els.optMinify) els.optMinify.checked = options.minify

  }

  function fillSelect(select, values) {
    if (!select) return
    for (const value of values) {
      const opt = document.createElement('option')
      opt.value = value
      opt.textContent = value
      select.appendChild(opt)
    }
  }

  function loadExample() {
    editor.value = exampleFor(language.id)
    editor.setLanguage(language.hljs)
    dirty = false
    currentOutput = ''
    inspectKey = ''
    showOutputEmpty()
    renderErrors(null, null)
    renderInspectEmpty()
    if (els.filename) els.filename.textContent = language.entry
  }

  function applyCapabilities() {
    const c = language.capabilities
    setEnabled(els.optFormat, c.format, 'Ignored for this language')
    setEnabled(els.optPlatform, c.platform, 'Not applicable to this language')
    setEnabled(els.optTarget, c.target, 'Not applicable to this language')
    setEnabled(els.optMinify, c.minify, 'Not applicable to this language')

    setEnabled(els.optLoader, true)

    const canPrint = false
  }

  function setEnabled(el, enabled, reason) {
    if (!el) return
    el.disabled = !enabled
    if (enabled) el.removeAttribute('title')
    else if (reason) el.setAttribute('title', reason)
  }

  function setStatus(text, state) {
    if (!els.status) return
    els.status.textContent = text
    els.status.setAttribute('data-state', state || 'idle')
  }

  function setBusy(next, label) {
    busy = next
    if (els.build) els.build.disabled = next
    if (els.print) els.print.disabled = true
    if (next) setStatus(label || 'Working…', 'busy')
  }

  // --- Output -------------------------------------------------------------

  function showOutputEmpty() {
    if (els.files) els.files.hidden = true
    if (els.outputEmpty) els.outputEmpty.hidden = false
    if (els.filecode) els.filecode.textContent = ''
  }

  function showOutputFiles(entries) {
    currentOutput = ''
    if (els.outputEmpty) els.outputEmpty.hidden = true
    if (els.files) els.files.hidden = entries.length === 0
    if (els.filelist) els.filelist.replaceChildren()
    if (!entries.length) {
      showOutputEmpty()
      return
    }
    entries.forEach((entry, index) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'pg-file' + (index === 0 ? ' is-active' : '')
      btn.textContent = entry.name
      btn.addEventListener('click', () => selectFile(entries, index))
      els.filelist.appendChild(btn)
    })
    selectFile(entries, 0)
  }

  function selectFile(entries, index) {
    const entry = entries[index]
    currentOutput = entry ? entry.content : ''
    if (els.filecode) els.filecode.textContent = currentOutput
    ;[...(els.filelist ? els.filelist.children : [])].forEach((btn, i) =>
      btn.classList.toggle('is-active', i === index),
    )
  }

  function showOutTab(name) {
    $$('[data-pg-out-tab]').forEach((t) => {
      const on = t.getAttribute('data-pg-out-tab') === name
      t.classList.toggle('is-active', on)
      t.setAttribute('aria-selected', String(on))
    })
    $$('[data-pg-out-view]').forEach((v) => {
      v.hidden = v.getAttribute('data-pg-out-view') !== name
    })
  }

  function renderErrors(parsed, kind) {
    const container = els.errors
    if (!container) return
    container.replaceChildren()

    if (!parsed) {
      const p = document.createElement('p')
      p.className = 'pg-inspect-note'
      p.textContent = 'Run Build or Print to see diagnostics here.'
      container.appendChild(p)
      return
    }

    const hasErrors = parsed.errors.length > 0
    const hasWarnings = parsed.warnings.length > 0
    if (!hasErrors && !hasWarnings) {
      const p = document.createElement('p')
      p.className = 'pg-inspect-ok'
      p.textContent = kind === 'transform' ? 'Transform succeeded with no diagnostics.' : 'Build succeeded with no diagnostics.'
      container.appendChild(p)
      return
    }

    if (hasErrors) container.appendChild(section('Errors', parsed.errors, 'is-error'))
    if (hasWarnings) container.appendChild(section('Warnings', parsed.warnings, 'is-warn'))
  }

  function section(title, items, kind) {
    const wrap = document.createElement('div')
    wrap.className = 'pg-console-section'
    const h = document.createElement('p')
    h.className = 'pg-console-title ' + kind
    h.textContent = title
    const ul = document.createElement('ul')
    for (const item of items) {
      const li = document.createElement('li')
      li.textContent = item
      ul.appendChild(li)
    }
    wrap.append(h, ul)
    return wrap
  }

  // --- Inspectors (Lexer / AST) -------------------------------------------
  //
  // Both tabs run the engine's service commands (lex-<lang> / parse-<lang>)
  // over the worker, on the editor's current source, keyed by language+source
  // so a tab switch reuses the last result until the buffer changes.

  const MAX_TOKENS = 400

  function engineLanguage() {
    // The engine has one lexer/parser per source family. JSON rides the JS
    // one (a JSON document is a JS expression); everything else maps through
    // the language's family.
    return language.family === 'json' ? 'js' : language.family
  }

  function inspectCacheKey() {
    return engineLanguage() + '::' + els.textarea.value
  }

  function renderInspectEmpty() {
    renderInspectNote(
      els.lexer,
      "Press Build to lex this file. The engine's token stream appears here.",
    )
    renderInspectNote(
      els.ast,
      "Press Build to parse this file. The engine's tree summary appears here.",
    )
  }

  function renderInspectNote(container, text, cls) {
    if (!container) return
    container.replaceChildren()
    const p = document.createElement('p')
    p.className = cls || 'pg-inspect-note'
    p.textContent = text
    container.appendChild(p)
  }

  function renderLexer(result) {
    const container = els.lexer
    if (!container) return
    container.replaceChildren()

    // CSS reports comments as a separate list; fold them into the stream so
    // the table reads in source order.
    const tokens = (result.tokens || []).slice()
    if (result.comments && result.comments.length) {
      for (const c of result.comments) {
        tokens.push({ kind: 'comment', value: c.text, start: c.start, line: c.line, column: c.column, length: c.length })
      }
      tokens.sort((a, b) => (a.start || 0) - (b.start || 0))
    }
    const count = result.count != null ? result.count + (result.comments ? result.comments.length : 0) : tokens.length

    if (!tokens.length) {
      renderInspectNote(container, 'No tokens - the source is empty.', 'pg-inspect-ok')
      return
    }

    const head = document.createElement('p')
    head.className = 'pg-inspect-ok'
    head.textContent = `${count} token(s) · ${Math.round(result.measureMs || 0)} ms`
    container.appendChild(head)

    const table = document.createElement('table')
    table.className = 'pg-table'
    const thead = document.createElement('thead')
    const hrow = document.createElement('tr')
    for (const label of ['#', 'Kind', 'Value', 'Line', 'Col', 'Len']) {
      const th = document.createElement('th')
      th.textContent = label
      hrow.appendChild(th)
    }
    thead.appendChild(hrow)
    table.appendChild(thead)

    const tbody = document.createElement('tbody')
    const shown = tokens.slice(0, MAX_TOKENS)
    shown.forEach((tok, i) => {
      const tr = document.createElement('tr')
      appendCell(tr, String(i + 1))
      appendCell(tr, tok.kind)
      appendCell(tr, truncate(tok.value, 60), 'pg-table-mono')
      appendCell(tr, String(tok.line))
      appendCell(tr, String(tok.column))
      appendCell(tr, String(tok.length))
      tbody.appendChild(tr)
    })
    table.appendChild(tbody)
    container.appendChild(table)

    if (tokens.length > shown.length) {
      const p = document.createElement('p')
      p.className = 'pg-inspect-note'
      p.textContent = `Showing the first ${shown.length} of ${tokens.length} tokens.`
      container.appendChild(p)
    }
  }

  function renderAst(result) {
    const container = els.ast
    if (!container) return
    container.replaceChildren()

    const head = document.createElement('p')
    head.className = result.parseOk === false ? 'pg-console-title is-error' : 'pg-inspect-ok'
    head.textContent = astSummary(result)
    container.appendChild(head)

    if (result.parseOk === false) {
      const p = document.createElement('p')
      p.className = 'pg-inspect-note'
      p.textContent = 'The parser reported a syntax error - see the Errors tab.'
      container.appendChild(p)
      return
    }

    if (result.nodes && result.nodes.length) {
      container.appendChild(section('Nodes', result.nodes.map(formatHtmlNode), 'is-warn'))
    }
    if (result.rules && result.rules.length) {
      container.appendChild(section('Rules', result.rules.map(formatCssRule), 'is-warn'))
    }
    if (result.symbols && result.symbols.length) {
      container.appendChild(
        section('Symbols', result.symbols.map((s) => `${s.name} · used ${s.useCount}x`), 'is-warn'),
      )
    }
    const empty = !(result.nodes && result.nodes.length) &&
      !(result.rules && result.rules.length) &&
      !(result.symbols && result.symbols.length)
    if (empty) {
      renderInspectNote(container, 'The parse produced no summary for this source.', 'pg-inspect-ok')
    }
  }

  function astSummary(result) {
    const ms = `${Math.round(result.measureMs || 0)} ms`
    if (language.family === 'html') {
      return `${result.nodeCount ?? (result.nodes || []).length} node(s) · ${ms}`
    }
    if (language.family === 'css') {
      return `${result.ruleCount ?? (result.rules || []).length} top-level rule(s) · ${ms}`
    }
    const parts = [`${result.parseOk === false ? 'parse failed' : 'parsed ok'} · ${ms}`]
    if (result.partCount != null) parts.unshift(`${result.partCount} part(s)`)
    return parts.join(' · ')
  }

  function formatHtmlNode(node) {
    const pad = '  '.repeat(Math.max(0, node.depth || 0))
    if (node.tag) {
      const attrs = node.attributes && node.attributes.length ? ' ' + node.attributes.join(' ') : ''
      return `${pad}<${node.tag}${attrs}>`
    }
    return pad + node.type
  }

  function formatCssRule(rule) {
    return `${rule.kind} · offset ${rule.start}`
  }

  function appendCell(tr, text, cls) {
    const td = document.createElement('td')
    if (cls) td.className = cls
    td.textContent = text
    tr.appendChild(td)
  }

  function truncate(text, max) {
    const s = String(text == null ? '' : text)
    return s.length > max ? s.slice(0, max - 1) + '…' : s
  }

  function messageText(message) {
    const text = String((message && message.text) || message || '')
    const loc = message && message.location
    if (loc && loc.line) {
      const file = loc.file ? loc.file + ':' : ''
      return `${text} (${file}${loc.line}:${loc.column})`
    }
    return text
  }

  // Runs lex and parse for the current buffer unless the tabs already hold a
  // result for it. Called after every Build, and on a lazy tab open.
  async function refreshInspectors({ force = false } = {}) {
    const key = inspectCacheKey()
    if (!force && key === inspectKey) return
    inspectKey = key
    const source = els.textarea.value
    const lang = engineLanguage()
    const [lex, parse] = await Promise.allSettled([
      engine.lex({ source, language: lang, onVersion }),
      engine.parse({ source, language: lang, onVersion }),
    ])
    if (key !== inspectKey) return // a newer buffer won the race

    if (lex.status === 'fulfilled') {
      renderLexer(lex.value)
      renderServiceDiagnostics(lex.value)
    } else {
      renderInspectNote(
        els.lexer,
        `Lex failed: ${(lex.reason && lex.reason.message) || lex.reason}`,
        'pg-console-title is-error',
      )
    }

    if (parse.status === 'fulfilled') {
      renderAst(parse.value)
      renderServiceDiagnostics(parse.value)
    } else {
      renderInspectNote(
        els.ast,
        `Parse failed: ${(parse.reason && parse.reason.message) || parse.reason}`,
        'pg-console-title is-error',
      )
    }
  }

  // Folds a lex/parse result's engine diagnostics into the Errors tab,
  // appending so build diagnostics already rendered there stay put.
  function renderServiceDiagnostics(result) {
    const errors = (result.errors || []).map(messageText)
    const warnings = (result.warnings || []).map(messageText)
    if (!errors.length && !warnings.length) return
    const container = els.errors
    if (!container) return
    // Drop the idle placeholder before appending real diagnostics.
    container.querySelectorAll('.pg-inspect-note').forEach((n) => n.remove())
    if (errors.length) container.appendChild(section('Lexer / parser errors', errors, 'is-error'))
    if (warnings.length) container.appendChild(section('Lexer / parser warnings', warnings, 'is-warn'))
  }

  // --- Actions ------------------------------------------------------------

  function onVersion(v) {
    if (els.version) els.version.textContent = v
  }

  async function runBuild() {
    if (busy) return
    setBusy(true, 'Building…')
    try {
      const source = els.textarea.value
      const args = buildArgs(options, language)
      const result = await engine.build({
        sources: { [language.entry]: source },
        entry: language.entry,
        outdir: OUTDIR,
        args,
        onVersion,
      })
      const parsed = parseDiagnostics(result.log)
      const entries = Object.keys(result.files || {})
        .sort()
        .map((name) => ({ name, content: result.files[name] }))
      refreshInspectors()
      if (result.ok) {
        showOutputFiles(entries)
        renderErrors(parsed, 'build')
        showOutTab('output')
        setStatus(`Built ${entries.length} file(s) · ${Math.round(result.measureMs || 0)} ms`, 'ok')
      } else {
        showOutputEmpty()
        renderErrors(parsed, 'build')
        showOutTab('errors')
        setStatus('Build failed', 'error')
      }
    } catch (err) {
      showOutputEmpty()
      renderErrors({ errors: [String((err && err.message) || err)], warnings: [], raw: [] }, 'build')
      showOutTab('errors')
      setStatus('Build failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function runPrint() {
    if (busy) return
    setBusy(true, 'Printing…')
    try {
      const source = els.textarea.value
      const args = transformArgs(options, language)
      const result = await engine.transform({
        source,
        loader: language.loader,
        args,
        onVersion,
      })
      const parsed = parseDiagnostics(result.log)
      if (result.ok) {
        showOutputFiles([{ name: language.output || language.entry, content: result.output || '' }])
        renderErrors(parsed, 'transform')
        showOutTab('output')
        setStatus(`Printed · ${Math.round(result.measureMs || 0)} ms`, 'ok')
      } else {
        showOutputEmpty()
        renderErrors(parsed, 'transform')
        showOutTab('errors')
        setStatus('Print failed', 'error')
      }
    } catch (err) {
      showOutputEmpty()
      renderErrors({ errors: [String((err && err.message) || err)], warnings: [], raw: [] }, 'transform')
      showOutTab('errors')
      setStatus('Print failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function copyOutput() {
    const text = currentOutput || els.textarea.value || ''
    try {
      await navigator.clipboard.writeText(text)
      setStatus('Copied to clipboard', 'ok')
    } catch {
      setStatus('Copy failed — select and copy manually', 'error')
    }
  }

  function resetExample() {
    loadExample()
    setStatus('Restored starter example', 'ok')
  }

  function changeLanguage(nextId) {
    const next = getLanguage(nextId)
    if (next.id === language.id) return
    if (dirty && !confirm(`Discard your changes and load the ${next.label} example?`)) {
      if (els.lang) els.lang.value = language.id
      return
    }
    language = next
    loadExample()
    applyCapabilities()
    setStatus('Ready', 'idle')
  }

  // --- Events -------------------------------------------------------------

  function bindEvents() {
    if (els.lang) els.lang.addEventListener('change', () => changeLanguage(els.lang.value))
    if (els.build) els.build.addEventListener('click', runBuild)

    if (els.reset) els.reset.addEventListener('click', resetExample)
    if (els.copy) els.copy.addEventListener('click', copyOutput)

    if (els.settingsToggle && els.settings) {
      els.settingsToggle.addEventListener('click', () => {
        const open = els.settings.hasAttribute('hidden')
        if (open) els.settings.removeAttribute('hidden')
        else els.settings.setAttribute('hidden', '')
        els.settingsToggle.setAttribute('aria-expanded', String(open))
      })
    }

    if (els.textarea) els.textarea.addEventListener('input', () => (dirty = true))

    if (els.optTarget) els.optTarget.addEventListener('change', () => (options.target = els.optTarget.value))
    if (els.optFormat) els.optFormat.addEventListener('change', () => (options.format = els.optFormat.value))
    if (els.optPlatform) els.optPlatform.addEventListener('change', () => (options.platform = els.optPlatform.value))
    if (els.optLoader) els.optLoader.addEventListener('change', () => (options.loader = els.optLoader.value))
    if (els.optMinify) els.optMinify.addEventListener('change', () => (options.minify = els.optMinify.checked))


    $$('[data-pg-out-tab]').forEach((t) =>
      t.addEventListener('click', () => {
        const name = t.getAttribute('data-pg-out-tab')
        showOutTab(name)
        if (name === 'lexer' || name === 'ast') refreshInspectors()
      }),
    )

    root.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        runBuild()
      }
    })
  }
}
