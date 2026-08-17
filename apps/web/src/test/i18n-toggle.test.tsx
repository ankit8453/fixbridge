import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../lib/auth/AuthProvider';
import { LocaleToggle } from '../components/shell/LocaleToggle';
import { mockApi } from './harness';

/**
 * The locale IS the URL in this app (see `router/localePrefix.ts`) — `hi`
 * unprefixed, `en` under `/en/...`. `LocaleToggle` has to compute the OTHER
 * locale's URL for whatever page it is rendered on, in both directions,
 * which is what this test actually exercises (not just "does a click do
 * something"). `MemoryRouter initialEntries` stands in for the browser URL —
 * `useLocale()`/`useLocation()` read it exactly the way they would read a
 * real address bar.
 */

async function renderToggle(initialPath: string) {
  // AuthProvider always attempts a silent refresh on mount (see its own
  // comment on why); with no refresh token in storage, `refreshAccessToken`
  // resolves to `null` without even calling `fetch` — nothing to mock here,
  // unlike the old cookie-based version.
  mockApi({});

  render(
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthProvider>
        <LocaleToggle />
      </AuthProvider>
    </MemoryRouter>,
  );

  // Wait for the toggle link itself, not an unrelated element — proves the
  // component actually finished its first render with a real href.
  return screen.findByRole('link');
}

describe('i18n toggle', () => {
  it('on a Hindi (unprefixed) page, offers English at the /en-prefixed equivalent URL', async () => {
    const link = await renderToggle('/services');

    expect(link).toHaveTextContent('English');
    expect(link).toHaveAttribute('href', '/en/services');
  });

  it('on an English (/en-prefixed) page, offers Hindi at the unprefixed equivalent URL', async () => {
    const link = await renderToggle('/en/services');

    expect(link).toHaveTextContent('हिंदी');
    expect(link).toHaveAttribute('href', '/services');
  });

  it('on the Hindi home page, the English link is /en/ (not a double slash)', async () => {
    const link = await renderToggle('/');

    expect(link).toHaveAttribute('href', '/en/');
  });
});
