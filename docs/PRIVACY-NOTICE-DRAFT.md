# TulongGuro — Privacy Notice (DRAFT)

**Status: draft for review. Not yet published anywhere in the application.**

Prepared against Republic Act No. 10173, the Data Privacy Act of 2012, and the
issuances of the National Privacy Commission (NPC). This is a drafting
document, not legal advice; it should be reviewed by counsel or by the school
division's Data Protection Officer before it is issued to anyone.

---

## How to read this file

There are **two notices** here, because TulongGuro stands in two different
positions depending on whose data is involved.

| | Notice A | Notice B |
|---|---|---|
| **About** | School registration | Learner data |
| **Who decides the purpose** | TulongGuro | The school |
| **TulongGuro's role** | Personal Information Controller | Personal Information Processor |
| **Who must issue it** | TulongGuro | The school |
| **Audience** | The principal or staff member registering | Guardians and learners |
| **Where it appears** | Registration form, step 2, beside the consent boxes | Issued by the school; summarised in-app |

Getting this split right matters. When a school uses TulongGuro to grade its
learners' work, the **school** decides why the data is processed and therefore
owes the notice to guardians. But when someone registers a school, **TulongGuro**
decides what to collect and why — it asks for a photograph of that person's ID
on its own account — so that notice is TulongGuro's to give.

Placeholders in `[SQUARE BRACKETS]` must be filled before publication.

---

## ⚠ Claims this draft deliberately does NOT make

Every sentence below was checked against the code. These four are **not true
today**, so the draft either omits them or words them to match reality. Do not
"tidy" them into stronger language without building the thing first.

1. **Automatic deletion.** `retainUntil` is computed on every submission, but
   nothing executes it — there is no scheduled job, and `purge-grades` only
   runs when an operator calls it by hand. The draft therefore says work is
   kept "for at least" the retention period and that deletion is carried out on
   request. It must not say work "is deleted after six months."

2. **Self-service erasure.** There is no route by which a guardian or learner
   can request deletion of their own record. The draft routes every rights
   request through a human contact, which is what actually happens.

3. **Complete deletion on purge.** `purge-grades` removes database rows but not
   the stored page images, which remain in file storage. Until that is fixed,
   the draft does not promise that deletion removes the scanned work.

4. **Guaranteed anonymity at the AI service.** Names are never placed in the
   text sent to the AI, and a test enforces this at the network boundary. But
   the *image* of the page is sent, and if the learner's handwritten name was
   not blacked out before upload it is visible in that image. The draft says so
   plainly rather than claiming anonymity it cannot guarantee.

---
---

# NOTICE A — School Registration

*Shown on the registration form, beside the consent checkboxes.*

## Who is collecting this

TulongGuro, operated by [LEGAL NAME / INSTITUTION], is responsible for the
information collected on this registration form.

Data Protection Officer: **[NAME]**, [EMAIL], [CONTACT NUMBER].

## What we collect from you, and why

| What | Why we need it |
|---|---|
| Your full name and email address | To create the administrator account for your school and to contact you about the registration |
| Your chosen password | Stored only as an encrypted hash — we never hold the password itself |
| Your school's name and DepEd School ID | To confirm the school is real, against the list DepEd publishes |
| **A photograph of your school or employee ID** | To confirm that you work at the school you are registering. The DepEd School ID proves the *school* exists; this is the other half — that *you* are connected to it |
| A supporting document, where the School ID cannot be matched | Same purpose, where the automatic check cannot confirm the school |
| Your school's logo, if you provide one | To display on your school's pages in the app |
| The internet (IP) address the form was sent from | To detect one person registering many false schools |

## About the photograph of your ID

This is the most sensitive item on the form, and it is treated differently from
the rest:

- It is stored in a **private area** of our storage, not the public one used for
  your school's logo.
- It is **never** made available at a permanent web address. It can only be
  opened through a temporary link that expires.
- Only a **TulongGuro operator reviewing your registration** can open it. Your
  own staff, other schools, teachers and learners cannot.
- We record **when** you ticked the box agreeing to provide it, so that the
  permission can be shown later.

**How long it is kept:** [DECISION REQUIRED — see note below.] At present it is
kept for as long as your school's record exists. If your registration is
refused, the photograph is deleted together with the rest of the registration.

