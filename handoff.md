# TulongGuro Project Handoff Document

This document summarizes the state of the TulongGuro project, the architecture, and the recent changes made. Provide this document to the AI assistant in your new chat for `tulongguro2` to bring it up to speed immediately.

## 1. Project Overview & Tech Stack
**TulongGuro** is a Learning Management System (LMS) designed for Philippine public schools. It consists of a mobile-first interface for students and a web dashboard for teachers.
- **Frontend**: React (Vite), React Router, Tailwind CSS, Lucide Icons.
- **Backend**: Node.js, Express.js.
- **Database**: SQLite (managed via Prisma ORM).
- **Key Features**: 
  - Teacher creation of classes, sections, and activities.
  - Human-in-the-loop (HITL) AI grading system with Gemini.
  - Student dashboards focused on performance metrics, skill progress, and feedback visualization.

## 2. Recent Major Changes & Refactoring

### Teacher Dashboard Overhaul
- **Section Tab**: 
  - Removed the hover 'Check Button'.
  - Made each Section card clickable to display the Student List.
  - Moved the 'Create New Section' form away from the main sections view.
- **Dashboard Tab**:
  - Added Subject and Grade Level (1-6) filters.
  - Made assignments clickable for details and editable (Deadline, Details).
  - Implemented a "Search for Student" feature under Scan Essays.
  - Removed "Quick Create" from under classes.
  - Grade Papers no longer requires scanning/attaching photos; it displays the digital output directly.
- **Settings Tab**: Locked Name, Email Address, and School fields so they cannot be edited.
- **Analytics Tab**:
  - Scoped analytics strictly to individual Sections.
  - Made the main page display analytics choices per section.
  - Students are clickable to show their paperwork, ratings, and analytics.

### Student View Complete Revamp
The student interface was completely refactored to remove assignment submission capabilities (as grading is handled by the teacher scanning handwritten work). It is now a **read-only performance dashboard**.
- **Home (Dashboard.jsx)**: Shows Upcoming Deadlines, overall Skill Progress bars (Vocabulary, Punctuation, etc.), Reading Strategy Tips, and Recent Grades. Removed the "Submit Work" button.
- **Subjects Tab (Subjects.jsx)**: A newly added tab. Lists all enrolled classes. Clicking a subject shows:
  - **Activities**: List of assignments with status (Graded/Pending) and feedback previews.
  - **Gradebook**: Displays the overall grade for that subject and a breakdown of scores for each activity.
- **Profile Tab (Profile.jsx)**: Updated to include 3 sub-views:
  - **Profile**: Basic uneditable student info.
  - **Academic**: Grade stats and skill bars.
  - **Settings**: Password changing utility.
- **Submit Tab**: Removed entirely.

## 3. Database Architecture (Prisma)
The database has a robust schema defined in `schema.prisma`. Key entities include:
- `User` (Role: ADMIN, TEACHER, STUDENT)
- `Section` (Belongs to a teacher, contains students)
- `Class` (Subject-specific class, belongs to a section)
- `Activity` (Assignments for a class)
- `Submission` (Student outputs with `hitlScore`, `aiScore`, `hitlFeedback`, `skillScores`, etc.)
- `Rubric` (Grading criteria)

## 4. How to Resume Work in the New Folder
1. **Database Setup**: If your new `tulongguro2` folder is a fresh clone, you will need to run `npx prisma db push` or `npx prisma migrate dev` to initialize the SQLite database, and run your seed script if you have one.
2. **Dependencies**: Don't forget to run `npm install` in both the root/frontend and the `server` directory (if they are separate).
3. **Environment Variables**: Ensure you copy your `.env` file from the old `Tulongguro` folder to `tulongguro2` (especially your Gemini API keys or Supabase credentials if you ended up migrating).

## 5. Next Steps / Pending Work
If there were any pending tasks you wanted to add before the switch:
- Evaluate migration from SQLite to Supabase/Firebase for production deployment (as requested in earlier prompts but deferred for local development speed).
- Final polish of the UI spacing and responsive layouts on mobile devices.
