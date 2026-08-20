/**
 * RFC 4180 CSV tokenizer.
 *
 * Hand-rolled deliberately: the repo carries zero parsing dependencies and this
 * is the only place that needs one. It is NOT a convenience wrapper over
 * `split(",")` — that approach corrupts real Shopify exports, and the very
 * first sample row proves both failure modes:
 *
 *   - `Tags` contains commas INSIDE a quoted field:
 *       "bosta_synced, Order Confirmation Queued, ..."
 *   - `Shipping Method` contains ESCAPED double quotes:
 *       "Normal Shipping ""2-5d"""
 *
 * Handled: quoted fields, `""` escapes, commas and newlines inside quotes,
 * CRLF/LF/CR line endings, and a UTF-8 BOM. Encoding is assumed UTF-8 — the
 * sample carries Arabic city names, so bytes must never be latin1-decoded.
 *
 * Not handled, by design: alternate delimiters, comment lines, and streaming.
 * Shopify exports are comma-delimited and small enough to read whole.
 */

/** One parsed record, keyed by header name. Values are always strings. */
export type CsvRecord = Record<string, string>;

export interface CsvTable {
  /** Header names in file order, verbatim (no trimming beyond BOM removal). */
  header: string[];
  /**
   * Data rows, header-keyed. Rows shorter than the header are padded with "";
   * rows longer than the header have their extra cells dropped (and are
   * reported in `raggedRows`).
   */
  records: CsvRecord[];
  /** Physical data rows read, excluding the header. */
  rowCount: number;
  /** 1-based file line numbers whose cell count did not match the header. */
  raggedRows: number[];
}

/**
 * Tokenize CSV text into a raw cell matrix. The first element is the header row.
 *
 * A trailing newline does not produce a spurious empty final record.
 */
export function tokenizeCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // True once the current field has begun, so a row of one empty unquoted
  // field is distinguishable from a blank line.
  let started = false;

  const endField = () => {
    row.push(field);
    field = "";
    started = false;
  };

  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          // Escaped quote: `""` inside a quoted field is one literal `"`.
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        // Newlines inside quotes are data, not row terminators.
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      started = true;
      continue;
    }

    if (char === ",") {
      endField();
      continue;
    }

    if (char === "\r") {
      // Consume CRLF as a single terminator; a lone CR also terminates.
      if (text[i + 1] === "\n") i++;
      endRow();
      continue;
    }

    if (char === "\n") {
      endRow();
      continue;
    }

    field += char;
    started = true;
  }

  // Flush the final row unless the file ended exactly on a row terminator.
  if (started || field.length > 0 || row.length > 0) {
    endRow();
  }

  return rows;
}

/**
 * Tokenize and bind rows to header names.
 *
 * Blank lines are skipped rather than emitted as empty records: Shopify exports
 * routinely end with one, and an all-empty record would otherwise be adapted
 * into a phantom order.
 */
export function parseCsv(input: string): CsvTable {
  const rows = tokenizeCsv(input);

  if (rows.length === 0) {
    return { header: [], records: [], rowCount: 0, raggedRows: [] };
  }

  const header = rows[0];
  const records: CsvRecord[] = [];
  const raggedRows: number[] = [];
  let rowCount = 0;

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];

    // A blank physical line tokenizes to a single empty cell.
    if (cells.length === 1 && cells[0] === "") continue;

    rowCount++;
    if (cells.length !== header.length) {
      // +1 converts to a 1-based file line number for the header row offset.
      raggedRows.push(r + 1);
    }

    const record: CsvRecord = {};
    for (let c = 0; c < header.length; c++) {
      record[header[c]] = cells[c] ?? "";
    }
    records.push(record);
  }

  return { header, records, rowCount, raggedRows };
}
