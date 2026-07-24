# TulongGuro

An AI-assisted grading and classroom management LMS. React + Vite frontend, Express + Prisma backend, Supabase Postgres database.

## Setup (for collaborators)

1. Clone the repo and install dependencies:
   ```
   npm install
   cd server && npm install
   ```

2. Copy the env template and fill in real values:
   ```
   cp .env.example server/.env
   ```
   `server/.env` is gitignored on purpose — **never commit it**. Get the actual `DATABASE_URL` and `GEMINI_API_KEY` values from whoever owns the Supabase project, through a private channel (DM, password manager, etc.), not through git. Everyone on the team should point at the same Supabase project so login/data stays consistent — connecting to a different or stale database (e.g. a local `dev.db`) will cause working credentials to appear as "Invalid credentials", since passwords are stored as bcrypt hashes and only exist correctly in the shared migrated database.

3. Generate the Prisma client:
   ```
   cd server && npx prisma generate
   ```

4. Run it:
   ```
   # backend (from server/)
   npm run dev

   # frontend (from repo root)
   npm run dev
   ```

## Deployment

- Backend: Render, via `render.yaml` (Blueprint deploy)
- Frontend: Vercel, via `vercel.json` — set `VITE_API_URL` to the deployed backend URL
