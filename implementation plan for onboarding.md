# Improve Onboarding & Declutter UI (Curing "Canvas Overwhelm")

## Background
The current Teacher Dashboard UI is too busy and presents too many options at once, leading to cognitive overload. We need to implement a "Sandbox" onboarding experience while simultaneously cleaning up the UI hierarchy using Progressive Disclosure.

---

## Part 1: UI Decluttering & Hierarchy Improvements (Dashboard)

### Problem Analysis
The dashboard currently has competing CTAs, unnecessary filters for small data sets, and a cluttered sidebar. We need to simplify the visual hierarchy.

### Proposed Changes

#### [MODIFY] Sidebar Navigation (`Sidebar.jsx` or similar)
- **Progressive Disclosure:** Hide or visually deemphasize advanced tools for brand new accounts. 
- "Analytics" and "Gradebook" should be hidden or locked (with a tooltip: *"Unlocks after grading your first activity"*) until the teacher actually has graded submissions. 
- Keep the core navigation simple: **Dashboard**, **Sections**, **Settings**.

#### [MODIFY] Dashboard Layout (`TeacherDashboard.jsx`)
- **Hide Unnecessary Filters:** Add logic to the "Filter" bar (Grade Level / Subject). Only render this filter bar if the teacher has **more than 4 classes**. If they only have 1 or 2, hide the filters entirely to save screen real estate.
- **Clear CTA Hierarchy:** Remove the "Set Up Your Grading Rubrics" banner. It distracts from the primary goal of creating a class. 
- **Simplify Class Cards:** Remove the "Recent Activities" list from the inside of the Class Cards. The card should just be a clean, clickable gateway showing the Subject, Grade, Section, and Student Count.

---

## Part 2: Teacher Onboarding (The "Aha!" Moment)

### Problem Analysis
Forcing a teacher to manually create a Block Section, create a Class, build an Activity, and upload a photo before they ever see the AI grading is too much friction. We need them to experience the system's value immediately.

### Proposed Changes

#### [NEW] The "Sandbox" Demo Class
When a teacher registers for a new account, the backend will automatically seed their account with a "Demo Class".
- **Backend (`server/server.js`):** Modify the registration endpoint. Upon creation, automatically run a scoped version of the `seed` function to attach a "Demo Block Section" and one "Sample Essay" activity to their account.
- **Pre-loaded Submission:** Include one pre-scanned, pre-graded handwritten essay in the "Pending Review" state.
- **Result:** The moment a teacher logs in, their dashboard is not empty. They see the "Demo Class" and can click directly into it to experience the HITL workspace and AI Chatbot immediately.

#### [MODIFY] Action-Driven Empty States
If a teacher deletes the Demo class and has zero classes:
- Do not just show a blank screen. The center of the dashboard should display a highly visible "Onboarding Wizard" card that combines creating a Block Section and a Class into one seamless flow.

#### [NEW] Just-in-Time Contextual Tooltips
- **HITL Workspace:** The first time they open it, a single pulsing dot highlights the AI Co-Pilot Chatbot: *"Try asking the AI to make this feedback sound more encouraging!"*

---

## Part 3: Student Onboarding (The "Safe Space")

### Problem Analysis
Students experience high academic anxiety. The onboarding must reassure them that the AI is a helper, not the final judge.

### Proposed Changes

#### [NEW] The "Welcome to TulongGuro" Modal (`StudentDashboard.jsx`)
The first time a student logs in, they see a simple, 3-slide welcome modal:
- **Slide 1:** *"Welcome! TulongGuro uses AI to help your teacher grade faster, but your teacher always makes the final decision."* 
- **Slide 2:** Points to the floating chat icon. *"Meet your AI Study Buddy! It won't do your homework, but it will help you understand your mistakes."*
- **Slide 3:** *"Look out for the orange cards—these are personalized reading tips just for you!"*

---

## Verification Plan

### Manual Verification
- **UI Cleanliness:** Load the dashboard with 2 classes. Verify the Filter bar is hidden and Class Cards are simplified.
- **Teacher Sandbox:** Create a new teacher account and verify that the "Demo Class" is automatically seeded.
- **Progressive Sidebar:** Verify "Analytics" is hidden for brand new accounts.
- **Student Modal:** Create a new student account and verify the 3-slide "Safe Space" modal appears.