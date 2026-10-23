// Build the guchho.js.org documentation site.
//
//   node scripts/build-docs.mjs                 # render docs + build with guchho
//   node scripts/build-docs.mjs --render-only   # render to src/pages, no build
//   node scripts/build-docs.mjs --validate-only # check generated internal links
//   node scripts/build-docs.mjs --serve         # build, then serve dist
//   node scripts/build-docs.mjs --docs <path>   # override the docs source
//
// The docs source of truth is the guchho/guchho repository; override with
// GUCHO_DOCS or --docs.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import siteConfig from '../site.config.mjs'
import { createRenderer, parseFrontmatter } from './markdown.mjs'
import { buildRouteMap, routeToFile } from './routes.mjs'
import { renderSidebar } from './nav.mjs'
import { validateAll } from './validate-links.mjs'
import { renderBenchmark } from './benchmark.mjs'
import { buildSearchIndex } from './search-index.mjs'
import { syncWasm } from './sync-wasm.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const PAGES = path.join(SRC, 'pages')
const PUBLIC = path.join(ROOT, 'public')
const DIST = path.join(ROOT, 'dist')
const COMPONENTS = path.join(SRC, 'components')

const args = new Set(process.argv.slice(2))
const argDocs = process.argv[process.argv.indexOf('--docs') >= 0 ? process.argv.indexOf('--docs') + 1 : -1]

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function readFileOr(p, fallback = '') {
  try {
    return await fs.readFile(p, 'utf8')
  } catch {
    return fallback
  }
}

async function collectMarkdown(dir) {
  if (!(await exists(dir))) throw new Error(`Docs root not found: ${dir}`)
  const files = []
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      const rel = path.relative(dir, full).split(path.sep).join('/')
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(rel)
      }
    }
  }
  await walk(dir)
  return files.sort()
}

async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function rmrf(p) {
  if (await exists(p)) await fs.rm(p, { recursive: true, force: true })
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

async function mkdirs(p) {
  await fs.mkdir(p, { recursive: true })
}

async function lastModified(file) {
  try {
    const stat = await fs.stat(file)
    return stat.mtime.toISOString().slice(0, 10)
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

function renderToc(toc) {
  if (!toc.length) return ''
  const items = toc
    .map(
      (t) =>
        `<li class="toc-item toc-item-${t.level}"><a href="#${encodeURIComponent(t.id)}">${escapeHtml(t.text)}</a></li>`,
    )
    .join('')
  return `<nav class="toc-nav" aria-label="On this page"><p class="toc-title">On this page</p><ol class="toc-list">${items}</ol></nav>`
}

function humanizeSegment(segment) {
  const s = segment.replace(/-/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function breadcrumbJsonLd(route) {
  const site = siteConfig.site
  const segments = route.split('/').filter(Boolean)
  const items = [{ name: 'Home', item: `${site.url}/` }]
  let path = ''
  for (const segment of segments) {
    path += `/${segment}`
    items.push({ name: humanizeSegment(segment), item: `${site.url}${path}/` })
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((entry, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: entry.name,
      item: entry.item,
    })),
  }
}

function websiteJsonLd() {
  const site = siteConfig.site
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: site.name,
    alternateName: ['Guchho.js.org', new URL(site.url).host],
    url: `${site.url}/`,
    description: site.description,
    publisher: { '@type': 'Organization', name: site.name, logo: { '@type': 'ImageObject', url: `${site.url}/logo.png` } },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${site.url}/?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  }
}

function softwareApplicationJsonLd() {
  const site = siteConfig.site
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: site.name,
    url: `${site.url}/`,
    description: site.description,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Windows, macOS, Linux',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    softwareVersion: '1.0.8',
    image: `${site.url}/logo.png`,
    license: 'https://github.com/guchho/guchho/blob/main/LICENSE',
    codeRepository: site.github,
    downloadUrl: site.npm,
  }
}

function blogPostingJsonLd({ route, title, description, date }) {
  const site = siteConfig.site
  const url = `${site.url}${route}`
  const post = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: title,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    image: `${site.url}/logo.png`,
    author: { '@type': 'Organization', name: site.name, url: `${site.url}/` },
    publisher: {
      '@type': 'Organization',
      name: site.name,
      logo: { '@type': 'ImageObject', url: `${site.url}/logo.png` },
    },
  }
  if (description) post.description = description
  if (date) {
    post.datePublished = date
    post.dateModified = date
  }
  return post
}

async function resolveGuchho() {
  const candidates = []
  if (process.env.GUCHO_BINARY) candidates.push(process.env.GUCHO_BINARY)

  const platformKey = { win32: 'win32', darwin: 'darwin', linux: 'linux' }[process.platform]
  const exeName = process.platform === 'win32' ? 'guchho.exe' : 'guchho'
  const npmBin = path.join(ROOT, 'node_modules', '@guchho', `${platformKey}-${process.arch}`, 'bin', exeName)
  if (await exists(npmBin)) candidates.push(npmBin)
  // Written by guchho's postinstall, which newer npm versions may block.
  const shimBin = path.join(ROOT, 'node_modules', 'guchho', 'bin', exeName)
  if (await exists(shimBin)) candidates.push(shimBin)

  if (process.platform === 'win32') {
    const where = spawnSync('where.exe', ['guchho'], { encoding: 'utf8' })
    const matches = (where.stdout || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.includes('node_modules'))
    candidates.push(...matches)
    candidates.push('C:\\Users\\heman\\bin\\guchho.exe')
  } else {
    const which = spawnSync('which', ['guchho'], { encoding: 'utf8' })
    const found = (which.stdout || '').trim()
    if (found) candidates.push(found)
  }

  for (const candidate of candidates) {
    try {
      if (process.platform !== 'win32') {
        // npm may drop the executable bit (or skip guchho's postinstall).
        await fs.chmod(candidate, 0o755).catch(() => {})
      }
      const res = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 30000 })
      if (res.error) continue
      if (res.status === 0 || /guchho/i.test(res.stdout || '')) return candidate
    } catch {
      continue
    }
  }
  throw new Error(
    'Could not find a working guchho binary. Install one (npm install guchho) or set GUCHO_BINARY=…',
  )
}

