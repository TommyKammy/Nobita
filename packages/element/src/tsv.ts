/** Spreadsheet-friendly TSV helpers shared by the table and database views. */

export function tsvCell(value: string): string {
  if (value === '') return '""';
  return /[\t\n\r"]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;
}

/** Parse TSV, including quoted tabs, newlines and escaped quotes. */
export function parseTsv(source: string): string[][] {
  const text = source.replace(/\r\n?/gu, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        fieldStarted = true;
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
        fieldStarted = true;
      }
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
      fieldStarted = true;
    } else if (char === '\t') {
      row.push(field);
      field = '';
      fieldStarted = false;
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      fieldStarted = false;
    } else {
      field += char;
      fieldStarted = true;
    }
  }
  if (fieldStarted || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
