

---

> **System Directive: Overhaul UI & Build "Sandbox" Onboarding**
> You are the Lead UI/UX Engineer for "TulongGuro". We are completely overhauling the onboarding experience to cure "Canvas Overwhelm" for our DepEd teachers and Grade 6 students.
> Read this Master Implementation Plan and execute the necessary changes across the React frontend and Express/Prisma backend.
> ---
> 
> 
> ### **Part 1: UI Decluttering & Sidebar Rules**
> 
> 
> **Objective:** Reduce cognitive overload by hiding features until the user actually needs them.
> * **Sidebar Navigation (`Sidebar.jsx`):**
> * Brand new accounts must only see **Dashboard**, **Sections**, and **Settings**.
> * Apply the `requiresData: true` logic to **Analytics**, **Gradebook**, AND **Rubrics**. These should be locked or hidden until the teacher has actually graded their first submission.
> 
> 
> 
> 
> * **Dashboard Layout (`TeacherDashboard.jsx`):**
> * Add a conditional render to the "Filter" bar (Grade Level / Subject). Only render this if `classes.length > 4`.
> 
> 
> * Ensure Class Cards only display the Subject, Grade, Section, and Student Count. Remove any embedded "Recent Activities" lists.
> 
> 
> 
> 
> 
> 
> ### **Part 2: Teacher Onboarding (The Guided Sandbox)**
> 
> 
> **Objective:** Teachers must experience the AI's value immediately without a tedious setup phase.
> * **The Inline Wizard (Crucial Fix):**
> * When a teacher deletes their demo data and has an empty dashboard, DO NOT just show a "Welcome" redirect button.
> 
> 
> * Build an **Inline 2-Step Wizard** directly on the dashboard's empty state.
> 
> 
> * *Step 1:* Input a Section Name. *Step 2:* Select Subject/Grade. *Action:* A single "Create" button that calls the backend to generate BOTH the Block Section and the Class simultaneously, eliminating back-and-forth navigation.
> 
> 
> 
> 
> * **The Demo Class Seeding (`server.js`):**
> * Upon teacher registration, auto-seed a "Demo Class" with a pending submission.
> * **Critical:** You MUST attach a sample handwritten essay image URL (`imageUrl`) to this seeded submission. If the HITL image panel is blank, the demo is broken.
> 
> 
> 
> 
> * **The "Clean Slate" Button:**
> * Inside the Demo Class hub, prominently display a "Delete Demo Data" button. This gives the teacher psychological safety, knowing they can wipe the sandbox clean when they are ready to add real students.
> 
> 
> 
> 
> ### **Part 3: Student Onboarding (The Safe Space)**
> 
> 
> **Objective:** Reduce academic anxiety for Grade 6 students and introduce them to the AI Study Buddy.
> * **The 3-Slide Welcome Modal (`StudentDashboard.jsx`):**
> * *Slide 1:* Reassurance (The teacher makes the final decision, not the AI).
> 
> 
> * *Slide 2:* AI Study Buddy introduction.
> 
> 
> * *Slide 3:* Look out for the Amber Reading Strategy cards.
> 
> 
> 
> 
> * **The Student Sandbox (New Feature):**
> * When a student registers, auto-seed one "Demo Graded Essay" into their dashboard.
> * This allows them to instantly click in, see what a grading breakdown looks like, read a sample Amber Reading Strategy, and test the AI Study Buddy Chatbot without the pressure of a real grade.
> 
> 
> 
> 
> ---
> 
> 
> **Execution Command:**
> Please acknowledge this Master Plan. Begin by updating the backend `server.js` logic to handle the new Demo Seeding rules (including the image URL and the Student Sandbox essay). Then proceed to build the Inline Wizard in `TeacherDashboard.jsx`.

