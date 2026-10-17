// Editor: a plain <textarea> with a syntax-highlighted overlay <pre><code>
// behind it (highlight.js) and a line-number gutter. No Monaco or CodeMirror
// dependency. The textarea stays the single source of truth for value,
// selection and undo.
//
// The highlight.js grammar modules must be imported statically: guchho's
// bundler mishandles dynamic `import()` of these CJS modules (the module-level
// keyword arrays are emitted without their assignments, so the grammar throws
// "is not iterable" at registration time).

import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import json from 'highlight.js/lib/languages/json'

let registered = false

function loadHljs() {
  try {
    if (!registered) {
      hljs.registerLanguage('javascript', javascript)
      hljs.registerLanguage('typescript', typescript)
      hljs.registerLanguage('css', css)
      hljs.registerLanguage('xml', xml)
      hljs.registerLanguage('json', json)
      registered = true
    }
    return hljs
  } catch {
    return null
  }
}

export function createEditor({ textarea, highlight, gutter, language }) {
  const code = highlight ? highlight.querySelector('code') : null
  const highlighter = loadHljs()
  let lang = language || 'plaintext'

  function paint() {
    const value = textarea.value
    if (code) {
      if (highlighter && lang !== 'plaintext') {
        try {
          const result = highlighter.highlight(value, { language: lang, ignoreIllegals: true })
          code.innerHTML = result.value + '\n'
        } catch {
          code.textContent = value + '\n'
        }
      } else {
        code.textContent = value + '\n'
      }
    }
    paintGutter(value)
  }

  function paintGutter(value) {
    if (!gutter) return
    const count = value.split('\n').length
    let out = ''
    for (let i = 1; i <= count; i++) out += i + '\n'
    gutter.textContent = out
  }

  function syncScroll() {
    if (highlight) {
      highlight.scrollTop = textarea.scrollTop
      highlight.scrollLeft = textarea.scrollLeft
    }
    if (gutter) gutter.scrollTop = textarea.scrollTop
  }

  textarea.addEventListener('input', paint)
  textarea.addEventListener('scroll', syncScroll)
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
      const { selectionStart: s, selectionEnd: e } = textarea
      textarea.setRangeText('  ', s, e, 'end')
      paint()
    }
  })

  paint()

  return {
    get value() {
      return textarea.value
    },
    set value(v) {
      textarea.value = v
      textarea.scrollTop = 0
      paint()
      syncScroll()
    },
    focus() {
      textarea.focus()
    },
    refresh: paint,
    setLanguage(next) {
      lang = next || 'plaintext'
      paint()
    },
  }
}
