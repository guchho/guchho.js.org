export default {
  build: {
    entrypoints: [/* __ENTRYPOINTS__ */],
    outdir: 'dist',
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    bundle: true,
    minify: true,
    minifyHtml: true,
    pretty: false,
    sourcemap: false,
    splitting: false,
    treeShaking: true,
  },
}
