import 'package:flutter/material.dart';

import '../../core/location.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../shared/widgets/app_button.dart';

/// Explaining the location permission before the system asks for it.
///
/// This screen exists because the system prompt is a resource that runs out.
/// Android stops showing it after two refusals **for the life of the install**,
/// and only the phone's settings screen can undo that. So there are exactly
/// two chances, and spending one on a dialog that appears out of nowhere is
/// how an app ends up permanently unable to ask.
///
/// Ours is free and can be shown as often as we like. The measured effect of
/// putting one in front is large — published case studies report opt-in going
/// from around 45% to over 90% — and Swiggy's own write-up of their onboarding
/// found the same thing: people refused because nobody had said what the
/// location was for, and specifically feared it meant handing over their home
/// address.
///
/// So the copy answers that fear directly and makes two promises the app then
/// has to keep: only while you are using it, and only the pin you confirm.
///
/// Returns true when the customer wants to be asked. Never asks by itself —
/// the caller does that, so the system prompt follows a tap on "Allow" rather
/// than the mere appearance of a screen.
class LocationPermissionSheet extends StatelessWidget {
  const LocationPermissionSheet({super.key, required this.blocked});

  /// True once the two chances are gone. The sheet then explains the settings
  /// route instead of offering a button that would do nothing.
  final bool blocked;

  static Future<bool> ask(BuildContext context, {required bool blocked}) async {
    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      builder: (_) => LocationPermissionSheet(blocked: blocked),
    );

    return result ?? false;
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.xl,
        AppSpacing.lg,
        AppSpacing.xl,
        AppSpacing.sheetBottom(context),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: AppColors.mist,
              borderRadius: BorderRadius.circular(18),
            ),
            alignment: Alignment.center,
            child: const Icon(
              Icons.my_location_rounded,
              color: AppColors.blue,
              size: 26,
            ),
          ),
          const SizedBox(height: AppSpacing.lg),

          Text(
            blocked ? 'Location is switched off for FixBridge' : 'Open the map at your street',
            style: AppType.heading,
          ),
          const SizedBox(height: AppSpacing.sm),

          Text(
            blocked
                ? 'Your phone is blocking location for this app, so we cannot '
                    'ask again from here. You can turn it on in Settings — or '
                    'just find your street on the map yourself.'
                : 'We use your location once, to open the map where you are '
                    'standing. It saves you searching for your own street.',
            style: AppType.body.copyWith(color: AppColors.grey),
          ),

          if (!blocked) ...[
            const SizedBox(height: AppSpacing.lg),
            // The two things people are actually worried about, answered
            // before they are asked. Swiggy found the specific fear was that
            // location meant handing over a home address.
            const _Promise(
              icon: Icons.visibility_off_outlined,
              text: 'Only while you are using the app. Never in the background.',
            ),
            const SizedBox(height: AppSpacing.md),
            const _Promise(
              icon: Icons.push_pin_outlined,
              text: 'We save only the pin you confirm — not where you go.',
            ),
          ],

          const SizedBox(height: AppSpacing.xl),

          if (blocked) ...[
            AppButton(
              label: 'Open settings',
              onPressed: () {
                Navigator.pop(context, false);
                DeviceLocation.openSettings();
              },
            ),
            const SizedBox(height: AppSpacing.sm),
            AppButton(
              label: 'I will find it on the map',
              kind: AppButtonKind.ghost,
              onPressed: () => Navigator.pop(context, false),
            ),
          ] else ...[
            AppButton(
              label: 'Use my location',
              onPressed: () => Navigator.pop(context, true),
            ),
            const SizedBox(height: AppSpacing.sm),
            // Never a dead end, and never nagging. Android's guidance is
            // explicit that a refusal is to be respected rather than argued
            // with — the map still works, it just opens further away.
            AppButton(
              label: 'Not now',
              kind: AppButtonKind.ghost,
              onPressed: () => Navigator.pop(context, false),
            ),
          ],
        ],
      ),
    );
  }
}

class _Promise extends StatelessWidget {
  const _Promise({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 18, color: AppColors.green),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: Text(
            text,
            style: AppType.meta.copyWith(color: AppColors.ink),
          ),
        ),
      ],
    );
  }
}
