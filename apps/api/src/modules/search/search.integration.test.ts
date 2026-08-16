import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { parseConfig, type AppConfig } from '../../core/config';
import { createContext, disposeContext, type AppContext } from '../../core/context';
import { haversineMetres } from '../../core/geo';

/**
 * Phase 5 against the seeded dataset. The 20-provider distribution from Phases
 * 3–4 exists precisely so these gates can be proven: 17 listed, of which 12 are
 * VERIFIED, plus 3 unlisted.
 */
const WRIGHT_TOWN = { lat: 23.1618, lng: 79.9492 };
const VIJAY_NAGAR = { lat: 23.2172, lng: 79.9081 };

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
 * The next occurrence of an IST weekday, always at least a day away.
 *
 * These tests used to name fixed dates, which was fine while availability meant
 * weekly templates. Since Phase 6 it means **materialised slots**, and slots
 * only exist from now forward — so "Sunday the 16th" silently became a date
 * whose morning had already passed, and the test failed for a reason that had
 * nothing to do with search. Asking for the next one instead makes it true on
 * any day, at any hour.
 */
function nextIstWeekday(weekday: number): string {
  const IST_OFFSET_MS = 330 * 60 * 1000;
  const nowIst = new Date(Date.now() + IST_OFFSET_MS);

  // From tomorrow, so today's already-elapsed hours are never in scope.
  const candidate = new Date(nowIst.getTime() + 24 * 60 * 60 * 1000);

  while (candidate.getUTCDay() !== weekday) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  return candidate.toISOString().slice(0, 10);
}

/** Search is per-IP rate limited; every test starts from a clean budget. */
async function clearSearchLimit(ctx: AppContext): Promise<void> {
  const keys = await ctx.redis.keys('search:rate:ip:*');
  if (keys.length > 0) await ctx.redis.del(...keys);
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
  if (context && !unavailableReason) {
    await clearSearchLimit(context);
    // Category counts are cached; a stale entry would make assertions flaky.
    await context.redis.del('search:category-counts:1');
  }
});

afterAll(async () => {
  if (context && !unavailableReason) await clearSearchLimit(context);
  if (context) await disposeContext(context);
});

const SKIP = (reason: string) =>
  `[skipped] Phase 5 search tests — ${reason}. Start the services with \`docker compose up -d\` and rerun.`;

const search = (server: Express, params: Record<string, string | number>) => {
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)] as [string, string]),
  ).toString();

  return request(server).get(`/api/v1/search/providers?${query}`).set('Accept-Language', 'en');
};

interface Card {
  providerId: string;
  displayName: string | null;
  badge: string;
  distanceKm: number;
  startingPrice: { amountPaise: number } | null;
  skills: { slug: string }[];
}

