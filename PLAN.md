Create a new standalone documentation website project named `guchho.js.org`.

## Goal

Build a clean, professional documentation website for the Guchho JavaScript/HTML-first bundler.

Use this exact project structure:

```text
guchho.js.org/
├── public/
│   ├── favicon.ico
│   ├── logo.png
│   └── og-image.png
│
├── src/
│   ├── components/
│   │   ├── Header.*
│   │   ├── Footer.*
│   │   ├── CodeBlock.*
│   │   └── Hero.*
│   │
│   ├── pages/
│   │   ├── index.*
│   │   ├── getting-started.*
│   │   ├── api/
│   │   │   ├── build.*
│   │   │   ├── transform.*
│   │   │   ├── analyze.*
│   │   │   ├── context.*
│   │   │   └── watch.*
│   │   ├── config.*
│   │   ├── cli.*
│   │   ├── plugins.*
│   │   └── examples.*
│   │
│   ├── styles/
│   │   ├── global.css
│   │   └── docs.css
│   │
│   └── main.*
│
├── examples/
│   ├── vanilla/
│   ├── typescript/
│   ├── react/
│   └── library/
│
├── scripts/
│   └── build-docs.*
│
├── package.json
├── guchho.config.js
├── README.md
├── LICENSE
└── .gitignore
```

## Website content

### Homepage

Create a strong landing page containing:

* Guchho logo/name
* Short tagline:
  `Fast HTML-first JavaScript, CSS & asset bundler`
* Installation example
* Minimal build example
* Key features
* JavaScript API
* CLI
* Configuration
* Examples
* GitHub link
* Documentation navigation

### Getting Started

Document:

1. Installation
2. Project initialization
3. First HTML entry
4. First build
5. Development/watch workflow
6. Production build

Example:

```js
import { build } from 'guchho'

await build({
  entrypoints: ['src/index.html'],
  outdir: 'dist',
})
```

### JavaScript API

Document:

* `build()`
* `transform()`
* `analyze()`
* `context()`
* `watch()`

Also document the compiler APIs where applicable:

* `lexer()`
* `parse()`
* `print()`

Keep the API examples simple and practical.

### Configuration

Document the canonical Guchho configuration options, including:

* `entrypoints`
* `outdir`
* `outfile`
* `format`
* `platform`
* `target`
* `minify`
* `sourcemap`
* `splitting`
* `treeShaking`
* `define`
* `external`
* `loader`
* `banner`

Use `entrypoints`, not `entryPoints`.

Example:

```js
export default {
  entrypoints: ['src/index.html'],
  outdir: 'dist',
  format: 'esm',
  platform: 'browser',
  minify: true,
}
```

### CLI

Document the main commands:

```text
guchho build
guchho dev
guchho serve
guchho watch
guchho init
guchho clean
guchho info
guchho transform
```

Include useful examples and common options.

### Plugins

Explain the plugin architecture and provide a minimal example.

Do not document unsupported functionality as available.

### Examples

Provide working examples for:

* Vanilla JavaScript
* TypeScript
* React
* Library/package build

Keep examples minimal and runnable.

## Design

Create a modern developer-tool documentation UI.

Requirements:

* Responsive
* Fast
* Clean typography
* Dark/light theme support
* Sticky documentation navigation
* Mobile navigation
* Syntax-highlighted code blocks
* Copy-code button
* Clear headings and anchors
* Good spacing
* Accessible semantic HTML
* Professional developer-tool appearance

Do not over-design it or add unnecessary animations.

## Components

Implement reusable components for:

* Header
* Footer
* Hero
* CodeBlock
* Documentation navigation
* API sections
* Feature cards where useful

Avoid duplicated markup between documentation pages.

## Configuration

Create:

```text
package.json
guchho.config.js
```

Configure Guchho as the site's build tool.

The site itself should be HTML-first and use Guchho's own capabilities wherever practical.

## SEO

Add:

* page titles
* meta descriptions
* canonical URLs
* Open Graph metadata
* Twitter/social metadata
* favicon
* `og-image.png`

Use `https://guchho.js.org` as the canonical site URL.

## README

Create a concise README explaining:

* what the site is
* development setup
* development command
* production build
* project structure
* deployment

## Important constraints

* This is a standalone documentation website.
* Do not modify the Guchho compiler/npm package source.
* Do not introduce unrelated dependencies.
* Do not create fake API features.
* Keep the documentation aligned with the actual Guchho API.
* Use `entrypoints` consistently.
* Keep the implementation simple and production-ready.

## Acceptance criteria

* The complete directory structure exists.
* The website builds successfully with Guchho.
* Homepage works.
* Documentation navigation works.
* All listed pages are reachable.
* Code examples are properly formatted.
* Responsive layout works on desktop and mobile.
* Dark/light theme works.
* No broken internal links.
* No placeholder `TODO` content remains.
* `README.md` contains working development/build instructions.
