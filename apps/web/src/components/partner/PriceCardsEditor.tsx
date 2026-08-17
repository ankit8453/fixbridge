'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useT } from '@/i18n/useT';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextInput } from '@/components/ui/Field';
import { ErrorState } from '@/components/ui/States';
import { formatPaise, parseRupeesToPaise } from '@/lib/money';
import { createPriceCard, deletePriceCard, updatePriceCard } from './lib/api';
import { partnerKeys } from './lib/query-keys';
import type { PriceType, ProviderPriceCardResponse, ProviderSkillResponse } from './lib/types';

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
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {priceCards.map((card) => (
          <li
            key={card.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{card.title}</p>
              <p className="text-xs text-slate-500">
                {card.categoryName} ·{' '}
                {card.priceType === 'inspection_based'
                  ? t('partner.pricing.inspectionBased')
                  : card.amountPaise !== null
                    ? formatPaise(card.amountPaise)
                    : '—'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge tone={card.isActive ? 'good' : 'neutral'}>
                {card.isActive ? t('partner.pricing.active') : t('partner.pricing.inactive')}
              </Badge>
              <Button
                variant="ghost"
                onClick={() => toggleActive.mutate(card)}
                disabled={toggleActive.isPending}
              >
                {card.isActive ? t('partner.pricing.pause') : t('partner.pricing.resume')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => remove.mutate(card.id)}
                disabled={remove.isPending}
              >
                {t('partner.common.delete')}
              </Button>
            </div>
          </li>
        ))}
        {priceCards.length === 0 ? (
          <p className="text-sm text-slate-500">{t('partner.pricing.emptyHint')}</p>
        ) : null}
      </ul>

      {skills.length === 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t('partner.pricing.needSkillFirst')}
        </p>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border border-dashed border-slate-300 p-3">
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
            <Field label={t('partner.pricing.amountLabel')} hint={t('partner.pricing.amountHint')}>
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

          {create.isError ? (
            <ErrorState error={create.error} onRetry={() => create.reset()} />
          ) : null}

          <Button
            variant="primary"
            disabled={!canCreate || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? t('partner.pricing.adding') : t('partner.pricing.add')}
          </Button>
        </div>
      )}
    </div>
  );
}
