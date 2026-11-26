import { minify } from 'terser';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  const hold = value => {
    const token = `\uE000${strings.length}\uE001`;
    strings.push(value);
    return token;
  };
  let out = css.replace(
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\//g,
    match => (match.startsWith('/*') ? ' ' : hold(match))
  );

  // Protect calc(...) expressions so spacing around +/- and 0px units stay intact.
  out = out.replace(/calc\((?:[^()]+|\((?:[^()]+|\([^()]*\))*\))*\)/g, hold);

  out = out
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,])\s*/g, '$1')
    .replace(/: /g, ':')
    .replace(/\s*>\s*/g, '>')
    .replace(/#ffffff\b/gi, '#fff')
    .replace(/#000000\b/gi, '#000')
    .replace(/([: ,(])0px(?=[ ;,})])/g, '$10')
    .replace(/([: ,(])0\.([0-9]+)/g, '$1.$2')
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
    compress: { passes: 3 },
    sourceMap: { content: map.text, filename, url: filename + '.map' },
  });
  await mkdir(path.dirname(js.path), { recursive: true });
  await Promise.all([writeFile(js.path, result.code), writeFile(map.path, result.map)]);
}

await Promise.all([
  bundle({
    entryPoints: ['src/index.ts'],
    format: 'esm',
    outfile: 'dist/nobita.js',
  }),
  bundle({
    entryPoints: ['src/global.ts'],
    format: 'iife',
    outfile: 'dist/nobita.global.js',
  }),
]);
