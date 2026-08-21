# server/data

## deped-schools.json

The DepEd Masterlist of Schools, in the shape `server/depedMasterlist.js` reads.
Not in the repository by default — it is generated, large (roughly 7 MB for a
full list), and republished by DepEd on its own schedule.

Generate it from the official spreadsheet:

```bash
cd server
node scripts/import-deped-masterlist.js ~/Downloads/masterlist-public-elementary.xlsx \
                                        ~/Downloads/masterlist-public-secondary.xlsx \
                                        ~/Downloads/masterlist-private.xlsx
```

Pass every file DepEd splits the list across in one run. A private school whose
list was left out comes back `NOT_FOUND` at registration and is pushed onto the
attach-a-permit path for no reason other than which file we imported.

### Getting it onto the server

The lookup reads from local disk, so the file has to exist wherever the app
runs. Two ways, and the choice matters:

- **Commit it.** Simplest, and it deploys with the code. Costs ~7 MB in the
  repository each time DepEd publishes a new one.
- **Mount it and point `DEPED_MASTERLIST_PATH` at it.** Keeps the repository
  small and lets the list be updated without a deploy, at the cost of one more
  piece of host configuration to get right.

Either way, restart the app after replacing it — the file is read once and
cached for the life of the process.

### If it is missing

Registration stays open. Every lookup returns `NO_MASTERLIST` rather than
`NOT_FOUND`, no school is refused for our missing config, and the platform
approvals screen says loudly that nothing was verified automatically. See the
header of `server/depedMasterlist.js` for why those two verdicts are kept
apart.
