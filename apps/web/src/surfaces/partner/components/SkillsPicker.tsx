import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Info } from 'lucide-react';
import { useT } from '../../../i18n/useT';
import { useActionToast } from '../../../lib/use-action-toast';
import { QueryState } from '../../../components/ui';
import { addSkill, fetchCategories, removeSkill } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';
import type { CategoryNode, ProviderSkillResponse } from '../lib/types';

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
  const toast = useActionToast();

  const categoriesQuery = useQuery({
    queryKey: partnerKeys.categories,
    queryFn: () => fetchCategories(),
  });

  const heldIds = new Set(skills.map((skill) => skill.categoryId));

  const add = useMutation({
    mutationFn: (categoryId: number) => addSkill(categoryId),
    onError: (error) => toast.failed(error),
    onSuccess: (result) => {
      toast.succeeded(result);
      void queryClient.invalidateQueries({ queryKey: partnerKeys.profile });
    },
  });

  const remove = useMutation({
    mutationFn: (categoryId: number) => removeSkill(categoryId),
    onError: (error) => toast.failed(error),
    onSuccess: (result) => {
      toast.succeeded(result);
      void queryClient.invalidateQueries({ queryKey: partnerKeys.profile });
    },
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
        <div className="flex flex-col gap-5">
          {/* The hint leads rather than trailing the list: it explains what
              the chips below are *for*, which is no use read afterwards. */}
          {skills.length === 0 ? (
            <p className="flex items-start gap-2.5 rounded-lg bg-brand/5 px-3 py-2.5 text-sm leading-relaxed text-slate-700 ring-1 ring-inset ring-brand/15">
              <Info
                className="mt-0.5 h-4 w-4 shrink-0 text-brand"
                aria-hidden="true"
                strokeWidth={2.25}
              />
              {t('partner.skills.emptyHint')}
            </p>
          ) : (
            <p className="text-sm text-slate-500">
              {t('partner.skills.selectedCount', { count: skills.length })}
            </p>
          )}

          {leavesByCluster(data.categories).map(({ cluster, leaves }) => (
            <div key={cluster.id}>
              <h4 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {cluster.name}
              </h4>
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
                      className={`inline-flex min-h-touch items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                        held
                          ? 'border-brand bg-brand text-brand-foreground'
                          : 'border-slate-300 bg-white text-slate-700 hover:border-brand/50 hover:bg-brand/5'
                      }`}
                    >
                      {held ? (
                        <Check
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden="true"
                          strokeWidth={2.75}
                        />
                      ) : null}
                      {leaf.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </QueryState>
  );
}
