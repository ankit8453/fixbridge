import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Role } from '@fixbridge/shared';
import { AuthContext, type AuthState } from '@/lib/auth/AuthProvider';
import CustomerAppEntry from '@/surfaces/customer/CustomerAppEntry';
import PartnerAppEntry from '@/surfaces/partner/PartnerAppEntry';
import { legalStatusBody, mockApi, renderWithQuery, waitForCall } from '@/test/harness';
import { LegalGate } from './LegalGate';
import type { LegalDocument } from './api';

const VERSION = '2026-11-15';

function authState(overrides: Partial<AuthState> = {}): AuthState {
  const roles: Role[] = overrides.roles ?? ['customer'];
  return {
    status: 'signedIn',
    user: {
      id: 'u1',
      phone: '+9198765*****',
      name: 'Test User',
      roles,
      status: 'active',
      defaultCityId: 1,
      preferredLanguage: 'en',
      createdAt: new Date().toISOString(),
    } as unknown as AuthState['user'],
    roles,
    requestOtp: vi.fn(),
    login: vi.fn(),
    adminLogin: vi.fn(),
    logout: vi.fn(async () => {}),
    ...overrides,
  };
}

function renderAt(path: string, ui: React.ReactNode, auth: AuthState = authState()) {
  return renderWithQuery(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthContext.Provider value={auth}>{ui}</AuthContext.Provider>
    </MemoryRouter>,
  );
}

function renderGate(
  document: LegalDocument = 'customer_terms',
  { path = '/en/app', auth = authState() }: { path?: string; auth?: AuthState } = {},
) {
  return renderAt(
    path,
    <LegalGate document={document}>
      <p>surface content</p>
    </LegalGate>,
    auth,
  );
}

