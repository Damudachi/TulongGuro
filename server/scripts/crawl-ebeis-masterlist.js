#!/usr/bin/env node
/**
 * crawl-ebeis-masterlist.js — build the school lookup from EBEIS directly,
 * instead of trusting somebody else's scrape of it.
 *
 *   node scripts/crawl-ebeis-masterlist.js              # crawl, then merge
 *   node scripts/crawl-ebeis-masterlist.js --merge-only # rebuild JSON from cache
 *   node scripts/crawl-ebeis-masterlist.js --regions=1,13
 *   node scripts/crawl-ebeis-masterlist.js --ids=gaps.txt  # fetch listed IDs one by one
 *
 * ── Why this exists ──
 * The file this replaces came from a third-party export that was itself a
 * page-by-page scrape of EBEIS, and roughly 200 of its pages failed. Nobody
 * noticed, because a partial scrape does not look partial: it imports cleanly,
 * reports 76,354 schools, and then tells ~6,750 real schools that they do not
 * exist. School ID 107033 — Pulung Cacutud ES, in Angeles City — was one of
 * them, sitting in a hole between two schools we did have.
 *
 * The fix is to stop being a consumer of somebody else's crawl and to run our
 * own, where a page that fails is a page we can see failed and re-fetch.
 *
 * ── Why it is slow on purpose ──
 * EBEIS answers 30 rows a page over ~2,800 pages and rate-limits a concurrent
 * crawler into an IP-level 403. So this is deliberately sequential with a pause
 * between requests: about an hour end to end, unattended. Going faster is how
 * the previous attempt lost 200 pages, and a fast crawl that loses pages is
 * strictly worse than a slow one that does not — the whole cost of this bug was
 * paid by schools whose registrations were refused.
 *
 * ── Why every page is cached to disk ──
 * Each page is written to data/ebeis-raw/ as it arrives and re-runs skip what
 * is already there. A crawl that dies at page 2,000 — 403, laptop asleep, wifi
 * — resumes at 2,000 rather than starting over. That is also what makes a
 * targeted repair possible: delete the pages you doubt, re-run, and only those
 * are fetched again.
 *
 * ── Why it walks divisions rather than regions ──
 * The report gives no region or division column, so the only way to know where
 * a school is, is to have asked for it that way. Crawling region-by-division
 * costs a few hundred extra part-full pages and is what lets the approvals
 * screen say "Division of Angeles City" beside a matched name instead of
 * nothing. The old file has neither field for any of its 76,354 rows.
 *
 * The Head/Position column is deliberately not kept. It names a real person and
 * nothing in the verification path needs it.
 */

const fs = require('fs');
const path = require('path');

const BASE = 'https://ebeis.deped.gov.ph';
const FORM_URL = `${BASE}/beis/reports_info/masterlist`;
const LIST_URL = `${BASE}/beis/reports_info/viewMasterList`;
const DIVISIONS_URL = `${BASE}/beis/reports_info/ajxdivision`;

const RAW_DIR = path.join(__dirname, '..', 'data', 'ebeis-raw');
const OUT_PATH = path.join(__dirname, '..', 'data', 'deped-schools.json');

/** EBEIS's own page size. Used to turn a result count into a page count. */
const PAGE_SIZE = 30;

/** Pause between requests. The README's figure for what EBEIS tolerates is
 *  roughly one a second; the default sits just above it because the cost of
 *  being wrong in that direction is a banned IP, and the cost of being wrong in
 *  the other is a few extra minutes. */
const DELAY_MS = Number(process.env.EBEIS_DELAY_MS || 1100);

/** A failed page is retried on a widening pause before the crawl gives up. A
 *  403 here usually means rate-limited rather than forbidden, and it clears on
 *  its own if you stop knocking. */
const RETRY_PAUSES_MS = [5000, 20000, 60000];

/** Consecutive page failures after which the crawl stops rather than grinding
 *  through thousands of 403s. Progress is on disk, so stopping is cheap. */
const ABORT_AFTER_CONSECUTIVE_FAILURES = 5;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Session ──────────────────────────────────────────────────────────────────
// The report is public and unauthenticated, but it is an older PHP-era app that
// still hands out a session cookie and expects it back; without it the paged
// requests drift back to page one.
let cookie = '';

