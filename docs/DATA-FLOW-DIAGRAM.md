# TulongGuro — Data Flow Diagram

For inclusion in Chapter 3 (Methodology / System Design) and the Appendix.

Notation: **Gane–Sarson**. Rounded rectangle = process, plain rectangle =
external entity, open-ended rectangle = data store. The Mermaid renderings
below draw data stores as cylinders because Mermaid has no native open-ended-rectangle
shape; when redrawing in Visio or draw.io, use the standard open-ended rectangle.

---

## 1. System Elements

### External Entities

| ID | Entity | Role in System |
|----|--------|----------------|
| **E1** | **Learner** | Accesses assigned activities, captures and uploads handwritten/digital work, views released grades, criteria breakdowns, qualitative feedback, and earned skill badges. |
| **E2** | **Teacher** | Accesses assigned course shells, designs activities and selects/customizes rubrics, sets deadlines, triggers AI checking, reviews and overrides AI drafts in the HITL workspace, and releases final grades. |
| **E3** | **School Administrator** | Manages teacher accounts, creates block sections and rosters, creates course shells and assigns them to subject teachers, reassigns course shells/advisers, establishes curriculum and rubric templates, and configures DepEd grading policies. |
| **E4** | **Platform Administrator / Operator** | Reviews school registrations that the server has already matched against the bundled DepEd eBEIS master list, reviews institutional DepEd School ID proof documents, approves/rejects onboarding requests, assigns frozen unique school codes (`slug`), and manages platform operators. |
| **E5** | **Cloud VLM Service** | External Multimodal Vision-Language Model (Gemini Flash pool with model rotation) that processes student submission images/documents alongside rubric prompts to return structured draft scores and formative feedback. |

---

### Processes

| ID | Process | Description |
|----|---------|-------------|
| **1.0** | **Manage Registration and Access Control** | Handles school registration with an automated lookup against the bundled DepEd eBEIS registry, platform operator vetting, frozen school slug assignment (`School.slug`), institutional domain email isolation, account provisioning, authentication, and role-based access control (`PLATFORM`, `ADMIN`, `TEACHER`, `STUDENT`). |
| **2.0** | **Manage Sections, Course Shells, and Assessments** | Centralizes admin-driven section creation, school-scoped student ID generation (`<SLUG>-<YY>-<NNNN>`), course shell creation with default naming (`Subject GradeLevel - Section`), teacher assignment/reassignment, curriculum/rubric template ingestion, and teacher activity authoring. |
| **3.0** | **Receive and Ingest Assessment Output** | Ingests handwritten photo captures, scanned documents, and direct digital submissions (`PNG`, `JPEG`, `PDF`, `DOCX`), validates deadlines and attempt constraints, executes automated server-side preprocessing (EXIF rotation, stitching, 1920px width cap, 88% JPEG compression), and stores artifacts securely. |
| **4.0** | **Perform AI-Assisted Checking** | Assembles contextual grading prompts (rubrics, instructions, reference keys, and two-channel few-shot calibration: top 3 teacher correction pairs + section memory), calls the rotated Cloud VLM pool, validates JSON payloads, and persists draft evaluations (`aiScore` set; `status` stays `PENDING` until a teacher validates). |
| **5.0** | **Validate and Release Grades (HITL)** | Facilitates teacher review and override of AI drafts in the HITL workspace, captures teacher corrections for model calibration (`GradingExample`), records append-only grading audit logs, and controls deliberate class-wide grade release to learners. |
| **6.0** | **Compute Grades and Analytics** | Applies DepEd Order No. 8, s. 2015 weighting (WW, PT, QA) and linear transmutation formulas, computes student competency progress and badges, generates exportable electronic gradebooks (`.xlsx`), and delivers school-wide and course shell analytics (`ShellAnalytics`). |

---

### Data Stores

