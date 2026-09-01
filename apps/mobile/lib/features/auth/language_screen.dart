import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/brand_mark.dart';
import 'auth_controller.dart';

/// The first screen, and the one that has to be got right.
///
/// Both languages are weighted identically — same size, same weight, same
/// treatment. Hindi is listed first because it is the launch city's language,
/// not because it is preselected as correct, and nothing is chosen until the
/// person actually chooses. The device's own locale is deliberately ignored:
/// a phone set to English is not a statement that its owner reads English best.
///
/// Reachable again forever after, from Account.
class LanguageScreen extends ConsumerStatefulWidget {
  const LanguageScreen({super.key, this.isSettings = false});

  /// When opened from Account rather than at first launch: shows a back
  /// button and applies immediately instead of continuing to sign-in.
  final bool isSettings;

  @override
  ConsumerState<LanguageScreen> createState() => _LanguageScreenState();
}

class _LanguageScreenState extends ConsumerState<LanguageScreen> {
  String? _selected;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    // In settings the current language is genuinely the current answer, so it
    // starts selected. At first launch nothing is preselected.
    if (widget.isSettings) {
      _selected = ref.read(localeProvider).languageCode;
    }
  }

  Future<void> _continue() async {
    final choice = _selected;
    if (choice == null) return;

    setState(() => _saving = true);
    await ref.read(authControllerProvider.notifier).setLanguage(choice);
    if (!mounted) return;

    if (widget.isSettings) {
      context.pop();
    } else {
      context.go('/signin');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.ground,
      appBar: widget.isSettings
          ? AppBar(
              leading: const _BackButton(),
              title: const Text('Language'),
            )
          : null,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
          child: Column(
            children: [
              SizedBox(height: widget.isSettings ? AppSpacing.lg : 56),
              if (!widget.isSettings) ...[
                const BrandLockup(width: 170),
                const SizedBox(height: AppSpacing.xl),
              ],
              Text(
                'Choose your language',
                style: AppType.title,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                'अपनी भाषा चुनें',
                style: AppType.body.copyWith(color: AppColors.grey),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.xxl),
              _LanguageOption(
                title: 'हिन्दी',
                subtitle: 'Hindi',
                selected: _selected == 'hi',
                onTap: () => setState(() => _selected = 'hi'),
              ),
              const SizedBox(height: AppSpacing.md),
              _LanguageOption(
                title: 'English',
                subtitle: 'अंग्रेज़ी',
                selected: _selected == 'en',
                onTap: () => setState(() => _selected = 'en'),
              ),
              const Spacer(),
              AppButton(
                label: widget.isSettings ? 'Save' : 'Continue',
                loading: _saving,
                onPressed: _selected == null ? null : _continue,
              ),
              const SizedBox(height: AppSpacing.md),
              Text(
                'You can change this any time in Account.',
                style: AppType.caption.copyWith(color: AppColors.grey),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.lg),
            ],
          ),
        ),
      ),
    );
  }
}

/// One language, as a full-width card. Deliberately identical for both, so
/// neither reads as the default and the other as the accommodation.
class _LanguageOption extends StatelessWidget {
  const _LanguageOption({
    required this.title,
    required this.subtitle,
    required this.selected,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.blueSoft : AppColors.surface,
      borderRadius: AppRadius.fieldR,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppRadius.fieldR,
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg,
            vertical: AppSpacing.lg,
          ),
          decoration: BoxDecoration(
            borderRadius: AppRadius.fieldR,
            border: Border.all(
              color: selected ? AppColors.blue : AppColors.rule,
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: AppType.heading.copyWith(fontSize: 17),
                    ),
                    const SizedBox(height: 1),
                    Text(
                      subtitle,
                      style: AppType.meta.copyWith(color: AppColors.grey),
                    ),
                  ],
                ),
              ),
              AnimatedContainer(
                duration: AppMotion.quick,
                width: 22,
                height: 22,
                decoration: BoxDecoration(
                  color: selected ? AppColors.blue : Colors.transparent,
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: selected ? AppColors.blue : AppColors.rule,
                    width: 1.5,
                  ),
                ),
                child: selected
                    ? const Icon(Icons.check_rounded,
                        size: 14, color: Colors.white)
                    : null,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BackButton extends StatelessWidget {
  const _BackButton();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: AppSpacing.md),
      child: AppIconButton(
        icon: Icons.arrow_back_rounded,
        onPressed: () => context.pop(),
      ),
    );
  }
}
