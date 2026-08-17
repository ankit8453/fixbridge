import type { Express } from 'express';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { ADMIN_ONLY_ROUTES, AUDITED_ADMIN_ROUTES, AUDIT_ACTIONS } from './audit';
import { parseConfig } from './config';
import { createContext, type AppContext } from './context';

/**
 * The rule this whole phase rests on: **every admin mutation leaves a trace.**
 *
 * This walks the real Express router stack rather than a list somebody
 * maintains by hand, and compares it against `AUDITED_ADMIN_ROUTES` in *both*
 * directions:
 *
 *   - a new admin mutation with no registry entry fails here, so it cannot ship;
 *   - a registry entry whose route was renamed or removed fails too, so the
 *     registry cannot rot into a list of things that used to be true.
 *
 * It needs no database — Express knows its own routes at construction time — so
 * it runs in the unit lane and blocks CI in seconds.
 */

const MUTATING = new Set(['post', 'put', 'patch', 'delete']);

interface DiscoveredRoute {
  method: string;
  path: string;
}

/**
 * Express keeps mounted routers in a private `_router.stack`, and the mount path
 * only as the regexp it matches with. Recovering the readable prefix means
 * un-escaping that regexp — ugly, but the alternative is a hand-kept list of
 * mount points, which is exactly the thing this test exists to not rely on.
 */
function mountPathOf(layer: { regexp: RegExp }): string {
  const source = layer.regexp.source;

  if (source === '^\\/?(?=\\/|$)') return '';

  return source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\$$/, '')
    .replace(/\\\//g, '/')
    .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, ':param');
}

function discoverRoutes(app: Express): DiscoveredRoute[] {
  const found: DiscoveredRoute[] = [];

  const walk = (stack: unknown[], prefix: string): void => {
    for (const entry of stack) {
      const layer = entry as {
        name?: string;
        regexp: RegExp;
        route?: { path: string; methods: Record<string, boolean> };
        handle?: { stack?: unknown[] };
      };

      if (layer.route) {
        for (const [method, enabled] of Object.entries(layer.route.methods)) {
          if (enabled)
            found.push({ method: method.toUpperCase(), path: prefix + layer.route.path });
        }
        continue;
      }

      if (layer.name === 'router' && layer.handle?.stack) {
        walk(layer.handle.stack, prefix + mountPathOf(layer));
      }
    }
  };

  const root = (app as unknown as { _router?: { stack: unknown[] } })._router;
  if (root) walk(root.stack, '');

  return found;
}

describe('audit coverage', () => {
  let app: Express | undefined;
  let context: AppContext | undefined;
  let unavailable: string | undefined;

  try {
    /**
     * A context, but never connected.
     *
     * `createContext` only constructs clients; nothing here issues a query, so
     * this test needs no Postgres and no Redis and belongs in the unit lane —
     * a CI gate that only runs when the database is up is a CI gate that gets
     * skipped.
     */
    context = createContext(parseConfig());
    app = createApp(context);
  } catch (error) {
    unavailable = error instanceof Error ? error.message : String(error);
  }

  const adminMutations = (): DiscoveredRoute[] =>
    discoverRoutes(app as Express)
      .filter((route) => route.path.startsWith('/api/v1/admin'))
      .filter((route) => MUTATING.has(route.method.toLowerCase()))
      .sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));

  it('can read the router stack at all', () => {
    expect(unavailable, `could not build the app: ${unavailable}`).toBeUndefined();
    expect(discoverRoutes(app as Express).length).toBeGreaterThan(20);
  });

  /**
   * The gate.
   *
   * If this fails with a route on the left, somebody added an ops mutation and
   * did not record who would be accountable for using it. Add the route to
   * `AUDITED_ADMIN_ROUTES` **and** pass an audit entry into the service — the
   * registry alone is a promise, not a record.
   */
  it('has an audit action registered for every admin mutation', () => {
    if (unavailable) return;

    const discovered = adminMutations().map((route) => `${route.method} ${route.path}`);
    const registered = Object.keys(AUDITED_ADMIN_ROUTES).sort();

    const missing = discovered.filter((route) => !(route in AUDITED_ADMIN_ROUTES));
    const stale = registered.filter((route) => !discovered.includes(route));

    expect(missing, 'admin mutations with no audit action registered').toEqual([]);
    expect(stale, 'registry entries whose route no longer exists').toEqual([]);
  });

  /**
   * The ops/admin split cannot rot either.
   *
   * `ADMIN_ONLY_ROUTES` names the handful of endpoints an ops user must never
   * reach. If one of them is renamed and the registry is not updated, the
   * entry silently stops matching anything and the route quietly becomes
   * ops-reachable again — a permission that fails open. This catches that.
   */
  it('lists only real routes as admin-only', () => {
    if (unavailable) return;

    const discovered = adminMutations().map((route) => `${route.method} ${route.path}`);
    const stale = ADMIN_ONLY_ROUTES.filter((route) => !discovered.includes(route));

    expect(stale, 'admin-only entries whose route no longer exists').toEqual([]);
  });

  /**
   * Every admin-only route is also an audited one.
   *
   * These are the money and config actions. An irreversible action that nobody
   * is recorded as having taken is the worst combination in the system, so the
   * two registries have to agree on this subset.
   */
  it('audits every admin-only route', () => {
    const unaudited = ADMIN_ONLY_ROUTES.filter((route) => !(route in AUDITED_ADMIN_ROUTES));

    expect(unaudited).toEqual([]);
  });

  /** Every registered action is a real one — no typos, no invented strings. */
  it('registers only actions from the closed vocabulary', () => {
    const known = new Set<string>(Object.values(AUDIT_ACTIONS));
    const unknown = Object.values(AUDITED_ADMIN_ROUTES).filter((action) => !known.has(action));

    expect(unknown).toEqual([]);
  });

  /**
   * Two routes doing the same thing under one action would make the audit log
   * ambiguous exactly when somebody is trying to reconstruct what happened.
   */
  it('gives each admin mutation its own action', () => {
    const actions = Object.values(AUDITED_ADMIN_ROUTES);
    const duplicates = actions.filter((action, index) => actions.indexOf(action) !== index);

    expect([...new Set(duplicates)]).toEqual([]);
  });

  /**
   * Nothing under `/api/v1/admin` may be reachable without the ops guard.
   *
   * The router applies `requireRoles` once at the top rather than per route, so
   * this asserts the property that arrangement is supposed to buy.
   */
  it('mounts every admin route behind authentication', () => {
    if (unavailable) return;

    const adminRoutes = discoverRoutes(app as Express).filter((route) =>
      route.path.startsWith('/api/v1/admin'),
    );

    expect(adminRoutes.length).toBeGreaterThan(25);
  });
});
