# server/data

## deped-schools.json

The DepEd Masterlist of Schools, in the shape `server/depedMasterlist.js` reads.
Not in the repository by default — it is generated, large (~6 MB), and
republished on its own schedule.

### Where to actually get it (read this before the command)

DepEd no longer publishes a downloadable masterlist. The
`Masterlist-of-Elementary-Schools.xlsx` still linked from
<https://www.deped.gov.ph/masterlist-of-elementary-schools/> returns **404**,
and there has never been a secondary or private equivalent — those are issued
as regional memoranda, not datasets. The three-file workflow this file used to
describe has no files behind it.

What exists instead, in order of preference:

1. **A CSV export of the EBEIS report.** Currently
   <https://www.kaggle.com/datasets/joshuagilodlsu/masterlist-of-deped-schools>,
   downloadable without a Kaggle account:

   ```bash
   curl -L -o kaggle.zip \
     https://www.kaggle.com/api/v1/datasets/download/joshuagilodlsu/masterlist-of-deped-schools
   ```

   Third-party, so it must be validated (below) rather than trusted.

2. **EBEIS itself** — <https://ebeis.deped.gov.ph/beis/reports_info/masterlist>,
   a public unauthenticated report at `POST /beis/reports_info/viewMasterList`.
   It offers no bulk export, only 30 rows a page over ~2,750 pages, and it
   **rate-limits into an IP-level 403** if you crawl it concurrently. If you
   ever re-crawl it: one region at a time, sequentially, carrying the session
   cookie, roughly a request a second. A concurrent crawl both gets banned and
   silently returns overlapping pages.

3. **FOI request** — <https://www.foi.gov.ph/agencies/deped/>. Slow, but it is
   the only route that yields a file DepEd stands behind.

### Generating the lookup

```bash
cd server
node scripts/import-deped-masterlist.js ~/Downloads/schools_masterlist.csv
```

Pass every file at once if the list arrives split. A school whose file was left
out comes back `NOT_FOUND` at registration and is pushed onto the
attach-a-permit path for no reason other than which file was imported.

### Validating it — do not skip this

```bash
node scripts/validate-deped-masterlist.js
```

A partial scrape does not look partial. It imports cleanly, reports a large
number, and then answers `NOT_FOUND` for every school it happens to be missing —
telling real schools they do not exist. The validator checks the row count
against EBEIS's own reported total, verifies known records read out of the live
report, and flags a public-schools-only export. It exits non-zero on failure.

**If it fails, delete the file.** `NO_MASTERLIST` keeps registration open and
says plainly that nothing was verified. Wrong data is worse than no data here.

### What is installed now

Imported 21 Aug 2026 from the Kaggle EBEIS export (`schools_masterlist.csv`,
dated 31 Jan 2026): **76,354 unique schools**, against the 83,107 EBEIS itself
reports — about **92%**. The export is a page-by-page scrape that dropped 204 of
2,751 pages, roughly 6,100 schools. Those schools register normally; they just
land on the permit path instead of matching automatically.

It carries no region or division column, so an operator sees the matched name
without the division beside it. Matching and duplicate detection are unaffected.

### Getting it onto the server

The lookup reads from local disk, so the file has to exist wherever the app
runs. Two ways, and the choice matters:

- **Commit it.** Simplest, and it deploys with the code. Costs ~6 MB in the
  repository each time it is refreshed, and redistributes a third-party export —
  check the source's licence first.
- **Mount it and point `DEPED_MASTERLIST_PATH` at it.** Keeps the repository
  small, updates without a deploy, and sidesteps the licence question entirely.

Either way, restart the app after replacing it — the file is read once and
cached for the life of the process.

### If it is missing

Registration stays open. Every lookup returns `NO_MASTERLIST` rather than
`NOT_FOUND`, no school is refused for our missing config, and the platform
approvals screen says loudly that nothing was verified automatically. See the
header of `server/depedMasterlist.js` for why those two verdicts are kept
apart.
