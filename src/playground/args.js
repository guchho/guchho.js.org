export const TARGETS = [
  'es2015',
  'es2016',
  'es2017',
  'es2018',
  'es2019',
  'es2020',
  'es2021',
  'es2022',
  'esnext',
  'chrome80',
  'node16',
]

export const FORMATS = ['esm', 'cjs', 'iife', 'umd', 'amd', 'system']

export const PLATFORMS = ['browser', 'node', 'neutral']

export const LOADERS = ['auto', 'js', 'jsx', 'ts', 'tsx', 'css', 'json', 'text', 'file', 'dataurl']

export const OUTDIR = 'dist'

export const NAME = 'App'

function caps(language) {
  return (language && language.capabilities) || {}
}

export function buildArgs(options, language) {
  const o = options || {}
  const c = caps(language)
  const args = ['build', language.entry, '--outdir=' + (o.outdir || OUTDIR)]

  if (c.minify && o.minify) args.push('--minify')
  if (c.target && TARGETS.includes(o.target)) args.push('--target=' + o.target)
  if (c.format && FORMATS.includes(o.format)) {
    args.push('--format=' + o.format)
    if (o.format === 'iife' || o.format === 'umd') args.push('--name=' + (o.name || NAME))
  }
  if (c.platform && PLATFORMS.includes(o.platform)) args.push('--platform=' + o.platform)
  if (c.bundle && o.bundle) args.push('--bundle')

  if (o.loader && o.loader !== 'auto' && LOADERS.includes(o.loader)) {
    args.push('--loader:' + extOf(language) + '=' + o.loader)
  }

  return args
}

export function transformArgs(options, language) {
  const o = options || {}
  const c = caps(language)
  const args = []

  if (c.minify && o.minify) args.push('--minify')
  if (c.target && TARGETS.includes(o.target)) args.push('--target=' + o.target)
  if (c.format && FORMATS.includes(o.format)) args.push('--format=' + o.format)

  return args
}

function extOf(language) {
  const name = (language && language.entry) || ''
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot)
}
