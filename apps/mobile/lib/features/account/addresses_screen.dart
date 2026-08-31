import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_error.dart';
import '../../core/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../data/models/address.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/states.dart';
import '../provider/book_sheet.dart';
import '../provider/provider_providers.dart';

/// Saved addresses.
///
/// The default one is what the booking sheet preselects, so it is worth being
/// able to change it here rather than only mid-booking.
class AddressesScreen extends ConsumerWidget {
  const AddressesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final addresses = ref.watch(myAddressesProvider);

    return Scaffold(
      backgroundColor: AppColors.ground,
      appBar: AppBar(
        leading: Padding(
          padding: const EdgeInsets.only(left: AppSpacing.md),
          child: AppIconButton(
            icon: Icons.arrow_back_rounded,
            onPressed: () => context.pop(),
          ),
        ),
        title: const Text('Saved addresses'),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: addresses.when(
                loading: () => ListView(
                  padding: const EdgeInsets.all(AppSpacing.screenX),
                  children: const [
                    Shimmer(height: 78, radius: 20),
                    SizedBox(height: AppSpacing.md),
                    Shimmer(height: 78, radius: 20),
                  ],
                ),
                error: (e, _) => ErrorState(
                  error: e,
                  onRetry: () => ref.invalidate(myAddressesProvider),
                ),
                data: (list) => list.isEmpty
                    ? const EmptyState(
                        icon: Icons.place_outlined,
                        title: 'No addresses yet',
                        message:
                            'Add one so a technician knows where to come. You '
                            'can save as many as you like.',
                      )
                    : ListView.separated(
                        padding: const EdgeInsets.all(AppSpacing.screenX),
                        itemCount: list.length,
                        separatorBuilder: (_, __) =>
                            const SizedBox(height: AppSpacing.md),
                        itemBuilder: (_, i) => _AddressCard(
                          address: list[i],
                          onSetDefault: () =>
                              _setDefault(context, ref, list[i]),
                          onDelete: () => _delete(context, ref, list[i]),
                        ),
                      ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.screenX,
                AppSpacing.sm,
                AppSpacing.screenX,
                AppSpacing.screenBottom,
              ),
              child: AppButton(
                label: 'Add an address',
                icon: Icons.add_rounded,
                onPressed: () => _add(context, ref),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _add(BuildContext context, WidgetRef ref) async {
    final added = await showModalBottomSheet<Address>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const AddAddressSheet(),
    );
    if (added != null) ref.invalidate(myAddressesProvider);
  }

  Future<void> _setDefault(
    BuildContext context,
    WidgetRef ref,
    Address address,
  ) async {
    try {
      await ref.read(accountRepositoryProvider).setDefaultAddress(address.id);
      ref.invalidate(myAddressesProvider);
    } on ApiError catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.message)),
        );
      }
    }
  }

  Future<void> _delete(
    BuildContext context,
    WidgetRef ref,
    Address address,
  ) async {
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (context) => Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.xl,
          AppSpacing.sm,
          AppSpacing.xl,
          AppSpacing.xl,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Remove this address?', style: AppType.heading),
            const SizedBox(height: AppSpacing.sm),
            Text(
              // Past bookings keep their own snapshot of the address, so
              // removing it here does not rewrite history.
              'Bookings you already made keep the address they were sent to.',
              style: AppType.body.copyWith(color: AppColors.grey),
            ),
            const SizedBox(height: AppSpacing.xl),
            Row(
              children: [
                Expanded(
                  child: AppButton(
                    label: 'Keep it',
                    kind: AppButtonKind.ghost,
                    onPressed: () => Navigator.pop(context, false),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: AppButton(
                    label: 'Remove',
                    onPressed: () => Navigator.pop(context, true),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );

    if (confirmed != true) return;

    try {
      await ref.read(accountRepositoryProvider).deleteAddress(address.id);
      ref.invalidate(myAddressesProvider);
    } on ApiError catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.message)),
        );
      }
    }
  }
}

class _AddressCard extends StatelessWidget {
  const _AddressCard({
    required this.address,
    required this.onSetDefault,
    required this.onDelete,
  });

  final Address address;
  final VoidCallback onSetDefault;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                address.label == 'home'
                    ? Icons.home_rounded
                    : address.label == 'shop'
                        ? Icons.storefront_rounded
                        : Icons.place_rounded,
                size: 18,
                color: AppColors.blue,
              ),
              const SizedBox(width: AppSpacing.sm + 2),
              Text(address.displayLabel, style: AppType.cardTitle),
              if (address.isDefault) ...[
                const SizedBox(width: AppSpacing.sm),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 7,
                    vertical: 2.5,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.blueSoft,
                    borderRadius: AppRadius.chipR,
                  ),
                  child: Text(
                    'DEFAULT',
                    style: AppType.label.copyWith(
                      color: AppColors.blue,
                      fontSize: 8,
                    ),
                  ),
                ),
              ],
              const Spacer(),
              PopupMenuButton<String>(
                icon: const Icon(
                  Icons.more_horiz_rounded,
                  size: 18,
                  color: AppColors.greyLight,
                ),
                onSelected: (value) {
                  if (value == 'default') onSetDefault();
                  if (value == 'delete') onDelete();
                },
                itemBuilder: (_) => [
                  if (!address.isDefault)
                    const PopupMenuItem(
                      value: 'default',
                      child: Text('Make default'),
                    ),
                  const PopupMenuItem(
                    value: 'delete',
                    child: Text('Remove'),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            address.shortLine,
            style: AppType.meta.copyWith(color: AppColors.inkMuted),
          ),
        ],
      ),
    );
  }
}