describe('Phase 5 — the trust gates', () => {
  it('returns exactly the verified, listed, active providers', async (ctx) => {
    if (!app || !context) {
      console.warn(SKIP(unavailableReason ?? 'unknown'));
      ctx.skip();
      return;
    }

    const response = await search(app, { ...WRIGHT_TOWN, page_size: 25 });

    expect(response.status).toBe(200);

    const returned = new Set((response.body.results as Card[]).map((card) => card.providerId));

    const expected = await context.prisma.providerProfile.findMany({
      where: {
        isListed: true,
        user: { status: 'active' },
        verification: { badge: { in: ['VERIFIED', 'SILVER', 'GOLD'] } },
      },
      select: { userId: true },
    });

    expect(expected.length).toBe(12);
    expect(returned.size).toBe(12);
    for (const profile of expected) {
      expect(returned.has(profile.userId), `expected ${profile.userId}`).toBe(true);
    }
  });

  /**
   * The marketplace's promise lives here. No parameter combination may surface a
   * provider who is incomplete, unverified or blocked.
   */
  it('never surfaces an unlisted or unverified provider, under any parameters', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const forbidden = await context.prisma.providerProfile.findMany({
      where: {
        OR: [
          { isListed: false },
          { verification: null },
          { verification: { badge: 'NONE' } },
          { user: { status: { not: 'active' } } },
        ],
      },
      select: { userId: true },
    });

    // 3 unlisted + 3 mid-pipeline + 2 never started.
    expect(forbidden.length).toBe(8);
    const forbiddenIds = new Set(forbidden.map((p) => p.userId));

    const combinations: Record<string, string | number>[] = [
      { ...WRIGHT_TOWN },
      { ...VIJAY_NAGAR },
      { ...WRIGHT_TOWN, max_distance_km: 25 },
      { ...WRIGHT_TOWN, sort: 'distance' },
      { ...WRIGHT_TOWN, sort: 'price_low' },
      { ...WRIGHT_TOWN, category_id: 1 },
      { ...WRIGHT_TOWN, date: '2026-08-18', start_time: '09:00', end_time: '10:00' },
      { ...WRIGHT_TOWN, page: 2, page_size: 25 },
    ];

    for (const params of combinations) {
      await clearSearchLimit(context);
      const response = await search(app, { ...params, page_size: 25 });

      expect(response.status, JSON.stringify(params)).toBe(200);

      for (const card of response.body.results as Card[]) {
        expect(
          forbiddenIds.has(card.providerId),
          `${card.displayName} leaked with ${JSON.stringify(params)}`,
        ).toBe(false);
        expect(card.badge).not.toBe('NONE');
      }
    }
  });

  it('drops a provider the moment their user is blocked', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const before = await search(app, { ...WRIGHT_TOWN, page_size: 25 });
    const victim = (before.body.results as Card[])[0];
    expect(victim).toBeDefined();

    await context.prisma.user.update({
      where: { id: victim?.providerId },
      data: { status: 'blocked' },
    });

    try {
      await clearSearchLimit(context);
      const after = await search(app, { ...WRIGHT_TOWN, page_size: 25 });
      const ids = (after.body.results as Card[]).map((card) => card.providerId);

      expect(ids).not.toContain(victim?.providerId);
      expect(after.body.total).toBe(before.body.total - 1);
    } finally {
      await context.prisma.user.update({
        where: { id: victim?.providerId },
        data: { status: 'active' },
      });
    }
  });

  it('drops a provider the moment their profile becomes incomplete', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const before = await search(app, { ...WRIGHT_TOWN, page_size: 25 });
    const victim = (before.body.results as Card[])[0];

    await context.prisma.providerProfile.update({
      where: { userId: victim?.providerId },
      data: { isListed: false },
    });

    try {
      await clearSearchLimit(context);
      const after = await search(app, { ...WRIGHT_TOWN, page_size: 25 });

      expect((after.body.results as Card[]).map((c) => c.providerId)).not.toContain(
        victim?.providerId,
      );
    } finally {
      await context.prisma.providerProfile.update({
        where: { userId: victim?.providerId },
        data: { isListed: true },
      });
    }
  });
});

