import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { parseConfig, type AppConfig } from '../core/config';
import { createContext, disposeContext, type AppContext } from '../core/context';
import { blockUser, unblockUser } from './auth/service';
import { denylistKey } from './auth/denylist';
import { otpKeys } from './auth/otp';

/**
 * Phase 3 end-to-end: categories, customer addresses, technician profiles, the
 * completeness gate, ownership isolation, the geography round-trip, and the
 * carry-over denylist. Skips with a printed reason when the compose services are
 * not up, matching the Phase 1 convention.
 */
const PHONES = {
  customerA: '+919999901001',
  customerB: '+919999901002',
  technician: '+919999901003',
  blocked: '+919999901004',
};

const FIXED_OTP = '000000';
const DEVICE = 'device-phase3';

let app: Express | undefined;
let context: AppContext | undefined;
let unavailableReason: string | undefined;

function firstMeaningfulLine(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  return (
    error.message
      .split('\n')
      .map((part) => part.trim())
      .find((part) => part.length > 0) ?? error.name
  );
}

/**
 * Scoped to this file's own fixtures only.
 *
 * A blanket `del auth:otp:*` would reset counters that the auth suite is
 * mid-way through asserting — vitest runs files in parallel, so wildcard
 * cleanup across shared Redis keys is a race, not a convenience.
 */
