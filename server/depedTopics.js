/**
 * DepEd Grade 6 English Topic Coverage
 * Based on DepEd K-12 MATATAG Curriculum — English Language Arts, Grade 6
 * Reference: Most Essential Learning Competencies (MELCs)
 * 
 * This module provides a structured topic list for:
 * 1. Tagging activities with curriculum topics
 * 2. Topic-specific AI evaluation guidance
 * 3. Student performance analytics by topic
 */

const DEPED_GRADE6_ENGLISH_TOPICS = [
  // ── Quarter 1 ──
  {
    id: 'q1-narrative-writing',
    name: 'Narrative Writing',
    quarter: 1,
    description: 'Writing personal narratives, fictional stories, and recounts with clear beginning, middle, and end. Focus on character development, setting, and plot.',
    competencyCode: 'EN6WC-Ia-3.4',
    aiGuidance: 'Evaluate for narrative structure (beginning, middle, end), character development, descriptive language, use of dialogue, and logical sequence of events. For Grade 6, expect multi-paragraph narratives with basic plot structure.'
  },
  {
    id: 'q1-reading-comprehension',
    name: 'Reading Comprehension',
    quarter: 1,
    description: 'Understanding and analyzing grade-level texts. Identifying main ideas, supporting details, making inferences, and drawing conclusions.',
    competencyCode: 'EN6RC-Ia-2.1',
    aiGuidance: 'Evaluate for ability to identify main ideas, cite supporting details, make inferences from text, and draw logical conclusions. Check for text-based evidence in responses.'
  },
  {
    id: 'q1-vocabulary-development',
    name: 'Vocabulary in Context',
    quarter: 1,
    description: 'Using context clues, affixes, and roots to determine word meanings. Expanding academic vocabulary through reading.',
    competencyCode: 'EN6V-Ia-12.3',
    aiGuidance: 'Evaluate for appropriate use of grade-level vocabulary, ability to use context clues, understanding of word relationships (synonyms, antonyms), and use of academic language.'
  },
  {
    id: 'q1-oral-language',
    name: 'Oral Language & Fluency',
    quarter: 1,
    description: 'Developing speaking and listening skills. Participating in discussions, giving oral presentations, and active listening.',
    competencyCode: 'EN6OL-Ia-1.3',
    aiGuidance: 'Evaluate written reflections on oral activities for clarity of ideas, organization of thoughts, and ability to summarize discussions or presentations.'
  },

  // ── Quarter 2 ──
  {
    id: 'q2-informational-text',
    name: 'Informational Text Analysis',
    quarter: 2,
    description: 'Reading and writing informational texts. Identifying text structures (compare-contrast, cause-effect, problem-solution), using graphic organizers.',
    competencyCode: 'EN6RC-IIa-2.2',
    aiGuidance: 'Evaluate for understanding of informational text structures, ability to identify facts vs. opinions, use of evidence-based reasoning, and clarity of informational writing.'
  },
  {
    id: 'q2-grammar-syntax',
    name: 'Grammar & Syntax',
    quarter: 2,
    description: 'Mastering grade-level grammar: subject-verb agreement, verb tenses, pronoun-antecedent agreement, complex sentences, and proper punctuation.',
    competencyCode: 'EN6G-IIa-6.1',
    aiGuidance: 'Evaluate for correct subject-verb agreement, proper verb tenses, pronoun usage, sentence variety (simple, compound, complex), and accurate punctuation. Grade 6 students should demonstrate control of basic grammar with developing mastery of complex structures.'
  },
  {
    id: 'q2-persuasive-writing',
    name: 'Persuasive/Opinion Writing',
    quarter: 2,
    description: 'Writing persuasive essays and opinion pieces with clear claims, supporting reasons, and evidence. Understanding audience and purpose.',
    competencyCode: 'EN6WC-IIa-3.5',
    aiGuidance: 'Evaluate for clear thesis/claim, logical supporting reasons, use of evidence or examples, awareness of audience, counterargument acknowledgment (basic), and persuasive language techniques.'
  },
  {
    id: 'q2-listening-comprehension',
    name: 'Listening Comprehension',
    quarter: 2,
    description: 'Comprehending spoken texts, following multi-step directions, and summarizing oral presentations.',
    competencyCode: 'EN6LC-IIa-2.1',
    aiGuidance: 'Evaluate written summaries of oral activities for accuracy, completeness, and ability to capture key points from spoken text.'
  },

  // ── Quarter 3 ──
  {
    id: 'q3-literary-analysis',
    name: 'Literary Analysis & Appreciation',
    quarter: 3,
    description: 'Analyzing literary elements (theme, character, setting, conflict) in stories, poems, and plays. Identifying figurative language.',
    competencyCode: 'EN6LT-IIIa-4.1',
    aiGuidance: 'Evaluate for identification and analysis of literary elements (theme, character, setting, plot, conflict), recognition of figurative language (simile, metaphor, personification), and ability to express personal responses to literature with textual support.'
  },
  {
    id: 'q3-creative-writing',
    name: 'Creative Writing',
    quarter: 3,
    description: 'Writing poetry, short stories, and creative non-fiction. Using literary devices and developing personal voice.',
    competencyCode: 'EN6WC-IIIa-3.6',
    aiGuidance: 'Evaluate for creativity and originality, use of literary devices (imagery, simile, metaphor), development of voice, sensory details, and emotional engagement. Be encouraging of creative risk-taking.'
  },
  {
    id: 'q3-research-skills',
    name: 'Research & Information Literacy',
    quarter: 3,
    description: 'Basic research skills: formulating questions, gathering information from multiple sources, evaluating source credibility, and presenting findings.',
    competencyCode: 'EN6SS-IIIa-1.2',
    aiGuidance: 'Evaluate for ability to formulate research questions, gather relevant information, cite sources (basic), organize findings logically, and present information clearly.'
  },
  {
    id: 'q3-media-literacy',
    name: 'Media Literacy',
    quarter: 3,
    description: 'Understanding different forms of media, analyzing media messages, and creating simple media presentations.',
    competencyCode: 'EN6ML-IIIa-5.1',
    aiGuidance: 'Evaluate for understanding of media forms, ability to analyze media messages for purpose and audience, critical evaluation of media content, and clarity in media-related writing tasks.'
  },

  // ── Quarter 4 ──
  {
    id: 'q4-expository-writing',
    name: 'Expository Writing',
    quarter: 4,
    description: 'Writing expository essays that explain, describe, or inform. Using clear organizational patterns and transitions.',
    competencyCode: 'EN6WC-IVa-3.7',
    aiGuidance: 'Evaluate for clear topic sentences, logical organization (introduction, body, conclusion), use of transitions, factual accuracy, and explanatory clarity. Grade 6 students should write coherent multi-paragraph expository pieces.'
  },
  {
    id: 'q4-critical-reading',
    name: 'Critical Reading',
    quarter: 4,
    description: 'Evaluating texts critically: distinguishing fact from opinion, identifying bias, analyzing author\'s purpose, and making judgments about text quality.',
    competencyCode: 'EN6RC-IVa-2.3',
    aiGuidance: 'Evaluate for ability to distinguish fact from opinion, identify author\'s purpose and bias, make critical judgments about text, and support evaluative claims with evidence.'
  },
  {
    id: 'q4-public-speaking',
    name: 'Public Speaking & Presentation',
    quarter: 4,
    description: 'Preparing and delivering speeches and presentations. Using appropriate body language, voice modulation, and visual aids.',
    competencyCode: 'EN6OL-IVa-1.4',
    aiGuidance: 'Evaluate written speech drafts for clear purpose, logical organization, audience awareness, persuasive or informative content, and appropriate language register.'
  },
  {
    id: 'q4-review-integration',
    name: 'Review & Integration',
    quarter: 4,
    description: 'Integrating and reviewing all language arts skills learned throughout the year. Applying reading, writing, speaking, and listening skills in combined tasks.',
    competencyCode: 'EN6RC-IVd-2.4',
    aiGuidance: 'Evaluate holistically across all skill areas. Look for integration of reading comprehension, writing mechanics, vocabulary use, and critical thinking. This is a culminating assessment — expect the student to demonstrate their best across all domains.'
  }
];

/**
 * Get all topics
 */
function getAllTopics() {
  return DEPED_GRADE6_ENGLISH_TOPICS;
}

/**
 * Get topics grouped by quarter
 */
function getTopicsByQuarter() {
  const grouped = {};
  for (const topic of DEPED_GRADE6_ENGLISH_TOPICS) {
    if (!grouped[topic.quarter]) grouped[topic.quarter] = [];
    grouped[topic.quarter].push(topic);
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
  return `\nTOPIC-SPECIFIC EVALUATION (${topic.name}, ${topic.competencyCode}):\n${topic.aiGuidance}\n`;
}

module.exports = {
  DEPED_GRADE6_ENGLISH_TOPICS,
  getAllTopics,
  getTopicsByQuarter,
  getTopicById,
  getTopicAIGuidance
};
