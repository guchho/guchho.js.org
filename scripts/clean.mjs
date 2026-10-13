import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function remove(p) {
  try {
    await fs.rm(p, { recursive: true, force: true })
    console.log(`removed ${path.relative(ROOT, p)}`)
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(err.message)
  }
}

await remove(path.join(ROOT, 'src', 'pages'))
await remove(path.join(ROOT, 'dist'))