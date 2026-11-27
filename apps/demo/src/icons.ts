const wrap = (body: string): string =>
  `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

/**
 * Demo-only shell icons. Keeping them out of `@nobita/element` avoids shipping
 * sidebar and marketing chrome in the editor bundle.
 */
export const demoIcon = {
  search: wrap('<circle cx="8.8" cy="8.8" r="5.3"/><path d="m12.8 12.8 4 4"/>'),
  sun: wrap('<circle cx="10" cy="10" r="3.4"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4"/>'),
  moon: wrap('<path d="M16 11.5A6.6 6.6 0 0 1 8.5 4a6.6 6.6 0 1 0 7.5 7.5Z"/>'),
  file: wrap('<path d="M5 3.5h6.5L15.5 7v9.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 5 3.5Z"/><path d="M11 3.5V7h4"/>'),
  tag: wrap('<path d="M3 4.5A1.5 1.5 0 0 1 4.5 3H10l7 7a1.5 1.5 0 0 1 0 2.1L12.1 17a1.5 1.5 0 0 1-2.1 0l-7-7Z"/><circle cx="6.8" cy="6.8" r="1"/>'),
  star: wrap('<path d="m10 3 2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7L3.2 8l4.7-.7Z"/>'),
  restore: wrap('<path d="M4.5 10a5.5 5.5 0 1 0 1.6-3.9L4.5 7.7"/><path d="M4.5 3.8v3.9h3.9"/>'),
  external: wrap('<path d="M11 4h5v5M16 4l-7 7M8 5H5.5A1.5 1.5 0 0 0 4 6.5v8A1.5 1.5 0 0 0 5.5 16h8a1.5 1.5 0 0 0 1.5-1.5V12"/>'),
} as const;
