# TulongGuro — Data Flow Diagram

For inclusion in Chapter 3 (Methodology / System Design) and the appendix.

Notation: **Gane–Sarson**. Rounded rectangle = process, plain rectangle =
external entity, open-ended rectangle = data store. The Mermaid renderings
below draw data stores as cylinders because Mermaid has no open-ended-rectangle
shape; when redrawing in Visio or draw.io, use the open-ended rectangle.

---

## 1. Elements

### External entities

| ID | Entity | Role |
|----|--------|------|
| E1 | Learner | Views assigned activities, photographs and submits written work, receives released results |
| E2 | Teacher | Builds classes and activities, triggers AI checking, validates and releases grades |
| E3 | School Administrator | Manages teacher accounts, curriculum, the rubric library, and grading policy |
| E4 | Platform Administrator | Approves or rejects school registrations against DepEd records |
| E5 | Cloud VLM Service | External vision-language model that returns a draft score and feedback |

### Processes

| ID | Process |
|----|---------|
| 1.0 | Manage Registration and Access |
| 2.0 | Manage Classes and Assessments |
| 3.0 | Receive Assessment Output |
| 4.0 | Perform AI Checking |
| 5.0 | Validate and Release Result |
| 6.0 | Compute Grades and Analytics |

### Data stores

| ID | Data store | Backing tables |
|----|------------|----------------|
| D1 | User and School Records | `School`, `User` |
| D2 | Class, Section and Roster | `Section`, `Class`, `ClassLesson`, `SectionTransfer` |
| D3 | Curriculum, Rubric and Grading Policy | `Curriculum`, `CurriculumLesson`, `RubricTemplate`, `GradingPolicy` |
| D4 | Activity Records | `Activity` |
| D5 | Submission Records | `Submission` |
| D6 | Submission Image Store | Cloud object storage (submission photographs) |
| D7 | Grading Examples | `GradingExample` |
| D8 | Notification and Audit Log | `Notification`, `PushSubscription`, `GradingAuditLog`, `AdminAuditLog`, `AiRequestLog` |

---

## Figure 3. Context Diagram (Level 0)

```mermaid
flowchart LR
    E4["E4<br/>Platform<br/>Administrator"]
    E3["E3<br/>School<br/>Administrator"]
    E1["E1<br/>Learner"]
    E2["E2<br/>Teacher"]
    E5["E5<br/>Cloud VLM<br/>Service"]

    P0("0<br/>TulongGuro<br/>AI-Assisted Grading and<br/>Classroom Management System")

    E1 -- "credentials,<br/>photographed written output" --> P0
    P0 -- "released score and feedback,<br/>badges, notification" --> E1

    E2 -- "roster, activity and rubric,<br/>AI-check request, validated grade,<br/>release command" --> P0
    P0 -- "AI draft score and feedback,<br/>analytics, gradebook export" --> E2

    E3 -- "teacher accounts, curriculum,<br/>rubric library, grading policy" --> P0
    P0 -- "school-wide analytics,<br/>account and audit records" --> E3

    E4 -- "approval or rejection decision" --> P0
    P0 -- "school registration and<br/>DepEd School ID proof" --> E4

    P0 -- "output image and<br/>rubric prompt" --> E5
    E5 -- "draft score and feedback<br/>(structured JSON)" --> P0
```

---

## Figure 4. Level 1 Data Flow Diagram

Designed for a **landscape** page.

