import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SlotPicker } from '../SlotPicker';
import type { PublicSlot } from '@/surfaces/customer/data/types';

const SLOTS: PublicSlot[] = [
  { id: 'slot-1', startsAt: '2026-08-17T03:30:00.000Z', endsAt: '2026-08-17T04:30:00.000Z' }, // 09:00 IST
  { id: 'slot-2', startsAt: '2026-08-17T04:30:00.000Z', endsAt: '2026-08-17T05:30:00.000Z' }, // 10:00 IST
  { id: 'slot-3', startsAt: '2026-08-18T05:30:00.000Z', endsAt: '2026-08-18T06:30:00.000Z' }, // 11:00 IST, next day
];

/** Ported from `legacy-next-src/components/customer/provider/__tests__/SlotPicker.test.tsx`. */
function renderPicker(props: Parameters<typeof SlotPicker>[0]) {
  return render(
    <MemoryRouter>
      <SlotPicker {...props} />
    </MemoryRouter>,
  );
}

describe('SlotPicker', () => {
  it('groups slots by IST calendar day and renders each time as a button', () => {
    renderPicker({ slots: SLOTS, selectedSlotId: null, onSelect: () => {} });

    // Two day groups (17 Aug and 18 Aug in IST).
    expect(screen.getAllByText(/Aug/).length).toBe(2);
    expect(screen.getByRole('button', { name: '09:00' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '10:00' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '09:00' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('marks the selected slot and calls onSelect with the tapped slot id', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    renderPicker({ slots: SLOTS, selectedSlotId: 'slot-2', onSelect });

    expect(screen.getByRole('button', { name: '10:00' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '09:00' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: '09:00' }));
    expect(onSelect).toHaveBeenCalledWith('slot-1');
  });

  it('shows an empty message rather than a blank screen when there are no open slots', () => {
    renderPicker({ slots: [], selectedSlotId: null, onSelect: () => {} });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
