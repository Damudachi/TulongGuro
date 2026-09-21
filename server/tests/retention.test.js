import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  RETENTION_MONTHS as CLIENT_MONTHS,
  PURGE_GRACE_DAYS as CLIENT_GRACE,
  computeRetainUntil as clientComputeRetainUntil,
  formatRetentionDate,
  retentionSummary,
  retentionSentence,
} from '../../src/constants/retention.js';

const require = createRequire(import.meta.url);
const {
  RETENTION_MONTHS, PURGE_GRACE_DAYS, computeRetainUntil, retentionStatus,
} = require('../retention.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_JS = join(HERE, '..', 'server.js');
const CLASSHUB = join(HERE, '..', '..', 'src', 'pages', 'teacher', 'ClassHub.jsx');
const NOTICE = join(HERE, '..', '..', 'src', 'components', 'RetentionNotice.jsx');
const GRADEBOOK_STUDENT = join(HERE, '..', '..', 'src', 'pages', 'teacher', 'GradebookStudent.jsx');

const DAY = 24 * 60 * 60 * 1000;

/**
 * Source with its comments removed, so a rule about what the *copy* says is
 * not answered by the comment explaining the rule. The block pass covers both
 * JSDoc headers and JSX comments, which are block comments in braces; the line
 * pass covers the double-slash kind.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .filter(line => !/^\s*\/\//.test(line))
    .join('\n');
}

/**
 * How long a submission is kept, and what the screens are allowed to say
 * about it.
 *
 * The date itself is simple arithmetic; what this file mostly guards is the
 * gap between what the system does and what it tells people. Three of those
 * are bugs waiting to be written:
 *
 *   1. The client copy drifting from the server's. src/constants/retention.js
 *      is what the class header and the gradebook footnote display. If it is
 *      ahead of the server the app promises a date the stored value does not
 *      hold; if behind, a teacher is told work has gone that is still there.
 *      Either way the person who repeats it to a parent is the one left wrong.
 *
 *   2. Any screen promising automatic deletion. Nothing in this application
 *      deletes a submission on a schedule — archive-grades and purge-grades
 *      are called by an operator. Copy that says "deleted on" is a commitment
 *      the software does not keep. See docs/PRIVACY-NOTICE-DRAFT.md.
 *
 *   3. An unparseable school year being shown as a date anyway. computeRetainUntil
 *      returns null on purpose there; a display that invents a deadline for it
 *      is worse than one that says nothing.
 */
describe('the retention deadline', () => {
  it('is six months past the close of the school year', () => {
    expect(RETENTION_MONTHS).toBe(6);
    // DepEd closes the year on 31 March, so 2024-2025 runs to 30 September 2025.
    expect(computeRetainUntil('2024-2025').toISOString()).toBe('2025-09-30T23:59:59.000Z');
    expect(computeRetainUntil('2025-2026').toISOString()).toBe('2026-09-30T23:59:59.000Z');
  });

  it('reads the second year when a range is given, and the only one otherwise', () => {
    expect(computeRetainUntil('2024-2025').getUTCFullYear()).toBe(2025);
    expect(computeRetainUntil('2025').getUTCFullYear()).toBe(2025);
    expect(computeRetainUntil('SY 2024 - 2025').getUTCFullYear()).toBe(2025);
  });

  it('lands on a month end rather than rolling into the next month', () => {
    // 31 March + 6 months by naive arithmetic is 31 September, which does not
    // exist and rolls forward to 1 October. Day 0 of October is 30 September.
    const d = computeRetainUntil('2024-2025');
    expect(d.getUTCMonth()).toBe(8);   // September
    expect(d.getUTCDate()).toBe(30);
  });

  it('returns null rather than guessing at an unreadable school year', () => {
    for (const bad of ['', null, undefined, 'last year', 'SY', '  ']) {
      expect(computeRetainUntil(bad)).toBeNull();
    }
  });
});

describe('the client copy matches the server', () => {
  it('agrees on both constants', () => {
    expect(CLIENT_MONTHS).toBe(RETENTION_MONTHS);
    expect(CLIENT_GRACE).toBe(PURGE_GRACE_DAYS);
  });

  it('computes the same date for every school year the app will meet', () => {
    const years = [
      '2023-2024', '2024-2025', '2025-2026', '2026-2027', '2030-2031',
      '2025', 'SY 2024 - 2025', '',
    ];
    for (const y of years) {
      const server = computeRetainUntil(y);
      const client = clientComputeRetainUntil(y);
      if (server === null) expect(client).toBeNull();
      else expect(client.toISOString()).toBe(server.toISOString());
    }
  });
});

describe('what the screens display', () => {
  it('formats the deadline in UTC, so it does not read a day late in Manila', () => {
    // The deadline is 23:59:59 UTC, which is already the next morning in
    // Manila. Formatting in local time would show 1 Oct for a date the server
    // holds as 30 Sep, and two screens would disagree for no visible reason.
    // Asserted by parts rather than as one string: the order en-PH puts them
    // in is ICU's business and has changed between Node versions. What must
    // not change is the day — 30 September, not 1 October.
    const formatted = formatRetentionDate(computeRetainUntil('2024-2025'));
    expect(formatted).toMatch(/\b30\b/);
    expect(formatted).toMatch(/Sep/);
    expect(formatted).toMatch(/2025/);
    expect(formatted).not.toMatch(/Oct/);
  });

  it('says nothing at all when the school year cannot be read', () => {
    expect(retentionSummary('not a year')).toBeNull();
    expect(formatRetentionDate(null)).toBeNull();
  });

  it('says "kept", never "deleted"', () => {
    const summary = retentionSummary('2025-2026');
    expect(summary).toMatch(/kept/i);
    expect(summary).not.toMatch(/delet|remov|eras/i);
  });

  it('hedges the sentence with "at least"', () => {
    // Nothing deletes on a schedule, so a definite date would be a promise the
    // system does not keep.
    expect(retentionSentence('2025-2026')).toMatch(/at least/i);
  });
});

describe('where a submission stands', () => {
  const deadline = computeRetainUntil('2024-2025');
  const before = new Date(deadline.getTime() - DAY);
  const after = new Date(deadline.getTime() + DAY);

  it('is active inside the window and due past it', () => {
    expect(retentionStatus(deadline, null, before)).toBe('active');
    expect(retentionStatus(deadline, null, after)).toBe('due');
  });

  it('is unset when no deadline could be computed', () => {
    // Not "keep forever" and not "delete now" — an admin resolves it.
    expect(retentionStatus(null, null, after)).toBe('unset');
  });

  it('becomes purgeable only after the grace period', () => {
    const archivedAt = after;
    const justInside = new Date(deadline.getTime() + (PURGE_GRACE_DAYS - 1) * DAY);
    const justOutside = new Date(deadline.getTime() + (PURGE_GRACE_DAYS + 1) * DAY);
    expect(retentionStatus(deadline, archivedAt, justInside)).toBe('archived');
    expect(retentionStatus(deadline, archivedAt, justOutside)).toBe('purgeable');
  });
});

describe('what the UI is wired to show', () => {
  const classHub = readFileSync(CLASSHUB, 'utf8');
  const notice = readFileSync(NOTICE, 'utf8');
  const gradebookStudent = readFileSync(GRADEBOOK_STUDENT, 'utf8');
  const server = readFileSync(SERVER_JS, 'utf8');

  it('puts the deadline on the class header', () => {
    expect(classHub).toContain('retentionSummary');
  });

  it('never promises automatic deletion anywhere a person reads it', () => {
    // The one rule this whole feature rests on. "will be deleted" and
    // "deleted automatically" are commitments the system does not keep —
    // archiving and purging are operator actions, run on request.
    //
    // Comments are stripped before the check and the negation is excluded,
    // because the files that get this right say so out loud: "It is not
    // deleted automatically" is the correct copy and a blunter regex flags it
    // as the very thing it is promising not to do. Asked of the source rather
    // than of rendered output because this suite deliberately runs no
    // renderer — see vitest.config.mjs.
    const promisesDeletion = /(?<!not )(?:will be deleted|deleted automatically|automatically deleted)/i;
    for (const [name, src] of [['ClassHub', classHub], ['RetentionNotice', notice], ['GradebookStudent', gradebookStudent]]) {
      expect(stripComments(src), `${name} must not promise automatic deletion`)
        .not.toMatch(promisesDeletion);
    }
    // And it says so explicitly where there is room to.
    expect(notice).toMatch(/Nothing happens on its own/i);
  });

  it('would catch the promise if someone wrote it', () => {
    // A guard whose regex silently stops matching is worse than no guard, so
    // the check above is shown failing against the copy it exists to refuse.
    const promisesDeletion = /(?<!not )(?:will be deleted|deleted automatically|automatically deleted)/i;
    expect('Work will be deleted on 30 Sep 2026.').toMatch(promisesDeletion);
    expect('This work is deleted automatically.').toMatch(promisesDeletion);
    expect('It is not deleted automatically.').not.toMatch(promisesDeletion);
  });

  it('shows archived work as not counting, rather than hiding it', () => {
    expect(gradebookStudent).toMatch(/archivedRows/);
    expect(gradebookStudent).toMatch(/Archived — not counted/);
  });

  it('reads the stored retainUntil for a submission rather than recomputing it', () => {
    // A recompute would print a confident date for a row whose school year did
    // not parse and which therefore has no deadline at all.
    expect(server).toMatch(/retainUntil: sub\?\.retainUntil/);
    expect(gradebookStudent).toMatch(/r\.retainUntil/);
  });

  it('tells an export that the schedule stops at the download', () => {
    // The only place the data leaves every control this app has.
    expect(server).toMatch(/This downloaded file is not covered by that/);
  });

  it('says on an export when archived rows were left out of the averages', () => {
    expect(server).toMatch(/archived and excluded from this export/);
    expect(server).toMatch(/archived and excluded from this file/);
  });
});
