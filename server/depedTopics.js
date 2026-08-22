/**
 * DepEd Grade 6 English Topic Coverage — RETIRED AS A PICKER, KEPT AS A READER.
 *
 * This list is no longer offered in the Activity Builder and nothing new can be
 * tagged with it. It existed to fill one gap: the curriculum extraction used to
 * read past the Learning Competencies column of a school's uploaded guide, so a
 * lesson reached the grading prompt as a one-line description and something had
 * to supply the actual marking criteria. That made this file the only source of
 * competency-level AI guidance in the app — for one subject, at one grade level,
 * while schools teach every subject.
 *
 * extractLessonsFromCurriculum keeps that column now (see normalizeCompetencies
 * in server.js), so every lesson carries its own competencies from the school's
 * own document, in whatever subject it is for. What remains here is read-only:
 * activities tagged from this list before it was retired still hold its ids, and
 * this is what turns them back into readable names in the Activity Builder and
 * in the topic-mastery breakdown. Deleting it outright would redraw a term's
 * worth of a teacher's tags as raw slugs.
 *
 * The helpers below it — parseTopicIds, formatTopicIds, the lesson-tag prefix,
 * termForWeek — are NOT legacy. They are how Activity.topic is read and written
 * for every subject, and they stay.
 *
 * ── original header ──
 * DepEd Grade 6 English Topic Coverage
 * Based on DepEd MATATAG Curriculum — English Language Arts, Grade 6
 * Reference: Tulongguro Grade 6 English curriculum map (Term 1-3, Weeks 1-40)
 *
 * This module provides a structured topic list for:
 * 1. Tagging activities with curriculum topics
 * 2. Topic-specific AI evaluation guidance
 * 3. Student performance analytics by topic
 * 4. Recommending a matching rubric template (see rubricTemplates.js) per topic
 */

