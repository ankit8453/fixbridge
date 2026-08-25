import type * as ReactRouterDom from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import AdminLogin from '@/routes/auth/AdminLogin';

/**
 * `/admin/login` — one step, email + password, no OTP.
 *
 * It was a two-step flow (password, then a mailed/SMSed code) until staff moved
 * out of `users` into `admin_users`. The owner dropped the second factor
 * deliberately: staff have no phone on file and no email transport is wired up,
 * so there was no second channel to send a code over.
 *
 * That makes the password the ONLY factor, which is exactly why these tests
 * matter. What they pin down:
 *
 *   - a rejected credential leaves you on the form with the server's error
 *     shown, and does not navigate;
 *   - the email is sent as typed, not lower-cased or trimmed by the screen —
 *     normalisation is the server's job (its unique index is on LOWER(email)),
 *     and a client that also normalised would hide a server that stopped.
 */

const adminLogin = vi.fn();
const navigate = vi.fn();

vi.mock('@/lib/auth/useAuth', () => ({
  useAuth: () => ({
    status: 'signedOut',
    user: null,
    roles: [],
    requestOtp: vi.fn(),
    login: vi.fn(),
    adminLogin,
    logout: vi.fn(),
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof ReactRouterDom>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

function renderAdminLogin() {
  // `/en/...` — the console is English-only (see apps/web/README.md).
  return render(
    <MemoryRouter
      initialEntries={['/en/admin/login']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AdminLogin />
    </MemoryRouter>,
  );
}

describe('the admin sign-in', () => {
  it('stays on the form and shows the error when the credentials are rejected', async () => {
    adminLogin.mockRejectedValueOnce(
      new ApiError(
        401,
        'ADMIN_CREDENTIALS_INVALID',
        'Those credentials were not accepted',
        'req-1',
      ),
    );

    const user = userEvent.setup({ delay: null });
    renderAdminLogin();

    await user.type(screen.getByLabelText(/email/i), 'admin@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(adminLogin).toHaveBeenCalledWith('admin@example.com', 'wrong-password'),
    );

    expect(await screen.findByText('Those credentials were not accepted')).toBeInTheDocument();
    // The one thing a failed sign-in must never do.
    expect(navigate).not.toHaveBeenCalled();
  });

  it('signs in with the email exactly as typed, and then navigates', async () => {
    adminLogin.mockResolvedValueOnce(undefined);

    const user = userEvent.setup({ delay: null });
    renderAdminLogin();

    // Mixed case on purpose: the server's unique index is on LOWER(email), so
    // it owns normalisation. A screen that quietly lower-cased would mask a
    // server that had stopped doing it.
    await user.type(screen.getByLabelText(/email/i), 'Admin@Example.com');
    await user.type(screen.getByLabelText(/password/i), 'a-long-enough-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(adminLogin).toHaveBeenCalledWith('Admin@Example.com', 'a-long-enough-password'),
    );

    await waitFor(() => expect(navigate).toHaveBeenCalled());
  });
});
