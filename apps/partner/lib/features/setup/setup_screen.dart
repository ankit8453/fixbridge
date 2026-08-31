import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../data/models/partner_profile.dart';
import '../../data/models/verification.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/states.dart';
import '../home/partner_providers.dart';

/// Getting listed.
///
/// **Two independent tracks, because the API has two independent gates**, and
/// search requires both:
///
///   * *Completeness* — name, area, services, prices, hours — makes a profile
///     findable.
///   * *Verification* — levels 0, 1 and 2 — makes it trusted.
///
/// A single combined bar would be a lie. Somebody at 100% profile with
/// verification pending has nothing left to fill in, and telling them to
/// "complete your profile" sends them round in circles. So each track says
/// what it is waiting on, and the banner at the top says which one is
/// actually blocking them.
class SetupScreen extends ConsumerWidget {
  const SetupScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(partnerProfileProvider);
    final verification = ref.watch(verificationProvider);

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
        title: const Text('Get your first job'),
      ),
      body: SafeArea(
        child: profile.when(
          loading: () => ListView(
            padding: const EdgeInsets.all(AppSpacing.screenX),
            children: const [
              Shimmer(height: 120, radius: 20),
              SizedBox(height: AppSpacing.lg),
              Shimmer(height: 180, radius: 20),
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
              ref.invalidate(verificationProvider);
              await ref.read(partnerProfileProvider.future);
            },
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.screenX,
                0,
                AppSpacing.screenX,
                AppSpacing.xl,
              ),
              children: [
                _Verdict(profile: p),
                const SizedBox(height: AppSpacing.xl),
                _ProfileTrack(
                  profile: p,
                  // `go`, not `push`. /profile is a branch of the shell, and
                  // pushing it from this root-navigator screen builds a
                  // second, detached copy with no bottom bar and no way back.
                  onFix: () => context.go('/profile'),
                ),
                const SizedBox(height: AppSpacing.lg),
                _PhotoPrompt(
                  hasPhoto:
                      ref.watch(profilePhotoProvider).valueOrNull?.isVisible ??
                          false,
                  onTap: () => context.go('/profile'),
                ),
                const SizedBox(height: AppSpacing.lg),
                verification.when(
                  loading: () => const Shimmer(height: 180, radius: 20),
                  error: (_, __) => const SizedBox.shrink(),
                  data: (v) => _VerificationTrack(
                    summary: v,
                    onStart: (level) {
                      // A case waiting on the technician goes to the reply
                      // form, not back to a blank submission they have
                      // already filled in once.
                      final open = v.caseFor(level);
                      final query = open != null && open.needsInfo
                          ? '?case=${open.id}'
                          : '';
                      context.push('/verification/$level$query');
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// What is actually stopping them, in one sentence.
class _Verdict extends StatelessWidget {
  const _Verdict({required this.profile});

  final PartnerProfile profile;

  @override
  Widget build(BuildContext context) {
    if (profile.canReceiveWork) {
      return AppCard(
        color: AppColors.greenSoft,
        borderColor: AppColors.greenSoft,
        child: Row(
          children: [
            const Icon(
              Icons.check_circle_rounded,
              size: 20,
              color: AppColors.green,
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('You are live', style: AppType.cardTitle),
                  const SizedBox(height: 2),
                  Text(
                    'Customers can find you and book you.',
                    style: AppType.meta.copyWith(color: AppColors.inkMuted),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    }

    final waitingOnUs = profile.isListed && !profile.badge.isEarned;

    return AppCard(
      color: AppColors.amberSoft,
      borderColor: AppColors.amberLine,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            waitingOnUs
                ? Icons.hourglass_top_rounded
                : Icons.info_outline_rounded,
            size: 20,
            color: AppColors.amber,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  waitingOnUs ? 'Waiting on us' : 'Not visible yet',
                  style: AppType.cardTitle.copyWith(color: AppColors.amber),
                ),
                const SizedBox(height: 2),
                Text(
                  // The distinction that matters: nothing further to do,
                  // versus something still to do.
                  waitingOnUs
                      ? 'Your profile is finished. We are checking your '
                          'verification — you will appear in search as soon '
                          'as it passes.'
                      : 'Customers cannot find you until both parts below are '
                          'done.',
                  style: AppType.meta.copyWith(color: AppColors.amber),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileTrack extends StatelessWidget {
  const _ProfileTrack({required this.profile, required this.onFix});

  final PartnerProfile profile;
  final VoidCallback onFix;

  @override
  Widget build(BuildContext context) {
    final missing = profile.completeness.missingRequired;
    final done = 5 - missing.length;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text('Your profile', style: AppType.cardTitle),
              const Spacer(),
              Text(
                '$done of 5',
                style: AppType.meta.copyWith(color: AppColors.grey),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm + 2),
          _Bar(
            progress: done / 5,
            colour: profile.isListed ? AppColors.green : AppColors.graphite,
          ),
          const SizedBox(height: AppSpacing.md),
          for (final item in _requiredItems)
            _Tick(
              label: item.label,
              done: !missing.any((m) => m.key == item.key),
            ),
          if (missing.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            AppButton(
              label: 'Finish your profile',
              kind: AppButtonKind.ghost,
              onPressed: onFix,
            ),
          ],
        ],
      ),
    );
  }

  /// The five that actually gate listing. The optional extras — a bio, a
  /// photo document, years of experience — move the score but never block,
  /// so listing them here would imply work that is not required.
  static const _requiredItems = [
    (key: 'displayName', label: 'Your name'),
    (key: 'baseLocation', label: 'Where you work from'),
    (key: 'skills', label: 'What you do'),
    (key: 'priceCard', label: 'Your prices'),
    (key: 'availability', label: 'When you work'),
  ];
}

/// The display picture, which is not a gate but matters at the door.
///
/// Deliberately outside the five required items: it does not block listing,
/// and putting it in that checklist would tell somebody they cannot work
/// without it. It sits here because the moment a technician is setting
/// themselves up is the moment they will actually take one.
class _PhotoPrompt extends StatelessWidget {
  const _PhotoPrompt({required this.hasPhoto, required this.onTap});

  final bool hasPhoto;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onTap,
      child: Row(
        children: [
          Icon(
            hasPhoto ? Icons.check_circle_rounded : Icons.photo_camera_outlined,
            size: 18,
            color: hasPhoto ? AppColors.green : AppColors.inkMuted,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  hasPhoto ? 'Your photo is set' : 'Add your photo',
                  style: AppType.cardTitle,
                ),
                const SizedBox(height: 2),
                Text(
                  hasPhoto
                      ? 'Customers see this after they accept.'
                      : 'Optional, but customers who can see who is coming '
                          'open the door faster.',
                  style: AppType.meta.copyWith(color: AppColors.grey),
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

class _VerificationTrack extends StatelessWidget {
  const _VerificationTrack({required this.summary, required this.onStart});

  final VerificationSummary summary;
  final ValueChanged<int> onStart;

  @override
  Widget build(BuildContext context) {
    final passed = summary.levelsPassed.length;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text('Verification', style: AppType.cardTitle),
              const Spacer(),
              Text(
                '$passed of 3',
                style: AppType.meta.copyWith(color: AppColors.grey),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm + 2),
          _Bar(
            progress: passed / 3,
            colour: summary.isVerified ? AppColors.green : AppColors.graphite,
          ),

          const SizedBox(height: AppSpacing.md),
          // Levels 0, 1, 2 — derived from levelsPassed rather than from the
          // API's levelsRemaining, which reports a retired level 3 for a
          // brand-new technician and would offer a step that always 400s.
          for (final level in VerificationLevels.all)
            _LevelRow(
              level: level,
              passed: summary.levelsPassed.contains(level),
              openCase: summary.caseFor(level),
              onStart: () => onStart(level),
            ),
        ],
      ),
    );
  }
}

class _LevelRow extends StatelessWidget {
  const _LevelRow({
    required this.level,
    required this.passed,
    required this.openCase,
    required this.onStart,
  });

  final int level;
  final bool passed;
  final VerificationCase? openCase;
  final VoidCallback onStart;

  @override
  Widget build(BuildContext context) {
    final submitted = openCase != null && !openCase!.isPassed;
    final needsInfo = openCase?.needsInfo ?? false;
    final failed = openCase?.isFailed ?? false;

    final (status, tone) = passed
        ? ('Done', AppColors.green)
        : needsInfo
            ? ('Needs more from you', AppColors.amber)
            : failed
                ? ('Not accepted', AppColors.red)
                : submitted
                    ? ('Being checked', AppColors.grey)
                    : ('Not started', AppColors.greyLight);

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 22,
            height: 22,
            margin: const EdgeInsets.only(top: 1),
            decoration: BoxDecoration(
              color: passed ? AppColors.green : AppColors.surface,
              shape: BoxShape.circle,
              border:
                  passed ? null : Border.all(color: AppColors.rule, width: 1.5),
            ),
            child: passed
                ? const Icon(Icons.check_rounded, size: 13, color: Colors.white)
                : Center(
                    child: Text(
                      '${level + 1}',
                      style: AppType.caption.copyWith(
                        color: AppColors.greyLight,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  VerificationLevels.titles[level] ?? 'Step ${level + 1}',
                  style: AppType.bodyMedium.copyWith(
                    fontSize: 13.5,
                    color: passed ? AppColors.inkMuted : AppColors.ink,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  passed ? status : VerificationLevels.blurbs[level] ?? '',
                  style: AppType.caption.copyWith(
                    color: passed ? tone : AppColors.greyLight,
                  ),
                ),
                if (!passed && (submitted || needsInfo || failed)) ...[
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    status,
                    style: AppType.caption.copyWith(
                      color: tone,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (!passed && (!submitted || needsInfo || failed))
            TextButton(
              onPressed: onStart,
              style: TextButton.styleFrom(
                foregroundColor: AppColors.graphite,
                textStyle: AppType.meta.copyWith(fontWeight: FontWeight.w700),
                visualDensity: VisualDensity.compact,
              ),
              child: Text(needsInfo || failed ? 'Fix' : 'Start'),
            ),
        ],
      ),
    );
  }
}

class _Bar extends StatelessWidget {
  const _Bar({required this.progress, required this.colour});

  final double progress;
  final Color colour;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(99),
      child: LinearProgressIndicator(
        value: progress.clamp(0, 1),
        minHeight: 7,
        backgroundColor: AppColors.rule,
        valueColor: AlwaysStoppedAnimation(colour),
      ),
    );
  }
}

class _Tick extends StatelessWidget {
  const _Tick({required this.label, required this.done});

  final String label;
  final bool done;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm + 1),
      child: Row(
        children: [
          Container(
            width: 19,
            height: 19,
            decoration: BoxDecoration(
              color: done ? AppColors.green : AppColors.surface,
              shape: BoxShape.circle,
              border:
                  done ? null : Border.all(color: AppColors.rule, width: 1.5),
            ),
            child: done
                ? const Icon(Icons.check_rounded, size: 12, color: Colors.white)
                : null,
          ),
          const SizedBox(width: AppSpacing.md),
          Text(
            label,
            style: AppType.meta.copyWith(
              color: done ? AppColors.inkMuted : AppColors.greyLight,
            ),
          ),
        ],
      ),
    );
  }
}