describe('Phase 5 — geography', () => {
  it('respects each provider’s own radius, not a platform-wide one', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const response = await search(app, { ...VIJAY_NAGAR, page_size: 25 });
    const returned = new Set((response.body.results as Card[]).map((card) => card.providerId));

    // Recompute membership independently from the stored point and radius.
    const rows = await context.prisma.$queryRaw<
      { userId: string; lat: number; lng: number; radius: number; listed: boolean; badge: string }[]
    >`
      SELECT pp.user_id AS "userId",
             ST_Y(pp.base_location::geometry) AS lat,
             ST_X(pp.base_location::geometry) AS lng,
             pp.service_radius_km AS radius,
             pp.is_listed AS listed,
             COALESCE(pvs.badge::text, 'NONE') AS badge
      FROM provider_profiles pp
      LEFT JOIN provider_verification_summaries pvs ON pvs.provider_id = pp.user_id
      WHERE pp.base_location IS NOT NULL
    `;

    let checked = 0;

    for (const row of rows) {
      if (!row.listed || row.badge === 'NONE') continue;

      const km = haversineMetres(VIJAY_NAGAR, { lat: row.lat, lng: row.lng }) / 1000;
      const margin = Math.abs(km - row.radius);

      // Skip anyone within 500 m of their own boundary: haversine is a sphere
      // and PostGIS is a spheroid, and near the edge they can disagree.
      if (margin < 0.5) continue;

      checked += 1;
      expect(
        returned.has(row.userId),
        `${row.userId} at ${km.toFixed(2)}km, radius ${row.radius}`,
      ).toBe(km < row.radius);
    }

    // The assertion is worthless if it checked nothing.
    expect(checked).toBeGreaterThan(6);
  });

  it('excludes a provider whose radius cannot reach, while a wider one appears', async (ctx) => {
    if (!app) return ctx.skip();

    const response = await search(app, { ...VIJAY_NAGAR, page_size: 25 });
    const names = (response.body.results as Card[]).map((card) => card.displayName);

    // Golu Rajak: Sadar, 3 km radius, ~4.8 km from Vijay Nagar.
    expect(names).not.toContain('Golu Rajak');
    // Imran Ansari: Adhartal, 15 km radius, ~2.3 km away.
    expect(names).toContain('Imran Ansari');
  });

  it('applies the customer cap on top of the provider radius', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const uncapped = await search(app, { ...WRIGHT_TOWN, page_size: 25 });
    const far = (uncapped.body.results as Card[]).filter((card) => card.distanceKm > 5);

    expect(far.length).toBeGreaterThan(0);

    await clearSearchLimit(context);
    const capped = await search(app, { ...WRIGHT_TOWN, max_distance_km: 5, page_size: 25 });
    const cappedIds = new Set((capped.body.results as Card[]).map((card) => card.providerId));

    for (const card of far) {
      expect(cappedIds.has(card.providerId), `${card.displayName} at ${card.distanceKm}km`).toBe(
        false,
      );
    }

    for (const card of capped.body.results as Card[]) {
      expect(card.distanceKm).toBeLessThanOrEqual(5);
    }
  });

  it('reports distances that match an independent haversine calculation', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const response = await search(app, { ...WRIGHT_TOWN, sort: 'distance', page_size: 25 });

    for (const card of response.body.results as Card[]) {
      const row = await context.prisma.$queryRaw<{ lat: number; lng: number }[]>`
        SELECT ST_Y(base_location::geometry) AS lat, ST_X(base_location::geometry) AS lng
        FROM provider_profiles WHERE user_id = ${card.providerId}::uuid
      `;

      const point = row[0];
      if (!point) continue;

      const expectedKm = haversineMetres(WRIGHT_TOWN, point) / 1000;
      // 2% for sphere-vs-spheroid, plus 0.1 for the rounding we apply on purpose.
      expect(Math.abs(card.distanceKm - expectedKm)).toBeLessThan(expectedKm * 0.02 + 0.11);
    }
  });

  it('never exposes the provider’s coordinates', async (ctx) => {
    if (!app) return ctx.skip();

    const response = await search(app, { ...WRIGHT_TOWN, page_size: 25 });
    const body = JSON.stringify(response.body);

    // A technician's home is not public data. Distance is enough to choose by.
    expect(body).not.toMatch(/"lat"/);
    expect(body).not.toMatch(/"lng"/);
    expect(body).not.toMatch(/baseLocation/);
    expect(body).not.toMatch(/"phone"/);
    expect(body).not.toMatch(/completenessScore/);
  });

  it('rounds distance to 0.1 km', async (ctx) => {
    if (!app) return ctx.skip();

    const response = await search(app, { ...WRIGHT_TOWN, page_size: 25 });

    for (const card of response.body.results as Card[]) {
      expect(Math.round(card.distanceKm * 10) / 10).toBe(card.distanceKm);
    }
  });
});