```mermaid
flowchart LR
    E1["E1<br/>Learner"]
    E2["E2<br/>Teacher"]
    E3["E3<br/>School<br/>Administrator"]
    E4["E4<br/>Platform<br/>Administrator"]
    E5["E5<br/>Cloud VLM<br/>Service"]

    P1("1.0<br/>Manage Registration<br/>and Access")
    P2("2.0<br/>Manage Classes<br/>and Assessments")
    P3("3.0<br/>Receive Assessment<br/>Output")
    P4("4.0<br/>Perform<br/>AI Checking")
    P5("5.0<br/>Validate and<br/>Release Result")
    P6("6.0<br/>Compute Grades<br/>and Analytics")

    D1[("D1 User and<br/>School Records")]
    D2[("D2 Class, Section<br/>and Roster")]
    D3[("D3 Curriculum, Rubric<br/>and Grading Policy")]
    D4[("D4 Activity<br/>Records")]
    D5[("D5 Submission<br/>Records")]
    D6[("D6 Submission<br/>Image Store")]
    D7[("D7 Grading<br/>Examples")]
    D8[("D8 Notification<br/>and Audit Log")]

    E4 -- "approval decision" --> P1
    P1 -- "registration and proof" --> E4
    E1 -- "credentials" --> P1
    E2 -- "credentials" --> P1
    E3 -- "teacher account details" --> P1
    P1 -- "account records" --> D1
    D1 -- "stored credentials" --> P1

    E2 -- "roster, activity,<br/>rubric, deadline" --> P2
    E3 -- "curriculum, rubric library,<br/>grading policy" --> P2
    P2 -- "class and roster" --> D2
    P2 -- "curriculum, rubric,<br/>policy" --> D3
    P2 -- "activity and rubric" --> D4
    P2 -- "learner accounts" --> D1
    P2 -- "learner credentials" --> E2

    E1 -- "photographed output" --> P3
    E2 -- "scanned class set" --> P3
    D4 -- "deadline, attempt limit" --> P3
    P3 -- "image file" --> D6
    P3 -- "submission (PENDING)" --> D5

    E2 -- "AI-check request" --> P4
    D5 -- "pending submissions" --> P4
    D6 -- "output image" --> P4
    D4 -- "rubric, instructions,<br/>reference materials" --> P4
    D7 -- "past corrections" --> P4
    P4 -- "image and rubric prompt" --> E5
    E5 -- "draft score and feedback" --> P4
    P4 -- "draft (AI_CHECKED)" --> D5
    P4 -- "AI request log" --> D8

    D5 -- "draft result" --> P5
    P5 -- "draft for review" --> E2
    E2 -- "validated score, feedback,<br/>release command" --> P5
    P5 -- "validated grade (GRADED)" --> D5
    P5 -- "correction pair" --> D7
    P5 -- "notification, audit entry" --> D8
    P5 -- "released score and feedback" --> E1

    D5 -- "validated grades" --> P6
    D3 -- "component weights" --> P6
    D2 -- "class and section" --> P6
    P6 -- "gradebook and export" --> E2
    P6 -- "own grades and badges" --> E1
    P6 -- "school-wide analytics" --> E3
    D8 -- "notification" --> E1
```

---

## 2. Data flow table

The authoritative list. Use it when redrawing the diagram, and to check that
every flow on the drawing is labelled.

### Process 1.0 — Manage Registration and Access

| # | From | Data flow | To |
|---|------|-----------|-----|
| 1.1 | E2 Teacher | School registration details, DepEd School ID, proof document | 1.0 |
| 1.2 | 1.0 | Pending school registration and proof | E4 Platform Administrator |
| 1.3 | E4 Platform Administrator | Approval or rejection decision | 1.0 |
| 1.4 | 1.0 | School and staff account record | D1 |
| 1.5 | E1 / E2 / E3 | Username and password | 1.0 |
| 1.6 | D1 | Stored credential hash and school status | 1.0 |
| 1.7 | 1.0 | Session token, or error / pending notice | E1 / E2 / E3 |
| 1.8 | E3 School Administrator | Teacher account details, password reset | 1.0 |
| 1.9 | 1.0 | Account and administrative audit entry | D8 |

### Process 2.0 — Manage Classes and Assessments

| # | From | Data flow | To |
|---|------|-----------|-----|
| 2.1 | E2 Teacher | Section details and class roster | 2.0 |
| 2.2 | 2.0 | Section, class and roster record | D2 |
| 2.3 | 2.0 | Generated learner account and password hash | D1 |
| 2.4 | 2.0 | Learner login credentials (one-time display) | E2 Teacher |
| 2.5 | E3 School Administrator | Curriculum, lessons, rubric library, grading policy weights | 2.0 |
| 2.6 | 2.0 | Curriculum, rubric template and policy record | D3 |
| 2.7 | D3 | Rubric template, curriculum lesson, competency list | 2.0 |
| 2.8 | E2 Teacher | Activity details, rubric, deadline, reference materials | 2.0 |
| 2.9 | 2.0 | Activity record | D4 |

### Process 3.0 — Receive Assessment Output

