import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, IndianRupee, Plus, Trash2 } from 'lucide-react';
import { useT } from '../../../i18n/useT';
import { Button, ErrorState, Field, Select, TextInput } from '../../../components/ui';
import { formatPaise, parseRupeesToPaise } from '../../../lib/money';
import { createPriceCard, deletePriceCard, updatePriceCard } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';
import { EmptyState, StatusPill } from './ui';
import type { PriceType, ProviderPriceCardResponse, ProviderSkillResponse } from '../lib/types';

const PRICE_TYPES: PriceType[] = ['fixed', 'starting_from', 'inspection_based'];

export function PriceCardsEditor({
  priceCards,
  skills,
}: {
  priceCards: ProviderPriceCardResponse[];
  skills: ProviderSkillResponse[];
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: partnerKeys.profile });

  const [categoryId, setCategoryId] = useState<number | null>(skills[0]?.categoryId ?? null);
  const [title, setTitle] = useState('');
  const [priceType, setPriceType] = useState<PriceType>('fixed');
  const [amount, setAmount] = useState('');

  const create = useMutation({
    mutationFn: () => {
      const amountPaise =
        priceType === 'inspection_based' ? undefined : (parseRupeesToPaise(amount) ?? undefined);
      return createPriceCard({
        categoryId: categoryId as number,
        title: title.trim(),
        priceType,
        amountPaise,
      });
    },
    onSuccess: () => {
      invalidate();
      setTitle('');
      setAmount('');
    },
  });

  const toggleActive = useMutation({
    mutationFn: (card: ProviderPriceCardResponse) =>
      updatePriceCard(card.id, { isActive: !card.isActive }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deletePriceCard(id),
    onSuccess: invalidate,
  });

  const canCreate =
    categoryId !== null &&
    title.trim().length > 0 &&
    (priceType === 'inspection_based' || parseRupeesToPaise(amount) !== null);

  return (
    <div className="flex flex-col gap-5">
      {/* Existing cards first — this section is read far more often than it
          is added to, and the add form below is the secondary act. */}
      {priceCards.length === 0 ? (
        <EmptyState
          icon={IndianRupee}
          title={t('partner.pricing.emptyHint')}
          description={t('partner.pricing.emptyDescription')}
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {priceCards.map((card) => (
            <li
              key={card.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-slate-900">{card.title}</p>
                  <StatusPill tone={card.isActive ? 'success' : 'neutral'}>
                    {card.isActive ? t('partner.pricing.active') : t('partner.pricing.inactive')}
                  </StatusPill>
                </div>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {card.categoryName} ·{' '}
                  <span className="font-medium tabular-nums text-slate-700">
                    {card.priceType === 'inspection_based'
                      ? t('partner.pricing.inspectionBased')
                      : card.amountPaise !== null
                        ? formatPaise(card.amountPaise)
                        : '—'}
                  </span>
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleActive.mutate(card)}
                  disabled={toggleActive.isPending}
                >
                  {card.isActive ? t('partner.pricing.pause') : t('partner.pricing.resume')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove.mutate(card.id)}
                  disabled={remove.isPending}
                  aria-label={t('partner.common.delete')}
                  className="text-danger hover:bg-danger/10"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {skills.length === 0 ? (
        <p className="flex items-start gap-2.5 rounded-lg bg-warning/10 px-3 py-2.5 text-sm leading-relaxed text-slate-700 ring-1 ring-inset ring-warning/20">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-warning"
            aria-hidden="true"
            strokeWidth={2.25}
          />
          {t('partner.pricing.needSkillFirst')}
        </p>
      ) : (
        <div className="max-w-2xl rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t('partner.pricing.addTitle')}
          </h4>

          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t('partner.pricing.categoryLabel')}>
                {(id) => (
                  <Select
                    id={id}
                    value={categoryId ?? ''}
                    onChange={(e) => setCategoryId(Number(e.target.value))}
                  >
                    {skills.map((skill) => (
                      <option key={skill.categoryId} value={skill.categoryId}>
                        {skill.categoryName}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label={t('partner.pricing.titleLabel')}>
                {(id) => (
                  <TextInput
                    id={id}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t('partner.pricing.titlePlaceholder')}
                  />
                )}
              </Field>

              <Field label={t('partner.pricing.typeLabel')}>
                {(id) => (
                  <Select
                    id={id}
                    value={priceType}
                    onChange={(e) => setPriceType(e.target.value as PriceType)}
                  >
                    {PRICE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`partner.pricing.type.${type}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              {priceType !== 'inspection_based' ? (
                <Field
                  label={t('partner.pricing.amountLabel')}
                  hint={t('partner.pricing.amountHint')}
                >
                  {(id) => (
                    <TextInput
                      id={id}
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="500"
                    />
                  )}
                </Field>
              ) : null}
            </div>

            {create.isError ? (
              <ErrorState error={create.error} onRetry={() => create.reset()} />
            ) : null}

            <div>
              <Button
                variant="primary"
                loading={create.isPending}
                disabled={!canCreate}
                onClick={() => create.mutate()}
              >
                {create.isPending ? null : (
                  <Plus className="h-4 w-4" aria-hidden="true" strokeWidth={2.25} />
                )}
                {create.isPending ? t('partner.pricing.adding') : t('partner.pricing.add')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
