import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/ui/Toast';
import { render, waitFor, type RenderResult } from '@testing-library/react';
import { expect, vi } from 'vitest';
import { type ReactNode } from 'react';

/**
 * The API, mocked at the `fetch` boundary. Keyed by `"METHOD path"` (path
 * only, no origin) — every call in this app now goes straight to
 * `API_BASE_URL` (no local proxy layer, see `lib/auth/session.ts`), so
 * matching on pathname alone is what lets the same table work regardless of
 * which base URL a given test environment configures. What these suites
 * risk getting wrong is *which* endpoint gets called with *what*
 * body/query/header — not whether `fetch` resolves — hence a route table
 * asserted against, not a bare `mockResolvedValue`.
 */

export interface RecordedCall {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  query: Record<string, string>;
  headers: Record<string, string>;
}

export interface MockResponse {
  status?: number;
  body?: unknown;
}

export type RouteHandler =
  MockResponse | ((call: RecordedCall) => MockResponse | Promise<MockResponse>);

export interface ApiMock {
  calls: RecordedCall[];
  callCount: (key: string) => number;
  lastCall: (key: string) => RecordedCall | undefined;
}

export function mockApi(routes: Record<string, RouteHandler>): ApiMock {
  const calls: RecordedCall[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const method = (init?.method ?? 'GET').toUpperCase();
      const headers = new Headers(init?.headers);

      const call: RecordedCall = {
        method,
        path: url.pathname,
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: Object.fromEntries(headers.entries()),
      };
      calls.push(call);

      const key = `${method} ${url.pathname}`;
      const handler = routes[key];

      if (!handler) {
        // Loud, not silent — an unmocked call means the test no longer
        // describes what the code under test actually does.
        throw new Error(`No mock for ${key}`);
      }

      const result = typeof handler === 'function' ? await handler(call) : handler;
      const status = result.status ?? 200;

      return new Response(JSON.stringify(result.body ?? {}), {
        status,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'test-request-id' },
      });
    }),
  );

  return {
    calls,
    callCount: (key) => {
      const [method, path] = key.split(' ');
      return calls.filter((call) => call.method === method && call.path === path).length;
    },
    lastCall: (key) => {
      const [method, path] = key.split(' ');
      return [...calls].reverse().find((call) => call.method === method && call.path === path);
    },
  };
}

/**
 * Waits for a request to land, so an assertion never races a mutation —
 * every mutation in this app fires a `fetch` from inside a promise chain
 * (an event handler, a TanStack mutation), which is a few microtasks behind
 * the `userEvent` call that triggered it.
 */
export async function waitForCall(api: ApiMock, key: string): Promise<RecordedCall> {
  let found: RecordedCall | undefined;

  await waitFor(() => {
    found = api.lastCall(key);
    expect(found).toBeDefined();
  });

  return found as RecordedCall;
}

/** A query client with retries/caching off — a component test should not wait out a backoff. */
export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

/**
 * Renders with a `QueryClientProvider` and a `ToastProvider` — the common case
 * for a component test that exercises a presentational/query-driven component
 * directly rather than a whole guarded route.
 *
 * The toast provider is here rather than in each test because `main.tsx`
 * mounts it above the router in the real app: any component may call
 * `useToast()`, so a harness without it would fail on a component that is
 * perfectly correct in production, and every new test would have to remember
 * a wrapper the app already guarantees.
 */
export function renderWithQuery(ui: ReactNode): RenderResult {
  return render(
    <QueryClientProvider client={testQueryClient()}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

/** A ready-made auth session response body, for handlers that issue a session. */
export function sessionBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tokenType: 'Bearer',
    accessToken: 'access-token-1',
    expiresIn: 900,
    refreshToken: 'refresh-token-1',
    refreshExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    user: {
      id: 'u1',
      phone: '+9198765*****',
      name: 'Test User',
      roles: ['customer'],
      status: 'active',
      defaultCityId: 1,
      preferredLanguage: 'hi',
      createdAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

export { expect };
