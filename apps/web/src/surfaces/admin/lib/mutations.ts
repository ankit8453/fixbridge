import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

/**
 * Every mutation in this surface, on the same terms: invalidate and refetch.
 * Ported verbatim from `legacy-next-src/components/admin/lib/mutations.ts`.
 *
 * **No optimistic updates, anywhere.** The usual argument for them — the
 * screen feels faster — is worth nothing here and the cost is real. These
 * mutations suspend people, cancel their jobs and mark money as paid;
 * several of them are refused by the server for reasons the client cannot
 * predict (a booking that is no longer locked, a batch somebody else
 * already closed, a payout whose UTR a database CHECK rejects). An
 * optimistic row that says "paid" and then quietly reverts is a screen that
 * lied to ops about money. Refetching is a few hundred milliseconds; being
 * wrong about a payout is a phone call.
 */
export function useAdminMutation<TResult, TInput>(
  mutationFn: (input: TInput) => Promise<TResult>,
  options: {
    /** Query key prefixes to invalidate once the server has agreed. */
    invalidate: readonly unknown[][];
    onDone?: (result: TResult) => void;
  },
): UseMutationResult<TResult, unknown, TInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: async (result) => {
      await Promise.all(
        options.invalidate.map((key) => queryClient.invalidateQueries({ queryKey: key })),
      );
      options.onDone?.(result);
    },
  });
}
