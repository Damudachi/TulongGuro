import { apiFetch } from '../config';
/**
 * offlineQueue.js — localStorage-based offline upload queue
 * Queues failed uploads when offline, auto-flushes on reconnect.
 *
 * Photos are stored as base64 data URLs, not object URLs. This matters: the
 * queue exists for a teacher who loses signal mid-batch, and the realistic case
 * is that the tab gets closed or reloaded before the wifi comes back. An object
 * URL from URL.createObjectURL() is scoped to the document that created it, so
 * it dies on reload and every queued job would then fail to re-read its own
 * image — the queue would look full and never drain. Data URLs are inert text
 * and survive in localStorage, which is the whole point.
 *
 * The cost is localStorage's ~5MB budget and base64's ~33% overhead, so
 * enqueue() downscales each photo before storing and refuses jobs that would
 * overflow the quota rather than throwing and losing the queue.
 */

const QUEUE_KEY = 'tg_upload_queue';

/** Fired on window whenever the queue's contents change — a job added, or a
 *  flush finished — so anything showing what is waiting can update without
 *  polling localStorage on a timer. A flush is usually started by the layout's
 *  reconnect listener, several components away from the screens that display
 *  what is queued, and those screens would otherwise keep showing work as
 *  pending long after it had been uploaded. */
export const QUEUE_CHANGED = 'tg-queue-changed';

function announceQueueChange() {
  try { window.dispatchEvent(new CustomEvent(QUEUE_CHANGED)); } catch { /* no window in tests */ }
}

/** Give up on a job after this many failed flushes so a permanently broken
 *  upload can't wedge the queue or grow it without bound. */
const MAX_RETRIES = 5;

/** Longest edge, in pixels, for a queued photo. The server re-processes to
 *  1920px anyway, so storing anything larger only burns localStorage. */
const QUEUED_IMAGE_MAX_EDGE = 1600;
const QUEUED_IMAGE_QUALITY = 0.75;

/** Rough ceiling for the whole queue. localStorage is ~5MB per origin and the
 *  app keeps other keys there, so leave headroom. */
const QUEUE_BUDGET_BYTES = 3_500_000;

export function getQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    return true;
  } catch (e) {
    // QuotaExceededError. Report it rather than letting the exception escape
    // into an upload handler, where it would read as "upload failed".
    console.warn('[OfflineQueue] Could not persist queue:', e.message);
    return false;
  }
}

function queueBytes(queue) {
  return queue.reduce((sum, j) => sum + (j.images || []).reduce((s, im) => s + (im.data?.length || 0), 0), 0);
}

/**
 * Downscale and JPEG-encode a File into a data URL.
 * Falls back to a plain FileReader read if canvas is unavailable, so a queued
 * photo is never silently dropped just because the image couldn't be resized.
 */
async function fileToStorableDataUrl(file) {
  const readAsDataUrl = () => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsDataURL(file);
  });

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, QUEUED_IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    return canvas.toDataURL('image/jpeg', QUEUED_IMAGE_QUALITY);
  } catch {
    return readAsDataUrl();
  }
}

let jobCounter = 0;
/** Date.now() alone can collide when two jobs are queued in the same
 *  millisecond, and removeJob() filters by id — a collision would make
 *  flushing one job silently remove another queued job too. */
function nextJobId() {
  jobCounter += 1;
  return `q_${Date.now()}_${jobCounter}`;
}

/**
 * Queue an upload for later. Async because every image has to be encoded first.
 * Returns the stored job, or null if it could not be persisted.
 *
 * All pages of one submission are encoded and stored as a single job — the
 * server only ever composites pages it receives together in one request, so a
 * multi-page submission that got split into per-page jobs would flush as
 * several independent requests, each overwriting the last one's image instead
 * of being stitched.
 */
export async function enqueue(job) {
  const files = job.imageFiles || [];
  const images = [];
  for (const file of files) {
    images.push({ data: await fileToStorableDataUrl(file), filename: file.name || 'queued-upload.jpg' });
  }
  const queue = getQueue();

  const bytes = images.reduce((sum, im) => sum + (im.data?.length || 0), 0);
  if (bytes && queueBytes(queue) + bytes > QUEUE_BUDGET_BYTES) {
    console.warn('[OfflineQueue] Queue is full; refusing new job.');
    return null;
  }

  const newJob = {
    url: job.url,
    fields: job.fields || {},
    images,
    id: nextJobId(),
    queuedAt: new Date().toISOString(),
    retries: 0,
  };

  queue.push(newJob);
  if (!writeQueue(queue)) return null;
  console.log(`[OfflineQueue] Queued job ${newJob.id} (${images.length} page(s)). Total jobs: ${queue.length}`);
  announceQueueChange();
  return newJob;
}

function removeJob(jobId) {
  writeQueue(getQueue().filter(j => j.id !== jobId));
}

