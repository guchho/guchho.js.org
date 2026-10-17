// Copy the browser engine (@guchho/wasm) into public/engine/ so the playground
// loads it same-origin instead of depending on a CDN. The 7 MB .wasm is
// gitignored (public/engine) and re-synced on every build.
//
//   node scripts/sync-wasm.mjs              # copy if missing/stale
//   node scripts/sync-wasm.mjs --force      # always copy
//
// Returns { from, to, copied }.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export async function syncWasm({ root = ROOT, force = false } = {}) {
  const pkgDir = path.join(root, 'node_modules', '@guchho', 'wasm', 'lib')
  const outDir = path.join(root, 'public', 'engine')

  let copied = 0
  let missing = false
  await fs.mkdir(outDir, { recursive: true })

  for (const name of ['guchho.js', 'guchho.wasm']) {
    const from = path.join(pkgDir, name)
    const to = path.join(outDir, name)
    let srcStat
    try {
      srcStat = await fs.stat(from)
    } catch {
      missing = true
      continue
    }
    if (!force) {
      try {
        const dstStat = await fs.stat(to)
        if (dstStat.size === srcStat.size) continue
      } catch {
        /* not copied yet */
      }
    }
    await fs.copyFile(from, to)
    copied++
  }

  if (missing) {
    throw new Error(
      'Could not find @guchho/wasm in node_modules — run `npm install` first.',
    )
  }

  return { from: pkgDir, to: outDir, copied }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncWasm({ force: process.argv.includes('--force') })
    .then(({ from, to, copied }) => {
      console.log(
        copied ? `wasm: synced ${copied} file(s) into ${path.relative(ROOT, to)}` : `wasm: already up to date (${path.relative(ROOT, to)})`,
      )
      console.log(`wasm: from ${path.relative(ROOT, from)}`)
    })
    .catch((err) => {
      console.error(err.message)
      process.exit(1)
    })
}
