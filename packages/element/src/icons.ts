const wrap = (body: string): string =>
  `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

const glyph = (text: string): string =>
  wrap(
    `<text x="3" y="14.5" font-size="10.5" font-weight="700" fill="currentColor" stroke="none" font-family="Inter, ui-sans-serif, system-ui, sans-serif" letter-spacing="-0.3">${text}</text>`
  );

const lines = (dots: boolean): string => {
  const dotMarkup = dots
    ? '<circle cx="3" cy="5" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="15" r="1" fill="currentColor" stroke="none"/>'
    : '';
  return `${dotMarkup}<path d="M7.5 5h9M7.5 10h9M7.5 15h6"/>`;
};

export const icon = {
  text: wrap('<path d="M4 5h12M4 10h12M4 15h7"/>'),
  h1: glyph('H1'),
  h2: glyph('H2'),
  h3: glyph('H3'),
  h4: glyph('H4'),
  h5: glyph('H5'),
  h6: glyph('H6'),
  bulleted: wrap(lines(true)),
  numbered: wrap(
    '<path d="M7.5 5h9M7.5 10h9M7.5 15h6"/><text x="1.5" y="7" font-size="6" fill="currentColor" stroke="none" font-weight="600">1</text><text x="1.5" y="12" font-size="6" fill="currentColor" stroke="none" font-weight="600">2</text><text x="1.5" y="17" font-size="6" fill="currentColor" stroke="none" font-weight="600">3</text>'
  ),
  todo: wrap(
    '<rect x="2.5" y="2.5" width="15" height="15" rx="4"/><path d="m6 10.2 2.4 2.4L14 7.2"/>'
  ),
  quote: wrap(
    '<path d="M7.5 5.5H4.8A1.8 1.8 0 0 0 3 7.3v2.2a1.8 1.8 0 0 0 1.8 1.8h1.4c0 2-1 3.2-2.7 3.7M16.5 5.5h-2.7a1.8 1.8 0 0 0-1.8 1.8v2.2a1.8 1.8 0 0 0 1.8 1.8h1.4c0 2-1 3.2-2.7 3.7"/>'
  ),
  code: wrap('<path d="M7.5 6 3.5 10l4 4M12.5 6l4 4-4 4"/>'),
  divider: wrap('<path d="M3 10h14"/>'),
  callout: wrap(
    '<rect x="2.5" y="3.5" width="15" height="13" rx="3.5"/><path d="M10 8.6v4"/><circle cx="10" cy="6.2" r="0.4" fill="currentColor"/>'
  ),
  image: wrap(
    '<rect x="2.5" y="3.5" width="15" height="13" rx="3"/><circle cx="7" cy="8" r="1.4"/><path d="m3.4 14.4 4-4 3 3 2.4-2.2 3.8 3.8"/>'
  ),
  plus: wrap('<path d="M10 4.5v11M4.5 10h11"/>'),
  drag: wrap(
    '<circle cx="7" cy="5" r="1.1" fill="currentColor" stroke="none"/><circle cx="13" cy="5" r="1.1" fill="currentColor" stroke="none"/><circle cx="7" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="13" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="7" cy="15" r="1.1" fill="currentColor" stroke="none"/><circle cx="13" cy="15" r="1.1" fill="currentColor" stroke="none"/>'
  ),
  menu: wrap(
    '<circle cx="10" cy="4.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="10" cy="15.5" r="1.2" fill="currentColor" stroke="none"/>'
  ),
  copy: wrap('<rect x="7" y="7" width="10" height="10" rx="2.5"/><path d="M13 4.5A2.5 2.5 0 0 0 10.5 3H6a3 3 0 0 0-3 3v4.5A2.5 2.5 0 0 0 5.5 13"/>'),
  trash: wrap('<path d="M3.5 5.5h13M8 3.5h4M5.5 5.5l.7 10a2 2 0 0 0 2 1.9h3.6a2 2 0 0 0 2-1.9l.7-10M8.4 9v5M11.6 9v5"/>'),
  duplicate: wrap('<rect x="6.5" y="6.5" width="10" height="10" rx="2.5"/><path d="M13.5 6V5A2 2 0 0 0 11.5 3H5A2 2 0 0 0 3 5v6.5A2 2 0 0 0 5 13.5h1"/>'),
  indent: wrap('<path d="M3 5h14M9 10h8M9 15h8M3 8.5 5.5 11 3 13.5"/>'),
  outdent: wrap('<path d="M3 5h14M9 10h8M9 15h8M6 8.5 3.5 11 6 13.5"/>'),
  bold: glyph('B'),
  italic: glyph('I'),
  underline: wrap('<path d="M5.5 4v5.2a4.5 4.5 0 0 0 9 0V4M4 16.5h12"/>'),
  strike: wrap('<path d="M3.5 10h13"/><text x="5" y="8" font-size="9" font-weight="700" fill="currentColor" stroke="none">S</text>'),
  inlineCode: wrap('<path d="m7 6.5-3.5 3.5L7 13.5M13 6.5l3.5 3.5-3.5 3.5"/>'),
  link: wrap('<path d="M8.2 11.8 11.8 8.2M7 13l-1.2 1.2a3.2 3.2 0 0 1-4.5-4.5L4 7a3.2 3.2 0 0 1 4.5 0M13 7l1.2-1.2a3.2 3.2 0 0 1 4.5 4.5L16 13a3.2 3.2 0 0 1-4.5 0"/>'),
  check: wrap('<path d="m4 10.5 4 4L16 5.5"/>'),
  chevron: wrap('<path d="m6 8 4 4 4-4"/>'),
  search: wrap('<circle cx="8.8" cy="8.8" r="5.3"/><path d="m12.8 12.8 4 4"/>'),
  sun: wrap('<circle cx="10" cy="10" r="3.4"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4"/>'),
  moon: wrap('<path d="M16 11.5A6.6 6.6 0 0 1 8.5 4a6.6 6.6 0 1 0 7.5 7.5Z"/>'),
  file: wrap('<path d="M5 3.5h6.5L15.5 7v9.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 5 3.5Z"/><path d="M11 3.5V7h4"/>'),
  star: wrap('<path d="m10 3 2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7L3.2 8l4.7-.7Z"/>'),
  more: wrap('<circle cx="4.5" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10" r="1.2" fill="currentColor" stroke="none"/>'),
  arrowLeft: wrap('<path d="M16 10H4M8.5 5.5 4 10l4.5 4.5"/>'),
  arrowRight: wrap('<path d="M4 10h12M11.5 5.5 16 10l-4.5 4.5"/>'),
  x: wrap('<path d="m5 5 10 10M15 5 5 15"/>'),
  external: wrap('<path d="M11 4h5v5M16 4l-7 7M8 5H5.5A1.5 1.5 0 0 0 4 6.5v8A1.5 1.5 0 0 0 5.5 16h8a1.5 1.5 0 0 0 1.5-1.5V12"/>'),
  table: wrap('<rect x="2.5" y="3.5" width="15" height="13" rx="2.5"/><path d="M2.5 8h15M8 3.5v13M13 3.5v13M2.5 12.5h15"/>'),
  database: wrap('<ellipse cx="10" cy="5.2" rx="6.5" ry="2.7"/><path d="M3.5 5.2v9.6c0 1.5 2.9 2.7 6.5 2.7s6.5-1.2 6.5-2.7V5.2M3.5 10c0 1.5 2.9 2.7 6.5 2.7s6.5-1.2 6.5-2.7"/>'),
  hash: wrap('<path d="M7.5 3.5 6 16.5M13 3.5l-1.5 13M3.5 7.5h13M3 12.5h13"/>'),
  calendar: wrap('<rect x="3" y="4.5" width="14" height="12.5" rx="2.5"/><path d="M3 8.5h14M6.5 3v3M13.5 3v3"/>'),
  tag: wrap('<path d="M3.5 9.2V4.2a1 1 0 0 1 1-1h5l7.1 7.1a1.5 1.5 0 0 1 0 2.1l-4.9 4.9a1.5 1.5 0 0 1-2.1 0L3.5 9.2Z"/><circle cx="7" cy="6.9" r="1"/>'),
  checkboxSquare: wrap('<rect x="3" y="3" width="14" height="14" rx="3.5"/><path d="m6.3 10.2 2.4 2.4 5-5"/>'),
  sortAsc: wrap('<path d="M6 15V5M3 8l3-3 3 3M11 7h6M11 10.5h4M11 14h2"/>'),
  sortDesc: wrap('<path d="M6 5v10M3 12l3 3 3-3M11 7h2M11 10.5h4M11 14h6"/>'),
  rows: wrap('<rect x="2.5" y="3.5" width="15" height="13" rx="2.5"/><path d="M2.5 8h15M2.5 12h15"/>'),
  columns: wrap('<rect x="2.5" y="3.5" width="15" height="13" rx="2.5"/><path d="M8 3.5v13M12.5 3.5v13"/>'),
  trashSmall: wrap('<path d="M4 6h12M8 3.5h4M6 6l.6 9.5a1.5 1.5 0 0 0 1.5 1.4h3.8a1.5 1.5 0 0 0 1.5-1.4L14 6"/>'),
  alignLeft: wrap('<path d="M3 4.5h14M3 8h9M3 11.5h14M3 15h8"/>'),
  alignCenter: wrap('<path d="M3 4.5h14M5.5 8h9M3 11.5h14M6 15h8"/>'),
  alignRight: wrap('<path d="M3 4.5h14M8 8h9M3 11.5h14M9 15h8"/>'),
  clock: wrap('<circle cx="10" cy="10" r="7"/><path d="M10 6v4.3l2.8 1.7"/>'),
} as const;

export type IconName = keyof typeof icon;
