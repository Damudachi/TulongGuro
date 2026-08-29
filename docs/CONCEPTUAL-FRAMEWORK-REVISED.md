# Conceptual Framework (revised)

This study is a Design Science Research (DSR) study, and its conceptual framework is
organized on the Input–Process–Output (IPO) model applied to the research itself rather
than to the runtime behavior of the software. In DSR terms, the Inputs are the knowledge
base and the empirical materials the study drew upon; the Process is the sequence of DSR
activities through which the artifact was specified, constructed, demonstrated, and
evaluated; and the Outputs are the evaluated artifact together with the empirical and
design knowledge the study produced about it. TulongGuro is therefore positioned within
the framework as the artifact — at once the object the study constructs and the instrument
through which its questions are answered — and not as the study's output in itself. What
the study ultimately yields is evaluated knowledge about whether, and under what
conditions, a VLM-integrated LMS gradebook can reduce teachers' grading workload while
preserving professional grading authority over every mark a learner receives.

## Input

The first strand of input is the study's knowledge base, comprising the theoretical and
policy foundations that justify the design. Three bodies of literature inform it. The
first establishes teacher workload as a structural barrier to timely formative assessment
in Philippine public schools (Jomuad et al., 2021; EDCOM 2, 2024; PIDS, 2023), which is
the problem the artifact is designed to address. The second establishes that the
educational value of feedback lies in its timeliness and qualitative substance rather
than in numerical scoring alone (Cavalcanti et al., 2021; Dixson et al., 2022;
Fleckenstein et al., 2023), which is what the artifact is designed to deliver. The third
establishes the Human-in-the-Loop principle: that educational AI should support rather
than replace professional teacher judgment (Celik et al., 2022; Khosravi et al., 2022;
Fajardo-Ramos et al., 2025), which is the constraint the artifact is designed under. To
these are added the governing policy instruments — DepEd Order No. 8, s. 2015, which
supplies the component weightings for Written Work, Performance Tasks, and Quarterly
Assessment, the performance descriptor bands against which grading agreement is
classified, and the official transmutation tables; and the DepEd Grade 6 English
curriculum standards and competencies, which define the domain the artifact operates in.

The second strand comprises the empirical materials collected for the study. These
include the Grade 6 English grading rubrics in use at the participating schools, sourced
from Mabalacat Elementary School and validated by the Head Coordinators of all three
participating schools; the teacher-established reference grades against which the raw AI
output is compared; baseline manual grading-time logs recorded by the participating
teachers before exposure to the system; the learners' constructed-response outputs in
handwritten, typewritten, and digital form; and the institutional, section, and roster
data required to operate the system in a real school. From the validated rubrics the
study derives its four monitored competency domains — Reading Comprehension, Critical and
Media Literacy, Writing and Composition, and Grammar and Vocabulary — by grouping the
assessment criteria the participating schools already use, rather than importing a
framework from outside them. Every rubric criterion the system subsequently encounters,
whether drawn from a school template or authored by a teacher, is mapped into one of these
four domains, so that the longitudinal view of a learner's progress remains well defined
whichever rubric a given activity was marked against.

The third strand is the technical and environmental context that bounds the design. The
study operates on a pre-trained multimodal vision-language model accessed through a cloud
API rather than a model trained for this purpose, so the AI work within the study consists
of foundation-model selection and iterative prompt and rubric engineering rather than
model training. The design environment is the Philippine public-school classroom as it
actually is: large class sizes, paper-based outputs, intermittent connectivity, and mixed
device availability rather than a one-to-one student-to-device ratio. These conditions
enter the framework as design constraints, not as incidental circumstances.

## Process

