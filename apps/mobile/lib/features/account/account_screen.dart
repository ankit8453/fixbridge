import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_error.dart';
import '../../core/config/env.dart';
import '../../core/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/app_field.dart';
import '../../shared/widgets/avatar.dart';
import '../auth/auth_controller.dart';

class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final user = auth.user;
    final locale = ref.watch(localeProvider);

    return Scaffold(
      backgroundColor: AppColors.ground,
      body: SafeArea(
        bottom: false,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.screenX,
            AppSpacing.sm,
            AppSpacing.screenX,
            96,
          ),
          children: [
            Text('Account', style: AppType.title),
            const SizedBox(height: AppSpacing.lg),

            if (user == null)
              _SignedOutCard(onSignIn: () => context.push('/signin'))
            else
              _ProfileCard(
                name: user.name ?? 'Add your name',
                phone: user.phone,
                hasName: user.name != null,
              ),

            const SizedBox(height: AppSpacing.xl),

            // The language switch lives here permanently, exactly as it does
            // on the web dashboard. Changing it is retroactive: the inbox
            // re-renders old messages, and WhatsApp follows too.
            _SettingRow(
              icon: Icons.translate_rounded,
              title: 'Language',
              value: locale.languageCode == 'hi' ? 'हिन्दी' : 'English',
              onTap: () => context.push('/settings/language'),
            ),

            if (user != null) ...[
              _SettingRow(
                icon: Icons.badge_outlined,
                title: 'Your name',
                value: user.name == null ? 'Add' : 'Edit',
                onTap: () => _editName(context, ref, user.name),
              ),
              _SettingRow(
                icon: Icons.place_outlined,
                title: 'Saved addresses',
                value: 'Manage',
                onTap: () => context.push('/account/addresses'),
              ),
              _SettingRow(
                icon: Icons.support_agent_rounded,
                title: 'Complaints',
                value: 'View',
                onTap: () => context.push('/account/complaints'),
              ),
            ],

            const SizedBox(height: AppSpacing.xl),
            const _AboutBlock(),

            if (user != null) ...[
              const SizedBox(height: AppSpacing.xl),
              AppButton(
                label: 'Sign out',
                kind: AppButtonKind.ghost,
                onPressed: () => _confirmSignOut(context, ref),
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// The name a technician sees when they accept. Editable because the first
  /// sign-in lets it be skipped, and somebody who skipped it should not be
  /// stuck as "no name" forever.
  Future<void> _editName(
    BuildContext context,
    WidgetRef ref,
    String? current,
  ) async {
    final controller = TextEditingController(text: current ?? '');

    final saved = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (context) => StatefulBuilder(
        builder: (context, setSheetState) => Padding(
          padding: EdgeInsets.only(
            left: AppSpacing.xl,
            right: AppSpacing.xl,
            top: AppSpacing.sm,
            bottom: AppSpacing.sheetBottom(context),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Your name', style: AppType.heading),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'The technician sees this when they accept your booking.',
                style: AppType.meta.copyWith(color: AppColors.grey),
              ),
              const SizedBox(height: AppSpacing.lg),
              AppField(
                controller: controller,
                hint: 'Your name',
                autofocus: true,
                maxLength: 120,
                textCapitalization: TextCapitalization.words,
                onChanged: (_) => setSheetState(() {}),
              ),
              const SizedBox(height: AppSpacing.lg),
              AppButton(
                label: 'Save',
                onPressed: controller.text.trim().isEmpty
                    ? null
                    : () => Navigator.pop(context, controller.text.trim()),
              ),
            ],
          ),
        ),
      ),
    );

    if (saved == null) return;

    try {
      await ref.read(authControllerProvider.notifier).setName(saved);
    } on ApiError catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.message)),
        );
      }
    }
  }

  Future<void> _confirmSignOut(BuildContext context, WidgetRef ref) async {
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (context) => Padding(
        padding: EdgeInsets.fromLTRB(
          AppSpacing.xl,
          AppSpacing.sm,
          AppSpacing.xl,
          AppSpacing.sheetBottom(context),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Sign out?', style: AppType.heading),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'You will need your phone number and a code to sign back in. '
              'Your bookings stay where they are.',
              style: AppType.body.copyWith(color: AppColors.grey),
            ),
            const SizedBox(height: AppSpacing.xl),
            Row(
              children: [
                Expanded(
                  child: AppButton(
                    label: 'Stay',
                    kind: AppButtonKind.ghost,
                    onPressed: () => Navigator.pop(context, false),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: AppButton(
                    label: 'Sign out',
                    onPressed: () => Navigator.pop(context, true),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );

    if (confirmed ?? false) {
      await ref.read(authControllerProvider.notifier).signOut();
    }
  }
}

class _ProfileCard extends StatelessWidget {
  const _ProfileCard({
    required this.name,
    required this.phone,
    required this.hasName,
  });

  final String name;
  final String phone;
  final bool hasName;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Row(
        children: [
          Avatar(name: hasName ? name : '?', size: 52, radius: 26),
          const SizedBox(width: AppSpacing.lg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: AppType.heading.copyWith(
                    fontSize: 17,
                    color: hasName ? AppColors.ink : AppColors.grey,
                  ),
                ),
                const SizedBox(height: 2),
                // The API only ever returns a masked number, even to the
                // account's own owner, so this is shown as it arrives.
                Text(
                  phone,
                  style: AppType.meta.copyWith(color: AppColors.grey),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SignedOutCard extends StatelessWidget {
  const _SignedOutCard({required this.onSignIn});

  final VoidCallback onSignIn;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('You are browsing as a guest', style: AppType.cardTitle),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Search and technician profiles work without an account. '
            'You will need a number to book.',
            style: AppType.meta.copyWith(color: AppColors.grey),
          ),
          const SizedBox(height: AppSpacing.lg),
          AppButton(label: 'Sign in', onPressed: onSignIn),
        ],
      ),
    );
  }
}

class _SettingRow extends StatelessWidget {
  const _SettingRow({
    required this.icon,
    required this.title,
    required this.value,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm + 2),
      child: AppCard(
        onTap: onTap,
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.lg,
          vertical: AppSpacing.md + 2,
        ),
        child: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: AppColors.mist,
                borderRadius: BorderRadius.circular(11),
              ),
              child: Icon(icon, size: 17, color: AppColors.inkMuted),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(child: Text(title, style: AppType.bodyMedium)),
            Text(
              value,
              style: AppType.meta.copyWith(color: AppColors.grey),
            ),
            const SizedBox(width: 6),
            const Icon(
              Icons.chevron_right_rounded,
              size: 18,
              color: AppColors.greyLight,
            ),
          ],
        ),
      ),
    );
  }
}

class _AboutBlock extends StatelessWidget {
  const _AboutBlock();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          Env.appName,
          style: AppType.meta.copyWith(
            color: AppColors.greyLight,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          'Verified technicians in Jabalpur',
          style: AppType.caption.copyWith(color: AppColors.greyLight),
        ),
      ],
    );
  }
}
