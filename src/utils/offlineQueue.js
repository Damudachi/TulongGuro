/**
 * offlineQueue.js — localStorage-based offline upload queue
 * Queues failed uploads when offline, auto-flushes on reconnect.
 */

const QUEUE_KEY = 'tg_upload_queue';

export function getQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function enqueue(job) {
  const queue = getQueue();
  const newJob = { ...job, id: `q_${Date.now()}`, queuedAt: new Date().toISOString(), retries: 0 };
  queue.push(newJob);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  console.log(`[OfflineQueue] Queued job ${newJob.id}. Total: ${queue.length}`);
  return newJob;
}

function removeJob(jobId) {
  const queue = getQueue().filter(j => j.id !== jobId);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

function markRetry(jobId) {
  const queue = getQueue().map(j => j.id === jobId ? { ...j, retries: (j.retries || 0) + 1 } : j);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/**
 * Flush all queued uploads. Returns { succeeded, failed } counts.
 * @param {Function} onProgress - called with (job, index, total) after each attempt
 */
export async function flushQueue(onProgress) {
  const queue = getQueue();
  if (!queue.length) return { succeeded: 0, failed: 0 };

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < queue.length; i++) {
    const job = queue[i];
    try {
      const fd = new FormData();
      // Re-build FormData from stored blob URLs
      if (job.imageBlob) {
        const resp = await fetch(job.imageBlob);
        const blob = await resp.blob();
        fd.append('image', blob, job.filename || 'queued-upload.jpg');
      }
      Object.entries(job.fields || {}).forEach(([k, v]) => fd.append(k, v));

      const res = await fetch(job.url, { method: 'POST', body: fd });
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

  return { succeeded, failed };
}

/**
 * Store a File/Blob as an object URL for later re-use.
 * Returns a job object ready for enqueue().
 */
export function buildJob(url, fields, imageFile) {
  const imageBlob = imageFile ? URL.createObjectURL(imageFile) : null;
  return { url, fields, imageBlob, filename: imageFile?.name };
}

/**
 * Set up automatic queue flush when the browser comes back online.
 * Call this once at app startup.
 */
export function initOfflineQueueListener(onFlush) {
  window.addEventListener('online', async () => {
    console.log('[OfflineQueue] Back online — flushing queue...');
    const result = await flushQueue();
    onFlush?.(result);
  });
}
