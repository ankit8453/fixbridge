import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import type {
  AddressResponse,
  CreateAddressInput,
  CustomerProfile,
  UpdateAddressInput,
} from './types';

/**
 * `GET /customers/me` returns `{ profile: null }` before the first write —
 * that is the documented signal to open profile setup, not an error. Used by
 * the onboarding step after login to decide whether to ask for a name.
 */
export function useCustomerProfile() {
  return useQuery({
    queryKey: ['customer', 'profile'],
    queryFn: () => apiRequest<{ profile: CustomerProfile | null }>('/api/v1/customers/me'),
  });
}

export function useUpdateCustomerProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { displayName?: string; email?: string | null }) =>
      apiRequest<{ profile: CustomerProfile; message: string }>('/api/v1/customers/me', {
        method: 'PATCH',
        body: input,
      }),
    // Correctness over optimism: invalidate and refetch rather than write the
    // response straight into the cache (house style).
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customer', 'profile'] });
    },
  });
}

const ADDRESSES_KEY = ['customer', 'addresses'] as const;

export function useAddresses() {
  return useQuery({
    queryKey: ADDRESSES_KEY,
    queryFn: () => apiRequest<{ addresses: AddressResponse[] }>('/api/v1/customers/me/addresses'),
  });
}

export function useCreateAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateAddressInput) =>
      apiRequest<{ address: AddressResponse; message: string }>('/api/v1/customers/me/addresses', {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ADDRESSES_KEY });
    },
  });
}

export function useUpdateAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ addressId, input }: { addressId: string; input: UpdateAddressInput }) =>
      apiRequest<{ address: AddressResponse; message: string }>(
        `/api/v1/customers/me/addresses/${addressId}`,
        { method: 'PATCH', body: input },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ADDRESSES_KEY });
    },
  });
}

export function useDeleteAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (addressId: string) =>
      apiRequest<{ message: string }>(`/api/v1/customers/me/addresses/${addressId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ADDRESSES_KEY });
    },
  });
}

export function useSetDefaultAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (addressId: string) =>
      apiRequest<{ address: AddressResponse; message: string }>(
        `/api/v1/customers/me/addresses/${addressId}/default`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ADDRESSES_KEY });
    },
  });
}