async function resetFixtures(ctx: AppContext): Promise<void> {
  const phones = Object.values(PHONES);

  const users = await ctx.prisma.user.findMany({
    where: { phone: { in: phones } },
    select: { id: true },
  });

  await ctx.redis.del(
    ...phones.flatMap((phone) => [
      otpKeys.code(phone),
      otpKeys.attempts(phone),
      otpKeys.ratePhone(phone),
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

  app = createApp(context);
});

beforeEach(async () => {
  if (context && !unavailableReason) await resetFixtures(context);
});

afterAll(async () => {
  if (context && !unavailableReason) await resetFixtures(context);
  if (context) await disposeContext(context);
});

const SKIP_BANNER = (reason: string) =>
  `[skipped] Phase 3 integration tests — ${reason}. Start the services with \`docker compose up -d\` and rerun.`;

async function signIn(server: Express, phone: string, deviceId = DEVICE) {
  await request(server).post('/api/v1/auth/otp/request').send({ phone });
  const response = await request(server)
    .post('/api/v1/auth/otp/verify')
    .send({ phone, otp: FIXED_OTP, deviceId });

  expect(response.status).toBe(200);
  return response.body as { accessToken: string; user: { id: string; roles: string[] } };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Signs in and takes the technician path, returning a token that carries the role. */
async function signInAsTechnician(server: Express, phone: string) {
  const initial = await signIn(server, phone);

  await request(server)
    .post('/api/v1/providers/me/register')
    .set(auth(initial.accessToken))
    .send({ displayName: 'Test Technician' })
    .expect(201);

  // Roles live in the access token, so a new one is needed after the grant.
  return signIn(server, phone);
}

describe('Phase 3 — categories', () => {
  it('returns a two-level tree of active categories', async (ctx) => {
    if (!app) {
      console.warn(SKIP_BANNER(unavailableReason ?? 'unknown'));
      ctx.skip();
      return;
    }

    const response = await request(app).get('/api/v1/categories');

    expect(response.status).toBe(200);
    expect(response.body.cityId).toBe(1);
    expect(response.body.categories.length).toBeGreaterThanOrEqual(5);

    for (const cluster of response.body.categories) {
      expect(Array.isArray(cluster.children)).toBe(true);
      for (const service of cluster.children) {
        // Two levels, no deeper.
        expect(service.children).toEqual([]);
      }
    }
  });

  it('is public — no token required', async (ctx) => {
    if (!app) return ctx.skip();
    await request(app).get('/api/v1/categories').expect(200);
  });

  it('returns Hindi by default and English on request', async (ctx) => {
    if (!app) return ctx.skip();

    const hindi = await request(app).get('/api/v1/categories');
    const english = await request(app).get('/api/v1/categories').set('Accept-Language', 'en');

    const findSlug = (body: { categories: { slug: string; name: string }[] }, slug: string) =>
      body.categories.find((cluster) => cluster.slug === slug)?.name;

    expect(findSlug(hindi.body, 'electrical')).toBe('बिजली का काम');
    expect(findSlug(english.body, 'electrical')).toBe('Electrical');
  });

  it('names come from i18n keys, never stored display text', async (ctx) => {
    if (!app) return ctx.skip();

    const response = await request(app).get('/api/v1/categories').set('Accept-Language', 'en');
    const cluster = response.body.categories[0];

    expect(cluster.nameKey).toMatch(/^categories\./);
    expect(cluster.name).not.toBe(cluster.nameKey);
  });

  it('returns an empty tree for a city with no categories', async (ctx) => {
    if (!app) return ctx.skip();

    const response = await request(app).get('/api/v1/categories?cityId=9999');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ cityId: 9999, categories: [] });
  });

  it('rejects a malformed cityId', async (ctx) => {
    if (!app) return ctx.skip();

    const response = await request(app).get('/api/v1/categories?cityId=abc');
    expect(response.status).toBe(400);
  });
});

describe('Phase 3 — customer profile and addresses', () => {
  it('starts with no profile and creates one lazily on first write', async (ctx) => {
    if (!app) return ctx.skip();

    const session = await signIn(app, PHONES.customerA);

    const before = await request(app).get('/api/v1/customers/me').set(auth(session.accessToken));
    expect(before.body.profile).toBeNull();

    const updated = await request(app)
      .patch('/api/v1/customers/me')
      .set(auth(session.accessToken))
      .send({ displayName: 'Asha Verma', email: 'ASHA@Example.COM ' });

    expect(updated.status).toBe(200);
    expect(updated.body.profile.displayName).toBe('Asha Verma');
    expect(updated.body.profile.email).toBe('asha@example.com');
  });

  it('geocodes an address when the client sends no coordinates', async (ctx) => {
    if (!app) return ctx.skip();

    const session = await signIn(app, PHONES.customerA);

    const response = await request(app)
      .post('/api/v1/customers/me/addresses')
      .set(auth(session.accessToken))
      .send({
        label: 'home',
        addressText: '212 Shastri Nagar, Wright Town',
        landmark: 'Behind Gupta Kirana',
      });

    expect(response.status).toBe(201);
    expect(response.body.address.location.lat).toBeGreaterThan(23);
    expect(response.body.address.location.lng).toBeGreaterThan(79);
    // First address becomes the default without being asked.
    expect(response.body.address.isDefault).toBe(true);
  });

  it('keeps client-supplied coordinates instead of geocoding', async (ctx) => {
    if (!app) return ctx.skip();

    const session = await signIn(app, PHONES.customerA);

    const response = await request(app)
      .post('/api/v1/customers/me/addresses')
      .set(auth(session.accessToken))
      .send({ addressText: 'Somewhere precise', lat: 23.1618, lng: 79.9492 });

    expect(response.status).toBe(201);
    expect(response.body.address.location).toEqual({ lat: 23.1618, lng: 79.9492 });
  });

  it('survives a full geography round-trip through raw SQL', async (ctx) => {
    if (!app) return ctx.skip();

    const session = await signIn(app, PHONES.customerA);
    const written = { lat: 23.204567, lng: 79.887654 };

    const created = await request(app)
      .post('/api/v1/customers/me/addresses')
      .set(auth(session.accessToken))
      .send({ addressText: 'Round trip check', ...written });

    const readBack = await request(app)
      .get(`/api/v1/customers/me/addresses/${created.body.address.id}`)
      .set(auth(session.accessToken));

    expect(readBack.body.address.location.lat).toBeCloseTo(written.lat, 6);
    expect(readBack.body.address.location.lng).toBeCloseTo(written.lng, 6);
  });

  it('rejects half a coordinate pair', async (ctx) => {
    if (!app) return ctx.skip();

    const session = await signIn(app, PHONES.customerA);

    const response = await request(app)
      .post('/api/v1/customers/me/addresses')
      .set(auth(session.accessToken))
      .send({ addressText: 'Only a latitude', lat: 23.16 });

    expect(response.status).toBe(400);
  });

  it('re-geocodes when the address text changes without new coordinates', async (ctx) => {
    if (!app) return ctx.skip();

    const session = await signIn(app, PHONES.customerA);

    const created = await request(app)
      .post('/api/v1/customers/me/addresses')
      .set(auth(session.accessToken))
      .send({ addressText: 'First address text' });

    const updated = await request(app)
      .patch(`/api/v1/customers/me/addresses/${created.body.address.id}`)
      .set(auth(session.accessToken))
      .send({ addressText: 'A completely different address' });

    expect(updated.status).toBe(200);
    expect(updated.body.address.location).not.toEqual(created.body.address.location);
  });

  it('enforces the five-address cap', async (ctx) => {
    if (!app) return ctx.skip();

    const session = await signIn(app, PHONES.customerA);

    for (let i = 0; i < 5; i += 1) {
      await request(app)
        .post('/api/v1/customers/me/addresses')
        .set(auth(session.accessToken))
        .send({ addressText: `Address number ${i}` })
        .expect(201);
    }

    const blocked = await request(app)
      .post('/api/v1/customers/me/addresses')
      .set(auth(session.accessToken))
      .send({ addressText: 'One too many' });

    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('ADDRESS_LIMIT_REACHED');
  });

  it('moves the default when another address is promoted', async (ctx) => {
    if (!app) return ctx.skip();

    const session = await signIn(app, PHONES.customerA);

    const first = await request(app)
      .post('/api/v1/customers/me/addresses')
      .set(auth(session.accessToken))
      .send({ addressText: 'Home address' });

    const second = await request(app)
      .post('/api/v1/customers/me/addresses')
      .set(auth(session.accessToken))
      .send({ addressText: 'Shop address' });

    expect(second.body.address.isDefault).toBe(false);

    await request(app)
      .post(`/api/v1/customers/me/addresses/${second.body.address.id}/default`)
      .set(auth(session.accessToken))
      .expect(200);

    const list = await request(app)
      .get('/api/v1/customers/me/addresses')
      .set(auth(session.accessToken));

    const byId = new Map<string, boolean>(
      (list.body.addresses as { id: string; isDefault: boolean }[]).map((a) => [a.id, a.isDefault]),
    );

    expect(byId.get(second.body.address.id)).toBe(true);
    expect(byId.get(first.body.address.id)).toBe(false);
  });

  it('promotes another address to default when the default is deleted', async (ctx) => {
    if (!app) return ctx.skip();

    const session = await signIn(app, PHONES.customerA);

    const first = await request(app)
      .post('/api/v1/customers/me/addresses')
      .set(auth(session.accessToken))
      .send({ addressText: 'Will be deleted' });

    await request(app)
      .post('/api/v1/customers/me/addresses')
      .set(auth(session.accessToken))
      .send({ addressText: 'Will be promoted' });

    await request(app)
      .delete(`/api/v1/customers/me/addresses/${first.body.address.id}`)
      .set(auth(session.accessToken))
      .expect(200);

    const list = await request(app)
      .get('/api/v1/customers/me/addresses')
      .set(auth(session.accessToken));

    expect(list.body.addresses).toHaveLength(1);
    expect(list.body.addresses[0].isDefault).toBe(true);
  });

  it('deletes an address', async (ctx) => {
    if (!app) return ctx.skip();

    const session = await signIn(app, PHONES.customerA);
    const created = await request(app)
      .post('/api/v1/customers/me/addresses')
      .set(auth(session.accessToken))
      .send({ addressText: 'Temporary address' });

    await request(app)
      .delete(`/api/v1/customers/me/addresses/${created.body.address.id}`)
      .set(auth(session.accessToken))
      .expect(200);

    await request(app)
      .get(`/api/v1/customers/me/addresses/${created.body.address.id}`)
      .set(auth(session.accessToken))
      .expect(404);
  });

  it('requires authentication', async (ctx) => {
    if (!app) return ctx.skip();
    await request(app).get('/api/v1/customers/me/addresses').expect(401);
  });
});

describe('Phase 3 — ownership isolation', () => {
  it('hides one user’s address from another entirely', async (ctx) => {
    if (!app) return ctx.skip();

    const alice = await signIn(app, PHONES.customerA, 'device-alice');
    const bob = await signIn(app, PHONES.customerB, 'device-bob');

    const aliceAddress = await request(app)
      .post('/api/v1/customers/me/addresses')
      .set(auth(alice.accessToken))
      .send({ addressText: "Alice's private address", landmark: 'Secret landmark' });

    const id = aliceAddress.body.address.id as string;

    // 404, not 403: confirming existence would already be a leak.
    const read = await request(app)
      .get(`/api/v1/customers/me/addresses/${id}`)
      .set(auth(bob.accessToken));
    expect(read.status).toBe(404);
    expect(JSON.stringify(read.body)).not.toContain('Secret landmark');

    await request(app)
      .patch(`/api/v1/customers/me/addresses/${id}`)
      .set(auth(bob.accessToken))
      .send({ addressText: 'Hijacked address text' })
      .expect(404);

    await request(app)
      .delete(`/api/v1/customers/me/addresses/${id}`)
      .set(auth(bob.accessToken))
      .expect(404);

    await request(app)
      .post(`/api/v1/customers/me/addresses/${id}/default`)
      .set(auth(bob.accessToken))
      .expect(404);

    // Alice's address is untouched by all of that.
    const stillThere = await request(app)
      .get(`/api/v1/customers/me/addresses/${id}`)
      .set(auth(alice.accessToken));

    expect(stillThere.status).toBe(200);
    expect(stillThere.body.address.addressText).toBe("Alice's private address");
  });

  it('keeps address lists separate', async (ctx) => {
    if (!app) return ctx.skip();

    const alice = await signIn(app, PHONES.customerA, 'device-alice');
    const bob = await signIn(app, PHONES.customerB, 'device-bob');

    await request(app)
      .post('/api/v1/customers/me/addresses')
      .set(auth(alice.accessToken))
      .send({ addressText: "Alice's only address" });

    const bobList = await request(app)
      .get('/api/v1/customers/me/addresses')
      .set(auth(bob.accessToken));

    expect(bobList.body.addresses).toEqual([]);
  });
});

describe('Phase 3 — technician registration and completeness', () => {
  it('grants the technician role and opens an empty profile', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const session = await signIn(app, PHONES.technician);
    expect(session.user.roles).toEqual(['customer']);

    const registered = await request(app)
      .post('/api/v1/providers/me/register')
      .set(auth(session.accessToken))
      .send({});

    expect(registered.status).toBe(201);
    expect(registered.body.profile.isListed).toBe(false);
    expect(registered.body.profile.completeness.score).toBe(0);

    const roles = await context.prisma.userRole.findMany({
      where: { userId: session.user.id },
      select: { role: true },
    });

    expect(roles.map((r) => r.role).sort()).toEqual(['customer', 'technician']);
  });

  it('is idempotent — registering twice does not duplicate anything', async (ctx) => {
    if (!app) return ctx.skip();

    const session = await signIn(app, PHONES.technician);

    await request(app)
      .post('/api/v1/providers/me/register')
      .set(auth(session.accessToken))
      .send({})
      .expect(201);

    const second = await request(app)
      .post('/api/v1/providers/me/register')
      .set(auth(session.accessToken))
      .send({});

    expect(second.status).toBe(200);
    expect(second.body.alreadyRegistered).toBe(true);
  });

  it('refuses profile endpoints to a plain customer', async (ctx) => {
    if (!app) return ctx.skip();

    const session = await signIn(app, PHONES.customerA);
    const response = await request(app).get('/api/v1/providers/me').set(auth(session.accessToken));

    expect(response.status).toBe(403);
  });

  /**
   * The core Phase 3 guarantee: a profile becomes listed only once it is
   * complete, and stops being listed the moment it is not.
   */
  it('flips is_listed as the profile is built up and torn back down', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const session = await signInAsTechnician(app, PHONES.technician);
    const headers = auth(session.accessToken);

    const leaf = await context.prisma.category.findFirst({
      where: { cityId: 1, parentId: { not: null }, isActive: true },
    });
    expect(leaf).not.toBeNull();

    const scoreOf = (response: { body: { profile: { completeness: { score: number } } } }) =>
      response.body.profile.completeness.score;

    // display name only
    let step = await request(app)
      .patch('/api/v1/providers/me')
      .set(headers)
      .send({ displayName: 'Ramesh Vishwakarma', yearsExperience: 12 })
      .expect(200);
    expect(step.body.profile.isListed).toBe(false);

    step = await request(app)
      .patch('/api/v1/providers/me')
      .set(headers)
      .send({ baseLocation: { lat: 23.1618, lng: 79.9492 }, serviceRadiusKm: 8 })
      .expect(200);
    expect(step.body.profile.isListed).toBe(false);

    step = await request(app)
      .post('/api/v1/providers/me/skills')
      .set(headers)
      .send({ categoryId: leaf?.id })
      .expect(201);
    expect(step.body.profile.isListed).toBe(false);

    const priceCard = await request(app)
      .post('/api/v1/providers/me/price-cards')
      .set(headers)
      .send({
        categoryId: leaf?.id,
        title: 'Standard visit',
        priceType: 'fixed',
        amountPaise: 45000,
      })
      .expect(201);
    // Still short of the threshold: no availability yet.
    expect(priceCard.body.profile.isListed).toBe(false);
    expect(scoreOf(priceCard)).toBeLessThan(80);

    const withHours = await request(app)
      .post('/api/v1/providers/me/availability')
      .set(headers)
      .send({ dayOfWeek: 1, startTime: '09:00', endTime: '19:00' })
      .expect(201);

    // Everything booking-critical is now present, so the profile goes live.
    expect(withHours.body.profile.isListed).toBe(true);
    expect(scoreOf(withHours)).toBeGreaterThanOrEqual(80);

    // The database agrees, which is what Phase 5 search will read.
    const stored = await context.prisma.providerProfile.findUnique({
      where: { userId: session.user.id },
    });
    expect(stored?.isListed).toBe(true);

    // Remove the price card and it drops straight back out of search.
    const delisted = await request(app)
      .delete(`/api/v1/providers/me/price-cards/${priceCard.body.profile.priceCards[0].id}`)
      .set(headers)
      .expect(200);

    expect(delisted.body.profile.isListed).toBe(false);
    expect(scoreOf(delisted)).toBeLessThan(80);
    expect(delisted.body.profile.completeness.missing).toContain('priceCard');

    const storedAgain = await context.prisma.providerProfile.findUnique({
      where: { userId: session.user.id },
    });
    expect(storedAgain?.isListed).toBe(false);
  });

  it('deactivating the last price card delists just as deleting it does', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const session = await signInAsTechnician(app, PHONES.technician);
    const headers = auth(session.accessToken);
    const leaf = await context.prisma.category.findFirst({
      where: { cityId: 1, parentId: { not: null }, isActive: true },
    });

    await request(app)
      .patch('/api/v1/providers/me')
      .set(headers)
      .send({
        displayName: 'Test Tech',
        yearsExperience: 5,
        baseLocation: { lat: 23.16, lng: 79.95 },
      });
    await request(app)
      .post('/api/v1/providers/me/skills')
      .set(headers)
      .send({ categoryId: leaf?.id });
    await request(app)
      .post('/api/v1/providers/me/availability')
      .set(headers)
      .send({ dayOfWeek: 2, startTime: '10:00', endTime: '18:00' });
    const card = await request(app).post('/api/v1/providers/me/price-cards').set(headers).send({
      categoryId: leaf?.id,
      title: 'Visit',
      priceType: 'starting_from',
      amountPaise: 30000,
    });

    expect(card.body.profile.isListed).toBe(true);

    const deactivated = await request(app)
      .patch(`/api/v1/providers/me/price-cards/${card.body.profile.priceCards[0].id}`)
      .set(headers)
      .send({ isActive: false });

    expect(deactivated.body.profile.isListed).toBe(false);
  });

  /**
   * The hard gate. A technician with everything except a display name scores 90,
   * which clears the threshold of 80 — but there is no name to show in search,
   * so the score must not be allowed to decide on its own.
   */
  it('refuses to list a nameless technician even though the score clears the threshold', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const initial = await signIn(app, PHONES.technician);

    // Register with no display name at all.
    await request(app)
      .post('/api/v1/providers/me/register')
      .set(auth(initial.accessToken))
      .send({})
      .expect(201);

    const session = await signIn(app, PHONES.technician);
    const headers = auth(session.accessToken);
    const leaf = await context.prisma.category.findFirst({
      where: { cityId: 1, parentId: { not: null }, isActive: true },
    });

    await request(app)
      .patch('/api/v1/providers/me')
      .set(headers)
      .send({ yearsExperience: 9, baseLocation: { lat: 23.1618, lng: 79.9492 } })
      .expect(200);
    await request(app)
      .post('/api/v1/providers/me/skills')
      .set(headers)
      .send({ categoryId: leaf?.id })
      .expect(201);
    await request(app)
      .post('/api/v1/providers/me/price-cards')
      .set(headers)
      .send({ categoryId: leaf?.id, title: 'Visit', priceType: 'fixed', amountPaise: 40000 })
      .expect(201);
    const everythingButName = await request(app)
      .post('/api/v1/providers/me/availability')
      .set(headers)
      .send({ dayOfWeek: 1, startTime: '09:00', endTime: '19:00' })
      .expect(201);

    const completeness = everythingButName.body.profile.completeness;

    expect(completeness.score).toBeGreaterThanOrEqual(completeness.threshold);
    expect(completeness.missingRequired).toEqual(['displayName']);
    expect(everythingButName.body.profile.isListed).toBe(false);

    const stored = await context.prisma.providerProfile.findUnique({
      where: { userId: session.user.id },
    });
    expect(stored?.isListed).toBe(false);

    // Adding the name — and nothing else — is what takes them live.
    const named = await request(app)
      .patch('/api/v1/providers/me')
      .set(headers)
      .send({ displayName: 'Ramesh Vishwakarma' })
      .expect(200);

    expect(named.body.profile.completeness.missingRequired).toEqual([]);
    expect(named.body.profile.isListed).toBe(true);
  });

  it('reports the missing checklist items so the app can nag precisely', async (ctx) => {
    if (!app) return ctx.skip();

    const session = await signInAsTechnician(app, PHONES.technician);
    const response = await request(app).get('/api/v1/providers/me').set(auth(session.accessToken));

    expect(response.status).toBe(200);
    const completeness = response.body.profile.completeness;

    expect(completeness.threshold).toBe(80);
    expect(completeness.missing).toEqual(
      expect.arrayContaining(['baseLocation', 'skills', 'priceCard', 'availability']),
    );
    // The blocking subset excludes the optional quality items.
    expect([...completeness.missingRequired].sort()).toEqual([
      'availability',
      'baseLocation',
      'priceCard',
      'skills',
    ]);
    expect(completeness.breakdown).toHaveLength(8);
    expect(completeness.breakdown.filter((e: { required: boolean }) => e.required)).toHaveLength(5);
  });
});

