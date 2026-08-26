import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useT } from '../../../i18n/useT';
import { Button, ErrorState, Field, TextArea, TextInput } from '../../../components/ui';
import { formatPaise, parseRupeesToPaise } from '../../../lib/money';
import { sendQuotation, type QuotationItemInput } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';
import { computeQuoteTotals, type QuoteMathReason } from '../lib/quote-math';
import type { AgreedLabour } from '../lib/types';

interface DraftPart {
  localId: string;
  description: string;
  qty: string;
  unitAmount: string;
}

/** The customer must be able to read this and understand the charge. */
const MIN_EXTRA_REASON = 10;

function reasonKey(reason: QuoteMathReason): string {
  return `partner.quote.error.${reason}`;
}

let localIdCounter = 0;
function nextLocalId(): string {
  localIdCounter += 1;
  return `line-${localIdCounter}`;
}

/**
 * The quotation builder.
 *
 * Built around one rule: **the labour the customer agreed to is not something
 * the technician retypes.** A `fixed` rate card is shown locked and sent
 * verbatim; `starting_from` is a floor the technician may exceed; only an
 * `inspection_based` booking (or one made with no card at all) leaves labour
 * genuinely open.
 *
 * Anything above the agreed figure is *extra labour*, and extra labour always
 * travels with a written reason the customer reads before approving. That is
 * the whole transparency promise on the marketing site, and it is enforced
 * server-side too (`quotations/labour.ts`) — this form exists so a technician
 * meets the rule while typing, instead of discovering it in a 400 after
 * tapping send on a job site's patchy signal.
 *
 * Totals recompute on every keystroke with the same arithmetic the server uses
 * (`lib/quote-math.ts`).
 */