async function compose({
  layoutSrc,
  headerSrc,
  footerSrc,
  route,
  title,
  description,
  body,
  toc,
  sidebarHtml,
  pageClass,
  benchmarkHtml = '',
  substituteBody = false,
  headExtra = '',
  ogType = 'website',
  publishedTime = '',
}) {
  const prefix = '../'.repeat(route.split('/').filter(Boolean).length + 2)
  const url = siteConfig.site.url + route
  const site = siteConfig.site

  const meta = [
    `<title>${escapeHtml(title)}</title>`,
    description ? `<meta name="description" content="${escapeHtml(description)}" />` : '',
  ]
    .filter(Boolean)
    .join('\n')
  const canonical = `<link rel="canonical" href="${url}" />`
  const ogImage = `${site.url}/logo.png`
  const ogImageAlt = `${site.name} logo`
  const articleMeta =
    ogType === 'article' && publishedTime
      ? [`<meta property="article:published_time" content="${escapeHtml(publishedTime)}" />`]
      : []
  const feedLink = `<link rel="alternate" type="application/atom+xml" title="${escapeHtml(site.name)} blog" href="${site.url}/blog/feed.xml" />`
  const seo = [
    canonical,
    feedLink,
    `<meta property="og:site_name" content="${escapeHtml(site.name)}" />`,
    '<meta property="og:locale" content="en_US" />',
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    description ? `<meta property="og:description" content="${escapeHtml(description)}" />` : '',
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:type" content="${ogType}" />`,
    `<meta property="og:image" content="${ogImage}" />`,
    `<meta property="og:image:alt" content="${escapeHtml(ogImageAlt)}" />`,
    ...articleMeta,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    description ? `<meta name="twitter:description" content="${escapeHtml(description)}" />` : '',
    `<meta name="twitter:image" content="${ogImage}" />`,
    `<meta name="twitter:image:alt" content="${escapeHtml(ogImageAlt)}" />`,
  ]
    .filter(Boolean)
    .join('\n')

  const substitutes = {
    '{{rootPrefix}}': prefix,
    '{{homeUrl}}': '/',
    '{{tagline}}': escapeHtml(site.tagline),
    '{{github}}': escapeHtml(site.github),
    '{{npm}}': escapeHtml(site.npm),
    '{{sponsorUrl}}': escapeHtml(site.sponsorUrl),
    '{{year}}': String(new Date().getFullYear()),
    '{{copyright}}': escapeHtml(site.copyright),
    '{{benchmark}}': benchmarkHtml,
  }
  const apply = (s) => Object.entries(substitutes).reduce((out, [token, value]) => out.split(token).join(value), s)

  const header = apply(headerSrc)
  const footer = apply(footerSrc)

  return apply(layoutSrc)
    .split('{{meta}}').join(meta)
    .split('{{seo}}').join(seo)
    .split('{{headExtra}}').join(apply(headExtra))
    .split('{{pageClass}}').join(escapeHtml(pageClass))
    .split('{{header}}').join(header)
    .split('{{footer}}').join(footer)
    .split('{{sidebar}}').join(sidebarHtml)
    .split('{{body}}').join(substituteBody ? apply(body) : body)
    .split('{{toc}}').join(renderToc(toc))
}

