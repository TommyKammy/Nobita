import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('./fixture', import.meta.url));
const element = fileURLToPath(
  new URL('../../packages/element/src/index.ts', import.meta.url)
);
const core = fileURLToPath(
  new URL('../../packages/core/src/index.ts', import.meta.url)
);

export default defineConfig({
  root,
  resolve: {
    conditions: ['nobita-source'],
    alias: {
      '@nobita/core': core,
      '@nobita/element': element,
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true,
  },
});