The Process is the DSR cycle, comprising five activities. Problem Explication established
the grading-workload problem and its consequences for feedback quality from the literature
and from consultation with practicing teachers. Requirements Definition translated that
problem, together with DepEd policy and the Human-in-the-Loop constraint, into
requirements for the artifact. Design and Development constructed the artifact across
Agile sprints, producing the progressive web application, the three role-specific
interfaces, the Human-in-the-Loop review architecture, and the AI-assisted checking
pipeline; the AI component of each sprint consisted of model selection and iterative
prompt and rubric engineering, and the server-side submission-processing pipeline was
implemented here (its parameters are specified in the Methods chapter rather than in this
framework). Demonstration exercised the completed artifact in its intended setting,
through a closed Alpha benchmarking phase conducted by the research team with professional
Quality Assurance support, followed by a one-week Beta field deployment across three
elementary schools — two DepEd public schools (Mabalacat Elementary School and San Joaquin
Elementary School) and one private school (Young Builders' School).

Evaluation, the fifth activity, is where the study's constructs are measured, and it
proceeds along four strands corresponding to the objectives. Grading reliability is
measured by classifying the raw, unreviewed AI-generated score and the teacher-established
reference grade for each paper into the DepEd descriptor bands and computing accuracy,
per-band precision and recall, and the macro-averaged F1-score from the resulting
confusion matrix, alongside the Mean Absolute Error, normalized MAE, and mean signed
deviation. Perceived usability is measured by administering the System Usability Scale
separately to the intended users of each of the three interfaces. Grading workload is
measured through a quasi-experimental paired comparison of teacher grading duration before
and after using the system, at the level of the individual paper, the full class set, and
the turnaround from collection to the return of validated feedback. Software quality and
privacy are measured through a weighted ISO/IEC 25010:2023 evaluation and a Data Privacy
Officer implementation assessment.

The relationship among these constructs is directional and is what the framework asserts.
The reliability of the raw AI output is an independent property of the model; the
reduction in teacher workload is the outcome of interest; and Human-in-the-Loop review is
the mediating condition that stands between them. The framework holds that workload
reduction is obtainable without autonomous grading accuracy, precisely because the review
gate converts an imperfect draft into a defensible grade before it reaches a learner. It
follows that raw agreement figures are to be read as a property of the model rather than
as a measure of the system's fitness for use, and that the two must not be conflated.

## Output

The study produces four outputs. The first is the instantiated and evaluated artifact: a
tri-interface LMS gradebook in which the School Administrator governs institutional
scaffolding, the Teacher operates a gradebook and Human-in-the-Loop review workspace with
full authority to edit or approve every AI draft, and the Learner receives released grades,
qualitative feedback, personalized reading-comprehension strategies, and a longitudinal
view of the four monitored competencies. Within that artifact a submission is collected as
PENDING, remains PENDING while the AI drafts a score against a human-authored rubric,
becomes GRADED only when a teacher validates it, and becomes visible to the learner only
when the teacher subsequently releases the reviewed set — three states and a separate
publication act, so that no unreviewed AI output can reach a learner and a standard that
drifts partway down a class set can still be corrected before any mark is seen. Every
transition is written to an append-only audit log recording the actor, the timestamp, and
the score at that step.

The second output is the study's empirical findings: the measured agreement between raw AI
grades and teacher reference grades, the measured usability of each interface, the measured
reduction in grading time and feedback turnaround, and the measured AI processing time per
paper. The third is design knowledge — transferable propositions that outlive this
particular build. Chief among them is the positioning principle that, at current
vision-language-model reliability, the value of AI-assisted assessment lies in decision
support rather than in autonomous grading, together with the corollaries that the review
gate is the condition of a grade's defensibility rather than a precaution added to it, that
withholding publication until a set is complete protects consistency across a class, and
that a system of this kind is viable in low-resource classrooms only if it is designed for
mixed-device use and intermittent connectivity from the outset. The fourth output is the
set of recommendations for practice, for policy, and for further research that follow from
the findings.

## Feedback

The framework contains two feedback loops, and the distinction between them is essential
because they operate at different levels and only one of them is a research process.

The research-level loop is DSR iteration. Findings from Demonstration and Evaluation return
to Requirements Definition and Design and Development, so that each cycle refines the
artifact and the requirements together. This is the loop that connects the study's Output
back to its Process.

The artifact-level loop is the adaptive few-shot prompting mechanism operating inside a
deployed instance, through two channels. In Channel 1, whenever a teacher's validation
materially overrides the AI draft — defined as a score adjustment of five points or more,
or a substantive edit to the qualitative feedback — the model's original draft and the
teacher's finalized revision are stored together as a paired calibration example, and a
bounded moving window of the three most recent pairs for that teacher, activity type, and
grade level is injected into subsequent prompts. In Channel 2, the three most recently
approved submissions from the same section are supplied as contextual demonstrations of
that cohort's demonstrated performance level. This loop is a property of the artifact and
belongs to the Process box as part of what was built; it is not a research activity, and
it is not the arrow that carries findings back into design.

## Boundary Conditions

The framework operates within stated limits, which bound the claims it can support. The
domain is Grade 6 English; the assessments are rubric-scored constructed responses rather
than answer-key instruments; the artifact is a decision-support tool and not an autonomous
grader; the grading pipeline depends on a third-party cloud vision-language model whose
pricing, uptime, and policies lie outside the researchers' control; and the empirical
evaluation rests on three teachers across three schools over one week. These conditions are
part of the framework rather than caveats appended to it, because they determine the range
over which its propositions are asserted to hold.
