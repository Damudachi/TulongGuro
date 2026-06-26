# TulongGuro UX and AI Grading Enhancements

This plan addresses the bugs and UX improvements reported during the latest testing, as well as significant upgrades to the AI grading engine's context awareness.

## User Review Required

> [!IMPORTANT]
> Please review the **Proposed Onboarding Features** section. I have added a few ideas to improve the onboarding experience, but I want to make sure they align with your vision before implementing them.
> Also, for the **AI Conversation per section**, rather than maintaining a literal conversational chat history (which could lead to context window bloat and hallucinations), I propose fetching the *last 3 graded submissions from the same section* and passing them to the AI as "Few-Shot Examples". This gives the AI the exact context of how this section performs and how you typically grade them. Does this approach work for you?

## Open Questions

1. For the "hover to change grade" feature in the HITL Workspace, should we lock *just* the rubric sliders, or the entire qualitative feedback section (Strengths, Areas for Growth) as well, requiring an "Edit Feedback" button click to change anything?

## Proposed Changes

### 1. Fix Onboarding Walkthrough State
Currently, the walkthrough banner dismissal is saved in `localStorage` globally. If a new teacher logs in on the same browser, the banner is hidden.
- **[MODIFY]** [Dashboard.jsx](file:///d:/tulongguro2/src/pages/teacher/Dashboard.jsx)
  - Scope the `localStorage` key to the user's ID (e.g., `hasSeenTeacherWalkthrough_${user.id}`).

### 2. Unified Student Search Combobox
The Batch Upload page currently has both a text input and a separate dropdown.
- **[MODIFY]** [BatchUpload.jsx](file:///d:/tulongguro2/src/pages/teacher/BatchUpload.jsx)
  - Combine the text search and dropdown into a single modern Combobox. Typing will filter a dropdown list that appears directly below the input, and clicking an item will select it.

### 3. Lock HITL Grades Initially
To prevent accidental changes and encourage review first:
- **[MODIFY]** [HITLWorkspace.jsx](file:///d:/tulongguro2/src/pages/teacher/HITLWorkspace.jsx)
  - Add an `isEditingScore` state (default `false`).
  - Lock the rubric sliders and hide the manual input controls until the user clicks an "Adjust Scores" button next to the total score.

### 4. Detailed Rubrics
- **[MODIFY]** [RubricManager.jsx](file:///d:/tulongguro2/src/pages/teacher/RubricManager.jsx)
  - Update the `DEPED_RUBRICS` constant to include detailed scoring bands. For example, instead of just a description, the AI and teacher will see: 
    - *35-40: Exceptional grammar and vocabulary.*
    - *25-34: Average grammar with minor errors.*
    - *0-24: Significant grammatical issues.*

### 5. Enhanced AI Context (Grade Level, Topic, Section Context)
- **[MODIFY]** [server.js](file:///d:/tulongguro2/server/server.js)
  - **Grade & Topic Knowledge**: Update the system prompt to explicitly instruct Gemini to evaluate against DepEd K-12 standards for the specific `gradeLevel` and subject.
  - **Section Context (Few-Shot Prompting)**: In the grading endpoint, query the database for 1-2 recently graded submissions from the *same section* and *same activity*. Inject these into the prompt as examples of "How this section performs and how the teacher grades". This gives the AI the "conversation per section" context you requested without the risk of long-term memory hallucinations.

### 6. Proposed Additional Onboarding Features
To further reduce cognitive load:
- **"Feature Unlocks"**: Hide advanced tabs (like "Reports" or "Batch Upload") until the teacher has completed their first manual grade in the HITL workspace.
- **Interactive Tooltips**: Add pulsing tooltips in the HITL Workspace pointing out the Rubric Sliders, the AI Co-pilot chat, and the "Validate & Release" button for first-time users.

## Verification Plan

### Automated Tests
- No automated tests required for these UI/Prompt changes.

### Manual Verification
- Create a new teacher account and verify the walkthrough banner appears.
- Navigate to Batch Upload and verify the unified combobox works for searching and selecting students.
- Open a demo submission and verify the sliders are locked until "Adjust Scores" is clicked.
- Test the AI grading endpoint to ensure the new detailed rubrics and section context are passed in the prompt correctly.
