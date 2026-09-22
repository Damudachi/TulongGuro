/**
 * Reading .xlsx files that exceljs cannot open on its own.
 *
 * exceljs matches the SpreadsheetML parts by bare tag name — `workbook`,
 * `sheets`, `worksheet`, `row`, `c`. That is only correct when the file binds
 * the SpreadsheetML namespace as the DEFAULT namespace, which is what Excel
 * itself writes:
 *
 *     <workbook xmlns="…/spreadsheetml/2006/main"><sheets>…
 *
 * Binding it to a PREFIX instead is equally valid XML and some generators do
 * exactly that — several .NET writers, a few online converters, and at least
 * one spreadsheet export we were handed:
 *
 *     <x:workbook xmlns:x="…/spreadsheetml/2006/main"><x:sheets>…
 *
 * Against that file exceljs's workbook xform matches nothing, `parseWorkbook`
 * resolves to undefined, and the load dies on `workbook.sheets` with
 * "Cannot read properties of undefined (reading 'sheets')" — a TypeError from
 * inside the library, with nothing in it that names the real problem. The
 * teacher sees a 500 and a file that "just does not work", while a PHOTO of the
 * same list imports fine, because that path goes to the vision model and a
 * model does not care about XML namespaces.
 *
 * So: rewrite the prefix away and hand exceljs the file it expects. This is a
 * lossless transform of the packaging, not of the data — the prefix and the
 * default namespace denote the same namespace, so the document means exactly
 * the same thing before and after.
 *
 * Only the SpreadsheetML main namespace is touched. `r:id` and friends live in
 * the relationships namespace and MUST keep their prefix: exceljs reads the
 * attribute as the literal string "r:id", so flattening it would break the
 * sheet-to-relationship lookup and lose every worksheet.
 */

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/** Escape a string for literal use inside a RegExp. */
function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

const NS_PATTERN = escapeForRegExp(MAIN_NS);

/**
 * Rebind the SpreadsheetML namespace from a prefix to the default namespace.
 * Returns null when the part does not bind it to a prefix — either it already
 * uses the default namespace, or it is a packaging part (`[Content_Types].xml`,
 * `.rels`) that has nothing to do with SpreadsheetML.
 */
function flattenMainNamespace(xml) {
  const declared = new RegExp(`xmlns:([A-Za-z0-9_.-]+)\\s*=\\s*"${NS_PATTERN}"`).exec(xml);
  if (!declared) return null;
  const prefix = escapeForRegExp(declared[1]);
  return xml
    .replace(new RegExp(`xmlns:${prefix}\\s*=\\s*"${NS_PATTERN}"`, 'g'), `xmlns="${MAIN_NS}"`)
    .replace(new RegExp(`<${prefix}:`, 'g'), '<')
    .replace(new RegExp(`</${prefix}:`, 'g'), '</');
}

/**
 * Repackage a workbook so exceljs can read it, or null when nothing needed
 * changing — the caller then keeps whatever error the first attempt raised
 * rather than reporting a repair that did nothing.
 *
 * A leading byte-order mark is stripped in the same pass. The generators that
 * emit prefixed namespaces tend to emit BOMs too, and a BOM ahead of the XML
 * declaration is another thing a streaming parser is entitled to reject.
 */
async function repackageForExcelJs(buffer) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  let repaired = false;

  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    if (entry.dir || !/\.(xml|rels)$/i.test(name)) continue;

    let xml = await entry.async('string');
    let changed = false;

    if (xml.charCodeAt(0) === 0xFEFF) {
      xml = xml.slice(1);
      changed = true;
    }
    const flattened = flattenMainNamespace(xml);
    if (flattened !== null) {
      xml = flattened;
      changed = true;
    }
    if (changed) {
      zip.file(name, xml);
      repaired = true;
    }
  }

  return repaired ? zip.generateAsync({ type: 'nodebuffer' }) : null;
}

/**
 * Open a roster workbook, repairing the packaging only if the direct read
 * fails.
 *
 * The happy path is untouched: a file Excel wrote is read exactly as before,
 * and nothing is unzipped twice. The repair runs only after exceljs has
 * already given up, so a file that was working cannot regress through here.
 *
 * Throws the ORIGINAL error when the repair does not apply or does not help.
 * That error is the honest one — "this file is not readable" — and the caller
 * turns it into a message a teacher can act on. Swapping in the second failure
 * would report the symptom of our own retry instead.
 */
async function readRosterWorkbook(filePath) {
  const fs = require('fs');
  const ExcelJS = require('exceljs');

  const direct = new ExcelJS.Workbook();
  try {
    await direct.xlsx.readFile(filePath);
    return direct;
  } catch (firstError) {
    let repackaged = null;
    try {
      repackaged = await repackageForExcelJs(fs.readFileSync(filePath));
    } catch {
      throw firstError;
    }
    if (!repackaged) throw firstError;

    const retried = new ExcelJS.Workbook();
    try {
      await retried.xlsx.load(repackaged);
    } catch {
      throw firstError;
    }
    return retried;
  }
}

module.exports = { flattenMainNamespace, repackageForExcelJs, readRosterWorkbook, MAIN_NS };
