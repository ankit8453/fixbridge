import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A repository-wide scan for anything shaped like a full Aadhaar number.
 *
 * Aadhaar must never exist in our systems — not in the database, not in logs,
 * and not in a fixture somebody pasted from a real document while testing. This
 * test is the tripwire, and it is deliberately blunt: any 12-digit run in source
 * or fixtures fails it, and the fix is to use a last-4 instead.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

/**
 * `apps/web/src` is in this list deliberately.
 *
 * It was missing until Phase 12s partner redesign, which meant the tripwire
 * would not have caught a raw Aadhaar number pasted into a React component --
 * the exact surface where somebody types one in. The rule is repo-wide or it is
 * not a rule.
 */
const SCAN_DIRECTORIES = [
  'apps/api/src',
  'apps/api/prisma',
  'apps/web/src',
  'packages/shared/src',
  'docs',
];

// `.tsx` matters for the same reason `apps/web/src` does.
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.json', '.sql', '.md', '.prisma']);

/** This file necessarily contains the patterns it hunts for. */
const SELF = path.basename(__filename);

/**
 * A 12-digit run not glued to other digits — the shape of an Aadhaar number.
 *
 * Two exclusions, both for Indian phone numbers, which are also 12 digits once
 * the country code is included:
 *   - preceded by `+`  → `+919876543210`
 *   - starting `91` then a 6–9 → `919876543210`, a mobile with country code.
 * Aadhaar cannot be mistaken for either in practice, and phones are validated
 * and masked by their own code paths.
 */
const AADHAAR_LIKE = /(?<![\d+])(?!91[6-9])\d{12}(?!\d)/;

/** The same thing written in the 4-4-4 grouping people actually type. */
const AADHAAR_GROUPED = /(?<![\d+])\d{4}[ -]\d{4}[ -]\d{4}(?!\d)/;

/**
 * UUIDs are removed before scanning.
 *
 * `11111111-1111-4111-8111-111111111111` contains both a 12-digit run and a
 * 4-4-4 group, but it is a document id, not an identity number. UUIDs are
 * structurally distinct and never carry identity data, so blanking them keeps
 * the scan pointed at what it is actually for.
 */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function collectFiles(directory: string): string[] {
  const absolute = path.join(REPO_ROOT, directory);
  const found: string[] = [];

  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      if (entry === 'node_modules' || entry === 'dist') continue;

      const full = path.join(current, entry);

      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }

      if (SCAN_EXTENSIONS.has(path.extname(entry)) && entry !== SELF) {
        found.push(full);
      }
    }
  };

  try {
    walk(absolute);
  } catch {
    // A directory that does not exist yet is not a failure.
  }

  return found;
}

interface Offence {
  file: string;
  line: number;
  text: string;
}

function scan(pattern: RegExp): Offence[] {
  const offences: Offence[] = [];

  for (const directory of SCAN_DIRECTORIES) {
    for (const file of collectFiles(directory)) {
      const lines = readFileSync(file, 'utf8').split('\n');

      lines.forEach((text, index) => {
        // Timestamps in milliseconds and similar are 13 digits, which the
        // lookarounds already exclude.
        if (pattern.test(text.replace(UUID, '<uuid>'))) {
          offences.push({
            file: path.relative(REPO_ROOT, file),
            line: index + 1,
            text: text.trim().slice(0, 120),
          });
        }
      });
    }
  }

  return offences;
}

const describeOffences = (offences: Offence[]): string =>
  offences.map((o) => `${o.file}:${o.line}  ${o.text}`).join('\n');

describe('no raw identity numbers anywhere', () => {
  it('finds files to scan, so a broken path cannot make this pass vacuously', () => {
    const total = SCAN_DIRECTORIES.reduce(
      (count, directory) => count + collectFiles(directory).length,
      0,
    );

    expect(total).toBeGreaterThan(50);
  });

  it('contains no 12-digit Aadhaar-like number in source, fixtures or docs', () => {
    const offences = scan(AADHAAR_LIKE);

    expect(
      offences,
      `Found something shaped like a full Aadhaar number. Store only the last 4 digits.\n${describeOffences(offences)}`,
    ).toEqual([]);
  });

  it('contains no 4-4-4 grouped Aadhaar-like number either', () => {
    const offences = scan(AADHAAR_GROUPED);

    expect(offences, `Found a grouped Aadhaar-like number.\n${describeOffences(offences)}`).toEqual(
      [],
    );
  });
});

/**
 * Phase 8's addition to the same tripwire.
 *
 * A live payment key committed to a repository is a company-ending mistake, and
 * it is always committed by accident — pasted into a fixture "just to test", or
 * left in a config file somebody meant to gitignore. The scan runs on every
 * build so the accident has a few seconds to live.
 *
 * Only **live** keys fail. Razorpay test keys are `rzp_test_*` and are harmless
 * by construction; refusing those too would just push people into obscuring
 * them, which is worse.
 */
describe('no live payment keys anywhere', () => {
  const LIVE_KEY = new RegExp(`rzp${'_'}live${'_'}[A-Za-z0-9]+`);

  it('contains no live Razorpay key in source, fixtures or docs', () => {
    const offences = scan(LIVE_KEY);

    expect(
      offences,
      `Found something shaped like a LIVE Razorpay key. Rotate it immediately, then remove it.\n${describeOffences(offences)}`,
    ).toEqual([]);
  });

  it('would actually catch one — the pattern is not vacuous', () => {
    // Assembled at runtime so the literal never exists in this file either.
    const planted = ['rzp', 'live', 'AbCdEf0123456789'].join('_');

    expect(LIVE_KEY.test(planted)).toBe(true);
    expect(LIVE_KEY.test(['rzp', 'test', 'AbCdEf0123456789'].join('_'))).toBe(false);
  });
});
