const BOM = '﻿';
const NEUTRALISE = new Set(['=', '+', '-', '@', '\t', '\r']);

function cell(value: string | number | null): string {
  if (value === null) return '';
  let text = typeof value === 'number' ? value.toFixed(2) : value;
  if (typeof value === 'string' && text !== '' && NEUTRALISE.has(text[0])) text = `'${text}`;
  return /[,"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** D7: UTF-8 BOM, CRLF lines, spreadsheet-formula-safe cells. */
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  return BOM + [header, ...rows].map((r) => r.map(cell).join(',') + '\r\n').join('');
}

export function csvFilename(report: 'planned-hours' | 'utilisation' | 'open-shifts', from: string, to: string): string {
  return `${report}_${from}_${to}.csv`;
}