describe('Phase 3 — provider validation rules', () => {
  it('refuses a cluster category as a skill', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const session = await signInAsTechnician(app, PHONES.technician);
    const cluster = await context.prisma.category.findFirst({
      where: { cityId: 1, parentId: null },
    });

    const response = await request(app)
      .post('/api/v1/providers/me/skills')
      .set(auth(session.accessToken))
      .send({ categoryId: cluster?.id });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('CATEGORY_NOT_A_SERVICE');
  });

  it('refuses an unknown category', async (ctx) => {
    if (!app) return ctx.skip();

    const session = await signInAsTechnician(app, PHONES.technician);
    const response = await request(app)
      .post('/api/v1/providers/me/skills')
      .set(auth(session.accessToken))
      .send({ categoryId: 999999 });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('rejects overlapping availability on the same day', async (ctx) => {
    if (!app) return ctx.skip();

    const session = await signInAsTechnician(app, PHONES.technician);
    const headers = auth(session.accessToken);

    await request(app)
      .post('/api/v1/providers/me/availability')
      .set(headers)
      .send({ dayOfWeek: 3, startTime: '09:00', endTime: '13:00' })
      .expect(201);

    const overlapping = await request(app)
      .post('/api/v1/providers/me/availability')
      .set(headers)
      .send({ dayOfWeek: 3, startTime: '12:00', endTime: '17:00' });

    expect(overlapping.status).toBe(409);
    expect(overlapping.body.error.code).toBe('AVAILABILITY_OVERLAP');
    expect(overlapping.body.error.details.conflictsWith).toEqual({
      dayOfWeek: 3,
      startTime: '09:00',
      endTime: '13:00',
    });
  });

  it('allows back-to-back windows and the same hours on another day', async (ctx) => {
    if (!app) return ctx.skip();

    const session = await signInAsTechnician(app, PHONES.technician);
    const headers = auth(session.accessToken);

    await request(app)
      .post('/api/v1/providers/me/availability')
      .set(headers)
      .send({ dayOfWeek: 3, startTime: '09:00', endTime: '13:00' })
      .expect(201);

    await request(app)
      .post('/api/v1/providers/me/availability')
      .set(headers)
      .send({ dayOfWeek: 3, startTime: '13:00', endTime: '17:00' })
      .expect(201);

    await request(app)
      .post('/api/v1/providers/me/availability')
      .set(headers)
      .send({ dayOfWeek: 4, startTime: '09:00', endTime: '13:00' })
      .expect(201);
  });

  it('rejects an overnight window with a message explaining the workaround', async (ctx) => {
    if (!app) return ctx.skip();

    const session = await signInAsTechnician(app, PHONES.technician);

    const response = await request(app)
      .post('/api/v1/providers/me/availability')
      .set(auth(session.accessToken))
      .set('Accept-Language', 'en')
      .send({ dayOfWeek: 5, startTime: '22:00', endTime: '02:00' });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/one entry per day/i);
  });

  it('requires an amount for a fixed price and forbids one for inspection-based', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const session = await signInAsTechnician(app, PHONES.technician);
    const headers = auth(session.accessToken);
    const leaf = await context.prisma.category.findFirst({
      where: { cityId: 1, parentId: { not: null } },
    });

    await request(app)
      .post('/api/v1/providers/me/price-cards')
      .set(headers)
      .send({ categoryId: leaf?.id, title: 'No amount', priceType: 'fixed' })
      .expect(400);

    await request(app)
      .post('/api/v1/providers/me/price-cards')
      .set(headers)
      .send({
        categoryId: leaf?.id,
        title: 'Amount not allowed',
        priceType: 'inspection_based',
        amountPaise: 10000,
      })
      .expect(400);

    await request(app)
      .post('/api/v1/providers/me/price-cards')
      .set(headers)
      .send({ categoryId: leaf?.id, title: 'Inspection', priceType: 'inspection_based' })
      .expect(201);
  });

  it('rejects a service radius beyond 25 km', async (ctx) => {
    if (!app) return ctx.skip();

    const session = await signInAsTechnician(app, PHONES.technician);

    await request(app)
      .patch('/api/v1/providers/me')
      .set(auth(session.accessToken))
      .send({ serviceRadiusKm: 40 })
      .expect(400);
  });
});

