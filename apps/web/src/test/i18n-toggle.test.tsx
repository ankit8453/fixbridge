import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AuthProvider } from '../lib/auth/AuthProvider';
import { LocaleToggle } from '../components/shell/LocaleToggle';
import { mockApi } from './harness';

/**
 * The locale IS the URL in this app (see src/middleware.ts) — `hi` unprefixed,
 * `en` under `/en/...`. `LocaleToggle` has to compute the OTHER locale's URL
 * for whatever page it is rendered on, in both directions, which is the
 * thing this test actually exercises (not just "does a click do something").
 */

vi.mock('next/navigation', () => ({
  useParams: vi.fn(),
  usePathname: vi.fn(),
}));

// next/link's real implementation reaches into the App Router's context for
// prefetching, which does not exist outside an actual Next.js request —
// mocked to a plain anchor, the standard approach for unit-testing a
// component that merely renders a Link, per Next's own testing docs.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

async function renderToggle() {
  // AuthProvider always attempts a silent refresh on mount (see its own
  // comment on why); a mocked, session-less response lets it settle to
  // "signed out" without an unhandled rejection in the test.
  mockApi({
    'POST /api/session/refresh': {
      status: 401,
      body: { error: { code: 'AUTH_NO_SESSION', message: 'No session', requestId: null } },
    },
  });

  render(
    <AuthProvider>
      <LocaleToggle />
    </AuthProvider>,
  );

  // Wait for the toggle link itself, not an unrelated element — proves the
  // component actually finished its first render with a real href.
  return screen.findByRole('link');
}

describe('i18n toggle', () => {
  it('on a Hindi (unprefixed) page, offers English at the /en-prefixed equivalent URL', async () => {
    const { useParams, usePathname } = await import('next/navigation');
    vi.mocked(useParams).mockReturnValue({ locale: 'hi' });
    vi.mocked(usePathname).mockReturnValue('/services');

    const link = await renderToggle();

    expect(link).toHaveTextContent('English');
    expect(link).toHaveAttribute('href', '/en/services');
  });

  it('on an English (/en-prefixed) page, offers Hindi at the unprefixed equivalent URL', async () => {
    const { useParams, usePathname } = await import('next/navigation');
    vi.mocked(useParams).mockReturnValue({ locale: 'en' });
    vi.mocked(usePathname).mockReturnValue('/en/services');

    const link = await renderToggle();

    expect(link).toHaveTextContent('हिंदी');
    expect(link).toHaveAttribute('href', '/services');
  });

  it('on the Hindi home page, the English link is /en (not /en/ or a double slash)', async () => {
    const { useParams, usePathname } = await import('next/navigation');
    vi.mocked(useParams).mockReturnValue({ locale: 'hi' });
    vi.mocked(usePathname).mockReturnValue('/');

    const link = await renderToggle();

    expect(link).toHaveAttribute('href', '/en/');
  });
});
