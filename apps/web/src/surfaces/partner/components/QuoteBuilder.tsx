import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../../i18n/useT';
import { Button, ErrorState, Field, Select, TextArea, TextInput } from '../../../components/ui';
import { formatPaise, parseRupeesToPaise } from '../../../lib/money';
import { sendQuotation, type QuotationItemInput } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';
import { computeQuoteTotals, type QuoteMathReason } from '../lib/quote-math';

interface DraftLine {
  localId: string;
  kind: 'part' | 'labour_extra';
  description: string;
  qty: string;
  unitAmount: string;
}

function reasonKey(reason: QuoteMathReason): string {
  return `partner.quote.error.${reason}`;
}

let localIdCounter = 0;
function nextLocalId(): string {
  localIdCounter += 1;
  return `line-${localIdCounter}`;
}

/**
 * The line-item builder that turns into `POST /bookings/:id/quotations`
 * (description/qty/unit price, running total, send). Totals are recomputed
 * on every keystroke with the same arithmetic the server uses
 * (`lib/quote-math.ts`) so a technician sees the real number — and any cap
 * violation — before tapping send, not after a round trip on a job site's
 * patchy signal.
 */
export function QuoteBuilder({ bookingId, onSent }: { bookingId: string; onSent?: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();

  const [labourAmount, setLabourAmount] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);

  const send = useMutation({
    mutationFn: (input: { labourPaise: number; items: QuotationItemInput[]; note?: string }) =>
      sendQuotation(bookingId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: partnerKeys.booking(bookingId) });
      setLines([]);
      setLabourAmount('');
      setNote('');
      onSent?.();
    },
  });

  const labourPaise = labourAmount.trim() === '' ? 0 : (parseRupeesToPaise(labourAmount) ?? NaN);

  const parsedLines = lines.map((line) => ({
    ...line,
    qty: Number(line.qty),
    unitPaise: parseRupeesToPaise(line.unitAmount),
  }));

  const linesValid = parsedLines.every(
    (line) =>
      line.description.trim().length > 0 &&
      Number.isInteger(line.qty) &&
      line.qty >= 1 &&
      line.unitPaise !== null,
  );

  // Cheap enough to recompute every render — no `useMemo` needed, and one
  // less dependency array to keep honest as fields are added.
  const totals =
    !Number.isFinite(labourPaise) || !linesValid
      ? null
      : computeQuoteTotals(
          labourPaise,
          parsedLines.map((line) => ({ qty: line.qty, unitPaise: line.unitPaise ?? 0 })),
        );

  function addLine(kind: DraftLine['kind']) {
    setLines((prev) => [
      ...prev,
      { localId: nextLocalId(), kind, description: '', qty: '1', unitAmount: '' },
    ]);
  }

  function updateLine(localId: string, patch: Partial<DraftLine>) {
    setLines((prev) =>
      prev.map((line) => (line.localId === localId ? { ...line, ...patch } : line)),
    );
  }

  function removeLine(localId: string) {
    setLines((prev) => prev.filter((line) => line.localId !== localId));
  }

  function handleSend() {
    if (!totals || !totals.ok) return;

    send.mutate({
      labourPaise: Number.isFinite(labourPaise) ? labourPaise : 0,
      items: parsedLines.map((line) => ({
        kind: line.kind,
        description: line.description.trim(),
        qty: line.qty,
        unitPaise: line.unitPaise as number,
      })),
      note: note.trim() || undefined,
    });
  }

  const canSend = totals !== null && totals.ok && !send.isPending;

  return (
    <div className="flex flex-col gap-4">
      <Field label={t('partner.quote.labourLabel')} hint={t('partner.quote.labourHint')}>
        {(id) => (
          <TextInput
            id={id}
            inputMode="decimal"
            value={labourAmount}
            onChange={(e) => setLabourAmount(e.target.value)}
            placeholder="0"
          />
        )}
      </Field>

      <ul className="flex flex-col gap-3">
        {lines.map((line) => (
          <li key={line.localId} className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <Select
                aria-label={t('partner.quote.kindLabel')}
                value={line.kind}
                onChange={(e) =>
                  updateLine(line.localId, { kind: e.target.value as DraftLine['kind'] })
                }
                className="w-auto"
              >
                <option value="part">{t('partner.quote.kind.part')}</option>
                <option value="labour_extra">{t('partner.quote.kind.labourExtra')}</option>
              </Select>
              <button
                type="button"
                onClick={() => removeLine(line.localId)}
                className="min-h-touch px-2 text-sm font-medium text-danger"
              >
                {t('partner.common.delete')}
              </button>
            </div>
            <TextInput
              aria-label={t('partner.quote.descriptionLabel')}
              value={line.description}
              onChange={(e) => updateLine(line.localId, { description: e.target.value })}
              placeholder={t('partner.quote.descriptionPlaceholder')}
              className="mb-2"
            />
            <div className="grid grid-cols-2 gap-2">
              <TextInput
                aria-label={t('partner.quote.qtyLabel')}
                inputMode="numeric"
                value={line.qty}
                onChange={(e) => updateLine(line.localId, { qty: e.target.value })}
              />
              <TextInput
                aria-label={t('partner.quote.unitPriceLabel')}
                inputMode="decimal"
                value={line.unitAmount}
                onChange={(e) => updateLine(line.localId, { unitAmount: e.target.value })}
                placeholder={t('partner.quote.unitPricePlaceholder')}
              />
            </div>
            {line.qty !== '' &&
            line.unitAmount !== '' &&
            Number.isInteger(Number(line.qty)) &&
            parseRupeesToPaise(line.unitAmount) !== null ? (
              <p className="mt-1 text-right text-sm text-muted">
                {formatPaise(Number(line.qty) * (parseRupeesToPaise(line.unitAmount) ?? 0))}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => addLine('part')}>
          {t('partner.quote.addPart')}
        </Button>
        <Button variant="secondary" onClick={() => addLine('labour_extra')}>
          {t('partner.quote.addLabourExtra')}
        </Button>
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

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex items-center justify-between text-sm text-slate-600">
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