| # | From | Data flow | To |
|---|------|-----------|-----|
| 3.1 | E1 Learner | Photographed written output | 3.0 |
| 3.2 | E2 Teacher | Scanned class set (batch upload) | 3.0 |
| 3.3 | D4 | Deadline, late window, attempt limit, submission mode | 3.0 |
| 3.4 | 3.0 | Combined output image | D6 |
| 3.5 | 3.0 | Submission record, status PENDING | D5 |
| 3.6 | 3.0 | Submission confirmation or refusal notice | E1 / E2 |

### Process 4.0 — Perform AI Checking

| # | From | Data flow | To |
|---|------|-----------|-----|
| 4.1 | E2 Teacher | AI-check request for an activity | 4.0 |
| 4.2 | D5 | Pending submissions for the activity | 4.0 |
| 4.3 | D6 | Output image for each submission | 4.0 |
| 4.4 | D4 | Rubric, instructions, reference materials | 4.0 |
| 4.5 | D7 | Three most recent teacher corrections for the same activity type and grade level | 4.0 |
| 4.6 | 4.0 | Output image and assembled rubric prompt | E5 Cloud VLM Service |
| 4.7 | E5 Cloud VLM Service | Draft score and feedback (structured JSON) | 4.0 |
| 4.8 | 4.0 | Draft score and feedback, status AI_CHECKED | D5 |
| 4.9 | 4.0 | AI request log entry (tokens, model, outcome) | D8 |
| 4.10 | 4.0 | Job progress and per-paper outcome | E2 Teacher |

### Process 5.0 — Validate and Release Result

| # | From | Data flow | To |
|---|------|-----------|-----|
| 5.1 | D5 | Draft score, feedback and output image | 5.0 |
| 5.2 | 5.0 | Draft presented for review | E2 Teacher |
| 5.3 | E2 Teacher | Validated score and feedback (approved, edited or overridden) | 5.0 |
| 5.4 | 5.0 | Validated grade, status GRADED | D5 |
| 5.5 | 5.0 | AI draft paired with the teacher's correction | D7 |
| 5.6 | 5.0 | Grading audit entry | D8 |
| 5.7 | E2 Teacher | Release command | 5.0 |
| 5.8 | 5.0 | Release timestamp | D5 |
| 5.9 | 5.0 | Notification record and push message | D8 |
| 5.10 | 5.0 | Released score and feedback | E1 Learner |

### Process 6.0 — Compute Grades and Analytics

| # | From | Data flow | To |
|---|------|-----------|-----|
| 6.1 | D5 | Validated, released, non-excused grades | 6.0 |
| 6.2 | D3 | Component weights for the subject | 6.0 |
| 6.3 | D2 | Class, section and enrolment | 6.0 |
| 6.4 | 6.0 | Initial grade, transmuted final grade, descriptor band | E2 Teacher |
| 6.5 | 6.0 | Gradebook export file | E2 Teacher |
| 6.6 | 6.0 | Own grades, skill progress and badges | E1 Learner |
| 6.7 | 6.0 | Awarded badge record | D1 |
| 6.8 | 6.0 | School-wide performance analytics | E3 School Administrator |
| 6.9 | D8 | Notification | E1 Learner |

---

## 3. Draft paragraph for the paper

> The movement of data through TulongGuro was modelled using a data flow
> diagram. The context diagram identifies five external entities: the learner,
> the teacher, the school administrator, the platform administrator, and the
> cloud-based vision-language model that performs the AI checking. Decomposing
> the system yields six processes — managing registration and access, managing
> classes and assessments, receiving assessment output, performing AI checking,
> validating and releasing results, and computing grades and analytics — which
> exchange data through eight stores covering user and school records, class and
> roster data, curriculum and rubric definitions, activity records, submission
> records, the submission image store, stored grading examples, and the
> notification and audit log.
>
> Two flows in the diagram carry the design intent of the system. The first is
> the flow from the grading example store into the AI checking process, which
> supplies the teacher's own prior corrections as calibration input, so the model
> is guided by that teacher's marking rather than by a generic standard. The
> second is the separation between the validated grade written to the submission
> store and the release timestamp that follows it, which is what prevents an
> unreviewed result from reaching a learner. The context diagram and the level 1
> data flow diagram are presented in Appendix [X].
