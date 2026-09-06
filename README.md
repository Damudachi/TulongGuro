# TulongGuro 🦉
**AI-Assisted Grading & Classroom Management System**

🌐 **Live Demo:** [http://tulong-guro.vercel.app/](http://tulong-guro.vercel.app/)

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
*   **AI Engine:** Google Gemini (1.5 Flash & Pro via Google Generative AI SDK)

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

## 🌍 Deployment

*   **Frontend (Vercel):** Configured via `vercel.json`. Deployed as a static PWA. Ensure `VITE_API_URL` is set to the production backend URL.
*   **Backend (Render):** Configured via `render.yaml`. Deployed as a Node.js web service in the Singapore region (for low-latency access in the Philippines).
