// Build-time internal-link validation. Walk every generated page, resolve its
// internal hrefs, and fail on links that point at a route or anchor that does
// not exist.

export function stripHash(href) {
  return href.indexOf('#') === -1 ? href : href.slice(0, href.indexOf('#'))
}
export function hashPart(href) {
  return href.indexOf('#') === -1 ? '' : href.slice(href.indexOf('#'))
}

function normalizeRoute(r) {
  if (r && !r.startsWith('/')) return '/' + r
  return r
}

// Resolve a possibly-relative href against a page route ("/a/b/").
function resolveFrom(route, href) {
  if (href.startsWith('/')) {
    return normalizeRoute(stripHash(href))
  }
  const segments = route.split('/').filter(Boolean)
  const parts = stripHash(href).split('/')
  const out = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length) out.pop()
      else segments.pop()
      continue
    }
    out.push(part)
  }
  return '/' + [...segments, ...out].join('/')
}

export function isExternal(href) {
  return /^(?:[a-z]+:)?\/\//i.test(href) || href.startsWith('mailto:') || href.startsWith('tel:')
}

export function collectProblems(page, knownRoutes, knownFiles) {
  const problems = []
  const hrefRe = /<a\b[^>]*\bhref="([^"]*)"[^>]*>/gi
  let m
  while ((m = hrefRe.exec(page.html)) !== null) {
    const href = m[1]
    if (!href || isExternal(href)) continue
    const target = stripHash(href)
    const hash = hashPart(href)
    if (!target) {
      if (hash) {
        const id = decodeURIComponent(hash.slice(1))
        if (page.anchors && !page.anchors.has(id)) {
          problems.push(`${page.route} -> "#${id}" has no matching heading`)
        }
      }
      continue
    }
    if (knownFiles.has(target)) continue
    if (!target.startsWith('/') && /^[a-z][a-z0-9+.-]*:/i.test(target)) continue

    const route = normalizeRoute(resolveFrom(page.route, target))
    if (route) {
      const base = route.replace(/\/$/, '') + '/'
      const exists =
        knownRoutes.has(route) ||
        knownRoutes.has(base) ||
        knownRoutes.has(route + 'index.html')
      if (!exists) {
        problems.push(`${page.route} -> "${href}" points at a page that does not exist`)
        continue
      }
      if (hash) {
        const id = decodeURIComponent(hash.slice(1))
        const found = [...knownRoutes].some((r) => {
          if (r !== base && r !== route) return false
          const targetPage = globalThis.__anchors?.get(r)
          return targetPage && targetPage.has(id)
        })
        if (!found) {
          problems.push(`${page.route} -> "${href}" anchor "#${id}" not found on target page`)
        }
      }
    }
  }
  return problems
}

export function validateAll(pages, knownRoutes, knownFiles, anchorsByRoute) {
  globalThis.__anchors = anchorsByRoute
  const problems = []
  for (const page of pages) {
    problems.push(...collectProblems(page, knownRoutes, knownFiles))
  }
  delete globalThis.__anchors
  return problems
}