describe('LegalGate', () => {
  it('lets the surface through when the current version is already accepted', async () => {
    mockApi({ 'GET /api/v1/legal/me': { body: legalStatusBody() } });
    renderGate();

    expect(await screen.findByText('surface content')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Before you continue' })).not.toBeInTheDocument();
  });

  it('shows the customer terms instead of the surface when not accepted', async () => {
    mockApi({ 'GET /api/v1/legal/me': { body: legalStatusBody({ customer: false }) } });
    renderGate();

    expect(await screen.findByRole('heading', { name: 'Before you continue' })).toBeInTheDocument();
    expect(screen.queryByText('surface content')).not.toBeInTheDocument();
    expect(screen.getByText(`Version ${VERSION}`)).toBeInTheDocument();
    expect(screen.getByText(/pay the technician directly, in cash/)).toBeInTheDocument();

    // Locale-aware links to the full documents, each in a new tab.
    const terms = screen.getByRole('link', { name: /Terms & Conditions/ });
    expect(terms).toHaveAttribute('href', '/en/terms');
    expect(terms).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: /Privacy Policy/ })).toHaveAttribute(
      'href',
      '/en/privacy',
    );
    expect(screen.getByRole('link', { name: /Refund & cancellation/ })).toHaveAttribute(
      'href',
      '/en/refund-policy',
    );
  });

  it('only gates on its own document — a customer gate ignores partner terms', async () => {
    mockApi({ 'GET /api/v1/legal/me': { body: legalStatusBody({ partner: false }) } });
    renderGate('customer_terms');

    expect(await screen.findByText('surface content')).toBeInTheDocument();
  });

  it('keeps Accept disabled until the checkbox is ticked', async () => {
    mockApi({ 'GET /api/v1/legal/me': { body: legalStatusBody({ customer: false }) } });
    renderGate();

    const accept = await screen.findByRole('button', { name: 'Accept and continue' });
    expect(accept).toBeDisabled();

    await userEvent.click(screen.getByRole('checkbox'));
    expect(accept).toBeEnabled();

    await userEvent.click(screen.getByRole('checkbox'));
    expect(accept).toBeDisabled();
  });

  it('posts the document and displayed version, then renders the surface', async () => {
    const api = mockApi({
      'GET /api/v1/legal/me': { body: legalStatusBody({ customer: false }) },
      'POST /api/v1/legal/accept': { body: legalStatusBody() },
    });
    renderGate();

    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));

    const call = await waitForCall(api, 'POST /api/v1/legal/accept');
    expect(call.body).toEqual({ document: 'customer_terms', version: VERSION });

    expect(await screen.findByText('surface content')).toBeInTheDocument();
    // Straight from the POST response — no second GET needed.
    expect(api.callCount('GET /api/v1/legal/me')).toBe(1);
  });

  it('partner variant: partner copy, partner links, posts partner_terms', async () => {
    const api = mockApi({
      'GET /api/v1/legal/me': { body: legalStatusBody({ partner: false }) },
      'POST /api/v1/legal/accept': { body: legalStatusBody() },
    });
    renderGate('partner_terms', { path: '/partner' });

    // Hindi (the default, unprefixed) locale.
    expect(await screen.findByRole('heading', { name: 'आगे बढ़ने से पहले' })).toBeInTheDocument();
    expect(screen.getByText(/0% कमीशन/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /पार्टनर एग्रीमेंट/ })).toHaveAttribute(
      'href',
      '/partner-terms',
    );
    expect(screen.getByRole('link', { name: /प्राइवेसी पॉलिसी/ })).toHaveAttribute(
      'href',
      '/privacy',
    );

    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'स्वीकार करें और आगे बढ़ें' }));

    const call = await waitForCall(api, 'POST /api/v1/legal/accept');
    expect(call.body).toEqual({ document: 'partner_terms', version: VERSION });
    expect(await screen.findByText('surface content')).toBeInTheDocument();
  });

  it('on 409 LEGAL_VERSION_OUTDATED keeps the gate, shows the updated message and refetches', async () => {
    let gets = 0;
    const api = mockApi({
      'GET /api/v1/legal/me': () => {
        gets += 1;
        return {
          body: legalStatusBody({ customer: false, version: gets === 1 ? VERSION : '2026-12-01' }),
        };
      },
      'POST /api/v1/legal/accept': {
        status: 409,
        body: {
          error: {
            code: 'LEGAL_VERSION_OUTDATED',
            message: 'outdated',
            requestId: 'r1',
          },
        },
      },
    });
    renderGate();

    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));

    expect(
      await screen.findByText('The terms were just updated — please review them again.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Version 2026-12-01')).toBeInTheDocument();
    expect(api.callCount('GET /api/v1/legal/me')).toBe(2);

    // Still gated, and the box has to be ticked again for the new version.
    expect(screen.queryByText('surface content')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Accept and continue' })).toBeDisabled();
  });

  it('on a load error shows Retry and Sign out, never the surface', async () => {
    let fail = true;
    const api = mockApi({
      'GET /api/v1/legal/me': () =>
        fail
          ? { status: 500, body: { error: { code: 'INTERNAL', message: 'x', requestId: 'r' } } }
          : { body: legalStatusBody() },
    });
    const auth = authState();
    renderGate('customer_terms', { auth });

    expect(
      await screen.findByText('Could not load the terms. Check your connection and try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('surface content')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.logout).toHaveBeenCalledTimes(1);

    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('surface content')).toBeInTheDocument();
    expect(api.callCount('GET /api/v1/legal/me')).toBe(2);
  });

  it('treats a malformed response as an error, not as accepted', async () => {
    mockApi({ 'GET /api/v1/legal/me': { body: { customerTerms: { accepted: true } } } });
    renderGate();

    expect(
      await screen.findByText('Could not load the terms. Check your connection and try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('surface content')).not.toBeInTheDocument();
  });

  it('Sign out on the terms screen calls the existing logout', async () => {
    mockApi({ 'GET /api/v1/legal/me': { body: legalStatusBody({ customer: false }) } });
    const auth = authState();
    renderGate('customer_terms', { auth });

    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(auth.logout).toHaveBeenCalledTimes(1));
  });
});

describe('surface wiring', () => {
  it('/app renders the customer terms gate, and nothing of the surface, when not accepted', async () => {
    const api = mockApi({
      'GET /api/v1/legal/me': { body: legalStatusBody({ customer: false }) },
    });
    renderAt('/en/app', <CustomerAppEntry />);

    expect(
      await screen.findByText(/connects you with independent technicians/),
    ).toBeInTheDocument();
    // Only the legal call — the surface's own queries never start behind the gate.
    expect(api.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /api/v1/legal/me',
    ]);
  });

  it('/partner renders the partner agreement gate for a technician who has not accepted', async () => {
    const api = mockApi({
      'GET /api/v1/legal/me': { body: legalStatusBody({ partner: false }) },
    });
    renderAt('/en/partner', <PartnerAppEntry />, authState({ roles: ['customer', 'technician'] }));

    expect(
      await screen.findByText(/independent technician, not as a FixBridge employee/),
    ).toBeInTheDocument();
    expect(api.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /api/v1/legal/me',
    ]);
  });

  it('/partner does not gate a non-technician — they see the become-a-partner pitch', async () => {
    const api = mockApi({});
    renderAt('/en/partner', <PartnerAppEntry />, authState({ roles: ['customer'] }));

    expect(await screen.findByText('Become a partner')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Before you continue' })).not.toBeInTheDocument();
    expect(api.callCount('GET /api/v1/legal/me')).toBe(0);
  });
});
