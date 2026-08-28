/**
 * Built-in Grading Rubric Templates
 * Aligned to the DepEd Grade 6 English MATATAG curriculum topic clusters
 * (see depedTopics.js). Each topic recommends one of these via
 * `recommendedRubricId` — teachers can accept the suggestion or replace it.
 */

const RUBRIC_TEMPLATES = [
  {
    id: 'rt-narrative-persuasive',
    name: 'Narrative & Persuasive Composition Rubric',
    description: 'For narrative and persuasive writing tasks that require an introduction, body, and conclusion with supporting evidence.',
    gradeRange: 'Grade 6',
    type: 'standard',
    criteria: [
      { name: 'Content & Ideas', points: 35, description: 'Depth and relevance of ideas, a clear central message or claim, and understanding of the prompt/topic.' },
      { name: 'Organization', points: 25, description: 'Clear introduction, body, and conclusion; logical sequence of ideas or events; effective transitions.' },
      { name: 'Evidence & Support', points: 20, description: 'Uses specific evidence, examples, or details to support the narrative or persuasive claim.' },
      { name: 'Language & Mechanics', points: 20, description: 'Age-appropriate, gender-responsive, culture-sensitive language; correct grammar, spelling, and punctuation.' }
    ]
  },
  {
    id: 'rt-literary-analysis',
    name: 'Literary Comprehension & Analysis Rubric',
    description: 'For tasks involving story grammar, plot sequencing, figures of speech, inference, and summarizing literary texts.',
    gradeRange: 'Grade 6',
    type: 'standard',
    criteria: [
      { name: 'Story/Text Understanding', points: 30, description: 'Accurately identifies story grammar elements and/or sequences events (including flashback) in the correct order.' },
      { name: 'Literary Element Analysis', points: 30, description: 'Correctly identifies and explains figures of speech (e.g., hyperbole, irony) or other literary devices and their effect.' },
      { name: 'Inference & Interpretation', points: 25, description: 'Draws reasonable, text-supported inferences about purpose, message, audience, or conclusions/main idea.' },
      { name: 'Written Expression', points: 15, description: 'Clear, organized written responses with age-appropriate vocabulary and correct mechanics.' }
    ]
  },
  {
    id: 'rt-informational-outline',
    name: 'Informational Text & Outlining Rubric',
    description: 'For tasks involving diamond (inductive-deductive) outlining, identifying text types, and comprehending persuasive/informational texts.',
    gradeRange: 'Grade 6',
    type: 'standard',
    criteria: [
      { name: 'Outline Structure', points: 35, description: 'Correctly applies inductive-deductive (diamond) organization, moving logically between specific details and the general idea.' },
      { name: 'Main Idea & Supporting Details', points: 30, description: 'Accurately identifies topic, main idea, and relevant supporting details from the text.' },
      { name: 'Text-Type & Purpose Identification', points: 20, description: 'Correctly identifies the text type (e.g., persuasive) and the author\'s purpose.' },
      { name: 'Clarity of Expression', points: 15, description: 'Clear, well-organized written explanation of the outline or conclusions drawn.' }
    ]
  },
];

function getAllRubricTemplates() {
  return RUBRIC_TEMPLATES;
}

function getRubricTemplateById(id) {
  return RUBRIC_TEMPLATES.find(t => t.id === id) || null;
}

module.exports = {
  RUBRIC_TEMPLATES,
  getAllRubricTemplates,
  getRubricTemplateById
};