describe('Phase 3 — carry-over: instant revocation', () => {
  it('rejects a still-valid access token the moment the user is blocked', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const session = await signIn(app, PHONES.blocked);
    const headers = auth(session.accessToken);

    // The token works right up until the block.
    await request(app).get('/api/v1/auth/me').set(headers).expect(200);

    await blockUser({ context, transport: context.otpTransport }, session.user.id);

    // Same token, same second — now refused, without waiting 15 minutes.
    const afterBlock = await request(app)
      .get('/api/v1/auth/me')
      .set(headers)
      .set('Accept-Language', 'en');

    expect(afterBlock.status).toBe(401);
    expect(afterBlock.body.error.code).toBe('AUTH_SESSION_REVOKED');
    expect(afterBlock.body.error.message).toMatch(/withdrawn/i);
  });

  it('blocks every protected route, not just /me', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const session = await signIn(app, PHONES.blocked);
    await blockUser({ context, transport: context.otpTransport }, session.user.id);

    await request(app)
      .get('/api/v1/customers/me/addresses')
      .set(auth(session.accessToken))
      .expect(401);
  });

  it('revokes refresh tokens too, so a blocked user cannot mint a new pair', async (ctx) => {
    if (!app || !context) return ctx.skip();

    await request(app).post('/api/v1/auth/otp/request').send({ phone: PHONES.blocked });
    const verified = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: PHONES.blocked, otp: FIXED_OTP, deviceId: DEVICE });

    await blockUser({ context, transport: context.otpTransport }, verified.body.user.id);

    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: verified.body.refreshToken, deviceId: DEVICE });

    expect(refreshed.status).toBe(401);
  });

  it('restores access on unblock', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const session = await signIn(app, PHONES.blocked);
    const deps = { context, transport: context.otpTransport };

    await blockUser(deps, session.user.id);
    await request(app).get('/api/v1/auth/me').set(auth(session.accessToken)).expect(401);

    await unblockUser(deps, session.user.id);

    // The old token works again; refresh tokens stay revoked by design, so a
    // fresh sign-in is still required once it expires.
    await request(app).get('/api/v1/auth/me').set(auth(session.accessToken)).expect(200);
  });

  it('leaves other users untouched', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const blocked = await signIn(app, PHONES.blocked, 'device-blocked');
    const healthy = await signIn(app, PHONES.customerA, 'device-healthy');

    await blockUser({ context, transport: context.otpTransport }, blocked.user.id);

    await request(app).get('/api/v1/auth/me').set(auth(healthy.accessToken)).expect(200);
  });
});

