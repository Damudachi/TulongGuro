// Which files need rasterizing, and a way to fetch the code that does it
// before it is needed.
//
// Why this is a separate file from fileRasterize.js: that module statically
// imports pdfjs, mammoth and html2canvas, which together are ~1.1 MB (300 KB
// gzipped) — larger than the rest of the application put together. Answering
// "is this a PDF?" costs a regex, but asking fileRasterize.js was enough to
// pull all three into the initial bundle, so every student photographing their
// work on a phone downloaded a Word-document converter to find out they did not
// need one.
//
// So the cheap half lives here and the expensive half is loaded on demand. The
// split only works while this file imports nothing heavy — adding an import
// from fileRasterize.js here would silently undo it.

const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');

const isDocx = (file) =>
  file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
  /\.docx$/i.test(file.name || '');

export { isPdf, isDocx };

export const isRasterizable = (file) => isPdf(file) || isDocx(file);

/**
 * Pull the rasterizer's chunk into the browser (and the service worker's
 * /assets/ cache) ahead of time.
 *
 * Call it when a page that *might* rasterize mounts, not when a file is picked.
 * The reason is offline: the service worker caches /assets/* on demand, so a
 * chunk nobody has fetched is a chunk that is not on the device. Before this
 * split every screen was in one bundle and a phone that had opened the app once
 * had all of it; without a prefetch, a student who opened the submit page
 * offline and chose a PDF would get a chunk-load failure instead of the offline
 * upload queue. One online visit to the page is now enough to keep that working.
 *
 * Deliberately fire-and-forget. A failed prefetch is not an error — the real
 * import() at submit time will retry, and reporting it would surface a warning
 * for something the user never asked for.
 */
export function prefetchRasterizer() {
  import('./fileRasterize').catch(() => {});
}
