#!/usr/bin/env node
/**
 * validate-deped-masterlist.js — is the imported masterlist actually usable?
 *
 *   node scripts/validate-deped-masterlist.js
 *
 * Run after import-deped-masterlist.js and before restarting the server. The
 * importer's job is to parse whatever it is handed; this one's job is to doubt
 * the result.
 *
 * ── Why this exists ──
 * DepEd publishes no downloadable masterlist any more — the .xlsx linked from
 * their own site is a dead link — so the file being imported is increasingly
 * likely to be somebody's scrape or re-export rather than an official release.
 * A partial scrape is the dangerous case, because it does not look partial: it
 * imports cleanly, reports a large number, and then quietly answers NOT_FOUND
 * for every school it happens to be missing. Those schools are real, and they
 * get pushed onto the attach-a-permit path for no reason but our bad data.
 *
 * That failure is invisible without a reference point, so this holds two: the
 * total EBEIS itself reports, and a handful of records read out of the live
 * EBEIS report by hand. Nothing here proves the file is correct. It is enough
 * to catch the ways it has actually been wrong.
 *
 * Exits non-zero if a check fails, so it can gate a deploy step.
 */

const fs = require('fs');
const path = require('path');

const FILE = process.env.DEPED_MASTERLIST_PATH
  || path.join(__dirname, '..', 'data', 'deped-schools.json');

/** What the EBEIS "List of Schools" report itself reported, unfiltered, when
 *  this was written (Aug 2026). A file far below this is missing schools. */
const EXPECTED_TOTAL = 83107;

/** Below this fraction of EXPECTED_TOTAL the file is treated as a bad import
 *  rather than a slightly older release. Deliberately loose: DepEd's own count
 *  moves between releases, and the check is for "half the file is gone", not
 *  for an exact match. */
const MIN_FRACTION = 0.9;

/**
 * Records read directly out of the EBEIS report. Chosen to be awkward on
 * purpose: a leading-parenthesis name and a leading-digit name are exactly the
 * rows a sloppy CSV parse mangles, and they cover both a private and a public
 * school so an export that silently dropped one shows up here.
 */
const KNOWN = [
  { id: '136566', name: '15th Avenue Elementary School' },
  { id: '488019', name: '(FTJCA) Family Tabernacle of Jesus Christ Almighty Christian Academy' },
  { id: '406570', name: '(HIS) Hope Integrated School, Inc' },
];

/** Same shape the lookup enforces, so a row this rejects is a row that could
 *  never have been matched at registration anyway. */
const ID_SHAPE = /^\d{5,9}$/;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

function main() {
  if (!fs.existsSync(FILE)) {
    console.error(`✗ ${FILE} does not exist. Run scripts/import-deped-masterlist.js first.`);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    console.error(`✗ ${FILE} is not readable JSON: ${err.message}`);
    process.exit(1);
  }

  const schools = data.schools || [];
  console.log(`\nMasterlist: ${path.relative(process.cwd(), FILE)}`);
  console.log(`Source: ${data.source || '(not recorded)'}`);
  console.log(`Imported: ${data.importedAt || '(not recorded)'}\n`);

  // ── Size ──
  const pct = ((schools.length / EXPECTED_TOTAL) * 100).toFixed(1);
  check(
    schools.length >= EXPECTED_TOTAL * MIN_FRACTION,
    `Row count ${schools.length.toLocaleString()} (${pct}% of the ${EXPECTED_TOTAL.toLocaleString()} EBEIS reports)`,
    schools.length >= EXPECTED_TOTAL * MIN_FRACTION ? '' : 'looks like a partial scrape — schools that are missing will be told they do not exist',
  );

  // ── Shape and uniqueness ──
  const byId = new Map();
  let badId = 0, noName = 0, dupes = 0;
  for (const s of schools) {
    if (!ID_SHAPE.test(String(s.id || ''))) { badId++; continue; }
    if (!String(s.name || '').trim()) { noName++; continue; }
    if (byId.has(s.id)) dupes++;
    else byId.set(String(s.id), s);
  }
  check(badId === 0, `School IDs all match the lookup's shape`, badId ? `${badId} rows do not` : '');
  check(noName === 0, `Every row has a name`, noName ? `${noName} rows do not` : '');
  // Not fatal: the importer keeps the last of a duplicate pair on purpose.
  console.log(`  · ${dupes} duplicate IDs collapsed`);

  // ── Known records ──
  // The check that matters most: a file can be the right size and still be the
  // wrong data, or right data parsed into the wrong columns.
  for (const want of KNOWN) {
    const got = byId.get(want.id);
    if (!got) { check(false, `${want.id} present`, `missing — expected "${want.name}"`); continue; }
    const same = norm(got.name) === norm(want.name);
    check(same, `${want.id} → ${got.name}`, same ? '' : `expected "${want.name}"`);
  }

  // ── Coverage ──
  // Every region should appear. One missing region is ~5% of the country and
  // is the signature of a crawl that died partway, which is how the first
  // attempt at this failed.
  const regions = new Set(schools.map(s => s.region).filter(Boolean));
  if (regions.size) {
    check(regions.size >= 17, `${regions.size} distinct regions present`,
      regions.size >= 17 ? '' : `expected ~19 — [${[...regions].sort().join(', ')}]`);
  } else {
    console.log('  · no region column in this file (optional — only affects the note an operator sees)');
  }

  // A masterlist with no private schools makes every private registration
  // NOT_FOUND, which is the specific failure the README warns about.
  const looksPrivate = schools.filter(s => /\b(academy|christian|montessori|colleg|institute|inc\b)/i.test(s.name || ''));
  check(looksPrivate.length > 1000, `${looksPrivate.length.toLocaleString()} rows look like private schools`,
    looksPrivate.length > 1000 ? '' : 'this may be a public-schools-only export — private registrations would all fall to the permit path');

  console.log(
    failures
      ? `\n✗ ${failures} check(s) failed. Do not restart the server on this file — delete it and the lookup safely returns NO_MASTERLIST instead of wrong answers.\n`
      : `\n✅ ${byId.size.toLocaleString()} schools look usable. Restart the server to load it.\n`,
  );
  process.exit(failures ? 1 : 0);
}

main();
