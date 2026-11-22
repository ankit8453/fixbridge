import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import CustomerLogin from '../routes/auth/CustomerLogin';
import PartnerLogin from '../routes/auth/PartnerLogin';
import { requestOtp as sessionRequestOtp } from '../lib/auth/session';
import { mockApi } from './harness';

/**
 * During the pilot no SMS goes out: `POST /auth/otp/request` answers
 * `delivery: "team_relay"` and a team member sends the code on WhatsApp by
 * hand. The OTP step must then say that, instead of claiming a code has
 * already been sent. Anything else (`automatic`, or an older API with no field
 * at all) keeps the existing copy.
 */

const requestOtp = vi.fn();
const login = vi.fn();

vi.mock('../lib/auth/useAuth', () => ({
  useAuth: () => ({ requestOtp, login }),
}));

const MASKED = '+9199999*****';

const EN_RELAY = `Our team will send your code to ${MASKED} on WhatsApp within a few minutes (9 am – 8 pm). The code is valid for 10 minutes.`;
const HI_RELAY = `हमारी टीम कुछ ही मिनटों में (सुबह 9 से रात 8 बजे तक) ${MASKED} पर WhatsApp से आपका कोड भेजेगी। कोड 10 मिनट तक मान्य रहेगा।`;

async function reachOtpStep(ui: ReactNode, path: string) {
  const user = userEvent.setup({ delay: null });
  render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '9999900050' } });
  await user.click(screen.getByRole('button', { name: /send code|कोड भेजें/i }));
}

describe('the OTP step when the team relays the code', () => {
  it('customer sign-in (English) says the team will send it on WhatsApp', async () => {
    requestOtp.mockResolvedValue({ phone: MASKED, expiresInSeconds: 600, delivery: 'team_relay' });

    await reachOtpStep(<CustomerLogin />, '/en/login');

    expect(await screen.findByText(EN_RELAY)).toBeInTheDocument();
    expect(screen.queryByText(`Code sent to ${MASKED}`)).not.toBeInTheDocument();
  });

  it('customer sign-in (Hindi) says the same in Hindi', async () => {
    requestOtp.mockResolvedValue({ phone: MASKED, expiresInSeconds: 600, delivery: 'team_relay' });

    await reachOtpStep(<CustomerLogin />, '/login');

    expect(await screen.findByText(HI_RELAY)).toBeInTheDocument();
  });

  it('technician sign-in says the team will send it on WhatsApp', async () => {
    requestOtp.mockResolvedValue({ phone: MASKED, expiresInSeconds: 600, delivery: 'team_relay' });

    await reachOtpStep(<PartnerLogin />, '/en/partner/login');

    expect(await screen.findByText(EN_RELAY)).toBeInTheDocument();
  });

  it('rounds the validity to whole minutes and never shows less than 1', async () => {
    requestOtp.mockResolvedValue({ phone: MASKED, expiresInSeconds: 20, delivery: 'team_relay' });

    await reachOtpStep(<PartnerLogin />, '/en/partner/login');

    expect(await screen.findByText(/The code is valid for 1 minutes\./)).toBeInTheDocument();
  });
});

describe('the OTP step when the code is sent automatically', () => {
  it('customer sign-in keeps the existing "code sent" copy', async () => {
    requestOtp.mockResolvedValue({ phone: MASKED, expiresInSeconds: 600, delivery: 'automatic' });

    await reachOtpStep(<CustomerLogin />, '/en/login');

    expect(await screen.findByText(`Code sent to ${MASKED}`)).toBeInTheDocument();
    expect(screen.queryByText(/WhatsApp/)).not.toBeInTheDocument();
  });

  it('technician sign-in keeps the existing copy when the field is missing', async () => {
    requestOtp.mockResolvedValue({ phone: MASKED, expiresInSeconds: 600 });

    await reachOtpStep(<PartnerLogin />, '/en/partner/login');

    expect(await screen.findByText(`We sent a code to ${MASKED}`)).toBeInTheDocument();
  });
});

describe('requestOtp reads `delivery` tolerantly', () => {
  it.each([
    [{ delivery: 'team_relay' }, 'team_relay'],
    [{ delivery: 'automatic' }, 'automatic'],
    [{ delivery: 'carrier_pigeon' }, 'automatic'],
    [{}, 'automatic'],
  ])('%j → %s', async (extra, expected) => {
    mockApi({
      'POST /api/v1/auth/otp/request': {
        body: { phone: MASKED, expiresInSeconds: 300, ...extra },
      },
    });

    const result = await sessionRequestOtp('+919999900050');

    expect(result).toEqual({ phone: MASKED, expiresInSeconds: 300, delivery: expected });
  });
});
