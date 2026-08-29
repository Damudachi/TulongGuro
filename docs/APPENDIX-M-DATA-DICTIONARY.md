# Appendix M: Data Dictionary

This appendix documents the persistent data structures of TulongGuro. The system uses a PostgreSQL database hosted on Supabase and accessed through the Prisma ORM; the schema comprises twenty entities, presented below in the order in which they appear in the schema definition.

The following conventions apply throughout. Every entity uses a surrogate primary key named id, generated as a version-4 UUID rather than as a sequential integer, so that identifiers disclose neither record counts nor creation order. Data types are given as the PostgreSQL types actually provisioned: text for character data of any length, integer and double precision for numeric data, boolean for flags, and timestamp(3) for temporal data. Several columns hold structured values serialized as JSON in a text column; these are marked text (JSON) and their internal shape is described in the accompanying entry. Where a field is nullable, the description states what a null value means, since in this schema null is frequently a meaningful answer rather than merely an absent one.

Two design decisions recur across the schema and are noted here rather than repeated in every entry. First, the audit and history entities (GradingAuditLog, AdminAuditLog and SectionTransfer) deliberately denormalize the names and identifiers of their subjects onto each row instead of relying solely on foreign keys. This is so that a record retains its meaning after the row it refers to has been deleted or purged, which is precisely when such a record is most likely to be read. Second, several columns that would conventionally be database enumerations are held as text. The system is written in plain JavaScript without TypeScript, so an enumeration would add a database-level constraint without any compile-time benefit, and every write to these columns is a server-controlled literal rather than user input. Authorization correctness is instead enforced by ownership checks in the route handlers and verified by an automated route-authorization script.


## Table M.1 Summary of Database Entities

| # | Entity | Fields | Purpose |
|---|---|---|---|
| 1 | School | 22 | One school tenant. |
| 2 | GradingPolicy | 9 | The DepEd component weights (Written Work, Performance Task, Quarterly Assessment) for one subject at one grade level in one school. |
| 3 | User | 13 | Every human account in the system, across all four roles. |
| 4 | TeacherBadge | 9 | A reward a teacher defines and attaches to one of their own activities, complementing the fifteen built-in badges that describe term-long patterns. |
| 5 | StudentBadge | 6 | A badge a learner has earned, recorded permanently so that it cannot later be withdrawn by a change in someone else's performance. |
| 6 | Notification | 8 | One in-application notification for one user. |
| 7 | PushSubscription | 8 | One browser's permission to raise a system notification on one device, which is what allows a release to reach a learner whose app is closed. |
| 8 | Section | 7 | A homeroom class group within a school: the roster to which learners belong and against which course shells are created. |
| 9 | SectionTransfer | 9 | An append-only record of a learner moving between sections, and of who moved them. |
| 10 | Curriculum | 8 | A school-wide curriculum for one grade level and subject, published by an administrator and suggested to teachers who create a matching course shell. |
| 11 | CurriculumLesson | 10 | A template lesson within a curriculum, copied into a class's ClassLesson rows when a teacher applies the curriculum to a course shell. |
| 12 | Class | 9 | A course shell: one subject taught by one teacher to one section for one school year. |
| 13 | ClassLesson | 10 | A lesson within one course shell, copied on application from CurriculumLesson. |
| 14 | Activity | 19 | One assessment set to one class: the unit a rubric is attached to, submissions are collected against, and a grade is recorded for. |
| 15 | Submission | 31 | One learner's work on one activity, together with the AI's draft assessment, the teacher's validated assessment, and the quality flags raised between the two. |
| 16 | GradingAuditLog | 11 | An append-only record of what happened to a submission's grade and when. |
| 17 | GradingExample | 9 | A single teacher correction retained as few-shot demonstration material, forming the calibration corpus that steers subsequent AI grading toward that teacher's standards. |
| 18 | RubricTemplate | 10 | A reusable rubric, either private to one teacher or published school-wide by an administrator. |
| 19 | AiRequestLog | 14 | One row per request actually dispatched to the model provider. |
| 20 | AdminAuditLog | 9 | An append-only record of who was granted or lost school-administrator access, and who did it. |

## Table M.2 School

One school tenant. Every administrator, teacher, section, curriculum and school-wide rubric template belongs to exactly one School, which is the boundary that keeps one school's records unreachable from another's.

