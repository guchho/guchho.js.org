(() => {
  'use strict'

  const root = document.documentElement

  function currentTheme() {
    const stored = localStorage.getItem('guchho-docs-theme')
    if (stored === 'light' || stored === 'dark') return stored
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  function applyTheme(theme) {
    root.dataset.theme = theme
    document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
      b.setAttribute('aria-pressed', String(theme === 'dark'))
    })
  }

  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark'
    localStorage.setItem('guchho-docs-theme', next)
    applyTheme(next)
  }

  // Sidebar (mobile) open/close.
  const sidebar = document.getElementById('sidebar')

  function setSidebar(open) {
    if (!sidebar) return
    sidebar.classList.toggle('is-open', open)
    const btn = document.querySelector('[data-toggle-sidebar]')
    if (btn) btn.setAttribute('aria-expanded', String(open))
  }

  function bindSidebar() {
    document.querySelectorAll('[data-toggle-sidebar]').forEach((btn) => {
      btn.addEventListener('click', () => setSidebar(!sidebar.classList.contains('is-open')))
    })
    document.querySelectorAll('[data-close-sidebar]').forEach((el) => {
      el.addEventListener('click', () => setSidebar(false))
    })
    const links = sidebar ? sidebar.querySelectorAll('a') : []
    links.forEach((a) => a.addEventListener('click', () => setSidebar(false)))
  }

  // Active sidebar link for the current route.
  function markActiveLink() {
    const href = location.pathname
    if (!sidebar) return
    sidebar.querySelectorAll('a').forEach((a) => {
      const target = a.getAttribute('data-route')
      if (target && target === href) {
        a.classList.add('is-active')
        const group = a.closest('ul')
        if (group) group.classList.add('is-open')
      }
    })
  }

  // Expand the group that contains the active link.
  function expandActiveGroup() {
    if (!sidebar) return
    const active = sidebar.querySelector('a.is-active')
    if (!active) return
    let el = active.parentElement
    while (el && el !== sidebar) {
      if (el.classList && el.classList.contains('nav-group-list')) {
        el.classList.add('is-open')
      }
      el = el.parentElement
    }
  }

  // Copy button on every code block.
  function addCopyButtons() {
    document.querySelectorAll('div.codeblock').forEach((block) => {
      if (block.querySelector('.copy-button')) return
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'copy-button'
      button.setAttribute('aria-label', 'Copy code to clipboard')
      button.textContent = 'Copy'
      button.addEventListener('click', async () => {
        const pre = block.querySelector('pre')
        if (!pre) return
        const text = pre.textContent ?? ''
        try {
          await navigator.clipboard.writeText(text)
          button.textContent = 'Copied'
        } catch {
          button.textContent = 'Select manually'
        }
        setTimeout(() => {
          button.textContent = 'Copy'
        }, 1500)
      })
      block.appendChild(button)
    })
  }

  // Header documentation search.
  function initSearch() {
    const root = document.querySelector('.header-search')
    if (!root) return
    const indexUrl = root.dataset.searchIndex
    const toggle = root.querySelector('[data-search-open]')
    const panel = root.querySelector('.search-panel')
    const input = root.querySelector('[data-search-input]')
    const listEl = root.querySelector('[data-search-results]')
    const statusEl = root.querySelector('[data-search-status]')
    const hintEl = root.querySelector('[data-search-hint]')
    const backdrop = document.querySelector('[data-search-backdrop]')
    if (!toggle || !panel || !input || !listEl) return

    let indexPromise = null
    let items = null
    let results = []
    let active = -1
    let open = false

    const escapeHtml = (s) =>
      String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')

    function loadIndex() {
      if (!indexPromise) {
        indexPromise = fetch(indexUrl)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad status'))))
          .then((data) => {
            items = []
            for (const page of data.pages || []) {
              const sections = page.sections && page.sections.length ? page.sections : [{ id: '', heading: '', text: page.description || '' }]
              for (const section of sections) {
                items.push({
                  route: page.route,
                  pageTitle: page.title || '',
                  id: section.id || '',
                  heading: section.heading || '',
                  text: section.text || '',
                })
              }
            }
            return items
          })
      }
      return indexPromise
    }

    function isTypingTarget(el) {
      if (!el) return false
      const tag = el.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
    }

    function setOpen(next) {
      open = next
      panel.hidden = !next
      toggle.setAttribute('aria-expanded', String(next))
      input.setAttribute('aria-expanded', String(next))
      if (backdrop) backdrop.hidden = !next
      document.body.classList.toggle('search-open', next)
      if (next) {
        loadIndex().then(() => {
          if (open && input.value.trim()) runSearch(input.value)
        }).catch(() => {
          statusEl.textContent = 'Search is unavailable right now.'
        })
        input.focus()
        input.select()
      } else {
        active = -1
      }
    }

    function snippet(text, tokens) {
      const lower = text.toLowerCase()
      let at = -1
      for (const t of tokens) {
        const i = lower.indexOf(t)
        if (i !== -1 && (at === -1 || i < at)) at = i
      }
      if (at === -1) at = 0
      const start = Math.max(0, at - 40)
      const end = Math.min(text.length, at + 110)
      let s = text.slice(start, end)
      if (start > 0) s = '…' + s
      if (end < text.length) s = s + '…'
      return s
    }

    function highlight(text, tokens) {
      let html = escapeHtml(text)
      for (const t of [...tokens].sort((a, b) => b.length - a.length)) {
        if (!t) continue
        const re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig')
        html = html.replace(re, '<mark>$1</mark>')
      }
      return html
    }

    function runSearch(query) {
      const q = query.trim().toLowerCase()
      if (!q) {
        results = []
        active = -1
        render('')
        return
      }
      if (!items) return
      const tokens = q.split(/\s+/).filter(Boolean)
      const scored = []
      for (const item of items) {
        const title = item.pageTitle.toLowerCase()
        const heading = item.heading.toLowerCase()
        const text = item.text.toLowerCase()
        let score = 0
        let ok = true
        for (const t of tokens) {
          const inTitle = title.includes(t)
          const inHeading = heading.includes(t)
          const inText = text.includes(t)
          if (!inTitle && !inHeading && !inText) {
            ok = false
            break
          }
          if (inTitle) score += 6
          if (inHeading) score += 4
          if (inText) score += 1
          if (title.startsWith(t) || heading.startsWith(t)) score += 3
        }
        if (ok) scored.push({ item, score })
      }
      scored.sort((a, b) => b.score - a.score)
      results = scored.slice(0, 12).map((s) => s.item)
      active = results.length ? 0 : -1
      render(q, tokens)
    }

    function render(query, tokens = []) {
      listEl.innerHTML = ''
      if (!query) {
        statusEl.textContent = ''
        if (hintEl) hintEl.hidden = false
        input.removeAttribute('aria-activedescendant')
        return
      }
      if (!results.length) {
        statusEl.textContent = 'No results for “' + query + '”'
        if (hintEl) hintEl.hidden = true
        return
      }
      statusEl.textContent = results.length + (results.length === 1 ? ' result' : ' results')
      if (hintEl) hintEl.hidden = false
      results.forEach((item, i) => {
        const li = document.createElement('li')
        li.className = 'search-result' + (i === active ? ' is-active' : '')
        li.id = 'search-result-' + i
        li.setAttribute('role', 'option')
        li.setAttribute('aria-selected', String(i === active))
        const crumb = escapeHtml(item.pageTitle) + (item.heading ? ' · ' + escapeHtml(item.heading) : '')
        const body = snippet(item.text, tokens)
        li.innerHTML =
          '<span class="search-result-main">' +
          '<span class="search-result-crumb">' + crumb + '</span>' +
          (body ? '<span class="search-result-text">' + highlight(body, tokens) + '</span>' : '') +
          '</span>' +
          '<span class="search-result-arrow" aria-hidden="true">' +
          '<svg viewBox="0 0 12 12" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h8"/><path d="M6.8 2.8 10 6l-3.2 3.2"/></svg>' +
          '</span>'
        li.addEventListener('mousemove', () => setActive(i))
        li.addEventListener('click', () => go(i))
        listEl.appendChild(li)
      })
      updateActiveDescendant()
    }

    function setActive(i) {
      if (i === active || !results.length) return
      active = i
      listEl.querySelectorAll('.search-result').forEach((el, idx) => {
        const on = idx === active
        el.classList.toggle('is-active', on)
        el.setAttribute('aria-selected', String(on))
      })
      updateActiveDescendant()
    }

    function updateActiveDescendant() {
      if (active >= 0) input.setAttribute('aria-activedescendant', 'search-result-' + active)
      else input.removeAttribute('aria-activedescendant')
    }

    function move(delta) {
      if (!results.length) return
      active = (active + delta + results.length) % results.length
      setActive(active)
      const el = document.getElementById('search-result-' + active)
      if (el) el.scrollIntoView({ block: 'nearest' })
    }

    function go(i) {
      const item = results[i]
      if (!item) return
      const dest = item.route + (item.id ? '#' + item.id : '')
      window.location.assign(dest)
    }

    let debounce
    input.addEventListener('input', () => {
      clearTimeout(debounce)
      const v = input.value
      debounce = setTimeout(() => runSearch(v), 110)
    })

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
      else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0) go(active) }
      else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); toggle.focus() }
    })

    toggle.addEventListener('click', () => setOpen(!open))
    const closeBtn = root.querySelector('[data-search-close]')
    if (closeBtn) closeBtn.addEventListener('click', () => { setOpen(false); toggle.focus() })
    if (backdrop) backdrop.addEventListener('click', () => setOpen(false))

    document.addEventListener('click', (e) => {
      if (open && !root.contains(e.target)) setOpen(false)
    })

    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setOpen(true)
        return
      }
      if (e.key === '/' && !isTypingTarget(e.target) && !mod && !e.altKey) {
        e.preventDefault()
        setOpen(true)
      }
    })
  }

  // Scroll-spy for the table of contents.
  function bindScrollSpy() {
    const toc = document.getElementById('toc')
    if (!toc) return
    const tocLinks = toc.querySelectorAll('a[data-target]')
    if (!tocLinks.length) return
    const headings = [...tocLinks].map((a) => document.getElementById(a.dataset.target)) .filter(Boolean)
    if (!headings.length) return

    const update = () => {
      const offset = 90
      let current = headings[0]
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= offset) current = h
      }
      tocLinks.forEach((a) => {
        a.classList.toggle('is-active', a.dataset.target === current.id)
      })
    }
    window.addEventListener('scroll', update, { passive: true })
    update()
  }

  // Scroll progress bar in the header.
  function bindScrollProgress() {
    const bar = document.querySelector('[data-scroll-progress]')
    if (!bar) return
    let ticking = false
    const update = () => {
      ticking = false
      const doc = document.documentElement
      const max = doc.scrollHeight - doc.clientHeight
      const ratio = max > 0 ? Math.min(1, Math.max(0, doc.scrollTop / max)) : 0
      bar.style.width = (ratio * 100).toFixed(2) + '%'
    }
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(update)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    update()
  }

  // Interactive "command run" terminal on the home page: build / dev / serve / init.
  function bindTerminal() {
    const term = document.querySelector('[data-terminal]')
    if (!term) return
    const cmdEl = term.querySelector('[data-terminal-cmd]')
    const outEl = term.querySelector('[data-terminal-output]')
    const tabs = [...term.querySelectorAll('[data-terminal-tab]')]
    if (!cmdEl || !outEl || !tabs.length) return

    const blocks = tabs.map((tab) => {
      const name = tab.dataset.terminalTab
      const el = outEl.querySelector('[data-terminal-scenario="' + name + '"]')
      return el
        ? { name, el, cmd: el.dataset.cmd || '', lines: [...el.querySelectorAll('.terminal-line')] }
        : null
    })
    const scenarios = blocks.filter(Boolean)
    if (!scenarios.length) return

    const copyBtn = term.querySelector('[data-terminal-copy]')
    const copyLabel = term.querySelector('[data-terminal-copy-label]')
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    let visible = true
    let runId = 0
    let index = 0
    let currentCmd = scenarios[0].cmd

    term.classList.add('is-animating')

    function setActiveTab(i) {
      tabs.forEach((tab, j) => {
        const on = j === i
        tab.classList.toggle('is-active', on)
        tab.setAttribute('aria-selected', String(on))
        tab.tabIndex = on ? 0 : -1
      })
    }

    function showFinal(i) {
      index = i
      const s = scenarios[i]
      currentCmd = s.cmd
      setActiveTab(i)
      cmdEl.textContent = s.cmd
      term.classList.add('is-done')
      for (const other of scenarios) other.el.hidden = other !== s
      s.lines.forEach((l) => l.classList.add('is-visible'))
    }

    async function play(i, id) {
      index = i
      const s = scenarios[i]
      currentCmd = s.cmd
      setActiveTab(i)
      cmdEl.textContent = ''
      term.classList.remove('is-done')
      for (const other of scenarios) {
        other.el.hidden = other !== s
        other.lines.forEach((l) => l.classList.remove('is-visible'))
      }
      await sleep(350)
      if (id !== runId || !visible) return
      for (let k = 0; k < s.cmd.length; k++) {
        if (id !== runId || !visible) return
        cmdEl.textContent += s.cmd[k]
        await sleep(s.cmd[k] === ' ' ? 15 : 24)
      }
      await sleep(300)
      if (id !== runId || !visible) return
      for (const line of s.lines) {
        if (id !== runId || !visible) return
        line.classList.add('is-visible')
        await sleep(120)
      }
      term.classList.add('is-done')
    }

    async function loop() {
      while (true) {
        if (!visible) {
          await sleep(500)
          continue
        }
        const id = ++runId
        await play(index, id)
        if (id !== runId || !visible) continue
        await sleep(3000)
        if (id !== runId || !visible) continue
        index = (index + 1) % scenarios.length
      }
    }

    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => {
        const scenario = scenarios.find((s) => s.name === tab.dataset.terminalTab)
        if (!scenario) return
        const target = scenarios.indexOf(scenario)
        if (target === index && term.classList.contains('is-done')) return
        index = target
        runId++
      })
      tab.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
        e.preventDefault()
        const dir = e.key === 'ArrowRight' ? 1 : -1
        const next = tabs[(i + dir + tabs.length) % tabs.length]
        next.focus()
        next.click()
      })
    })

    if (copyBtn && navigator.clipboard) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(currentCmd)
          if (copyLabel) {
            copyLabel.textContent = 'Copied'
            setTimeout(() => (copyLabel.textContent = 'Copy'), 1500)
          }
        } catch {
          /* clipboard unavailable */
        }
      })
    }

    if (reduceMotion) {
      showFinal(0)
      return
    }

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) visible = entry.isIntersecting
        },
        { threshold: 0.25 },
      )
      io.observe(term)
    }
    document.addEventListener('visibilitychange', () => {
      visible = !document.hidden
    })

    loop()
  }

  function init() {
    applyTheme(currentTheme())
    document.querySelectorAll('[data-theme-toggle]').forEach((b) => b.addEventListener('click', toggleTheme))
    bindSidebar()
    markActiveLink()
    expandActiveGroup()
    addCopyButtons()
    bindScrollSpy()
    bindScrollProgress()
    bindTerminal()
    initSearch()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()