describe('Phase 5 — filters', () => {
  it('filters by leaf category', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const leaf = await context.prisma.category.findFirst({
      where: { cityId: 1, slug: 'motor-rewinding' },
    });

    const response = await search(app, {
      ...WRIGHT_TOWN,
      category_id: leaf?.id ?? 0,
      page_size: 25,
    });

    expect(response.body.results.length).toBeGreaterThan(0);
    for (const card of response.body.results as Card[]) {
      expect(card.skills.map((s) => s.slug)).toContain('motor-rewinding');
    }
  });

  it('a cluster includes every service beneath it', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const cluster = await context.prisma.category.findFirst({
      where: { cityId: 1, slug: 'electrical' },
    });
    const leaf = await context.prisma.category.findFirst({
      where: { cityId: 1, slug: 'house-wiring' },
    });

    const clusterResults = await search(app, {
      ...WRIGHT_TOWN,
      category_id: cluster?.id ?? 0,
      page_size: 25,
    });

    await clearSearchLimit(context);
    const leafResults = await search(app, {
      ...WRIGHT_TOWN,
      category_id: leaf?.id ?? 0,
      page_size: 25,
    });

    expect(clusterResults.body.results.length).toBeGreaterThanOrEqual(
      leafResults.body.results.length,
    );

    const clusterIds = new Set((clusterResults.body.results as Card[]).map((c) => c.providerId));
    for (const card of leafResults.body.results as Card[]) {
      expect(clusterIds.has(card.providerId)).toBe(true);
    }
  });

  /**
   * A slot must **fully cover** the requested window. Partial overlap is not
   * availability — a technician free 18:00–20:00 cannot take a 19:00–21:00 job.
   */
  it('matches only templates that fully cover the requested window', async (ctx) => {
    if (!app || !context) return ctx.skip();

    // 2026-08-18 is a Tuesday. Part-timers work weekday evenings 18:00–22:00.
    const covered = await search(app, {
      ...WRIGHT_TOWN,
      date: nextIstWeekday(2),
      start_time: '19:00',
      end_time: '20:00',
      page_size: 25,
    });

    expect(covered.status).toBe(200);
    expect(covered.body.results.length).toBeGreaterThan(0);

    await clearSearchLimit(context);

    // 21:00–23:00 runs past every seeded window.
    const uncovered = await search(app, {
      ...WRIGHT_TOWN,
      date: nextIstWeekday(2),
      start_time: '21:00',
      end_time: '23:00',
      page_size: 25,
    });

    expect(uncovered.body.results.length).toBe(0);
  });

  it('excludes a Sunday-only provider from a Tuesday request', async (ctx) => {
    if (!app || !context) return ctx.skip();

    // Golu Rajak works weekends only (days 0 and 6).
    const tuesday = await search(app, {
      ...WRIGHT_TOWN,
      date: nextIstWeekday(2),
      start_time: '10:00',
      end_time: '11:00',
      page_size: 25,
    });

    expect((tuesday.body.results as Card[]).map((c) => c.displayName)).not.toContain('Golu Rajak');

    await clearSearchLimit(context);

    const sunday = await search(app, {
      ...WRIGHT_TOWN,
      date: nextIstWeekday(0),
      start_time: '10:00',
      end_time: '11:00',
      page_size: 25,
    });

    expect((sunday.body.results as Card[]).map((c) => c.displayName)).toContain('Golu Rajak');
  });

  it('requires the availability trio together', async (ctx) => {
    if (!app) return ctx.skip();

    const response = await search(app, { ...WRIGHT_TOWN, date: '2026-08-18' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an end time at or before the start', async (ctx) => {
    if (!app) return ctx.skip();

    const response = await search(app, {
      ...WRIGHT_TOWN,
      date: nextIstWeekday(2),
      start_time: '19:00',
      end_time: '19:00',
    });

    expect(response.status).toBe(400);
  });

  it('rejects a missing location and an out-of-range cap', async (ctx) => {
    if (!app) return ctx.skip();

    expect((await search(app, { lat: 23.16 })).status).toBe(400);
    expect((await search(app, { ...WRIGHT_TOWN, max_distance_km: 999 })).status).toBe(400);
  });
});