| Field Name | Data Type | Constraints | Description |
|---|---|---|---|
| id | text (UUID) | PK, NOT NULL | Surrogate primary key, generated as a UUID v4. |
| name | text | NOT NULL | The school's display name as typed by the registrant. Deliberately not unique: school names repeat legitimately across divisions. |
| slug | text | NULL; unique among APPROVED schools | Short school code (e.g. mes-maba) that namespaces the school's accounts. It forms the middle label of every staff login domain and the prefix of every student ID. Uniqueness is enforced by a partial index restricted to approved schools, so competing pending registrations may claim the same code but only one may own it. |
| logoUrl | text | NULL | Public URL of the school logo supplied at registration. Null falls back to an initials placeholder. |
| brandColor | text | NULL | Optional hexadecimal accent color for the school's branding. Null falls back to the default TulongGuro palette. |
| status | text | NOT NULL, DEFAULT 'APPROVED' | Platform-operator review state: PENDING, APPROVED or REJECTED. No account belonging to the school may authenticate until the value is APPROVED. |
| approvedAt | timestamp(3) | NULL | Moment a platform operator approved the registration. Null while pending or rejected. |
| rejectedReason | text | NULL | Operator's stated reason for refusing a registration. |
| depedSchoolId | text | NULL, UNIQUE | The school's official DepEd School ID. Validated against the DepEd masterlist at registration and serving as the effective duplicate guard, since Philippine schools are a published, finite set. |
| officialName | text | NULL | The masterlist's own name for the matched School ID, stored as it stood at registration so an operator can compare it with the typed name without a second lookup. |
| verification | text | NULL | Outcome of the masterlist check: MATCHED, NAME_MISMATCH, NOT_FOUND or NO_MASTERLIST. Advisory only; it determines what the operator is shown and never blocks approval on its own. |
| verificationNote | text | NULL | One line of human-readable detail supporting the verification verdict. |
| contactEmail | text | NULL | A real, deliverable address for the institution, distinct from the administrator's synthetic login domain. |
| proofUrl | text | NULL | Government permit or recognition document, required only where the School ID is absent from the masterlist. |
| registrantIdPath | text | NULL | Private storage key (not a URL) for the photograph of the registrant's school or employee ID. Held in a private bucket and released only as a short-lived signed link to a platform operator, because the file carries a named person's face and employee number. |
| idConsentAt | timestamp(3) | NULL | Timestamp at which the registrant consented to submitting their identification document. Recorded as a timestamp rather than a boolean so the record can answer when consent was given. |
| logoConsentAt | timestamp(3) | NULL | Timestamp at which the registrant consented to display of the school logo. |
| registeredIp | text | NULL | Originating IP address of the registration request, retained for abuse triage only. |
| ownerId | text (UUID) | NULL | Identifier of the administrator who registered the school and who alone may add, promote, demote or reset the password of another administrator. Held as a plain column rather than a foreign key so that schools predating the field remain operable. |
| passingGrade | integer | NOT NULL, DEFAULT 75 | School-wide grade at or above which a learner is considered passing. DepEd uses 75. School-wide by design so that at-risk analytics mean the same thing in every class. |
| useTransmutation | boolean | NOT NULL, DEFAULT false | Whether report-card grades pass through the DepEd transmutation table. Ships disabled; analytics and at-risk detection always use the untransmuted grade. |
| createdAt | timestamp(3) | NOT NULL, DEFAULT now() | Row creation timestamp. |

*Relationships and notes.* One-to-many to User, Section, Curriculum, GradingPolicy and RubricTemplate; all cascade on delete except User and Section, which are restricted.

## Table M.3 GradingPolicy

The DepEd component weights (Written Work, Performance Task, Quarterly Assessment) for one subject at one grade level in one school.

| Field Name | Data Type | Constraints | Description |
|---|---|---|---|
| id | text (UUID) | PK, NOT NULL | Surrogate primary key. |
| schoolId | text (UUID) | FK -> School.id, NOT NULL, ON DELETE CASCADE | Owning school. |
| gradeLevel | text | NOT NULL | Grade level the weighting applies to. |
| subject | text | NOT NULL | Subject the weighting applies to. |
| wwWeight | integer | NOT NULL, DEFAULT 30 | Written Work weight as a percentage. Stored as entered and renormalized at read time, so a policy that does not total 100 degrades sensibly instead of corrupting grades. |
| ptWeight | integer | NOT NULL, DEFAULT 50 | Performance Task weight as a percentage. |
| qaWeight | integer | NOT NULL, DEFAULT 20 | Quarterly Assessment weight as a percentage. |
| createdAt | timestamp(3) | NOT NULL, DEFAULT now() | Row creation timestamp. |
| updatedAt | timestamp(3) | NOT NULL | Automatically maintained timestamp of the last modification. |

*Relationships and notes.* Unique on (schoolId, gradeLevel, subject). Administrator-owned; no teacher-level override exists, since a private weighting would give two learners in the same subject different quarter grades from identical scores.

## Table M.4 User

Every human account in the system, across all four roles. A single table is used because authentication, session issuance and audit attribution are identical for all of them.

| Field Name | Data Type | Constraints | Description |
|---|---|---|---|
| id | text (UUID) | PK, NOT NULL | Surrogate primary key. |
| username | text | NOT NULL, UNIQUE | Login identifier. Staff accounts use a school-scoped synthetic domain (e.g. irma@teacher.mes-maba.edu.ph); learners use a school-prefixed student ID (e.g. MES-MABA-26-0001). |
| name | text | NOT NULL | The person's full name as it appears in the school's official records. |
| email | text | NULL, UNIQUE | Optional real email address. Presently unused for delivery, as the build has no mail transport. |
| password | text | NOT NULL | bcrypt hash of the account password. The plaintext is never stored, logged or returned by any endpoint. |
| role | text | NOT NULL | ADMIN, TEACHER, STUDENT or PLATFORM. PLATFORM denotes a TulongGuro operator, carries no schoolId, belongs to no tenant, and is refused by every school-scoped route. |
| sessionsValidFrom | timestamp(3) | NULL | Sessions issued before this instant are refused. Because tokens are stateless, this column is the mechanism by which a single account can be signed out early without rotating the signing secret for every user. |
| birthdate | timestamp(3) | NULL | Date of birth for learners enrolled from a class roster. Seeds the pupil's first password and is therefore treated as a starting credential rather than a secret. |
| themePreference | text | NULL | light, dark or system. Held on the account rather than the device because devices are shared. Null means never chosen and is treated as following the operating system. |
| schoolName | text | NULL | Denormalized school name retained for display on legacy accounts. |
| schoolId | text (UUID) | FK -> School.id, NULL | Owning school. Null for PLATFORM operators, who belong to no tenant. |
| sectionId | text (UUID) | FK -> Section.id, NULL | The section a learner is currently enrolled in. Null for staff. Answers only where a learner is now; SectionTransfer answers since when. |
| createdAt | timestamp(3) | NOT NULL, DEFAULT now() | Row creation timestamp. |

