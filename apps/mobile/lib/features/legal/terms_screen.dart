import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_error.dart';
import '../../core/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../l10n/app_text.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_card.dart';
import '../auth/auth_controller.dart';
import 'legal_controller.dart';
import 'legal_links.dart';

/// The clickwrap every signed-in customer passes before anything else.
///
/// The router sends everyone here who has not accepted the current Customer
/// Terms and keeps them here until they do. There is no back button and no
/// skip; the only other way out is signing out, which is always offered so
/// nobody is trapped — least of all by a failed network call.
class TermsScreen extends ConsumerWidget {
  const TermsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(legalControllerProvider);
    final language = ref.watch(localeProvider).languageCode;
    final controller = ref.read(legalControllerProvider.notifier);

    return TermsView(
      state: state,
      onAccept: controller.accept,
      onRetry: controller.retry,
      onSignOut: () => ref.read(authControllerProvider.notifier).signOut(),
      onOpenPage: (page) => openLegalPage(page, language),
    );
  }
}

/// The screen itself, free of providers so it can be tested on its own.
class TermsView extends StatefulWidget {
  const TermsView({
    super.key,
    required this.state,
    required this.onAccept,
    required this.onRetry,
    required this.onSignOut,
    required this.onOpenPage,
  });

  final LegalState state;

  /// Sends the version on screen. Throws [ApiError] on a failure the screen
  /// should report; an outdated version is handled upstream and arrives as a
  /// new [state] instead.
  final Future<void> Function(String version) onAccept;

  final VoidCallback onRetry;
  final VoidCallback onSignOut;
  final void Function(LegalPage page) onOpenPage;

  static const checkboxKey = Key('terms.checkbox');
  static const acceptKey = Key('terms.accept');

  @override
  State<TermsView> createState() => _TermsViewState();
}

class _TermsViewState extends State<TermsView> {
  bool _agreed = false;
  bool _posting = false;
  String? _error;

  @override
  void didUpdateWidget(TermsView old) {
    super.didUpdateWidget(old);
    // A new version is a new document. Consent to the old one does not carry
    // over, so the box has to be ticked again.
    if (old.state.terms.currentVersion != widget.state.terms.currentVersion) {
      _agreed = false;
    }
  }

  bool get _canAccept =>
      _agreed &&
      !_posting &&
      !widget.state.busy &&
      widget.state.terms.canAccept;

  Future<void> _accept() async {
    if (!_canAccept) return;
    setState(() {
      _posting = true;
      _error = null;
    });

    try {
      await widget.onAccept(widget.state.terms.currentVersion);
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.isNetwork ? tr('common.noConnection') : e.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = tr('common.somethingWentWrong'));
    } finally {
      if (mounted) setState(() => _posting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.state;

    final Widget body = switch (state.stage) {
      LegalStage.failed => _LoadFailed(
          retrying: state.busy,
          onRetry: widget.onRetry,
          onSignOut: widget.onSignOut,
        ),
      LegalStage.idle || LegalStage.checking => const Center(
          child: SizedBox(
            width: 22,
            height: 22,
            child: CircularProgressIndicator(
              strokeWidth: 2.2,
              color: AppColors.blue,
            ),
          ),
        ),
      _ => _terms(state),
    };

    return PopScope(
      // Back must not leave this screen for one behind it.
      canPop: false,
      child: Scaffold(
        backgroundColor: AppColors.ground,
        body: SafeArea(child: body),
      ),
    );
  }

  Widget _terms(LegalState state) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.xl,
              AppSpacing.xxl,
              AppSpacing.xl,
              AppSpacing.lg,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(tr('legal.title'), style: AppType.title),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  tr('legal.intro'),
                  style: AppType.body.copyWith(color: AppColors.grey),
                ),
                if (state.termsChanged) ...[
                  const SizedBox(height: AppSpacing.lg),
                  _Notice(text: tr('legal.termsUpdated')),
                ],
                const SizedBox(height: AppSpacing.xl),
                AppCard(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  child: Column(
                    children: [
                      for (var i = 1; i <= 5; i++) ...[
                        if (i > 1) const SizedBox(height: AppSpacing.md),
                        _Point(number: i, text: tr('legal.point$i')),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                Wrap(
                  spacing: AppSpacing.sm,
                  runSpacing: AppSpacing.sm,
                  children: [
                    _DocLink(
                      label: tr('legal.terms'),
                      onTap: () => widget.onOpenPage(LegalPage.terms),
                    ),
                    _DocLink(
                      label: tr('legal.privacy'),
                      onTap: () => widget.onOpenPage(LegalPage.privacy),
                    ),
                    _DocLink(
                      label: tr('legal.refund'),
                      onTap: () => widget.onOpenPage(LegalPage.refund),
                    ),
                  ],
                ),
                if (state.terms.canAccept) ...[
                  const SizedBox(height: AppSpacing.md),
                  Text(
                    tr('legal.version', {'version': state.terms.currentVersion}),
                    style: AppType.caption.copyWith(color: AppColors.greyLight),
                  ),
                ],
              ],
            ),
          ),
        ),
        Container(
          decoration: const BoxDecoration(
            color: AppColors.ground,
            border: Border(top: BorderSide(color: AppColors.rule)),
          ),
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.xl,
            AppSpacing.md,
            AppSpacing.xl,
            AppSpacing.lg,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _AgreeRow(
                value: _agreed,
                onChanged: _posting
                    ? null
                    : (v) => setState(() {
                          _agreed = v;
                          _error = null;
                        }),
              ),
              if (_error != null) ...[
                const SizedBox(height: AppSpacing.xs),
                Text(
                  _error!,
                  style: AppType.meta.copyWith(color: AppColors.red),
                ),
              ],
              const SizedBox(height: AppSpacing.md),
              AppButton(
                key: TermsView.acceptKey,
                label: tr('legal.accept'),
                loading: _posting || state.busy,
                onPressed: _canAccept ? _accept : null,
              ),
              const SizedBox(height: AppSpacing.xs),
              AppButton(
                label: tr('legal.signOut'),
                kind: AppButtonKind.quiet,
                onPressed: _posting ? null : widget.onSignOut,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// One numbered point of the summary.
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
          width: 24,
          height: 24,
          alignment: Alignment.center,
          decoration: const BoxDecoration(
            color: AppColors.blueSoft,
            shape: BoxShape.circle,
          ),
          child: Text(
            '$number',
            style: AppType.meta.copyWith(
              color: AppColors.blue,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: Text(
            text,
            style: AppType.bodyMedium.copyWith(color: AppColors.inkMuted),
          ),
        ),
      ],
    );
  }
}

