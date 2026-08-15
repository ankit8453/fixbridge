import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { parseConfig, type AppConfig } from '../../core/config';
import { createContext, disposeContext, type AppContext } from '../../core/context';
import { denylistKey } from '../auth/denylist';
import { otpKeys } from '../auth/otp';
import { purgeVerificationData } from './repository';
import { projectStatus } from './state-machine';
import { createFakeAdapter } from './adapters';

/**
 * Phase 4 end-to-end against real Postgres, Redis and MinIO: document upload
 * round-trip, the four-level ladder, ops review with a needs-info detour, badge
 * award, badge downgrade on a failed re-check, and the append-only guarantee.
 */
const PHONES = {
  technician: '+919999902001',
  otherTechnician: '+919999902002',
  customer: '+919999902003',
  ops: '+919999902004',
};

const FIXED_OTP = '000000';
const DEVICE = 'device-phase4';
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let app: Express | undefined;
let context: AppContext | undefined;
let unavailableReason: string | undefined;
let storageAvailable = false;

function firstMeaningfulLine(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  return (
    error.message
      .split('\n')
      .map((part) => part.trim())
      .find((part) => part.length > 0) ?? error.name
  );
}

async function resetFixtures(ctx: AppContext): Promise<void> {
  const phones = Object.values(PHONES);

  const users = await ctx.prisma.user.findMany({
    where: { phone: { in: phones } },
    select: { id: true },
  });

  // verification_events refuses DELETE, so teardown must use the sanctioned
  // purge path — the same one DPDP erasure will use in Phase 14.
  await purgeVerificationData(
    ctx.prisma,
    users.map((user) => user.id),
  );

  await ctx.redis.del(
    ...phones.flatMap((phone) => [
      otpKeys.code(phone),
      otpKeys.attempts(phone),
      otpKeys.ratePhone(phone),
      otpKeys.cooldown(phone),
    ]),
    ...users.map((user) => denylistKey(user.id)),
  );

  await ctx.prisma.user.deleteMany({ where: { phone: { in: phones } } });
}

beforeAll(async () => {
  let config: AppConfig;

  try {
    config = parseConfig();
  } catch (error) {
    unavailableReason = `environment is not configured: ${firstMeaningfulLine(error)}`;
    return;
  }

  context = createContext(config);

  try {
    await context.prisma.$queryRaw`SELECT 1`;
    await context.redis.ping();
  } catch (error) {
    unavailableReason = `dependencies unreachable: ${firstMeaningfulLine(error)}`;
    return;
  }

  try {
    await context.storage.ensureBucket();
    storageAvailable = (await context.storage.head('probe/does-not-exist')) === null;
  } catch {
    storageAvailable = false;
  }

  app = createApp(context);
}, 60_000);

beforeEach(async () => {
  if (context && !unavailableReason) await resetFixtures(context);
});

afterAll(async () => {
  if (context && !unavailableReason) await resetFixtures(context);
  if (context) await disposeContext(context);
});

const SKIP_BANNER = (reason: string) =>
  `[skipped] Phase 4 verification tests — ${reason}. Start the services with \`docker compose up -d\` and rerun.`;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signIn(server: Express, phone: string, deviceId = DEVICE) {
  await request(server).post('/api/v1/auth/otp/request').send({ phone });
  const response = await request(server)
    .post('/api/v1/auth/otp/verify')
    .send({ phone, otp: FIXED_OTP, deviceId });

  expect(response.status).toBe(200);
  return response.body as { accessToken: string; user: { id: string } };
}

/** Signs in, takes the technician path, and returns a token carrying the role. */
async function signInAsTechnician(server: Express, phone: string, deviceId = DEVICE) {
  const initial = await signIn(server, phone, deviceId);

  await request(server)
    .post('/api/v1/providers/me/register')
    .set(auth(initial.accessToken))
    .send({ displayName: 'Verification Test Tech' })
    .expect(201);

  return signIn(server, phone, deviceId);
}