| ID | Data Store | Backing Relational Tables & Storage |
|----|------------|-------------------------------------|
| **D1** | **User and School Records** | `School` (with unique frozen `slug` & DepEd School ID), `User` (roles: `PLATFORM`, `ADMIN`, `TEACHER`, `STUDENT`), `StudentBadge` |
| **D2** | **Section, Course Shell, and Roster Store** | `Section`, `Class` (Course Shell), `ClassLesson`, `SectionTransfer` |
| **D3** | **Curriculum, Rubric, and Policy Store** | `Curriculum`, `CurriculumLesson`, `RubricTemplate`, `GradingPolicy` |
| **D4** | **Activity Records** | `Activity` |
| **D5** | **Submission Records** | `Submission` |
| **D6** | **Submission Image & Document Store** | Cloud Object Storage (Supabase Storage submission photographs and digital files) |
| **D7** | **Grading Calibration Examples** | `GradingExample` (Few-shot teacher correction pairs filtered by teacher, activity type, and grade level) |
| **D8** | **Notification and Audit Log** | `Notification`, `PushSubscription`, `GradingAuditLog`, `AdminAuditLog`, `AiRequestLog` |

---

## Figure 3. Context Diagram (Level 0 DFD)

```mermaid
flowchart LR
    E4["E4<br/>Platform<br/>Administrator / Operator"]
    E3["E3<br/>School<br/>Administrator"]
    E1["E1<br/>Learner"]
    E2["E2<br/>Teacher"]
    E5["E5<br/>Cloud VLM<br/>Service"]

    P0("0<br/>TulongGuro<br/>AI-Assisted Grading and<br/>Classroom Management System")

    %% External Entity Flows
    E1 -- "credentials,<br/>handwritten photo or digital work" --> P0
    P0 -- "released score, rubric breakdown,<br/>formative feedback, badges" --> E1

    E2 -- "activity details, rubric criteria,<br/>AI-check request, validated grade,<br/>release command" --> P0
    P0 -- "assigned course shells, roster,<br/>AI draft scores & feedback,<br/>gradebook, class analytics" --> E2

    E3 -- "teacher accounts, sections & rosters,<br/>course shell assignments & curriculum,<br/>rubric templates, grading policy" --> P0
    P0 -- "school-wide analytics, shell analytics,<br/>generated learner credentials, audit logs" --> E3

    E4 -- "institutional approval decision &<br/>assigned school code (slug)" --> P0
    P0 -- "school registration details,<br/>DepEd School ID & proof document" --> E4

    P0 -- "multimodal submission artifact, rubric criteria,<br/>teacher calibration examples" --> E5
    E5 -- "structured draft evaluation<br/>(JSON: score, criteria, feedback)" --> P0
```

---

## Figure 4. Level 1 Data Flow Diagram

