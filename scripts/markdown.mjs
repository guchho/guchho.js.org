// The Markdown rendering pipeline. Content is plain GitHub-flavoured Markdown
// with YAML frontmatter; this turns one file into an HTML fragment plus a table
// of contents, rewriting relative ".md" links into site routes.
//
// Rendered at build time only. The shipped site ships only the produced HTML,
// highlight.js output and a few KB of vanilla JS.

import MarkdownIt from 'markdown-it'
import anchor from 'markdown-it-anchor'
import hljs from 'highlight.js'
import matter from 'gray-matter'

function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

const FENCE_LANGS = new Set([
  'bash', 'sh', 'shell', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'json', 'jsonc',
  'html', 'xml', 'css', 'scss', 'text', 'txt', 'cpp', 'c', 'cmake', 'diff', 'md',
])

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function highlight(code, lang) {
  // Returns the inner highlighted text only; markdown-it (and our fence rule)
  // supply the outer <pre><code> wrapper.
  let html
  const name = lang && lang.toLowerCase()
  try {
    const use = name && FENCE_LANGS.has(name)
    html = use
      ? hljs.highlight(code, { language: name, ignoreIllegals: true }).value
      : hljs.highlightAuto(code).value
  } catch {
    html = escapeHtml(code)
  }
  return html
}

export function parseFrontmatter(md) {
  try {
    const { data, content } = matter(md)
    return {
      title: typeof data.title === 'string' ? data.title : '',
      description: typeof data.description === 'string' ? data.description : '',
      content,
    }
  } catch {
    // The upstream docs occasionally contain frontmatter that is not strict
    // YAML (e.g. an unquoted colon in a description). Fall back to a tolerant
    // line scan for the two keys the docs actually use.
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md)
    const fm = match ? match[1] : ''
    const front = {}
    for (const line of fm.split(/\r?\n/)) {
      const kv = /^([A-Za-z][\w-]*):\s*(.*?)\s*$/.exec(line)
      if (kv) front[kv[1].toLowerCase()] = kv[2].replace(/^['"]|['"]$/g, '')
    }
    const content = match ? md.slice(match[0].length) : md
    return {
      title: front.title || '',
      description: front.description || '',
      content,
    }
  }
}

// Resolve a relative reference against a source file and look the target's
// route up in the file->route map. Returns the rewritten href or null to keep
// the original.
function rewriteHref(href, sourceRel, routeMap) {
  if (!href) return href
  if (/^(?:[a-z]+:)?\/\//i.test(href)) return href
  if (href.startsWith('#')) return href
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href

  const hashIndex = href.indexOf('#')
  const target = hashIndex === -1 ? href : href.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : href.slice(hashIndex)
  if (!target) return href
  if (/\.(?:png|jpe?g|gif|svg|webp|ico|woff2?)$/i.test(target)) return href

  if (!target.endsWith('.md')) return href

  const base = sourceRel.slice(0, sourceRel.lastIndexOf('/') + 1) || ''
  const resolved = normalizePosix(base + target)
  if (!resolved) return href

  const route = routeMap.get(resolved)
  return route ? route + hash : href
}

function normalizePosix(s) {
  const parts = s.split('/')
  const out = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.join('/')
}

function collectToc(tokens) {
  const toc = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.type !== 'heading_open') continue
    const level = token.tag === 'h2' ? 2 : token.tag === 'h3' ? 3 : 0
    if (!level) continue
    const id = token.attrs?.find((a) => a[0] === 'id')?.[1]
    const next = tokens[i + 1]
    const text = next && next.type === 'inline' ? next.content.trim() : ''
    toc.push({ level, id, text })
  }
  return toc.filter((t) => t.id && t.text)
}

export function createRenderer() {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    breaks: false,
    highlight,
  })

  md.use(anchor, {
    level: [1, 2, 3, 4, 5, 6],
    slugify,
    permalink: anchor.permalink.linkAfterHeader({
      symbol: '#',
      style: 'aria-label',
      assistiveText: (title) => `Section "${title}"`,
      class: 'heading-anchor',
    }),
  })

  const defaultLinkOpen =
    md.renderer.rules.link_open ||
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const hrefIndex = token.attrIndex('href')
    if (hrefIndex >= 0) {
      token.attrs[hrefIndex][1] = rewriteHref(token.attrs[hrefIndex][1], env.sourceRel, env.routeMap)
    }
    return defaultLinkOpen(tokens, idx, options, env, self)
  }

  const defaultImage =
    md.renderer.rules.image ||
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const srcIndex = token.attrIndex('src')
    if (srcIndex >= 0) {
      token.attrs[srcIndex][1] = rewriteHref(token.attrs[srcIndex][1], env.sourceRel, env.routeMap)
    }
    return defaultImage(tokens, idx, options, env, self)
  }

  // <div class="codeblock"> wrapper around fenced code, so the copy button and
  // dark block background have a hook.
  md.renderer.rules.fence = (tokens, idx, options, _env, self) => {
    const token = tokens[idx]
    const info = token.info ? token.info.trim() : ''
    const langName = info ? info.split(/\s+/g)[0] : ''
    const code = token.content
    const highlighted = options.highlight
      ? options.highlight(code, langName)
      : escapeHtml(code)
    const langClass = langName ? ` language-${escapeHtml(langName)}` : ''
    return `<div class="codeblock"><pre><code class="hljs${langClass}">${highlighted}</code></pre></div>`
  }

  // Render one source file. Returns { html, toc, anchors, hasH1 } where anchors
  // is the set of heading ids on the page (for link validation).
  return function render(sourceRel, source, routeMap) {
    const env = { sourceRel, routeMap }
    const tokens = md.parse(source, env)
    const hasH1 = tokens.some((t) => t.type === 'heading_open' && t.tag === 'h1')
    const html = md.renderer.render(tokens, md.options, env)
    const toc = collectToc(tokens)
    const anchors = new Set()
    for (const token of tokens) {
      if (token.type === 'heading_open') {
        const id = token.attrs?.find((a) => a[0] === 'id')?.[1]
        if (id) anchors.add(id)
      }
    }
    return { html, toc, anchors, hasH1 }
  }
}