/** Signs in and grants the ops role directly, since nothing exposes that yet. */
async function signInAsOps(server: Express, ctx: AppContext, phone: string) {
  const initial = await signIn(server, phone, 'device-ops');

  await ctx.prisma.userRole.upsert({
    where: { userId_role: { userId: initial.user.id, role: 'ops' } },
    update: {},
    create: { userId: initial.user.id, role: 'ops' },
  });

  return signIn(server, phone, 'device-ops');
}

/** Requests a URL, PUTs the bytes straight to storage, then confirms. */
async function uploadDocument(
  server: Express,
  token: string,
  docType: 'id_proof' | 'photo' | 'certificate' | 'other',
): Promise<string> {
  const issued = await request(server)
    .post('/api/v1/verification/documents/upload-url')
    .set(auth(token))
    .send({ docType, contentType: 'image/png', sizeBytes: TINY_PNG.byteLength });

  expect(issued.status).toBe(201);

  const uploaded = await fetch(issued.body.upload.url as string, {
    method: 'PUT',
    headers: issued.body.upload.requiredHeaders as Record<string, string>,
    body: new Uint8Array(TINY_PNG),
  });
  expect(uploaded.ok).toBe(true);

  const confirmed = await request(server)
    .post(`/api/v1/verification/documents/${issued.body.document.id}/confirm`)
    .set(auth(token));

  expect(confirmed.status).toBe(200);
  expect(confirmed.body.document.status).toBe('uploaded');

  return issued.body.document.id as string;
}

/* -------------------------------------------------------------------------- */