*Relationships and notes.* One-to-many to Submission, Notification, PushSubscription, StudentBadge, TeacherBadge, GradingExample, RubricTemplate, Section (as owning teacher) and Class (as assigned teacher).

## Table M.5 TeacherBadge

A reward a teacher defines and attaches to one of their own activities, complementing the fifteen built-in badges that describe term-long patterns.

| Field Name | Data Type | Constraints | Description |
|---|---|---|---|
| id | text (UUID) | PK, NOT NULL | Surrogate primary key. |
| name | text | NOT NULL | Badge name shown to the learner. |
| description | text | NULL | One-line description. Where absent, the earning condition itself is displayed. |
| icon | text | NOT NULL, DEFAULT 'award' | Key into the application's icon set, stored as a key rather than as markup so any screen may render it independently. |
| color | text | NOT NULL, DEFAULT 'royal' | Key into the application's badge palette. Unrecognized values fall back rather than failing. |
| teacherId | text (UUID) | FK -> User.id, NOT NULL, ON DELETE CASCADE | The owning teacher. Badges are teacher-owned, not school-owned. |
| schoolId | text (UUID) | NULL | Denormalized school identifier, carried so the row remains attributable after a teacher account is removed. Never used as a permission. |
| createdAt | timestamp(3) | NOT NULL, DEFAULT now() | Row creation timestamp. |
| updatedAt | timestamp(3) | NOT NULL | Timestamp of last modification. |

*Relationships and notes.* Indexed on teacherId. One-to-many to Activity, which references it with ON DELETE SET NULL so that deleting a badge can never delete the activity or its recorded marks.

## Table M.6 StudentBadge

A badge a learner has earned, recorded permanently so that it cannot later be withdrawn by a change in someone else's performance.

| Field Name | Data Type | Constraints | Description |
|---|---|---|---|
| id | text (UUID) | PK, NOT NULL | Surrogate primary key. |
| studentId | text (UUID) | FK -> User.id, NOT NULL, ON DELETE CASCADE | The learner who earned it. |
| badgeId | text | NOT NULL | Stable badge identifier: either a built-in key (e.g. comeback-kid) or custom:<TeacherBadge id> for a teacher-authored badge. A single column serves both because everything downstream treats them identically. |
| label | text | NULL | The teacher badge's name as it stood when earned. Set only on custom rows and read only as a fallback, so that a learner's record does not go blank if the authoring teacher's account is removed. |
| earnedAt | timestamp(3) | NOT NULL, DEFAULT now() | When the badge condition was first met. |
| celebratedAt | timestamp(3) | NULL | When the learner was actually shown the award animation. Kept separate from earnedAt so the celebration fires exactly once, on whichever device the learner next opens, rather than on a screen nobody is watching. Null means a celebration is still owed. |

*Relationships and notes.* Unique on (studentId, badgeId) so a badge can be held only once; indexed on studentId.

## Table M.7 Notification

One in-application notification for one user. Deliberately a single flat table with no channels or preferences; it exists because grades and releases were otherwise entirely silent outside the app.

| Field Name | Data Type | Constraints | Description |
|---|---|---|---|
| id | text (UUID) | PK, NOT NULL | Surrogate primary key. |
| userId | text (UUID) | FK -> User.id, NOT NULL, ON DELETE CASCADE | Recipient. |
| type | text | NOT NULL | Caller-defined event tag, e.g. GRADE_RELEASED. Held as free text rather than a database enum because the set of notifiable events is expected to grow without a schema change. |
| title | text | NOT NULL | Headline shown in the notification list. |
| body | text | NULL | Optional supporting line. |
| link | text | NULL | In-application route to open when the notification is selected. Null where the event has no destination. |
| readAt | timestamp(3) | NULL | When the recipient opened it. Null means unread. |
| createdAt | timestamp(3) | NOT NULL, DEFAULT now() | Row creation timestamp. |

*Relationships and notes.* Indexed on (userId, readAt), which is the exact shape of the unread-count query.

## Table M.8 PushSubscription

One browser's permission to raise a system notification on one device, which is what allows a release to reach a learner whose app is closed.

