import { ja } from '@nobita/element/locales/ja';
import { createEditor, type NobitaDictionary, type NobitaEditorElement } from '@nobita/element';
import { createBlock, createDatabaseData, createDoc } from '@nobita/core';

export { ja };

export function mount(mode: 'partial' | 'ja') {
  const host = window.__host;
  const doc = createDoc({ blocks: [
    createBlock('paragraph', { id: 'b1', text: 'Alpha' }),
    createBlock('paragraph', { id: 'b2' }),
    createBlock('database', { id: 'db', props: { database: {
      ...createDatabaseData({ variant: 'database' }), title: 'Delete',
      columns: [{ id: 'name', name: 'Delete', type: 'text' }],
    } } }),
  ] });
  const dictionary: NobitaDictionary = mode === 'ja' ? ja : {
    Bold: 'Strong', Delete: 'Remove block', 'New Record': '<b>Add item</b>',
  };
  if (mode === 'partial') {
    const element = document.createElement('nobita-editor') as NobitaEditorElement;
    element.dictionary = dictionary;
    element.doc = doc;
    host.replaceWith(element);
    window.__host = element;
    window.__editor = element.editor;
  } else {
    const container = document.createElement('div');
    host.replaceWith(container);
    window.__editor = createEditor(container, { doc, dictionary });
  }
}