describe('Phase 4 — append-only guarantee', () => {
  it('refuses UPDATE on verification_events', async (ctx) => {
    if (!app || !context) {
      console.warn(SKIP_BANNER(unavailableReason ?? 'unknown'));
      ctx.skip();
      return;
    }

    const tech = await signInAsTechnician(app, PHONES.technician);
    const created = await request(app)
      .post('/api/v1/verification/levels/1/submit')
      .set(auth(tech.accessToken))
      .send({ consent: true })
      .expect(201);

    const eventId = created.body.case.events[0].id as string;

    await expect(
      context.prisma.$executeRawUnsafe(
        `UPDATE verification_events SET notes = 'rewritten' WHERE id = '${eventId}'::uuid`,
      ),
    ).rejects.toThrow(/append-only/i);

    // And the row really is untouched.
    const event = await context.prisma.verificationEvent.findUnique({ where: { id: eventId } });
    expect(event?.notes).toBeNull();
  });

  it('refuses DELETE on verification_events', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const tech = await signInAsTechnician(app, PHONES.technician);
    const created = await request(app)
      .post('/api/v1/verification/levels/1/submit')
      .set(auth(tech.accessToken))
      .send({ consent: true })
      .expect(201);

    const eventId = created.body.case.events[0].id as string;

    await expect(
      context.prisma.$executeRawUnsafe(
        `DELETE FROM verification_events WHERE id = '${eventId}'::uuid`,
      ),
    ).rejects.toThrow(/append-only/i);

    expect(await context.prisma.verificationEvent.count({ where: { id: eventId } })).toBe(1);
  });

  it('refuses UPDATE even inside the erasure escape hatch', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const tech = await signInAsTechnician(app, PHONES.technician);
    const created = await request(app)
      .post('/api/v1/verification/levels/1/submit')
      .set(auth(tech.accessToken))
      .send({ consent: true })
      .expect(201);

    const eventId = created.body.case.events[0].id as string;

    // Erasure may remove history; nothing may ever rewrite it.
    await expect(
      context.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL "fixbridge.allow_kyc_purge" = 'on'`);
        await tx.$executeRawUnsafe(
          `UPDATE verification_events SET notes = 'rewritten' WHERE id = '${eventId}'::uuid`,
        );
      }),
    ).rejects.toThrow(/append-only/i);
  });

  it('allows the flagged purge path, so erasure remains possible', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const tech = await signInAsTechnician(app, PHONES.technician);
    await request(app)
      .post('/api/v1/verification/levels/1/submit')
      .set(auth(tech.accessToken))
      .send({ consent: true })
      .expect(201);

    await purgeVerificationData(context.prisma, [tech.user.id]);

    expect(
      await context.prisma.verificationCase.count({ where: { providerId: tech.user.id } }),
    ).toBe(0);
  });
});

describe('Phase 4 — projection equals fold(events)', () => {
  it('holds across a full needs-info detour', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const tech = await signInAsTechnician(app, PHONES.technician);
    const ops = await signInAsOps(app, context, PHONES.ops);

    const created = await request(app)
      .post('/api/v1/verification/levels/1/submit')
      .set(auth(tech.accessToken))
      .send({ consent: true })
      .expect(201);

    const caseId = created.body.case.id as string;
    const check = async () => {
      const record = await context?.prisma.verificationCase.findUnique({
        where: { id: caseId },
        include: { events: { orderBy: { createdAt: 'asc' } } },
      });

      expect(record).not.toBeNull();
      // The stored column is a cache; the log is the truth. They must agree.
      expect(record?.status).toBe(projectStatus(record?.events ?? []));
    };

    await check();

    await request(app)
      .post(`/api/v1/admin/verification/cases/${caseId}/review`)
      .set(auth(ops.accessToken))
      .expect(200);
    await check();

    await request(app)
      .post(`/api/v1/admin/verification/cases/${caseId}/decide`)
      .set(auth(ops.accessToken))
      .send({ decision: 'request_info', notes: 'Need the consent form signed.' })
      .expect(200);
    await check();

    await request(app)
      .post(`/api/v1/verification/cases/${caseId}/info`)
      .set(auth(tech.accessToken))
      .send({ notes: 'Signed and attached.' })
      .expect(200);
    await check();

    await request(app)
      .post(`/api/v1/admin/verification/cases/${caseId}/decide`)
      .set(auth(ops.accessToken))
      .send({ decision: 'pass' })
      .expect(200);
    await check();
  });

  it('holds for every seeded case, which was written as event scripts', async (ctx) => {
    if (!context) return ctx.skip();

    const cases = await context.prisma.verificationCase.findMany({
      include: { events: { orderBy: { createdAt: 'asc' } } },
      take: 100,
    });

    expect(cases.length).toBeGreaterThan(20);

    for (const record of cases) {
      expect(record.status, `case ${record.id}`).toBe(projectStatus(record.events));
    }
  });
});

describe('Phase 4 — document storage round-trip', () => {
  it('uploads to MinIO through a pre-signed URL and reads it back', async (ctx) => {
    if (!app || !context) return ctx.skip();
    if (!storageAvailable) {
      console.warn(SKIP_BANNER('object storage unreachable'));
      ctx.skip();
      return;
    }

    const tech = await signInAsTechnician(app, PHONES.technician);
    const documentId = await uploadDocument(app, tech.accessToken, 'id_proof');

    const download = await request(app)
      .get(`/api/v1/verification/documents/${documentId}/download-url`)
      .set(auth(tech.accessToken))
      .expect(200);

    const fetched = await fetch(download.body.url as string);
    expect(fetched.ok).toBe(true);

    const bytes = Buffer.from(await fetched.arrayBuffer());
    expect(bytes.equals(TINY_PNG)).toBe(true);
  });

  it('records the real size at confirmation rather than trusting the client', async (ctx) => {
    if (!app || !context || !storageAvailable) return ctx.skip();

    const tech = await signInAsTechnician(app, PHONES.technician);
    const documentId = await uploadDocument(app, tech.accessToken, 'photo');

    const stored = await context.prisma.providerDocument.findUnique({ where: { id: documentId } });
    expect(stored?.sizeBytes).toBe(TINY_PNG.byteLength);
    expect(stored?.uploadedAt).not.toBeNull();
  });

  it('refuses to confirm a document whose object was never uploaded', async (ctx) => {
    if (!app || !storageAvailable) return ctx.skip();

    const tech = await signInAsTechnician(app, PHONES.technician);
    const issued = await request(app)
      .post('/api/v1/verification/documents/upload-url')
      .set(auth(tech.accessToken))
      .send({ docType: 'id_proof', contentType: 'image/png', sizeBytes: 100 })
      .expect(201);

    const confirmed = await request(app)
      .post(`/api/v1/verification/documents/${issued.body.document.id}/confirm`)
      .set(auth(tech.accessToken));

    expect(confirmed.status).toBe(409);
    expect(confirmed.body.error.code).toBe('UPLOAD_NOT_FOUND');
  });

  it('rejects an oversized upload before a URL is even issued', async (ctx) => {
    if (!app) return ctx.skip();

    const tech = await signInAsTechnician(app, PHONES.technician);
    const response = await request(app)
      .post('/api/v1/verification/documents/upload-url')
      .set(auth(tech.accessToken))
      .send({ docType: 'id_proof', contentType: 'image/png', sizeBytes: 50 * 1024 * 1024 });

    expect(response.status).toBe(400);
  });

  it('signs the size, so storage itself refuses a differently-sized body', async (ctx) => {
    if (!app || !storageAvailable) return ctx.skip();

    const tech = await signInAsTechnician(app, PHONES.technician);
    const issued = await request(app)
      .post('/api/v1/verification/documents/upload-url')
      .set(auth(tech.accessToken))
      .send({ docType: 'id_proof', contentType: 'image/png', sizeBytes: TINY_PNG.byteLength })
      .expect(201);

    // Send more bytes than were declared and signed.
    const oversized = Buffer.concat([TINY_PNG, Buffer.alloc(4096, 1)]);
    const response = await fetch(issued.body.upload.url as string, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: new Uint8Array(oversized),
    });

    expect(response.ok).toBe(false);
  });

  it('rejects a content type nobody can review', async (ctx) => {
    if (!app) return ctx.skip();

    const tech = await signInAsTechnician(app, PHONES.technician);
    const response = await request(app)
      .post('/api/v1/verification/documents/upload-url')
      .set(auth(tech.accessToken))
      .send({ docType: 'id_proof', contentType: 'application/x-msdownload', sizeBytes: 100 });

    expect(response.status).toBe(400);
  });

  it('expires download URLs', async (ctx) => {
    if (!app || !context || !storageAvailable) return ctx.skip();

    const tech = await signInAsTechnician(app, PHONES.technician);
    const documentId = await uploadDocument(app, tech.accessToken, 'photo');
    const document = await context.prisma.providerDocument.findUnique({
      where: { id: documentId },
    });

    // One second of validity, then wait it out — the signature must stop working.
    const url = await context.storage.getDownloadUrl(document?.storageKey ?? '', 1);
    expect((await fetch(url)).ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 2_000));

    const afterExpiry = await fetch(url);
    expect(afterExpiry.ok).toBe(false);
    expect(afterExpiry.status).toBe(403);
  }, 20_000);
});

describe('Phase 4 — submission requirements', () => {
  it('refuses level 0 without uploaded documents', async (ctx) => {
    if (!app) return ctx.skip();

    const tech = await signInAsTechnician(app, PHONES.technician);
    const response = await request(app)
      .post('/api/v1/verification/levels/0/submit')
      .set(auth(tech.accessToken))
      .send({
        idType: 'aadhaar',
        idLast4: '4321',
        idProofDocumentId: 'a1b2c3d4-1111-4111-8111-aaaaaaaaaaaa',
        selfieDocumentId: 'e5f6a7b8-2222-4222-8222-bbbbbbbbbbbb',
      });

    expect(response.status).toBe(400);
  });

  it('refuses anything that looks like a full identity number', async (ctx) => {
    if (!app) return ctx.skip();

    const tech = await signInAsTechnician(app, PHONES.technician);
    const response = await request(app)
      .post('/api/v1/verification/levels/0/submit')
      .set(auth(tech.accessToken))
      .send({
        idType: 'aadhaar',
        // Eight digits is already too many to be a "last 4".
        idLast4: '87654321',
        idProofDocumentId: 'a1b2c3d4-1111-4111-8111-aaaaaaaaaaaa',
        selfieDocumentId: 'e5f6a7b8-2222-4222-8222-bbbbbbbbbbbb',
      });

    expect(response.status).toBe(400);
  });

  it('refuses a second open case for the same level', async (ctx) => {
    if (!app) return ctx.skip();

    const tech = await signInAsTechnician(app, PHONES.technician);
    await request(app)
      .post('/api/v1/verification/levels/1/submit')
      .set(auth(tech.accessToken))
      .send({ consent: true })
      .expect(201);

    const second = await request(app)
      .post('/api/v1/verification/levels/1/submit')
      .set(auth(tech.accessToken))
      .send({ consent: true });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('VERIFICATION_ALREADY_OPEN');
  });

  it('allows levels to be worked in parallel', async (ctx) => {
    if (!app) return ctx.skip();

    const tech = await signInAsTechnician(app, PHONES.technician);

    await request(app)
      .post('/api/v1/verification/levels/1/submit')
      .set(auth(tech.accessToken))
      .send({ consent: true })
      .expect(201);

    await request(app)
      .post('/api/v1/verification/levels/2/submit')
      .set(auth(tech.accessToken))
      .send({ tradeTest: true, notes: 'Available any weekday morning.' })
      .expect(201);
  });
});

describe('Phase 4 — the full ladder', () => {
  it('walks all four levels to a VERIFIED badge, then loses it to a failed re-check', async (ctx) => {
    if (!app || !context || !storageAvailable) return ctx.skip();

    const tech = await signInAsTechnician(app, PHONES.technician);
    const ops = await signInAsOps(app, context, PHONES.ops);
    const techHeaders = auth(tech.accessToken);
    const opsHeaders = auth(ops.accessToken);

    const idProof = await uploadDocument(app, tech.accessToken, 'id_proof');
    const selfie = await uploadDocument(app, tech.accessToken, 'photo');
    const certificate = await uploadDocument(app, tech.accessToken, 'certificate');

    const submissions = [
      {
        level: 0,
        body: {
          idType: 'aadhaar',
          idLast4: '4321',
          idProofDocumentId: idProof,
          selfieDocumentId: selfie,
        },
      },
      { level: 1, body: { consent: true } },
      { level: 2, body: { certificateDocumentId: certificate } },
      {
        level: 3,
        body: {
          references: [
            { name: 'Ramesh Gupta', phone: '9812300021', relationship: 'past_employer' },
            { name: 'Sunita Devi', phone: '9812300022', relationship: 'shop_owner' },
          ],
        },
      },
    ];

    const caseIds: Record<number, string> = {};

    for (const submission of submissions) {
      const created = await request(app)
        .post(`/api/v1/verification/levels/${submission.level}/submit`)
        .set(techHeaders)
        .send(submission.body);

      expect(created.status, `level ${submission.level}`).toBe(201);
      caseIds[submission.level] = created.body.case.id;
    }

    // The queue shows all four, oldest first.
    const queue = await request(app)
      .get('/api/v1/admin/verification/queue')
      .set(opsHeaders)
      .expect(200);

    expect(queue.body.cases.length).toBeGreaterThanOrEqual(4);

    // Ops opens one case — which is itself an access worth recording.
    const detail = await request(app)
      .get(`/api/v1/admin/verification/cases/${caseIds[0]}`)
      .set(opsHeaders)
      .expect(200);

    expect(detail.body.documents.length).toBeGreaterThanOrEqual(2);
    expect(detail.body.documents[0].downloadUrl).toContain('http');

    const accessLogs = await context.prisma.kycAccessLog.count({
      where: { actorUserId: ops.user.id, providerId: tech.user.id },
    });
    expect(accessLogs).toBeGreaterThan(0);

    // Level 0 takes a detour before passing.
    await request(app)
      .post(`/api/v1/admin/verification/cases/${caseIds[0]}/decide`)
      .set(opsHeaders)
      .send({ decision: 'request_info', notes: 'The selfie is too dark to compare.' })
      .expect(200);

    const needsInfo = await request(app)
      .get('/api/v1/verification/cases')
      .set(techHeaders)
      .expect(200);

    const level0 = (needsInfo.body.cases as { level: number; status: string }[]).find(
      (c) => c.level === 0,
    );
    expect(level0?.status).toBe('needs_info');

    await request(app)
      .post(`/api/v1/verification/cases/${caseIds[0]}/info`)
      .set(techHeaders)
      .send({ notes: 'Retaken in daylight.' })
      .expect(200);

    // Everything passes.
    for (const level of [0, 1, 2, 3]) {
      const decided = await request(app)
        .post(`/api/v1/admin/verification/cases/${caseIds[level]}/decide`)
        .set(opsHeaders)
        .send({ decision: 'pass' });

      expect(decided.status, `pass level ${level}`).toBe(200);
    }

    const verified = await request(app).get('/api/v1/verification/cases').set(techHeaders);
    expect(verified.body.summary.badge).toBe('VERIFIED');
    expect(verified.body.summary.badgeSince).not.toBeNull();
    expect(verified.body.summary.levelsPassed).toEqual([0, 1, 2, 3]);

    // The badge shows on the provider profile too.
    const profile = await request(app).get('/api/v1/providers/me').set(techHeaders).expect(200);
    expect(profile.body.profile.verification.badge).toBe('VERIFIED');

    /* ---- a re-check goes wrong ---- */

    const recheck = await request(app)
      .post('/api/v1/verification/levels/1/submit')
      .set(techHeaders)
      .send({ consent: true })
      .expect(201);

    // Re-opening a level does not remove the badge on its own.
    const during = await request(app).get('/api/v1/verification/cases').set(techHeaders);
    expect(during.body.summary.badge).toBe('VERIFIED');

    const failed = await request(app)
      .post(`/api/v1/admin/verification/cases/${recheck.body.case.id}/decide`)
      .set(opsHeaders)
      .send({ decision: 'fail', notes: 'Background check returned an unresolved case.' })
      .expect(200);

    expect(failed.body.summary.badge).toBe('NONE');
    expect(failed.body.summary.badgeSince).toBeNull();
    expect(failed.body.summary.levelsPassed).toEqual([0, 2, 3]);

    const afterDowngrade = await request(app).get('/api/v1/providers/me').set(techHeaders);
    expect(afterDowngrade.body.profile.verification.badge).toBe('NONE');

    // The original passed case is untouched — history is not rewritten.
    const originalLevel1 = await context.prisma.verificationCase.findUnique({
      where: { id: caseIds[1] },
    });
    expect(originalLevel1?.status).toBe('passed');
  }, 60_000);
});

describe('Phase 4 — adapter result path', () => {
  it('records an asynchronous third-party answer without deciding the case', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const tech = await signInAsTechnician(app, PHONES.technician);
    const created = await request(app)
      .post('/api/v1/verification/levels/1/submit')
      .set(auth(tech.accessToken))
      .send({ consent: true })
      .expect(201);

    const caseId = created.body.case.id as string;

    // The fake adapter answers on a later tick, exactly as a webhook would.
    const received = await new Promise<{ referenceToken: string; outcome: string }>((resolve) => {
      const adapter = createFakeAdapter({ outcome: 'passed', onResult: resolve });
      void adapter.initiate(caseId, { consent: true });
    });

    const { recordAdapterResult } = await import('./service');
    const updated = await recordAdapterResult({ context }, caseId, received);

    // Evidence recorded; the case is still waiting on a human.
    expect(updated.status).toBe('submitted');

    const adapterEvents = updated.events.filter(
      (event) => event.eventType === 'adapter_result_received',
    );
    expect(adapterEvents).toHaveLength(1);
    expect((adapterEvents[0]?.payload as { referenceToken: string }).referenceToken).toBe(
      received.referenceToken,
    );
  });
});

describe('Phase 4 — authorisation', () => {
  it('hides one technician’s cases and documents from another', async (ctx) => {
    if (!app) return ctx.skip();

    const alice = await signInAsTechnician(app, PHONES.technician, 'device-alice');
    const bob = await signInAsTechnician(app, PHONES.otherTechnician, 'device-bob');

    const created = await request(app)
      .post('/api/v1/verification/levels/1/submit')
      .set(auth(alice.accessToken))
      .send({ consent: true })
      .expect(201);

    const caseId = created.body.case.id as string;

    await request(app)
      .get(`/api/v1/verification/cases/${caseId}`)
      .set(auth(bob.accessToken))
      .expect(404);

    await request(app)
      .post(`/api/v1/verification/cases/${caseId}/info`)
      .set(auth(bob.accessToken))
      .send({ notes: 'Not mine to answer' })
      .expect(404);

    const bobCases = await request(app)
      .get('/api/v1/verification/cases')
      .set(auth(bob.accessToken));
    expect(bobCases.body.cases).toEqual([]);
  });

  it('gives a customer 403 on every verification route', async (ctx) => {
    if (!app) return ctx.skip();

    const customer = await signIn(app, PHONES.customer);
    const headers = auth(customer.accessToken);

    await request(app).get('/api/v1/verification/cases').set(headers).expect(403);
    await request(app).get('/api/v1/verification/documents').set(headers).expect(403);
    await request(app)
      .post('/api/v1/verification/levels/1/submit')
      .set(headers)
      .send({ consent: true })
      .expect(403);
    await request(app).get('/api/v1/admin/verification/queue').set(headers).expect(403);
  });

  it('closes the ops queue to technicians', async (ctx) => {
    if (!app) return ctx.skip();

    const tech = await signInAsTechnician(app, PHONES.technician);

    await request(app)
      .get('/api/v1/admin/verification/queue')
      .set(auth(tech.accessToken))
      .expect(403);

    const created = await request(app)
      .post('/api/v1/verification/levels/1/submit')
      .set(auth(tech.accessToken))
      .send({ consent: true })
      .expect(201);

    await request(app)
      .post(`/api/v1/admin/verification/cases/${created.body.case.id}/decide`)
      .set(auth(tech.accessToken))
      .send({ decision: 'pass' })
      .expect(403);
  });

  it('requires a token at all', async (ctx) => {
    if (!app) return ctx.skip();

    await request(app).get('/api/v1/verification/cases').expect(401);
    await request(app).get('/api/v1/admin/verification/queue').expect(401);
  });

  it('hides ops notes from the provider but shows them to ops', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const tech = await signInAsTechnician(app, PHONES.technician);
    const ops = await signInAsOps(app, context, PHONES.ops);

    const created = await request(app)
      .post('/api/v1/verification/levels/1/submit')
      .set(auth(tech.accessToken))
      .send({ consent: true })
      .expect(201);

    const caseId = created.body.case.id as string;
    const secret = 'Internal: applicant matched a watchlist entry, escalate.';

    await request(app)
      .post(`/api/v1/admin/verification/cases/${caseId}/decide`)
      .set(auth(ops.accessToken))
      .send({ decision: 'request_info', notes: secret })
      .expect(200);

    const providerView = await request(app)
      .get(`/api/v1/verification/cases/${caseId}`)
      .set(auth(tech.accessToken))
      .expect(200);

    expect(JSON.stringify(providerView.body)).not.toContain(secret);
    expect(providerView.body.case.events.every((e: { notes: null }) => e.notes === null)).toBe(
      true,
    );

    const opsView = await request(app)
      .get(`/api/v1/admin/verification/cases/${caseId}`)
      .set(auth(ops.accessToken))
      .expect(200);

    expect(JSON.stringify(opsView.body)).toContain(secret);
  });

  it('masks reference phone numbers in the provider’s own view', async (ctx) => {
    if (!app) return ctx.skip();

    const tech = await signInAsTechnician(app, PHONES.technician);
    const created = await request(app)
      .post('/api/v1/verification/levels/3/submit')
      .set(auth(tech.accessToken))
      .send({
        references: [
          { name: 'Ramesh Gupta', phone: '9812300031', relationship: 'past_employer' },
          { name: 'Sunita Devi', phone: '9812300032', relationship: 'shop_owner' },
        ],
      })
      .expect(201);

    const view = await request(app)
      .get(`/api/v1/verification/cases/${created.body.case.id}`)
      .set(auth(tech.accessToken))
      .expect(200);

    const body = JSON.stringify(view.body);
    expect(body).not.toContain('9812300031');
    expect(body).toContain('+9198123*****');
  });
});

describe('Phase 4 — ops decisions', () => {
  it('requires notes to fail or ask for more', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const tech = await signInAsTechnician(app, PHONES.technician);
    const ops = await signInAsOps(app, context, PHONES.ops);

    const created = await request(app)
      .post('/api/v1/verification/levels/1/submit')
      .set(auth(tech.accessToken))
      .send({ consent: true })
      .expect(201);

    const caseId = created.body.case.id as string;

    await request(app)
      .post(`/api/v1/admin/verification/cases/${caseId}/decide`)
      .set(auth(ops.accessToken))
      .send({ decision: 'fail' })
      .expect(400);

    await request(app)
      .post(`/api/v1/admin/verification/cases/${caseId}/decide`)
      .set(auth(ops.accessToken))
      .send({ decision: 'request_info' })
      .expect(400);

    // Approving needs no justification.
    await request(app)
      .post(`/api/v1/admin/verification/cases/${caseId}/decide`)
      .set(auth(ops.accessToken))
      .send({ decision: 'pass' })
      .expect(200);
  });

  it('refuses to reopen a decided case', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const tech = await signInAsTechnician(app, PHONES.technician);
    const ops = await signInAsOps(app, context, PHONES.ops);

    const created = await request(app)
      .post('/api/v1/verification/levels/1/submit')
      .set(auth(tech.accessToken))
      .send({ consent: true })
      .expect(201);

    const caseId = created.body.case.id as string;

    await request(app)
      .post(`/api/v1/admin/verification/cases/${caseId}/decide`)
      .set(auth(ops.accessToken))
      .send({ decision: 'pass' })
      .expect(200);

    const again = await request(app)
      .post(`/api/v1/admin/verification/cases/${caseId}/decide`)
      .set(auth(ops.accessToken))
      .send({ decision: 'fail', notes: 'Changed my mind' });

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('VERIFICATION_INVALID_TRANSITION');
  });

  it('filters the queue by level and status', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const ops = await signInAsOps(app, context, PHONES.ops);

    const byLevel = await request(app)
      .get('/api/v1/admin/verification/queue?level=1')
      .set(auth(ops.accessToken))
      .expect(200);

    expect(byLevel.body.cases.every((c: { level: number }) => c.level === 1)).toBe(true);

    const byStatus = await request(app)
      .get('/api/v1/admin/verification/queue?status=needs_info')
      .set(auth(ops.accessToken))
      .expect(200);

    expect(byStatus.body.cases.every((c: { status: string }) => c.status === 'needs_info')).toBe(
      true,
    );
  });

  it('paginates oldest-first, so nobody waits forever', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const ops = await signInAsOps(app, context, PHONES.ops);
    const page = await request(app)
      .get('/api/v1/admin/verification/queue?pageSize=3')
      .set(auth(ops.accessToken))
      .expect(200);

    expect(page.body.cases.length).toBeLessThanOrEqual(3);
    expect(page.body.page).toBe(1);
    expect(typeof page.body.total).toBe('number');

    const openedAt = (page.body.cases as { openedAt: string }[]).map((c) =>
      new Date(c.openedAt).getTime(),
    );
    expect(openedAt).toEqual([...openedAt].sort((a, b) => a - b));
  });
});

describe('Phase 4 — seeded distribution', () => {
  it('has 12 VERIFIED technicians', async (ctx) => {
    if (!context) return ctx.skip();

    const verified = await context.prisma.providerVerificationSummary.count({
      where: { badge: 'VERIFIED' },
    });

    expect(verified).toBe(12);
  });

  it('keeps badge and listing as independent axes', async (ctx) => {
    if (!context) return ctx.skip();

    // 17 listed but only 12 verified — Phase 5 search must require both.
    const listed = await context.prisma.providerProfile.count({ where: { isListed: true } });
    const verified = await context.prisma.providerVerificationSummary.count({
      where: { badge: 'VERIFIED' },
    });

    expect(listed).toBe(17);
    expect(verified).toBeLessThan(listed);
  });

  it('never stores a badge without a date, or a date without a badge', async (ctx) => {
    if (!context) return ctx.skip();

    const inconsistent = await context.prisma.providerVerificationSummary.count({
      where: {
        OR: [
          { badge: 'NONE', badgeSince: { not: null } },
          { badge: { not: 'NONE' }, badgeSince: null },
        ],
      },
    });

    expect(inconsistent).toBe(0);
  });
});
