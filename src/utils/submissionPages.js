/**
 * Taking work that is already on file back apart into its pages.
 *
 * Multi-page work is stitched into one tall image on upload — that is what the
 * AI reads and what the review pane shows — so there is nothing on the server
 * to hand back as "page 2". What there is, is a record of where each page ended
 * (Submission.pageBreaks, written by stitchPages) as fractions of the image's
 * height. Cutting the composite at those fractions here gives the page images
 * back, which is what lets an upload be *edited*: the pages go into the same
 * staging tray a fresh upload uses, one can be dropped or another added, and
 * the whole set is re-uploaded as a replacement.
 *
 * The alternative — a server route that removed one page in place — was the
 * first attempt, and it could only ever answer "remove"; a teacher who opened
 * it wanting to add a page as well had to leave and use a different button.
 */

import { resolveUploadUrl } from './uploads';

/**
 * How many pages work already on file is made of.
 *
 * 1 covers every case where the server recorded no boundaries: a single photo,
 * a PDF or Word file whose pagination nothing here can see, and anything
 * uploaded before pageBreaks existed. Those open as one page — which is honest,
 * and still lets pages be added — because a document whose page 2 was never
 * located cannot be cut at it without destroying a child's work.
 */
export function pageCountOf(sub) {
  return parsePageBreaks(sub?.pageBreaks)?.length || 1;
}

/** Stored `pageBreaks` back as ascending fractions, or null. */
export function parsePageBreaks(raw) {
  try {
    const parsed = JSON.parse(raw || 'null');
    if (!Array.isArray(parsed) || parsed.length < 2) return null;
    if (!parsed.every(n => typeof n === 'number' && n > 0 && n <= 1)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Work handed in as a PDF or Word file, which has no page images to cut. */
export function isFileSubmission(imageUrl) {
  const clean = String(imageUrl || '').split('?')[0].toLowerCase();
  return clean.endsWith('.pdf') || clean.endsWith('.docx') || clean.endsWith('.doc');
}

/**
 * Fetch a submission's stored image and cut it back into one File per page.
 *
 * Throws rather than returning a partial set: a caller that got three pages out
 * of a four-page paper and re-uploaded them would silently delete the fourth.
 *
 * @param {{imageUrl: string, pageBreaks?: string}} sub
 * @returns {Promise<File[]>} one JPEG per page, in order
 */
export async function splitSubmissionIntoPages(sub) {
  const src = resolveUploadUrl(sub?.imageUrl);
  if (!src) throw new Error('This submission has no stored image.');

  // crossOrigin/CORS matters here in a way it does not for <img>: the pixels
  // have to come back OUT of the canvas, and a tainted canvas throws on
  // toBlob(). Object storage serves these with a permissive CORS header; a
  // deployment that does not is why the caller is expected to handle a throw.
  // `window.fetch`, and not apiFetch, on purpose — this URL is object storage,
  // not the API. apiFetch would attach the teacher's session token to a request
  // bound for a third-party host, which is the one place that header must never
  // go. Spelled through `window` so it reads as deliberate rather than as the
  // bare-fetch mistake the lint rule is there to catch.
  const response = await window.fetch(src, { mode: 'cors' });
  if (!response.ok) throw new Error(`Could not read the stored image (${response.status}).`);
  const bitmap = await createImageBitmap(await response.blob());

  try {
    const breaks = parsePageBreaks(sub?.pageBreaks) || [1];
    const files = [];
    let top = 0;
    for (let i = 0; i < breaks.length; i++) {
      // The last page is pinned to the bottom edge rather than computed, so
      // rounding can never shave the final line off it.
      const bottom = i === breaks.length - 1 ? bitmap.height : Math.round(breaks[i] * bitmap.height);
      const height = Math.max(1, Math.min(bottom, bitmap.height) - top);

      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(bitmap, 0, top, bitmap.width, height, 0, 0, bitmap.width, height);

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('This page could not be read.'))), 'image/jpeg', 0.92);
      });
      files.push(new File([blob], `page-${i + 1}.jpg`, { type: 'image/jpeg' }));
      top = bottom;
    }
    return files;
  } finally {
    bitmap.close?.();
  }
}
