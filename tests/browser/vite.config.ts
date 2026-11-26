import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('./fixture', import.meta.url));
const element = fileURLToPath(
  new URL(process.env.NOBITA_TEST_BUNDLE === '1' ? '../../packages/element/dist/nobita.js' : '../../packages/element/src/index.ts', import.meta.url)
);
const core = fileURLToPath(
  new URL('../../packages/core/src/index.ts', import.meta.url)
);

export default defineConfig({
  root,
  optimizeDeps:{include:['yjs'],entries:['*.html','peers.ts']},
  resolve: {
    conditions: ['nobita-source'],
    alias: {
      '@nobita/core/collab-runtime': fileURLToPath(new URL('../../packages/core/src/collab-runtime.ts',import.meta.url)),
      '@nobita/core': core,
      '@nobita/element/locales/ja': fileURLToPath(new URL(
        process.env.NOBITA_TEST_BUNDLE === '1' ? '../../packages/element/dist/locales/ja.js' : '../../packages/element/src/locales/ja.ts', import.meta.url
      )),
      '@nobita/element': element,
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true,
  },
});
