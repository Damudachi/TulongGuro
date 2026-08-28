# TulongGuro

AI-assisted grading and classroom-management LMS for Philippine public schools.
React + Vite frontend, Express + Prisma backend, Supabase Postgres, Gemini for
AI checking.

**First-time setup lives in `README.md`** — clone, `npm install` in both roots,
`server/.env`, `npx prisma generate`. Do that before anything here.
`HANDOFF.md` is a dated snapshot from 7 August 2026; its architecture notes
still hold, but its test counts are stale. This file is the current one.

---

## Verify before you claim done

There is **no frontend test runner**. Lint and build are the only automated
signal on `src/`, so all four of these matter:

```bash
cd server && npx vitest run              # unit tests
npx eslint src server --ext .js,.jsx     # from repo root
npx vite build                           # frontend
node server/scripts/verify-route-authorization.js   # when routes change
```

`cd server && npm run verify` runs the heavier gate: grading math, dashboard,
route auth, and the unit tests together.

### Known-failing tests

Verified 2026-08-29 over two full runs: **1348 tests across 75 files**,
~60-100s. ESLint silent.

One **confirmed pre-existing** failure, not yours:

- `tests/dark-mode.test.js > has no white-text panel painted with a scale that
  inverts` — offenders at `pages/PlatformApprovals.jsx:1115, 1326, 1347`. It
  came in with the PlatformApprovals commits.

(A second test in that file, `has no translucent white left standing in for a
sheen`, failed once during a run with other jobs in flight and did not
reproduce across two clean runs. Re-run before chasing it.)

Confirm a suspected pre-existing failure with `git stash` + re-run rather than
assuming it. Anything else red is yours.

---

## Layout

```
src/                    React 19, Vite, Tailwind v4. No TypeScript anywhere.
  config.js             API_URL + apiFetch — every API call goes through it
  pages/{teacher,admin,student,dev}/   role-partitioned screens
  layouts/              one shell per role
  components/           shared UI
  utils/                session, theme, grading, offline queue, rubric helpers
  constants/            school codes, badge look, activity types
server/
  server.js             the API — one file, ~16.8k lines
  grading.js            AI checking pipeline
  prisma/schema.prisma  ~20 models: School, User, Section, Class, Activity,
                        Submission, GradingAuditLog, RubricTemplate, ...
  tests/                75 files, Vitest
  scripts/              verify-*, backfill-*, DepEd masterlist import
```

Three roles in the data model: `ADMIN`, `TEACHER`, `STUDENT`. Platform-operator
and developer screens are gated by a shared key, not a user session.

---

## Conventions

**Comments carry the why, not the what.** This codebase explains reasoning at
length where a decision is non-obvious — read `src/config.js` for the house
style. When you change something subtle, leave the reason behind; when you
touch code that has such a comment, keep it true.

**Auth.** `apiFetch` in `src/config.js` attaches the session token to every
call. The server checks ids in a path against the signed token — it never takes
identity from the URL. A 401 clears the session and redirects; a 403 is left
alone deliberately. Sessions slide: the server reissues a token past halfway
through its life via the `X-Renewed-Token` header, which only works while the
API keeps it in CORS `exposedHeaders`.

**UI.** Mobile-first, Tailwind classes only, no arbitrary CSS unless forced.
Teacher UI leans navy `#1E3A8A` and reads administrative; student UI leans
green `#10B981` and reads rewarding; amber `#F59E0B` marks literacy
interventions. Full palette in `.agents/skills/tulongguro-ui/SKILL.md`.
Dark mode is enforced by a test — don't paint white text on an inverting scale.

**Lint boundaries.** `server/**` is CommonJS, `server/tests/**` and `**/*.mjs`
are ESM, `src/**` is ESM. `eslint.config.js` explains why; a parse error usually
means a file landed on the wrong side of that line.

---

## Gotchas

- **Everyone shares one Supabase project.** Pointing at a different or stale
  database makes valid credentials fail as "Invalid credentials" — passwords are
  bcrypt hashes that only exist correctly in the shared migrated DB.
- **Gemini quota is metered per Google Cloud *project*, per model** — not per
  key. Eight keys from one project share one budget. The server reads
  `GEMINI_API_KEY`, `GOOGLE_API_KEY`, and `GEMINI_API_KEY1`–`9`; the names must
  match exactly or they are silently skipped. Confirm the real count in the boot
  log: `Gemini AI enabled - N grading bucket(s)`.
- **Two AI pools, kept apart on purpose** — the teacher assistant must not be
  able to spend budget the checking queue depends on. See `.env.example`.
- **`server/.env` is gitignored and must stay that way.** Share values through a
  private channel, never a commit.
- **`MAX_SUBMISSION_PAGES` is 12 in two places** — `src/config.js` and the
  server, which is what actually enforces it. Change both.
- Deploys: backend to Render via `render.yaml`, frontend to Vercel via
  `vercel.json` with `VITE_API_URL` pointed at the backend.
