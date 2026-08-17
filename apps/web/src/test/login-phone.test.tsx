import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

/**
 * The bug this file exists to prevent.
 *
 * `POST /auth/otp/request` echoes the phone back **masked** —
 * `+9199999*****` — which is correct of the API and a trap for the client.
 * Writing that value back over the number the person typed produces a login
 * screen that renders fine, sends the OTP fine, and then can never log
 * anybody in: the verify call carries a string of asterisks and the API
 * rejects it as not a phone number.
 *
 * It is worth a dedicated test because the failure is total (nobody can sign
 * in to any surface), the symptom points at validation rather than at state,
 * and every manual test of "does login work" passes right up to the last
 * step. `PhoneOtpForm` is what every login/register placeholder route shares
 * (`CustomerLogin`, `CustomerRegister`, `PartnerLogin`, `PartnerRegister`),
 * so this test exercises it through `CustomerLogin` and the fix protects all
 * four.
 */

const requestOtp = vi.fn();
const login = vi.fn();

vi.mock('../lib/auth/useAuth', () => ({
  useAuth: () => ({ requestOtp, login }),
}));

const REAL_PHONE = '+919999900050';
const MASKED = '+9199999*****';

describe('login keeps the real phone number', () => {
  /**
   * 30s rather than the 10s default, and not because anything here is flaky.
   *
   * This test drives two full form steps through `userEvent` — a 13-character
   * phone, then a 6-digit OTP — and jsdom re-renders the whole screen on every
   * keystroke. Alone it finishes in ~5s. Run as part of the full suite on a
   * 12-core machine, Vitest's parallel workers compete for CPU and the same
   * work takes 11-13s, which tripped the old 10s budget and failed the ONE
   * test guarding a total-login-failure regression (see the note above).
   *
   * A guard that fails only when the suite is busy is worse than no guard: it
   * trains everyone to re-run and shrug. The fix is a budget that reflects
   * what this test actually costs, not a faster machine or a retry.
   */
  it('verifies with what the user typed, never the masked echo', { timeout: 30_000 }, async () => {
    requestOtp.mockResolvedValue({ phone: MASKED });
    login.mockResolvedValue(undefined);

    const { default: CustomerLogin } = await import('../routes/auth/CustomerLogin');

    const user = userEvent.setup({ delay: null });
    render(
      <MemoryRouter
        initialEntries={['/login']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <CustomerLogin />
      </MemoryRouter>,
    );

    await user.type(screen.getByRole('textbox'), REAL_PHONE);
    await user.click(screen.getByRole('button', { name: /send code|कोड भेजें/i }));

    await waitFor(() => expect(requestOtp).toHaveBeenCalledWith(REAL_PHONE));

    const otpField = await screen.findByRole('textbox');
    await user.type(otpField, '000000');

    const submit = screen
      .getAllByRole('button')
      .find((button) => button.getAttribute('type') === 'submit');

    expect(submit).toBeDefined();
    await user.click(submit as HTMLElement);

    await waitFor(() => expect(login).toHaveBeenCalled());

    // The whole point: the masked string must never reach the verify call.
    const [sentPhone] = login.mock.calls[0] as [string, string];

    expect(sentPhone).toBe(REAL_PHONE);
    expect(sentPhone).not.toContain('*');
  });
});
