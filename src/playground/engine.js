// Client wrapper around the playground engine worker. Owns worker lifetime and
// request ids (so stale requests are dropped). Exposes the two things the
// browser engine actually supports: `build` (emits files) and `transform`
// (prints one source to stdout). Lexer/AST are not exposed by the engine.

export function createEngineClient(workerUrl) {
  let worker = null
  let nextId = 1
  let currentId = 0
  let version = ''
  const pending = new Map()
  const readyWaiters = new Set()

  function ensureWorker() {
    if (worker) return worker
    worker = new Worker(workerUrl)
    worker.addEventListener('message', (event) => {
      const msg = event.data || {}
      if (msg.t === 'ready') {
        if (msg.version) version = msg.version
        for (const fn of readyWaiters) fn(version)
        readyWaiters.clear()
        return
      }
      const entry = pending.get(msg.id)
      if (!entry) return
      if (msg.t === 'log') {
        entry.onLog && entry.onLog(msg.line)
      } else if (msg.t === 'done') {
        pending.delete(msg.id)
        entry.resolve({
          kind: 'build',
          ok: msg.ok,
          code: msg.code,
          files: msg.files,
          log: msg.log,
          measureMs: msg.measureMs,
          id: msg.id,
        })
      } else if (msg.t === 'transformed') {
        pending.delete(msg.id)
        entry.resolve({
          kind: 'transform',
          ok: msg.ok,
          code: msg.code,
          output: msg.output,
          log: msg.log,
          measureMs: msg.measureMs,
          id: msg.id,
        })
      } else if (msg.t === 'error') {
        pending.delete(msg.id)
        entry.reject(new Error(msg.message || 'The engine failed'))
      }
    })
    worker.addEventListener('error', (event) => {
      const message = event && event.message ? event.message : 'The engine worker failed to start'
      for (const [, entry] of pending) entry.reject(new Error(message))
      pending.clear()
    })
    return worker
  }

  function request(message, { onLog, onVersion } = {}) {
    const w = ensureWorker()
    const id = nextId++
    currentId = id
    if (onVersion) {
      if (version) onVersion(version)
      else readyWaiters.add(onVersion)
    }
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onLog })
      try {
        w.postMessage({ ...message, id })
      } catch (err) {
        pending.delete(id)
        reject(err)
      }
    })
  }

  return {
    get version() {
      return version
    },

    build({ sources, entry, outdir, args, onLog, onVersion }) {
      return request({ t: 'build', sources, entry, outdir, args }, { onLog, onVersion })
    },

    transform({ source, loader, args, onLog, onVersion }) {
      return request({ t: 'transform', source, loader, args }, { onLog, onVersion })
    },

    dispose() {
      if (worker) worker.terminate()
      worker = null
      pending.clear()
    },
  }
}
