export default {
  site: {
    name: 'Guchho',
    tagline: 'Fast HTML-first JavaScript, CSS & asset bundler',
    description:
      'Guchho is a fast, native bundler, compiler and build tool for modern web applications. It parses HTML, JavaScript, TypeScript, JSX/TSX, CSS and assets, and produces a complete, deployable output directory.',
    url: 'https://guchho.js.org',
    github: 'https://github.com/guchho/guchho',
    npm: 'https://www.npmjs.com/package/guchho',
    licenseUrl: 'https://github.com/guchho/guchho/blob/main/LICENSE',
    sponsorUrl: 'https://github.com/sponsors/code-hemu',
    copyright: 'CodeHemu',
  },

  // The Markdown root that is the single source of truth for documentation.
  // Override with --docs <path> or the GUCHO_DOCS environment variable.
  docsRoot: '../GitHub/guchho/docs',

  // Curated sidebar groups. "autodir" pulls every *.md in that docs directory
  // (its README becomes the group index); "links" are explicit entries.
  nav: [
    {
      title: 'Start',
      icon: '<path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/>',
      links: [
        { href: '/guide/getting-started/', label: 'Getting started' },
        { href: '/guide/introduction/', label: 'Introduction' },
        { href: '/guide/why-guchho/', label: 'Why Guchho' },
        { href: '/guide/core-concepts/', label: 'Core concepts' },
        { href: '/guide/configuration/', label: 'Configuration' },
        { href: '/guide/cli-overview/', label: 'CLI overview' },
        { href: '/guide/dev-server-and-watch/', label: 'Dev server & watch' },
      ],
    },
    {
      title: 'Guide',
      icon: '<path d="M12 6C9.5 4.5 6.5 4 4 4v13c2.5 0 5.5.5 8 2 2.5-1.5 5.5-2 8-2V4c-2.5 0-5.5.5-8 2z"/><path d="M12 6v13"/>',
      autodir: 'guide',
    },
    {
      title: 'API',
      icon: '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/>',
      links: [
        { href: '/api/', label: 'JavaScript API' },
        { href: '/api/classes/', label: 'Classes' },
        { href: '/api/compiler/', label: 'Compiler API' },
        { href: '/api/generated/', label: 'Options' },
        { href: '/api/generated/types/', label: 'Types & results' },
        { href: '/api/generated/plugin-types/', label: 'Plugin types' },
      ],
    },
    {
      title: 'Reference',
      icon: '<path d="M6 4h12v16l-6-4-6 4V4z"/>',
      autodir: 'reference',
    },
    {
      title: 'Plugins',
      icon: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
      links: [
        { href: '/plugins/', label: 'Writing plugins' },
        { href: '/plugins/hooks/', label: 'Hooks' },
        { href: '/plugins/context/', label: 'Context' },
      ],
    },
    {
      title: 'Embedding',
      icon: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>',
      links: [
        { href: '/embedding/', label: 'Embedding (C++)' },
        { href: '/embedding/generated/', label: 'Generated reference' },
      ],
    },
    {
      title: 'Recipes',
      icon: '<path d="M12 3l9 4.5-9 4.5-9-4.5L12 3z"/><path d="M3 12l9 4.5 9-4.5M3 16.5L12 21l9-4.5"/>',
      autodir: 'recipes',
    },
    {
      title: 'Resources',
      icon: '<path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
      autodir: 'resources',
    },
    {
      title: 'More',
      icon: '<path d="M4 7h16M4 12h16M4 17h16"/>',
      links: [
        { href: '/playground/', label: 'Try in the browser' },
        { href: '/playground-guide/', label: 'Playground guide' },
        { href: '/blog/', label: 'Blog' },
        { href: '/release-notes/', label: 'Release notes' },
        { href: '/versions/', label: 'Versions' },
      ],
    },
  ],

  // Any route that is generated but not in the sidebar gets one of these
  // auto-groups; empty skips it.
  sideanchor: true,
}