function markRetry(jobId) {
  const queue = getQueue()
    .map(j => (j.id === jobId ? { ...j, retries: (j.retries || 0) + 1 } : j))
    .filter(j => {
      if ((j.retries || 0) < MAX_RETRIES) return true;
      console.warn(`[OfflineQueue] Dropping job ${j.id} after ${MAX_RETRIES} failed attempts.`);
      return false;
    });
  writeQueue(queue);
}

/** Turn a stored data URL back into a Blob for FormData. */
function dataUrlToBlob(dataUrl) {
  const [header, encoded] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Flush all queued uploads. Returns { succeeded, failed, dropped, droppedReasons }
 * — droppedReasons is one { id, reason } per dropped job, since "0 succeeded, 0
 * failed" for a queue that was actually fully dropped (the server permanently
 * rejected every job — a submission released elsewhere in the meantime, say)
 * reads as nothing happened unless the caller surfaces this list too.
 *
 * Strictly sequential, and deliberately so: a flush is exactly the burst that
 * trips Gemini's per-minute limit — thirty photos hitting the API the instant
 * the signal returns. One at a time, each upload is spaced by its own round
 * trip, and the server's rate gate absorbs the rest.
 *
 * @param {Function} onProgress - called with (job, index, total) after each attempt
 */
// Guards against two flushes racing over the same localStorage queue — e.g. a
// leaked 'online' listener (see initOfflineQueueListener) firing a second
// auto-flush while a manual "Flush queue" click is still mid-run. Both would
// read the same jobs, and whichever removeJob() call lands second would be
// acting on an id that's already gone.
let flushInFlight = null;

export async function flushQueue(onProgress) {
  if (flushInFlight) return flushInFlight;
  flushInFlight = flushQueueInternal(onProgress).finally(() => { flushInFlight = null; });
  return flushInFlight;
}

async function flushQueueInternal(onProgress) {
  const queue = getQueue();
  if (!queue.length) return { succeeded: 0, failed: 0, dropped: 0, droppedReasons: [] };

  let succeeded = 0;
  let failed = 0;
  let dropped = 0;
  const droppedReasons = [];

  for (let i = 0; i < queue.length; i++) {
    const job = queue[i];
    try {
      const fd = new FormData();
      // Every page goes in the same request under the same 'images' field the
      // online upload uses, so the server stitches them into one composite
      // image exactly as it would for a live, connected upload.
      (job.images || []).forEach(im => {
        fd.append('images', dataUrlToBlob(im.data), im.filename || 'queued-upload.jpg');
      });
      Object.entries(job.fields || {}).forEach(([k, v]) => fd.append(k, v));

      // Replayed long after the original attempt, so it re-reads the token
      // rather than capturing one that may since have expired.
      const res = await apiFetch(job.url, { method: 'POST', body: fd });

      // A 4xx means the server rejected this upload on its merits — a privacy
      // violation, a past deadline, an exhausted attempt count. Retrying cannot
      // change the answer, so drop the job instead of grinding through all five
      // attempts and reporting it as a network failure.
      if (res.status >= 400 && res.status < 500) {
        let reason = `HTTP ${res.status}`;
        try { reason = (await res.json()).error || reason; } catch { /* keep status */ }
        removeJob(job.id);
        dropped++;
        droppedReasons.push({ id: job.id, reason });
        console.warn(`[OfflineQueue] Dropped job ${job.id} — server rejected it: ${reason}`);
        onProgress?.(job, i, queue.length);
        continue;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      removeJob(job.id);
      succeeded++;
      console.log(`[OfflineQueue] ✅ Flushed job ${job.id}`);
    } catch (e) {
      markRetry(job.id);
      failed++;
      console.log(`[OfflineQueue] ⚠ Failed job ${job.id}:`, e.message);
    }
    onProgress?.(job, i, queue.length);
  }

  if (succeeded > 0 || dropped > 0) announceQueueChange();
  return { succeeded, failed, dropped, droppedReasons };
}

/**
 * Describe an upload for enqueue(). The Files are kept as-is here and encoded
 * by enqueue(), so nothing needs revoking and nothing leaks if the job is
 * never queued. Accepts either one File or an array — a multi-page submission
 * passes every page so they're queued and later flushed together.
 */
export function buildJob(url, fields, imageFiles) {
  const files = Array.isArray(imageFiles) ? imageFiles : (imageFiles ? [imageFiles] : []);
  return { url, fields, imageFiles: files };
}

/**
 * Set up automatic queue flush when the browser comes back online. Returns an
 * unsubscribe function — call it from whatever effect calls this, or every
 * remount (React StrictMode in dev, a logout/login cycle in production) leaves
 * the old 'online' listener attached on top of the new one, so a single
 * reconnect fires N concurrent flushes over the same queue.
 */
export function initOfflineQueueListener(onFlush) {
  const handler = async () => {
    console.log('[OfflineQueue] Back online — flushing queue...');
    const result = await flushQueue();
    onFlush?.(result);
  };
  window.addEventListener('online', handler);
  return () => window.removeEventListener('online', handler);
}