const DEPED_GRADE6_ENGLISH_TOPICS = [
  // ── Term 1 ──
  {
    id: 't1-01-story-grammar-flashback',
    name: 'Literary Texts: Story Grammar, Eight Events, and Flashback Plot',
    term: 1,
    description: 'Comprehending literary texts by noting story grammar elements, sequencing at least 8 events, and identifying the flashback plot type.',
    weekRef: 'Term 1, Week 1',
    recommendedRubricId: 'rt-literary-analysis',
    aiGuidance: 'Evaluate for correct identification of story grammar elements (setting, characters, problem, events, resolution), ability to sequence at least 8 events from the text in the right order, and correct identification of flashback as the plot structure with evidence from the text.'
  },
  {
    id: 't1-02-hyperbole-irony',
    name: 'Figures of Speech: Hyperbole and Irony',
    term: 1,
    description: 'Analyzing figures of speech to clarify meaning, identifying hyperbole and irony in literary texts, and explaining how these devices affect message, tone, and audience response.',
    weekRef: 'Term 1, Week 2',
    recommendedRubricId: 'rt-literary-analysis',
    aiGuidance: 'Evaluate for correct identification of hyperbole and irony examples in the text, accurate explanation of the literal vs. intended meaning, and clear reasoning about how each figure of speech shapes tone, message, or the reader\'s reaction.'
  },
  {
    id: 't1-03-inferring-purpose-audience',
    name: 'Inferring Purpose, Message, and Target Audience',
    term: 1,
    description: 'Inferring the author\'s purpose, message, and target audience; making predictions about a possible ending; and drawing conclusions to identify the main idea.',
    weekRef: 'Term 1, Week 3',
    recommendedRubricId: 'rt-literary-analysis',
    aiGuidance: 'Evaluate for reasonable, text-supported inferences about the author\'s purpose and intended audience, a plausible prediction for the story\'s ending, and a conclusion/main idea statement that logically follows from the text.'
  },
  {
    id: 't1-04-summary-literary-texts',
    name: 'Summary and Learning from Literary Texts',
    term: 1,
    description: 'Summarizing the events of a story concisely while preserving the key plot points.',
    weekRef: 'Term 1, Week 4',
    recommendedRubricId: 'rt-literary-analysis',
    aiGuidance: 'Evaluate for a summary that captures the essential events in correct order, omits minor details, avoids simply copying the text, and stays appropriately concise for a Grade 6 summary.'
  },
  {
    id: 't1-05-persuasive-diamond-outline',
    name: 'Informational Texts: Persuasive Text and Diamond Outline',
    term: 1,
    description: 'Comprehending informational texts by outlining important information using inductive-deductive (diamond) organization, and identifying persuasive text as a text type.',
    weekRef: 'Term 1, Week 5',
    recommendedRubricId: 'rt-informational-outline',
    aiGuidance: 'Evaluate for correct use of the diamond (inductive-deductive) outline structure — moving from specific details to a general point or vice versa — accurate identification of topic, main idea, and supporting details, and correct recognition of the text as persuasive.'
  },
  {
    id: 't1-06-authors-purpose-conclusions',
    name: 'Author\'s Purpose, Conclusions, Generalizations, and Summary',
    term: 1,
    description: 'Identifying the main idea and author\'s purpose (entertain, inform/explain/describe, or persuade) in informational texts, drawing conclusions, making generalizations, and applying story elements to one\'s own experience.',
    weekRef: 'Term 1, Week 6',
    recommendedRubricId: 'rt-informational-outline',
    aiGuidance: 'Evaluate for correct classification of the author\'s purpose, a main idea statement supported by the text, a conclusion or generalization that is logically drawn (not simply restated from the text), and evidence of connecting the text to the reader\'s own schema/experience.'
  },
  {
    id: 't1-07-fact-opinion-propaganda',
    name: 'Fact, Opinion, and Propaganda Techniques',
    term: 1,
    description: 'Distinguishing statements of fact from opinion and fact-based opinion, and identifying propaganda techniques used to persuade: name-calling/labelling, glittering generalities, and transfer.',
    weekRef: 'Term 1, Week 7',
    recommendedRubricId: 'rt-critical-propaganda',
    aiGuidance: 'Evaluate for accurate classification of statements as fact, opinion, or fact-based opinion, and correct identification and explanation of name-calling/labelling, glittering generalities, or transfer when present in a given text.'
  },
  {
    id: 't1-08-vocabulary-punctuation-almanac',
    name: 'Vocabulary and References: Punctuation and Almanac',
    term: 1,
    description: 'Using words with literal (denotative) and implied (connotative) meanings, using punctuation as a context clue, and using the almanac as a general reference.',
    weekRef: 'Term 1, Week 8',
    recommendedRubricId: 'rt-vocabulary-reference',
    aiGuidance: 'Evaluate for correct distinction between literal and implied word meanings in context, appropriate use of punctuation as a clue to meaning, and correct/appropriate use of almanac-type reference information when the task calls for it.'
  },
  {
    id: 't1-09-grammar-clarity-coherence',
    name: 'Grammar for Clarity and Coherence',
    term: 1,
    description: 'Composing sentences using intransitive verbs, perfect tenses (present, past, future), adjectival phrases (prepositional phrases as adjectives), order of adverbs, complements (noun, pronoun, adjective), and compound-complex sentences.',
    weekRef: 'Term 1, Week 9',
    recommendedRubricId: 'rt-grammar',
    aiGuidance: 'Evaluate for correct use of intransitive verbs, correct formation of present/past/future perfect tenses, prepositional phrases used correctly as adjectives, correct ordering of adverbs (manner, place, frequency, time, purpose), correct noun/pronoun/adjective complements, and at least one properly formed compound-complex sentence.'
  },
  {
    id: 't1-10-narrative-persuasive-writing',
    name: 'Narrative / Persuasive Writing',
    term: 1,
    description: 'Producing texts with a clear introduction, body, and conclusion, providing evidence to support ideas, and expressing ideas appropriately (age-appropriate, gender-responsive, culture-sensitive) using narrative and persuasive text types.',
    weekRef: 'Term 1, Week 10',
    recommendedRubricId: 'rt-narrative-persuasive',
    aiGuidance: 'Evaluate for a clear introduction-body-conclusion structure, use of evidence or supporting details, appropriateness of language and content for the target audience, and correct application of narrative or persuasive text-type conventions as required by the task.'
  },
  {
    id: 't1-11-personal-data-survey-form',
    name: 'Personal Data Survey Form',
    term: 1,
    description: 'Creating simple print survey forms for personal data information, and using non-verbal cues (facial expressions, gestures, eye contact, haptics, posture, proxemics/blocking) appropriately for context and meaning.',
    weekRef: 'Term 1, Week 10',
    recommendedRubricId: 'rt-survey-form',
    aiGuidance: 'Evaluate for a well-structured personal data survey form with clear, relevant fields appropriate to its stated purpose. Where non-verbal cue use is part of the task, check for age-appropriate and context-appropriate descriptions or application of facial expressions, gestures, eye contact, haptics, posture, and proxemics.'
  },
  {
    id: 't1-12-visual-multimedia-meaning',
    name: 'Visual and Multimedia Meaning',
    term: 1,
    description: 'Deriving meaning from visual elements and evaluating their cultural appropriateness; identifying multimedia elements (video, animation) and their purpose; determining ideas used to influence viewers, including author\'s stand and propaganda technique; and creating a visual or multimedia text.',
    weekRef: 'Term 1, Week 11',
    recommendedRubricId: 'rt-visual-multimedia',
    aiGuidance: 'Evaluate for correct identification of the purpose of visual/multimedia elements, sound reasoning about how those elements contribute to meaning, a judgment on cultural appropriateness, correct identification of the author\'s point of view and any propaganda technique used, and a created visual/multimedia text that is purposeful and appropriate.'
  },
  {
    id: 't1-13-literary-texts-flashback-irony',
    name: 'Literary Texts with Flashback and Irony',
    term: 1,
    description: 'Identifying flashback as a plot type and analyzing irony in literary texts to clarify meaning, reinforcing earlier lessons on story grammar and figures of speech.',
    weekRef: 'Term 1, Week 12',
    recommendedRubricId: 'rt-literary-analysis',
    aiGuidance: 'Evaluate for accurate identification of flashback plot structure with textual evidence, and correct analysis of irony (situational, verbal, or dramatic as applicable) and its effect on meaning, building on the Week 1 and Week 2 skills.'
  },

  // ── Term 2 ──
  {
    id: 't2-01-persuasive-writing',
    name: 'Persuasive Writing',
    term: 2,
    description: 'Producing persuasive texts with introduction, body, and conclusion, providing evidence to support ideas, and expressing ideas appropriately for purpose, context, and audience.',
    weekRef: 'Term 2, Weeks 14 & 18',
    recommendedRubricId: 'rt-narrative-persuasive',
    aiGuidance: 'Evaluate for a clear persuasive claim, logically organized introduction-body-conclusion structure, use of evidence to support the position, and age-appropriate, gender-responsive, culture-sensitive language suited to the intended audience.'
  },
  {
    id: 't2-02-diamond-outline-review',
    name: 'Diamond Outline Review',
    term: 2,
    description: 'Reviewing comprehension of informational/persuasive texts by outlining topic, main idea, and supporting details using inductive-deductive (diamond) organization.',
    weekRef: 'Term 2, Week 14',
    recommendedRubricId: 'rt-informational-outline',
    aiGuidance: 'Evaluate for correct construction of a diamond outline that moves between specific supporting details and a general main idea, and accurate identification of the text as persuasive.'
  },
  {
    id: 't2-03-fact-opinion-propaganda-testimonials',
    name: 'Fact, Opinion, and Propaganda: Testimonials, Plain Folks, and Bandwagon',
    term: 2,
    description: 'Distinguishing fact from opinion and fact-based opinion, and identifying propaganda techniques: testimonials, plain folks, and bandwagon.',
    weekRef: 'Term 2, Week 15',
    recommendedRubricId: 'rt-critical-propaganda',
    aiGuidance: 'Evaluate for accurate fact/opinion classification and correct identification of testimonials, plain folks, or bandwagon propaganda techniques, with explanation of how each is used to persuade the audience.'
  },
  {
    id: 't2-04-vocabulary-directories',
    name: 'Vocabulary and Directories',
    term: 2,
    description: 'Using words with literal and implied meanings in sentences, and using directories (acronyms and abbreviations used by organizations) as a general reference.',
    weekRef: 'Term 2, Week 16',
    recommendedRubricId: 'rt-vocabulary-reference',
    aiGuidance: 'Evaluate for correct denotative/connotative word usage in sentences and correct, appropriate use of directory-type references such as organizational acronyms and abbreviations.'
  },
  {
    id: 't2-05-grammar-perfect-tenses-adjectival',
    name: 'Grammar: Perfect Tenses and Adjectival Phrases',
    term: 2,
    description: 'Composing sentences using intransitive verbs, present/past/future perfect tenses, prepositional phrases as adjectives, noun/pronoun/adjective complements, and compound-complex sentences.',
    weekRef: 'Term 2, Week 17',
    recommendedRubricId: 'rt-grammar',
    aiGuidance: 'Evaluate for correct use of intransitive verbs, correctly formed perfect tenses, prepositional phrases functioning as adjectives, appropriate complements, and at least one correctly structured compound-complex sentence.'
  },
  {
    id: 't2-06-open-ended-survey-form',
    name: 'Open-Ended Survey Form',
    term: 2,
    description: 'Creating open-ended and interview (oral) print survey forms based on purpose, and using non-verbal cues appropriately for clarity of context, purpose, and meaning.',
    weekRef: 'Term 2, Week 19',
    recommendedRubricId: 'rt-survey-form',
    aiGuidance: 'Evaluate for well-designed open-ended survey questions that genuinely elicit detailed responses relevant to the stated purpose, and appropriate use/description of non-verbal cues (facial expressions, gestures, eye contact, haptics, posture, proxemics) where applicable.'
  },
  {
    id: 't2-07-visual-texts-cultural-appropriateness',
    name: 'Visual Texts and Cultural Appropriateness',
    term: 2,
    description: 'Deriving meaning from visual elements by identifying purpose and analyzing contribution to meaning, evaluating cultural appropriateness, and identifying multimedia elements such as video and animation.',
    weekRef: 'Term 2, Week 20',
    recommendedRubricId: 'rt-visual-multimedia',
    aiGuidance: 'Evaluate for correct identification of the visual text\'s purpose, sound analysis of how visual elements contribute to meaning, and a reasoned judgment on cultural appropriateness.'
  },
  {
    id: 't2-08-multimedia-authors-stand',
    name: 'Multimedia Meaning and Author\'s Stand',
    term: 2,
    description: 'Deriving meaning from multimedia elements by identifying the author\'s purpose, analyzing their contribution to meaning, and determining ideas explicitly used to influence viewers, including author\'s point of view/stand and propaganda technique.',
    weekRef: 'Term 2, Week 21',
    recommendedRubricId: 'rt-visual-multimedia',
    aiGuidance: 'Evaluate for correct identification of the author\'s purpose and point of view/stand in the multimedia text, sound analysis of how multimedia elements shape meaning, and correct identification of any propaganda technique used to influence the viewer.'
  },
  {
    id: 't2-09-literary-texts',
    name: 'Literary Texts',
    term: 2,
    description: 'Comprehending literary texts by noting story grammar elements and sequencing at least 8 events, identifying flashback plot and analyzing irony, inferring the author\'s purpose/message/target audience, making predictions, drawing conclusions, identifying the main idea, summarizing story events, and applying story learning to one\'s schema.',
    weekRef: 'Term 2, Week 23',
    recommendedRubricId: 'rt-literary-analysis',
    aiGuidance: 'Evaluate holistically across story grammar identification, 8-event sequencing, flashback and irony recognition, inference of purpose/message/audience, prediction-making, conclusion-drawing, main idea identification, and summarization — this topic reviews and integrates the Term 1 literary skill set.'
  },
  {
    id: 't2-10-persuasive-fear-half-truths',
    name: 'Persuasive Texts: Fear or Half-Truths',
    term: 2,
    description: 'Comprehending persuasive informational texts through diamond outline, identifying the author\'s purpose, drawing conclusions, making generalizations, summarizing, distinguishing fact from opinion, and identifying the fear and half-truths/spin propaganda techniques.',
    weekRef: 'Term 2, Week 24',
    recommendedRubricId: 'rt-critical-propaganda',
    aiGuidance: 'Evaluate for correct diamond-outline comprehension of the persuasive text, accurate identification of author\'s purpose, sound conclusions/generalizations, correct fact/opinion classification, and correct identification of fear-based or half-truths/spin propaganda techniques.'
  },
  {
    id: 't2-11-vocabulary-handbooks-manuals',
    name: 'Vocabulary, Handbooks, and Manuals',
    term: 2,
    description: 'Using words with literal and implied meanings in sentences, and using general print/online references such as handbooks and manuals to clarify text meaning and task requirements.',
    weekRef: 'Term 2, Week 25',
    recommendedRubricId: 'rt-vocabulary-reference',
    aiGuidance: 'Evaluate for correct denotative/connotative word usage and appropriate, accurate application of information drawn from handbook- or manual-type references to clarify meaning or complete a task.'
  },
  {
    id: 't2-12-grammar-adverbial-perfect-tenses',
    name: 'Grammar: Adverbial Phrases and Perfect Tenses',
    term: 2,
    description: 'Composing sentences using intransitive verbs, present/past/future perfect tenses, prepositional phrases as adverbs (adverbial phrases), complements, and compound-complex sentences.',
    weekRef: 'Term 2, Week 26',
    recommendedRubricId: 'rt-grammar',
    aiGuidance: 'Evaluate for correct use of intransitive verbs, correctly formed perfect tenses, prepositional phrases functioning as adverbs, appropriate complements, and correctly structured compound-complex sentences.'
  },

  // ── Term 3 ──
  {
    id: 't3-01-narrative-persuasive-evidence',
    name: 'Narrative and Persuasive Text Writing with Evidence',
    term: 3,
    description: 'Producing texts with introduction, body, and conclusion that provide evidence to support information, expressing ideas through narrative and persuasive text types using age-appropriate, gender-responsive, culture-sensitive language.',
    weekRef: 'Term 3, Week 27',
    recommendedRubricId: 'rt-narrative-persuasive',
    aiGuidance: 'Evaluate for a clear introduction-body-conclusion structure, use of concrete evidence to support claims or events, correct application of narrative or persuasive conventions, and appropriate, sensitive language for the audience.'
  },
  {
    id: 't3-02-interview-survey-form',
    name: 'Interview Survey Form',
    term: 3,
    description: 'Creating interview (oral) survey forms based on purpose, and using non-verbal cues appropriately for clarity of context, purpose, and meaning.',
    weekRef: 'Term 3, Week 28',
    recommendedRubricId: 'rt-survey-form',
    aiGuidance: 'Evaluate for well-structured interview questions appropriate to the stated purpose and audience, and appropriate use/description of non-verbal cues in an oral interview context.'
  },
  {
    id: 't3-03-visual-meaning-cultural-appropriateness',
    name: 'Visual Meaning and Cultural Appropriateness',
    term: 3,
    description: 'Deriving meaning from visual elements by identifying purpose and analyzing contribution to meaning, evaluating cultural appropriateness, and creating a visual text drawn from the visual elements learned.',
    weekRef: 'Term 3, Week 29',
    recommendedRubricId: 'rt-visual-multimedia',
    aiGuidance: 'Evaluate for correct identification of the visual text\'s purpose, sound analysis of how visual elements contribute to meaning, a reasoned cultural-appropriateness judgment, and a created visual text that is purposeful and well-executed.'
  },
  {
    id: 't3-04-multimedia-authors-stand-propaganda',
    name: 'Multimedia, Author\'s Stand, and Propaganda',
    term: 3,
    description: 'Identifying multimedia elements (video, animation), deriving meaning by identifying the author\'s purpose and analyzing contribution to meaning, determining ideas used to influence viewers (author\'s stand and propaganda technique), and creating a multimedia text.',
    weekRef: 'Term 3, Week 30',
    recommendedRubricId: 'rt-visual-multimedia',
    aiGuidance: 'Evaluate for correct identification of multimedia elements and the author\'s purpose/stand, sound analysis of how those elements shape meaning, correct identification of any propaganda technique used, and a created multimedia text that is purposeful and appropriate.'
  },
  {
    id: 't3-05-literary-texts-advanced-review',
    name: 'Literary Texts and Advanced Persuasion Review',
    term: 3,
    description: 'Comprehending literary texts through story grammar, 8-event sequencing, and flashback plot; analyzing irony; inferring author\'s purpose, message, and audience; drawing conclusions; identifying the main idea; summarizing story events; and applying story learning to one\'s schema — an advanced, integrative review.',
    weekRef: 'Term 3, Week 32',
    recommendedRubricId: 'rt-literary-analysis',
    aiGuidance: 'Evaluate holistically across story grammar identification, event sequencing, flashback/irony recognition, purpose/message/audience inference, conclusion-drawing, main idea identification, and summarization, expecting stronger independence and textual evidence than in earlier terms.'
  },
  {
    id: 't3-06-propaganda-bad-logic-card-stacking',
    name: 'Propaganda: Bad Logic, Unwarranted Extrapolation, and Card Stacking',
    term: 3,
    description: 'Identifying propaganda techniques used to persuade an audience to further an idea or agenda: fear, half-truths/spin, bad logic/unwarranted extrapolation, and card stacking.',
    weekRef: 'Term 3, Week 33',
    recommendedRubricId: 'rt-critical-propaganda',
    aiGuidance: 'Evaluate for correct identification and explanation of fear, half-truths/spin, bad logic/unwarranted extrapolation, or card stacking propaganda techniques present in a given text, with reasoning about how each is used to persuade.'
  },
  {
    id: 't3-07-grammar-online-formal-contexts',
    name: 'Grammar for Online and Formal Contexts',
    term: 3,
    description: 'Composing sentences for clarity and coherence using intransitive verbs, present/past/future perfect tenses, adverbial phrases, complements, and compound-complex sentences in formal and digital contexts.',
    weekRef: 'Term 3, Week 34',
    recommendedRubricId: 'rt-grammar',
    aiGuidance: 'Evaluate for grammatical correctness (intransitive verbs, perfect tenses, adverbial phrases, complements, compound-complex sentences) and for appropriate register/tone suited to formal or digital/online communication.'
  },
  {
    id: 't3-08-narrative-persuasive-national-global',
    name: 'Narrative and Persuasive Writing for National and Global Issues',
    term: 3,
    description: 'Producing texts with introduction, body, and conclusion that provide evidence to support information, using narrative and persuasive text types with clear, age-appropriate, gender-responsive, culture-sensitive language on national and global issues.',
    weekRef: 'Term 3, Week 35',
    recommendedRubricId: 'rt-narrative-persuasive',
    aiGuidance: 'Evaluate for a clear introduction-body-conclusion structure, use of evidence relevant to the national/global issue being discussed, correct narrative or persuasive conventions, and sensitive, age-appropriate language given the broader topic scope.'
  },
  {
    id: 't3-09-online-survey-digital-cues',
    name: 'Online Survey Form and Digital Communication Cues',
    term: 3,
    description: 'Creating simple digital/online survey forms based on purpose.',
    weekRef: 'Term 3, Week 36',
    recommendedRubricId: 'rt-survey-form',
    aiGuidance: 'Evaluate for a well-structured online survey form with question types and fields appropriate to its stated purpose and to digital delivery.'
  },
  {
    id: 't3-10-visual-text-advocacy',
    name: 'Visual Text Creation for Advocacy',
    term: 3,
    description: 'Deriving meaning from visual elements, evaluating their cultural appropriateness, and creating a visual text for advocacy or information drawn from the visual elements learned.',
    weekRef: 'Term 3, Week 37',
    recommendedRubricId: 'rt-visual-multimedia',
    aiGuidance: 'Evaluate for a clear advocacy or informational purpose in the created visual text, effective and culturally appropriate use of visual elements, and alignment between the visual choices and the intended message.'
  },
  {
    id: 't3-11-multimedia-specific-purpose',
    name: 'Multimedia Text Creation for Specific Purpose',
    term: 3,
    description: 'Identifying multimedia elements (video, animation), deriving meaning, determining ideas explicitly used to influence viewers, and creating a multimedia text for a specific purpose.',
    weekRef: 'Term 3, Week 38',
    recommendedRubricId: 'rt-visual-multimedia',
    aiGuidance: 'Evaluate for a clearly defined purpose in the created multimedia text, effective use of multimedia elements to support that purpose, and evidence that the ideas/messaging were deliberately shaped to influence the intended viewers.'
  }
];