describe('Phase 5 — sorting and pagination', () => {
  it('sorts by distance, ascending', async (ctx) => {
    if (!app) return ctx.skip();

    const response = await search(app, { ...WRIGHT_TOWN, sort: 'distance', page_size: 25 });
    const distances = (response.body.results as Card[]).map((card) => card.distanceKm);

    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it('sorts by price, cheapest first, with unpriced providers last', async (ctx) => {
    if (!app) return ctx.skip();

    const response = await search(app, { ...WRIGHT_TOWN, sort: 'price_low', page_size: 25 });
    const prices = (response.body.results as Card[]).map(
      (card) => card.startingPrice?.amountPaise ?? Number.POSITIVE_INFINITY,
    );

    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('is deterministic — the same query returns the same order three times', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const orders: string[][] = [];

    for (let run = 0; run < 3; run += 1) {
      await clearSearchLimit(context);
      const response = await search(app, { ...WRIGHT_TOWN, page_size: 25 });
      orders.push((response.body.results as Card[]).map((card) => card.providerId));
    }

    expect(orders[1]).toEqual(orders[0]);
    expect(orders[2]).toEqual(orders[0]);
  });

  it('paginates without overlap or gaps', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const first = await search(app, { ...WRIGHT_TOWN, page: 1, page_size: 5 });
    await clearSearchLimit(context);
    const second = await search(app, { ...WRIGHT_TOWN, page: 2, page_size: 5 });
    await clearSearchLimit(context);
    const all = await search(app, { ...WRIGHT_TOWN, page: 1, page_size: 25 });

    const firstIds = (first.body.results as Card[]).map((c) => c.providerId);
    const secondIds = (second.body.results as Card[]).map((c) => c.providerId);
    const allIds = (all.body.results as Card[]).map((c) => c.providerId);

    expect(firstIds).toHaveLength(5);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(firstIds.length + secondIds.length);
    expect([...firstIds, ...secondIds]).toEqual(
      allIds.slice(0, firstIds.length + secondIds.length),
    );
    expect(first.body.total).toBe(12);
  });
});

describe('Phase 5 — Hinglish resolution', () => {
  const resolve = (server: Express, q: string) =>
    request(server)
      .get(`/api/v1/search/resolve?q=${encodeURIComponent(q)}`)
      .set('Accept-Language', 'en');

  it('resolves the same phrase across scripts and cases', async (ctx) => {
    if (!app || !context) return ctx.skip();

    for (const q of ['motor jal gayi', 'मोटर जल गई', 'MOTOR JAL GAYI', '  Motor Jal Gayi  ']) {
      await clearSearchLimit(context);
      const response = await resolve(app, q);

      expect(response.status, q).toBe(200);
      expect(response.body.suggestions[0]?.slug, q).toBe('motor-rewinding');
      expect(response.body.suggestions[0]?.matchReason, q).toBe('synonym_exact');
    }
  });

  it('resolves a misspelling through trigram similarity', async (ctx) => {
    if (!app) return ctx.skip();

    const response = await resolve(app, 'moter jal gai');

    expect(response.status).toBe(200);
    expect(response.body.suggestions[0]?.slug).toBe('motor-rewinding');
    expect(response.body.suggestions[0]?.matchReason).toBe('synonym_fuzzy');
    expect(response.body.suggestions[0]?.confidence).toBeLessThan(1);
  });

  it('resolves a partly-typed phrase', async (ctx) => {
    if (!app) return ctx.skip();

    const response = await resolve(app, 'nal tapak');
    const slugs = (response.body.suggestions as { slug: string }[]).map((s) => s.slug);

    expect(slugs).toContain('leakage-repair');
  });

  it('returns localised names', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const english = await resolve(app, 'ac thanda nahi');
    expect(english.body.suggestions[0]?.name).toBe('AC service & gas refill');

    await clearSearchLimit(context);
    const hindi = await request(app)
      .get('/api/v1/search/resolve?q=ac%20thanda%20nahi')
      .set('Accept-Language', 'hi');

    expect(hindi.body.suggestions[0]?.name).toBe('एसी सर्विस और गैस रिफिल');
  });

  it('covers all five clusters', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const probes: [string, string][] = [
      ['current nahi hai', 'house-wiring'],
      ['motor jal gayi', 'motor-rewinding'],
      ['nal tapak raha', 'leakage-repair'],
      ['ac thanda nahi', 'ac-service-gas-refill'],
      ['bike kharab', 'two-wheeler-doorstep'],
    ];

    for (const [q, slug] of probes) {
      await clearSearchLimit(context);
      const response = await resolve(app, q);
      expect(
        (response.body.suggestions as { slug: string }[]).map((s) => s.slug),
        q,
      ).toContain(slug);
    }
  });

  it('returns an empty list for nonsense, gracefully', async (ctx) => {
    if (!app) return ctx.skip();

    const response = await resolve(app, 'zzzzqqq xyzzy plugh');

    expect(response.status).toBe(200);
    expect(response.body.suggestions).toEqual([]);
  });

  it('reports the normalised form it searched with', async (ctx) => {
    if (!app) return ctx.skip();

    const response = await resolve(app, '  MOTOR Jal Gayi!  ');

    expect(response.body.normalizedQuery).toBe('motor jal gayi');
  });

  it('rejects an empty or oversized query', async (ctx) => {
    if (!app || !context) return ctx.skip();

    expect((await resolve(app, '   ')).status).toBe(400);
    await clearSearchLimit(context);
    expect((await resolve(app, 'x'.repeat(200))).status).toBe(400);
  });
});

