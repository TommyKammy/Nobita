import type { BooleanMarkKey } from '@nobita/core';
import { icon } from './icons.js';

export const formattingControls: readonly { key: BooleanMarkKey; tag: string; label: string; icon: string; shortcut: string }[] = [
  { key: 'bold', tag: 'strong', label: 'Bold', icon: icon.bold, shortcut: 'B' },
  { key: 'italic', tag: 'em', label: 'Italic', icon: icon.italic, shortcut: 'I' },
  { key: 'underline', tag: 'u', label: 'Underline', icon: icon.underline, shortcut: 'U' },
  { key: 'strike', tag: 's', label: 'Strikethrough', icon: icon.strike, shortcut: 'S' },
  { key: 'code', tag: 'code', label: 'Inline code', icon: icon.inlineCode, shortcut: 'E' },
];
