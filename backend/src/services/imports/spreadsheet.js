'use strict';

const ExcelJS = require('exceljs');
const { DateTime } = require('luxon');

/**
 * Reading uploaded spreadsheets (.xlsx or .csv) for the import screens.
 *
 * Headers are matched loosely ("Phone", "Phone number", "Simu" all work), so
 * people can use their own sheets as long as the column names are close to
 * the template's. Values are returned as plain strings, numbers, booleans or
 * Date objects; the per-type import rules decide what they mean.
 */

const MAX_ROWS = 5000;

/** Lower-case letters and digits only: "Date of birth" → "dateofbirth". */
function normalizeHeader(value) {
  return String(value ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

function cellValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
    if ('result' in value) return cellValue(value.result); // formula
    if ('text' in value) return cellValue(value.text); // hyperlink
    if ('error' in value) return null;
    return String(value);
  }
  return value;
}

function isBlank(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/** Minimal RFC 4180 CSV reader; keeps every value as text (no guessing). */
function parseCsv(text) {
  const content = text.replace(/^﻿/, '');
  const firstLine = content.split(/\r?\n/, 1)[0] || '';
  const delimiter = [';', '\t', ','].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ',');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (quoted) {
      if (ch === '"' && content[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && content[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function readGrid(buffer, fileName, preferredSheet) {
  if (/\.csv$/i.test(fileName)) {
    if (buffer.includes(0)) throw new Error('This does not look like a CSV text file.');
    return parseCsv(buffer.toString('utf8'));
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new Error('The file could not be read as an Excel workbook (.xlsx). Save it as .xlsx or .csv and try again.');
  }
  const sheets = workbook.worksheets.filter((ws) => ws.actualRowCount > 0);
  const sheet = sheets.find((ws) => normalizeHeader(ws.name) === normalizeHeader(preferredSheet)) || sheets[0];
  if (!sheet) return [];
  const grid = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const values = [];
    for (let c = 1; c <= sheet.columnCount; c += 1) values.push(cellValue(row.getCell(c).value));
    grid[rowNumber - 1] = values;
  });
  return Array.from(grid, (r) => r || []);
}

/**
 * Parse an uploaded file into rows keyed by column key.
 * columns: [{ key, label, aliases: [] }]
 * Returns { rows: [{ rowNumber, values }], mapped: [{ key, header }], unknown: [header] }.
 */
async function parseSpreadsheet(buffer, fileName, columns, { sheetName } = {}) {
  const grid = await readGrid(buffer, fileName, sheetName);
  const headerIndex = grid.findIndex((r) => r.some((v) => !isBlank(v)));
  if (headerIndex === -1) throw new Error('The file is empty.');

  const lookup = new Map();
  for (const column of columns) {
    for (const name of [column.key, column.label, ...(column.aliases || [])]) lookup.set(normalizeHeader(name), column.key);
  }
  const headers = grid[headerIndex].map((h) => (isBlank(h) ? '' : String(cellValue(h)).trim()));
  const keys = headers.map((h) => lookup.get(normalizeHeader(h.replace(/\*$/, ''))) || null);
  const mapped = [];
  const seen = new Set();
  headers.forEach((header, i) => {
    if (keys[i] && !seen.has(keys[i])) {
      seen.add(keys[i]);
      mapped.push({ key: keys[i], header });
    } else if (keys[i]) {
      keys[i] = null; // a second column for the same field is ignored
    }
  });
  const unknown = headers.filter((h, i) => h && !keys[i]);

  const rows = [];
  for (let i = headerIndex + 1; i < grid.length; i += 1) {
    const raw = grid[i] || [];
    if (!raw.some((v) => !isBlank(v))) continue;
    const values = {};
    keys.forEach((key, c) => {
      if (key) values[key] = isBlank(raw[c]) ? null : typeof raw[c] === 'string' ? raw[c].trim() : raw[c];
    });
    rows.push({ rowNumber: i + 1, values });
    if (rows.length > MAX_ROWS) throw new Error(`The file has more than ${MAX_ROWS.toLocaleString('en')} rows. Split it into smaller files.`);
  }
  return { rows, mapped, unknown };
}

// ---- Value readers ------------------------------------------------------------------------

function text(value) {
  if (isBlank(value)) return undefined;
  if (value instanceof Date) return DateTime.fromJSDate(value, { zone: 'utc' }).toISODate();
  return String(value).trim();
}

/** "15,000", "TSh 15 000", 15000 → 15000. Returns NaN when it is not a number. */
function number(value) {
  if (isBlank(value)) return undefined;
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  return cleaned === '' || cleaned === '-' ? Number.NaN : Number(cleaned);
}

const TRUE = new Set(['yes', 'y', 'true', '1', 'ndiyo', 'ndio', 'x']);
const FALSE = new Set(['no', 'n', 'false', '0', 'hapana']);
function boolean(value) {
  if (isBlank(value)) return undefined;
  if (typeof value === 'boolean') return value;
  const v = String(value).trim().toLowerCase();
  if (TRUE.has(v)) return true;
  if (FALSE.has(v)) return false;
  return null;
}

const DATE_FORMATS = ['yyyy-MM-dd', 'd/M/yyyy', 'd-M-yyyy', 'd.M.yyyy', 'd MMM yyyy', 'd MMMM yyyy', 'd/M/yy', 'yyyy/M/d'];

/**
 * A calendar date from an Excel date cell, an Excel serial number or text
 * (day first: 01/09/2026 is 1 September). Returns { date: 'YYYY-MM-DD',
 * time: 'HH:mm' | null } or null when it cannot be read.
 */
function dateTime(value) {
  if (isBlank(value)) return undefined;
  let dt = null;
  if (value instanceof Date) {
    dt = DateTime.fromJSDate(value, { zone: 'utc' }); // Excel stores wall-clock time
  } else if (typeof value === 'number' && value > 20000 && value < 80000) {
    dt = DateTime.fromISO('1899-12-30', { zone: 'utc' }).plus({ milliseconds: Math.round(value * 86400000) });
  } else {
    const raw = String(value).trim().replace(/\s+/g, ' ');
    for (const format of DATE_FORMATS) {
      for (const f of [format, `${format} H:mm`, `${format} H:mm:ss`, `${format}'T'H:mm`, `${format}'T'H:mm:ss`]) {
        const parsed = DateTime.fromFormat(raw, f, { zone: 'utc', locale: 'en' });
        if (parsed.isValid) {
          dt = parsed;
          break;
        }
      }
      if (dt) break;
    }
  }
  if (!dt || !dt.isValid || dt.year < 1900 || dt.year > 2100) return null;
  const hasTime = dt.hour !== 0 || dt.minute !== 0;
  return { date: dt.toISODate(), time: hasTime ? dt.toFormat('HH:mm') : null };
}

/** A time of day from a time cell, an Excel fraction or text such as 14:30 or 2:30 PM. */
function timeOfDay(value) {
  if (isBlank(value)) return undefined;
  if (value instanceof Date) return DateTime.fromJSDate(value, { zone: 'utc' }).toFormat('HH:mm');
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const minutes = Math.round(value * 24 * 60);
    return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  const raw = String(value).trim().toUpperCase();
  for (const f of ['H:mm', 'H:mm:ss', 'h:mm a', 'h:mma', 'h a', 'ha']) {
    const parsed = DateTime.fromFormat(raw, f, { locale: 'en' });
    if (parsed.isValid) return parsed.toFormat('HH:mm');
  }
  return null;
}

module.exports = { parseSpreadsheet, parseCsv, normalizeHeader, text, number, boolean, dateTime, timeOfDay, MAX_ROWS };
