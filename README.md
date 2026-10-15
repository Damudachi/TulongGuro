# TulongGuro 🦉
**AI-Assisted Grading & Classroom Management System**

🌐 **Live Demo:** [http://tulong-guro.vercel.app/](http://tulong-guro.vercel.app/)

🐳 **Docker images:** [aeriahv/tulongguro-web](https://hub.docker.com/r/aeriahv/tulongguro-web) · [aeriahv/tulongguro-api](https://hub.docker.com/r/aeriahv/tulongguro-api)

## 🔑 Demo Accounts
All three belong to the demo school **Sleeping Hub University**. Use them on the live site or on the Docker image.

| Role | Login screen tab | Username | Password |
|---|---|---|---|
| Admin | Admin | `cabutihan@admin.com` | `password123` |
| Teacher | Teacher | `jnp@teacher.edu.ph` | `password123` |
| Student | Student | `SHU-26-0006` | `06092004` |

> Please don't change these passwords or delete demo data, so the next person can still use them. Too many wrong passwords in a row lock the account for a while: 5 tries locks a staff account for 15 minutes, and 10 tries locks a student account for 5 minutes.

## 📖 About the Project
**TulongGuro** (from the Filipino words "Tulong" meaning help, and "Guro" meaning teacher) is an AI-powered Learning Management System (LMS) specifically designed to reduce the administrative burden on educators. 

Built with the **DepEd MATATAG Curriculum** in mind, the system acts as a smart teaching assistant. It utilizes a Vision Language Model (VLM) to automatically analyze student submissions (both handwritten images and text) against teacher-provided rubrics. To maintain grading integrity, TulongGuro employs a **Human-in-the-Loop (HITL)** architecture—meaning the AI generates draft scores and diagnostic feedback, but the teacher retains full authority to review, edit, and validate the final grade before the student sees it.

## ✨ Key Features
*   **🤖 AI-Assisted Grading:** Upload photos of handwritten essays or text. The AI reads the work and drafts rubric-aligned scores, strengths, areas for growth, and actionable steps.
*   **🧑‍🏫 Human-in-the-Loop (HITL):** Teachers review and validate all AI-generated feedback before finalizing, ensuring pedagogical accuracy.
*   **📊 Classroom Management:** School Admins can manage course shells, provision sections, and handle student rosters.
*   **📈 Progress Tracking & Analytics:** Real-time dashboards track student mastery of specific curriculum competencies across multiple activities.
*   **🏆 Gamification:** Students automatically earn digital badges based on their performance and milestones to boost engagement.
*   **📱 Progressive Web App (PWA):** Accessible across desktop, iOS, and Android without needing app store installation.

## 🛠️ Tech Stack
TulongGuro is built using a modern, scalable JavaScript stack:

**Frontend**
*   **Framework:** React 19 + Vite
*   **Styling:** Tailwind CSS v4 (utilizing modern CSS features like cascade layers and `color-mix`)
*   **Delivery:** Progressive Web App (PWA)

**Backend**
*   **Runtime:** Node.js + Express
*   **ORM:** Prisma
*   **Architecture:** Single-instance deployment (maintains in-memory job registries and AI quota limits)

**Database & Infrastructure**
*   **Database:** PostgreSQL (Managed by Supabase)
*   **Storage:** Supabase Object Storage (for scanned outputs and rubrics)
*   **AI Engine:** Google Gemini via the Google Generative AI SDK — checking runs a rotation of `gemini-3.6-flash` (primary) then `gemini-3.5-flash` (fallback), both full Flash models so a class is read to one standard whichever tier answers

---

## 🚀 Setup (For Collaborators)

### 1. Clone & Install Dependencies
Run these commands from the root of the project to install dependencies for both the frontend and backend:
```bash
npm install
cd server && npm install
```

### 2. Environment Variables
Copy the environment template in the `server` directory:
```bash
cp server/.env.example server/.env
```
⚠️ **Important:** `server/.env` is gitignored. Never commit it. 
Get the actual `DATABASE_URL` and `GEMINI_API_KEY` values from the repository owner. Everyone on the team must point to the same Supabase project so login and testing data stay consistent. Passwords are encrypted, so connecting to a stale local database will cause "Invalid credentials" errors.

### 3. Database Setup
Generate the Prisma client to sync the schema:
```bash
cd server
npx prisma generate
```

### 4. Run the Application
You will need two terminal tabs to run both environments simultaneously.

**Terminal 1 (Backend):**
```bash
cd server
npm run dev
```

**Terminal 2 (Frontend):**
```bash
# from the repository root
npm run dev
```

---

## 🐳 Run with Docker

**Quickest way: no setup, uses the live backend and the demo accounts above.**
1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and open it.
2. Run:
   ```bash
   docker pull aeriahv/tulongguro-web
   docker run -d -p 8080:80 --name tulongguro-web aeriahv/tulongguro-web
   ```
3. Open http://localhost:8080 and sign in with a demo account.

The first sign-in can take up to a minute while the free-tier backend wakes up.

**Whole system from source** (frontend and backend both in containers, after you've created `server/.env`):
```bash
docker compose up --build        # web on http://localhost:8080, API on http://localhost:3000
```

> ⚠️ Write `server/.env` values **without quotes** (`DATABASE_URL=postgresql://...`). `docker run --env-file` passes quotes through literally, and Prisma then rejects the URL with *"the URL must start with the protocol postgresql://"*.

---

## 🧭 Replicate the Whole System (Your Own Copy)

These steps build an independent TulongGuro with its own empty database, without needing the original team. You need free accounts on **Supabase** and **Google AI Studio**, plus either **Node.js 22** or **Docker**.

### 1. Create the database (Supabase)
1. At [supabase.com](https://supabase.com), create a new project. Note the database password.
2. **Connect → Session pooler**: copy the connection string. This is `DATABASE_URL`. Use the pooler, not the direct `db.<ref>.supabase.co` host, which is IPv6-only and fails on most networks.
3. **Project Settings → API Keys**: copy the project URL (`SUPABASE_URL`) and the **service_role / secret** key (`SUPABASE_KEY`). The anon key can't write files.
4. **Storage**: create two buckets:
   - `uploads`: **Public**. Holds submitted work, rubrics and logos.
   - `school-verification`: **Private**. Holds registrants' ID photos.

### 2. Create `server/.env`
Copy [`.env.example`](.env.example) to `server/.env` and fill in at least:

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL` | Step 1.2 |
| `SUPABASE_URL`, `SUPABASE_KEY` | Step 1.3 |
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `AUTH_SECRET` | Output of `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `PLATFORM_ADMIN_KEY` | Run the same command again; it must be **different** from `AUTH_SECRET` |
| `NODE_ENV` | `production` |

Optional: `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (push notifications) and `TURNSTILE_SECRET_KEY` (bot check on registration). [`.env.example`](.env.example) explains each one.

### 3. Build the tables
**With Node.js:**
```bash
npm install && cd server && npm install
npx prisma migrate deploy
```
**Or with Docker only:**
```bash
docker run --rm --env-file server/.env aeriahv/tulongguro-api npx -y prisma@5.22.0 migrate deploy
```

Then, in Supabase, open **SQL Editor** and run this once. It applies the schema changes that reached the live database without a migration file, so a fresh database matches `schema.prisma`:
```sql
ALTER TABLE "School" ADD COLUMN IF NOT EXISTS "ownerId" TEXT;
DROP INDEX IF EXISTS "School_name_key";
ALTER TABLE "TeacherBadge" ALTER COLUMN "updatedAt" DROP DEFAULT;
```

> Do **not** run `prisma migrate dev` against it. It sees the partial unique index `School_slug_approved_key` (which Prisma can't express) as drift and offers to drop it.

### 4. Create the first platform operator
The platform operator approves new schools. Run this once:
```bash
cd server && node scripts/create-platform-operator.js "Your Name" you@example.com
# Docker only:
docker run --rm --env-file server/.env aeriahv/tulongguro-api node scripts/create-platform-operator.js "Your Name" you@example.com
```
It prints a generated password once. Save it.

### 5. Start the app
```bash
# Node.js: two terminals
cd server && npm run dev          # API on :3000
npm run dev                       # web on :5173 (repo root)

# or Docker
docker compose up --build         # web on :8080
```

### 6. Register a school and add people
1. Open `/register` and register a school. This creates the school's **Admin** account, with status *Pending*.
2. Open `/platform/approvals`, sign in as the operator from step 4, and **approve** the school.
3. Sign in on the **Admin** tab. From there, add teachers, create sections, and enroll students into sections (one by one or from an uploaded class roster). Each student gets an ID like `SCHOOLCODE-26-0001`, and their first password is their birthdate as `MMDDYYYY`.
4. Teachers sign in on the **Teacher** tab, set up their classes and activities, and start checking work.

---

## 🗄️ Database Reference

PostgreSQL, managed through Prisma. The source of truth is [`server/prisma/schema.prisma`](server/prisma/schema.prisma), and its comments explain why each field exists. All ids are UUID strings. Every school's data is separated by `schoolId`.

### How the tables relate
```
School ─┬─ User (ADMIN / TEACHER / STUDENT)
        ├─ Section ─── Class ─┬─ ClassLesson
        │     │               └─ Activity ── Submission ── GradingAuditLog
        │     └─ students (User.sectionId)
        ├─ Curriculum ── CurriculumLesson
        ├─ GradingPolicy
        └─ RubricTemplate

User (teacher) ── TeacherBadge ── Activity.badgeId
User (student) ── StudentBadge, Notification, PushSubscription
Standalone logs: SectionTransfer, AdminAuditLog, AiRequestLog, GradingExample
```

### School
One school (tenant).

| Field | Type | Notes |
|---|---|---|
| id | String | Primary key |
| name | String | Display name (not unique) |
| slug | String? | School code, e.g. `sjes-jose`. Used in staff login domains and student IDs. Unique among APPROVED schools |
| logoUrl, brandColor | String? | Optional branding |
| status | String | `PENDING` / `APPROVED` / `REJECTED` (default `APPROVED`) |
| approvedAt | DateTime? | When an operator approved it |
| rejectedReason | String? | Why it was refused |
| depedSchoolId | String? | DepEd School ID, unique |
| officialName | String? | Name from the DepEd masterlist |
| verification, verificationNote | String? | Masterlist check result: `MATCHED` / `NAME_MISMATCH` / `NOT_FOUND` / `NO_MASTERLIST` |
| contactEmail | String? | Real contact address |
| proofUrl | String? | Permit document, if the school isn't in the masterlist |
| registrantIdPath | String? | Storage key of registrant's ID photo (private bucket) |
| idConsentAt, logoConsentAt | DateTime? | When consent was given |
| registeredIp | String? | IP that submitted the registration |
| ownerId | String? | User id of the super admin who registered it |
| passingGrade | Int | Default `75` |
| useTransmutation | Boolean | DepEd transmutation table on/off (default `false`) |
| createdAt | DateTime | |

### User
Everyone who signs in.

| Field | Type | Notes |
|---|---|---|
| id | String | Primary key |
| username | String | Unique. Email for staff, student ID for students |
| name | String | Full name |
| email | String? | Unique |
| password | String | bcrypt hash |
| role | String | `ADMIN` / `TEACHER` / `STUDENT` / `PLATFORM` |
| sessionsValidFrom | DateTime? | Sessions issued earlier are refused (sign-out-everywhere) |
| birthdate | DateTime? | Students. Seeds their first password |
| themePreference | String? | `light` / `dark` / `system` |
| schoolName | String? | Legacy copy of the school name |
| schoolId | String? | → School |
| sectionId | String? | → Section (students) |
| createdAt | DateTime | |

### Section
A homeroom group of students.

| Field | Type | Notes |
|---|---|---|
| id | String | Primary key |
| name | String | |
| gradeLevel | String? | |
| schoolYear | String? | e.g. `2026-2027` |
| teacherId | String | → User (adviser) |
| schoolId | String? | → School |
| createdAt | DateTime | |

### Class
One subject taught to one section.

| Field | Type | Notes |
|---|---|---|
| id | String | Primary key |
| name | String | |
| gradeLevel, subject | String? | |
| schoolYear | String | |
| teacherId | String | → User |
| sectionId | String | → Section |
| curriculumFile | String? | Uploaded curriculum file |
| createdAt | DateTime | |

### ClassLesson / CurriculumLesson
Lessons in a class, and the school-wide template lessons they're copied from.

| Field | Type | Notes |
|---|---|---|
| id | String | Primary key |
| classId / curriculumId | String | → Class / → Curriculum |
| title | String | |
| description | String? | |
| outputType | String | Default `Essay` |
| weekNumber | Int? | |
| competencies | String? | JSON array of learning competencies |
| defaultRubric | String? | Rubric JSON |
| rubricTemplateId | String? | Linked RubricTemplate (not a foreign key) |
| createdAt | DateTime | |

### Curriculum
A school-wide curriculum for one grade level and subject. Unique on (schoolId, gradeLevel, subject).

| Field | Type | Notes |
|---|---|---|
| id | String | Primary key |
| schoolId | String | → School |
| gradeLevel, subject, title | String | |
| description, sourceFile | String? | |
| createdAt | DateTime | |

### Activity
An assignment in a class.

| Field | Type | Notes |
|---|---|---|
| id | String | Primary key |
| title, type | String | `type` is the kind, e.g. `Essay` |
| topic | String? | |
| term | Int? | Grading term 1–3 |
| points | Int | Maximum points |
| classId | String | → Class |
| classLessonId | String? | → ClassLesson |
| instructions | String? | |
| deadline, lateUntil | String? | `YYYY-MM-DD`, Philippine time |
| submissionMode | String | Default `TEACHER_UPLOAD` |
| additionalFiles | String? | Attached materials (JSON) |
| rubric | String? | Rubric JSON |
| maxAttempts | Int | Default `1` |
| component | String? | `WW` / `PT` / `QA` (null counts as WW) |
| badgeId | String? | → TeacherBadge |
| badgePassingScore | Int? | % needed to earn the badge |
| createdAt | DateTime | |

### Submission
One student's work on one activity, and its grade.

| Field | Type | Notes |
|---|---|---|
| id | String | Primary key |
| activityId, studentId | String | → Activity, → User |
| imageUrl | String? | Uploaded work (multi-page work is stitched into one image) |
| pageBreaks | String? | JSON page boundaries inside the image |
| aiScore, hitlScore | Float? | AI draft score / teacher-validated score, 0–100 % |
| aiFeedback, hitlFeedback | String? | AI draft / teacher feedback |
| readingStrategy, rubricData, skillScores, covData | String? | AI analysis details (JSON) |
| attemptCount | Int | Default `1` |
| isLate | Boolean | Submitted after the deadline |
| gradeLevelAssumed, scoreFeedbackMismatch, rubricParseFailed, scoreOutOfRange, privacyViolation | Boolean | Warning flags shown to the teacher |
| rubricScoreNote | String? | Explanation when the AI's own numbers disagree |
| excusedAt, excusedReason | DateTime?, String? | Student excused from the activity |
| transferId | String? | Set on rows created by a section transfer |
| status | String | Default `PENDING`. `GRADED` once the teacher validates |
| releasedAt | DateTime? | When students could see the result |
| gradedAt, retainUntil, archivedAt | DateTime? | Grading and retention dates |
| createdAt, updatedAt | DateTime | |

### GradingAuditLog
Append-only history of each grade.

| Field | Type | Notes |
|---|---|---|
| id | String | Primary key |
| submissionId | String? | → Submission (kept as null if the submission is purged) |
| event | String | `AI_GRADED` / `TEACHER_VALIDATED` / `RELEASED` |
| actorId | String? | Teacher, or null for the AI |
| score | Float? | Score at that moment |
| studentId, activityId, activityTitle, schoolId | String? | Copied so the record survives deletion |
| policySnapshot | String? | Weights in effect when the grade was released (JSON) |
| createdAt | DateTime | |

### GradingPolicy
Component weights per (school, gradeLevel, subject).

| Field | Type | Notes |
|---|---|---|
| id | String | Primary key |
| schoolId | String | → School |
| gradeLevel, subject | String | |
| wwWeight, ptWeight, qaWeight | Int | Default 30 / 50 / 20 |
| createdAt, updatedAt | DateTime | |

### RubricTemplate
Reusable rubrics, private to a teacher or shared school-wide.

| Field | Type | Notes |
|---|---|---|
| id | String | Primary key |
| name | String | |
| criteria | String | Rubric JSON |
| teacherId | String? | Set for a teacher's private template |
| schoolId | String? | Set for a school-wide template |
| gradeLevel, subject, outputType | String? | What it's meant for (null means any) |
| curriculumId | String? | → Curriculum it was extracted from |
| createdAt | DateTime | |

### TeacherBadge / StudentBadge
Custom badges teachers create, and badges students have earned.

| Table | Fields |
|---|---|
| TeacherBadge | id, name, description?, icon (default `award`), color (default `royal`), teacherId → User, schoolId?, createdAt, updatedAt |
| StudentBadge | id, studentId → User, badgeId (built-in id or `custom:<TeacherBadge id>`), label?, earnedAt, celebratedAt?. Unique on (studentId, badgeId) |

### Notification / PushSubscription
In-app notifications, and devices registered for push notifications.

| Table | Fields |
|---|---|
| Notification | id, userId → User, type (e.g. `GRADE_RELEASED`), title, body?, link?, readAt?, createdAt |
| PushSubscription | id, userId → User, endpoint (unique), p256dh, auth, userAgent?, createdAt, lastSeenAt |

### Logs and records
| Table | Purpose | Fields |
|---|---|---|
| SectionTransfer | Student moves between sections | id, studentId, fromSectionId?, toSectionId?, transferredAt, actorId?, schoolId?, reason?, createdAt |
| AdminAuditLog | Admin accounts created, promoted, demoted or reset | id, schoolId, event (`ADMIN_CREATED` / `ADMIN_PROMOTED` / `ADMIN_DEMOTED` / `ADMIN_PASSWORD_RESET`), actorId?, actorName?, targetId?, targetName?, targetEmail?, createdAt |
| AiRequestLog | One row per AI request, for latency and quota measurement | id, purpose (`GRADING` / `ASSIST` / `EXTRACT` / `PARSE` / `SELFCHECK` / `OTHER`), model?, attempt, latencyMs, ok, outcome, detail?, requestBytes?, responseBytes?, promptTokens?, candidateTokens?, totalTokens?, createdAt |
| GradingExample | Teacher corrections of AI feedback, kept as examples | id, teacherId → User, activityType, gradeLevel?, aiFeedback, teacherFeedback, aiScore, teacherScore, createdAt |

---

## 🌍 Deployment

*   **Frontend (Vercel):** Configured via `vercel.json`. Deployed as a static PWA. Ensure `VITE_API_URL` is set to the production backend URL.
*   **Backend (Render):** Configured via `render.yaml`. Deployed as a Node.js web service in the Singapore region (for low-latency access in the Philippines).
