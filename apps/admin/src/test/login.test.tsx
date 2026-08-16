import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../App';
import { mockApi, renderApp } from './harness';

/**
 * The door.
 *
 * A customer or a technician can complete this exact OTP login — nothing stops
 * them pointing a browser at the console — so "does the server 403 them" is not
 * the question. The question is whether they are told, in words, that they are
 * in the wrong place, and whether their session is thrown away when they are.
 */

const SUMMARY = {
  queues: {
    verificationPending: 0,
    complaintsOpen: 0,
    reviewReports: 0,
    parkedOutbox: 0,
    parkedWebhooks: 0,
    parkedDeliveries: 0,
    heldDeliveries: 0,
    pendingBatches: 0,
    otpLockedBookings: 0,
    suspendedProviders: 0,
    pendingEntryApproval: 0,
  },
  bookings: { today: {}, todayTotal: 0 },
  money: {
    gmvTodayPaise: 0,
    gmv7dPaise: 0,
    gmv30dPaise: 0,
    revenuePaise: 0,
    gatewayCashPaise: 0,
    owedToProvidersPaise: 0,
    owedByProvidersPaise: 0,
  },
  generatedAt: '2026-08-16T09:00:00.000Z',
};

const session = (roles: string[]) => ({
  status: 200,
  body: {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresIn: 900,
    user: { id: 'u1', name: 'Meena', phone: '+9199999*****', roles, status: 'active' },
  },
});

const signIn = async () => {
  const user = userEvent.setup({ delay: null });

  await user.type(screen.getByLabelText('Phone number'), '+919999900002');
  await user.click(screen.getByRole('button', { name: 'Send code' }));

  await user.type(await screen.findByLabelText('6-digit code'), '000000');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
};

describe('login and the role gate', () => {
  it('lets an ops user into the console', async () => {
    const api = mockApi({
      'POST /api/v1/auth/otp/request': { body: { expiresInSeconds: 300 } },
      'POST /api/v1/auth/otp/verify': session(['ops']),
      'GET /api/v1/admin/summary': { body: SUMMARY },
    });

    renderApp(<AppRoutes />, '/login');
    await signIn();

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(api.lastCall('POST /api/v1/auth/otp/verify')?.body).toMatchObject({
      phone: '+919999900002',
      otp: '000000',
    });
    // The device id is what binds the refresh token to this browser; sending the
    // login without one would make every reload look like a stolen token.
    expect(api.lastCall('POST /api/v1/auth/otp/verify')?.body?.deviceId).toBeTruthy();
  });

  it('refuses a customer with a clear message and signs them out', async () => {
    mockApi({
      'POST /api/v1/auth/otp/request': { body: { expiresInSeconds: 300 } },
      'POST /api/v1/auth/otp/verify': session(['customer']),
      'POST /api/v1/auth/logout': { body: { message: 'Signed out successfully.' } },
    });

    renderApp(<AppRoutes />, '/login');
    await signIn();

    expect(await screen.findByText(/this console is for the operations team/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument();

    // Nothing of theirs is left behind in this origin's storage.
    await waitFor(() => {
      expect(window.localStorage.getItem('fixbridge.admin.refreshToken')).toBeNull();
    });
  });
});