/**
 * Where a term ends, in school weeks.
 *
 * The competency map above already carries an explicit `term` on every entry,
 * so these boundaries are only needed for the *other* source of curriculum
 * tags: a school's own uploaded scope-and-sequence, whose lessons record a
 * week number and no term at all. Read off the map itself — Term 1 runs to
 * week 12, Term 2 from 14 to 26, Term 3 from 27 — with the gaps at 13 and
 * between terms falling to the earlier term, which is where a school that
 * numbers its weeks continuously would put them.
 *
 * A best guess, and labelled as one wherever it is shown: it places a lesson
 * in the term picker so the teacher does not have to scroll past two other
 * terms' worth of weeks, and it is always overridable by picking the term
 * directly. Nothing is stored from it.
 */
const TERM_LAST_WEEK = { 1: 13, 2: 26 };

/**
 * A curriculum lesson's name, with its week number said once.
 *
 * Every screen that lists a lesson writes "Week 3: " in front of its title, and
 * extracted curriculum documents routinely carry the week in the title too — so
 * the two combined into "Week 3: Week 3: Figures of Speech". The leading week is
 * dropped only when it is the same number the lesson records: "Week 1: Week 2
 * review" is a week-1 lesson about week 2, not a duplicate.
 *
 * Mirrors lessonDisplayName in src/utils/topics.js.
 */
