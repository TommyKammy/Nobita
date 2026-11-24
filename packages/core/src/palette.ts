import type { HighlightColor, TextColor } from './types.js';

/** Portable HTML fallbacks for the editor's highlight palette. */
export const HIGHLIGHT_HEX: Record<HighlightColor, string> = {
  red: '#fee2e2',
  orange: '#ffedd5',
  yellow: '#fef3c7',
  green: '#dcfce7',
  teal: '#ccfbf1',
  blue: '#dbeafe',
  purple: '#ede9fe',
  grey: '#eeeeec',
};

/** Portable HTML fallbacks for the editor's foreground palette. */
export const TEXT_COLOR_HEX: Record<TextColor, string> = {
  red: '#b91c1c',
  orange: '#c2410c',
  yellow: '#a16207',
  green: '#15803d',
  teal: '#0f766e',
  blue: '#1d4ed8',
  purple: '#7e22ce',
  grey: '#6b7280',
};

/**
 * Light and dark reference colors used when importing arbitrary CSS colors
 * (for example HTML exported by AFFiNE).
 */
export const TEXT_COLOR_RGB_REFERENCES: readonly {
  color: TextColor;
  rgb: readonly [number, number, number];
}[] = [
  { color: 'red', rgb: [185, 28, 28] },
  { color: 'red', rgb: [248, 113, 113] },
  { color: 'orange', rgb: [194, 65, 12] },
  { color: 'orange', rgb: [251, 146, 60] },
  { color: 'yellow', rgb: [161, 98, 7] },
  { color: 'yellow', rgb: [250, 204, 21] },
  { color: 'green', rgb: [21, 128, 61] },
  { color: 'green', rgb: [74, 222, 128] },
  { color: 'teal', rgb: [15, 118, 110] },
  { color: 'teal', rgb: [45, 212, 191] },
  { color: 'blue', rgb: [29, 78, 216] },
  { color: 'blue', rgb: [96, 165, 250] },
  { color: 'purple', rgb: [126, 34, 206] },
  { color: 'purple', rgb: [192, 132, 252] },
  { color: 'grey', rgb: [107, 114, 128] },
  { color: 'grey', rgb: [156, 163, 175] },
];
