import { createBlock, createDoc, docToJSON, nextSibling, updateBlock } from '@nobita/core';
import { createEditor } from '@nobita/element';

const type = 'custom:ticket';
const storageKey = 'nobita.example.ticket-card.v1';
const flags = new URLSearchParams(location.search);
const registered = !flags.has('unregistered');
const editor = createEditor(document.querySelector('#editor'), {
  doc: localStorage.getItem(storageKey) ?? createDoc({ blocks: [createBlock('paragraph')] }),
  readonly: flags.has('readonly'),
  onChange: doc => localStorage.setItem(storageKey, docToJSON(doc)),
});

function createTicket() {
  return createBlock(type, {
    text: '案件（未採番）',
    props: { data: { version: 1, number: '未採番', status: 'open' } },
  });
}

function supported(data) {
  return data?.version === 1 && typeof data.number === 'string' &&
    (data.status === 'open' || data.status === 'closed');
}

function renderTicket(block, readonly) {
  const data = block.props.data;
  if (!supported(data)) return 'この形式の案件カードは編集できません';
  const form = document.querySelector('#ticket-form').content.firstElementChild.cloneNode(true);
  const number = form.elements.namedItem('number');
  const status = form.elements.namedItem('status');
  number.value = data.number;
  status.value = data.status;
  for (const control of form.elements) control.disabled = readonly;
  form.onsubmit = event => {
    event.preventDefault();
    if (editor.readonly || !number.value.trim()) return;
    editor.store.update(doc => updateBlock(doc, block.id, current => {
      const previous = current.props.data;
      if (current.type !== type || !supported(previous)) return current;
      const nextNumber = number.value.trim();
      if (previous.number === nextNumber && previous.status === status.value) return current;
      return {
        ...current,
        text: [{ text: `案件（${nextNumber}）` }],
        props: { ...current.props, data: { ...previous, number: nextNumber, status: status.value } },
      };
    }));
    const next = nextSibling(editor.getDoc().blocks, block.id);
    if (next?.type === 'paragraph') editor.focus(next.id, 0);
  };
  return form;
}

if (registered) {
  editor.registerCustomBlock(type, renderTicket);
  editor.registerSlashBlock({
    id: 'acme.insert-ticket',
    label: '案件カード',
    keywords: ['案件', 'ticket'],
    create: createTicket,
  });
}
document.querySelector('#undo').onclick = () => editor.undo();
document.querySelector('#redo').onclick = () => editor.redo();
