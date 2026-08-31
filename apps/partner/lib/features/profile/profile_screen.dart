import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_error.dart';
import '../../core/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../data/models/money.dart';
import '../../data/models/partner_profile.dart';
import '../../data/models/trust.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/states.dart';
import '../auth/auth_controller.dart';
import '../home/partner_providers.dart';
import 'edit_profile_sheet.dart';
import 'edit_sheets.dart';

/// The technician's own profile and standing.
class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(partnerProfileProvider);
    final trust = ref.watch(trustProvider);
    final locale = ref.watch(localeProvider);

    return Scaffold(
      backgroundColor: AppColors.ground,
      body: SafeArea(
        bottom: false,
        child: profile.when(
          loading: () => ListView(
            padding: const EdgeInsets.all(AppSpacing.screenX),
            children: const [
              Shimmer(height: 24, width: 100),
              SizedBox(height: AppSpacing.xl),
              Shimmer(height: 110, radius: 20),
              SizedBox(height: AppSpacing.md),
              Shimmer(height: 140, radius: 20),
            ],
          ),
          error: (e, _) => ErrorState(
            error: e,
            onRetry: () => ref.invalidate(partnerProfileProvider),
          ),
          data: (p) => RefreshIndicator(
            color: AppColors.graphite,
            onRefresh: () async {
              ref.invalidate(partnerProfileProvider);
              ref.invalidate(trustProvider);
              await ref.read(partnerProfileProvider.future);
            },
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.screenX,
                AppSpacing.sm,
                AppSpacing.screenX,
                96,
              ),
              children: [
                Text('You', style: AppType.title),
                const SizedBox(height: AppSpacing.lg),

                _Identity(
                  profile: p,
                  onEdit: () => _editProfile(context, ref, p),
                ),

                // Suspension is the one thing that overrides everything else
                // on this screen — a suspended technician is filtered out of
                // search entirely.
                trust.maybeWhen(
                  data: (t) => t.isSuspended
                      ? Padding(
                          padding: const EdgeInsets.only(top: AppSpacing.md),
                          child: _SuspendedBanner(trust: t),
                        )
                      : const SizedBox.shrink(),
                  orElse: () => const SizedBox.shrink(),
                ),

                if (!p.canReceiveWork) ...[
                  const SizedBox(height: AppSpacing.md),
                  AppCard(
                    onTap: () => context.push('/setup'),
                    color: AppColors.amberSoft,
                    borderColor: AppColors.amberLine,
                    child: Row(
                      children: [
                        const Icon(
                          Icons.info_outline_rounded,
                          size: 18,
                          color: AppColors.amber,
                        ),
                        const SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: Text(
                            'You are not visible to customers yet.',
                            style:
                                AppType.meta.copyWith(color: AppColors.amber),
                          ),
                        ),
                        const Icon(
                          Icons.chevron_right_rounded,
                          size: 18,
                          color: AppColors.amber,
                        ),
                      ],
                    ),
                  ),
                ],

                trust.maybeWhen(
                  data: (t) => Column(
                    children: [
                      const SectionHeader(title: 'Your standing'),
                      _TrustCard(trust: t),
                    ],
                  ),
                  orElse: () => const SizedBox.shrink(),
                ),

                SectionHeader(
                  title: 'What you do',
                  actionLabel: 'Add',
                  onAction: () => _addSkill(context, ref, p),
                ),
                _SkillsCard(
                    profile: p,
                    onRemove: (id) => _removeSkill(context, ref, id)),

                SectionHeader(
                  title: 'Your prices',
                  actionLabel: 'Add',
                  onAction: () => _addPrice(context, ref, p),
                ),
                _PricesCard(
                    profile: p,
                    onRemove: (id) => _removePrice(context, ref, id)),

                SectionHeader(
                  title: 'When you work',
                  actionLabel: 'Add',
                  onAction: () => _addAvailability(context, ref),
                ),
                _AvailabilityCard(
                  profile: p,
                  onRemove: (id) => _removeAvailability(context, ref, id),
                ),

                // Weekly hours are the pattern; the calendar is for the one
                // afternoon they cannot make.
                if (p.availability.isNotEmpty) ...[
                  const SizedBox(height: AppSpacing.sm),
                  AppButton(
                    label: 'Take an hour off this week',
                    kind: AppButtonKind.ghost,
                    icon: Icons.event_busy_outlined,
                    onPressed: () => context.push('/calendar'),
                  ),
                ],

                const SectionHeader(title: 'Settings'),
                _SettingRow(
                  icon: Icons.translate_rounded,
                  title: 'Language',
                  value: locale.languageCode == 'hi' ? 'हिन्दी' : 'English',
                  onTap: () => context.push('/settings/language'),
                ),

                const SizedBox(height: AppSpacing.xl),
                AppButton(
                  label: 'Sign out',
                  kind: AppButtonKind.ghost,
                  onPressed: () => _signOut(context, ref),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _editProfile(
    BuildContext context,
    WidgetRef ref,
    PartnerProfile profile,
  ) async {
    await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => EditProfileSheet(profile: profile),
    );
  }

  Future<void> _addSkill(
    BuildContext context,
    WidgetRef ref,
    PartnerProfile profile,
  ) async {
    // Captured before the sheet opens: by the time it closes and the write
    // returns, this screen's context may no longer be valid.
    final messenger = ScaffoldMessenger.of(context);

    final categoryId = await showModalBottomSheet<int>(
      context: context,
      isScrollControlled: true,
      builder: (_) => SkillPickerSheet(alreadyHave: profile.skills),
    );
    if (categoryId == null) return;

    await _run(messenger, ref, () async {
      await ref.read(partnerRepositoryProvider).addSkill(categoryId);
    });
  }

  Future<void> _removeSkill(
    BuildContext context,
    WidgetRef ref,
    int categoryId,
  ) async {
    await _run(ScaffoldMessenger.of(context), ref, () async {
      await ref.read(partnerRepositoryProvider).removeSkill(categoryId);
    });
  }

  /// Adding a price needs a skill to attach it to — the API rejects a price
  /// card for a category the technician does not claim.
  Future<void> _addPrice(
    BuildContext context,
    WidgetRef ref,
    PartnerProfile profile,
  ) async {
    final messenger = ScaffoldMessenger.of(context);

    if (profile.skills.isEmpty) {
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Add what you do first, then set a price for it.'),
        ),
      );
      return;
    }

    final result = await showModalBottomSheet<PriceDraft>(
      context: context,
      isScrollControlled: true,
      builder: (_) => PriceSheet(skills: profile.skills),
    );
    if (result == null) return;

    await _run(messenger, ref, () async {
      await ref.read(partnerRepositoryProvider).addPriceCard(
            categoryId: result.categoryId,
            title: result.title,
            amountPaise: result.amountPaise,
          );
    });
  }

  Future<void> _removePrice(
    BuildContext context,
    WidgetRef ref,
    String id,
  ) async {
    await _run(ScaffoldMessenger.of(context), ref, () async {
      await ref.read(partnerRepositoryProvider).removePriceCard(id);
    });
  }

  Future<void> _addAvailability(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);

    final result = await showModalBottomSheet<AvailabilityDraft>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const AvailabilitySheet(),
    );
    if (result == null) return;

    await _run(messenger, ref, () async {
      await ref.read(partnerRepositoryProvider).addAvailability(
            dayOfWeek: result.dayOfWeek,
            startTime: result.startTime,
            endTime: result.endTime,
          );
    });
  }

  Future<void> _removeAvailability(
    BuildContext context,
    WidgetRef ref,
    String id,
  ) async {
    await _run(ScaffoldMessenger.of(context), ref, () async {
      await ref.read(partnerRepositoryProvider).removeAvailability(id);
    });
  }

  /// Every profile write returns the whole recomputed profile — including
  /// whether it is now listed — so the provider is always refreshed.
  ///
  /// The messenger is captured before the await rather than looked up after
  /// it: by the time a slow call returns, this screen may be gone, and
  /// reaching for its context then is a crash.
  Future<void> _run(
    ScaffoldMessengerState messenger,
    WidgetRef ref,
    Future<void> Function() action,
  ) async {
    try {
      await action();
      ref.invalidate(partnerProfileProvider);
    } on ApiError catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _signOut(BuildContext context, WidgetRef ref) async {
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
            Text('Sign out?', style: AppType.heading),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'You will stop seeing new job requests until you sign back in.',
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

class _Identity extends StatelessWidget {
  const _Identity({required this.profile, required this.onEdit});

  final PartnerProfile profile;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onEdit,
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Row(
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [AppColors.graphite, AppColors.graphiteMid],
              ),
            ),
            alignment: Alignment.center,
            child: Text(
              profile.name.substring(0, 1).toUpperCase(),
              style: AppType.heading.copyWith(color: Colors.white),
            ),
          ),
          const SizedBox(width: AppSpacing.lg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(profile.name,
                    style: AppType.heading.copyWith(fontSize: 17)),
                const SizedBox(height: 3),
                Row(
                  children: [
                    if (profile.badge.isEarned) ...[
                      const Icon(
                        Icons.verified_rounded,
                        size: 14,
                        color: AppColors.green,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        'Verified',
                        style: AppType.meta.copyWith(
                          color: AppColors.green,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ] else
                      Text(
                        'Not verified yet',
                        style: AppType.meta.copyWith(color: AppColors.grey),
                      ),
                    const SizedBox(width: AppSpacing.sm),
                    Text(
                      '· ${profile.serviceRadiusKm} km',
                      style: AppType.meta.copyWith(color: AppColors.grey),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const Icon(
            Icons.chevron_right_rounded,
            size: 18,
            color: AppColors.greyLight,
          ),
        ],
      ),
    );
  }
}

class _SuspendedBanner extends StatelessWidget {
  const _SuspendedBanner({required this.trust});

  final Trust trust;

  @override
  Widget build(BuildContext context) {
    final until = trust.suspendedUntil!;

    return AppCard(
      color: AppColors.redSoft,
      borderColor: AppColors.redLine,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 26,
            height: 26,
            decoration: const BoxDecoration(
              color: AppColors.red,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.priority_high_rounded,
              size: 15,
              color: Colors.white,
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Account suspended',
                  style: AppType.cardTitle.copyWith(color: AppColors.red),
                ),
                const SizedBox(height: 3),
                Text(
                  'You cannot take jobs until ${until.day}/${until.month}. '
                  '${trust.suspensionReason ?? ''}',
                  style: AppType.meta.copyWith(color: AppColors.red),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _TrustCard extends StatelessWidget {
  const _TrustCard({required this.trust});

  final Trust trust;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    // Null is "no history yet", not zero. Showing 0 would tell
                    // somebody they have failed when they have not started.
                    trust.score == null
                        ? 'New'
                        : trust.score!.toStringAsFixed(0),
                    style: AppType.hero.copyWith(fontSize: 32),
                  ),
                  Text(
                    '${trust.settledJobs} '
                    '${trust.settledJobs == 1 ? 'job' : 'jobs'} finished',
                    style: AppType.meta.copyWith(color: AppColors.grey),
                  ),
                ],
              ),
              const Spacer(),
              if (trust.nextBand != null)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.md,
                    vertical: AppSpacing.sm,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.graphiteSoft,
                    borderRadius: AppRadius.tileR,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        'NEXT: ${trust.nextBand!.band}',
                        style: AppType.label.copyWith(
                          color: AppColors.graphite,
                          fontSize: 8.5,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        // needsScore means a target when there is no score
                        // yet, and a remaining gap once there is — so the
                        // sentence changes rather than the number lying.
                        trust.nextBand!.isAbsolute
                            ? 'Reach ${trust.nextBand!.needsScore.toStringAsFixed(0)}'
                            : '${trust.nextBand!.needsScore.toStringAsFixed(0)} to go',
                        style: AppType.meta.copyWith(
                          color: AppColors.inkMuted,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      if (trust.nextBand!.needsJobs > 0)
                        Text(
                          '${trust.nextBand!.needsJobs} more jobs',
                          style: AppType.caption
                              .copyWith(color: AppColors.greyLight),
                        ),
                    ],
                  ),
                ),
            ],
          ),
          if (trust.components.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.lg),
            for (final c in trust.components)
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        c.label,
                        style: AppType.meta.copyWith(
                          // Greyed when there is not enough history — "not
                          // enough jobs yet" is not the same as a bad score.
                          color: c.pending
                              ? AppColors.greyLight
                              : AppColors.inkMuted,
                        ),
                      ),
                    ),
                    Text(
                      c.pending
                          ? 'Not enough yet'
                          : '${(c.normalized! * 100).toStringAsFixed(0)}%',
                      style: AppType.meta.copyWith(
                        color: c.pending
                            ? AppColors.greyLight
                            : c.normalized! > 0.7
                                ? AppColors.green
                                : AppColors.amber,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _SkillsCard extends StatelessWidget {
  const _SkillsCard({required this.profile, required this.onRemove});

  final PartnerProfile profile;
  final ValueChanged<int> onRemove;

  @override
  Widget build(BuildContext context) {
    if (profile.skills.isEmpty) {
      return AppCard(
        child: Text(
          'Nothing yet. Add what you do so customers can find you.',
          style: AppType.meta.copyWith(color: AppColors.grey),
        ),
      );
    }

    return AppCard(
      child: Wrap(
        spacing: AppSpacing.sm,
        runSpacing: AppSpacing.sm,
        children: [
          for (final skill in profile.skills)
            Chip(
              label: Text(skill.categoryName, style: AppType.meta),
              onDeleted: () => onRemove(skill.categoryId),
              deleteIcon: const Icon(Icons.close_rounded, size: 14),
              backgroundColor: AppColors.graphiteSoft,
              side: BorderSide.none,
              visualDensity: VisualDensity.compact,
            ),
        ],
      ),
    );
  }
}

class _PricesCard extends StatelessWidget {
  const _PricesCard({required this.profile, required this.onRemove});

  final PartnerProfile profile;
  final ValueChanged<String> onRemove;

  @override
  Widget build(BuildContext context) {
    if (profile.priceCards.isEmpty) {
      return AppCard(
        child: Text(
          'No prices set. A customer books at the price you put here, and it '
          'cannot change afterwards.',
          style: AppType.meta.copyWith(color: AppColors.grey),
        ),
      );
    }

    return AppCard(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      child: Column(
        children: [
          for (var i = 0; i < profile.priceCards.length; i++) ...[
            if (i > 0) const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          profile.priceCards[i].title,
                          style: AppType.bodyMedium.copyWith(fontSize: 13),
                        ),
                        Text(
                          profile.priceCards[i].categoryName,
                          style: AppType.caption
                              .copyWith(color: AppColors.greyLight),
                        ),
                      ],
                    ),
                  ),
                  Text(
                    Paise.format(profile.priceCards[i].amountPaise ?? 0),
                    style: AppType.amount,
                  ),
                  IconButton(
                    onPressed: () => onRemove(profile.priceCards[i].id),
                    icon: const Icon(
                      Icons.close_rounded,
                      size: 16,
                      color: AppColors.greyLight,
                    ),
                    visualDensity: VisualDensity.compact,
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _AvailabilityCard extends StatelessWidget {
  const _AvailabilityCard({required this.profile, required this.onRemove});

  final PartnerProfile profile;
  final ValueChanged<String> onRemove;

  @override
  Widget build(BuildContext context) {
    if (profile.availability.isEmpty) {
      return AppCard(
        child: Text(
          'No hours set. Customers can only book you in the hours you add '
          'here.',
          style: AppType.meta.copyWith(color: AppColors.grey),
        ),
      );
    }

    return AppCard(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      child: Column(
        children: [
          for (var i = 0; i < profile.availability.length; i++) ...[
            if (i > 0) const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
              child: Row(
                children: [
                  SizedBox(
                    width: 88,
                    child: Text(
                      profile.availability[i].dayName,
                      style: AppType.bodyMedium.copyWith(fontSize: 13),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      '${profile.availability[i].startTime} – '
                      '${profile.availability[i].endTime}',
                      style: AppType.meta.copyWith(color: AppColors.inkMuted),
                    ),
                  ),
                  IconButton(
                    onPressed: () => onRemove(profile.availability[i].id),
                    icon: const Icon(
                      Icons.close_rounded,
                      size: 16,
                      color: AppColors.greyLight,
                    ),
                    visualDensity: VisualDensity.compact,
                  ),
                ],
              ),
            ),
          ],
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
    return AppCard(
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
          Text(value, style: AppType.meta.copyWith(color: AppColors.grey)),
          const SizedBox(width: 6),
          const Icon(
            Icons.chevron_right_rounded,
            size: 18,
            color: AppColors.greyLight,
          ),
        ],
      ),
    );
  }
}
