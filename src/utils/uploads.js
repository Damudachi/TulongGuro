import { API_URL } from '../config';

/**
 * Resolve a stored upload path to a URL the browser can load.
 *
 * Uploads are absolute Supabase Storage URLs in production but relative
 * `/uploads/...` paths in local dev, so callers must not blindly prefix
 * API_URL — doing so turns an absolute URL into `http://localhost:3000https://…`
 * and the image breaks for everyone except whoever has it cached.
 */
export function resolveUploadUrl(url) {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : `${API_URL}${url}`;
}
