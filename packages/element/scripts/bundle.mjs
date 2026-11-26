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

// Internal view and controller members. Host API and document property names stay public.
const controllerMethods = [
  'focusAfterHistory', 'focusFirstCell', 'focusCell', 'caretOffset', 'setSelected', 'onHide',
  'setQuery', 'setItems', 'isVisible', 'isOpen', 'copyMarkdown', 'copyBlocks', 'copyLink',
  'rootElement', 'instanceId', 'pointFromCaret', 'keepTrigger', 'restoreFocus', 'filterable',
  'startColumnId', 'endColumnId', 'startRowId', 'endRowId', 'defaultLabel', 'isReadonly',
  'onDismiss', 'pointerTarget', 'dismissOnInsideScroll',
  'getContentSignal', 'getEventsSignal', 'getSyncedData', 'getDetailElement', 'getScrollElement',
  'getReadonly', 'getUploadImage', 'currentCell', 'commitCell', 'commitTextRuns', 'commitRowPage',
  'commitColumnFields', 'commitDeletedRows', 'setPendingBoardFocus', 'addColumnOfType',
  'addFilterForColumn', 'setGroupProperty', 'setFilterTree', 'defaultGroupColumn', 'patchViewColumn',
  'applyFirst', 'formatSelect', 'decimalPatch', 'insertColumn', 'deleteColumn', 'focusAfter',
  'activeView', 'titleColumn', 'syncValues', 'showPopover', 'closePopover',
  'updateActiveView', 'groupsFor', 'columnStates', 'viewColumns', 'navigationRows', 'visibleColumns',
  'openAddPropertyMenu', 'openDetailPanel', 'openComputed', 'openColumnPopover', 'openRowPopover',
  'openPeoplePopover', 'openMultiSelectPopover', 'openSelectPopover', 'openFilesPopover', 'openImagePopover',
  'openViewMenu', 'openGroupMenu', 'openAddViewMenu', 'attachRichTextHandlers', 'attachCompositionHandlers',
  'openRenameView', 'openViewProperties', 'openFilterPopover', 'openGroupPopover', 'openSortPopover',
  'openStatPopover', 'duplicateColumn', 'duplicateRow', 'moveColumn', 'moveView', 'moveGroup',
  'addView', 'addCard', 'moveCard', 'clearSelectedRow', 'pasteIntoRichText', 'toggleInlineTag',
  'focusImageCaption', 'focusImageInput', 'focusDatabase', 'focusPageLink', 'focusTable',
  'refreshPageLink', 'pastePlainText', 'composingTargets', 'textElement', 'resetToolbar', 'richTextSelector', 'getSignal', 'isComposingKey',
  'isEditingGroupTitle', 'clearDropIndicators', 'clearPendingMarks', 'setPendingMarks', 'syncToolbar',
];

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
