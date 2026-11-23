import { NobitaEditor, createEditor, defineNobitaEditor } from './index.js';

declare global {
  // eslint-disable-next-line no-var
  var Nobita:
    | {
        NobitaEditor: typeof NobitaEditor;
        createEditor: typeof createEditor;
        defineNobitaEditor: typeof defineNobitaEditor;
      }
    | undefined;
}

globalThis.Nobita = { NobitaEditor, createEditor, defineNobitaEditor };