async function main() {
  const docsRoot = path.resolve(
    ROOT,
    argDocs >= 0 ? process.argv[argDocs] : process.env.GUCHO_DOCS || siteConfig.docsRoot,
  )

  const files = await collectMarkdown(docsRoot)
  if (!files.length) throw new Error(`No .md files found under ${docsRoot}`)

  const routeMap = buildRouteMap(files)
  const knownDocRoutes = new Set(routeMap.values())
  const render = createRenderer()
  const pages = []

  console.log(`docs: ${docsRoot}`)
  console.log(`files: ${files.length}`)
  for (const file of files) {
    const source = await fs.readFile(path.join(docsRoot, file.split('/').join(path.sep)), 'utf8')
    const { title, description, date, content } = parseFrontmatter(source)
    const route = routeMap.get(file)
    const { html, toc, anchors, hasH1 } = render(file, content, routeMap)
    pages.push({ file, route, title, description, date, html, toc, anchors, hasH1 })
  }

  const layoutSrc = await fs.readFile(path.join(COMPONENTS, 'layout.html'), 'utf8')
  const headerSrc = await fs.readFile(path.join(COMPONENTS, 'header.html'), 'utf8')
  const footerSrc = await fs.readFile(path.join(COMPONENTS, 'footer.html'), 'utf8')
  const sidebarHtml = renderSidebar(siteConfig, pages, routeMap)
  const benchmarkHtml = await renderBenchmark()

  await rmrf(PAGES)
  await mkdirs(PAGES)

  const rendered = []

  for (const page of pages) {
    const title = page.title || page.file.split('/').pop().replace(/\.md$/, '')
    const sourceLink = `${siteConfig.site.github}/blob/main/docs/${page.file}`
    const lede = page.description ? `<p class="doc-lede">${escapeHtml(page.description)}</p>` : ''
    const sourceNote = `<p class="doc-source"><a href="${sourceLink}" target="_blank" rel="noopener noreferrer">Edit this page on GitHub</a></p>`

    let contentHtml = page.html
    if (!page.hasH1) {
      contentHtml = `<h1>${escapeHtml(title)}</h1>\n${lede}\n${contentHtml}`
    } else if (lede) {
      contentHtml = contentHtml.replace(/^(<h1[^>]*>.*?<\/h1>)/, '$1\n' + lede)
    }

    const body = ['<article class="doc-body">', `${contentHtml}`, sourceNote, '</article>'].join('\n')

    const isBlogPost = page.file.startsWith('blog/') && page.file !== 'blog/README.md'
    const published = page.date || ''
    const jsonLd = [breadcrumbJsonLd(page.route)]
    if (isBlogPost) jsonLd.push(blogPostingJsonLd({ route: page.route, title, description: page.description, date: published }))

    const html = await compose({
      layoutSrc,
      headerSrc,
      footerSrc,
      route: page.route,
      title: `${title} · Guchho docs`,
      description: page.description,
      body,
      toc: page.toc,
      sidebarHtml,
      benchmarkHtml,
      pageClass: 'doc-page',
      ogType: isBlogPost ? 'article' : 'website',
      publishedTime: published,
    })

    const lastmod = await lastModified(path.join(docsRoot, page.file.split('/').join(path.sep)))
    const outFile = path.join(PAGES, routeToFile(page.route).split('/').join(path.sep))
    await mkdirs(path.dirname(outFile))
    await fs.writeFile(outFile, html, 'utf8')
    rendered.push({ route: page.route, file: page.file, title, description: page.description, html, anchors: page.anchors, lastmod, published, jsonLd })
  }

  // Authored pages (src/site/*.html). "home.html" -> "/", "examples.html" -> "/examples/".
  const siteDir = path.join(SRC, 'site')
  const siteTitles = {
    playground: 'Try in the browser',
    'playground-guide': 'Playground guide',
    'privacy-policy': 'Privacy Policy',
    'terms-of-service': 'Terms of Service',
  }
  const siteDescriptions = {
    'privacy-policy': 'How guchho.js.org handles data, cookies, and advertising.',
    'terms-of-service': 'The terms that govern use of the guchho.js.org website.',
  }
  for (const entry of await fs.readdir(siteDir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue
    const name = entry.name.replace(/\.html$/, '')
    const route = name === 'home' ? '/' : `/${name}/`
    if (knownDocRoutes.has(route)) continue
    const pageTitle = name === 'home' ? 'Guchho — Fast Web Bundler' : siteTitles[name] ? `${siteTitles[name]} · Guchho` : 'Guchho — ' + capitalize(name)
    const pageClass = name === 'home' ? 'home' : name === 'playground' ? 'playground' : 'doc-page'
    const headExtra =
      name === 'playground'
        ? '<link rel="stylesheet" href="{{rootPrefix}}src/styles/playground.css" />'
        : ''
    const body = await fs.readFile(path.join(siteDir, entry.name), 'utf8')
    const description = siteDescriptions[name] || siteConfig.site.description
    const jsonLd = name === 'home' ? [websiteJsonLd(), softwareApplicationJsonLd(), breadcrumbJsonLd(route)] : [breadcrumbJsonLd(route)]
    const html = await compose({
      layoutSrc,
      headerSrc,
      footerSrc,
      route,
      title: pageTitle,
      description,
      body,
      toc: [],
      sidebarHtml,
      benchmarkHtml,
      pageClass,
      substituteBody: true,
      headExtra,
    })
    const lastmod = await lastModified(path.join(siteDir, entry.name))
    const outFile = path.join(PAGES, routeToFile(route).split('/').join(path.sep))
    await mkdirs(path.dirname(outFile))
    await fs.writeFile(outFile, html, 'utf8')
    rendered.push({ route, file: '', title: pageTitle, description, html, anchors: new Set(), lastmod, published: '', jsonLd })
  }

  console.log(`pages: ${rendered.length}`)

  const knownRoutes = new Set(rendered.map((p) => p.route))
  const knownFiles = new Set((await fs.readdir(PUBLIC).catch(() => [])).map((f) => '/' + f))
  const anchorsByRoute = new Map(rendered.map((p) => [p.route, p.anchors]))
  const problems = validateAll(rendered, knownRoutes, knownFiles, anchorsByRoute)
  if (problems.length) {
    console.error(`\n${problems.length} broken link(s):`)
    for (const p of problems) console.error('  ' + p)
    if (args.has('--validate-only')) process.exit(1)
    else throw new Error('Link validation failed')
  } else {
    console.log('links: ok')
  }

  if (args.has('--validate-only')) {
    console.log('Validation passed.')
    return
  }

  // Write entrypoints into the guchho config and build.
  const entrypoints = rendered.map((p) => `src/pages/${routeToFile(p.route)}`)
  const configPath = path.join(ROOT, 'guchho.config.js')
  let originalConfig = await fs.readFile(configPath, 'utf8')
  if (!originalConfig.includes('__ENTRYPOINTS__')) {
    // Self-heal a config left behind by an interrupted run.
    originalConfig = originalConfig.replace(
      /entrypoints:\s*\[[^\]]*\],/,
      'entrypoints: [/* __ENTRYPOINTS__ */],',
    )
    await fs.writeFile(configPath, originalConfig, 'utf8')
  }
  const tempConfig = originalConfig.replace(
    '/* __ENTRYPOINTS__ */',
    entrypoints.map((p) => JSON.stringify(p)).join(', '),
  )
  await fs.writeFile(configPath, tempConfig, 'utf8')

  try {
    if (args.has('--render-only')) {
      console.log('Rendered without building. Run `npm run build` to bundle.')
      return
    }

    // Ship the browser engine (same-origin) for the playground.
    const wasm = await syncWasm()
    if (wasm.copied) console.log(`wasm: synced ${wasm.copied} engine file(s) into ${path.relative(ROOT, wasm.to)}`)

    const binary = await resolveGuchho()
    console.log(`guchho: ${binary}`)

    const build = spawnSync(binary, ['build', ...entrypoints], {
      cwd: ROOT,
      stdio: 'inherit',
      encoding: 'utf8',
    })
    if (build.status !== 0) process.exit(build.status || 1)

    await repairOutputPaths(rendered)

    // JSON-LD is injected after the bundler runs: guchho parses inline scripts
    // as JavaScript and rejects raw JSON ("{\"@context\":…}" is not valid
    // statement syntax), so it cannot travel through the HTML pipeline.
    await injectJsonLd(rendered)

    // Publish-time files guchho does not rewrite (og image, CNAME, robots, sitemap).
    await copyPublic()

    const searchIndex = buildSearchIndex(rendered)
    await fs.writeFile(
      path.join(DIST, 'search-index.json'),
      JSON.stringify(searchIndex),
      'utf8',
    )

    const routesXml = rendered
      .map((p) => {
        const loc = `${siteConfig.site.url}${p.route}`
        const lastmod = p.lastmod ? `<lastmod>${p.lastmod}</lastmod>` : ''
        return `<url><loc>${escapeHtml(loc)}</loc>${lastmod}</url>`
      })
      .join('')
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routesXml}</urlset>\n`
    await fs.writeFile(path.join(DIST, 'sitemap.xml'), sitemap, 'utf8')
    const robotsPath = path.join(DIST, 'robots.txt')
    if (!(await fs.stat(robotsPath).catch(() => null))) {
      await fs.writeFile(
        robotsPath,
        `User-agent: *\nAllow: /\n\nSitemap: ${siteConfig.site.url}/sitemap.xml\n`,
        'utf8',
      )
    }

    await writeBlogFeed(rendered)
    await write404Page()

    console.log(`\nBuilt ${rendered.length} pages into dist/`)
    await verifyOutput(rendered)
    if (args.has('--serve')) {
      console.log('Serving dist/ … (Ctrl+C to stop)')
      const serve = spawnSync(binary, ['serve', 'dist', '--port=3000'], {
        cwd: ROOT,
        stdio: 'inherit',
        encoding: 'utf8',
      })
      process.exit(serve.status || 0)
    }
  } finally {
    await fs.writeFile(configPath, originalConfig, 'utf8')
  }
}

// Inject <script type="application/ld+json"> blocks into the built pages'
// <head>. Done here (not in the HTML pipeline) because guchho parses inline
// scripts as JavaScript and rejects raw JSON-LD.
async function injectJsonLd(pages) {
  let injected = 0
  for (const page of pages) {
    if (!page.jsonLd || !page.jsonLd.length) continue
    const file = path.join(DIST, routeToFile(page.route).split('/').join(path.sep))
    if (!(await exists(file))) continue
    const html = await fs.readFile(file, 'utf8')
    const scripts = page.jsonLd
      .map((obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`)
      .join('\n')
    if (html.includes('</head>')) {
      await fs.writeFile(file, html.replace('</head>', `    ${scripts}\n  </head>`), 'utf8')
      injected++
    }
  }
  if (injected) console.log(`json-ld: injected structured data into ${injected} page(s)`)
}