```mermaid
flowchart LR
    E1["E1<br/>Learner"]
    E2["E2<br/>Teacher"]
    E3["E3<br/>School<br/>Administrator"]
    E4["E4<br/>Platform<br/>Administrator / Operator"]
    E5["E5<br/>Cloud VLM<br/>Service"]

    P1("1.0<br/>Manage Registration<br/>and Access Control")
    P2("2.0<br/>Manage Sections,<br/>Course Shells &<br/>Assessments")
    P3("3.0<br/>Receive and Ingest<br/>Assessment Output")
    P4("4.0<br/>Perform<br/>AI-Assisted Checking")
    P5("5.0<br/>Validate and<br/>Release Grades (HITL)")
    P6("6.0<br/>Compute Grades<br/>and Analytics")

    D1[("D1 User and<br/>School Records")]
    D2[("D2 Section, Course Shell<br/>and Roster Store")]
    D3[("D3 Curriculum, Rubric<br/>and Policy Store")]
    D4[("D4 Activity<br/>Records")]
    D5[("D5 Submission<br/>Records")]
    D6[("D6 Submission Image<br/>& Document Store")]
    D7[("D7 Grading Calibration<br/>Examples")]
    D8[("D8 Notification and<br/>Audit Log")]

    %% Process 1.0 Flows
    E4 -- "approval decision & assigned slug" --> P1
    P1 -- "school registration & DepEd proof" --> E4
    E1 -- "login credentials" --> P1
    E2 -- "isolated domain credentials" --> P1
    E3 -- "isolated domain credentials" --> P1
    E4 -- "operator credentials" --> P1
    P1 -- "school entity (slug) & account provisioning" --> D1
    D1 -- "credential & tenant verification" --> P1
    P1 -- "session token / auth status" --> E1
    P1 -- "session token / auth status" --> E2
    P1 -- "session token / auth status" --> E3
    P1 -- "session token / auth status" --> E4
    P1 -- "auth & admin audit entry" --> D8

    %% Process 2.0 Flows
    E3 -- "section details, adviser, student roster" --> P2
    E3 -- "course shell specs & teacher assignment" --> P2
    E3 -- "curriculum, rubric templates, policy weights" --> P2
    P2 -- "section, shell & roster records" --> D2
    P2 -- "school-scoped learner accounts (<SLUG>-<YY>-<NNNN>)" --> D1
    P2 -- "learner credentials (one-time table)" --> E3
    P2 -- "curriculum, rubric & policy records" --> D3
    D2 -- "assigned course shells & class roster" --> P2
    D3 -- "rubric templates & lesson competencies" --> P2
    P2 -- "assigned classes & templates" --> E2
    E2 -- "activity details, rubric criteria, deadline" --> P2
    P2 -- "activity record" --> D4

    %% Process 3.0 Flows
    E1 -- "handwritten photo or digital file" --> P3
    E2 -- "scanned class set upload" --> P3
    D4 -- "deadline & attempt limits" --> P3
    P3 -- "optimized image / document file" --> D6
    P3 -- "submission record (PENDING)" --> D5
    P3 -- "submission confirmation" --> E1
    P3 -- "batch upload outcome" --> E2

    %% Process 4.0 Flows
    E2 -- "AI-check batch request" --> P4
    D5 -- "pending submissions" --> P4
    D6 -- "submission image / document" --> P4
    D4 -- "rubrics, instructions, reference key" --> P4
    D7 -- "past teacher corrections (calibration)" --> P4
    D2 -- "section memory context" --> P4
    P4 -- "multimodal grading prompt" --> E5
    E5 -- "structured draft evaluation (JSON)" --> P4
    P4 -- "draft evaluation (aiScore set,<br/>status still PENDING)" --> D5
    P4 -- "AI token & latency log" --> D8
    P4 -- "job progress status" --> E2

    %% Process 5.0 Flows
    D5 -- "draft evaluation data" --> P5
    P5 -- "draft review payload" --> E2
    E2 -- "validated score, feedback, release command" --> P5
    P5 -- "validated grade (GRADED)" --> D5
    P5 -- "teacher correction pair" --> D7
    P5 -- "grading audit log" --> D8
    P5 -- "released score, rubric & feedback" --> E1

    %% Process 6.0 Flows
    D5 -- "validated, released grades" --> P6
    D3 -- "DO 8 s.2015 component weights" --> P6
    D2 -- "course shell and roster context" --> P6
    P6 -- "initial/transmuted grades, gradebook export" --> E2
    P6 -- "subject grades, badges, competency progress" --> E1
    P6 -- "school-level & shell analytics" --> E3
    P6 -- "badge award record" --> D1
    P6 -- "grade release notification" --> D8
    D8 -- "push notification alert" --> E1
```

---

## 2. Authoritative Data Flow Table

### Process 1.0 — Manage Registration and Access Control

| Flow # | Source | Data Flow Content | Destination |
|:------:|:-------|:------------------|:------------|
| 1.1 | E2 Teacher / Applicant | School registration details, DepEd School ID, proof document | 1.0 |
| 1.2 | 1.0 | Pending school registration data, the server's automated DepEd eBEIS registry match, and proof document | E4 Platform Administrator / Operator |
| 1.3 | E4 Platform Administrator | Institutional verification decision (Approve / Reject) and assigned unique school slug (`School.slug`) | 1.0 |
| 1.4 | 1.0 | Verified school entity with unique slug and initial admin account record | D1 User and School Records |
| 1.5 | E1 / E2 / E3 / E4 | User credentials (Username / School-scoped Domain Email / Password) | 1.0 |
| 1.6 | D1 User and School Records | Stored argon2/bcrypt password hash, role (`PLATFORM`, `ADMIN`, `TEACHER`, `STUDENT`), and school approval state | 1.0 |
| 1.7 | 1.0 | JWT session token, role permissions, or authentication failure notice | E1 / E2 / E3 / E4 |
| 1.8 | E3 School Administrator | Teacher account provisioning (Name, School-scoped Email `teacher.<slug>.edu.ph`, Password) | 1.0 |
| 1.9 | 1.0 | User account creation and administrative audit entry | D8 Notification & Audit Log |

