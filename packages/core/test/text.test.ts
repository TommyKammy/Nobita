import { describe, expect, it } from 'vitest';
import {
  applyMarkPatch,
  deleteTextRange,
  insertTextAt,
  markStateInRange,
  marksAt,
  normalizeRuns,
  plainText,
  sliceRuns,
  toggleMarkInRange,
} from '../src/text.js';

describe('rich text', () => {
  it('normalizes adjacent runs', () => {
    const runs = normalizeRuns([
      { text: 'a', marks: { bold: true } },
      { text: 'b', marks: { bold: true } },
      { text: 'c' },
      { text: '' },
    ]);
    expect(runs).toEqual([{ text: 'ab', marks: { bold: true } }, { text: 'c' }]);
  });

  it('inserts text inheriting the mark at the caret', () => {
    const runs = [{ text: 'bold', marks: { bold: true } as const }];
    expect(insertTextAt(runs, 2, 'XY')).toEqual([{ text: 'boXYld', marks: { bold: true } }]);
    expect(insertTextAt(runs, 2, 'XY', {})).toEqual([
      { text: 'bo', marks: { bold: true } },
      { text: 'XY' },
      { text: 'ld', marks: { bold: true } },
    ]);
  });

  it('deletes across runs', () => {
    const runs = [
      { text: 'abc', marks: { bold: true as const } },
      { text: 'def' },
      { text: 'ghi', marks: { italic: true as const } },
    ];
    expect(deleteTextRange(runs, 1, 7)).toEqual([
      { text: 'a', marks: { bold: true } },
      { text: 'hi', marks: { italic: true } },
    ]);
    expect(plainText(deleteTextRange(runs, 0, 9))).toBe('');
  });

  it('slices and reports marks', () => {
    const runs = [
      { text: 'ab', marks: { bold: true as const } },
      { text: 'cd' },
    ];
    expect(sliceRuns(runs, 1, 3)).toEqual([{ text: 'b', marks: { bold: true } }, { text: 'c' }]);
    expect(marksAt(runs, 2)).toEqual({ bold: true });
    expect(marksAt(runs, 3)).toBeUndefined();
  });

  it('applies and removes marks only inside a range', () => {
    const marked = applyMarkPatch([{ text: 'hello world' }], 6, 11, { bold: true });
    expect(marked).toEqual([{ text: 'hello ' }, { text: 'world', marks: { bold: true } }]);
    const removed = applyMarkPatch(marked, 6, 11, { bold: false });
    expect(removed).toEqual([{ text: 'hello world' }]);
  });

  it('computes intersection state for a range', () => {
    const runs = [
      { text: 'aa', marks: { bold: true as const } },
      { text: 'bb', marks: { bold: true as const, italic: true as const } },
    ];
    expect(markStateInRange(runs, 0, 4)).toEqual({ bold: true });
    expect(toggleMarkInRange(runs, 0, 4, 'bold')).toEqual([
      { text: 'aa' },
      { text: 'bb', marks: { italic: true } },
    ]);
  });
});
