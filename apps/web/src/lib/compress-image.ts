/**
 * Downscales a photo in the browser before it is uploaded.
 *
 * A phone camera writes 3–8 MB files at resolutions far beyond anything a
 * 72-pixel avatar or a profile header needs. Uploading them costs the
 * technician their mobile data (which in this market is the expensive part, not
 * our storage bill) and costs us an object thirty times larger than the one we
 * actually serve.
 *
 * Deliberately best-effort: if anything here fails — an exotic codec, a browser
 * without `createImageBitmap`, a canvas the OS refuses to allocate — the
 * original file is returned and the server's size limit remains the real
 * boundary. A compression helper that can block an upload is worse than no
 * compression helper.
 */

export interface CompressOptions {
  /** Longest edge, in CSS pixels. Anything larger is scaled down proportionally. */
  maxEdge?: number;
  /** JPEG/WebP quality, 0–1. */
  quality?: number;
  /** Skip compression entirely for files already below this. */
  skipBelowBytes?: number;
}

const DEFAULTS: Required<CompressOptions> = {
  // 1280 is generous for a face: it survives a retina avatar and a profile
  // header with room to spare, and lands most photos comfortably under 500 KB.
  maxEdge: 1280,
  quality: 0.82,
  skipBelowBytes: 300 * 1024,
};

/** Types worth recompressing. PNG is included because phone screenshots are huge. */
const COMPRESSIBLE = ['image/jpeg', 'image/png', 'image/webp'];

export async function compressImage(file: File, options: CompressOptions = {}): Promise<File> {
  const { maxEdge, quality, skipBelowBytes } = { ...DEFAULTS, ...options };

  if (!COMPRESSIBLE.includes(file.type) || file.size <= skipBelowBytes) return file;
  if (typeof createImageBitmap !== 'function') return file;

  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > maxEdge ? maxEdge / longest : 1;

    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }

    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    /**
     * Always JPEG out. A PNG photograph is the pathological case — a screenshot
     * of a face can be 8 MB where the same pixels are 200 KB as JPEG — and
     * transparency is meaningless for a profile photo.
     */
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', quality);
    });

    // Only take the result if it actually helped; a tiny image can grow.
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}