export function QuoteBuilder({
  bookingId,
  agreedLabour,
  onSent,
}: {
  bookingId: string;
  agreedLabour: AgreedLabour;
  onSent?: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();

  /** Locked exactly when the customer booked a fixed price. */
  const labourIsLocked = agreedLabour.priceType === 'fixed' && agreedLabour.amountPaise !== null;
  /** A floor: the technician may go above it, never below. */
  const labourIsFloor =
    agreedLabour.priceType === 'starting_from' && agreedLabour.amountPaise !== null;
  const agreedPaise = agreedLabour.amountPaise ?? 0;

  // Only an inspection booking (or one with no card) asks for a base figure.
  const [openLabourAmount, setOpenLabourAmount] = useState('');
  const [extra, setExtra] = useState<{ amount: string; reason: string } | null>(null);
  const [note, setNote] = useState('');
  const [parts, setParts] = useState<DraftPart[]>([]);

  const send = useMutation({
    mutationFn: (input: {
      labourPaise: number;
      agreedLabourPaise?: number;
      extraLabourPaise?: number;
      extraLabourReason?: string;
      items: QuotationItemInput[];
      note?: string;
    }) => sendQuotation(bookingId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: partnerKeys.booking(bookingId) });
      setParts([]);
      setExtra(null);
      setOpenLabourAmount('');
      setNote('');
      onSent?.();
    },
  });

  const basePaise =
    labourIsLocked || labourIsFloor
      ? agreedPaise
      : openLabourAmount.trim() === ''
        ? 0
        : (parseRupeesToPaise(openLabourAmount) ?? NaN);

  const extraPaise =
    extra === null ? 0 : extra.amount.trim() === '' ? 0 : (parseRupeesToPaise(extra.amount) ?? NaN);

  const extraReasonOk =
    extra === null || extraPaise === 0 || extra.reason.trim().length >= MIN_EXTRA_REASON;

  const parsedParts = parts.map((part) => ({
    ...part,
    qty: Number(part.qty),
    unitPaise: parseRupeesToPaise(part.unitAmount),
  }));

  const partsValid = parsedParts.every(
    (part) =>
      part.description.trim().length > 0 &&
      Number.isInteger(part.qty) &&
      part.qty >= 1 &&
      part.unitPaise !== null,
  );

  const labourPaise = basePaise + (Number.isFinite(extraPaise) ? extraPaise : NaN);

  const totals =
    !Number.isFinite(labourPaise) || !partsValid
      ? null
      : computeQuoteTotals(
          labourPaise,
          parsedParts.map((part) => ({ qty: part.qty, unitPaise: part.unitPaise ?? 0 })),
        );

  function addPart() {
    setParts((prev) => [
      ...prev,
      { localId: nextLocalId(), description: '', qty: '1', unitAmount: '' },
    ]);
  }

  function updatePart(localId: string, patch: Partial<DraftPart>) {
    setParts((prev) =>
      prev.map((part) => (part.localId === localId ? { ...part, ...patch } : part)),
    );
  }

  function removePart(localId: string) {
    setParts((prev) => prev.filter((part) => part.localId !== localId));
  }

  function handleSend() {
    if (!totals || !totals.ok || !extraReasonOk) return;

    const hasAnchor = agreedLabour.priceType !== null && agreedLabour.amountPaise !== null;

    send.mutate({
      labourPaise,
      // The split travels explicitly so the server never has to infer which
      // part of the figure was agreed and which is new.
      ...(hasAnchor ? { agreedLabourPaise: agreedPaise } : {}),
      ...(extraPaise > 0
        ? { extraLabourPaise: extraPaise, extraLabourReason: extra?.reason.trim() }
        : {}),
      items: parsedParts.map((part) => ({
        kind: 'part' as const,
        description: part.description.trim(),
        qty: part.qty,
        unitPaise: part.unitPaise as number,
      })),
      note: note.trim() || undefined,
    });
  }

  const canSend = totals !== null && totals.ok && extraReasonOk && !send.isPending;

  const agreedHint = labourIsLocked
    ? t('partner.quote.agreedFixed')
    : labourIsFloor
      ? t('partner.quote.agreedFloor')
      : agreedLabour.priceType === 'inspection_based'
        ? t('partner.quote.agreedOpen')
        : t('partner.quote.agreedNone');

  return (
    <div className="flex flex-col gap-4">
      {/* ---------------- Agreed labour ---------------- */}
      {labourIsLocked || labourIsFloor ? (
        /*
          Shown, not editable. The figure the customer agreed to is the anchor
          the whole pricing promise rests on — a text box here would invite the
          exact substitution ("listed ₹300, billed ₹500") the rules exist to
          stop, and the server would reject it anyway.
        */
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-sm font-medium text-slate-600">
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" strokeWidth={2.25} />
              {t('partner.quote.agreedHeading')}
            </span>
            <span className="text-lg font-semibold tabular-nums text-slate-900">
              {formatPaise(agreedPaise)}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{agreedHint}</p>
        </div>
      ) : (
        <Field label={t('partner.quote.openLabourLabel')} hint={agreedHint}>
          {(id) => (
            <TextInput
              id={id}
              inputMode="decimal"
              value={openLabourAmount}
              onChange={(e) => setOpenLabourAmount(e.target.value)}
              placeholder="0"
            />
          )}
        </Field>
      )}

      {/* ---------------- Extra labour ---------------- */}
      {extra !== null ? (
        <div className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/5 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900">
              {t('partner.quote.extraHeading')}
            </span>
            <button
              type="button"
              onClick={() => setExtra(null)}
              className="min-h-touch px-2 text-sm font-medium text-danger"
            >
              {t('partner.common.delete')}
            </button>
          </div>

          <Field label={t('partner.quote.extraAmountLabel')}>
            {(id) => (
              <TextInput
                id={id}
                inputMode="decimal"
                value={extra.amount}
                onChange={(e) => setExtra({ ...extra, amount: e.target.value })}
                placeholder="0"
              />
            )}
          </Field>

          {/*
            Mandatory, and the customer reads it verbatim before approving.
            This is the difference between a bill that can be questioned and
            one that just went up.
          */}
          <Field
            label={t('partner.quote.extraReasonLabel')}
            hint={t('partner.quote.extraReasonHint')}
          >
            {(id) => (
              <TextArea
                id={id}
                value={extra.reason}
                onChange={(e) => setExtra({ ...extra, reason: e.target.value })}
                placeholder={t('partner.quote.extraReasonPlaceholder')}
                maxLength={300}
              />
            )}
          </Field>

          {!extraReasonOk ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {t('partner.quote.error.reason_too_short')}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ---------------- Parts ---------------- */}
      <ul className="flex flex-col gap-3">
        {parts.map((part) => (
          <li key={part.localId} className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">
                {t('partner.quote.kind.part')}
              </span>
              <button
                type="button"
                onClick={() => removePart(part.localId)}
                className="min-h-touch px-2 text-sm font-medium text-danger"
              >
                {t('partner.common.delete')}
              </button>
            </div>
            <TextInput
              aria-label={t('partner.quote.descriptionLabel')}
              value={part.description}
              onChange={(e) => updatePart(part.localId, { description: e.target.value })}
              placeholder={t('partner.quote.descriptionPlaceholder')}
              className="mb-2"
            />
            <div className="grid grid-cols-2 gap-2">
              <TextInput
                aria-label={t('partner.quote.qtyLabel')}
                inputMode="numeric"
                value={part.qty}
                onChange={(e) => updatePart(part.localId, { qty: e.target.value })}
              />
              <TextInput
                aria-label={t('partner.quote.unitPriceLabel')}
                inputMode="decimal"
                value={part.unitAmount}
                onChange={(e) => updatePart(part.localId, { unitAmount: e.target.value })}
                placeholder={t('partner.quote.unitPricePlaceholder')}
              />
            </div>
            {part.qty !== '' &&
            part.unitAmount !== '' &&
            Number.isInteger(Number(part.qty)) &&
            parseRupeesToPaise(part.unitAmount) !== null ? (
              <p className="mt-1 text-right text-sm text-muted">
                {formatPaise(Number(part.qty) * (parseRupeesToPaise(part.unitAmount) ?? 0))}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={addPart}>
          {t('partner.quote.addPart')}
        </Button>
        {extra === null ? (
          <Button variant="secondary" onClick={() => setExtra({ amount: '', reason: '' })}>
            {t('partner.quote.addExtraLabour')}
          </Button>
        ) : null}
      </div>

      <Field label={t('partner.quote.noteLabel')}>
        {(id) => (
          <TextArea
            id={id}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
          />
        )}
      </Field>

      {/* ---------------- Total ---------------- */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        {/* Itemised rather than one figure: the technician should see the same
            breakdown the customer will, before sending it. */}
        <dl className="flex flex-col gap-1 text-sm text-slate-600">
          <div className="flex items-center justify-between">
            <dt>{t('partner.quote.labourLine')}</dt>
            <dd className="tabular-nums">
              {formatPaise(Number.isFinite(basePaise) ? basePaise : 0)}
            </dd>
          </div>
          {extraPaise > 0 ? (
            <div className="flex items-center justify-between">
              <dt>{t('partner.quote.extraLine')}</dt>
              <dd className="tabular-nums">{formatPaise(extraPaise)}</dd>
            </div>
          ) : null}
        </dl>

        <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2 text-sm text-slate-600">
          <span>{t('partner.quote.runningTotal')}</span>
          <span
            data-testid="quote-total"
            className="text-lg font-semibold tabular-nums text-slate-900"
          >
            {totals && totals.ok ? formatPaise(totals.totalPaise) : '—'}
          </span>
        </div>
        {totals && !totals.ok ? (
          <p role="alert" className="mt-1 text-sm font-medium text-danger">
            {t(reasonKey(totals.reason))}
          </p>
        ) : null}
      </div>

      {send.isError ? <ErrorState error={send.error} onRetry={() => send.reset()} /> : null}

      <Button variant="primary" fullWidth disabled={!canSend} onClick={handleSend}>
        {send.isPending ? t('partner.quote.sending') : t('partner.quote.send')}
      </Button>
    </div>
  );
}
