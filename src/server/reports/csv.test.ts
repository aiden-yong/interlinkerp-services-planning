import { describe, expect, it } from 'vitest';
import { csvFilename, toCsv } from './csv';

describe('csv', () => {
  it('quotes and neutralises awkward cells', () => {
    expect(toCsv(['Name', 'Hours'], [['Tan, Ah "Boy"', 7.5], ['=SUM(A1)', 0], ['李明\nline', null]])).toBe(
      '﻿Name,Hours\r\n"Tan, Ah ""Boy""",7.50\r\n\'=SUM(A1),0.00\r\n"李明\nline",\r\n',
    );
  });

  it('names the file', () => {
    expect(csvFilename('planned-hours', '2026-10-01', '2026-10-31')).toBe('planned-hours_2026-10-01_2026-10-31.csv');
  });
});
