import { loadConfig } from '../src/core/config';
import { createLogger } from '../src/core/logger';
import { createS3StorageService } from '../src/core/storage';

/**
 * Proves object storage actually works, end to end, against whatever the
 * environment points at.
 *
 * Every step here is one a technician's document upload depends on, in the same
 * order and through the same code. That matters more than it sounds: the
 * failures this catches are not "the credentials are wrong" — those are obvious
 * — but the quiet ones where a pre-signed URL is generated happily and the
 * storage provider then rejects the upload it describes. R2, MinIO and S3 each
 * disagree about signed headers, path style and checksums, and the only honest
 * way to know which combination this deployment has is to push a real byte
 * through it.
 *
 * It cleans up after itself, and it never touches a real document: the key is
 * under `diagnostics/` and carries a timestamp.
 *
 *   npx tsx scripts/check-storage.ts
 */

const key = `diagnostics/storage-check-${Date.now()}`;
const body = Buffer.from(`fixbridge storage check ${new Date().toISOString()}\n`);
const contentType = 'text/plain';

let step = 'startup';

function ok(message: string): void {
  console.log(`  ok    ${message}`);
}

/**
 * Node's `fetch` reports almost every transport problem as the single word
 * "fetch failed" and hides the reason one level down in `cause` — DNS, TLS,
 * a refused connection and a header the client rejected all look identical
 * from the outside. Unwrap the chain, or the diagnostic is no diagnostic.
 */
function explain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;

  for (let depth = 0; current instanceof Error && depth < 5; depth += 1) {
    const code = (current as NodeJS.ErrnoException).code;
    parts.push(`${current.name}: ${current.message}${code ? ` (${code})` : ''}`);
    current = (current as { cause?: unknown }).cause;
  }

  return parts.join('\n  caused by  ') || String(error);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const storage = createS3StorageService(config, logger);

  console.log(`storage check against ${config.S3_ENDPOINT ?? 'aws s3'}`);
  console.log(`  bucket      ${config.S3_BUCKET}`);
  console.log(`  region      ${config.S3_REGION}`);
  console.log(`  path style  ${config.S3_FORCE_PATH_STYLE}`);
  console.log(`  driver      ${storage.name}`);
  console.log('');

  step = 'reaching the bucket';
  // Not `ensureBucket`: an R2 token scoped to object read/write cannot create
  // buckets, and a check that quietly creates what it was meant to verify
  // would pass against the wrong account.
  await storage.exists('diagnostics/does-not-exist');
  ok('bucket is reachable and the credentials are accepted');

  step = 'signing an upload URL';
  const upload = await storage.getUploadUrl({
    key,
    contentType,
    contentLength: body.byteLength,
  });
  ok(`upload URL signed (valid ${upload.expiresInSeconds}s)`);

  step = 'uploading through the signed URL';
  /**
   * The headers go on **verbatim**, exactly as both clients do it. If this
   * fails with 403 while the credentials are fine, the signed headers and the
   * sent headers disagree — which is the single most common way an S3-
   * compatible provider differs from S3, and the reason this check exists.
   */
  /**
   * `Content-Length` is deliberately not sent here, though the API returns it.
   *
   * It is a forbidden header for browsers: a browser silently drops it and
   * sets the true length itself, so the web uploader passing `requiredHeaders`
   * verbatim works. Node's fetch instead rejects the request outright rather
   * than deferring to its own body length — so sending it here would fail on
   * a path no real client takes, and hide whatever the true answer is. The
   * length is still signed into the URL, so storage enforces it regardless.
   */
  const { 'Content-Length': _length, ...sendHeaders } = upload.requiredHeaders;

  const put = await fetch(upload.url, {
    method: 'PUT',
    headers: sendHeaders,
    body,
  }).catch((cause: unknown) => {
    throw new Error(`could not reach storage to upload:
  ${explain(cause)}`);
  });

  if (!put.ok) {
    throw new Error(
      `storage refused the upload: ${put.status} ${put.statusText}\n` +
        `${(await put.text().catch(() => '')).slice(0, 400)}`,
    );
  }
  ok(`uploaded ${body.byteLength} bytes`);

  step = 'reading the object back';
  const head = await storage.head(key);
  if (!head) throw new Error('the object is not there after a successful upload');
  if (head.sizeBytes !== body.byteLength) {
    throw new Error(`size mismatch: stored ${head.sizeBytes}, sent ${body.byteLength}`);
  }
  ok(`head reports ${head.sizeBytes} bytes, type ${head.contentType ?? '(none)'}`);

  step = 'signing a download URL';
  const downloadUrl = await storage.getDownloadUrl(key, {
    filename: 'check.txt',
    contentType,
  });
  ok('download URL signed');

  step = 'downloading through the signed URL';
  const get = await fetch(downloadUrl);
  if (!get.ok) {
    throw new Error(`storage refused the download: ${get.status} ${get.statusText}`);
  }

  const returned = Buffer.from(await get.arrayBuffer());
  if (!returned.equals(body)) {
    throw new Error('the bytes that came back are not the bytes that went in');
  }
  ok('downloaded and the bytes match');

  /**
   * The response-header override is a security control, not a nicety: it is
   * what stops an uploaded HTML or SVG "certificate" executing in an ops
   * reviewer's browser. A provider that ignores the override silently would
   * leave that hole open, so it is asserted rather than assumed.
   */
  step = 'checking the forced-download headers';
  const disposition = get.headers.get('content-disposition') ?? '';
  if (!disposition.includes('attachment')) {
    throw new Error(
      `this provider ignores the signed content-disposition override ` +
        `(got "${disposition}"). Uploaded HTML would render in a reviewer's ` +
        `browser instead of downloading.`,
    );
  }
  ok(`content-disposition honoured: ${disposition}`);

  step = 'deleting the object';
  await storage.delete(key);
  if (await storage.exists(key)) throw new Error('the object survived deletion');
  ok('deleted, and confirmed gone');

  console.log('\nstorage works end to end.');
}

main().catch((error: unknown) => {
  console.error(`\nFAILED while ${step}:`);
  console.error(explain(error));
  console.error(
    '\nIf this is the first run against a new bucket, check in order: the ' +
      'endpoint includes the account id, the bucket name matches exactly, the ' +
      'API token has object read AND write, and S3_REGION is "auto" for R2.',
  );
  process.exit(1);
});
