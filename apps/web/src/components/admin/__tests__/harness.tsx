import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor, type RenderResult } from '@testing-library/react';
import { expect, vi } from 'vitest';
import { type ReactNode } from 'react';

/**
 * The API, mocked at the fetch boundary. Ported from
 * apps/admin/src/test/harness.tsx — the technique is unchanged by the move
 * into Next.js, since `@/lib/api`'s `apiRequest` still ultimately calls the
 * global `fetch`.
 *
 * A route table keyed by `"METHOD /path"` rather than a chain of
 * `mockResolvedValue` calls, because these tests assert on *which* endpoint
 * was called with *what* body — the whole risk being covered is this
 * surface sending a well-formed request to the wrong place, or a malformed
 * one to the right place.
 */

export interface RecordedCall {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  query: Record<string, string>;
}

export interface MockResponse {
  status?: number;
  body?: unknown;
}

export type RouteHandler = MockResponse | ((call: RecordedCall) => MockResponse);

export interface ApiMock {
  calls: RecordedCall[];
  /** The last call to a given `"METHOD /path"`, for asserting on a request body. */
  lastCall: (key: string) => RecordedCall | undefined;
}

export function mockApi(routes: Record<string, RouteHandler>): ApiMock {
  const calls: RecordedCall[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = (init?.method ?? 'GET').toUpperCase();

      const call: RecordedCall = {
        method,
        path: url.pathname,
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
        query: Object.fromEntries(url.searchParams.entries()),
      };

      calls.push(call);

      const handler = routes[`${method} ${url.pathname}`];

      if (!handler) {
        // Loud, not silent. An unmocked call is a test that no longer describes
        // what the component does.
        throw new Error(`No mock for ${method} ${url.pathname}`);
      }

      const result = typeof handler === 'function' ? handler(call) : handler;
      const status = result.status ?? 200;

      return new Response(JSON.stringify(result.body ?? {}), {
        status,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'test-request-id' },
      });
    }),
  );

  return {
    calls,
    lastCall: (key) => {
      const [method, path] = key.split(' ');
      return [...calls].reverse().find((call) => call.method === method && call.path === path);
    },
  };
}

/**
 * Waits for a request to land, so an assertion never races the mutation.
 * Mutations here always invalidate and refetch, so the request is a few
 * microtasks behind the click that caused it.
 */
export async function waitForCall(api: ApiMock, key: string): Promise<RecordedCall> {
  let found: RecordedCall | undefined;

  await waitFor(() => {
    found = api.lastCall(key);
    expect(found).toBeDefined();
  });

  return found as RecordedCall;
}

/** A query client with retries off — a test should not wait out a backoff. */
const testQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });

/**
 * Renders one admin page component in isolation.
 *
 * apps/admin/src/test/harness.tsx's `renderAt` mounted a `MemoryRouter` so
 * `useParams()` picked up the route id; this app's pages read the same
 * value through `next/navigation`'s `useParams()` instead, which each test
 * file mocks directly (`vi.mock('next/navigation', …)`) rather than through
 * a real router — App Router's client navigation hooks have no equivalent
 * of `MemoryRouter` to mount in a unit test, so the params/pathname a page
 * would receive are supplied as fixed test doubles instead. This helper
 * only owns the one thing every ported test still needs: a fresh,
 * retry-off `QueryClient` per render.
 */
export function renderAdminPage(node: ReactNode): RenderResult {
  return render(<QueryClientProvider client={testQueryClient()}>{node}</QueryClientProvider>);
}
