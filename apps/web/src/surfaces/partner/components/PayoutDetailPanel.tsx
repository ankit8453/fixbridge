import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, QrCode } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Field, TextInput } from '../../../components/ui/Field';
import { QueryState } from '../../../components/ui';
import { useT } from '../../../i18n/useT';
import { ApiError } from '../../../lib/api';
import { Panel } from './ui';
import { fetchPayoutDetail, savePayoutDetail } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';
import type { PayoutDetailInput } from '../lib/types';

/**
 * Where a technician's earnings are sent.
 *
 * Lives on Earnings rather than in a settings page, directly under the balance:
 * the moment somebody has money owing is the only moment this form is worth
 * filling in, and the only moment it will be. Buried anywhere else, the first
 * they learn it exists is a payout run that skipped them.
 *
 * Bank or UPI, and neither is the lesser answer. A great many technicians in
 * Jabalpur have a UPI ID and could not recite an IFSC; sending them off to find
 * one is how you lose somebody at the last step before getting paid.
 */
export function PayoutDetailPanel() {
  const t = useT();
  const queryClient = useQueryClient();

  const detailQuery = useQuery({
    queryKey: partnerKeys.payoutDetail,
    queryFn: fetchPayoutDetail,
  });

  const saved = detailQuery.data?.payoutDetail ?? null;
  const [editing, setEditing] = useState(false);

  return (
    <Panel title={t('partner.payout.title')}>
      <QueryState
        status={detailQuery.status}
        error={detailQuery.error}
        data={detailQuery.data}
      >
        {() =>
          editing ? (
            <PayoutForm
              initialMethod={saved?.method ?? 'upi'}
              initialIfsc={saved?.ifsc ?? ''}
              initialHolder={saved?.accountHolder ?? ''}
              initialUpi={saved?.upiId ?? ''}
              hasPan={saved?.panMasked !== null && saved?.panMasked !== undefined}
              onCancel={() => setEditing(false)}
              onSaved={async () => {
                await queryClient.invalidateQueries({ queryKey: partnerKeys.payoutDetail });
                setEditing(false);
              }}
            />
          ) : (
            <div className="space-y-3">
              {saved ? (
                <>
                  <p className="text-sm text-muted">{t('partner.payout.currentLabel')}</p>
                  <p className="text-base font-medium text-slate-900 break-all">
                    {saved.method === 'bank'
                      ? `${saved.accountNumberMasked ?? ''} · ${saved.ifsc ?? ''}`
                      : saved.upiId}
                  </p>
                  {saved.method === 'bank' && saved.accountHolder ? (
                    <p className="text-sm text-muted">{saved.accountHolder}</p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm font-medium text-warning">{t('partner.payout.missing')}</p>
              )}

              <Button variant="secondary" onClick={() => setEditing(true)}>
                {saved ? t('partner.payout.change') : t('partner.payout.add')}
              </Button>
            </div>
          )
        }
      </QueryState>
    </Panel>
  );
}

function PayoutForm({
  initialMethod,
  initialIfsc,
  initialHolder,
  initialUpi,
  hasPan,
  onCancel,
  onSaved,
}: {
  initialMethod: 'bank' | 'upi';
  initialIfsc: string;
  initialHolder: string;
  initialUpi: string;
  hasPan: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useT();

  const [method, setMethod] = useState<'bank' | 'upi'>(initialMethod);
  // Everything except the account number is prefilled, because everything
  // except the account number comes back from the API whole.
  const [account, setAccount] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ifsc, setIfsc] = useState(initialIfsc);
  const [holder, setHolder] = useState(initialHolder);
  const [upi, setUpi] = useState(initialUpi);
  const [pan, setPan] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (input: PayoutDetailInput) => savePayoutDetail(input),
    onSuccess: onSaved,
    onError: (cause: unknown) => {
      setError(cause instanceof ApiError ? cause.message : t('common.errorGeneric'));
    },
  });

  const isBank = method === 'bank';

  /** Only decides whether the button is pressable. The real rules are the API's. */
  const canSave = isBank
    ? account.trim().length >= 9 &&
      confirm.trim().length > 0 &&
      ifsc.trim().length === 11 &&
      holder.trim().length >= 2
    : upi.trim().includes('@');

  function submit() {
    setError(null);

    // Checked here as well as on the server so the answer is instant — and on
    // the server too, because this one is worth being certain about: a
    // wrong-but-valid account number pays a stranger and there is no undo.
    if (isBank && account.trim() !== confirm.trim()) {
      setError(t('partner.payout.mismatch'));
      return;
    }

    const trimmedPan = pan.trim();

    mutation.mutate(
      isBank
        ? {
            method: 'bank',
            accountNumber: account.trim(),
            confirmAccountNumber: confirm.trim(),
            ifsc: ifsc.trim().toUpperCase(),
            accountHolder: holder.trim(),
            // Omitted entirely when blank. An empty string would fail the
            // format check on a field deliberately left alone.
            ...(trimmedPan ? { pan: trimmedPan.toUpperCase() } : {}),
          }
        : {
            method: 'upi',
            upiId: upi.trim().toLowerCase(),
            ...(trimmedPan ? { pan: trimmedPan.toUpperCase() } : {}),
          },
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t('partner.payout.warning')}</p>

      <div className="grid grid-cols-2 gap-3">
        <MethodTile
          label={t('partner.payout.methodUpi')}
          caption={t('partner.payout.methodUpiCaption')}
          icon={<QrCode size={18} />}
          selected={!isBank}
          onSelect={() => {
            setMethod('upi');
            setError(null);
          }}
        />
        <MethodTile
          label={t('partner.payout.methodBank')}
          caption={t('partner.payout.methodBankCaption')}
          icon={<Landmark size={18} />}
          selected={isBank}
          onSelect={() => {
            setMethod('bank');
            setError(null);
          }}
        />
      </div>

      {isBank ? (
        <>
          <Field label={t('partner.payout.accountNumber')}>
            {(id) => (
              <TextInput
                id={id}
                inputMode="numeric"
                autoComplete="off"
                maxLength={18}
                value={account}
                onChange={(e) => setAccount(e.target.value.replace(/\D/g, ''))}
              />
            )}
          </Field>
          <Field label={t('partner.payout.confirmAccountNumber')}>
            {(id) => (
              <TextInput
                id={id}
                inputMode="numeric"
                autoComplete="off"
                maxLength={18}
                // Pasting defeats the point of typing it twice — the same
                // wrong number lands in both boxes and looks confirmed.
                onPaste={(e) => e.preventDefault()}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))}
              />
            )}
          </Field>
          <Field label={t('partner.payout.ifsc')} hint="HDFC0001234">
            {(id) => (
              <TextInput
                id={id}
                autoComplete="off"
                maxLength={11}
                value={ifsc}
                onChange={(e) => setIfsc(e.target.value.toUpperCase())}
              />
            )}
          </Field>
          <Field label={t('partner.payout.accountHolder')}>
            {(id) => (
              <TextInput
                id={id}
                autoComplete="off"
                maxLength={120}
                value={holder}
                onChange={(e) => setHolder(e.target.value)}
              />
            )}
          </Field>
        </>
      ) : (
        <Field label={t('partner.payout.upiId')} hint={t('partner.payout.upiHint')}>
          {(id) => (
            <TextInput
              id={id}
              autoComplete="off"
              maxLength={120}
              placeholder="yourname@okhdfcbank"
              value={upi}
              onChange={(e) => setUpi(e.target.value)}
            />
          )}
        </Field>
      )}

      <Field
        label={t('partner.payout.pan')}
        hint={hasPan ? t('partner.payout.panKeep') : t('partner.payout.panHint')}
      >
        {(id) => (
          <TextInput
            id={id}
            autoComplete="off"
            maxLength={10}
            placeholder="ABCDE1234F"
            value={pan}
            onChange={(e) => setPan(e.target.value.toUpperCase())}
          />
        )}
      </Field>

      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex gap-3">
        <Button
          variant="primary"
          loading={mutation.isPending}
          disabled={!canSave}
          onClick={submit}
        >
          {t('common.save')}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={mutation.isPending}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}

function MethodTile({
  label,
  caption,
  icon,
  selected,
  onSelect,
}: {
  label: string;
  caption: string;
  icon: React.ReactNode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex min-h-touch flex-col items-start gap-1 rounded-lg border p-3 text-left transition ${
        selected
          ? 'border-slate-900 bg-slate-50 text-slate-900'
          : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
      }`}
    >
      <span className={selected ? 'text-slate-900' : 'text-slate-400'}>{icon}</span>
      <span className="text-sm font-medium">{label}</span>
      <span className="text-sm text-muted">{caption}</span>
    </button>
  );
}
