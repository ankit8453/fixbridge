import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockNav } from '@/test/navigation-mock';
import { SlotPicker } from '../SlotPicker';
import type { PublicSlot } from '@/components/customer/data/types';

// `useT()`/`useLocale()` read the locale from `useParams()` (see
// `src/i18n/useT.ts`) — there is no real Next router in a Vitest/jsdom
// environment, so every component test that renders copy needs this mock.
// Local to this file (not the shared `setup.ts`, which another surface's
// agent owns and does not register it) — see `src/test/navigation-mock.ts`.
vi.mock('next/navigation', () => ({
  useParams: () => mockNav.params,
  usePathname: () => mockNav.pathname,
  useSearchParams: () => new URLSearchParams(mockNav.search),
  useRouter: () => mockNav.router,
}));

const SLOTS: PublicSlot[] = [
  { id: 'slot-1', startsAt: '2026-08-17T03:30:00.000Z', endsAt: '2026-08-17T04:30:00.000Z' }, // 09:00 IST
  { id: 'slot-2', startsAt: '2026-08-17T04:30:00.000Z', endsAt: '2026-08-17T05:30:00.000Z' }, // 10:00 IST
  { id: 'slot-3', startsAt: '2026-08-18T05:30:00.000Z', endsAt: '2026-08-18T06:30:00.000Z' }, // 11:00 IST, next day
];

describe('SlotPicker', () => {
  it('groups slots by IST calendar day and renders each time as a button', () => {
    render(<SlotPicker slots={SLOTS} selectedSlotId={null} onSelect={() => {}} />);

    // Two day groups (17 Aug and 18 Aug in IST).
    expect(screen.getAllByText(/Aug/).length).toBe(2);
    expect(screen.getByRole('button', { name: '09:00' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '10:00' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '09:00' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('marks the selected slot and calls onSelect with the tapped slot id', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(<SlotPicker slots={SLOTS} selectedSlotId="slot-2" onSelect={onSelect} />);

    expect(screen.getByRole('button', { name: '10:00' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '09:00' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: '09:00' }));
    expect(onSelect).toHaveBeenCalledWith('slot-1');
  });

  it('shows an empty message rather than a blank screen when there are no open slots', () => {
    render(<SlotPicker slots={[]} selectedSlotId={null} onSelect={() => {}} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