> **Note to the team, not for publication.** The photograph's purpose — letting
> an operator judge one registration — is complete the moment the school is
> approved or refused. Keeping it indefinitely after that has no stated purpose,
> which is the condition the Data Privacy Act's retention principle is about. A
> defined period after approval (for example 30 days, to allow the decision to
> be revisited) would let this paragraph state a real limit. Until that is
> decided this notice cannot honestly give one.

## Who else sees this

Nobody outside TulongGuro. Registration information is not sent to the AI
service, is not shared with other schools, and is not sold or disclosed to any
third party. It is held on our database and storage providers, which act only
on our instructions.

## Your rights

You may ask us to show you what we hold about you, correct anything wrong,
object to how we use it, or ask that it be deleted or blocked. You may also
complain to the National Privacy Commission at **privacy.gov.ph**.

To exercise any of these, write to **[DPO EMAIL]**. We will respond within
[N] working days.

---
---

# NOTICE B — Learner Data

*For the school to issue to guardians and learners. A summary appears in the
app; this is the full text.*

## Who is responsible

**[SCHOOL NAME]** decides what learner information is collected and why, and is
responsible for it. Its Data Protection Officer is **[NAME]**, [CONTACT].

**TulongGuro** provides the software and processes learner information only on
the school's instructions. Its Data Protection Officer is **[NAME]**,
[CONTACT].

## Why this notice exists

School work, grades and feedback are **sensitive personal information** under
the Data Privacy Act, and learners are children. Both of those raise the
standard of care above that for ordinary information, and both are the reason
this notice is longer than you might expect.

## What is collected about a learner

| What | Why |
|---|---|
| Name and learner ID | To identify whose work is whose |
| Date of birth | Used to create the learner's first password, so a young child can be told "your password is your birthday" and will remember it |
| Class and section | To place the learner with the right teacher and subject |
| **Photographs or files of submitted work** | The work itself, as handed in |
| Draft scores and feedback produced by the AI | A starting point for the teacher — never the final mark |
| The teacher's final score and feedback | The grade of record |
| A record of who changed a grade, and when | So a mark can be explained afterwards |
| Sign-in times and notification settings | To operate the account |

No learner is asked for a photograph of an ID, a home address, a contact
number, or any health or family information.

## How artificial intelligence is used, and what leaves the country

TulongGuro uses an AI service operated by **Google** to read submitted work and
propose a draft score and comments. Please read this section carefully, because
it is where information leaves the school's own systems.

**What is sent:** the image of the page, the activity's instructions and the
teacher's rubric.

**What is not sent:** the learner's name, learner ID, class, section, school,
birthday, or any other detail identifying them. The software refers to each
learner only as "Student 1", "Student 2" and so on. This is enforced
automatically — an automated test inspects the exact data sent to Google and
fails if a name ever appears in it.

**The one thing to understand:** the *picture of the page* is sent. If the
learner wrote their name on their paper and it was not blacked out before
upload, that handwritten name is part of the picture. Before any photograph is
uploaded, TulongGuro asks the learner or teacher to draw a black box over the
name, and this happens **on the device, before the picture is sent anywhere**.
The box permanently removes that part of the picture. Whether it is drawn is up
to the person uploading.

**Where it goes:** Google processes this outside the Philippines. The school
remains responsible for the information even after it is transferred.

**What the AI does not decide:** the AI never sets a learner's grade. It
proposes a draft that a teacher must review, may change, and must approve
before the learner sees anything. A grade nobody approved is never released.

## Who can see a learner's work

| Who | What they can see |
|---|---|
| The learner | Their own work, grades and feedback |
| Their teachers | Work and grades for the classes they teach |
| School administrators | Records for their own school |
| Other schools | **Nothing.** Each school's data is separated |
| TulongGuro staff | Only for technical support, and only where necessary |
| Google's AI service | The page image and rubric, without names, as described above |
| Guardians | Through the school, on request |

## How long it is kept

Submitted work and its grades are kept for **at least six months after the end
of the school year** the work belongs to. Records from SY 2025–2026 are kept
until at least **30 September 2026**.

The period is counted from the end of the school year rather than from the day
the work was handed in, so that a whole year's work reaches the end of its
retention together. This is deliberate: a teacher answering a question about a
first-term grade in March must still be able to open the paper it came from.

