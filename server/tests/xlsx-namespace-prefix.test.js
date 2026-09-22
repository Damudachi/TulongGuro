import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { flattenMainNamespace, repackageForExcelJs, readRosterWorkbook, MAIN_NS } from '../xlsxCompat.js';
import { cellToText, extractRoster } from '../rosterSheet.js';

/**
 * Opening a class list whose .xlsx binds SpreadsheetML to a prefix.
 *
 * This is the failure a teacher actually hit: the spreadsheet import said the
 * file could not be read, while a PHOTO of the same list imported fine. The
 * file was valid — it simply wrote `<x:workbook xmlns:x="…">` instead of
 * `<workbook xmlns="…">`, which exceljs cannot match, and the load died on a
 * TypeError deep inside the library.
 *
 * Pinned because the symptom points away from the cause. Nothing about
 * "cannot read properties of undefined (reading 'sheets')" suggests a
 * namespace prefix, so without a test this is a bug that gets rediscovered.
 */

/** The minimum set of parts that makes a real, loadable .xlsx. */
function buildWorkbookZip({ prefix, bom }) {
  const p = prefix ? `${prefix}:` : '';
  const nsDecl = prefix ? `xmlns:${prefix}="${MAIN_NS}"` : `xmlns="${MAIN_NS}"`;
  const mark = bom ? '﻿' : '';

  const rows = [
    ['Last Name', 'First Name', 'MI', 'Birthday'],
    ['Reyes', 'Miguel', 'A.', '11/08/2014'],
    ['Santos', 'Angela', 'M.', '02/17/2015'],
  ];
  const col = i => String.fromCharCode(65 + i);
  const sheetRows = rows.map((cells, r) =>
    `<${p}row r="${r + 1}">` +
    cells.map((v, c) => `<${p}c r="${col(c)}${r + 1}" t="str"><${p}v>${v}</${p}v></${p}c>`).join('') +
    `</${p}row>`
  ).join('');

  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    `${mark}<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" />` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" />` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" />` +
    `</Types>`);
  zip.file('_rels/.rels',
    `${mark}<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/xl/workbook.xml" Id="Rwb1" /></Relationships>`);
  zip.file('xl/_rels/workbook.xml.rels',
    `${mark}<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml" Id="Rsheet1" /></Relationships>`);
  zip.file('xl/workbook.xml',
    `<?xml version="1.0" encoding="utf-8"?><${p}workbook ${nsDecl}><${p}sheets>` +
    `<${p}sheet name="Mock Students" sheetId="1" r:id="Rsheet1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" />` +
    `</${p}sheets></${p}workbook>`);
  zip.file('xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="utf-8"?><${p}worksheet ${nsDecl}><${p}sheetData>${sheetRows}</${p}sheetData></${p}worksheet>`);

  return zip.generateAsync({ type: 'nodebuffer' });
}

function gridOf(sheet) {
  const grid = [];
  for (let r = 1; r <= (sheet.rowCount || 0); r++) {
    const row = sheet.getRow(r);
    const cells = [];
    for (let c = 1; c <= (sheet.columnCount || 0); c++) cells.push(cellToText(row.getCell(c).value));
    grid.push(cells);
  }
  return grid;
}

async function writeTemp(buffer, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-xlsx-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, buffer);
  return file;
}

describe('flattenMainNamespace', () => {
  it('rebinds a prefixed SpreadsheetML namespace to the default one', () => {
    const out = flattenMainNamespace(`<x:workbook xmlns:x="${MAIN_NS}"><x:sheets /></x:workbook>`);
    expect(out).toBe(`<workbook xmlns="${MAIN_NS}"><sheets /></workbook>`);
  });

  it('leaves the relationships prefix alone — exceljs reads "r:id" literally', () => {
    const out = flattenMainNamespace(
      `<x:sheet xmlns:x="${MAIN_NS}" r:id="Rsheet1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" />`
    );
    expect(out).toContain('r:id="Rsheet1"');
    expect(out).toContain('xmlns:r=');
  });

  it('returns null for a part that already uses the default namespace', () => {
    expect(flattenMainNamespace(`<workbook xmlns="${MAIN_NS}" />`)).toBeNull();
  });

  it('returns null for a packaging part that never mentions SpreadsheetML', () => {
    expect(flattenMainNamespace('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types" />')).toBeNull();
  });
});

describe('repackageForExcelJs', () => {
  it('reports no change for a workbook that was already readable', async () => {
    const plain = await buildWorkbookZip({ prefix: null, bom: false });
    expect(await repackageForExcelJs(plain)).toBeNull();
  });

  it('strips a byte-order mark ahead of the XML declaration', async () => {
    const withBom = await buildWorkbookZip({ prefix: null, bom: true });
    const repaired = await repackageForExcelJs(withBom);
    expect(repaired).not.toBeNull();
    const rels = await (await JSZip.loadAsync(repaired)).file('_rels/.rels').async('string');
    expect(rels.charCodeAt(0)).not.toBe(0xFEFF);
  });
});

describe('readRosterWorkbook', () => {
  it('reads a prefixed workbook that exceljs alone cannot open', async () => {
    const buffer = await buildWorkbookZip({ prefix: 'x', bom: true });

    // The bug itself: prove exceljs fails on this file before proving we fix it.
    await expect(new ExcelJS.Workbook().xlsx.load(buffer)).rejects.toThrow();

    const file = await writeTemp(buffer, 'prefixed.xlsx');
    const workbook = await readRosterWorkbook(file);
    const sheet = workbook.worksheets[0];
    expect(sheet).toBeTruthy();
    expect(sheet.name).toBe('Mock Students');

    const { students } = extractRoster(gridOf(sheet));
    expect(students.map(s => s.name)).toEqual(['Reyes, Miguel', 'Santos, Angela']);
    expect(students[0].birthday).toBe('11/08/2014');
  });

  it('still reads an ordinary workbook without repackaging it', async () => {
    const file = await writeTemp(await buildWorkbookZip({ prefix: null, bom: false }), 'plain.xlsx');
    const sheet = (await readRosterWorkbook(file)).worksheets[0];
    expect(extractRoster(gridOf(sheet)).students).toHaveLength(2);
  });

  it('rethrows the original failure for a file that is not a workbook at all', async () => {
    const file = await writeTemp(Buffer.from('this is not a spreadsheet'), 'junk.xlsx');
    await expect(readRosterWorkbook(file)).rejects.toThrow();
  });
});