async function request(url, { body } = {}) {
  const res = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'User-Agent': UA,
      'Referer': FORM_URL,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
      }),
    },
    body,
    redirect: 'follow',
  });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (setCookie.length) cookie = setCookie.map(c => c.split(';')[0]).join('; ');
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} for ${url}`);
    err.status = res.status;
    throw err;
  }
  return text;
}

/** Same request, retried on failure. Returns null once the retries run out so
 *  the caller can count the failure rather than have the crawl throw. */
async function requestWithRetry(url, opts, label) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request(url, opts);
    } catch (err) {
      const pause = RETRY_PAUSES_MS[attempt];
      if (pause === undefined) {
        console.warn(`    ✗ ${label} — ${err.message}, giving up on this page`);
        return null;
      }
      const why = err.status === 403 ? 'rate-limited' : err.message;
      console.warn(`    ⏳ ${label} — ${why}, retrying in ${pause / 1000}s`);
      await sleep(pause);
    }
  }
}

// ── HTML ─────────────────────────────────────────────────────────────────────
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s) {
  return String(s).replace(/&(#\d+|[a-z]+);/gi, (m, k) => {
    if (k[0] === '#') return String.fromCharCode(Number(k.slice(1)));
    const hit = ENTITIES[k.toLowerCase()];
    return hit === undefined ? m : hit;
  });
}

const stripTags = (s) => decode(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** How many schools the report says match the current filter. The page count
 *  comes from this rather than from following "next" links, so a page that
 *  silently returns the wrong content still leaves a countable hole. */
function totalResults(html) {
  const m = html.match(/([\d,]+)\s+results?\s+found/i);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

/**
 * The school rows out of one page of the report.
 *
 * Rows are identified by their first cell looking like a School ID rather than
 * by position, because the same table carries a header row and a pager row and
 * their shapes have changed before. A row that does not start with an ID is not
 * a school, whatever else it is.
 */
function parseRows(html) {
  const rows = [];
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => stripTags(c[1]));
    if (cells.length < 2) continue;
    const id = cells[0].replace(/\D/g, '');
    if (!/^\d{5,9}$/.test(id) || !cells[1]) continue;
    rows.push({
      id,
      name: cells[1],
      // cells[2] is Head / Position — a named person, deliberately dropped.
      address: cells[3] && cells[3] !== '-' ? cells[3] : '',
      type: cells[4] || '',
    });
  }
  return rows;
}

function parseOptions(html, selectId) {
  const block = html.match(new RegExp(`<select[^>]*id=["']${selectId}["'][\\s\\S]*?</select>`, 'i'));
  if (!block) return [];
  const out = [];
  for (const m of block[0].matchAll(/<option value=["'](\d+)["'][^>]*>([\s\S]*?)<\/option>/gi)) {
    out.push({ id: m[1], name: stripTags(m[2]) });
  }
  return out;
}

// ── Crawl ────────────────────────────────────────────────────────────────────
const listBody = ({ page, regionId, divisionId, schoolId = '' }) => new URLSearchParams({
  page: String(page),
  id: String(schoolId),
  school_name: '',
  co_gen_class: '',
  general_classification_id: '',
  curricular_class_id: '',
  region_id: String(regionId),
  division_id: String(divisionId),
}).toString();

const pageFile = (regionId, divisionId, page) =>
  path.join(RAW_DIR, `r${regionId}-d${divisionId}-p${String(page).padStart(3, '0')}.json`);

/**
 * A cached page, or null if it cannot be trusted.
 *
 * A truncated write from an interrupted run must be refetched, so anything that
 * does not parse is rejected. An *empty* page is a different thing and is kept:
 * a few divisions really do list zero schools — Sulu II and both Lanao del Sur
 * sub-divisions among them — and treating those as damaged would refetch them
 * on every run and report them as losses on every merge.
 */
function readCachedPage(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(data.rows)) return null;
    return data.rows.length || data.total === 0 ? data : null;
  } catch {
    return null;
  }
}

