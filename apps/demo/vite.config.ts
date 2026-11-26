import { defineConfig } from 'vite';
import { editorStylesPath, minifiedEditorStyles } from '../../packages/element/scripts/minify-styles.mjs';

export default defineConfig({
  plugins: [{
    name: 'minify-editor-styles',
    apply: 'build',
    load(id) { return id === editorStylesPath ? minifiedEditorStyles() : null; },
  }],
  resolve: {
    conditions: ['nobita-source'],
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    minify: 'terser',
  },
});