| Field Name | Data Type | Constraints | Description |
|---|---|---|---|
| id | text (UUID) | PK, NOT NULL | Surrogate primary key. |
| userId | text (UUID) | FK -> User.id, NOT NULL, ON DELETE CASCADE | Owning user. One person legitimately holds several rows: a classroom desktop and a personal handset. |
| endpoint | text | NOT NULL, UNIQUE | The push service URL issued by the browser. Unique because it is the device's identity as far as the push protocol is concerned, so re-subscribing updates the row instead of duplicating delivery. |
| p256dh | text | NOT NULL | Browser-generated public key. Payloads are encrypted to it before leaving the server, so the relaying push service handles ciphertext it cannot read. |
| auth | text | NOT NULL | Browser-generated authentication secret, used with p256dh for payload encryption. |
| userAgent | text | NULL | Informal note of which device this is, displayed in the signed-in devices list. Never parsed. |
| createdAt | timestamp(3) | NOT NULL, DEFAULT now() | When the subscription was first registered. |
| lastSeenAt | timestamp(3) | NOT NULL, DEFAULT now() | Updated on each successful delivery. A row long unwritten but never errored indicates a device that is gone. |

*Relationships and notes.* Indexed on userId.

## Table M.9 Section

A homeroom class group within a school: the roster to which learners belong and against which course shells are created.

| Field Name | Data Type | Constraints | Description |
|---|---|---|---|
| id | text (UUID) | PK, NOT NULL | Surrogate primary key. |
| name | text | NOT NULL | Section name, e.g. Rizal. |
| gradeLevel | text | NULL | Grade level, used to keep a school roster navigable. |
| schoolYear | text | NULL | School year in free-text form, e.g. 2026-2027. Null is treated as current, so a section whose year cannot be established is never hidden from its teacher. |
| teacherId | text (UUID) | FK -> User.id, NOT NULL | The adviser who owns the section. |
| schoolId | text (UUID) | FK -> School.id, NULL | Owning school. |
| createdAt | timestamp(3) | NOT NULL, DEFAULT now() | Row creation timestamp. |

*Relationships and notes.* One-to-many to Class and to User (as enrolled learners).

## Table M.10 SectionTransfer

An append-only record of a learner moving between sections, and of who moved them. User.sectionId records only where a learner is now; this entity records since when, which is what distinguishes work not handed in from work set before the learner arrived.

| Field Name | Data Type | Constraints | Description |
|---|---|---|---|
| id | text (UUID) | PK, NOT NULL | Surrogate primary key. |
| studentId | text (UUID) | NOT NULL | The learner who moved. |
| fromSectionId | text (UUID) | NULL | Section departed. Null on a learner's first enrolment. |
| toSectionId | text (UUID) | NULL | Section joined. Null where the learner was unassigned rather than moved. |
| transferredAt | timestamp(3) | NOT NULL, DEFAULT now() | Effective date of the move, which is the field every affected screen reads. |
| actorId | text (UUID) | NULL | The teacher or administrator who performed it. Null for a system-generated row. |
| schoolId | text (UUID) | NULL | Denormalized onto the row so the record stays meaningful after a referenced section is deleted. |
| reason | text | NULL | Free-text justification recorded by the acting staff member. |
| createdAt | timestamp(3) | NOT NULL, DEFAULT now() | Row insertion timestamp, distinct from transferredAt, which may be backdated. |

*Relationships and notes.* Indexed on (studentId, transferredAt), fromSectionId and toSectionId. Deliberately carries no foreign keys, so no delete elsewhere can cascade the history away.

## Table M.11 Curriculum

A school-wide curriculum for one grade level and subject, published by an administrator and suggested to teachers who create a matching course shell.

| Field Name | Data Type | Constraints | Description |
|---|---|---|---|
| id | text (UUID) | PK, NOT NULL | Surrogate primary key. |
| schoolId | text (UUID) | FK -> School.id, NOT NULL, ON DELETE CASCADE | Owning school. |
| gradeLevel | text | NOT NULL | Grade level covered. |
| subject | text | NOT NULL | Subject covered. |
| title | text | NOT NULL | Curriculum title. |
| description | text | NULL | Optional summary. |
| sourceFile | text | NULL | Storage reference to the uploaded DepEd curriculum guide from which the lessons and rubrics were extracted. |
| createdAt | timestamp(3) | NOT NULL, DEFAULT now() | Row creation timestamp. |

*Relationships and notes.* Unique on (schoolId, gradeLevel, subject). One-to-many to CurriculumLesson and RubricTemplate.

## Table M.12 CurriculumLesson

A template lesson within a curriculum, copied into a class's ClassLesson rows when a teacher applies the curriculum to a course shell.

| Field Name | Data Type | Constraints | Description |
|---|---|---|---|
| id | text (UUID) | PK, NOT NULL | Surrogate primary key. |
| curriculumId | text (UUID) | FK -> Curriculum.id, NOT NULL, ON DELETE CASCADE | Parent curriculum. |
| title | text | NOT NULL | Lesson title. |
| description | text | NULL | Lesson summary. |
| outputType | text | NOT NULL, DEFAULT 'Essay' | The kind of written output the lesson calls for, which seeds the activity type and the rubric selection. |
| weekNumber | integer | NULL | Week of the school year the lesson is scheduled for. |
| competencies | text (JSON) | NULL | The DepEd Learning Competencies the lesson covers, as a JSON array of strings, read verbatim from the guide's own column. Written into the grading prompt so the AI evaluates against the school's stated competencies. Held as JSON rather than a related table because competencies are only ever read as a set. |
| defaultRubric | text (JSON) | NULL | An embedded copy of the lesson's rubric, retained as the fallback used when the referenced template is unavailable. |
| rubricTemplateId | text (UUID) | NULL | The school rubric template this lesson's rubric was saved as. Deliberately not a foreign key, so that deleting a template degrades to the embedded copy above rather than cascading or blocking. |
| createdAt | timestamp(3) | NOT NULL, DEFAULT now() | Row creation timestamp. |

