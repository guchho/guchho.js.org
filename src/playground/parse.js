export function parseDiagnostics(text) {
  const raw = String(text == null ? '' : text).split(/\r?\n/)
  const errors = []
  const warnings = []

  for (const line of raw) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/\[ERROR\]/i.test(trimmed)) errors.push(strip(trimmed))
    else if (/\[WARNING\]/i.test(trimmed)) warnings.push(strip(trimmed))
  }

  return { errors, warnings, raw }
}

function strip(line) {
  return line.replace(/^[^\[]*(\[)/, '$1').trim()
}

export function formatBytes(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return ''
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / (1024 * 1024)).toFixed(1) + ' MB'
}