function lessonDisplayName(lesson) {
  const title = String(lesson?.title ?? '').trim();
  const week = parseInt(lesson?.weekNumber, 10);
  if (!Number.isFinite(week) || week < 1) return title;
  // (?![0-9]) so "Week 1" does not match the start of "Week 12", which would
  // leave a title of "2: ..." behind.
  const stripped = title
    .replace(new RegExp(`^week\\s*0*${week}(?![0-9])\\s*[:.)\\-–—]*\\s*`, 'i'), '')
    .trim();
  return stripped ? `Week ${week}: ${stripped}` : `Week ${week}`;
}

/** The term a school week most likely falls in, or null if it can't be placed. */
function termForWeek(week) {
  const n = parseInt(week, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  if (n <= TERM_LAST_WEEK[1]) return 1;
  if (n <= TERM_LAST_WEEK[2]) return 2;
  return 3;
}

/**
 * The week numbers named in a topic's `weekRef`.
 *
 * Not always one: "Term 2, Weeks 14 & 18" is a competency revisited later in
 * the term, and both numbers matter — matching a curriculum lesson against
 * only the first would leave the week-18 lesson unable to find it.
 */
function weeksForWeekRef(weekRef) {
  const text = String(weekRef || '');
  // Read from the word "Week" onward, never from the start of the string: the
  // leading "Term 2, " contributes a number too, and filtering it out by value
  // would silently drop weeks 1 to 3 with it.
  const at = text.search(/Weeks?/i);
  if (at === -1) return [];
  return [...text.slice(at).matchAll(/\d+/g)].map(m => parseInt(m[0], 10));
}

/**
 * The competency list as the API serves it, with the week numbers pre-parsed.
 *
 * Derived once here rather than in the browser so the client never has to
 * re-parse `weekRef` prose to work out which lesson a competency lines up
 * with — the two would be free to disagree, and the auto-tick in the Activity
 * Builder rests on them agreeing.
 */
const TOPICS_WITH_WEEKS = DEPED_GRADE6_ENGLISH_TOPICS.map(t => ({
  ...t,
  weeks: weeksForWeekRef(t.weekRef),
}));

/**
 * Get all topics
 */
function getAllTopics() {
  return TOPICS_WITH_WEEKS;
}

/**
 * Get topics grouped by term
 */
function getTopicsByTerm() {
  const grouped = {};
  for (const topic of DEPED_GRADE6_ENGLISH_TOPICS) {
    if (!grouped[topic.term]) grouped[topic.term] = [];
    grouped[topic.term].push(topic);
  }
  return grouped;
}

/**
 * Get a specific topic by ID
 */
function getTopicById(topicId) {
  return DEPED_GRADE6_ENGLISH_TOPICS.find(t => t.id === topicId) || null;
}

/**
 * Get AI guidance for a specific topic (used in grading prompt)
 */
function getTopicAIGuidance(topicId) {
  const topic = getTopicById(topicId);
  if (!topic) return '';
  return `\nTOPIC-SPECIFIC EVALUATION (${topic.name}, ${topic.weekRef}):\n${topic.description}\n${topic.aiGuidance}\n`;
}

/**
 * How an activity records the topics it covers.
 *
 * One activity commonly covers more than one competency, so Activity.topic
 * holds a comma-separated list of topic ids rather than a single id. It is the
 * same column a single id was stored in: anything tagged before this change
 * reads back as a one-item list, so nothing already saved needs migrating.
 * Topic ids are slugs and never contain a comma.
 *
 * src/utils/topics.js is the browser's copy of these two functions — there is
 * no shared module between the client and the server in this app, so the pair
 * has to be kept in step by hand. tests/activity-topics.test.js checks both.
 */
function normalizeTopicIds(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const id = String(raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** The topic ids on an activity, from either the stored string or an array. */
function parseTopicIds(value) {
  if (Array.isArray(value)) return normalizeTopicIds(value);
  if (!value) return [];
  return normalizeTopicIds(String(value).split(','));
}

/**
 * Curriculum lessons as topic tags.
 *
 * The DepEd map above is the MATATAG Grade 6 English competency list and
 * nothing else, so on a Grade 5 Mathematics class it has no rows to offer and
 * the whole competency control used to disappear — leaving that teacher with a
 * single-select lesson dropdown and no way to say an activity covered more
 * than one week. Every subject has a curriculum; only one of them has a
 * competency map shipped in this repo.
 *
 * So a lesson from the class's own uploaded scope-and-sequence can be tagged
 * onto an activity the same way a competency can, written as `lesson:<id>`.
 * The prefix is what keeps the two apart in one column: DepEd ids are slugs
 * that never contain a colon, so an id either resolves in the map or names a
 * ClassLesson, and neither can be mistaken for the other.
 *
 * Deliberately the same `Activity.topic` column rather than a new join table.
 * Topic-mastery analytics, the AI guidance lookup and the multi-select UI all
 * already read that column, so lessons become taggable everywhere at once —
 * and an activity tagged before this existed still reads back unchanged.
 */
const LESSON_TOPIC_PREFIX = 'lesson:';

/** Whether a topic id names a curriculum lesson rather than a DepEd competency. */
function isLessonTopicId(id) {
  return String(id || '').startsWith(LESSON_TOPIC_PREFIX);
}

/** The topic id for a curriculum lesson. */
function lessonTopicId(lessonId) {
  return `${LESSON_TOPIC_PREFIX}${lessonId}`;
}

/** The ClassLesson id inside a lesson topic id, or null if it isn't one. */
function lessonIdFromTopicId(id) {
  return isLessonTopicId(id) ? String(id).slice(LESSON_TOPIC_PREFIX.length) : null;
}

/** Every ClassLesson id tagged on an activity, in order. */
function lessonIdsFromTopics(value) {
  return parseTopicIds(value).map(lessonIdFromTopicId).filter(Boolean);
}

/** The stored form of a list of topic ids. Empty string means "no topic". */
function formatTopicIds(ids) {
  return parseTopicIds(ids).join(',');
}

/**
 * Guidance for every topic an activity is mapped to, for the grading prompt.
 *
 * Ids that aren't in the DepEd map contribute nothing — a teacher may have
 * typed a free-text topic in the quick-edit form, and there is no competency
 * description to give the model for that.
 */
function getTopicsAIGuidance(value) {
  return parseTopicIds(value)
    .map(getTopicAIGuidance)
    .filter(Boolean)
    .join('');
}

module.exports = {
  DEPED_GRADE6_ENGLISH_TOPICS,
  getAllTopics,
  getTopicsByTerm,
  getTopicById,
  getTopicAIGuidance,
  getTopicsAIGuidance,
  parseTopicIds,
  formatTopicIds,
  termForWeek,
  lessonDisplayName,
  weeksForWeekRef,
  LESSON_TOPIC_PREFIX,
  isLessonTopicId,
  lessonTopicId,
  lessonIdFromTopicId,
  lessonIdsFromTopics
};
