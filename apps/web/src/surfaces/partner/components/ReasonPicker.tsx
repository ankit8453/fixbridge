import { useState } from 'react';
import { useT } from '../../../i18n/useT';
import { Button, Field, Modal, TextArea, ErrorState } from '../../../components/ui';

/**
 * A reason-code picker, shared by reject and cancel — both actions take a
 * `{ reason, note? }` from a fixed list, and both require a note when the
 * reason is `other` (docs/API.md: "other" without a note tells ops nothing
 * it can act on).
 */
export function ReasonPicker({
  title,
  reasons,
  reasonLabelKey,
  onClose,
  onSubmit,
  pending,
  error,
}: {
  title: string;
  reasons: readonly string[];
  reasonLabelKey: string;
  onClose: () => void;
  onSubmit: (reason: string, note?: string) => void;
  pending?: boolean;
  error?: unknown;
}) {
  const t = useT();
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const needsNote = reason === 'other';
  const canSubmit = reason !== null && (!needsNote || note.trim().length > 0);

  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex flex-col gap-3 p-4">
        <fieldset className="flex flex-col gap-2">
          {reasons.map((code) => (
            <label
              key={code}
              className="flex min-h-touch items-center gap-2 text-base text-slate-800"
            >
              <input
                type="radio"
                name="reason"
                value={code}
                checked={reason === code}
                onChange={() => setReason(code)}
                className="h-5 w-5"
              />
              {t(`${reasonLabelKey}.${code}`)}
            </label>
          ))}
        </fieldset>

        {needsNote ? (
          <Field label={t('partner.common.noteLabel')}>
            {(id) => (
              <TextArea
                id={id}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
              />
            )}
          </Field>
        ) : null}

        {error ? <ErrorState error={error} /> : null}

        <div className="flex gap-2">
          <Button variant="secondary" fullWidth onClick={onClose} disabled={pending}>
            {t('partner.common.cancel')}
          </Button>
          <Button
            variant="danger"
            fullWidth
            disabled={!canSubmit || pending}
            onClick={() => reason && onSubmit(reason, note.trim() || undefined)}
          >
            {pending ? t('partner.common.submitting') : t('partner.common.confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
