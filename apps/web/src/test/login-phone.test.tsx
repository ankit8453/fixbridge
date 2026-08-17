import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

/**
 * The bug this file exists to prevent.
 *
 * `POST /auth/otp/request` echoes the phone back **masked** — `+9199999*****` —
 * which is correct of the API and a trap for the client. Writing that value back
 * over the number the person typed produces a login screen that renders fine,
 * sends the OTP fine, and then can never log anybody in: the verify call carries
 * a string of asterisks and the API rejects it as not a phone number.
 *
 * It is worth a dedicated test because the failure is total (nobody can sign in
 * to any surface), the symptom points at validation rather than at state, and
 * every manual test of "does login work" passes right up to the last step.
 */

const requestOtp = vi.fn();
const login = vi.fn();
const replace = vi.fn();

vi.mock('@/lib/auth/useAuth', () => ({
  useAuth: () => ({ requestOtp, login }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: replace }),
  usePathname: () => '/login',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/i18n/useT', () => ({
  useT: () => (key: string) => key,
  useLocale: () => 'hi',
}));

vi.mock('@/lib/api', () => ({
  apiRequest: vi.fn().mockResolvedValue({ profile: { displayName: 'Existing' } }),
}));

vi.mock('@/components/customer/data/addresses', () => ({
  useCustomerProfile: () => ({ data: null, isLoading: false }),
  useUpdateCustomerProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const REAL_PHONE = '+919999900050';
const MASKED = '+9199999*****';

describe('login keeps the real phone number', () => {
  it('verifies with what the user typed, never the masked echo', async () => {
    requestOtp.mockResolvedValue({ phone: MASKED });
    login.mockResolvedValue(undefined);

    const { LoginScreen } = await import('@/components/customer/auth/LoginScreen');

    const user = userEvent.setup({ delay: null });
    render(<LoginScreen />);

    await user.type(screen.getByRole('textbox'), REAL_PHONE);
    await user.click(screen.getByRole('button', { name: 'auth.sendCode' }));

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