/// A link out to the full document on the website.
class _DocLink extends StatelessWidget {
  const _DocLink({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: AppRadius.chipR,
        side: BorderSide(color: AppColors.rule),
      ),
      child: InkWell(
        onTap: onTap,
        customBorder: const RoundedRectangleBorder(
          borderRadius: AppRadius.chipR,
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md,
            vertical: AppSpacing.sm,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                label,
                style: AppType.meta.copyWith(
                  color: AppColors.blue,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(width: AppSpacing.xs),
              const Icon(
                Icons.open_in_new_rounded,
                size: 13,
                color: AppColors.blue,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The consent checkbox. The whole row is the tap target, not just the box.
class _AgreeRow extends StatelessWidget {
  const _AgreeRow({required this.value, required this.onChanged});

  final bool value;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onChanged == null ? null : () => onChanged!(!value),
      borderRadius: AppRadius.fieldR,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Checkbox(
              key: TermsView.checkboxKey,
              value: value,
              onChanged: onChanged == null ? null : (v) => onChanged!(v ?? false),
              activeColor: AppColors.ink,
              side: const BorderSide(color: AppColors.greyLight, width: 1.5),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(5),
              ),
              materialTapTargetSize: MaterialTapTargetSize.padded,
            ),
            const SizedBox(width: AppSpacing.xs),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(top: AppSpacing.md),
                child: Text(
                  tr('legal.agree'),
                  style: AppType.bodyMedium.copyWith(color: AppColors.ink),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// "The terms were just updated" — shown after a 409 brought a new version.
class _Notice extends StatelessWidget {
  const _Notice({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.amberSoft,
        borderRadius: AppRadius.fieldR,
        border: Border.all(color: AppColors.amberLine),
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

/// The status could not be fetched. Retry, or leave — never a dead end, and
/// never a way past.
class _LoadFailed extends StatelessWidget {
  const _LoadFailed({
    required this.retrying,
    required this.onRetry,
    required this.onSignOut,
  });

  final bool retrying;
  final VoidCallback onRetry;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 64,
                height: 64,
                decoration: const BoxDecoration(
                  color: AppColors.mist,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.wifi_off_rounded,
                  size: 28,
                  color: AppColors.greyLight,
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            Text(
              tr('legal.title'),
              textAlign: TextAlign.center,
              style: AppType.heading,
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              tr('legal.loadFailed'),
              textAlign: TextAlign.center,
              style: AppType.body.copyWith(color: AppColors.grey),
            ),
            const SizedBox(height: AppSpacing.xl),
            AppButton(
              label: tr('legal.retry'),
              loading: retrying,
              onPressed: onRetry,
            ),
            const SizedBox(height: AppSpacing.xs),
            AppButton(
              label: tr('legal.signOut'),
              kind: AppButtonKind.quiet,
              onPressed: onSignOut,
            ),
          ],
        ),
      ),
    );
  }
}
