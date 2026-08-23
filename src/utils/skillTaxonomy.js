/**
 * Client twin of server/skillTaxonomy.js — the 4 monitored skills tracked on
 * the student "Skill Progress" chart. Kept here so rubric-management screens
 * can show which skill a criterion feeds into without a round-trip to the
 * server. Keep SKILLS and SKILL_KEYWORDS in sync with the server copy by hand;
 * there is no shared module between the two runtimes.
 */

// Series colours are a validated categorical set drawn from the TulongGuro
// palette: they clear the lightness band, chroma floor, colour-vision-deficiency
// separation, and 3:1 contrast against a light chart surface. Re-validate before
// changing any of them — adjacent-pair separation is what makes the four lines
// distinguishable to a colourblind reader.
export const SKILLS = [
  { id: 'reading', label: 'Reading Comprehension', color: '#2B59C3' },
  { id: 'critical-media', label: 'Critical & Media Literacy', color: '#D5176A' },
  { id: 'writing', label: 'Writing & Composition', color: '#00A39E' },
  { id: 'language', label: 'Grammar & Vocabulary', color: '#9C7F12' }
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
 * its name + description text. Returns null when nothing matches, rather than
 * guessing 'writing' as a catch-all — a criterion named "Neatness" or "Effort"
 * with no keyword overlap is not evidence of writing skill.
 */
export function classifyCriterion(name, description) {
  const text = `${name || ''} ${description || ''}`.toLowerCase();
  let bestSkill = null;
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

export function getSkillById(id) {
  return SKILLS.find(s => s.id === id) || null;
}

/**
 * The skill a criterion actually displays: a teacher's manual choice
 * (criterion.skill) if they've set one, otherwise whatever classifyCriterion
 * auto-detects from its name/description. Every screen that shows a
 * criterion's skill badge should resolve it through here rather than calling
 * classifyCriterion directly, so a manual override in the rubric editor is
 * respected everywhere the rubric is shown — the rubric list, the activity
 * builder's rubric preview, and anywhere else criteria are rendered.
 */
export function resolveCriterionSkill(criterion) {
  if (!criterion) return null;
  const skillId = criterion.skill || classifyCriterion(criterion.name, criterion.description);
  return getSkillById(skillId);
}