**Work is not deleted automatically.** After the retention period, the school
may ask TulongGuro to archive it — which hides it from averages, reports and
analysis without erasing it — and may then ask for it to be permanently
deleted. Both actions are carried out on request.

Records of who changed a grade and when are kept after the work itself is
deleted, so that a mark issued in the past can still be accounted for. These
records identify the learner but do not contain their work.

## How it is protected

- Passwords are stored only as encrypted hashes and never in readable form.
- Signing in issues a signed session that expires, and can be revoked.
- Repeated wrong passwords temporarily lock an account, to stop guessing.
- Each school's data is separated; a request for another school's records is
  refused by the server, not merely hidden by the app.
- Uploaded work is held by our storage provider, not on a teacher's own device.

## Rights of the learner and their guardian

Under the Data Privacy Act you may:

- **be told** what is held and why — this notice;
- **see** the information held about the learner;
- **correct** anything inaccurate;
- **object** to particular processing;
- **ask for erasure or blocking** where processing is unlawful, or the
  information is no longer needed, or consent is withdrawn;
- **be compensated** for damage caused by false or unlawfully processed
  information;
- **receive a copy** of the information in a portable form;
- **complain** to the National Privacy Commission at **privacy.gov.ph**.

Because the learner is a child, these rights are normally exercised by a parent
or guardian.

**How to exercise them:** write to the school's Data Protection Officer at
**[SCHOOL DPO EMAIL]**. The school will respond within [N] working days and
will instruct TulongGuro where a change to the system is needed. There is no
self-service button for this; a person handles each request.

## If something goes wrong

If information is lost or disclosed without authority and there is a real risk
of serious harm, the school and TulongGuro will notify the National Privacy
Commission and the people affected **within 72 hours** of becoming aware of it,
as the law requires.

## Questions

School's Data Protection Officer: **[NAME]**, [EMAIL], [NUMBER].
TulongGuro: **[EMAIL]**.

*Version [N] — [DATE]. We will tell you if this notice changes in a way that
affects you.*

---
---

# Short in-app texts

Full notices are too long for most screens. These are the short versions, each
linking to the full text at `/privacy`.

**On the redaction screen** — the single most valuable sentence in the app,
because this tool currently appears with no explanation at all:

> Black out the name before uploading. The picture of this page is read by an
> AI service to draft a score — your name does not need to be in it.
> [Why we ask →]

**On the submission screen, under the upload button:**

> Work you upload is read by an AI to draft a score. Your teacher reviews and
> approves every grade before you see it. [How your work is used →]

**Teacher and admin Settings, "Data and privacy" card:**

> Learner work is processed by an AI service to draft scores, without learner
> names. Teachers approve every grade before release. Work is kept for at least
> six months after the school year ends. [Full privacy notice →]
> [Retention details →]

**Registration form, beside the consent boxes:**

> We ask for a photo of your school ID to confirm you work at the school you
> are registering. Only a TulongGuro reviewer can open it, through a temporary
> link. [What we do with your information →]

---

## Before publication

1. **Fill every `[BRACKET]`.** A notice with a placeholder contact is worse
   than none — it names a right and then gives nowhere to exercise it.
2. **Designate a Data Protection Officer.** Required of every controller and
   processor. This is a person, not a mailbox.
3. **Decide the ID photograph's retention period.** Notice A cannot state a
   limit until one exists.
4. **Translate Notice B into Filipino.** Guardians in a public school are the
   primary audience and many will read Filipino more comfortably than English.
   A notice nobody can read does not inform anyone, which is the entire point
   of the right to be informed. This needs a competent translator, not a
   machine pass — the words "erasure", "blocking" and "objection" carry
   specific legal meanings that a loose translation loses.
5. **Check whether NPC registration is required.** A controller processing the
   sensitive personal information of 1,000 or more individuals must register
   its data processing systems. Count the learners across participating
   schools.
6. **Complete a Privacy Impact Assessment.** Already recommended in
   `CONCLUSION-AND-RECOMMENDATIONS.md`, and the natural companion to this
   notice.
7. **Re-read the four claims at the top of this file** and confirm they are
   still the things the system does not do. If the retention job is built, this
   draft gets stronger in three places.
