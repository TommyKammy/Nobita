import type { BlockType, HeadingLevel } from '@nobita/core';

const wrap = (body: string): string =>
  `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

const filled = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true" focusable="false">${body}</svg>`;

const textIcon = filled('<path fill="currentColor" fill-rule="evenodd" d="M3.25 4A.75.75 0 0 1 4 3.25h16a.75.75 0 0 1 .75.75v2.667a.75.75 0 0 1-1.5 0V4.75h-6.5v14.5H16a.75.75 0 0 1 0 1.5H8a.75.75 0 0 1 0-1.5h3.25V4.75h-6.5v1.917a.75.75 0 0 1-1.5 0z" clip-rule="evenodd"/>');
const boldIcon = filled('<path fill="currentColor" fill-rule="evenodd" d="M6.25 4A.75.75 0 0 1 7 3.25h5.958c2.67 0 4.875 2.105 4.875 4.75 0 1.515-.723 2.853-1.843 3.72 1.626.764 2.76 2.383 2.76 4.28 0 2.645-2.204 4.75-4.875 4.75H7a.75.75 0 0 1-.75-.75zm1.5 8.75v6.5h6.125c1.886 0 3.375-1.477 3.375-3.25s-1.49-3.25-3.375-3.25zm0-1.5h5.208c1.886 0 3.375-1.477 3.375-3.25s-1.489-3.25-3.375-3.25H7.75z" clip-rule="evenodd"/>');
const italicIcon = filled('<path fill="currentColor" fill-rule="evenodd" d="M14.608 3.25H10.25a.75.75 0 0 0 0 1.5h3.34l-4.758 14.5H5a.75.75 0 0 0 0 1.5h8.75a.75.75 0 0 0 0-1.5h-3.34l4.758-14.5H19a.75.75 0 0 0 0-1.5h-4.392" clip-rule="evenodd"/>');
const underlineIcon = filled('<path fill="currentColor" fill-rule="evenodd" d="M7.744 3.968a.808.808 0 1 0-1.616 0v7.003a5.656 5.656 0 1 0 11.313 0V3.968a.808.808 0 1 0-1.616 0v7.003a4.04 4.04 0 1 1-8.08 0zM4.458 19.32a.808.808 0 0 0 0 1.616h15.084a.808.808 0 1 0 0-1.616z" clip-rule="evenodd"/>');
const strikeIcon = filled('<path fill="currentColor" fill-rule="evenodd" d="M8.406 7.464a3.468 3.468 0 0 1 6.59-1.513.77.77 0 0 0 1.385-.673 5.009 5.009 0 0 0-9.05 4.3h1.793a3.45 3.45 0 0 1-.718-2.114m6.512 8.476c0-.795-.268-1.528-.718-2.113h1.792a5.008 5.008 0 0 1-9.05 4.299.77.77 0 1 1 1.387-.673 3.468 3.468 0 0 0 6.589-1.513M4.297 10.905a.797.797 0 0 0 0 1.594h15.406a.797.797 0 0 0 0-1.594z" clip-rule="evenodd"/>');
const codeIcon = filled('<path fill="currentColor" fill-rule="evenodd" d="M13.982 4.272a.75.75 0 0 1 .546.91l-3.6 14.4a.75.75 0 1 1-1.456-.364l3.6-14.4a.75.75 0 0 1 .91-.546M7.13 8.07a.75.75 0 0 1 0 1.06L4.06 12.2l3.07 3.07a.75.75 0 0 1-1.06 1.06l-3.6-3.6a.75.75 0 0 1 0-1.06l3.6-3.6a.75.75 0 0 1 1.06 0m9.74 0a.75.75 0 0 1 1.06 0l3.6 3.6a.75.75 0 0 1 0 1.06l-3.6 3.6a.75.75 0 1 1-1.06-1.06l3.07-3.07-3.07-3.07a.75.75 0 0 1 0-1.06" clip-rule="evenodd"/>');
const linkIcon = filled('<path fill="currentColor" fill-rule="evenodd" d="M18.428 5.572a2.806 2.806 0 0 0-3.967 0l-.978.977a.75.75 0 0 1-1.06-1.06l.977-.978a4.305 4.305 0 1 1 6.089 6.089l-3.556 3.556a4.306 4.306 0 0 1-6.089 0 .75.75 0 0 1 1.061-1.061 2.805 2.805 0 0 0 3.968 0l3.555-3.556a2.806 2.806 0 0 0 0-3.967m-5.333 5.333a2.805 2.805 0 0 0-3.968 0l-3.555 3.556a2.806 2.806 0 0 0 3.967 3.967l.98-.979a.75.75 0 0 1 1.06 1.06l-.979.98A4.305 4.305 0 1 1 4.511 13.4l3.556-3.556a4.306 4.306 0 0 1 6.089 0 .75.75 0 0 1-1.061 1.061" clip-rule="evenodd"/>');
const alignLeftIcon = filled('<path fill="currentColor" fill-rule="evenodd" d="M20.75 6a.75.75 0 0 0-.75-.75H5a.75.75 0 0 0 0 1.5h15a.75.75 0 0 0 .75-.75m-7 6a.75.75 0 0 0-.75-.75H5a.75.75 0 0 0 0 1.5h8a.75.75 0 0 0 .75-.75m3 6a.75.75 0 0 0-.75-.75H5a.75.75 0 0 0 0 1.5h11a.75.75 0 0 0 .75-.75" clip-rule="evenodd"/>');
const alignCenterIcon = filled('<path fill="currentColor" fill-rule="evenodd" d="M3.75 6a.75.75 0 0 1 .75-.75h15a.75.75 0 0 1 0 1.5h-15A.75.75 0 0 1 3.75 6m3.5 6a.75.75 0 0 1 .75-.75h8a.75.75 0 0 1 0 1.5H8a.75.75 0 0 1-.75-.75M6 17.25a.75.75 0 0 0 0 1.5h12a.75.75 0 0 0 0-1.5z" clip-rule="evenodd"/>');
const alignRightIcon = filled('<path fill="currentColor" fill-rule="evenodd" d="M4.25 6A.75.75 0 0 1 5 5.25h15a.75.75 0 0 1 0 1.5H5A.75.75 0 0 1 4.25 6m7 6a.75.75 0 0 1 .75-.75h8a.75.75 0 0 1 0 1.5h-8a.75.75 0 0 1-.75-.75m-3 6a.75.75 0 0 1 .75-.75h11a.75.75 0 0 1 0 1.5H9a.75.75 0 0 1-.75-.75" clip-rule="evenodd"/>');
const highlightIcon = filled('<path fill="#7C3AED" d="m5.83 16.441 2.088 2.089-1.34 1.339a.2.2 0 0 1-.18.055L3.37 19.34a.2.2 0 0 1-.103-.338z"/><path fill="#7A7A7A" fill-rule="evenodd" d="M19.01 3.638a2.86 2.86 0 0 0-3.885-.149l-7.804 6.695a2.86 2.86 0 0 0-.74 3.357l.154.337-1.058 1.058a.96.96 0 0 0 0 1.359l2.387 2.386a.96.96 0 0 0 1.359 0l1.058-1.058.336.154a2.86 2.86 0 0 0 3.358-.74l6.694-7.804a2.86 2.86 0 0 0-.148-3.884zm-2.908.99a1.36 1.36 0 0 1 1.847.07L19.66 6.41a1.36 1.36 0 0 1 .07 1.846l-5.088 5.932-4.472-4.472zM9.03 10.696l-.731.626a1.36 1.36 0 0 0-.352 1.597l.352.77c.137.3.081.665-.164.911l-1.015 1.015 1.624 1.625 1.015-1.015a.81.81 0 0 1 .911-.164l.77.351a1.36 1.36 0 0 0 1.597-.351l.627-.731z" clip-rule="evenodd"/>');

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
  text: textIcon,
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
  page: wrap('<path d="M5.5 3.5h6L15 7v9.5h-9.5z"/><path d="M11.5 3.5V7H15"/>'),
  plus: wrap('<path d="M10 4.5v11M4.5 10h11"/>'),
  drag: wrap(
    '<circle cx="7" cy="5" r="1.1" fill="currentColor" stroke="none"/><circle cx="13" cy="5" r="1.1" fill="currentColor" stroke="none"/><circle cx="7" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="13" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="7" cy="15" r="1.1" fill="currentColor" stroke="none"/><circle cx="13" cy="15" r="1.1" fill="currentColor" stroke="none"/>'
  ),
  copy: wrap('<rect x="7" y="7" width="10" height="10" rx="2.5"/><path d="M13 4.5A2.5 2.5 0 0 0 10.5 3H6a3 3 0 0 0-3 3v4.5A2.5 2.5 0 0 0 5.5 13"/>'),
  trash: wrap('<path d="M3.5 5.5h13M8 3.5h4M5.5 5.5l.7 10a2 2 0 0 0 2 1.9h3.6a2 2 0 0 0 2-1.9l.7-10M8.4 9v5M11.6 9v5"/>'),
  duplicate: wrap('<rect x="6.5" y="6.5" width="10" height="10" rx="2.5"/><path d="M13.5 6V5A2 2 0 0 0 11.5 3H5A2 2 0 0 0 3 5v6.5A2 2 0 0 0 5 13.5h1"/>'),
  indent: wrap('<path d="M3 5h14M9 10h8M9 15h8M3 8.5 5.5 11 3 13.5"/>'),
  outdent: wrap('<path d="M3 5h14M9 10h8M9 15h8M6 8.5 3.5 11 6 13.5"/>'),
  bold: boldIcon,
  italic: italicIcon,
  underline: underlineIcon,
  strike: strikeIcon,
  inlineCode: codeIcon,
  link: linkIcon,
  check: wrap('<path d="m4 10.5 4 4L16 5.5"/>'),
  chevron: wrap('<path d="m6 8 4 4 4-4"/>'),
  more: wrap('<circle cx="4.5" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10" r="1.2" fill="currentColor" stroke="none"/>'),
  arrowLeft: wrap('<path d="M16 10H4M8.5 5.5 4 10l4.5 4.5"/>'),
  arrowRight: wrap('<path d="M4 10h12M11.5 5.5 16 10l-4.5 4.5"/>'),
  arrowUp: wrap('<path d="M10 16V4M5.5 8.5 10 4l4.5 4.5"/>'),
  arrowDown: wrap('<path d="M10 4v12M5.5 11.5 10 16l4.5-4.5"/>'),
  x: wrap('<path d="m5 5 10 10M15 5 5 15"/>'),
  table: wrap('<rect x="2.5" y="3.5" width="15" height="13" rx="2.5"/><path d="M2.5 8h15M8 3.5v13M13 3.5v13M2.5 12.5h15"/>'),
  database: wrap('<ellipse cx="10" cy="5.2" rx="6.5" ry="2.7"/><path d="M3.5 5.2v9.6c0 1.5 2.9 2.7 6.5 2.7s6.5-1.2 6.5-2.7V5.2M3.5 10c0 1.5 2.9 2.7 6.5 2.7s6.5-1.2 6.5-2.7"/>'),
  hash: wrap('<path d="M7.5 3.5 6 16.5M13 3.5l-1.5 13M3.5 7.5h13M3 12.5h13"/>'),
  calendar: wrap('<rect x="3" y="4.5" width="14" height="12.5" rx="2.5"/><path d="M3 8.5h14M6.5 3v3M13.5 3v3"/>'),
  tag: wrap('<path d="M3.5 9.2V4.2a1 1 0 0 1 1-1h5l7.1 7.1a1.5 1.5 0 0 1 0 2.1l-4.9 4.9a1.5 1.5 0 0 1-2.1 0L3.5 9.2Z"/><circle cx="7" cy="6.9" r="1"/>'),
  file: wrap('<path d="M5 3.5h6.5L15.5 7v9.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 5 3.5Z"/><path d="M11 3.5V7h4"/>'),
  user: wrap('<circle cx="10" cy="6.5" r="3"/><path d="M4.5 16.5c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8"/>'),
  checkboxSquare: wrap('<rect x="3" y="3" width="14" height="14" rx="3.5"/><path d="m6.3 10.2 2.4 2.4 5-5"/>'),
  sortAsc: wrap('<path d="M6 15V5M3 8l3-3 3 3M11 7h6M11 10.5h4M11 14h2"/>'),
  sortDesc: wrap('<path d="M6 5v10M3 12l3 3 3-3M11 7h2M11 10.5h4M11 14h6"/>'),
  trashSmall: wrap('<path d="M4 6h12M8 3.5h4M6 6l.6 9.5a1.5 1.5 0 0 0 1.5 1.4h3.8a1.5 1.5 0 0 0 1.5-1.4L14 6"/>'),
  alignLeft: alignLeftIcon,
  alignCenter: alignCenterIcon,
  alignRight: alignRightIcon,
  clock: wrap('<circle cx="10" cy="10" r="7"/><path d="M10 6v4.3l2.8 1.7"/>'),
  highlight: highlightIcon,
  turnInto: textIcon,
  filter: wrap('<path d="M3.5 5.5h13M6 10h8M8.5 14.5h3"/>'),
  sort: wrap('<path d="M7 16V4M4 7l3-3 3 3M12 6h5M12 10h3.5M12 14h2"/>'),
  columns: wrap('<rect x="3" y="3.5" width="14" height="13" rx="2.5"/><path d="M8 3.5v13M13 3.5v13"/>'),
  group: wrap('<rect x="3" y="3.5" width="6" height="5" rx="1.5"/><rect x="11" y="3.5" width="6" height="5" rx="1.5"/><rect x="3" y="11.5" width="6" height="5" rx="1.5"/><rect x="11" y="11.5" width="6" height="5" rx="1.5"/>'),
  expand: wrap('<path d="M3.5 7V3.5H7M13 3.5h3.5V7M16.5 13v3.5H13M7 16.5H3.5V13"/>'),
} as const;

export function blockIcon(type: BlockType, level?: HeadingLevel): string {
  switch (type) {
    case 'heading':
      switch (level) {
        case 2:
          return icon.h2;
        case 3:
          return icon.h3;
        case 4:
          return icon.h4;
        case 5:
          return icon.h5;
        case 6:
          return icon.h6;
        default:
          return icon.h1;
      }
    case 'bulleted':
      return icon.bulleted;
    case 'numbered':
      return icon.numbered;
    case 'todo':
      return icon.todo;
    case 'quote':
      return icon.quote;
    case 'callout':
      return icon.callout;
    case 'code':
      return icon.code;
    case 'divider':
      return icon.divider;
    case 'page':
      return icon.page;
    case 'table':
      return icon.table;
    default:
      return icon.text;
  }
}
