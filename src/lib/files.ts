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
