# guchho.js.org

Source for the [Guchho](https://github.com/guchho/guchho) documentation website,
built with Guchho itself and deployed to GitHub Pages at
<https://guchho.js.org>.

## How it works

The Markdown in the [guchho/guchho](https://github.com/guchho/guchho) repository
is the single source of truth. This site does not duplicate any content — it
renders that Markdown into pages at build time.

```
docs/*.md  ──render──▶  src/pages/**/index.html  ──guchho build──▶  dist/
```

- `scripts/build-docs.mjs` renders docs + authored pages to `src/pages/`, writes
  the entrypoint list into `guchho.config.js`, runs `guchho build`, copies
  `public/`, and emits `sitemap.xml` / `robots.txt`.
- `scripts/routes.mjs` maps files to routes: `foo/bar.md` → `/foo/bar/`,
  `dir/README.md` → `/dir/`, root `README.md` → `/docs/`.
- `scripts/markdown.mjs` renders Markdown (markdown-it + anchor + highlight.js)
  and rewrites relative links between docs.
- `scripts/nav.mjs` builds the sidebar from `site.config.mjs`.
- `scripts/validate-links.mjs` checks every internal link and anchor.
- `src/components/` holds the layout/header/footer templates; `src/site/` holds
  pages that are not Markdown (home, examples); `src/styles/` and `src/main.js`
  are the shipped CSS/JS.

The published site has no runtime dependencies.

## Requirements

- Node.js ≥ 18

## Development

```bash
npm ci

# Render docs + authored pages into src/pages/ and check internal links
npm run build:docs        # alias: --render-only
npm run validate          # --validate-only

# Full build (render + bundle with guchho) into dist/
npm run build

# Build, then serve dist/ at http://localhost:3000
npm run dev
```

The docs source defaults to `../GitHub/guchho/docs`. Override it with `--docs`
or `GUCHO_DOCS`:

```bash
npm run build -- --docs /path/to/guchho/docs
```

### Guchho output-path workaround

Guchho v1.0.6 drops the last path separator when writing nested HTML entries
(`guide/x/index.html` is written as `guide/xindex.html`, with asset URLs
computed for the shallower path) on every platform. `scripts/build-docs.mjs`
repairs this after the build by moving each page to its intended path and
prefixing its relative URLs with one `../`. The step is a no-op once guchho is
fixed, and the build hard-fails in CI if any expected page is still missing.

## Regenerating on docs changes

Because the docs live in another repository, changes to them are picked up the
next time this site is built. Trigger a rebuild by pushing to `main` or running
the **Deploy to GitHub Pages** workflow manually. (A scheduled or
`repository_dispatch` rebuild of the `guchho/guchho` docs can be added later.)

## Deployment

`.github/workflows/deploy.yml` checks out this repo and `guchho/guchho`, runs
`npm run build`, and publishes `dist/` to GitHub Pages. `public/CNAME` pins the
`guchho.js.org` domain. The build hard-fails if any expected page is missing
from `dist/`, so a bad build can never be deployed silently.

## License

MIT. See [LICENSE](LICENSE).
