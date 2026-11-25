import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Minify CSS safely without breaking string literals, descendant `:pseudo`
 * selectors (leading space before `:`), or `calc(...)` spacing around `+`/`-`.
 */
function minifyCss(css) {
  const strings = [];
  let out = css.replace(
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\//g,
    match => {
      if (match.startsWith('/*')) return ' ';
      const token = `\uE000${strings.length}\uE001`;
      strings.push(match);
      return token;
    }
  );

  out = out
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,])\s*/g, '$1')
    .replace(/: /g, ':')
    .replace(/\s*>\s*/g, '>')
    .replace(/;}/g, '}')
    .replace(/\uE000(\d+)\uE001/g, (_, index) => strings[Number(index)])
    .trim();

  return out;
}

const minifyStylesPlugin = {
  name: 'minify-styles-ts',
  setup(build) {
    const stylesPath = path.join(root, 'src', 'styles.ts');
    build.onLoad({ filter: /[/\\]styles\.ts$/ }, async args => {
      if (path.resolve(args.path) !== stylesPath) return null;
      const source = await readFile(args.path, 'utf8');
      const match = source.match(
        /export const styles(?:\s*:\s*string)?\s*=\s*(?:\/\*[\s\S]*?\*\/\s*)?`([\s\S]*)`;\s*$/
      );
      if (!match) {
        throw new Error(`Could not extract CSS template literal from ${args.path}`);
      }
      const minified = minifyCss(match[1]);
      return {
        contents: `export const styles: string = ${JSON.stringify(minified)};\n`,
        loader: 'ts',
      };
    });
  },
};

const shared = {
  absWorkingDir: root,
  bundle: true,
  minify: true,
  target: 'es2022',
  conditions: ['nobita-source'],
  sourcemap: true,
  plugins: [minifyStylesPlugin],
};

await Promise.all([
  esbuild.build({
    ...shared,
    entryPoints: ['src/index.ts'],
    format: 'esm',
    outfile: 'dist/nobita.js',
  }),
  esbuild.build({
    ...shared,
    entryPoints: ['src/global.ts'],
    format: 'iife',
    outfile: 'dist/nobita.global.js',
  }),
]);
