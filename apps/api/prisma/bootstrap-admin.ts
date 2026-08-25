import { config as loadDotenv } from 'dotenv';
import path from 'node:path';

loadDotenv({ path: path.resolve(__dirname, '..', '.env') });

import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/modules/auth/password';

/**
 * Creates or updates the single admin account.
 *
 * ## Why this is a script and not an endpoint
 *
 * There is exactly one admin, and no route anywhere can create another — no
 * signup form, no invite link, no "first user becomes admin" special case. The
 * only way an admin exists is because somebody with shell access and the
 * environment file ran this. Sub-admins are created later from inside the
 * dashboard by that admin, which is why `admin_users.created_by_id` exists.
 *
 * ## Why the password comes from the environment
 *
 * So it is never in the repository, never in a commit, and never in a log. The
 * script reads it, hashes it with scrypt, and writes only the hash. It prints
 * the email it acted on and nothing else.
 *
 * Idempotent: running it again updates the password and name of the existing
 * account rather than failing or creating a duplicate, so rotating the password
 * is the same command.
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' npm run bootstrap:admin
 */
const prisma = new PrismaClient();

/** Matches the database's CHECK: an `@` that is not the first character. */
function assertUsableEmail(email: string): void {
  const at = email.indexOf('@');
  if (at < 1 || at === email.length - 1) {
    throw new Error(`ADMIN_EMAIL does not look like an email address: ${email}`);
  }
}

async function main(): Promise<void> {
  const rawEmail = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!rawEmail || !password) {
    throw new Error(
      'ADMIN_EMAIL and ADMIN_PASSWORD must both be set (apps/api/.env). ' +
        'Refusing to invent a default — an admin account with a guessable ' +
        'password is worse than no admin account.',
    );
  }

  /**
   * Lower-cased to agree with the unique index, which is on `LOWER(email)`.
   * Without this, signing in with different capitalisation than was seeded
   * would look up a row the database considers the same account.
   */
  const email = rawEmail.trim().toLowerCase();
  assertUsableEmail(email);

  /**
   * A length floor and nothing more. Composition rules ("one capital, one
   * symbol") push people toward `Password1!` and are worse than useless; length
   * is what actually costs an attacker time. The real defences are scrypt and
   * the rate limits in `admin-login.ts`.
   */
  if (password.length < 12) {
    throw new Error(`ADMIN_PASSWORD must be at least 12 characters (got ${password.length})`);
  }

  const name = process.env.ADMIN_NAME?.trim() || 'Platform Admin';
  const passwordHash = await hashPassword(password);

  const existing = await prisma.adminUser.findFirst({ where: { email } });

  if (existing) {
    await prisma.adminUser.update({
      where: { id: existing.id },
      // Role is deliberately not updated: if somebody demoted this account on
      // purpose, re-running the bootstrap should not silently promote it back.
      data: { passwordHash, name },
    });
    console.log(`admin updated: ${email} (password and name refreshed)`);
  } else {
    await prisma.adminUser.create({
      // `createdById` stays null: this account was created by the deployment
      // itself, not by another admin.
      data: { email, passwordHash, name, role: 'admin', status: 'active' },
    });
    console.log(`admin created: ${email}`);
  }

  const total = await prisma.adminUser.count({ where: { role: 'admin' } });
  if (total > 1) {
    console.warn(
      `WARNING: ${total} accounts hold the admin role. The design expects exactly one; ` +
        'the rest should be sub-admins.',
    );
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error('bootstrap failed:', error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });
