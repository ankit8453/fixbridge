import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import AdminLogin from '@/routes/auth/AdminLogin';

/**
 * New for this phase — not a port (the legacy console had no login screen
 * of its own to test; see `apps/web/README.md`'s Auth routes section). The
 * two-step shape (`adminPasswordStep` then `adminLogin`) is the one thing
 * about `/admin/login` this surface owns outright, so the risk worth a
 * dedicated test is the step boundary: a wrong password must never advance
 * the form to the OTP step, and `adminLogin` must never be called without a
 * challenge id from a successful first step.
 */

const adminPasswordStep = vi.fn();
const adminLogin = vi.fn();

vi.mock('@/lib/auth/useAuth', () => ({
  useAuth: () => ({
    status: 'signedOut',
    user: null,
    roles: [],
    requestOtp: vi.fn(),
    login: vi.fn(),
    adminPasswordStep,
    adminLogin,
    logout: vi.fn(),
  }),
}));

function renderAdminLogin() {
  // `/en/...` — this console is English-only (see apps/web/README.md); the
  // unprefixed URL resolves to Hindi copy, which is a real, separate concern
  // from what this suite tests (the step boundary), not something to paper
  // over here.
  return render(
    <MemoryRouter
      initialEntries={['/en/admin/login']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AdminLogin />
    </MemoryRouter>,
  );
}

describe('the admin two-step sign-in', () => {
  it('does not advance to the OTP step when the password is wrong', async () => {
    adminPasswordStep.mockRejectedValueOnce(
      new ApiError(401, 'ADMIN_CREDENTIALS_INVALID', 'That ID or password is wrong.', 'req-1'),
    );

    const user = userEvent.setup({ delay: null });
    renderAdminLogin();

    await user.type(screen.getByLabelText(/staff id/i), '+919999900001');
    await user.type(screen.getByLabelText(/password/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(adminPasswordStep).toHaveBeenCalledWith('+919999900001', 'wrong-password'),
    );

    // Still on the password step: no OTP field, the error is shown, and the
    // second call is never made without a challenge id.
    expect(await screen.findByText('That ID or password is wrong.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/verification code/i)).not.toBeInTheDocument();
    expect(adminLogin).not.toHaveBeenCalled();
  });

  it('advances to the OTP step and signs in with the issued challenge id', async () => {
    adminPasswordStep.mockResolvedValueOnce({
      challengeId: 'challenge-1',
      phone: '+9199999*****',
      expiresInSeconds: 300,
    });
    adminLogin.mockResolvedValueOnce(undefined);

    const user = userEvent.setup({ delay: null });
    renderAdminLogin();

    await user.type(screen.getByLabelText(/staff id/i), '+919999900001');
    await user.type(screen.getByLabelText(/password/i), 'fixbridge-dev-admin');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const otpField = await screen.findByLabelText(/verification code/i);
    expect(screen.getByText(/\+9199999\*\*\*\*\*/)).toBeInTheDocument();

    await user.type(otpField, '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(adminLogin).toHaveBeenCalledWith('challenge-1', '000000'));
  });
});
