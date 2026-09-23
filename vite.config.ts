/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/** Emits sw.js with the hashed build output inlined as its precache list. */
function serviceWorker(): Plugin {
  return {
    name: 'racquet-time-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = ['./', ...Object.keys(bundle).filter((f) => !f.endsWith('.woff')).map((f) => `./${f}`), './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png'];
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      const source = readFileSync('src/sw.js', 'utf8')
        .replace('__PRECACHE__', JSON.stringify(files))
        .replace('__VERSION__', version);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// Served from the custom domain root (scoring.shedbuilt.link), so base is '/'.
export default defineConfig({
  base: '/',
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  plugins: [serviceWorker()],
  build: { target: 'es2022' },
  test: { include: ['test/**/*.test.ts'] },
});