*Relationships and notes.* Many-to-one to Curriculum.

## Table M.13 Class

A course shell: one subject taught by one teacher to one section for one school year. Activities hang off it.

| Field Name | Data Type | Constraints | Description |
|---|---|---|---|
| id | text (UUID) | PK, NOT NULL | Surrogate primary key. |
| name | text | NOT NULL | Course name shown to teacher and learners. |
| gradeLevel | text | NULL | Grade level. Where unset, AI grading defaults to Grade 6 for curriculum context and calibration and flags the affected submission, since the assumption would otherwise be invisible. |
| subject | text | NULL | Subject taught. |
| schoolYear | text | NOT NULL | School year in free-text form. Also the anchor from which every submission's retention deadline is computed. |
| teacherId | text (UUID) | FK -> User.id, NOT NULL | Assigned teacher. |
| sectionId | text (UUID) | FK -> Section.id, NOT NULL | Section taught. |
| curriculumFile | text | NULL | Storage reference to a curriculum document uploaded directly to this class. |
| createdAt | timestamp(3) | NOT NULL, DEFAULT now() | Row creation timestamp. |

*Relationships and notes.* One-to-many to Activity and ClassLesson; many-to-one to Section and User.

## Table M.14 ClassLesson

A lesson within one course shell, copied on application from CurriculumLesson. Copy-on-apply is deliberate, so that a later change to the school curriculum does not silently alter a class already under way.

| Field Name | Data Type | Constraints | Description |
|---|---|---|---|
| id | text (UUID) | PK, NOT NULL | Surrogate primary key. |
| classId | text (UUID) | FK -> Class.id, NOT NULL, ON DELETE CASCADE | Parent course shell. |
| title | text | NOT NULL | Lesson title. |
| description | text | NULL | Lesson summary. |
| outputType | text | NOT NULL, DEFAULT 'Essay' | The kind of written output the lesson calls for. |
| weekNumber | integer | NULL | Scheduled week. |
| competencies | text (JSON) | NULL | Learning Competencies as a JSON array of strings, carried over from the curriculum lesson and written into the grading prompt. |
| defaultRubric | text (JSON) | NULL | Embedded rubric copy used as the grading fallback. |
| rubricTemplateId | text (UUID) | NULL | Copied identifier of the rubric template, not a live link. |
| createdAt | timestamp(3) | NOT NULL, DEFAULT now() | Row creation timestamp. |

*Relationships and notes.* One-to-many to Activity; many-to-one to Class.

## Table M.15 Activity

One assessment set to one class: the unit a rubric is attached to, submissions are collected against, and a grade is recorded for.

