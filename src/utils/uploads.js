import { API_URL } from '../config';

/**
 * Resolve a stored image path to a URL the browser can actually load.
 *
 * Three shapes end up in Submission.imageUrl:
 *
 *   https://…            Supabase Storage — already absolute, use as-is.
 *   /uploads/xxx.jpg     Written by the API to its own disk, served by
 *                        express.static at the API origin.
 *   /demo-essay.png      A bundled *frontend* asset (public/). Prefixing the
 *                        API origin here 404s — this is what broke every seeded
 *                        demo submission for anyone but the person who uploaded
 *                        it and still had it cached.
 */
export function resolveUploadUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/uploads/')) return `${API_URL}${url}`;
  // Anything else is shipped with the front end — leave it on this origin.
  return url;
}

/**
 * True when the image lives on the API's local disk. That disk is ephemeral on
 * most hosts, so these can disappear between deploys unless object storage is
 * configured; the UI uses this to explain a missing image rather than showing a
 * broken-image icon.
 */
export function isEphemeralUpload(url) {
  return !!url && url.startsWith('/uploads/');
}
