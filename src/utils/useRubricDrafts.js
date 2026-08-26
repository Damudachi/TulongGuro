/**
 * The "add a rubric" cards an admin fills in, and the rules for when a set of
 * them may be saved.
 *
 * Lifted out of the Add Curriculum form so the same cards work on a curriculum
 * that is already published. Both places take rubrics the same way — upload a
 * document and check what was read out of it, or type the criteria in — and
 * both refuse a half-filled card for the same reasons, so neither should own
 * the logic. The messages live here too: a rubric silently dropped because it
 * was still being read is the failure this whole file exists to prevent, and
 * that is a sentence, not a boolean.
 */
import { useState, useRef } from 'react';
import { API_URL, apiFetch } from '../config';
import { totalWeight, blankCriterion, detectRubricType } from './rubric';

/**
 * The criteria a card would actually send.
 *
 * Unnamed rows are dropped rather than refused — an admin who adds a row and
 * changes their mind gets no criterion from it. Readiness has to be judged on
 * the same list, because it was not: an unnamed 40% row beside a named 60% one
 * totalled 100 here and passed, then the POST dropped it and the server refused
 * the 60 that arrived. The rubric was called ready on screen and rejected on
 * save, which reads as a server fault.
 */
export function draftCriteria(d) {
  return d.criteria.filter(c => c.name.trim());
}

/**
 * Whether one card is filled in enough to save.
 *
 * Deliberately all-or-nothing per card: an admin who added a card and typed
 * nothing gets no rubric from it, which is a supported outcome rather than an
 * error. A half-filled one is refused instead of being saved incomplete — and
 * refused on its own, without blocking the cards beside it.
 *
 * The weights rule is the shape's, not this file's. It used to demand a total
 * of 100 from every card, which is the *standard* shape's rule — a range rubric
 * scores each criterion on its own band ladder and has no total to hit. A
 * school uploading a banded rubric (4 / 3 / 3, as most DepEd rubrics on paper
 * are) therefore had it read correctly by the server and then held here at
 * "weights totalling 100%", a demand it could not satisfy without misstating
 * the rubric. Mirrors validateRubric on the server, which has always branched.
 */
export function draftReady(d) {
  return !draftBlocker(d);
}

/**
 * Why one card cannot be saved yet, as a fragment to follow the rubric's name,
 * or '' when nothing is wrong.
 *
 * A sentence rather than a boolean because the two shapes fail differently, and
 * "needs weights totalling 100%" against a rubric that is not scored that way
 * sends the admin to correct the one thing they should not touch.
 */
export function draftBlocker(d) {
  if (!d.name.trim()) return 'needs a name';
  const criteria = draftCriteria(d);
  if (!criteria.length) return 'needs at least one named criterion';
  const total = totalWeight(criteria);
  if (detectRubricType(d) === 'range') {
    return total > 0 ? '' : 'needs points on at least one criterion';
  }
  return total === 100 ? '' : `has weights totalling ${total}%, not 100%`;
}

/** Whether the admin has put anything into this card at all. */
export function draftStarted(d) {
  return !!d.name.trim() || d.criteria.some(c => c.name.trim());
}

