/**
 * The 4 monitored skills tracked on the student "Skill Progress" chart.
 * Every rubric criterion — built-in, teacher-uploaded, or manually typed —
 * gets auto-classified into one of these via classifyCriterion(), so the
 * chart works regardless of which rubric a teacher actually used.
 */

const SKILLS = [
  { id: 'reading', label: 'Reading Comprehension', color: '#3b82f6' },
  { id: 'critical-media', label: 'Critical & Media Literacy', color: '#a855f7' },
  { id: 'writing', label: 'Writing & Composition', color: '#22c55e' },
  { id: 'language', label: 'Grammar & Vocabulary', color: '#f59e0b' }
];

// Keyword/phrase lists seeded from the 8 built-in rubric templates' own
// criteria (rubricTemplates.js), plus general synonyms for freeform text.
// Multi-word phrases score higher (and are more specific) than single words.
const SKILL_KEYWORDS = {
  reading: [
    'story grammar', 'story/text understanding', 'text understanding', 'sequence of events',
    'sequencing events', 'flashback', 'plot', 'figures of speech', 'figurative language',
    'literary element', 'literary device', 'hyperbole', 'irony', 'inference', 'inferring',
    'interpretation', 'target audience', 'main idea', 'supporting details', 'outline structure',
    'diamond', 'inductive-deductive', 'inductive', 'deductive', 'text-type', 'text type',
    'conclusion', 'generalization', 'comprehension', 'summariz', 'reading', 'literary',
    'story', 'character', 'setting', 'theme', 'main idea & supporting details'
  ],
  'critical-media': [
    'fact vs. opinion', 'fact vs opinion', 'fact and opinion', 'fact-based opinion',
    'propaganda technique', 'propaganda', 'testimonial', 'bandwagon', 'card stacking',
    'half-truth', 'half truths', 'spin', 'bad logic', 'unwarranted extrapolation',
    'name-calling', 'glittering generalities', 'transfer', 'visual', 'multimedia', 'video',
    'animation', 'cultural appropriateness', 'audience awareness', "author's stand",
    "author's point of view", 'point of view', 'critical analysis', 'critical reading',
    'purpose & message clarity', 'message clarity', 'media', 'persuade', 'persuasion',
    'identified technique', 'technique used', 'technique(s)'
  ],
  writing: [
    'content & ideas', 'content and ideas', 'evidence & support', 'evidence and support',
    'organization', 'narrative', 'persuasive', 'claim', 'thesis', 'purpose alignment',
    'question/field design', 'field design', 'form design', 'clarity & organization',
    'format appropriateness', 'composition', 'essay', 'written expression', 'expression',
    'content', 'ideas', 'evidence', 'writing'
  ],
  language: [
    'verb & tense', 'verb and tense', 'tense accuracy', 'phrase & complement',
    'complement usage', 'sentence construction', 'compound-complex', 'compound complex',
    'grammar', 'grammatical', 'punctuation', 'spelling', 'capitalization', 'mechanics', 'word meaning',
    'denotative', 'connotative', 'context clue', 'reference/context clue', 'reference',
    'almanac', 'directory', 'handbook', 'manual', 'vocabulary', 'syntax'
  ]
};

/**
 * Classifies a rubric criterion into one of the 4 monitored skills based on
 * its name + description text. Falls back to 'writing' (the most general
 * content/organization catch-all) if nothing matches.
 */
function classifyCriterion(name, description) {
  const text = `${name || ''} ${description || ''}`.toLowerCase();
  let bestSkill = 'writing';
  let bestScore = 0;
  for (const skillId of Object.keys(SKILL_KEYWORDS)) {
    let score = 0;
    for (const phrase of SKILL_KEYWORDS[skillId]) {
      if (text.includes(phrase)) {
        score += phrase.split(' ').length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestSkill = skillId;
    }
  }
  return bestSkill;
}

function getSkillById(id) {
  return SKILLS.find(s => s.id === id) || null;
}

module.exports = {
  SKILLS,
  classifyCriterion,
  getSkillById
};
