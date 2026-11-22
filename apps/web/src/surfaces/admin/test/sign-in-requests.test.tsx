import { QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@fixbridge/shared';
import { ToastProvider } from '../../../components/ui/Toast';
import AdminAppEntry from '../AdminAppEntry';
import SignInRequestsPage from '../pages/SignInRequestsPage';
import { useOtpRelayAlerts } from '../lib/otpRelay';
import type { OtpRelayRequest } from '../lib/types';
import { mockApi, testQueryClient, waitForCall } from '@/test/harness';

/**
 * The pilot's sign-in relay: no SMS goes out, so staff send each code by hand
 * on WhatsApp from `/admin/sign-in-requests`. What these tests guard is the
 * part a person is actually waiting on — the right number and code on screen,
 * the WhatsApp link opening and the request being marked sent, and the console
 * making noise when (and only when) somebody new asks.
 */

const STAFF: AuthUser = {
  id: 'staff-1',
  phone: '+9199999*****',
  name: 'Meena',
  roles: ['ops'],
  status: 'active',
  defaultCityId: 1,
  preferredLanguage: 'en',
  createdAt: '2026-01-01T00:00:00.000Z',
};

vi.mock('@/lib/auth/useAuth', () => ({
  useAuth: () => ({
    status: 'signedIn',
    user: STAFF,
    roles: STAFF.roles,
    requestOtp: vi.fn(),
    login: vi.fn(),
    adminLogin: vi.fn(),
    logout: vi.fn(),
  }),
}));

const NOW = new Date('2026-11-23T10:05:00.000Z');

function relayRequest(overrides: Partial<OtpRelayRequest> = {}): OtpRelayRequest {
  return {
    id: 'req-1',
    phone: '+919876543210',
    otp: '482913',
    createdAt: '2026-11-23T10:04:00.000Z',
    // 9:30 left at NOW.
    expiresAt: '2026-11-23T10:14:30.000Z',
    sentAt: null,
    sentBy: null,
    whatsappUrl: 'https://wa.me/919876543210?text=Your%20FixBridge%20code%20is%20482913',
    ...overrides,
  };
}

const WAITING = relayRequest();
const ALREADY_SENT = relayRequest({
  id: 'req-2',
  phone: '+919812345678',
  otp: '111222',
  createdAt: '2026-11-23T10:01:00.000Z',
  expiresAt: '2026-11-23T10:16:00.000Z',
  sentAt: '2026-11-23T10:03:00.000Z',
  sentBy: 'Ravi',
  whatsappUrl: 'https://wa.me/919812345678?text=x',
});

function wrap(ui: ReactNode, path = '/admin/sign-in-requests') {
  return render(
    <QueryClientProvider client={testQueryClient()}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // Only `Date` is faked: the countdowns read the clock, while TanStack's and
  // userEvent's own timers keep running for real.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  document.title = 'FixBridge';
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the sign-in requests page', () => {
  it('lists each request with a readable phone, the code, a countdown and who sent it', async () => {
    mockApi({
      'GET /api/v1/admin/otp-relay': { body: { requests: [WAITING, ALREADY_SENT] } },
    });

    wrap(<SignInRequestsPage />);

    const waiting = await screen.findByRole('listitem', {
      name: 'Sign-in request for +91 98765 43210',
    });
    expect(within(waiting).getByText('482913')).toBeInTheDocument();
    expect(within(waiting).getByText(/09:30/)).toBeInTheDocument();
    expect(within(waiting).getByRole('button', { name: 'Send on WhatsApp' })).toBeInTheDocument();

    const sent = screen.getByRole('listitem', { name: 'Sign-in request for +91 98123 45678' });
    expect(within(sent).getByText('Sent by Ravi · 2 min ago')).toBeInTheDocument();
    expect(within(sent).getByText(/11:00/)).toBeInTheDocument();
  });

  it('"Send on WhatsApp" opens the prefilled link and marks the request sent at once', async () => {
    let releasePost: () => void = () => {};
    const postGate = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    let serverSent = false;
    const sentVersion = { ...WAITING, sentAt: NOW.toISOString(), sentBy: 'Meena' };

    const api = mockApi({
      'GET /api/v1/admin/otp-relay': () => ({
        body: { requests: [serverSent ? sentVersion : WAITING] },
      }),
      'POST /api/v1/admin/otp-relay/req-1/sent': async () => {
        await postGate;
        serverSent = true;
        return { body: { request: sentVersion } };
      },
    });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);

    const user = userEvent.setup({ delay: null });
    wrap(<SignInRequestsPage />);

    await user.click(await screen.findByRole('button', { name: 'Send on WhatsApp' }));

    expect(open).toHaveBeenCalledWith(WAITING.whatsappUrl, '_blank', 'noopener');

    // Optimistic: shown as sent while the POST is still in flight, so a second
    // team member looking at the same list does not send it again.
    expect(await screen.findByText('Sent by Meena · just now')).toBeInTheDocument();

    const call = await waitForCall(api, 'POST /api/v1/admin/otp-relay/req-1/sent');
    expect(call.body).toBeNull();

    releasePost();
    await waitFor(() => expect(api.callCount('GET /api/v1/admin/otp-relay')).toBeGreaterThan(1));
    expect(screen.getByText('Sent by Meena · just now')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send on WhatsApp' })).not.toBeInTheDocument();
  });

  it('says so when nobody is waiting', async () => {
    mockApi({ 'GET /api/v1/admin/otp-relay': { body: { requests: [] } } });

    wrap(<SignInRequestsPage />);

    expect(await screen.findByText('No one is waiting for a code.')).toBeInTheDocument();
  });
});

describe('the admin shell', () => {
  it('shows the unsent count on the nav item and in the tab title', async () => {
    mockApi({
      'GET /api/v1/admin/otp-relay': {
        body: {
          requests: [relayRequest({ id: 'a', phone: '+919811122233' }), WAITING, ALREADY_SENT],
        },
      },
    });

    wrap(
      <Routes>
        <Route path="/admin/*" element={<AdminAppEntry />} />
      </Routes>,
    );

    const link = await screen.findByRole('link', { name: /Sign-in requests/ });
    await waitFor(() => expect(within(link).getByText('2')).toBeInTheDocument());
    expect(document.title).toBe('(2) FixBridge');
  });
});

describe('new-request alerts', () => {
  function stubAlertApis() {
    const notifications: { title: string; options?: NotificationOptions }[] = [];
    class FakeNotification {
      static permission: NotificationPermission = 'granted';
      static requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
      onclick: (() => void) | null = null;
      close = vi.fn();
      constructor(title: string, options?: NotificationOptions) {
        notifications.push({ title, options });
      }
    }

    const tones = vi.fn();
    class FakeAudioContext {
      state = 'running';
      currentTime = 0;
      destination = {};
      resume = vi.fn(async () => undefined);
      createOscillator() {
        return {
          type: 'sine',
          frequency: { value: 0 },
          connect: vi.fn(),
          start: tones,
          stop: vi.fn(),
        };
      }
      createGain() {
        return {
          gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
        };
      }
    }

    vi.stubGlobal('Notification', FakeNotification);
    vi.stubGlobal('AudioContext', FakeAudioContext);
    return { notifications, tones };
  }

  const routerWrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>{children}</MemoryRouter>
  );

  it('stays quiet on the first load, then beeps and notifies for each new request', () => {
    const { notifications, tones } = stubAlertApis();

    const { rerender, unmount } = renderHook(
      ({ requests }: { requests: OtpRelayRequest[] | undefined }) => useOtpRelayAlerts(requests),
      {
        wrapper: routerWrapper,
        initialProps: { requests: undefined as OtpRelayRequest[] | undefined },
      },
    );

    // Opening the console with somebody already waiting is not an alert.
    rerender({ requests: [WAITING] });
    expect(notifications).toHaveLength(0);
    expect(tones).not.toHaveBeenCalled();
    expect(document.title).toBe('(1) FixBridge');

    const newcomer = relayRequest({ id: 'req-9', phone: '+919811122233' });
    rerender({ requests: [newcomer, WAITING] });

    expect(tones).toHaveBeenCalled();
    expect(notifications).toEqual([
      expect.objectContaining({ title: 'New sign-in request: +91 98111 22233' }),
    ]);
    expect(document.title).toBe('(2) FixBridge');

    // The same list again is not news.
    tones.mockClear();
    rerender({ requests: [newcomer, WAITING] });
    expect(tones).not.toHaveBeenCalled();
    expect(notifications).toHaveLength(1);

    // A request that arrives already sent (somebody beat this poll) is silent.
    rerender({ requests: [ALREADY_SENT, newcomer, WAITING] });
    expect(tones).not.toHaveBeenCalled();
    expect(notifications).toHaveLength(1);

    unmount();
    expect(document.title).toBe('FixBridge');
  });

  it('degrades to the title count where Notification and AudioContext do not exist', () => {
    // jsdom has neither — exactly the older-browser case.
    const { rerender } = renderHook(
      ({ requests }: { requests: OtpRelayRequest[] }) => useOtpRelayAlerts(requests),
      { wrapper: routerWrapper, initialProps: { requests: [] as OtpRelayRequest[] } },
    );

    expect(() => rerender({ requests: [WAITING] })).not.toThrow();
    expect(document.title).toBe('(1) FixBridge');
  });
});