| Field Name | Data Type | Constraints | Description |
|---|---|---|---|
| id | text (UUID) | PK, NOT NULL | Surrogate primary key. |
| title | text | NOT NULL | Activity title. |
| type | text | NOT NULL | The pedagogical kind of output, drawn from a fixed list (Essay, Short Answer, Journal, Reflection, Creative Writing, Research Paper, Survey/Form, Outline, Report, Letter, Poem, Speech, Summary, Quiz). The gradebook groups columns by this value, and it is distinct from component below. |
| topic | text | NULL | Subject matter of the activity, supplied to the AI as grading context. |
| term | integer | NULL | Grading term (1, 2 or 3). Null means untagged and is grouped under 'No term' rather than being hidden, since no recorded date could place activities created before the field existed. |
| points | integer | NOT NULL | Raw total the activity is marked out of. Scores are entered in these points and stored as a percentage. |
| classId | text (UUID) | FK -> Class.id, NOT NULL | Owning course shell. |
| instructions | text | NULL | Instructions shown to learners and supplied to the AI as task context. |
| deadline | text (YYYY-MM-DD) | NULL | Due date. Resolved to 23:59:59 Philippine time; work submitted after it is marked late. |
| lateUntil | text (YYYY-MM-DD) | NULL | Last date on which late work is still accepted. Null means the activity closes at the deadline. |
| submissionMode | text | NOT NULL, DEFAULT 'TEACHER_UPLOAD' | How work reaches the system: TEACHER_UPLOAD (the teacher photographs and uploads on the learners' behalf), STUDENT_SUBMIT (learners upload their own work, with the teacher still able to upload for any pupil without a device), or MANUAL_SCORE (marks recorded directly for work assessed in the room, with no image and no AI). |
| additionalFiles | text (JSON) | NULL | JSON array of storage paths for supporting material such as a reading passage or diagram, supplied to the AI alongside the learner's work. Up to ten files. |
| rubric | text (JSON) | NULL | The rubric governing this activity, embedded as JSON. First tier of the grading fallback ladder; where it is absent or unparseable the lesson rubric, then a recommended template, then a generic DepEd rubric are used in turn. |
| classLessonId | text (UUID) | FK -> ClassLesson.id, NULL | The lesson this activity realizes, if any. |
| maxAttempts | integer | NOT NULL, DEFAULT 1 | How many times a learner may submit. |
| component | text | NULL | DepEd grading component the activity counts toward: WW, PT or QA. Null is treated as Written Work. Distinct from type, which is the pedagogical kind. |
| badgeId | text (UUID) | FK -> TeacherBadge.id, NULL, ON DELETE SET NULL | Teacher badge awarded for passing this activity. Set to null rather than cascading on delete, so removing a badge can never remove the activity or its marks. |
| badgePassingScore | integer | NULL | Whole percentage at or above which the badge is earned. Expressed in percent rather than raw points so the bar does not change meaning when points changes. Distinct from School.passingGrade, which decides subject failure. Null exactly when badgeId is null. |
| createdAt | timestamp(3) | NOT NULL, DEFAULT now() | Row creation timestamp. |

*Relationships and notes.* Indexed on badgeId. One-to-many to Submission; many-to-one to Class, ClassLesson and TeacherBadge.

## Table M.16 Submission

One learner's work on one activity, together with the AI's draft assessment, the teacher's validated assessment, and the quality flags raised between the two. This is the central entity of the grading pipeline.

| Field Name | Data Type | Constraints | Description |
|---|---|---|---|
| id | text (UUID) | PK, NOT NULL | Surrogate primary key. |
| activityId | text (UUID) | FK -> Activity.id, NOT NULL | The activity submitted against. |
| studentId | text (UUID) | FK -> User.id, NOT NULL | The learner. |
| imageUrl | text | NULL | Storage URL of the uploaded work. Multi-page work is stitched into a single tall composite image on upload, which is both what the AI reads and what the review pane displays. Null for a manually scored activity. |
| aiScore | double precision | NULL | The raw, unreviewed AI-generated score as a percentage from 0 to 100. Stored as a floating-point value because marks are entered in raw points, and an integer percentage cannot represent most point totals losslessly. This is the field reported as the raw AI grade in the study's reliability analysis. |
| hitlScore | double precision | NULL | The teacher's validated score as a percentage from 0 to 100, written through the Human-in-the-Loop review screen or entered directly for a manually scored activity. This, never aiScore, is the grade of record. |
| aiFeedback | text (JSON) | NULL | The AI's draft qualitative feedback, serialized as JSON with strengths, areasForGrowth (each an evidence quotation and an explanation), actionableSteps and skillExplanations. |
| hitlFeedback | text (JSON) | NULL | The teacher's validated feedback in the same structure, which is what the learner actually receives. |
| readingStrategy | text | NULL | A personalized reading-comprehension strategy generated for this learner on this paper, delivered as the reciprocal literacy intervention. |
| rubricData | text (JSON) | NULL | Per-criterion breakdown as JSON, giving the score awarded and the maximum available for each rubric criterion. |
| skillScores | text (JSON) | NULL | Per-skill sub-scores as JSON, keyed on vocabulary, punctuation, thematicFlow and sentenceStructure, which drive the learner's skill trend charts. Absent on manually scored work, which the charts correctly skip. |
| covData | text (JSON) | NULL | Chain-of-verification record written when the AI's self-check revised its own mark, holding the original score, the verified score and the difference, so the teacher is told the model corrected itself rather than being shown only the final figure. |
| attemptCount | integer | NOT NULL, DEFAULT 1 | Which attempt this row represents, bounded by Activity.maxAttempts. |
| isLate | boolean | NOT NULL, DEFAULT false | Submitted after the deadline but within the late window. A record rather than a penalty: nothing in the grading engine reads it, so the teacher decides what a late mark is worth. |
| gradeLevelAssumed | boolean | NOT NULL, DEFAULT false | True where the AI graded without a grade level set on the class and silently defaulted to Grade 6 for context, language complexity and calibration. Surfaced as a banner in the review screen; never blocks the save. |
| scoreFeedbackMismatch | boolean | NOT NULL, DEFAULT false | True where a criterion scored below its band maximum but the AI's own areasForGrowth named no specific reason, which is the internal contradiction the grading prompt instructs the model to avoid. Flags the paper for a second look. |
| rubricScoreNote | text | NULL | Set where the AI's arithmetic disagrees with itself: the headline score does not match the criteria it should sum to, or a criterion falls outside the band the model itself assigned. Recorded as a sentence rather than a flag, because the disagreement is only actionable if the teacher is told which two figures conflict. The score is never auto-corrected. Null means the numbers agree. |
| rubricParseFailed | boolean | NOT NULL, DEFAULT false | True where a rubric genuinely existed for the activity but its JSON could not be parsed, so grading fell through to a lower tier of the fallback ladder. Distinct from an activity simply having no rubric, which is the ladder working as designed. |
| scoreOutOfRange | boolean | NOT NULL, DEFAULT false | True where the AI returned a score outside 0 to 100, or a non-finite value, and it had to be clamped. Tells the teacher the headline number was adjusted so they read the rubric breakdown rather than trusting the total. |
| privacyViolation | boolean | NOT NULL, DEFAULT false | True where the AI detected personally identifiable information in the uploaded image beyond what the assessment requires. The paper is withheld pending teacher action and the flag is cleared if a cropped copy is re-uploaded. |
| excusedAt | timestamp(3) | NULL | When a teacher excused the learner from this activity. An excused activity is dropped from the weighted average and the remaining component weights renormalize, so it neither reads as delinquent nor requires an invented mark. |
| excusedReason | text | NULL | The teacher's stated reason, shown to the learner, since an excusal without a reason is precisely what a guardian later asks about. |
| transferId | text (UUID) | NULL | Set only on rows created by a section transfer, namely pre-arrival activities auto-excused when a learner joined partway through. It is what makes a mistaken transfer reversible without ever reaching a mark a teacher entered. |
| pageBreaks | text (JSON) | NULL | Where each page ends inside the stitched composite image, as a JSON array of ascending fractions of total height with the last exactly 1. Fractions rather than pixels, because the composite is rescaled after stitching. This is what allows a single mis-scanned page to be removed without discarding the whole submission. Null for single-page work and for PDF or Word files. |
| status | text | NOT NULL, DEFAULT 'PENDING' | Lifecycle state: PENDING (collected, not yet validated, whether or not the AI has drafted a score), GRADED (a teacher has validated the mark) or ERROR (AI processing failed and manual grading is required). Only GRADED rows may be released, which is the constraint that prevents unreviewed AI output from reaching a learner. |
| releasedAt | timestamp(3) | NULL | When the teacher published the result to the learner. Deliberately separate from status GRADED, so a whole class set can be reviewed before any of it is published and a standard that drifts partway down the pile can still be corrected. Staff see unreleased work; learners see only rows where this is set. |
| gradedAt | timestamp(3) | NULL | When the teacher validated the mark. |
| retainUntil | timestamp(3) | NULL | Data Privacy Act retention deadline, computed as six months after the close of the school year the activity belongs to rather than six months from upload, so that a year's work expires together after the year is over. Null where the school year could not be parsed, which is left for an administrator to resolve rather than guessed. |
| archivedAt | timestamp(3) | NULL | Set when a section transfer archives work that must not follow the learner. Archived rows are excluded from every average, export and analytic but are not deleted, since the rows are a child's actual work. |
| createdAt | timestamp(3) | NOT NULL, DEFAULT now() | When the work was collected. |
| updatedAt | timestamp(3) | NOT NULL | Timestamp of last modification. |

*Relationships and notes.* One-to-many to GradingAuditLog; many-to-one to Activity and User.

## Table M.17 GradingAuditLog

An append-only record of what happened to a submission's grade and when. The submission itself holds only current state, so this entity is what allows an approval to be reconstructed if a grade is disputed months later.

| Field Name | Data Type | Constraints | Description |
|---|---|---|---|
| id | text (UUID) | PK, NOT NULL | Surrogate primary key. |
| submissionId | text (UUID) | FK -> Submission.id, NULL, ON DELETE SET NULL | The submission concerned. Nullable and set to null rather than cascading on delete, so a purged submission's grading history survives the purge. |
| event | text | NOT NULL | AI_GRADED, TEACHER_VALIDATED or RELEASED. |
| actorId | text (UUID) | NULL | The teacher who acted. Null on an AI_GRADED row, since no human acted. |
| score | double precision | NULL | Snapshot of the score as at this event. |
| studentId | text (UUID) | NULL | Denormalized onto the row so the event still identifies its subject after the submission link is severed by a purge. |
| activityId | text (UUID) | NULL | Denormalized activity identifier, for the same reason. |
| activityTitle | text | NULL | Denormalized activity title, so the record remains readable without a join. |
| schoolId | text (UUID) | NULL | Denormalized owning school. |
| policySnapshot | text (JSON) | NULL | Populated only on a RELEASED event: the exact component weights, transmutation setting and passing grade in force at the moment the grade was published. Every other screen reads those live, so this is the only record of what a guardian actually saw on release day. |
| createdAt | timestamp(3) | NOT NULL, DEFAULT now() | When the event occurred. |

*Relationships and notes.* Indexed on submissionId. Deliberately minimal: an event, an actor and a score snapshot, without a full feedback-text copy.

## Table M.18 GradingExample

A single teacher correction retained as few-shot demonstration material, forming the calibration corpus that steers subsequent AI grading toward that teacher's standards.

| Field Name | Data Type | Constraints | Description |
|---|---|---|---|
| id | text (UUID) | PK, NOT NULL | Surrogate primary key. |
| teacherId | text (UUID) | FK -> User.id, NOT NULL | The teacher whose standard this example encodes. Examples are per teacher and are deliberately not transferred when a teacher account is replaced. |
| activityType | text | NOT NULL | The kind of activity the correction was made on, so examples are retrieved only for comparable work. |
| gradeLevel | text | NULL | Grade level of the class the correction came from. |
| aiFeedback | text | NOT NULL | The AI's original feedback. |
| teacherFeedback | text | NOT NULL | The teacher's replacement feedback. |
| aiScore | integer | NOT NULL | The AI's original score, rounded to a whole number. Whole numbers are used because this is prompt material rather than a grade of record. |
| teacherScore | integer | NOT NULL | The teacher's corrected score, likewise rounded. |
| createdAt | timestamp(3) | NOT NULL, DEFAULT now() | When the correction was captured. |

*Relationships and notes.* A row is written only when a real AI score existed and the teacher changed it by at least five points or substantively rewrote the feedback. The precondition is load-bearing: without it, a paper the AI never touched produced a fabricated correction teaching the model that its own scores ran far too low.

## Table M.19 RubricTemplate

A reusable rubric, either private to one teacher or published school-wide by an administrator.

| Field Name | Data Type | Constraints | Description |
|---|---|---|---|
| id | text (UUID) | PK, NOT NULL | Surrogate primary key. |
| name | text | NOT NULL | Template name. |
| criteria | text (JSON) | NOT NULL | The rubric itself as JSON: an array of criteria, each with its descriptor bands and the maximum points available. |
| teacherId | text (UUID) | FK -> User.id, NULL, ON DELETE CASCADE | Set for a teacher's private template; null for a school-wide one. |
| schoolId | text (UUID) | FK -> School.id, NULL, ON DELETE CASCADE | Set for an administrator-published, school-wide template; null for a private one. |
| gradeLevel | text | NULL | Grade level the rubric is intended for. Null on both this and subject means the rubric applies to any. |
| subject | text | NULL | Subject the rubric is intended for. |
| curriculumId | text (UUID) | FK -> Curriculum.id, NULL, ON DELETE SET NULL | Set where the rubric was extracted from an uploaded curriculum, so deleting that curriculum can clean up what it generated. |
| outputType | text | NULL | The lesson output type the rubric was generated for, e.g. Essay. |
| createdAt | timestamp(3) | NOT NULL, DEFAULT now() | Row creation timestamp. |

*Relationships and notes.* Exactly one of teacherId and schoolId is populated, which is what distinguishes a private template from a published one.

## Table M.20 AiRequestLog

One row per request actually dispatched to the model provider. Created for the study's technical observation, since neither per-request latency nor real daily consumption was otherwise recoverable: the quota tally lives in an in-memory counter that resets on restart.

| Field Name | Data Type | Constraints | Description |
|---|---|---|---|
| id | text (UUID) | PK, NOT NULL | Surrogate primary key. |
| purpose | text | NOT NULL | Call site: GRADING, ASSIST, EXTRACT, PARSE, SELFCHECK or OTHER. GRADING and ASSIST draw on separate budgets so the teacher assistant cannot exhaust the allowance the checking queue depends on. |
| model | text | NULL | The model label the request was sent to, including the key bucket, e.g. gemini-3.6-flash#1. |
| attempt | integer | NOT NULL, DEFAULT 0 | Zero for a first try; one or more marks a retry of the same logical call. One row per attempt rather than per paper, because a retry consumes a second request against the provider's allowance. |
| latencyMs | integer | NOT NULL | Wall-clock milliseconds from dispatch to response or error, including any wait for a concurrency slot, which is what the teacher actually experiences. This is the field from which the reported mean AI processing time was derived. |
| ok | boolean | NOT NULL | Whether the request succeeded. |
| outcome | text | NOT NULL | OK, QUOTA, DAILY_QUOTA, BAD_CREDENTIAL, TRANSIENT, BAD_IMAGE or ERROR. Free text rather than an enum so a new outcome costs no migration. |
| detail | text | NULL | Truncated provider error message. Provider errors describe the request rather than the paper, so nothing identifying a learner reaches this column. |
| requestBytes | integer | NULL | Approximate outbound payload size, prompt text plus decoded inline image. This is the measurement from which the image-optimization module's bandwidth benefit can be quantified. |
| responseBytes | integer | NULL | Size of the raw JSON response. Null on failure and where the response carries no text. |
| promptTokens | integer | NULL | Prompt tokens reported by the provider's usage metadata. |
| candidateTokens | integer | NULL | Response tokens reported by the provider. |
| totalTokens | integer | NULL | Total tokens reported by the provider, the basis of any per-paper cost estimate. |
| createdAt | timestamp(3) | NOT NULL, DEFAULT now() | When the request was made. |

*Relationships and notes.* Indexed on createdAt and on (purpose, createdAt). Deliberately carries no link to a submission, learner, prompt or response text: it answers how the service behaved, while the pairing of AI draft to teacher decision belongs to GradingAuditLog. Writes are fire-and-forget, so observation can never fail a teacher's grading run.

## Table M.21 AdminAuditLog

An append-only record of who was granted or lost school-administrator access, and who did it. User.role shows only the current answer, and who handed over the keys is the first question asked when a school's data has been changed by someone unexpected.

| Field Name | Data Type | Constraints | Description |
|---|---|---|---|
| id | text (UUID) | PK, NOT NULL | Surrogate primary key. |
| schoolId | text (UUID) | NOT NULL | The school whose administrator set changed. |
| event | text | NOT NULL | ADMIN_CREATED, ADMIN_PROMOTED, ADMIN_DEMOTED or ADMIN_PASSWORD_RESET. |
| actorId | text (UUID) | NULL | The administrator who performed the action. Null only for a row written by a maintenance script. |
| actorName | text | NULL | The actor's name as at the time of the action, denormalized so the row stays readable. |
| targetId | text (UUID) | NULL | The account acted upon. |
| targetName | text | NULL | The target's name as at the time of the action. |
| targetEmail | text | NULL | The target's login address as at the time of the action. |
| createdAt | timestamp(3) | NOT NULL, DEFAULT now() | When the action occurred. |

*Relationships and notes.* Indexed on (schoolId, createdAt). Nothing here is a foreign key, so no delete anywhere can cascade this history away; a demoted administrator may later be removed entirely, and a row identifying them only by a dangling identifier would be worthless at exactly the moment it is read.