describe('Phase 3 — seeded fixtures', () => {
  it('has 20 seeded technicians with 17 listed', async (ctx) => {
    if (!context) return ctx.skip();

    const total = await context.prisma.providerProfile.count();
    const listed = await context.prisma.providerProfile.count({ where: { isListed: true } });

    expect(total).toBeGreaterThanOrEqual(20);
    expect(listed).toBeGreaterThanOrEqual(17);
  });

  it('stores every listed technician’s base location as a real point', async (ctx) => {
    if (!context) return ctx.skip();

    const rows = await context.prisma.$queryRaw<{ lat: number; lng: number }[]>`
      SELECT ST_Y(base_location::geometry) AS lat, ST_X(base_location::geometry) AS lng
      FROM provider_profiles
      WHERE is_listed = true AND base_location IS NOT NULL
    `;

    expect(rows.length).toBeGreaterThanOrEqual(17);
    for (const row of rows) {
      expect(row.lat).toBeGreaterThan(23);
      expect(row.lat).toBeLessThan(23.3);
      expect(row.lng).toBeGreaterThan(79.8);
      expect(row.lng).toBeLessThan(80.1);
    }
  });

  it('covers all five clusters with seeded skills', async (ctx) => {
    if (!context) return ctx.skip();

    const clusters = await context.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT parent.id) AS count
      FROM provider_skills ps
      JOIN categories child ON child.id = ps.category_id
      JOIN categories parent ON parent.id = child.parent_id
    `;

    expect(Number(clusters[0]?.count ?? 0)).toBe(5);
  });
});

/* -------------------------------------------------------------------------- */
/* Phase 12 — the public profile and the owner's own calendar                 */
/* -------------------------------------------------------------------------- */

describe('Phase 12 — the public provider profile', () => {
  /**
   * Added because the web app made an old assumption obviously wrong: until
   * Phase 12 a customer could only see a technician by searching for one, which
   * breaks the moment somebody forwards a link — and a forwarded WhatsApp link
   * is the pilot's entire distribution story.
   */
  const listedProvider = async (): Promise<string | null> => {
    const row = await (context as AppContext).prisma.providerProfile.findFirst({
      where: {
        isListed: true,
        user: { status: 'active' },
        verification: { badge: { in: ['VERIFIED', 'SILVER', 'GOLD'] } },
        OR: [{ suspendedUntil: null }, { suspendedUntil: { lte: new Date() } }],
      },
      select: { userId: true },
    });

    return row?.userId ?? null;
  };

  it('serves a profile to a stranger with no token at all', async () => {
    if (unavailableReason || !context || !app) return;

    const providerId = await listedProvider();
    if (!providerId) return;

    const response = await request(app).get(`/api/v1/providers/${providerId}`).expect(200);

    const profile = response.body.profile as Record<string, unknown>;

    expect(profile.providerId).toBe(providerId);
    expect(profile.badge).toMatch(/VERIFIED|SILVER|GOLD/);
    expect(Array.isArray(profile.skills)).toBe(true);
  }, 45_000);

  /**
   * The same discretion search applies, on the endpoint that is easiest to
   * scrape: no point, no phone, and nothing about how close somebody is to
   * being listed.
   */
  it('leaks no coordinates, phone or completeness internals', async () => {
    if (unavailableReason || !context || !app) return;

    const providerId = await listedProvider();
    if (!providerId) return;

    const response = await request(app).get(`/api/v1/providers/${providerId}`).expect(200);
    const serialised = JSON.stringify(response.body);

    for (const forbidden of [
      'baseLocation',
      'base_location',
      'latitude',
      'longitude',
      'phone',
      'completenessScore',
      'completeness',
      'serviceRadiusKm',
    ]) {
      expect(serialised, `public profile leaked "${forbidden}"`).not.toContain(forbidden);
    }

    // A ten-digit run would be a phone number however it got there.
    expect(/\d{10}/.test(serialised)).toBe(false);
  }, 45_000);

  /**
   * A profile page that rendered somebody search refuses to show would be a way
   * around the gates — and the 404 is deliberately the same for "suspended" as
   * for "never existed", so the status code cannot be used to discover that a
   * particular technician is in trouble.
   */
  it('hides a suspended technician behind the same 404 as a stranger', async () => {
    if (unavailableReason || !context || !app) return;

    const suspended = await context.prisma.providerProfile.findFirst({
      where: { suspendedUntil: { gt: new Date() } },
      select: { userId: true },
    });

    if (!suspended) return;

    await request(app).get(`/api/v1/providers/${suspended.userId}`).expect(404);
    await request(app).get('/api/v1/providers/00000000-0000-4000-8000-000000000000').expect(404);
  }, 45_000);

  /**
   * The regression this route nearly caused.
   *
   * `/:providerId` is declared before the technician's own routes, so without a
   * uuid pattern in the path it would capture `/providers/me` and reject it as a
   * malformed id — breaking every technician's own profile. Zod validation after
   * the match is too late; the pattern has to stop the match.
   */
  it('does not swallow /providers/me', async () => {
    if (unavailableReason || !app) return;

    // 401, not 400: it reached the authenticated route rather than the public one.
    await request(app).get('/api/v1/providers/me').expect(401);
  }, 30_000);
});
