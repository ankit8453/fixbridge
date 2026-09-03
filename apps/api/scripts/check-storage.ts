import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { get as httpsGet, request as httpsRequest } from 'node:https';
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

/** Whether ordinary HTTPS works from here at all. */
function reachable(url: string): Promise<string> {
  return new Promise((resolve) => {
    const request = httpsGet(url, { timeout: 8_000 }, (response) => {
      response.resume();
      resolve(`ok (${response.statusCode})`);
    });
    request.on('timeout', () => {
      request.destroy();
      resolve('timed out');
    });
    request.on('error', (error) => resolve(explain(error)));
  });
}

/** What the signature actually covers. A mismatch here is the usual culprit. */
function signedHeaders(url: string): string {
  return new URL(url).searchParams.get('X-Amz-SignedHeaders') ?? '(none)';
}

/**
 * A PUT with the headers exactly as given — including `Content-Length`, which
 * `fetch` forbids and every real client sends.
 */
function rawPut(
  url: string,
  headers: Record<string, string>,
  body: Buffer,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, { method: 'PUT', headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });

    request.on('error', reject);
    request.end(body);
  });
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
  /**
   * A raw `ListObjectsV2`, not `storage.exists`.
   *
   * `head` catches everything and answers null, on purpose — a missing object
   * and a denied one must look the same to a caller. That makes it useless
   * here: a TLS failure, dead credentials and an empty bucket all came back
   * as "false", and this check happily reported the bucket reachable while
   * nothing could reach it at all.
   *
   * Not `ensureBucket` either: an R2 token scoped to object read/write cannot
   * create buckets, and a check that creates what it was meant to verify would
   * pass against the wrong account.
   */
  const probe = new S3Client({
    region: config.S3_REGION,
    ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
  });

  try {
    await probe.send(new ListObjectsV2Command({ Bucket: config.S3_BUCKET, MaxKeys: 1 }));
  } catch (cause) {
    // Distinguish "this host is unreachable" from "nothing gets out of here",
    // which need completely different fixes and look identical from inside.
    const elsewhere = await reachable('https://api.github.com/');
    throw new Error(
      [
        `could not reach the bucket: ${explain(cause)}`,
        `        outbound HTTPS elsewhere: ${elsewhere}`,
      ].join('\n'),
    );
  }
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
   * Sent exactly as the phone sends it, through `node:https` rather than
   * `fetch`.
   *
   * That is the whole point of this step. `fetch` refuses to let a caller set
   * `Content-Length` and computes its own, so a check written with `fetch`
   * quietly tests a request no real client makes — and passes while both apps
   * fail. Dio on the phone and XHR in the browser both put the issued headers
   * on verbatim, so this does too.
   */
  console.log(`        signed headers: ${signedHeaders(upload.url)}`);

  const put = await rawPut(upload.url, upload.requiredHeaders, body);

  if (put.status >= 300) {
    throw new Error(
      [
        `storage refused the upload: ${put.status}`,
        `        sent: ${JSON.stringify(upload.requiredHeaders)}`,
        `        ${put.body.slice(0, 400).replace(/\s+/g, ' ')}`,
      ].join('\n'),
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
