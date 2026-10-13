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

  function init() {
    applyTheme(currentTheme())
    document.querySelectorAll('[data-theme-toggle]').forEach((b) => b.addEventListener('click', toggleTheme))
    bindSidebar()
    markActiveLink()
    expandActiveGroup()
    addCopyButtons()
    bindScrollSpy()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()