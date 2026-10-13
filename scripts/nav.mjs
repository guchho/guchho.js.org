// Builds the sidebar navigation from site.config.mjs plus the actual pages
// found in the docs tree, so a new doc that bumps a directory shows up without
// a hand-edited link.

function pageTitle(page) {
  return page.title || page.file.replace(/\.md$/, '').split('/').pop() || 'Docs'
}

function sortFiles(files) {
  return files.sort((a, b) => {
    const aIndex = a.endsWith('README.md') ? 0 : 1
    const bIndex = b.endsWith('README.md') ? 0 : 1
    if (aIndex !== bIndex) return aIndex - bIndex
    return a.localeCompare(b)
  })
}

function renderGroup(group, pages, routeMap) {
  const parts = []
  parts.push(`<li class="nav-group">`)
  parts.push(`<p class="nav-group-title">${escapeHtml(group.title)}</p>`)
  parts.push(`<ul class="nav-group-list">`)

  if (group.links) {
    for (const link of group.links) {
      parts.push(renderLink(link.href, link.label))
    }
  }

  if (group.autodir) {
    const prefix = group.autodir + '/'
    const candidates = sortFiles(pages.map((p) => p.file).filter((f) => f.startsWith(prefix)))
    for (const file of candidates) {
      const route = routeMap.get(file) || '#'
      const page = pages.find((p) => p.file === file)
      parts.push(renderLink(route, pageTitle(page || { file })))
    }
  }

  parts.push(`</ul>`)
  parts.push(`</li>`)
  return parts.join('')
}

function renderLink(href, label) {
  const route = href && href.startsWith('/') ? href : null
  const data = route ? ` data-route="${escapeHtml(route)}"` : ''
  return `<li><a href="${escapeHtml(href)}"${data}>${escapeHtml(label)}</a></li>`
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderSidebar(siteConfig, pages, routeMap) {
  const groups = (siteConfig.nav || []).map((group) => renderGroup(group, pages, routeMap))
  return groups.join('\n')
}