---

### Process 2.0 — Manage Sections, Course Shells, and Assessments

| Flow # | Source | Data Flow Content | Destination |
|:------:|:-------|:------------------|:------------|
| 2.1 | E3 School Administrator | Section metadata (Name, Grade Level, School Year, Adviser Teacher ID) | 2.0 |
| 2.2 | E3 School Administrator | Student roster data (Learner Names, LRN, Birthdates) | 2.0 |
| 2.3 | 2.0 | Section entity and section roster enrolment mapping | D2 Section, Shell & Roster |
| 2.4 | 2.0 | Provisioned learner account records prefixed by school slug (`<SLUG>-<YY>-<NNNN>`) | D1 User and School Records |
| 2.5 | 2.0 | Learner login credentials table (one-time display and copyable export) | E3 School Administrator |
| 2.6 | E3 School Administrator | Course shell creation specs (Subject, Grade Level, Section ID, Teacher ID, Curriculum ID) | 2.0 |
| 2.7 | 2.0 | Course shell record (`Class`) with default naming `Subject GradeLevel - Section`, linked to Section and Assigned Teacher | D2 Section, Shell & Roster |
| 2.8 | E3 School Administrator | Curriculum guide, lesson competencies, school rubric templates, DepEd grading policy weights | 2.0 |
| 2.9 | 2.0 | Curriculum hierarchy, lesson competencies, and school rubric template records | D3 Curriculum, Rubric & Policy |
| 2.10 | D2 Section, Shell & Roster | Assigned course shells (`Class.teacherId`) and section student rosters | 2.0 |
| 2.11 | D3 Curriculum, Rubric & Policy | Published school rubric templates and curriculum learning competencies | 2.0 |
| 2.12 | 2.0 | Assigned course shells, enrolled student lists, and template rubrics | E2 Teacher |
| 2.13 | E2 Teacher | Activity definition (Title, Instructions, Component Type [WW/PT/QA], Rubric Criteria, Max Score, Deadline, Reference Materials) | 2.0 |
| 2.14 | 2.0 | Activity record with attached human rubric criteria and reference files | D4 Activity Records |
| 2.15 | E3 School Administrator | Course shell reassignment command (New Teacher ID) or Section Adviser update | 2.0 |
| 2.16 | 2.0 | Updated course shell teacher assignment / section adviser record | D2 Section, Shell & Roster |

---

### Process 3.0 — Receive and Ingest Assessment Output

| Flow # | Source | Data Flow Content | Destination |
|:------:|:-------|:------------------|:------------|
| 3.1 | E1 Learner | Captured photograph (PNG/JPEG) or digital work (PDF/DOCX) of activity response | 3.0 |
| 3.2 | E2 Teacher | Scanned multi-student paper batch upload | 3.0 |
| 3.3 | D4 Activity Records | Activity deadline, late submission window, attempt limits, submission mode | 3.0 |
| 3.4 | 3.0 | Preprocessed image (EXIF-rotated, stitched, 1920px capped, 88% JPEG) or extracted document file | D6 Submission Image Store |
| 3.5 | 3.0 | Submission entry (Image/File URL, timestamp, attempt count, `status = PENDING`) | D5 Submission Records |
| 3.6 | 3.0 | Submission confirmation receipt or deadline refusal alert | E1 Learner / E2 Teacher |

---

### Process 4.0 — Perform AI-Assisted Checking

