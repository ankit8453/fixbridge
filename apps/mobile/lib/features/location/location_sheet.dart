import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/location.dart';
import '../../core/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../shared/widgets/app_button.dart';
import '../provider/provider_providers.dart';
import '../provider/book_sheet.dart';
import 'location_permission_sheet.dart';
import 'location_providers.dart';

/// Choosing where "near me" means.
///
/// Opened from the header on the home and search screens, the way Swiggy and
/// Zomato do it: the permission request happens **here**, on a sheet the
/// customer opened on purpose, rather than being deferred to a settings screen
/// they have to go and find. Only a permission that has been permanently
/// denied sends them to settings, because at that point nothing else can undo
/// it.
class LocationSheet extends ConsumerStatefulWidget {
  const LocationSheet({super.key});

  @override
  ConsumerState<LocationSheet> createState() => _LocationSheetState();
}

class _LocationSheetState extends ConsumerState<LocationSheet> {
  bool _locating = false;
  LocationRefused? _refusal;

  /// "Use my current location", from the header sheet.
  ///
  /// A deliberate tap, so this is a legitimate place to ask — but the
  /// explanation still goes first. The system prompt runs out after two
  /// refusals for the life of the install, and one spent without a reason
  /// attached is one that gets refused.
  Future<void> _useDevice() async {
    final state = await DeviceLocation.permissionState();
    if (!mounted) return;

    if (state != LocationPermissionState.granted) {
      final wants = await LocationPermissionSheet.ask(
        context,
        blocked: state == LocationPermissionState.blocked,
      );
      if (!wants || !mounted) return;
    }

    setState(() {
      _locating = true;
      _refusal = null;
    });

    final result = await DeviceLocation.requestAndGet();
    if (!mounted) return;

    if (result is LocationFound) {
      await ref
          .read(sessionStoreProvider)
          .setLastLocation(result.lat, result.lng);
      if (!mounted) return;
      // Both halves matter. Clearing the pick drops any address chosen by
      // hand; setting the flag is what stops the resolver preferring a saved
      // address over the fix that was just taken.
      ref.read(pickedAddressProvider.notifier).state = null;
      ref.read(useDeviceLocationProvider.notifier).state = true;
      ref.invalidate(resolvedLocationProvider);
      Navigator.pop(context);
      return;
    }

    setState(() {
      _locating = false;
      _refusal = result as LocationRefused;
    });
  }

  @override
  Widget build(BuildContext context) {
    final addresses = ref.watch(myAddressesProvider);
    final refusal = _refusal;

    return Padding(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.xl,
        AppSpacing.sm,
        AppSpacing.xl,
        AppSpacing.sheetBottom(context),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Where do you need help?', style: AppType.heading),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'We use this to show technicians near you and how far away '
            'they are.',
            style: AppType.meta.copyWith(color: AppColors.grey),
          ),
          const SizedBox(height: AppSpacing.lg),
          AppButton(
            label: 'Use my current location',
            icon: Icons.my_location_rounded,
            loading: _locating,
            onPressed: _useDevice,
          ),
          if (refusal != null) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(
              refusal.message,
              style: AppType.meta.copyWith(color: AppColors.amberText),
            ),
            if (refusal.settingsWouldHelp) ...[
              const SizedBox(height: AppSpacing.sm),
              AppButton(
                label: 'Open settings',
                kind: AppButtonKind.ghost,
                icon: Icons.settings_outlined,
                onPressed: () => refusal.reason == LocationDenial.serviceOff
                    ? DeviceLocation.openLocationSettings()
                    : DeviceLocation.openSettings(),
              ),
            ],
          ],
          const SizedBox(height: AppSpacing.lg),
          addresses.maybeWhen(
            data: (list) => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (list.isNotEmpty) ...[
                  Text(
                    'Saved addresses',
                    style: AppType.label.copyWith(color: AppColors.greyLight),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  for (final a in list)
                    _AddressRow(
                      label: a.displayLabel,
                      line: a.shortLine,
                      onTap: () {
                        ref.read(pickedAddressProvider.notifier).state = a;
                        ref.read(useDeviceLocationProvider.notifier).state =
                            false;
                        ref.invalidate(resolvedLocationProvider);
                        Navigator.pop(context);
                      },
                    ),
                  const SizedBox(height: AppSpacing.sm),
                ],
                AppButton(
                  label: 'Add a new address',
                  kind: AppButtonKind.ghost,
                  icon: Icons.add_location_alt_outlined,
                  onPressed: () async {
                    final added = await showModalBottomSheet(
                      context: context,
                      isScrollControlled: true,
                      builder: (_) => const AddAddressSheet(),
                    );
                    if (added == null || !context.mounted) return;
                    // Adding an address is a statement about where you are, so
                    // it takes precedence over an earlier "use my location".
                    ref.read(useDeviceLocationProvider.notifier).state = false;
                    ref.invalidate(myAddressesProvider);
                    ref.invalidate(resolvedLocationProvider);
                    Navigator.pop(context);
                  },
                ),
              ],
            ),
            orElse: () => const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }
}

class _AddressRow extends StatelessWidget {
  const _AddressRow({
    required this.label,
    required this.line,
    required this.onTap,
  });

  final String label;
  final String line;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppRadius.tileR,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            vertical: AppSpacing.md,
            horizontal: AppSpacing.sm,
          ),
          child: Row(
            children: [
              const Icon(
                Icons.place_outlined,
                size: 18,
                color: AppColors.grey,
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label, style: AppType.bodyMedium),
                    const SizedBox(height: 1),
                    Text(
                      line,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppType.caption.copyWith(
                        color: AppColors.greyLight,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
