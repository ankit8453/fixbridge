import type { AppContext } from '../../core/context';
import { AppError } from '../../core/errors';
import * as repo from './repository';
import {
  planSlots,
  reconcileSlots,
  type AvailabilityTemplateLike,
  type ExistingSlotLike,
} from './slot-plan';
import type { OwnSlot, ProviderSlotsQuery, PublicSlot } from './types';

export interface SlotGenerationResult {
  providerId: string;
  created: number;
  deleted: number;
  preserved: number;
}

/**
 * Materialises one provider's slots over the rolling horizon.
 *
 * Idempotent: it diffs what the templates imply against what exists, so running
 * it twice in a row changes nothing the second time. That is what lets the
 * nightly job simply re-run rather than track where it got to.
 */
export async function generateSlotsForProvider(
  context: AppContext,
  providerId: string,
  now: Date = new Date(),
): Promise<SlotGenerationResult> {
  const templates = await context.prisma.providerAvailabilityTemplate.findMany({
    where: { providerId },
  });

  const horizonEnd = new Date(
    now.getTime() + context.config.SLOT_HORIZON_DAYS * 24 * 60 * 60 * 1000,
  );

  const planned = planSlots(templates as AvailabilityTemplateLike[], {
    from: now,
    horizonDays: context.config.SLOT_HORIZON_DAYS,
    incrementMinutes: context.config.SLOT_INCREMENT_MINUTES,
    notBefore: now,
  });

  const existing = (await repo.listExistingSlotsForPlanning(
    context.prisma,
    providerId,
    now,
    horizonEnd,
  )) as ExistingSlotLike[];

  const plan = reconcileSlots(planned, existing);
  const { created, deleted } = await repo.applySlotPlan(
    context.prisma,
    providerId,
    plan.toCreate,
    plan.toDeleteIds,
  );

  return { providerId, created, deleted, preserved: plan.preservedIds.length };
}

/**
 * Extends the horizon for every listed provider.
 *
 * Only listed providers: materialising slots for somebody nobody can find is
 * work for nothing, and they get generated the moment their profile goes live.
 */
export async function generateSlotsForAllProviders(
  context: AppContext,
  now: Date = new Date(),
): Promise<{ providers: number; created: number; deleted: number }> {
  const providers = await context.prisma.providerProfile.findMany({
    where: { isListed: true },
    select: { userId: true },
  });

  let created = 0;
  let deleted = 0;

  for (const provider of providers) {
    const result = await generateSlotsForProvider(context, provider.userId, now);
    created += result.created;
    deleted += result.deleted;
  }

  context.logger.info(
    {
      providers: providers.length,
      created,
      deleted,
      horizonDays: context.config.SLOT_HORIZON_DAYS,
    },
    'slot horizon extended',
  );

  return { providers: providers.length, created, deleted };
}

/** Public availability for one provider. Only `open` — nothing about who booked what. */
export async function listPublicSlots(
  context: AppContext,
  providerId: string,
  query: ProviderSlotsQuery,
): Promise<PublicSlot[]> {
  const spanDays = (query.to.getTime() - query.from.getTime()) / (24 * 60 * 60 * 1000);

  if (spanDays > context.config.SLOT_HORIZON_DAYS) {
    throw AppError.badRequest(
      `The window may span at most ${context.config.SLOT_HORIZON_DAYS} days`,
      { messageKey: 'errors.bookings.windowTooWide' },
    );
  }

  const slots = await repo.listProviderSlots(context.prisma, providerId, query.from, query.to, [
    'open',
  ]);

  return slots.map((slot) => ({
    id: slot.id,
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
  }));
}

/**
 * A technician's **own** calendar, including the parts nobody else may see.
 *
 * `listPublicSlots` deliberately returns only `open` slots, because which hours
 * are booked and when somebody took an afternoon off is nobody else's business.
 * That same discretion made the technician's own calendar unusable: Phase 6 gave
 * them a block button and no way to see what they had blocked, so un-blocking
 * was only possible in the same browser session that blocked it.
 *
 * The fix is a separate endpoint rather than a flag on the public one — an
 * `?includeBlocked=true` that gated on the caller's identity would be one
 * forgotten check away from publishing everybody's day.
 */
export async function listOwnSlots(
  context: AppContext,
  providerId: string,
  query: ProviderSlotsQuery,
): Promise<OwnSlot[]> {
  const spanDays = (query.to.getTime() - query.from.getTime()) / (24 * 60 * 60 * 1000);

  if (spanDays > context.config.SLOT_HORIZON_DAYS) {
    throw AppError.badRequest(
      `The window may span at most ${context.config.SLOT_HORIZON_DAYS} days`,
      {
        messageKey: 'errors.bookings.windowTooWide',
      },
    );
  }

  const slots = await repo.listProviderSlots(context.prisma, providerId, query.from, query.to, [
    'open',
    'blocked',
    'booked',
  ]);

  return slots.map((slot) => ({
    id: slot.id,
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
    status: slot.status,
    /**
     * The booking id only for their own booked slots, so the week view can link
     * straight to the job. It is their booking; there is nothing to withhold.
     */
    bookingId: slot.bookingId,
  }));
}

/** A technician taking time off. Only their own, and only open time. */
export async function setSlotBlocked(
  context: AppContext,
  providerId: string,
  slotId: string,
  blocked: boolean,
): Promise<PublicSlot> {
  const slot = await repo.toggleSlotBlocked(context.prisma, providerId, slotId, blocked);

  if (!slot) {
    // Either not theirs, or not in a state that can be toggled — a booked slot
    // cannot be blocked away from under the customer who holds it.
    throw new AppError(409, 'SLOT_NOT_TOGGLEABLE', 'That slot cannot be changed', {
      messageKey: 'errors.bookings.slotNotToggleable',
    });
  }

  return {
    id: slot.id,
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
  };
}
