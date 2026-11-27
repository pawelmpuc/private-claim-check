/** Turns photos and PDFs into JPEG pages in the browser, so nothing is uploaded to prepare them. */

export interface PageImage {
  base64: string;
  mimeType: 'image/jpeg';
  previewUrl: string;
}

const MAX_SIDE = 1600;
export const MAX_PAGES = 6;

function canvasToPage(canvas: HTMLCanvasElement): PageImage {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: 'image/jpeg', previewUrl: dataUrl };
}

async function imageToPage(file: File): Promise<PageImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvasToPage(canvas);
}

async function pdfToPages(file: File): Promise<PageImage[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: PageImage[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n += 1) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: MAX_SIDE / Math.max(base.width, base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
    pages.push(canvasToPage(canvas));
  }
  return pages;
}

export async function filesToPages(files: File[]): Promise<PageImage[]> {
  const pages: PageImage[] = [];
  for (const file of files) {
    if (pages.length >= MAX_PAGES) break;
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      pages.push(...(await pdfToPages(file)));
    } else if (file.type.startsWith('image/')) {
      pages.push(await imageToPage(file));
    }
  }
  return pages.slice(0, MAX_PAGES);
}

function loadImage(page: PageImage): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The page image could not be read.'));
    img.src = page.previewUrl;
  });
}

/**
 * Cuts a page into wide, overlapping tiles for the on-device model.
 *
 * The built-in model scales every image down to a small fixed size. A whole A4 page
 * leaves the text too small to read, while a tile that is wider than it is tall keeps
 * the lines legible. White margins are trimmed first.
 */
export async function tilesOf(page: PageImage): Promise<PageImage[]> {
  const img = await loadImage(page);
  const full = document.createElement('canvas');
  full.width = img.naturalWidth;
  full.height = img.naturalHeight;
  const ctx = full.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);

  // Bounding box of everything that is not near-white.
  const { data, width, height } = ctx.getImageData(0, 0, full.width, full.height);
  let top = height, bottom = -1, left = width, right = -1;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      if (data[i] + data[i + 1] + data[i + 2] < 600) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (bottom < 0) return [page];
  const pad = 12;
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  const w = Math.min(width, right + pad) - left;
  const h = Math.min(height, bottom + pad) - top;

  const tileHeight = Math.round(w * 0.5);
  const overlap = Math.round(tileHeight * 0.14);
  const count = h <= tileHeight ? 1 : Math.ceil((h - overlap) / (tileHeight - overlap));
  const each = Math.ceil((h + (count - 1) * overlap) / count);
  const tiles: PageImage[] = [];
  for (let n = 0; n < count; n += 1) {
    const y = top + n * (each - overlap);
    const th = Math.min(each, top + h - y);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = th;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#fff';
    c.fillRect(0, 0, w, th);
    c.drawImage(full, left, y, w, th, 0, 0, w, th);
    tiles.push(canvasToPage(canvas));
  }
  return tiles;
}
