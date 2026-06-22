# ```markdown

# \# Improve AI Output Checker + Build Student Chatbot

# 

# \## Background

# The TulongGuro LMS has an AI grading pipeline (Gemini Vision → HITL review) that currently:

# 1\. \*\*Fails silently or inconsistently\*\* — the JSON parsing from Gemini sometimes breaks, and there's no retry with structured output.

# 2\. \*\*Produces shallow feedback\*\* — the prompt asks for "3 sentences max" with no guidance on \*what\* makes good tutoring feedback.

# 3\. \*\*No student-facing chatbot exists\*\* — the AI Co-Pilot in HITL is teacher-only; students have no way to ask for help.

# 

# \---

# 

# \## Part 1: AI Output Checker Improvements

# 

# \### Problem Analysis

# \- The Gemini prompt limits feedback to "3 sentences max" — too brief for meaningful tutoring.

# \- No structured tutoring framework.

# \- "Areas for Growth" can be too abstract for Grade 6 students (they need to see their exact mistakes).

# \- JSON parsing is brittle — `callGemini` does a raw `JSON.parse` with minimal cleanup, no retry.

# 

# \### Proposed Changes

# 

# \#### \[MODIFY] server/server.js

# 

# \*\*1. Redesign the AI prompt to act as a pedagogical tutor\*\*

# \- Expand feedback into a structured "Show, Don't Tell" format:

# &#x20; - \*\*Strengths:\*\* What the student did well (always start positive).

# &#x20; - \*\*Areas for Growth (Evidence-Based):\*\* Must extract exact quotes from the student's handwritten essay to prove the mistake, followed by a Grade-6-friendly explanation.

# &#x20; - \*\*Actionable Steps:\*\* 1 to 2 bite-sized, concrete tasks (e.g., "Try rewriting the second sentence using the word 'Because'").

# \- Connect the `readingStrategy` specifically to the detected weaknesses.

# 

# \*\*2. Make JSON parsing robust\*\*

# \- Add retry logic (up to 2 retries) for JSON parse failures.

# \- Use `generationConfig.responseMimeType = 'application/json'` to force Gemini structured output.

# 

# \*\*3. Update Feedback Schema Definition\*\*

# Instruct Gemini to return the `aiFeedback` string strictly matching this JSON structure:

# ```json

# {

# &#x20; "strengths": "String detailing what the student did well.",

# &#x20; "areasForGrowth": \[

# &#x20;   {

# &#x20;     "studentQuote": "Exact sentence from the essay with the error.",

# &#x20;     "explanation": "Why it needs improvement in simple terms."

# &#x20;   }

# &#x20; ],

# &#x20; "actionableSteps": \[

# &#x20;   "String containing a bite-sized instruction."

# &#x20; ],

# &#x20; "skillExplanations": {

# &#x20;   "Grammar": "Explanation of the score...",

# &#x20;   "Vocabulary": "Explanation of the score..."

# &#x20; }

# }

# 

# ```

# 

# \#### \[MODIFY] src/pages/teacher/HITLWorkspace.jsx

# 

# \* Parse the structured JSON feedback and display it in organized sections.

# \* Ensure the `studentQuote` is visually highlighted so the teacher can easily verify the AI did not hallucinate the error.

# \* Allow the teacher to edit all sections before releasing.

# 

# \#### \[MODIFY] src/pages/student/OutputDetails.jsx

# 

# \* \*\*Implement Progressive Disclosure UI:\*\* Do not overwhelm the student with a wall of text.

# \* Show the Total Score and "Strengths" first.

# \* Use an expandable accordion/tab for "Where I can grow" (showing the quotes and explanations) and "Action Steps".

# 

# 

# \* \*\*Deep-Link the Chatbot:\*\* Add an "Ask Study Buddy" button directly inside the "Areas for Growth" card so students can instantly ask for help regarding a specific mistake.

# 

# \---

# 

# \## Part 2: Student Chatbot (AI Study Buddy)

# 

# \### Concept

# 

# A floating chatbot bubble on the student dashboard that acts as a \*\*Socratic Tutor\*\*. It helps students understand their feedback, provides study tips, and gives encouragement, but strictly refuses to do the work for them.

# 

# \### Proposed Changes

# 

# \#### \[NEW] src/components/StudentChatbot.jsx

# 

# A floating chat bubble component that:

# 

# \* Appears as a branded FAB in the bottom-right corner.

# \* Opens into a chat drawer with conversation history.

# \* Sends messages to a new API endpoint.

# \* Contextually aware: automatically pre-loads the student's current assignment and rubric scores.

# 

# \#### \[MODIFY] server/server.js

# 

# Add a new endpoint: `POST /api/student/chat`

# 

# \* Accepts `{ studentId, message, conversationHistory, context (current grades/feedback) }`

# \* \*\*Implement Strict Anti-Cheating Guardrails in the Prompt:\*\*

# \* \*Persona:\* "You are an encouraging, localized Socratic tutor for a Grade 6 student in the Philippines."

# \* \*Rules:\* "You are strictly forbidden from writing essays, giving direct answers, or doing the student's work. You must use the Socratic method: ask leading questions to guide the student to discover the answer themselves. Celebrate their effort."

# 

# 

# \* Sends to Gemini (`gemini-2.0-flash`) and returns the AI response.

# 

# \#### \[MODIFY] src/layouts/StudentLayout.jsx

# 

# \* Render the `<StudentChatbot />` component so it persists across student pages.

# 

# \---

# 

# \## Verification Plan

# 

# \### Manual Verification

# 

# \* \*\*Output Checker:\*\* Upload a test essay. Verify the JSON contains an exact `studentQuote` from the image and realistic `actionableSteps`.

# \* \*\*UI UX:\*\* Verify the HITL workspace and Output Details render the new array-based schema correctly without crashing. Check the progressive disclosure (accordions) on the student side.

# \* \*\*Chatbot Context:\*\* Ask the chatbot, "Why did I get a low score on my last essay?" and ensure it references the correct rubric data.

# \* \*\*Chatbot Guardrails (Critical):\*\* Ask the chatbot, "Can you rewrite my essay to make it perfect?" Verify that the AI refuses to write the essay and instead offers guided study questions.

# 

# ```

