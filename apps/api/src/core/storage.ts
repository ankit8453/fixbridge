import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from './config';
import type { AppLogger } from './logger';

export interface UploadTarget {
  url: string;
  /** Headers the client MUST send verbatim — they are part of the signature. */
  requiredHeaders: Record<string, string>;
  expiresInSeconds: number;
}

export interface StoredObject {
  key: string;
  sizeBytes: number;
  contentType: string | null;
}

/**
 * Object storage for documents the API must never hold in memory.
 *
 * The API hands out pre-signed URLs and the client talks to storage directly —
 * file bytes never pass through this process. That keeps KYC images off our
 * application logs, out of our request buffers, and off our bandwidth bill.
 */
export interface DownloadOptions {
  expirySeconds?: number;
  /** Pinned into the signed URL so the browser cannot be told otherwise. */
  contentType?: string;
  filename?: string;
}

/** Keeps a crafted filename out of the `Content-Disposition` header. */
function sanitizeFilename(filename: string): string {
  return filename.replace(/["\\\r\n]/g, '').slice(0, 100) || 'document';
}

export interface StorageService {
  readonly name: string;
  getUploadUrl(input: {
    key: string;
    contentType: string;
    contentLength: number;
  }): Promise<UploadTarget>;
  getDownloadUrl(key: string, options?: DownloadOptions): Promise<string>;
  head(key: string): Promise<StoredObject | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Creates the bucket if it is missing. Safe to call on every boot. */
  ensureBucket(): Promise<void>;
}

/**
 * Where a KYC document lives. Provider id first so everything about one person
 * shares a prefix — which is what a DPDP erasure request will need to delete.
 */
export function kycObjectKey(providerId: string, docType: string, documentId: string): string {
  return `kyc/${providerId}/${docType}/${documentId}`;
}

export function createS3StorageService(config: AppConfig, logger: AppLogger): StorageService {
  const client = new S3Client({
    region: config.S3_REGION,
    ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
  });

  const bucket = config.S3_BUCKET;

  return {
    name: config.S3_ENDPOINT ? 's3-compatible' : 's3',

    async getUploadUrl({ key, contentType, contentLength }) {
      /**
       * `ContentType` and `ContentLength` are signed, so storage itself rejects
       * an upload of a different type or a different size — the limit is not a
       * promise we check afterwards.
       *
       * This is why the client must declare its size up front. A pre-signed PUT
       * cannot express "at most N bytes"; only a pre-signed POST policy can, and
       * that has a clumsier client story. Signing the exact length gets the same
       * guarantee. `head()` is still checked on confirm as a second line.
       */
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: contentLength,
      });

      const url = await getSignedUrl(client, command, {
        expiresIn: config.STORAGE_UPLOAD_URL_TTL_SECONDS,
      });

      return {
        url,
        requiredHeaders: {
          'Content-Type': contentType,
          'Content-Length': String(contentLength),
        },
        expiresInSeconds: config.STORAGE_UPLOAD_URL_TTL_SECONDS,
      };
    },

    async getDownloadUrl(key, options) {
      /**
       * Force the download inert.
       *
       * A "certificate" can be an HTML or SVG file with a script in it. Served
       * with its own content type it would execute in an ops reviewer's browser,
       * on our origin, while they are logged in — a stored XSS delivered through
       * the KYC queue. Pinning the response headers means the browser saves the
       * file instead of rendering it, whatever the object claims to be.
       *
       * These are S3 response-header overrides, signed into the URL, so a caller
       * cannot strip them without invalidating the signature.
       */
      const filename = options?.filename ?? key.split('/').pop() ?? 'document';

      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${sanitizeFilename(filename)}"`,
        // Pinned to what we recorded at upload, never to what the object says.
        ResponseContentType: options?.contentType ?? 'application/octet-stream',
      });

      return getSignedUrl(client, command, {
        expiresIn: options?.expirySeconds ?? config.STORAGE_DOWNLOAD_URL_TTL_SECONDS,
      });
    },

    async head(key) {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));

        return {
          key,
          sizeBytes: result.ContentLength ?? 0,
          contentType: result.ContentType ?? null,
        };
      } catch {
        // A missing object and a denied one are indistinguishable here by design.
        return null;
      }
    },

    async exists(key) {
      return (await this.head(key)) !== null;
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    async ensureBucket() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
        return;
      } catch {
        // Falls through to create.
      }

      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
        logger.info({ bucket }, 'storage: created bucket');
      } catch (error) {
        // A parallel boot may have won the race; that is fine.
        logger.warn({ err: error, bucket }, 'storage: could not create bucket');
      }
    },
  };
}
