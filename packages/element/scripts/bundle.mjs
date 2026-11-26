import { minify } from 'terser';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { editorStylesPath, minifiedEditorStyles } from './minify-styles.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const minifyStylesPlugin = {
  name: 'minify-styles-ts',
  setup(build) {
    build.onLoad({ filter: /[/\\]styles\.ts$/ }, async args => {
      if (path.resolve(args.path) !== editorStylesPath) return null;
      return {
        contents: await minifiedEditorStyles(),
        loader: 'ts',
      };
    });
  },
};

import {controllerMethods} from './controller-methods.mjs';

const shared = {
  absWorkingDir: root,
  bundle: true,
  minify: true,
  mangleProps: new RegExp('^(' + controllerMethods.join('|') + ')$'),
  target: 'es2022',
  conditions: ['nobita-source'],
  sourcemap: true,
  legalComments: 'none',
  plugins: [minifyStylesPlugin],
};

// Preserve source mappings through the final compression pass for both standalone builds.
async function bundle(options) {
  const { outputFiles } = await esbuild.build({ ...shared, ...options, write: false });
  const js = outputFiles.find(file => file.path.endsWith('.js'));
  const map = outputFiles.find(file => file.path.endsWith('.js.map'));
  const filename = path.basename(js.path);
  const result = await minify({ [filename]: js.text }, {
    module: options.format === 'esm',
    ecma: 2022,
    compress: { passes: 3, if_return: false, sequences: false, join_vars: false, inline: false, reduce_funcs: false, reduce_vars: false },
    sourceMap: { content: map.text, filename, url: filename + '.map' },
  });
  await mkdir(path.dirname(js.path), { recursive: true });
  await Promise.all([writeFile(js.path, result.code), writeFile(map.path, result.map)]);
}

await Promise.all([
  bundle({entryPoints: ['src/collaboration.ts'], format: 'esm', outfile: 'dist/collaboration.js'}),
  bundle({
    external: ['./collaboration.js'],
    entryPoints: ['src/index.ts'],
    format: 'esm',
    outfile: 'dist/nobita.js',
  }),
  bundle({
    external: ['./collaboration.js'],
    entryPoints: ['src/global.ts'],
    format: 'iife',
    outfile: 'dist/nobita.global.js',
  }),
]);
