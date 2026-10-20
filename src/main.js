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
    document.body.classList.toggle('sidebar-open', open)
    document.body.classList.toggle('no-scroll', open)
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

  const COPY_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-1a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4.5V9A1.5 1.5 0 0 0 4 10.5h1.5"/></svg>'
  const CHECK_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5"/></svg>'

  // Copy button on every code block.
  function addCopyButtons() {
    document.querySelectorAll('div.codeblock').forEach((block) => {
      if (block.querySelector('.copy-button')) return
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'copy-button'
      button.setAttribute('aria-label', 'Copy code to clipboard')
      button.innerHTML = `${COPY_ICON}<span>Copy</span>`
      button.addEventListener('click', async () => {
        const pre = block.querySelector('pre')
        if (!pre) return
        const text = pre.textContent ?? ''
        try {
          await navigator.clipboard.writeText(text)
          button.innerHTML = `${CHECK_ICON}<span>Copied</span>`
        } catch {
          button.innerHTML = `${COPY_ICON}<span>Select manually</span>`
        }
        setTimeout(() => {
          button.innerHTML = `${COPY_ICON}<span>Copy</span>`
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

    // Open the search panel for ?q=… (used by the SearchAction sitelink).
    const initialQuery = new URLSearchParams(window.location.search).get('q')
    if (initialQuery) {
      input.value = initialQuery
      setOpen(true)
    }
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
      let activeEl = null
      tocLinks.forEach((a) => {
        const on = a.dataset.target === current.id
        a.classList.toggle('is-active', on)
        if (on) activeEl = a
      })
      if (activeEl) scrollToActive(activeEl)
    }

    function scrollToActive(el) {
      const pad = 12
      const r = el.getBoundingClientRect()
      const c = toc.getBoundingClientRect()
      if (r.top < c.top + pad) {
        toc.scrollTop += r.top - c.top - pad
      } else if (r.bottom > c.bottom - pad) {
        toc.scrollTop += r.bottom - c.bottom + pad
      }
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

  // Auto-playing workflow tour: numbered steps drive a terminal panel.
  function bindTour() {
    const root = document.querySelector('[data-tour]')
    if (!root) return
    const steps = [...root.querySelectorAll('[data-tour-step]')]
    const cmdEl = root.querySelector('[data-tour-cmd]')
    const outEl = root.querySelector('[data-tour-output]')
    const counterEl = root.querySelector('[data-tour-counter]')
    const logoEl = root.querySelector('[data-tour-logo]')
    const panel = root.querySelector('[role="tabpanel"]')
    const prevBtn = root.querySelector('[data-tour-prev]')
    const nextBtn = root.querySelector('[data-tour-next]')
    const replayBtn = root.querySelector('[data-tour-replay]')
    const hoverZone = root.querySelector('[data-tour-hover]')
    if (!steps.length || !cmdEl || !outEl) return

    const scenarios = steps.map((step) => {
      const i = step.dataset.tourStep
      const el = outEl.querySelector('[data-tour-scenario="' + i + '"]')
      return el ? { el, cmd: el.dataset.cmd || '', lines: [...el.querySelectorAll('.terminal-line')] } : null
    })
    if (scenarios.some((s) => !s)) return

    const term = root.querySelector('.tour-terminal')
    if (term) term.classList.add('is-animating')

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const STEP_MS = 5200
    const total = steps.length
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

    let index = 0
    let runId = 0
    let visible = true
    let hovering = false
    let timer = null
    let remaining = STEP_MS
    let startedAt = 0
    let paused = false

    function setActiveStep(i) {
      index = i
      steps.forEach((btn, j) => {
        const on = j === i
        const li = btn.closest('.tour-step')
        if (li) li.classList.toggle('is-active', on)
        btn.setAttribute('aria-selected', String(on))
        btn.setAttribute('aria-expanded', String(on))
        btn.tabIndex = on ? 0 : -1
      })
      scenarios.forEach((s, j) => (s.el.hidden = j !== i))
      if (counterEl) {
        counterEl.textContent = String(i + 1).padStart(2, '0') + ' / ' + String(total).padStart(2, '0')
      }
      if (panel) panel.setAttribute('aria-labelledby', 'tour-tab-' + i)
    }

    function clearProgress() {
      steps.forEach((btn) => {
        const step = btn.closest('.tour-step')
        const bar = step && step.querySelector('.tour-progress')
        if (!bar) return
        bar.classList.remove('is-running')
        bar.style.animationDuration = ''
      })
    }

    function startProgress(id) {
      if (reduceMotion) return
      const step = steps[index].closest('.tour-step')
      const bar = step && step.querySelector('.tour-progress')
      if (!bar) return
      void bar.offsetWidth
      bar.style.animationDuration = remaining + 'ms'
      bar.classList.add('is-running')
      if (paused) bar.style.animationPlayState = 'paused'
    }

    function clearTimer() {
      if (timer) clearTimeout(timer)
      timer = null
    }

    function pause() {
      if (paused) return
      paused = true
      clearTimer()
      remaining = Math.max(400, remaining - (Date.now() - startedAt))
      const step = steps[index] && steps[index].closest('.tour-step')
      const bar = step && step.querySelector('.tour-progress')
      if (bar) bar.style.animationPlayState = 'paused'
    }

    function resume(id) {
      if (!paused) return
      paused = false
      const step = steps[index] && steps[index].closest('.tour-step')
      const bar = step && step.querySelector('.tour-progress')
      if (bar) bar.style.animationPlayState = 'running'
      startedAt = Date.now()
      timer = setTimeout(() => {
        if (id !== runId) return
        goTo((index + 1) % total, { auto: true })
      }, remaining)
    }

    function scheduleNext(id, ms) {
      clearTimer()
      remaining = ms
      startedAt = Date.now()
      if (paused) return
      timer = setTimeout(() => {
        if (id !== runId) return
        goTo((index + 1) % total, { auto: true })
      }, ms)
    }

    function showFinal(i) {
      setActiveStep(i)
      const s = scenarios[i]
      cmdEl.textContent = s.cmd
      clearProgress()
      for (const other of scenarios) other.lines.forEach((l) => l.classList.remove('is-visible'))
      s.lines.forEach((l) => l.classList.add('is-visible'))
    }

    async function play(i, id) {
      setActiveStep(i)
      const s = scenarios[i]
      cmdEl.textContent = ''
      clearProgress()
      for (const other of scenarios) {
        other.lines.forEach((l) => l.classList.remove('is-visible'))
      }
      await sleep(280)
      if (id !== runId) return
      for (let k = 0; k < s.cmd.length; k++) {
        if (id !== runId) return
        cmdEl.textContent += s.cmd[k]
        await sleep(s.cmd[k] === ' ' ? 14 : 22)
      }
      if (id !== runId) return
      startProgress(id)
      scheduleNext(id, remaining)
      await sleep(220)
      for (const line of s.lines) {
        if (id !== runId) return
        line.classList.add('is-visible')
        await sleep(100)
      }
    }

    function goTo(i, opts = {}) {
      if (opts.auto && hovering) return
      runId++
      clearTimer()
      paused = false
      if (logoEl && !reduceMotion) {
        logoEl.classList.remove('is-hopping')
        void logoEl.offsetWidth
        logoEl.classList.add('is-hopping')
      }
      if (reduceMotion) {
        showFinal(i)
        return
      }
      remaining = STEP_MS
      play(i, runId)
    }

    steps.forEach((btn, i) => {
      btn.addEventListener('click', () => goTo(i))
      btn.addEventListener('keydown', (e) => {
        let dir = 0
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') dir = 1
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') dir = -1
        else return
        e.preventDefault()
        const next = steps[(i + dir + total) % total]
        if (next) {
          next.focus()
          next.click()
        }
      })
    })

    if (prevBtn) prevBtn.addEventListener('click', () => goTo((index - 1 + total) % total))
    if (nextBtn) nextBtn.addEventListener('click', () => goTo((index + 1) % total))
    if (replayBtn) replayBtn.addEventListener('click', () => goTo(index))

    if (hoverZone) {
      hoverZone.addEventListener('mouseenter', () => {
        hovering = true
        pause()
      })
      hoverZone.addEventListener('mouseleave', () => {
        hovering = false
        resume(runId)
      })
    }

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) visible = entry.isIntersecting
        },
        { threshold: 0.2 },
      )
      io.observe(root)
    }
    document.addEventListener('visibilitychange', () => {
      visible = !document.hidden
    })

    if (reduceMotion) {
      showFinal(0)
      return
    }

    goTo(0)
  }

  // OS-aware install command tabs + copy buttons in the homepage CTA.
  function bindInstall() {
    const root = document.querySelector('.install-cta')
    if (!root) return
    const panels = root.querySelectorAll('[data-install]')
    const tabs = root.querySelectorAll('[data-install-link]')
    if (!panels.length || !tabs.length) return
    const scriptLink = root.querySelector('.install-script-link')
    const scriptHref = { posix: '/install', windows: '/install.ps1' }

    function select(key) {
      panels.forEach((panel) => {
        panel.hidden = panel.dataset.install !== key
      })
      tabs.forEach((tab) => {
        tab.setAttribute('aria-selected', String(tab.dataset.installLink === key))
      })
      if (scriptLink && scriptHref[key]) scriptLink.setAttribute('href', scriptHref[key])
    }

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => select(tab.dataset.installLink))
    })

    const platform = navigator.userAgentData?.platform || navigator.platform || ''
    if (/win/i.test(platform)) select('windows')

    root.querySelectorAll('.install-copy').forEach((button) => {
      button.addEventListener('click', async () => {
        const panel = button.closest('[data-install]')
        const text = panel?.querySelector('.install-cmd-text')?.textContent ?? ''
        if (!text) return
        try {
          await navigator.clipboard.writeText(text)
        } catch {
          return
        }
        button.classList.add('is-copied')
        button.setAttribute('aria-label', 'Copied')
        setTimeout(() => {
          button.classList.remove('is-copied')
          button.setAttribute('aria-label', 'Copy install command')
        }, 1600)
      })
    })
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
    bindTour()
    bindInstall()
    initSearch()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()