// Atom feed for the blog. Entries come from rendered pages under /blog/ that
// carry a date in their frontmatter, newest first.
async function writeBlogFeed(rendered) {
  const site = siteConfig.site
  const posts = rendered
    .filter((p) => p.file.startsWith('blog/') && p.file !== 'blog/README.md' && p.published)
    .sort((a, b) => b.published.localeCompare(a.published))
  if (!posts.length) return

  const updated = posts[0].published
  const escapeXml = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const entries = posts
    .map((post) => {
      const url = `${site.url}${post.route}`
      const summary = post.description ? `<summary>${escapeXml(post.description)}</summary>` : ''
      return [
        '<entry>',
        `<title>${escapeXml(post.title)}</title>`,
        `<link href="${escapeXml(url)}" rel="alternate" type="text/html"/>`,
        `<id>${escapeXml(url)}</id>`,
        `<updated>${post.published}</updated>`,
        summary,
        '</entry>',
      ]
        .filter(Boolean)
        .join('')
    })
    .join('')

  const feed = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `<title>${escapeXml(site.name)} blog</title>`,
    `<subtitle>${escapeXml(site.description)}</subtitle>`,
    `<link href="${site.url}/blog/feed.xml" rel="self" type="application/atom+xml"/>`,
    `<link href="${site.url}/blog/" rel="alternate" type="text/html"/>`,
    `<id>${site.url}/blog/feed.xml</id>`,
    `<updated>${updated}</updated>`,
    entries,
    '</feed>',
    '',
  ].join('\n')

  await mkdirs(path.join(DIST, 'blog'))
  await fs.writeFile(path.join(DIST, 'blog', 'feed.xml'), feed, 'utf8')
  console.log(`feed: ${posts.length} blog post(s) -> dist/blog/feed.xml`)
}

