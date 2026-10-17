// Playground engine worker (static — not bundled by guchho, so it stays a plain
// classic worker and loads the WASM engine itself via dynamic import()).
//
// Protocol (main -> worker):
//   { t: 'build',     id, entry, outdir, sources: {path: content}, args: string[] }
//   { t: 'transform', id, source, loader, args: string[] }
//   { t: 'cancel',    id }                       // best-effort; drops a queued result
// Protocol (worker -> main):
//   { t: 'ready',       version }
//   { t: 'log',         id, line }
//   { t: 'done',        id, ok, code, files: {rel: content}, log, measureMs }
//   { t: 'transformed', id, ok, code, output, log, measureMs }
//   { t: 'error',       id, message }
//
// `build` runs the engine's `build` subcommand over an in-memory file map and
// returns the emitted files. `transform` runs the engine's `transform`
// subcommand (source in on stdin, printed code out on stdout). Lexer and AST
// are not exposed by the browser engine and are deliberately absent here.
//
// Each `transform` gets a FRESH engine instance. The engine reads stdin through
// a process-global C++ `std::cin`, and once that stream hits EOF it stays at
// EOF for the rest of the instance's life — so a second transform on a reused
// instance would silently read no input and print nothing. Builds never touch
// stdin, so they share one cached instance.

'use strict'

const state = {
  factory: null,
  factoryLoading: null,
  buildEngine: null,
  buildLoading: null,
  version: '',
  announced: false,
  cancelled: new Set(),
}

// Mutable sinks for the shared build engine: Emscripten captures print/printErr
// once at init, so the build engine hands them stable functions that delegate
// to whatever the current build request needs.
let buildOutSink = () => {}
let buildErrSink = () => {}

self.addEventListener('message', (event) => {
  const msg = event.data || {}
  if (msg.t === 'build') {
    handleBuild(msg)
  } else if (msg.t === 'transform') {
    handleTransform(msg)
  } else if (msg.t === 'cancel') {
    state.cancelled.add(msg.id)
  } else if (msg.t === 'ping') {
    self.postMessage({ t: 'pong' })
  }
})

function post(msg) {
  self.postMessage(msg)
}

function engineUrl() {
  // Worker lives at <root>/playground-worker.js; engine at <root>/engine/guchho.js.
  return new URL('engine/guchho.js', self.location.href).href
}

async function loadFactory() {
  if (state.factory) return state.factory
  if (state.factoryLoading) return state.factoryLoading
  state.factoryLoading = (async () => {
    let factory
    try {
      const mod = await import(/* @vite-ignore */ engineUrl())
      factory = mod && mod.default
      if (typeof factory !== 'function') throw new Error('engine module has no default factory export')
    } catch (err) {
      throw new Error('Could not load the engine from ' + engineUrl() + ' — ' + (err && err.message ? err : err))
    }
    state.factory = factory
    return factory
  })()
  try {
    return await state.factoryLoading
  } finally {
    state.factoryLoading = null
  }
}

function announce(engine) {
  if (state.announced) return
  try {
    state.version = engine.ccall('guchho_version', 'string', [], []) || ''
  } catch {
    state.version = ''
  }
  state.announced = true
  post({ t: 'ready', version: state.version })
}

async function getBuildEngine() {
  if (state.buildEngine) return state.buildEngine
  if (state.buildLoading) return state.buildLoading
  state.buildLoading = (async () => {
    const factory = await loadFactory()
    const engine = await factory({
      print: (line) => buildOutSink(String(line)),
      printErr: (line) => buildErrSink(String(line)),
      noInitialRun: true,
    })
    state.buildEngine = engine
    announce(engine)
    return engine
  })()
  try {
    return await state.buildLoading
  } finally {
    state.buildLoading = null
  }
}

async function createEngine(options) {
  const factory = await loadFactory()
  return factory({ noInitialRun: true, ...options })
}

