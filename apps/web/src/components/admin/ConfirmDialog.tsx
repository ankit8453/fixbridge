'use client';

import { useState, type ReactNode } from 'react';
import { Button, ErrorState, Field, Modal, Select, TextArea, TextInput } from '@/components/ui';

/**
 * The confirmation dialog, with the reason field inside it. Ported from
 * apps/admin/src/components/ConfirmDialog.tsx onto the shared web UI kit
 * (`@/components/ui`) — the dialog's own logic is unchanged.
 *
 * Two separate rules meet here, and they are the reason this is one
 * component rather than a `window.confirm`:
 *
 *   1. **Every destructive or money action is confirmed.** Suspending
 *      somebody, cancelling their job, moving a payout — all of it is one
 *      click away from a list, and a misclick on a list is a normal human
 *      event.
 *   2. **The reason is typed in the same dialog.** The API makes a note
 *      mandatory on every one of these (`apps/api/src/modules/admin/types.ts`),
 *      because the note is what makes the audit row worth reading six
 *      months later. Asking for it in a second step would make "confirm"
 *      the decision and the note an afterthought — the exact inversion the
 *      audit trail exists to prevent.
 *
 * Client-side validation is a courtesy, not a control: it saves a round
 * trip and names the field, but the server's `min(3)` is the actual rule.
 */

export interface DialogField {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'select' | 'number';
  options?: { value: string; label: string }[];
  required?: boolean;
  /** Reason and note fields carry `minLength: 3` to match the API's schema. */
  minLength?: number;
  placeholder?: string;
  hint?: string;
  defaultValue?: string;
}

export type DialogValues = Record<string, string>;

const initialValues = (fields: DialogField[]): DialogValues =>
  Object.fromEntries(fields.map((field) => [field.name, field.defaultValue ?? '']));

function validate(fields: DialogField[], values: DialogValues): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const value = (values[field.name] ?? '').trim();

    if (field.required !== false && value === '') {
      errors[field.name] = `${field.label} is required.`;
      continue;
    }

    if (field.minLength && value !== '' && value.length < field.minLength) {
      errors[field.name] = `${field.label} must be at least ${field.minLength} characters.`;
    }
  }

  return errors;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  tone = 'primary',
  fields = [],
  pending = false,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  fields?: DialogField[];
  pending?: boolean;
  error?: unknown;
  onConfirm: (values: DialogValues) => void;
  onClose: () => void;
}) {
  /**
   * State is seeded once, on mount, and every call site mounts this
   * component only while its dialog is open. That is what guarantees a
   * fresh dialog per decision — a form still holding the previous row's
   * reason is how the wrong technician gets suspended.
   */
  const [values, setValues] = useState<DialogValues>(() => initialValues(fields));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (name: string, value: string) =>
    setValues((current) => ({ ...current, [name]: value }));

  const submit = () => {
    const found = validate(fields, values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    onConfirm(
      Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()])),
    );
  };

  return (
    <Modal title={title} onClose={onClose}>
      {/* Forms submit on Enter — ops work through these with a keyboard, and a
          dialog that only accepts a mouse click slows down the whole queue. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="space-y-3 px-4 py-4">
          {description ? <div className="text-sm text-slate-700">{description}</div> : null}

          {fields.map((field) => (
            <Field
              key={field.name}
              label={field.label}
              hint={field.hint}
              error={errors[field.name] ?? null}
            >
              {(id) =>
                field.type === 'textarea' ? (
                  <TextArea
                    id={id}
                    name={field.name}
                    value={values[field.name] ?? ''}
                    placeholder={field.placeholder}
                    onChange={(event) => set(field.name, event.target.value)}
                  />
                ) : field.type === 'select' ? (
                  <Select
                    id={id}
                    name={field.name}
                    value={values[field.name] ?? ''}
                    onChange={(event) => set(field.name, event.target.value)}
                  >
                    <option value="">Choose…</option>
                    {(field.options ?? []).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <TextInput
                    id={id}
                    name={field.name}
                    type={field.type === 'number' ? 'number' : 'text'}
                    value={values[field.name] ?? ''}
                    placeholder={field.placeholder}
                    onChange={(event) => set(field.name, event.target.value)}
                  />
                )
              }
            </Field>
          ))}

          {error ? <ErrorState error={error} /> : null}
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant={tone === 'danger' ? 'danger' : 'primary'}
            disabled={pending}
          >
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

/** The reason/note field every mutation in this surface needs. */
export const reasonField = (label = 'Reason', hint?: string): DialogField => ({
  name: 'reason',
  label,
  type: 'textarea',
  required: true,
  minLength: 3,
  hint: hint ?? 'Recorded in the audit log against your name.',
});

export const noteField = (label = 'Note', hint?: string): DialogField => ({
  ...reasonField(label, hint),
  name: 'note',
});
