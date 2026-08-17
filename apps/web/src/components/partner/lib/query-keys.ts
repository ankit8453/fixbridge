/**
 * One place for this surface's TanStack Query keys.
 *
 * Almost every mutation below (skills, price cards, availability, documents)
 * returns the whole rescored `profile` object rather than just its own
 * slice — so every one of them invalidates the same `profile` key rather
 * than patching a dozen different cache shapes by hand, which is exactly the
 * kind of hand-sync that drifts the moment a new field is added.
 */
export const partnerKeys = {
  profile: ['partner', 'profile'] as const,
  categories: ['partner', 'categories'] as const,
  verificationCases: ['partner', 'verification', 'cases'] as const,
  bookings: (side: 'provider') => ['partner', 'bookings', side] as const,
  booking: (id: string) => ['partner', 'booking', id] as const,
  wallet: ['partner', 'wallet'] as const,
  trust: ['partner', 'trust'] as const,
  slots: (from: string, to: string) => ['partner', 'slots', from, to] as const,
  notifications: (page: number, unreadOnly: boolean) =>
    ['partner', 'notifications', page, unreadOnly] as const,
  unreadCount: ['partner', 'notifications', 'unreadCount'] as const,
};
