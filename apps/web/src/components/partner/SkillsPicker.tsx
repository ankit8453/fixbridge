'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '@/i18n/useT';
import { QueryState } from '@/components/ui/States';
import { addSkill, fetchCategories, removeSkill } from './lib/api';
import { partnerKeys } from './lib/query-keys';
import type { CategoryNode, ProviderSkillResponse } from './lib/types';

/**
 * Leaf categories only (docs/API.md: "a technician does 'motor rewinding',
 * not 'Electrical'"). `GET /categories` nests two levels — a cluster's
 * `children` are the bookable services, a service's `children` is always
 * `[]` — so a node is a leaf exactly when its own `children` array is empty,
 * with no separate "is this a service" flag to keep in sync.
 */
function leavesByCluster(
  categories: CategoryNode[],
): { cluster: CategoryNode; leaves: CategoryNode[] }[] {
  return categories
    .map((cluster) => ({ cluster, leaves: cluster.children }))
    .filter((group) => group.leaves.length > 0);
}

export function SkillsPicker({ skills }: { skills: ProviderSkillResponse[] }) {
  const t = useT();
  const queryClient = useQueryClient();

  const categoriesQuery = useQuery({
    queryKey: partnerKeys.categories,
    queryFn: () => fetchCategories(),
  });

  const heldIds = new Set(skills.map((skill) => skill.categoryId));

  const add = useMutation({
    mutationFn: (categoryId: number) => addSkill(categoryId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: partnerKeys.profile }),
  });

  const remove = useMutation({
    mutationFn: (categoryId: number) => removeSkill(categoryId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: partnerKeys.profile }),
  });

  const pending = add.isPending || remove.isPending;

  return (
    <QueryState
      status={categoriesQuery.status}
      error={categoriesQuery.error}
      data={categoriesQuery.data}
      onRetry={() => categoriesQuery.refetch()}
    >
      {(data) => (
        <div className="flex flex-col gap-4">
          {leavesByCluster(data.categories).map(({ cluster, leaves }) => (
            <div key={cluster.id}>
              <h3 className="mb-2 text-sm font-semibold text-slate-600">{cluster.name}</h3>
              <div className="flex flex-wrap gap-2">
                {leaves.map((leaf) => {
                  const held = heldIds.has(leaf.id);
                  return (
                    <button
                      key={leaf.id}
                      type="button"
                      disabled={pending}
                      onClick={() => (held ? remove.mutate(leaf.id) : add.mutate(leaf.id))}
                      aria-pressed={held}
                      className={`min-h-touch rounded-full border px-4 text-sm font-medium transition-colors disabled:opacity-50 ${
                        held
                          ? 'border-brand bg-brand text-brand-foreground'
                          : 'border-slate-300 bg-white text-slate-700'
                      }`}
                    >
                      {leaf.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {skills.length === 0 ? (
            <p className="text-sm text-slate-500">{t('partner.skills.emptyHint')}</p>
          ) : null}
        </div>
      )}
    </QueryState>
  );
}
