// Turns a PDF or Word (.docx) file into one JPEG image per page, entirely in
// the browser. This exists so a typed submission can go through the exact
// same PII-redaction canvas tool (ImageRedactor) as a photograph, instead of
// skipping redaction just because it isn't already an image — and so a
// teacher reviewing it later gets a normal inline picture, not a download link.
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';
import html2canvas from 'html2canvas';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
const isDocx = (file) =>
  file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
  /\.docx$/i.test(file.name || '');

export const isRasterizable = (file) => isPdf(file) || isDocx(file);

function baseName(name) {
  const stripped = String(name || 'document').replace(/\.[^./\\]+$/, '');
  const safe = stripped.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40);
  return safe || 'document';
}

function canvasToFile(canvas, name) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Could not encode the rendered page as an image.'));
      resolve(new File([blob], name, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  });
}

async function rasterizePdf(file, maxPages) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pageCount = Math.min(pdf.numPages, Math.max(maxPages, 1));
  const name = baseName(file.name);
  const files = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    // Scale 2 keeps small text (handwriting captions, footnotes) legible —
    // matches roughly what a 300dpi scan would look like.
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    files.push(await canvasToFile(canvas, `${name}-p${i}.jpg`));
  }
  return files;
}

// A4-ish page box at 96dpi — .docx has no fixed pagination once it's HTML, so
// this is what "one page" means when slicing the rendered document back up.
const PAGE_WIDTH_PX = 794;
const PAGE_HEIGHT_PX = 1123;

async function rasterizeDocx(file, maxPages) {
  const buf = await file.arrayBuffer();
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buf });
  const container = document.createElement('div');
  container.style.cssText =
    `position:fixed;left:-99999px;top:0;width:${PAGE_WIDTH_PX}px;padding:56px;` +
    'box-sizing:border-box;background:#ffffff;font-family:Georgia,\'Times New Roman\',serif;' +
    'font-size:16px;line-height:1.7;color:#1a1a1a;';
  container.innerHTML = html || '<p><em>(This document has no readable text.)</em></p>';
  document.body.appendChild(container);
  try {
    const full = await html2canvas(container, { backgroundColor: '#ffffff', scale: 2, useCORS: true });
    const renderScale = full.width / PAGE_WIDTH_PX;
    const pageHeightPx = Math.round(PAGE_HEIGHT_PX * renderScale);
    const totalPages = Math.min(Math.max(Math.ceil(full.height / pageHeightPx), 1), Math.max(maxPages, 1));
    const name = baseName(file.name);
    const files = [];
    for (let i = 0; i < totalPages; i++) {
      const sliceHeight = Math.min(pageHeightPx, full.height - i * pageHeightPx);
      const slice = document.createElement('canvas');
      slice.width = full.width;
      slice.height = sliceHeight;
      const ctx = slice.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, slice.width, sliceHeight);
      ctx.drawImage(full, 0, i * pageHeightPx, full.width, sliceHeight, 0, 0, full.width, sliceHeight);
      files.push(await canvasToFile(slice, `${name}-p${i + 1}.jpg`));
    }
    return files;
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * Renders every page of a PDF or Word file to a JPEG File, capped at maxPages.
 * Returns null if the file is neither (nothing to do — treat it as already an
 * image, or as an unsupported type the caller should reject).
 */
export async function rasterizeToPageImages(file, maxPages) {
  if (isPdf(file)) return rasterizePdf(file, maxPages);
  if (isDocx(file)) return rasterizeDocx(file, maxPages);
  return null;
}