async function handleBuild(msg) {
  const { id, entry, outdir, sources, args } = msg
  const measureStart = now()
  const logLines = []
  try {
    const engine = await getBuildEngine()
    if (state.cancelled.has(id)) return

    // Both streams are build diagnostics for a build.
    buildOutSink = (line) => {
      logLines.push(line)
      post({ t: 'log', id, line })
    }
    buildErrSink = buildOutSink

    writeFiles(engine.FS, sources)
    clearDir(engine.FS, outdir)

    let code = 0
    try {
      code = engine.callMain(args)
      if (typeof code !== 'number') code = 0
    } catch (err) {
      code = exitCodeFrom(err)
      if (code === 0) code = 1
    }

    const files = readTree(engine.FS, outdir)
    const measureMs = Math.round(now() - measureStart)
    if (state.cancelled.has(id)) return
    post({ t: 'done', id, ok: code === 0, code, files, log: logLines.join('\n'), measureMs })
  } catch (err) {
    const message = err && err.message ? String(err.message) : String(err)
    post({ t: 'error', id, message, measureMs: Math.round(now() - measureStart) })
  } finally {
    buildOutSink = () => {}
    buildErrSink = () => {}
  }
}

async function handleTransform(msg) {
  const { id, source, loader, args } = msg
  const measureStart = now()
  const outLines = []
  const errLines = []
  try {
    // Fresh instance: the engine's stdin cannot be re-read after EOF (see header).
    const bytes = new TextEncoder().encode(source == null ? '' : String(source))
    let pos = 0
    const engine = await createEngine({
      print: (line) => outLines.push(String(line)),
      printErr: (line) => errLines.push(String(line)),
      stdin: () => (pos < bytes.length ? bytes[pos++] : null),
    })
    announce(engine)
    if (state.cancelled.has(id)) return

    const argv = ['transform', '--loader=' + (loader || 'js')]
    if (Array.isArray(args)) argv.push(...args)

    let code = 0
    try {
      code = engine.callMain(argv)
      if (typeof code !== 'number') code = 0
    } catch (err) {
      code = exitCodeFrom(err)
      if (code === 0) code = 1
    }

    const measureMs = Math.round(now() - measureStart)
    if (state.cancelled.has(id)) return
    post({
      t: 'transformed',
      id,
      ok: code === 0,
      code,
      output: outLines.join('\n'),
      log: errLines.join('\n'),
      measureMs,
    })
  } catch (err) {
    const message = err && err.message ? String(err.message) : String(err)
    post({ t: 'error', id, message, measureMs: Math.round(now() - measureStart) })
  }
}

// A non-zero exit may surface as a thrown ExitStatus carrying the code, or as a
// hard abort with no code. Returns the exit code, or 0 when the message carries
// none.
function exitCodeFrom(err) {
  const message = err && err.message ? String(err.message) : String(err)
  const match = message.match(/ExitStatus[^\d]*(\d+)|exit[^\d]*(\d+)/i)
  if (match) return Number(match[1] || match[2])
  return 0
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function writeFiles(FS, sources) {
  for (const [relPath, content] of Object.entries(sources || {})) {
    const abs = '/' + String(relPath).replace(/^\/+/, '')
    const parts = abs.split('/').filter(Boolean)
    let dir = ''
    for (const part of parts.slice(0, -1)) {
      dir += '/' + part
      try {
        FS.mkdir(dir)
      } catch {
        /* exists */
      }
    }
    try {
      FS.writeFile(abs, content)
    } catch {
      /* ignore */
    }
  }
}

function clearDir(FS, dir) {
  let names
  try {
    names = FS.readdir(dir)
  } catch {
    return
  }
  for (const name of names) {
    if (name === '.' || name === '..') continue
    const p = dir + '/' + name
    let stat
    try {
      stat = FS.stat(p)
    } catch {
      continue
    }
    if (FS.isDir(stat.mode)) {
      clearDir(FS, p)
      try {
        FS.rmdir(p)
      } catch {
        /* ignore */
      }
    } else {
      try {
        FS.unlink(p)
      } catch {
        /* ignore */
      }
    }
  }
}

function readTree(FS, dir) {
  const out = {}
  const walk = (current) => {
    let names
    try {
      names = FS.readdir(current)
    } catch {
      return
    }
    for (const name of names) {
      if (name === '.' || name === '..') continue
      const p = current + '/' + name
      let stat
      try {
        stat = FS.stat(p)
      } catch {
        continue
      }
      if (FS.isDir(stat.mode)) {
        walk(p)
        continue
      }
      let text = ''
      try {
        text = FS.readFile(p, { encoding: 'utf8' })
      } catch {
        text = ''
      }
      out[p.slice(dir.length + 1)] = text
    }
  }
  walk(dir)
  return out
}
