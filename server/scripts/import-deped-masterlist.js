#!/usr/bin/env node
/**
 * import-deped-masterlist.js — turn the published DepEd Masterlist of Schools
 * into the lookup file server/depedMasterlist.js reads.
 *
 *   node scripts/import-deped-masterlist.js <masterlist.xlsx|.csv> [more files...]
 *
 * Run it once per DepEd release. Several files can be passed at once because
 * the masterlist is often published split — public elementary, public
 * secondary, and private schools as separate downloads — and all of them have
 * to end up in one lookup or a private school's registration will come back
 * NOT_FOUND for no reason other than which file we happened to import.
 *
 * ── Why the column detection is so forgiving ──
 * There is no stable schema here. The header row moves down the sheet between
 * releases because of title banners, the School ID column has been called
 * "School ID", "BEIS School ID" and "SCHOOL_ID", and the region/division
 * columns come and go. A strict importer would need editing every year by
 * whoever happens to be holding it, which is how an importer stops being run.
 * So this one searches the first rows for whatever looks like a header, matches
 * columns by keyword, and reports what it found so a wrong guess is visible
 * immediately rather than after the file is in production.
 *
 * Anything it cannot classify is dropped with a count, not silently: a run that
 * drops half the rows should look wrong.
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const OUT_PATH = path.join(__dirname, '..', 'data', 'deped-schools.json');

/**
 * Column keywords, most specific first. First match wins, so "beis school id"
 * is tested before the bare "school id" that it also contains, and "division"
 * before "district" — the two are adjacent in these sheets and a sloppy order
 * puts the division into the district field.
 */
const COLUMN_RULES = [
  ['id', ['beis school id', 'beis id', 'school id', 'schoolid', 'school_id']],
  ['name', ['school name', 'name of school', 'schoolname', 'school_name']],
  ['region', ['region']],
  ['division', ['schools division', 'division office', 'division', 'sdo']],
  ['district', ['school district', 'district']],
  ['municipality', ['municipality', 'city', 'municipality/city']],
  ['province', ['province']],
  ['barangay', ['barangay', 'brgy']],
  ['street', ['street address', 'address', 'street']],
];

const clean = (v) => {
  if (v === null || v === undefined) return '';
  // ExcelJS hands back rich text and formula objects, not just strings.
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(r => r.text).join('').trim();
    if (v.text !== undefined) return String(v.text).trim();
    if (v.result !== undefined) return String(v.result).trim();
    return '';
  }
  return String(v).trim();
};

const headerKey = (v) => clean(v).toLowerCase().replace(/[^a-z0-9\s/]/g, ' ').replace(/\s+/g, ' ').trim();

/** Which of our fields a header cell names, or null. */
function classifyHeader(cellText) {
  const key = headerKey(cellText);
  if (!key) return null;
  for (const [field, keywords] of COLUMN_RULES) {
    if (keywords.some(k => key === k || key.includes(k))) return field;
  }
  return null;
}

/**
 * Find the header row and its column map in the first rows of a sheet.
 *
 * A row counts as the header only if it names both an id and a name column —
 * the two fields without which a row is useless. That test is what stops a
 * title banner or a merged subtitle from being mistaken for the header.
 */
function findHeader(rows, scanDepth = 25) {
  for (let i = 0; i < Math.min(rows.length, scanDepth); i++) {
    const map = {};
    rows[i].forEach((cell, colIdx) => {
      const field = classifyHeader(cell);
      if (field && map[field] === undefined) map[field] = colIdx;
    });
    if (map.id !== undefined && map.name !== undefined) return { headerRow: i, map };
  }
  return null;
}

/** Join the address-ish columns that happen to exist into one readable line. */
function composeAddress(get) {
  return ['street', 'barangay', 'municipality', 'province']
    .map(f => get(f))
    .filter(Boolean)
    .join(', ');
}

async function readXlsx(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheets = [];
  wb.eachSheet((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      // row.values is 1-based with a leading hole; drop it so column indexes
      // line up with the plain arrays the CSV reader produces.
      rows.push((row.values || []).slice(1));
    });
    if (rows.length) sheets.push({ name: ws.name, rows });
  });
  return sheets;
}

/**
 * Minimal CSV reader — quoted fields, doubled quotes, embedded newlines and
 * commas. Written out rather than pulled in as a dependency because this is the
 * only CSV in the project and it runs offline against a file a human chose.
 */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => String(cell).trim()));
}

async function readFileRows(file) {
  if (/\.csv$/i.test(file)) {
    return [{ name: path.basename(file), rows: parseCsv(fs.readFileSync(file, 'utf8')) }];
  }
  return readXlsx(file);
}

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('Usage: node scripts/import-deped-masterlist.js <masterlist.xlsx|.csv> [more...]');
    process.exit(1);
  }

  const byId = new Map();
  let skipped = 0;

  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.error(`✗ ${file} — no such file`);
      process.exit(1);
    }
    const sheets = await readFileRows(file);
    let fileKept = 0;

    for (const sheet of sheets) {
      const found = findHeader(sheet.rows);
      if (!found) {
        console.warn(`  ⏭ ${path.basename(file)} [${sheet.name}] — no School ID + School Name header found, skipped`);
        continue;
      }
      const { headerRow, map } = found;
      console.log(`  ▸ ${path.basename(file)} [${sheet.name}] header on row ${headerRow + 1}: ${Object.keys(map).join(', ')}`);

      for (let i = headerRow + 1; i < sheet.rows.length; i++) {
        const cells = sheet.rows[i];
        const get = (field) => (map[field] === undefined ? '' : clean(cells[map[field]]));

        const id = get('id').replace(/\D/g, '');
        const name = get('name');
        // Length band matches SCHOOL_ID_SHAPE in depedMasterlist.js; a row
        // failing it is a subtotal line, a repeated header, or a blank.
        if (!/^\d{5,9}$/.test(id) || !name) { skipped++; continue; }

        const record = { id, name };
        for (const field of ['region', 'division', 'district']) {
          const value = get(field);
          if (value) record[field] = value;
        }
        const address = composeAddress(get);
        if (address) record.address = address;

        // Later files win on a collision, which is why the private-school list
        // should be passed after the public ones if a school appears in both.
        if (!byId.has(id)) fileKept++;
        byId.set(id, record);
      }
    }
    console.log(`  ✓ ${path.basename(file)} — ${fileKept.toLocaleString()} new schools`);
  }

  if (!byId.size) {
    console.error('✗ No usable school rows found. Check that the file is the DepEd masterlist.');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify({
    source: files.map(f => path.basename(f)).join(', '),
    importedAt: new Date().toISOString(),
    schools: [...byId.values()],
  }));

  const sizeMb = (fs.statSync(OUT_PATH).size / 1024 / 1024).toFixed(1);
  console.log(`\n🏫 ${byId.size.toLocaleString()} schools → ${path.relative(process.cwd(), OUT_PATH)} (${sizeMb} MB)`);
  if (skipped) console.log(`   ${skipped.toLocaleString()} rows skipped (no usable School ID or name)`);
  console.log('   Restart the server to load it.');
}

main().catch(err => { console.error(err); process.exit(1); });
