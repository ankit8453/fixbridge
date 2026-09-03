import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { normalizePhone } from '../src/modules/auth/phone';

/**
 * Erases one person, by phone number.
 *
 * There is no button for this in the dashboard and there should not be: on a
 * live marketplace, deleting somebody destroys the other side's history too —
 * a technician's completed jobs, a customer's receipts. What the dashboard
 * offers instead is suspension.
 *
 * During the pilot, though, the same phone gets registered as a customer, then
 * wanted back as a technician, and the row in between blocks it. That is what
 * this is for, and why it is a script somebody has to run on the server on
 * purpose rather than an endpoint anyone can reach.
 *
 * Two things it does that a plain `DELETE FROM users` does not:
 *
 *   - **Refuses a real account.** Money that has moved is history, and a
 *     script that silently erases it is worse than no script. Anything with a
 *     payment or a completed booking needs `--force` and a deliberate look.
 *   - **Clears Redis.** The OTP rate limiter is keyed by phone and outlives
 *     the row by fifteen minutes. Without this, deleting an account and
 *     immediately re-registering hits "too many attempts" and looks like the
 *     deletion failed.
 *
 * Usage, from apps/api:
 *
 *   npx tsx scripts/delete-user.ts 9993448391            # report only
 *   npx tsx scripts/delete-user.ts 9993448391 --confirm
 */

const [rawPhone, ...flags] = process.argv.slice(2);
const confirm = flags.includes('--confirm');
const force = flags.includes('--force');

async function main(): Promise<void> {
  if (!rawPhone) {
    throw new Error('usage: tsx scripts/delete-user.ts <phone> [--confirm] [--force]');
  }

  const phone = normalizePhone(rawPhone);
  if (!phone) {
    throw new Error(`not a valid Indian mobile number: ${rawPhone}`);
  }

  const prisma = new PrismaClient();

  try {
    const user = await prisma.user.findUnique({
      where: { phone },
      include: {
        roles: true,
        customerProfile: { select: { userId: true } },
        providerProfile: { select: { displayName: true } },
        _count: {
          select: {
            bookings: true,
            addresses: true,
            reviewsWritten: true,
            notifications: true,
            refreshTokens: true,
          },
        },
      },
    });

    if (!user) {
      console.log(`no account exists for ${phone} — nothing to delete`);
      await clearRedis(phone);
      return;
    }

    console.log(`found ${phone}`);
    console.log(`  id           ${user.id}`);
    console.log(`  name         ${user.name ?? '(none)'}`);
    console.log(`  created      ${user.createdAt.toISOString()}`);
    console.log(`  roles        ${user.roles.map((r) => r.role).join(', ') || '(none)'}`);
    console.log(`  customer     ${user.customerProfile ? 'yes' : 'no'}`);
    console.log(`  technician   ${user.providerProfile ? 'yes' : 'no'}`);
    console.log(`  bookings     ${user._count.bookings}`);
    console.log(`  addresses    ${user._count.addresses}`);
    console.log(`  reviews      ${user._count.reviewsWritten}`);
    console.log(`  sessions     ${user._count.refreshTokens}`);

    // The guard. Everything above is recoverable noise; these two are not.
    const payments = await prisma.payment.count({
      where: { booking: { customerId: user.id } },
    });
    // The two states where a technician actually turned up. Both leave money
    // owed, so both make the account real history rather than test data.
    const completed = await prisma.booking.count({
      where: {
        customerId: user.id,
        status: { in: ['WORK_DONE', 'CLOSED_QUOTE_DECLINED'] },
      },
    });

    if ((payments > 0 || completed > 0) && !force) {
      console.error(
        `\nREFUSED: this account has ${payments} payment(s) and ${completed} completed ` +
          `booking(s). That is real history, not test data. Suspend the account from the ` +
          `dashboard instead, or pass --force if you are certain.`,
      );
      process.exitCode = 1;
      return;
    }

    if (!confirm) {
      console.log('\ndry run — nothing was deleted. Add --confirm to go ahead.');
      return;
    }

    // Every relation on User cascades, so one delete takes the whole tree:
    // profiles, addresses, bookings, reviews, notifications, sessions. The
    // handful of SetNull relations (audit-log actor, complaint resolver) keep
    // their rows and lose the pointer, which is what an audit trail is for.
    await prisma.user.delete({ where: { id: user.id } });
    console.log(`\ndeleted ${phone} and everything hanging off it`);

    await clearRedis(phone);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Drops the OTP state for a phone.
 *
 * Best effort on purpose: the row is already gone by the time this runs, and
 * failing here would report a deletion that did happen as a failure. The worst
 * case without it is a fifteen-minute wait.
 */
async function clearRedis(phone: string): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn('REDIS_URL not set — skipping OTP cleanup (re-registering may be rate limited)');
    return;
  }

  const redis = new Redis(url, { maxRetriesPerRequest: 2 });

  try {
    const removed = await redis.del(
      `auth:otp:code:${phone}`,
      `auth:otp:attempts:${phone}`,
      `auth:otp:rate:phone:${phone}`,
      `auth:otp:cooldown:${phone}`,
    );
    console.log(`cleared ${removed} OTP key(s) — this number can request a code straight away`);
  } catch (error) {
    console.warn(`could not clear OTP keys: ${String(error)}`);
  } finally {
    await redis.quit().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