| Flow # | Source | Data Flow Content | Destination |
|:------:|:-------|:------------------|:------------|
| 4.1 | E2 Teacher | Batch or individual AI-check execution command | 4.0 |
| 4.2 | D5 Submission Records | Ungraded submission records (`status = PENDING`) | 4.0 |
| 4.3 | D6 Submission Image Store | Stored submission photograph URL / document file | 4.0 |
| 4.4 | D4 Activity Records | Activity instructions, human rubric criteria & descriptors, reference answer materials | 4.0 |
| 4.5 | D7 Grading Calibration Examples | Top 3 most recent teacher corrections for the identical activity type and grade level | 4.0 |
| 4.6 | D2 Section, Shell & Roster | Top 3 most recently approved submissions in section (cohort baseline memory) | 4.0 |
| 4.7 | 4.0 | Multimodal grading prompt (Submission + Rubric Criteria + Reference Keys + 2-Channel Calibration) | E5 Cloud VLM Service |
| 4.8 | E5 Cloud VLM Service | Structured JSON grading response (Criteria scores, total draft score, qualitative feedback) | 4.0 |
| 4.9 | 4.0 | AI draft evaluation (`aiScore`, `aiFeedback`, `criteriaScores`; `status` remains `PENDING`) | D5 Submission Records |
| 4.10 | 4.0 | Telemetry log (Tokens consumed, model rotation ID, latency, prompt version) | D8 Notification & Audit Log |
| 4.11 | 4.0 | Real-time batch grading progress and completion notification | E2 Teacher |

---

### Process 5.0 — Validate and Release Grades (Human-in-the-Loop)

| Flow # | Source | Data Flow Content | Destination |
|:------:|:-------|:------------------|:------------|
| 5.1 | D5 Submission Records | AI draft scores, breakdown, feedback, and student submission photograph/document | 5.0 |
| 5.2 | 5.0 | HITL review interface payload (Side-by-side paper view + editable AI breakdown) | E2 Teacher |
| 5.3 | E2 Teacher | Validated / overridden score and customized qualitative feedback | 5.0 |
| 5.4 | 5.0 | Validated official score (`hitlScore`, `hitlFeedback`, `status = GRADED`) | D5 Submission Records |
| 5.5 | 5.0 | AI draft paired with teacher-corrected final score ($\Delta \ge 5$ pts or edited feedback) | D7 Grading Calibration Examples |
| 5.6 | 5.0 | Evaluation audit trail entry (Teacher ID, pre/post scores, timestamp) | D8 Notification & Audit Log |
| 5.7 | E2 Teacher | Explicit grade release command | 5.0 |
| 5.8 | 5.0 | Grade release timestamp (`releasedAt = NOW()`) | D5 Submission Records |
| 5.9 | 5.0 | Push notification event dispatch | D8 Notification & Audit Log |
| 5.10 | 5.0 | Published grade, rubric score breakdown, and constructive comments | E1 Learner |

---

### Process 6.0 — Compute Grades and Analytics

| Flow # | Source | Data Flow Content | Destination |
|:------:|:-------|:------------------|:------------|
| 6.1 | D5 Submission Records | Validated, released, and non-excused assessment scores | 6.0 |
| 6.2 | D3 Curriculum, Rubric & Policy | DepEd DO 8 s. 2015 component percentage weights (WW, PT, QA) | 6.0 |
| 6.3 | D2 Section, Shell & Roster | Course shell metadata, section roster, and cross-section transfer records | 6.0 |
| 6.4 | 6.0 | Weighted initial grade, transmuted quarterly grade, and descriptor band | E2 Teacher |
| 6.5 | 6.0 | DepEd-compliant electronic Gradebook export file (`.xlsx`) | E2 Teacher |
| 6.6 | 6.0 | Individual subject grades, learning competency progress, and earned badges | E1 Learner |
| 6.7 | 6.0 | Persisted student badge award record | D1 User and School Records |
| 6.8 | 6.0 | Institutional performance summaries and granular Course Shell Analytics (`ShellAnalytics`) | E3 School Administrator |
| 6.9 | D8 Notification & Audit Log | System notifications and grade release alerts | E1 Learner |