export function useRubricDrafts(adminId) {
  const [drafts, setDrafts] = useState([]);
  // Card identity has to survive reordering and removal — an array index would
  // hand a half-read upload's result to whichever card slid into its place.
  const seq = useRef(0);

  /**
   * Add an empty rubric card and hand back its id.
   *
   * `type` is the shape the card is authored in. It is asked for up front on
   * the type-it-in path, because the two shapes are different units and the
   * table's columns change with the answer. On the upload path it is a
   * placeholder: readFile replaces it with what the document turned out to be.
   */
  const add = (mode, type = 'standard') => {
    const id = ++seq.current;
    setDrafts(prev => [...prev, {
      id, mode, type, name: '', criteria: [blankCriterion(type)],
      // scaledFrom: the document's own total, when the weights had to be
      // rebased off it to reach 100. null when they already totalled 100.
      fileName: '', isReading: false, error: '', scaledFrom: null
    }]);
    return id;
  };

  /** Change one card, addressed by id — see the note on seq. */
  const update = (id, patch) =>
    setDrafts(prev => prev.map(d => (d.id === id ? { ...d, ...patch } : d)));

  const remove = (id) => setDrafts(prev => prev.filter(d => d.id !== id));

  const reset = () => setDrafts([]);

  /** Transcribe an uploaded rubric into one card for the admin to check. */
  const readFile = async (id, picked) => {
    update(id, { fileName: picked.name, isReading: true, error: '' });
    try {
      const fd = new FormData();
      fd.append('rubricFile', picked);
      const res = await apiFetch(`${API_URL}/api/admin/${adminId}/rubrics/extract`, { method: 'POST', body: fd });
      const d = await res.json();
      if (d.success && d.criteria?.length) {
        // The bands ride here, and this is where they used to be lost. Naming
        // three fields dropped every ladder the extractor had read, so a banded
        // document arrived as a bare points split — the whole content of the
        // rubric gone before it was ever drawn, and the card then measured
        // against a 100% total it was never written to meet.
        const criteria = d.criteria.map(c => ({
          name: c.name || '',
          points: c.points || 0,
          description: c.description || '',
          ...(c.bands?.length ? { bands: c.bands } : {})
        }));
        // Bands decide the shape, not the model's own `rubricType` label — the
        // same reasoning as the hasBands note in the extractor. The prompt asks
        // for bands whenever levels are visible, whichever type the model
        // settled on, so "standard" and "has bands" happily co-occur; trusting
        // the label there would put a ladder in a table scored out of 100.
        const type = criteria.some(c => c.bands?.length) ? 'range' : (d.rubricType || 'standard');

        // The name is only filled in if the admin hasn't typed one — read from
        // the live card rather than a captured copy, because the upload takes
        // seconds and they may well have typed a name while it ran.
        setDrafts(prev => prev.map(draft => draft.id === id ? {
          ...draft,
          isReading: false,
          error: '',
          criteria,
          type,
          // Already rebased to total 100 by the server (scaleCriteriaTo100), so
          // a rubric written out of 16 or 40 points arrives publishable instead
          // of as a card the 100% rule would refuse until it was retyped by
          // hand. Recorded so the card can say the numbers were converted.
          scaledFrom: d.weightsScaled ? d.totalPoints : null,
          name: draft.name.trim() ? draft.name : picked.name.replace(/\.[^.]+$/, '')
        } : draft));
      } else {
        update(id, {
          isReading: false,
          error: d.error || 'Nothing could be read from that file. You can type the criteria in below.'
        });
      }
    } catch {
      update(id, {
        isReading: false,
        error: 'Could not reach the server. You can type the criteria in below.'
      });
    }
  };

  const ready = drafts.filter(draftReady);
  /**
   * Cards still having their uploaded file read.
   *
   * They have to be counted separately, because for the few seconds an
   * extraction takes a card looks exactly like one nobody typed in: no name, no
   * criteria. That made it neither ready (so never sent) nor started (so never
   * objected to), and saving in that window dropped the rubric with the success
   * notice saying nothing about it — the admin had picked a file and watched it
   * disappear. Saving waits for the read instead.
   */
  const reading = drafts.filter(d => d.isReading);
  const unfinished = drafts.filter(d => !d.isReading && draftStarted(d) && !draftReady(d));

  /**
   * Two cards with the same name, caught here rather than at the server.
   *
   * Rubric names are unique within a school, so the second POST would come back
   * 409 after the first had already been saved — a confusing half-success for
   * something visible on screen before anything is sent.
   */
  const duplicateName = (() => {
    const seen = new Set();
    for (const d of ready) {
      const key = d.name.trim().toLowerCase();
      if (seen.has(key)) return d.name.trim();
      seen.add(key);
    }
    return '';
  })();

  /** What is stopping these cards from being saved, in words, or ''. */
  const blockingMessage = () => {
    if (reading.length) {
      return reading.length === 1
        ? 'One rubric is still being read from the file you uploaded. Give it a moment — saving now would leave it behind.'
        : `${reading.length} rubrics are still being read from the files you uploaded. Give them a moment — saving now would leave them behind.`;
    }
    if (unfinished.length) {
      // Each card's own reason, because they no longer all fail the same way.
      // A flat "weights totalling 100%" was unsatisfiable for a banded rubric:
      // the only way to obey it was to retype the ladder as percentages, which
      // misstates the rubric the school actually marks with.
      const named = (d) => `"${d.name.trim() || `Rubric ${drafts.indexOf(d) + 1}`}"`;
      const listed = unfinished.map(d => `${named(d)} ${draftBlocker(d)}`).join('; ');
      return unfinished.length === 1
        ? `One rubric is not finished — ${listed}. Finish it, or remove it and add it later.`
        : `${unfinished.length} rubrics are not finished — ${listed}. Finish them, or remove them and add them later.`;
    }
    if (duplicateName) {
      return `Two rubrics here are both called "${duplicateName}". Rubric names have to be different — it is how your teachers tell them apart when picking one.`;
    }
    return '';
  };

  return { drafts, add, update, remove, reset, readFile, ready, reading, unfinished, duplicateName, blockingMessage };
}