async function crawl(regionFilter) {
  fs.mkdirSync(RAW_DIR, { recursive: true });

  console.log('▸ Opening the report to pick up a session…');
  const form = await request(FORM_URL);
  let regions = parseOptions(form, 'school_region_id');
  if (!regions.length) throw new Error('No regions found on the form — EBEIS may have changed.');
  if (regionFilter) regions = regions.filter(r => regionFilter.includes(r.id));
  console.log(`  ${regions.length} region(s) to walk\n`);

  let fetched = 0, cached = 0, failures = 0, consecutiveFailures = 0;

  for (const region of regions) {
    await sleep(DELAY_MS);
    const divHtml = await requestWithRetry(
      DIVISIONS_URL,
      { body: new URLSearchParams({ id: region.id }).toString() },
      `divisions for ${region.name}`,
    );
    const divisions = divHtml ? parseOptions(divHtml, 'school_division_id') : [];
    if (!divisions.length) {
      console.warn(`⚠ ${region.name} — no divisions listed, skipping`);
      continue;
    }
    console.log(`── ${region.name} (${divisions.length} divisions)`);

    for (const division of divisions) {
      // Page one both delivers rows and tells us how many pages follow.
      let page = 1, pages = null;

      while (pages === null || page <= pages) {
        const file = pageFile(region.id, division.id, page);
        const hit = readCachedPage(file);
        if (hit) {
          cached++;
          if (pages === null) pages = Math.max(1, Math.ceil(hit.total / PAGE_SIZE));
          page++;
          continue;
        }

        await sleep(DELAY_MS);
        const html = await requestWithRetry(
          LIST_URL,
          { body: listBody({ page, regionId: region.id, divisionId: division.id }) },
          `${division.name} p${page}`,
        );

        if (html === null) {
          failures++;
          if (++consecutiveFailures >= ABORT_AFTER_CONSECUTIVE_FAILURES) {
            console.error(
              `\n✗ ${consecutiveFailures} pages failed in a row — stopping.\n`
              + `  Everything fetched so far is cached in data/ebeis-raw/.\n`
              + `  Wait for the rate limit to clear (an hour is plenty) and re-run;\n`
              + `  it resumes where it stopped.\n`,
            );
            return { fetched, cached, failures, aborted: true };
          }
          page++;
          continue;
        }
        consecutiveFailures = 0;

        const total = totalResults(html) || 0;
        const rows = parseRows(html);
        if (pages === null) pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

        if (!rows.length && total > 0) {
          // A page that should have had rows and did not is a hole, not an
          // empty division — left uncached so a re-run tries it again.
          console.warn(`    ⚠ ${division.name} p${page}/${pages} — 0 rows of ${total}, will retry on re-run`);
          failures++;
          page++;
          continue;
        }

        fs.writeFileSync(file, JSON.stringify({
          region: region.name,
          regionId: region.id,
          division: division.name,
          divisionId: division.id,
          page,
          total,
          rows,
        }));
        fetched++;
        page++;
      }
      console.log(`  ✓ ${division.name} — ${pages} page(s)`);
    }
  }
  return { fetched, cached, failures, aborted: false };
}

// ── Fetching single IDs ──────────────────────────────────────────────────────
/**
 * Fetch specific School IDs one at a time, for schools the division walk cannot
 * reach.
 *
 * The walk above can only find a school that is filed under a division, and
 * about 214 of them are not — they answer a direct ID search perfectly well but
 * appear under no division in the dropdown, so a division-by-division crawl
 * misses them however carefully it is run. They were in the old Kaggle file
 * precisely because that scrape paged the unfiltered report instead.
 *
 * The report's ID search is a prefix match, not an exact one, so a search for
 * 101089 can return several rows. Only the row whose ID matches exactly is
 * kept; the rest belong to other schools.
 */
async function fetchIds(ids) {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  let fetched = 0, cached = 0, missing = 0, failures = 0;

  for (const id of ids) {
    const file = path.join(RAW_DIR, `id-${id}.json`);
    if (readCachedPage(file)) { cached++; continue; }

    await sleep(DELAY_MS);
    const html = await requestWithRetry(
      LIST_URL,
      { body: listBody({ page: 1, regionId: '', divisionId: '', schoolId: id }) },
      `id ${id}`,
    );
    if (html === null) { failures++; continue; }

    const row = parseRows(html).find(r => r.id === id);
    if (!row) {
      // EBEIS does not know this ID either. That is a real answer — the school
      // is closed, merged, or was never in EBEIS — and it is left out rather
      // than carried over from the old file on faith.
      console.log(`  · ${id} — not in EBEIS`);
      missing++;
      continue;
    }
    fs.writeFileSync(file, JSON.stringify({
      // No division walk reached this school, so we have no region or division
      // for it. Recorded as empty rather than guessed: the lookup only needs id
      // and name, and an invented division would show up on the approvals
      // screen as though it were checked.
      region: '', regionId: '', division: '', divisionId: '',
      page: 1, total: 1, rows: [row],
    }));
    fetched++;
    if (fetched % 25 === 0) console.log(`  … ${fetched} recovered`);
  }
  return { fetched, cached, missing, failures };
}

