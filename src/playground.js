// Playground entry. The heavy lifting lives in ./playground/ modules so it can
// be unit-tested in Node (pure logic) and kept out of the main-thread critical
// path (the engine runs in a Web Worker).

import { initPlayground } from './playground/ui.js'

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPlayground, { once: true })
} else {
  initPlayground()
}
