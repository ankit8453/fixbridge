'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useT } from '@/i18n/useT';
import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { ErrorState } from '@/components/ui/States';
import { refreshAccessToken } from '@/lib/auth/session';
import { registerProvider } from './lib/api';

/**
 * "Become a partner" — the whole reason `POST /providers/me/register` is open
 * to any authenticated user and not just technicians (docs/API.md §Providers).
 * Any customer landing on `/partner` sees this instead of a wall.
 */
export function BecomePartnerGate() {
  const t = useT();
  const [displayName, setDisplayName] = useState('');

  const mutation = useMutation({
    mutationFn: () => registerProvider(displayName.trim() || undefined),
    onSuccess: async () => {
      /**
       * Roles are baked into the access token (docs/API.md: "sign in again
       * or refresh"). `refreshAccessToken` rotates the in-memory token, but
       * `AuthProvider` (out of this surface's lane — `src/lib/**`) only
       * derives `roles` from that token on mount. A hard reload is the
       * honest way to get a fresh mount without touching a file this agent
       * does not own; a client-side re-render would keep showing this same
       * gate with the new role invisible until the next navigation anyway.
       */
      await refreshAccessToken();
      window.location.reload();
    },
  });

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{t('partner.gate.title')}</h1>
        <p className="mt-1 text-base text-slate-600">{t('partner.gate.pitch')}</p>
      </div>

      <ul className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
        <li>{t('partner.gate.bullet1')}</li>
        <li>{t('partner.gate.bullet2')}</li>
        <li>{t('partner.gate.bullet3')}</li>
      </ul>

      <Field label={t('partner.gate.nameLabel')} hint={t('partner.gate.nameHint')}>
        {(id) => (
          <TextInput
            id={id}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t('partner.gate.namePlaceholder')}
          />
        )}
      </Field>

      {mutation.isError ? (
        <ErrorState error={mutation.error} onRetry={() => mutation.reset()} />
      ) : null}

      <Button
        variant="primary"
        fullWidth
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? t('partner.gate.submitting') : t('partner.gate.submit')}
      </Button>
    </div>
  );
}
