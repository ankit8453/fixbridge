import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../l10n/app_text.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_card.dart';
import '../auth/auth_controller.dart';
import 'legal_controller.dart';

/// "Before you continue" — the partner agreement, accepted once per version.
///
/// The router sends every signed-in technician here until the current version
/// is accepted, and keeps them here: there is no other route to go to. There
/// is always a way out, though — Sign out — so a failed load or
/// a change of heart never leaves somebody stuck on a screen they cannot pass.
class AgreementScreen extends ConsumerStatefulWidget {
  const AgreementScreen({super.key});

  @override
  ConsumerState<AgreementScreen> createState() => _AgreementScreenState();
}

class _AgreementScreenState extends ConsumerState<AgreementScreen> {
  bool _agreed = false;

  static const _points = [
    'legal.point1',
    'legal.point2',
    'legal.point3',
    'legal.point4',
    'legal.point5',
  ];

  Future<void> _signOut() async {
    await ref.read(authControllerProvider.notifier).signOut();
  }

  @override
  Widget build(BuildContext context) {
    final legal = ref.watch(legalControllerProvider);
    final language = ref.watch(localeProvider).languageCode;

    // A new version arrived (the 409 path): the tick was for the old text.
    ref.listen<LegalState>(legalControllerProvider, (prev, next) {
      if (prev?.partner?.currentVersion != next.partner?.currentVersion &&
          _agreed) {
        setState(() => _agreed = false);
      }
    });

    final Widget body;
    if (legal.gate == LegalGate.failed) {
      body = _LoadFailed(
        onRetry: () => ref.read(legalControllerProvider.notifier).retry(),
      );
    } else if (legal.partner == null) {
      body = const Center(
        child: SizedBox(
          width: 22,
          height: 22,
          child: CircularProgressIndicator(
            strokeWidth: 2.2,
            color: AppColors.graphite,
          ),
        ),
      );
    } else {
      body = _content(legal, language);
    }

    return Scaffold(
      backgroundColor: AppColors.ground,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(child: body),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.xl,
                0,
                AppSpacing.xl,
                AppSpacing.screenBottom,
              ),
              child: AppButton(
                label: tr('legal.signOut'),
                kind: AppButtonKind.quiet,
                onPressed: legal.submitting ? null : _signOut,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _content(LegalState legal, String language) {
    final canAccept =
        _agreed && legal.gate == LegalGate.required && !legal.submitting;

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 40),
          Container(
            width: 60,
            height: 60,
            decoration: BoxDecoration(
              gradient: AppColors.earningsGradient,
              borderRadius: BorderRadius.circular(18),
            ),
            alignment: Alignment.center,
            child: const Icon(
              Icons.handshake_outlined,
              color: Colors.white,
              size: 28,
            ),
          ),
          const SizedBox(height: AppSpacing.xl),
          Text(tr('legal.title'), style: AppType.title),
          const SizedBox(height: AppSpacing.sm),
          Text(
            tr('legal.intro'),
            style: AppType.body.copyWith(color: AppColors.grey),
          ),
          if (legal.notice == LegalNotice.versionChanged) ...[
            const SizedBox(height: AppSpacing.lg),
            _Banner(text: tr('legal.versionChanged')),
          ],
          const SizedBox(height: AppSpacing.xl),
          AppCard(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: Column(
              children: [
                for (var i = 0; i < _points.length; i++) ...[
                  if (i > 0) const SizedBox(height: AppSpacing.md),
                  _Point(number: i + 1, text: tr(_points[i])),
                ],
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          _LinkRow(
            icon: Icons.description_outlined,
            label: tr('legal.partnerAgreement'),
            onTap: () => LegalLinks.open(LegalLinks.partnerTerms(language)),
          ),
          const SizedBox(height: AppSpacing.sm),
          _LinkRow(
            icon: Icons.privacy_tip_outlined,
            label: tr('legal.privacyPolicy'),
            onTap: () => LegalLinks.open(LegalLinks.privacy(language)),
          ),
          const SizedBox(height: AppSpacing.xl),
          AppCard(
            key: const Key('legal.agreeBox'),
            onTap: legal.submitting
                ? null
                : () => setState(() => _agreed = !_agreed),
            selected: _agreed,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  _agreed
                      ? Icons.check_box_rounded
                      : Icons.check_box_outline_blank_rounded,
                  size: 22,
                  color: _agreed ? AppColors.graphite : AppColors.greyLight,
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Text(tr('legal.checkbox'), style: AppType.bodyMedium),
                ),
              ],
            ),
          ),
          if (legal.acceptError != null) ...[
            const SizedBox(height: AppSpacing.md),
            Text(
              legal.acceptError!,
              style: AppType.meta.copyWith(color: AppColors.red),
            ),
          ],
          const SizedBox(height: AppSpacing.xl),
          AppButton(
            key: const Key('legal.accept'),
            label: tr('legal.accept'),
            loading: legal.submitting,
            onPressed: canAccept
                ? () => ref.read(legalControllerProvider.notifier).accept()
                : null,
          ),
          if (legal.partner?.currentVersion case final version?) ...[
            const SizedBox(height: AppSpacing.md),
            Center(
              child: Text(
                tr('legal.version', {'version': version}),
                style: AppType.caption.copyWith(color: AppColors.grey),
              ),
            ),
          ],
          const SizedBox(height: AppSpacing.sm),
        ],
      ),
    );
  }
}

class _Point extends StatelessWidget {
  const _Point({required this.number, required this.text});

  final int number;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 22,
          height: 22,
          margin: const EdgeInsets.only(top: 1),
          decoration: const BoxDecoration(
            color: AppColors.mist,
            shape: BoxShape.circle,
          ),
          alignment: Alignment.center,
          child: Text(
            '$number',
            style: AppType.meta.copyWith(color: AppColors.inkMuted),
          ),
        ),
        const SizedBox(width: AppSpacing.md),
        Expanded(child: Text(text, style: AppType.bodyMedium)),
      ],
    );
  }
}

class _LinkRow extends StatelessWidget {
  const _LinkRow({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
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
          Icon(icon, size: 18, color: AppColors.inkMuted),
          const SizedBox(width: AppSpacing.md),
          Expanded(child: Text(label, style: AppType.bodyMedium)),
          const Icon(
            Icons.open_in_new_rounded,
            size: 16,
            color: AppColors.greyLight,
          ),
        ],
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.amberSoft,
        border: Border.all(color: AppColors.amberLine),
        borderRadius: AppRadius.tileR,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.info_outline_rounded,
            size: 18,
            color: AppColors.amberText,
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              text,
              style: AppType.bodyMedium.copyWith(color: AppColors.amberText),
            ),
          ),
        ],
      ),
    );
  }
}

class _LoadFailed extends StatelessWidget {
  const _LoadFailed({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.wifi_off_rounded,
              size: 32,
              color: AppColors.greyLight,
            ),
            const SizedBox(height: AppSpacing.lg),
            Text(
              tr('legal.title'),
              style: AppType.heading,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              tr('legal.loadFailed'),
              style: AppType.body.copyWith(color: AppColors.grey),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.xl),
            AppButton(
              label: tr('legal.retry'),
              icon: Icons.refresh_rounded,
              onPressed: onRetry,
            ),
          ],
        ),
      ),
    );
  }
}
