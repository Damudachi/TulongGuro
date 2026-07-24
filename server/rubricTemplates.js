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
  {
    id: 'rt-critical-propaganda',
    name: 'Critical Reading: Fact, Opinion & Propaganda Rubric',
    description: 'For tasks distinguishing fact from opinion and identifying propaganda techniques (e.g., testimonials, bandwagon, fear, card stacking).',
    gradeRange: 'Grade 6',
    type: 'standard',
    criteria: [
      { name: 'Fact vs. Opinion Accuracy', points: 30, description: 'Correctly classifies statements as fact, opinion, or fact-based opinion.' },
      { name: 'Propaganda Technique Identification', points: 35, description: 'Correctly identifies the specific propaganda technique(s) used in the text.' },
      { name: 'Explanation & Reasoning', points: 25, description: 'Explains, with evidence, how the identified technique is used to persuade the audience.' },
      { name: 'Clarity of Expression', points: 10, description: 'Clear, organized written response with correct mechanics.' }
    ]
  },
  {
    id: 'rt-vocabulary-reference',
    name: 'Vocabulary & Reference Skills Rubric',
    description: 'For tasks involving denotative/connotative word meanings, context clues, and use of general references (almanac, directories, handbooks, manuals).',
    gradeRange: 'Grade 6',
    type: 'standard',
    criteria: [
      { name: 'Word Meaning Accuracy', points: 35, description: 'Correctly distinguishes literal (denotative) from implied (connotative) word meanings.' },
      { name: 'Reference/Context Clue Use', points: 35, description: 'Accurately and appropriately uses context clues or the specified reference source (almanac, directory, handbook, manual).' },
      { name: 'Application in Sentences', points: 20, description: 'Uses vocabulary correctly and meaningfully in original sentences or responses.' },
      { name: 'Mechanics', points: 10, description: 'Correct spelling, capitalization, and punctuation.' }
    ]
  },
  {
    id: 'rt-grammar',
    name: 'Grammar & Sentence Construction Rubric',
    description: 'For tasks focused on verb tenses, phrases, complements, and sentence construction (simple, compound-complex).',
    gradeRange: 'Grade 6',
    type: 'standard',
    criteria: [
      { name: 'Verb & Tense Accuracy', points: 30, description: 'Correct use of intransitive verbs and present/past/future perfect tenses.' },
      { name: 'Phrase & Complement Usage', points: 25, description: 'Correct use of adjectival/adverbial prepositional phrases and noun/pronoun/adjective complements.' },
      { name: 'Sentence Construction', points: 25, description: 'Correctly composes compound-complex sentences with proper structure and punctuation.' },
      { name: 'Overall Clarity & Correctness', points: 20, description: 'Sentences are clear, coherent, and free of major grammatical errors.' }
    ]
  },
  {
    id: 'rt-survey-form',
    name: 'Survey/Form Design Rubric',
    description: 'For creating personal data, open-ended, interview, or online survey forms.',
    gradeRange: 'Grade 6',
    type: 'standard',
    criteria: [
      { name: 'Purpose Alignment', points: 30, description: 'The form\'s fields or questions clearly match its stated purpose.' },
      { name: 'Question/Field Design Quality', points: 35, description: 'Questions or fields are well-worded, relevant, and elicit the intended information (open-ended, factual, or personal data as appropriate).' },
      { name: 'Clarity & Organization', points: 20, description: 'The form is logically organized, easy to follow, and appropriately formatted.' },
      { name: 'Format Appropriateness', points: 15, description: 'Appropriate for its intended format (print, oral/interview, or digital/online).' }
    ]
  },
  {
    id: 'rt-visual-multimedia',
    name: 'Visual & Multimedia Literacy Rubric',
    description: 'For tasks analyzing or creating visual and multimedia texts, including cultural appropriateness and propaganda/author\'s-stand analysis.',
    gradeRange: 'Grade 6',
    type: 'standard',
    criteria: [
      { name: 'Purpose & Message Clarity', points: 30, description: 'Clearly identifies or conveys the purpose and central message of the visual/multimedia text.' },
      { name: 'Use of Visual/Multimedia Elements', points: 30, description: 'Effective, purposeful use of visual or multimedia elements to support meaning.' },
      { name: 'Cultural Appropriateness & Audience Awareness', points: 20, description: 'Demonstrates awareness of cultural appropriateness and the intended audience.' },
      { name: 'Critical Analysis', points: 20, description: 'Identifies the author\'s point of view/stand and any propaganda technique used, where applicable.' }
    ]
  }
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
