// Playground UI: a two-panel, single-file playground. The left panel is the
// source editor; the right panel shows generated output, diagnostics, and the
// (browser-unavailable) inspector tabs. Build and Print run the real WASM
// engine in a Web Worker — Build emits files, Print runs `transform`.

import { LANGUAGES, getLanguage } from './languages.js'
import { exampleFor } from './examples.js'
import { createEditor } from './editor.js'
import { createEngineClient } from './engine.js'
import { buildArgs, transformArgs, TARGETS, FORMATS, PLATFORMS, LOADERS, OUTDIR } from './args.js'
import { parseDiagnostics } from './parse.js'

const DEFAULT_OPTIONS = {
  target: 'es2020',
  minify: true,
  format: 'esm',
  platform: 'browser',
  loader: 'auto',
  bundle: false,
}

const SVG_INFO =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M8 7.2v4M8 4.8v.6"/></svg>'

export function initPlayground() {
  const root = document.querySelector('[data-playground]')
  if (!root) return

  const $ = (sel) => root.querySelector(sel)
  const $$ = (sel) => [...root.querySelectorAll(sel)]

  const engine = createEngineClient(root.getAttribute('data-worker'))

  const els = {
    lang: $('[data-pg-lang]'),
    build: $('[data-pg-build]'),
    print: $('[data-pg-print]'),
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
    optBundle: $('[data-pg-opt-bundle]'),
  }

  let language = getLanguage('html')
  let options = { ...DEFAULT_OPTIONS }
  let editor = null
  let dirty = false
  let busy = false
  let currentOutput = ''

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
    renderUnavailable(els.lexer, UNAVAILABLE.lexer)
    renderUnavailable(els.ast, UNAVAILABLE.ast)
    renderErrors(null, null)
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
    if (els.optBundle) els.optBundle.checked = options.bundle
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
    showOutputEmpty()
    renderErrors(null, null)
    if (els.filename) els.filename.textContent = language.entry
  }

  function applyCapabilities() {
    const c = language.capabilities
    setEnabled(els.optFormat, c.format, 'Ignored for this language')
    setEnabled(els.optPlatform, c.platform, 'Not applicable to this language')
    setEnabled(els.optTarget, c.target, 'Not applicable to this language')
    setEnabled(els.optMinify, c.minify, 'Not applicable to this language')
    setEnabled(els.optBundle, c.bundle, 'Not applicable to this language')
    setEnabled(els.optLoader, true)

    const canPrint = c.print !== false
    if (els.print) {
      els.print.disabled = !canPrint
      if (canPrint) els.print.removeAttribute('title')
      else els.print.setAttribute('title', 'Print is not supported for HTML — use Build')
    }
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
    if (els.print) els.print.disabled = next || language.capabilities.print === false
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

  function renderUnavailable(container, spec) {
    if (!container) return
    container.replaceChildren()
    const box = document.createElement('div')
    box.className = 'pg-unavailable'

    const icon = document.createElement('div')
    icon.className = 'pg-unavailable-icon'
    icon.innerHTML = SVG_INFO

    const h = document.createElement('h3')
    h.className = 'pg-inspect-h'
    h.textContent = spec.title

    const p = document.createElement('p')
    p.textContent = spec.reason

    const code = document.createElement('pre')
    code.className = 'pg-unavailable-code'
    code.textContent = spec.hint

    box.append(icon, h, p, code)
    container.appendChild(box)
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
    if (busy || language.capabilities.print === false) return
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
    if (els.print) els.print.addEventListener('click', runPrint)
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
    if (els.optBundle) els.optBundle.addEventListener('change', () => (options.bundle = els.optBundle.checked))

    $$('[data-pg-out-tab]').forEach((t) =>
      t.addEventListener('click', () => showOutTab(t.getAttribute('data-pg-out-tab'))),
    )

    root.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        runBuild()
      }
    })
  }
}

const UNAVAILABLE = {
  lexer: {
    title: 'Lexer / tokens are not available in the browser',
    reason:
      'The WebAssembly engine exposes only the `guchho_build` entry point. Token-level access lives in the native compiler API, which the browser build does not include.',
    hint: "Native: import { lexer } from 'guchho'",
  },
  ast: {
    title: 'AST is not available in the browser',
    reason:
      'Parsing to an AST is part of the native compiler API (`parse()`), not the browser engine ABI. The browser build only bundles and prints.',
    hint: "Native: import { parse } from 'guchho'",
  },
}
