import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api/api_error.dart';
import '../../core/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../data/models/money.dart';
import '../../data/models/partner_profile.dart';
import '../../data/models/profile_photo.dart';
import '../../data/models/trust.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/states.dart';
import '../auth/auth_controller.dart';
import '../home/partner_providers.dart';
import '../legal/legal_controller.dart';
import 'edit_profile_sheet.dart';
import 'edit_sheets.dart';
import '../../l10n/app_text.dart';

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
                Text(tr('profile.you'), style: AppType.title),
                const SizedBox(height: AppSpacing.lg),

                _Identity(
                  profile: p,
                  photo: ref.watch(profilePhotoProvider).valueOrNull,
                  onEdit: () => _editProfile(context, ref, p),
                  onPhoto: () => _changePhoto(context, ref),
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

                // Its own row rather than a field buried in the details
                // sheet. It is one of the five hard gates, and a technician
                // who cannot see that it is missing cannot fix it — which is
                // exactly how somebody sits at "not visible to customers"
                // without knowing why.
                const SizedBox(height: AppSpacing.md),
                _BaseLocationCard(
                  profile: p,
                  onTap: () => _editProfile(context, ref, p),
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
                            tr('profile.youAreNotVisibleTo'),
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
                      SectionHeader(title: tr('profile.yourStanding')),
                      _TrustCard(trust: t),
                    ],
                  ),
                  orElse: () => const SizedBox.shrink(),
                ),

                SectionHeader(
                  title: tr('profile.whatYouDo'),
                  actionLabel: tr('profile.add'),
                  onAction: () => _addSkill(context, ref, p),
                ),
                _SkillsCard(
                    profile: p,
                    onRemove: (id) => _removeSkill(context, ref, id)),

                SectionHeader(
                  title: tr('profile.yourPrices'),
                  actionLabel: tr('profile.add2'),
                  onAction: () => _addPrice(context, ref, p),
                ),
                _PricesCard(
                    profile: p,
                    onRemove: (id) => _removePrice(context, ref, id)),

                SectionHeader(
                  title: tr('profile.whenYouWork'),
                  actionLabel: tr('profile.add3'),
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
                    label: tr('profile.takeAnHourOffThis'),
                    kind: AppButtonKind.ghost,
                    icon: Icons.event_busy_outlined,
                    onPressed: () => context.push('/calendar'),
                  ),
                ],

                SectionHeader(title: tr('profile.settings')),
                _SettingRow(
                  icon: Icons.translate_rounded,
                  title: tr('profile.language'),
                  value: locale.languageCode == 'hi' ? 'हिन्दी' : tr('profile.english'),
                  onTap: () => context.push('/settings/language'),
                ),

                SectionHeader(title: tr('legal.section')),
                _SettingRow(
                  icon: Icons.handshake_outlined,
                  title: tr('legal.partnerAgreement'),
                  onTap: () => LegalLinks.open(
                    LegalLinks.partnerTerms(locale.languageCode),
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                _SettingRow(
                  icon: Icons.privacy_tip_outlined,
                  title: tr('legal.privacyPolicy'),
                  onTap: () => LegalLinks.open(
                    LegalLinks.privacy(locale.languageCode),
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                _SettingRow(
                  icon: Icons.delete_outline_rounded,
                  title: tr('legal.deleteAccount'),
                  onTap: () => LegalLinks.open(
                    LegalLinks.deleteAccount(locale.languageCode),
                  ),
                ),

                const SizedBox(height: AppSpacing.xl),
                AppButton(
                  label: tr('profile.signOut'),
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

  /// Setting or replacing the picture customers see.
  ///
  /// The camera is offered first: this is a photo of a person, taken now, and
  /// a technician standing in their own shop is more likely to take one than
  /// to go looking through a gallery for a good one.
  Future<void> _changePhoto(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);

    final source = await showModalBottomSheet<ImageSource>(
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
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(tr('profile.yourPhoto'), style: AppType.heading),
            const SizedBox(height: AppSpacing.sm),
            Text(
              tr('profile.customersSeeThisOnceThey'),
              style: AppType.body.copyWith(color: AppColors.grey),
            ),
            const SizedBox(height: AppSpacing.xl),
            AppButton(
              label: tr('profile.takeAPhoto'),
              icon: Icons.photo_camera_rounded,
              onPressed: () => Navigator.pop(context, ImageSource.camera),
            ),
            const SizedBox(height: AppSpacing.sm),
            AppButton(
              label: tr('profile.chooseFromGallery'),
              kind: AppButtonKind.ghost,
              icon: Icons.photo_library_outlined,
              onPressed: () => Navigator.pop(context, ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null) return;

    // Bounded on the way in rather than after upload: the API signs the size
    // into the URL, so an oversized file is a wasted round trip and a
    // rejection somebody has to read.
    final picked = await ImagePicker().pickImage(
      source: source,
      maxWidth: 1200,
      maxHeight: 1200,
      imageQuality: 85,
    );
    if (picked == null) return;

    messenger.showSnackBar(
      SnackBar(content: Text(tr('profile.uploadingYourPhoto'))),
    );

    try {
      await ref.read(partnerRepositoryProvider).uploadPhoto(
            File(picked.path),
            contentType: _contentTypeFor(picked.path),
          );
      ref.invalidate(profilePhotoProvider);
      messenger.showSnackBar(
        SnackBar(content: Text(tr('profile.photoUpdated'))),
      );
    } on ApiError catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  /// The API accepts jpeg, png and webp, and signs this into the upload URL,
  /// so it has to match the bytes actually sent.
  static String _contentTypeFor(String path) {
    final lower = path.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    return 'image/jpeg';
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
        SnackBar(
          content: Text(tr('profile.addWhatYouDoFirst')),
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
      builder: (_) => AvailabilitySheet(),
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
            Text(tr('profile.signOut2'), style: AppType.heading),
            const SizedBox(height: AppSpacing.sm),
            Text(
              tr('profile.youWillStopSeeingNew'),
              style: AppType.body.copyWith(color: AppColors.grey),
            ),
            const SizedBox(height: AppSpacing.xl),
            Row(
              children: [
                Expanded(
                  child: AppButton(
                    label: tr('profile.stay'),
                    kind: AppButtonKind.ghost,
                    onPressed: () => Navigator.pop(context, false),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: AppButton(
                    label: tr('profile.signOut3'),
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
  const _Identity({
    required this.profile,
    required this.photo,
    required this.onEdit,
    required this.onPhoto,
  });

  final PartnerProfile profile;
  final ProfilePhoto? photo;
  final VoidCallback onEdit;
  final VoidCallback onPhoto;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onEdit,
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Row(
        children: [
          GestureDetector(
            onTap: onPhoto,
            child: Stack(
              clipBehavior: Clip.none,
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
                    image: photo != null && photo!.isVisible
                        ? DecorationImage(
                            image: NetworkImage(photo!.url),
                            fit: BoxFit.cover,
                          )
                        : null,
                  ),
                  alignment: Alignment.center,
                  // The initial shows through only while there is no picture.
                  child: photo != null && photo!.isVisible
                      ? null
                      : Text(
                          profile.name.substring(0, 1).toUpperCase(),
                          style: AppType.heading.copyWith(color: Colors.white),
                        ),
                ),
                Positioned(
                  right: -2,
                  bottom: -2,
                  child: Container(
                    width: 20,
                    height: 20,
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      shape: BoxShape.circle,
                      border: Border.all(color: AppColors.ground, width: 2),
                    ),
                    child: const Icon(
                      Icons.photo_camera_rounded,
                      size: 10,
                      color: AppColors.inkMuted,
                    ),
                  ),
                ),
              ],
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
                        tr('profile.verified'),
                        style: AppType.meta.copyWith(
                          color: AppColors.green,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ] else
                      Text(
                        tr('profile.notVerifiedYet'),
                        style: AppType.meta.copyWith(color: AppColors.grey),
                      ),
                    const SizedBox(width: AppSpacing.sm),
                    Text(
                      tr('profile.profileServiceradiuskmKm', {'serviceRadiusKm': profile.serviceRadiusKm}),
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

/// Where the technician works from, and whether it is set.
class _BaseLocationCard extends StatelessWidget {
  const _BaseLocationCard({required this.profile, required this.onTap});

  final PartnerProfile profile;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final set = profile.baseLocation != null;

    return AppCard(
      onTap: onTap,
      color: set ? null : AppColors.amberSoft,
      borderColor: set ? null : AppColors.amberLine,
      child: Row(
        children: [
          Icon(
            set ? Icons.place_rounded : Icons.wrong_location_outlined,
            size: 18,
            color: set ? AppColors.green : AppColors.amber,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  set ? tr('profile.whereYouWorkFrom') : tr('profile.setWhereYouWorkFrom'),
                  style: AppType.cardTitle.copyWith(
                    color: set ? AppColors.ink : AppColors.amber,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  set
                      ? tr('profile.customersWithinProfileServiceradiuskmKm', {'serviceRadiusKm': profile.serviceRadiusKm})
                      : tr('profile.untilYouSetThisNo'),
                  style: AppType.meta.copyWith(
                    color: set ? AppColors.grey : AppColors.amber,
                  ),
                ),
              ],
            ),
          ),
          Icon(
            Icons.chevron_right_rounded,
            size: 18,
            color: set ? AppColors.greyLight : AppColors.amber,
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
                  tr('profile.accountSuspended'),
                  style: AppType.cardTitle.copyWith(color: AppColors.red),
                ),
                const SizedBox(height: 3),
                Text(
                  tr('profile.suspendedUntil', {
                    'day': until.day,
                    'month': until.month,
                    'reason': trust.suspensionReason ?? '',
                  }),
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
                        ? tr('profile.new')
                        : trust.score!.toStringAsFixed(0),
                    style: AppType.hero.copyWith(fontSize: 32),
                  ),
                  Text(
                    tr(
                      trust.settledJobs == 1
                          ? 'profile.oneJobFinished'
                          : 'profile.jobsFinished',
                      {'count': trust.settledJobs},
                    ),
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
                        tr('profile.nextTrustNextbandBand', {'band': trust.nextBand!.band}),
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
                            ? tr('profile.reachTrustNextbandNeedsscoreTostringasfi', {'toStringAsFixed': trust.nextBand!.needsScore.toStringAsFixed(0)})
                            : tr('profile.trustNextbandNeedsscoreTostringasfixedTo', {'toStringAsFixed': trust.nextBand!.needsScore.toStringAsFixed(0)}),
                        style: AppType.meta.copyWith(
                          color: AppColors.inkMuted,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      if (trust.nextBand!.needsJobs > 0)
                        Text(
                          tr('profile.trustNextbandNeedsjobsMoreJobs', {'needsJobs': trust.nextBand!.needsJobs}),
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
                          ? tr('profile.notEnoughYet')
                          : tr('profile.cNormalizedTostringasfixed', {'toStringAsFixed': (c.normalized! * 100).toStringAsFixed(0)}),
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
          tr('profile.nothingYetAddWhatYou'),
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
          tr('profile.noPricesSetACustomer'),
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
          tr('profile.noHoursSetCustomersCan'),
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
                      tr('profile.profileAvailabilityIStarttimeProfile', {'startTime': profile.availability[i].startTime, 'endTime': profile.availability[i].endTime}),
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
    this.value,
    required this.onTap,
  });

  final IconData icon;
  final String title;

  /// The current setting, shown before the chevron. Absent on rows that
  /// open something rather than change something.
  final String? value;
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
          if (value != null)
            Text(value!, style: AppType.meta.copyWith(color: AppColors.grey)),
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