// GitHub Pages serves dist/404.html for any missing path, so the page is
// fully self-contained: root-relative asset URLs would break at arbitrary
// depths, and hashed bundle names are not known to this step.
async function write404Page() {
  const site = siteConfig.site
  const title = `Page not found · ${site.name}`
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, follow" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="The page you were looking for does not exist." />
    <link rel="icon" href="/favicon.ico" type="image/x-icon" />
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        background: #ffffff;
        color: #1c2128;
      }
      @media (prefers-color-scheme: dark) {
        body { background: #0d1117; color: #e6edf3; }
        a { color: #79b8ff; }
      }
      .notfound { text-align: center; padding: 32px; max-width: 44ch; }
      .notfound-code {
        font-size: 64px;
        font-weight: 800;
        letter-spacing: -0.02em;
        margin: 0 0 8px;
        color: #4c1d95;
      }
      @media (prefers-color-scheme: dark) { .notfound-code { color: #a78bfa; } }
      .notfound h1 { font-size: 24px; margin: 0 0 10px; }
      .notfound p { margin: 0 0 18px; line-height: 1.6; color: #6b7686; }
      @media (prefers-color-scheme: dark) { .notfound p { color: #8b949e; } }
      .notfound a {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: #4338ca;
        font-weight: 600;
        text-decoration: none;
        border: 1px solid #d7dbe2;
        border-radius: 8px;
        padding: 8px 14px;
      }
      .notfound a:hover { border-color: #c2c8d1; }
      @media (prefers-color-scheme: dark) {
        .notfound a { border-color: #30363d; }
        .notfound a:hover { border-color: #3d444d; }
      }
    </style>
  </head>
  <body>
    <main class="notfound">
      <p class="notfound-code">404</p>
      <h1>Page not found</h1>
      <p>The page you were looking for does not exist or has moved.</p>
      <a href="/">Back to the ${escapeHtml(site.name)} home page</a>
    </main>
  </body>
</html>
`
  await fs.writeFile(path.join(DIST, '404.html'), html, 'utf8')
}

async function copyPublic() {
  await mkdirs(DIST)
  for (const entry of await fs.readdir(PUBLIC, { withFileTypes: true })) {
    const from = path.join(PUBLIC, entry.name)
    const to = path.join(DIST, entry.name)
    if (entry.isDirectory()) {
      await fs.cp(from, to, { recursive: true })
    } else {
      await fs.copyFile(from, to)
    }
  }
}

// Guchho (v1.0.6, all platforms) drops the final path separator when writing
// nested HTML entries: "guide/x/index.html" lands at "guide/xindex.html", and
// its relative asset URLs are computed for that shallower path. Repair each
// page by moving it to the intended path and prefixing relative URLs with one
// "../" (exactly the level that was lost). No-op once guchho is fixed.
function deepen(html) {
  return html.replace(
    /(\s(?:href|src)=)("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (match, attr, _all, dq, sq, uq) => {
      const url = dq ?? sq ?? uq
      if (url === undefined || url === '') return match
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(url)) return match
      const quote = dq !== undefined ? '"' : sq !== undefined ? "'" : ''
      return `${attr}${quote}../${url}${quote}`
    },
  )
}

async function repairOutputPaths(pages) {
  let repaired = 0
  for (const page of pages) {
    const intended = routeToFile(page.route) // e.g. "guide/getting-started/index.html"
    if (!intended.includes('/')) continue
    const mangled = intended.replace(/^(.*)\/([^/]*)$/, '$1$2')
    if (mangled === intended) continue
    const src = path.join(DIST, mangled.split('/').join(path.sep))
    const dest = path.join(DIST, intended.split('/').join(path.sep))
    if (src === dest || !(await exists(src))) continue
    const html = deepen(await fs.readFile(src, 'utf8'))
    await mkdirs(path.dirname(dest))
    await fs.writeFile(dest, html, 'utf8')
    await fs.rm(src, { force: true })
    repaired++
  }
  if (repaired) console.log(`paths: repaired ${repaired} nested page output(s)`)
}

// Verify every route has a real file in dist/ and that no templating tokens or
// broken asset references leaked into the output. Hard-fails in CI so a bad
// guchho build can never be deployed silently.
async function verifyOutput(pages) {
  const missing = []
  for (const page of pages) {
    const file = path.join(DIST, routeToFile(page.route).split('/').join(path.sep))
    if (!(await exists(file))) missing.push(`${page.route} -> ${path.relative(ROOT, file)}`)
  }

  let templateTokens = 0
  let badAssetRefs = 0
  let missingTitle = 0
  const distFiles = await collectFiles(DIST)
  for (const rel of distFiles) {
    if (!rel.endsWith('.html')) continue
    const text = await fs.readFile(path.join(DIST, rel.split('/').join(path.sep)), 'utf8')
    if (/\{\{[^}]{2,}\}\}/.test(text)) templateTokens++
    if (!/<title[^>]*>[^<]/i.test(text)) missingTitle++
    // Ignore markup inside code samples (they can contain literal src/href).
    const scan = text.replace(/<pre[\s\S]*?<\/pre>/gi, '').replace(/<code[\s\S]*?<\/code>/gi, '')
    for (const m of scan.matchAll(/(?:href|src)="([^"]*)"/g)) {
      const ref = m[1]
      if (!ref || ref.startsWith('#') || ref.startsWith('//')) continue
      if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) continue // absolute URL or scheme
      if (ref.startsWith('/')) {
        if (path.extname(ref) && !(await exists(path.join(DIST, ref.split('/').join(path.sep))))) badAssetRefs++
        continue
      }
      if (!ref.includes('..') && !ref.includes('/')) continue
      const target = path.resolve(path.dirname(path.join(DIST, rel.split('/').join(path.sep))), ref)
      if (!(await exists(target))) badAssetRefs++
    }
  }

  const problems = []
  if (missing.length) problems.push(`${missing.length} expected page(s) missing:\n    - ${missing.join('\n    - ')}`)
  if (templateTokens) problems.push(`${templateTokens} unresolved {{…}} token(s) in dist/`)
  if (missingTitle) problems.push(`${missingTitle} page(s) without a <title> in dist/`)
  if (badAssetRefs) problems.push(`${badAssetRefs} unreachable asset reference(s) in dist/`)

  if (!problems.length) {
    console.log(`output: ok (${pages.length} pages)`)
    return
  }

  const report = problems.join('\n')
  if (process.env.CI) {
    throw new Error(`dist/ verification failed:\n${report}`)
  }
  console.warn(`\nWARNING: ${report}\n`)
}

async function collectFiles(dir) {
  const results = []
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) results.push(path.relative(dir, full).split(path.sep).join('/'))
    }
  }
  if (await exists(dir)) await walk(dir)
  return results
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})