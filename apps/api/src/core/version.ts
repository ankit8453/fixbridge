import fs from 'node:fs';
import path from 'node:path';

/**
 * Read the API package version at startup.
 *
 * `__dirname` is `src/core` in dev and `dist/core` after a build — both two
 * levels below `apps/api/package.json`, so one path works for either.
 */
export function readPackageVersion(): string {
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const APP_VERSION = readPackageVersion();
