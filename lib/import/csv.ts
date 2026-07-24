export interface CsvRow {
  cells: string[];
  startLine: number;
}

export interface CsvSyntaxIssue {
  code: "CSV_UNCLOSED_QUOTE";
  line: number;
  message: string;
}

export interface ParsedCsv {
  rows: CsvRow[];
  issues: CsvSyntaxIssue[];
}

/**
 * RFC 4180-style parser supporting BOMs, CRLF/LF, escaped quotes, commas, and
 * embedded newlines. It deliberately returns cells only; the importer drops
 * them after normalization and never includes them in its result.
 */
export function parseCsv(csv: string): ParsedCsv {
  const source = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  const rows: CsvRow[] = [];
  const issues: CsvSyntaxIssue[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;

  const finishRow = () => {
    cells.push(field);
    rows.push({ cells, startLine: rowStartLine });
    cells = [];
    field = "";
    rowStartLine = line + 1;
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
        if (character === "\n") {
          line += 1;
        }
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      inQuotes = true;
    } else if (character === ",") {
      cells.push(field);
      field = "";
    } else if (character === "\n") {
      finishRow();
      line += 1;
    } else if (character === "\r") {
      if (source[index + 1] === "\n") {
        continue;
      }
      finishRow();
      line += 1;
    } else {
      field += character;
    }
  }

  if (inQuotes) {
    issues.push({
      code: "CSV_UNCLOSED_QUOTE",
      line: rowStartLine,
      message: "The CSV contains a quoted field that was never closed.",
    });
  }

  if (field.length > 0 || cells.length > 0) {
    cells.push(field);
    rows.push({ cells, startLine: rowStartLine });
  }

  return { rows, issues };
}

export function isBlankCsvRow(row: CsvRow): boolean {
  return row.cells.every((cell) => cell.trim().length === 0);
}
