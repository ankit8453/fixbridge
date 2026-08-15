import { createHash } from 'node:crypto';

/**
 * A stable UUID derived from a name, in the spirit of UUID v5.
 *
 * Seed rows need ids that survive a rerun: with random ids the seed would have
 * to delete and recreate everything, churning primary keys that tests and local
 * bookmarks point at. Same input, same id, forever.
 */
export function deterministicUuid(name: string): string {
  const hash = createHash('sha256').update(`fixbridge:seed:${name}`).digest();

  const bytes = Buffer.from(hash.subarray(0, 16));
  // Stamp version 5 and the RFC 4122 variant so the value is a well-formed UUID.
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;

  const hex = bytes.toString('hex');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