// ── Merge ────────────────────────────────────────────────────────────────────
/**
 * Fold every cached page into the lookup file, in the shape
 * depedMasterlist.js reads.
 *
 * Separate from the crawl so the file can be rebuilt without touching the
 * network — after deleting a page you doubt, or after a crawl that stopped
 * early and is worth publishing anyway.
 */
function merge() {
  if (!fs.existsSync(RAW_DIR)) {
    console.error(`✗ ${RAW_DIR} does not exist — run the crawl first.`);
    process.exit(1);
  }
  const files = fs.readdirSync(RAW_DIR).filter(f => f.endsWith('.json'));
  if (!files.length) {
    console.error('✗ No cached pages to merge.');
    process.exit(1);
  }

  const byId = new Map();
  for (const f of files) {
    const data = readCachedPage(path.join(RAW_DIR, f));
    if (!data) {
      console.warn(`  ⚠ ${f} unreadable, skipped`);
      continue;
    }
    for (const row of data.rows) {
      const record = { id: row.id, name: row.name };
      // Absent for the schools recovered by direct ID, which no division walk
      // reached — see fetchIds. Omitted rather than written empty so a consumer
      // can tell "we do not know" from "".
      if (data.region) record.region = data.region;
      if (data.division) record.division = data.division;
      if (row.address) record.address = row.address;
      byId.set(row.id, record);
    }
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify({
    source: `EBEIS crawl (${files.length} pages)`,
    importedAt: new Date().toISOString(),
    schools: [...byId.values()],
  }));

  const sizeMb = (fs.statSync(OUT_PATH).size / 1024 / 1024).toFixed(1);
  console.log(`\n🏫 ${byId.size.toLocaleString()} schools → ${path.relative(process.cwd(), OUT_PATH)} (${sizeMb} MB)`);
  console.log('   Now run: node scripts/validate-deped-masterlist.js');
  return byId.size;
}

// ── Entry ────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const regionArg = args.find(a => a.startsWith('--regions='));
  const regionFilter = regionArg ? regionArg.split('=')[1].split(',').map(s => s.trim()) : null;

  if (args.includes('--merge-only')) {
    merge();
    return;
  }

  const idsArg = args.find(a => a.startsWith('--ids='));
  if (idsArg) {
    const file = idsArg.split('=').slice(1).join('=');
    const ids = fs.readFileSync(file, 'utf8').split(/\s+/)
      .map(s => s.replace(/\D/g, '')).filter(s => /^\d{5,9}$/.test(s));
    if (!ids.length) {
      console.error(`✗ No usable School IDs in ${file}.`);
      process.exit(1);
    }
    console.log(`\nFetching ${ids.length} School ID(s) individually…\n`);
    const r = await fetchIds(ids);
    console.log(`\n── ${r.fetched} recovered, ${r.cached} already cached, `
      + `${r.missing} not in EBEIS, ${r.failures} failed`);
    merge();
    return;
  }

  console.log(
    `\nCrawling EBEIS at ${DELAY_MS}ms between requests.\n`
    + `Expect roughly an hour. Safe to stop and re-run — it resumes.\n`,
  );

  const started = Date.now();
  const { fetched, cached, failures, aborted } = await crawl(regionFilter);
  const mins = Math.round((Date.now() - started) / 60000);

  console.log(`\n── ${fetched.toLocaleString()} pages fetched, ${cached.toLocaleString()} already cached, `
    + `${failures} failed, ${mins} min`);

  if (failures) {
    console.log(`   Re-run to retry the ${failures} failed page(s) — cached pages are skipped.`);
  }
  if (aborted) return;
  merge();
}

main().catch((err) => {
  console.error(`\n✗ ${err.stack || err.message}`);
  process.exit(1);
});
