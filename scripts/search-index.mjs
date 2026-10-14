// Build the client-side search index from the rendered pages.
//
// Each page becomes an entry with its title, description and a list of
// sections split at headings (h1-h4). Each section keeps its anchor id so a
// result can deep-link straight to the matching heading. This runs at build
// time only; the browser gets a single JSON file and a small vanilla-JS
// matcher in main.js.

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
  '#x27': "'",
}

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z#0-9]+);/gi, (m, name) => (name in ENTITIES ? ENTITIES[name] : m))
}

// Turn an HTML fragment into searchable plain text: drop code samples, the
// heading permalinks and the "Edit this page" note, then strip tags.
function toText(html) {
  let s = html
  s = s.replace(/<div class="codeblock">[\s\S]*?<\/div>/g, ' ')
  s = s.replace(/<p class="doc-source">[\s\S]*?<\/p>/g, ' ')
  s = s.replace(/<a class="heading-anchor"[\s\S]*?<\/a>/g, ' ')
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  s = s.replace(/<[^>]+>/g, ' ')
  s = decodeEntities(s)
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

const MAX_SECTION_CHARS = 1600

// Split one page's body HTML into sections at heading boundaries.
function extractSections(html) {
  const headingRe = /<h([1-4])\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g
  const marks = []
  let m
  while ((m = headingRe.exec(html)) !== null) {
    marks.push({
      index: m.index,
      end: m.index + m[0].length,
      id: m[2],
      heading: toText(m[3]),
    })
  }

  const sections = []
  // Content before the first heading (e.g. a lede) attaches to the first
  // section so nothing is dropped.
  for (let i = 0; i < marks.length; i++) {
    const start = i === 0 ? 0 : marks[i].index
    const bodyStart = marks[i].end
    const bodyEnd = i + 1 < marks.length ? marks[i + 1].index : html.length
    const text = toText(html.slice(bodyStart, bodyEnd)).slice(0, MAX_SECTION_CHARS)
    if (!marks[i].heading && !text) continue
    sections.push({ id: marks[i].id, heading: marks[i].heading, text })
  }
  return sections
}

export function buildSearchIndex(pages) {
  const out = []
  for (const page of pages) {
    if (!page.route) continue
    const sections = extractSections(page.html || '')
    out.push({
      route: page.route,
      title: page.title || '',
      description: page.description || '',
      sections,
    })
  }
  out.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
  return { version: 1, pages: out }
}
