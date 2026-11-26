import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

export const editorStylesPath = fileURLToPath(new URL('../src/styles.ts', import.meta.url));

export async function minifiedEditorStyles() {
  const source = await readFile(editorStylesPath, 'utf8');
  const match = source.match(
    /export const styles(?:\s*:\s*string)?\s*=\s*(?:\/\*[\s\S]*?\*\/\s*)?`([\s\S]*)`;\s*$/
  );
  if (!match) {
    throw new Error(`Could not extract CSS template literal from ${editorStylesPath}`);
  }
  const minified = (await esbuild.transform(match[1], { loader: 'css', minify: true })).code.trim();
  return `export const styles = ${JSON.stringify(minified)};\n`;
}
