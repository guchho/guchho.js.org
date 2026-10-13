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
      autodir: 'guide',
    },
    {
      title: 'API',
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
      autodir: 'reference',
    },
    {
      title: 'Plugins',
      links: [
        { href: '/plugins/', label: 'Writing plugins' },
        { href: '/plugins/hooks/', label: 'Hooks' },
        { href: '/plugins/context/', label: 'Context' },
      ],
    },
    {
      title: 'Embedding',
      links: [
        { href: '/embedding/', label: 'Embedding (C++)' },
        { href: '/embedding/generated/', label: 'Generated reference' },
      ],
    },
    {
      title: 'Recipes',
      autodir: 'recipes',
    },
    {
      title: 'Resources',
      autodir: 'resources',
    },
    {
      title: 'More',
      links: [
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