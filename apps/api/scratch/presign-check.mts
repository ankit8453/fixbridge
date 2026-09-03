import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const client = new S3Client({
  region: 'auto',
  endpoint: 'https://example.r2.cloudflarestorage.com',
  forcePathStyle: true,
  credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
});

const url = await getSignedUrl(
  client,
  new PutObjectCommand({
    Bucket: 'fixbridge-kyc',
    Key: 'kyc/x/y/z',
    ContentType: 'image/jpeg',
    ContentLength: 1234,
  }),
  { expiresIn: 300 },
);

const signed = new URL(url).searchParams.get('X-Amz-SignedHeaders');
console.log('SignedHeaders:', signed);
console.log('checksum in signed headers:', /checksum/.test(signed ?? ''));