describe('Phase 5 — category provider counts', () => {
  it('reports searchable providers per category and sums them per cluster', async (ctx) => {
    if (!app) return ctx.skip();

    const response = await request(app).get('/api/v1/categories').set('Accept-Language', 'en');

    expect(response.status).toBe(200);

    const clusters = response.body.categories as {
      slug: string;
      providerCount: number;
      children: { slug: string; providerCount: number }[];
    }[];

    for (const cluster of clusters) {
      const childSum = cluster.children.reduce((sum, child) => sum + child.providerCount, 0);
      expect(cluster.providerCount, cluster.slug).toBe(childSum);
    }

    const electrical = clusters.find((c) => c.slug === 'electrical');
    expect(electrical?.providerCount).toBeGreaterThan(0);
  });

  it('counts only providers search would actually return', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const categories = await request(app).get('/api/v1/categories');
    const clusters = categories.body.categories as {
      children: { id: number; slug: string; providerCount: number }[];
    }[];

    const leaf = clusters
      .flatMap((cluster) => cluster.children)
      .find((child) => child.providerCount > 0);

    expect(leaf).toBeDefined();

    await clearSearchLimit(context);
    const results = await search(app, {
      ...WRIGHT_TOWN,
      category_id: leaf?.id ?? 0,
      max_distance_km: 25,
      page_size: 25,
    });

    // Search is also distance-limited, so it can return fewer — never more.
    expect(results.body.total).toBeLessThanOrEqual(leaf?.providerCount ?? 0);
  });
});

describe('Phase 5 — public endpoint rate limiting', () => {
  it('returns 429 past the per-minute threshold', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const limit = context.config.SEARCH_RATE_LIMIT_PER_MINUTE;
    let blocked: { status: number; body: { error: { code: string } } } | undefined;

    for (let i = 0; i < limit + 2; i += 1) {
      const response = await search(app, WRIGHT_TOWN);
      if (response.status === 429) {
        blocked = response;
        break;
      }
    }

    expect(blocked?.status).toBe(429);
    expect(blocked?.body.error.code).toBe('RATE_LIMITED');
  }, 30_000);

  it('rate limits the resolve endpoint too', async (ctx) => {
    if (!app || !context) return ctx.skip();

    const limit = context.config.SEARCH_RATE_LIMIT_PER_MINUTE;
    let status = 200;

    for (let i = 0; i < limit + 2 && status !== 429; i += 1) {
      status = (await request(app).get('/api/v1/search/resolve?q=bijli')).status;
    }

    expect(status).toBe(429);
  }, 30_000);

  it('needs no authentication', async (ctx) => {
    if (!app) return ctx.skip();

    // No Authorization header anywhere in this suite — that is the point.
    expect((await search(app, WRIGHT_TOWN)).status).toBe(200);
  });
});

describe('Phase 5 — index usage', () => {
  it('uses the GIST index when the planner is not distracted by a tiny table', async (ctx) => {
    if (!context) return ctx.skip();

    /**
     * At 20 rows Postgres correctly prefers a sequential scan, so a plain
     * EXPLAIN proves nothing about the index. Disabling seq scan shows the
     * planner *can* use it, which is what matters for real volume.
     */
    const plan = await context.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');

      const rows = await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`
        EXPLAIN (COSTS OFF)
        SELECT user_id FROM provider_profiles
        WHERE ST_DWithin(
          base_location,
          ST_SetSRID(ST_MakePoint(79.9492, 23.1618), 4326)::geography,
          8000
        )
      `);

      return rows.map((row) => row['QUERY PLAN']).join('\n');
    });

    expect(plan).toContain('provider_profiles_base_location_gist_idx');
  });
});
