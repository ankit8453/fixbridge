import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/app_update.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import 'app_button.dart';

/// Wraps the app and interrupts it when this build is too old.
///
/// Two very different interruptions, and the difference matters:
///
///   * **Required** — a full screen with no way past. The API no longer
///     supports this build, so letting somebody continue means letting them
///     misread prices or statuses.
///   * **Available** — a dismissible sheet, shown once per launch. A nag on
///     every screen is how people learn to tap past the one that matters.
///
/// A failed check shows nothing at all. No network on launch is ordinary here,
/// and an app that refuses to start because it could not phone home is worse
/// than one running a slightly old build.
class UpdateGate extends ConsumerStatefulWidget {
  const UpdateGate({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<UpdateGate> createState() => _UpdateGateState();
}

class _UpdateGateState extends ConsumerState<UpdateGate> {
  bool _offered = false;

  Future<void> _download(String url) async {
    // Leaves the app on purpose: the browser handles the download and Android
    // then runs its own installer, which is the only path a sideloaded app has.
    await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  }

  void _offerOnce(ReleaseStatus status) {
    if (_offered) return;
    _offered = true;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      showModalBottomSheet<void>(
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
              Text('A new version is ready', style: AppType.heading),
              const SizedBox(height: AppSpacing.sm),
              Text(
                'Version ${status.latestVersion} is available. Updating takes '
                'a moment and keeps everything working properly.',
                style: AppType.body.copyWith(color: AppColors.grey),
              ),
              const SizedBox(height: AppSpacing.xl),
              AppButton(
                label: 'Update now',
                icon: Icons.download_rounded,
                onPressed: () {
                  Navigator.pop(context);
                  _download(status.downloadUrl);
                },
              ),
              const SizedBox(height: AppSpacing.sm),
              AppButton(
                label: 'Not now',
                kind: AppButtonKind.ghost,
                onPressed: () => Navigator.pop(context),
              ),
            ],
          ),
        ),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final status = ref.watch(releaseStatusProvider).valueOrNull;

    if (status != null && status.updateRequired) {
      return _ForcedUpdate(
        status: status,
        onDownload: () => _download(status.downloadUrl),
      );
    }

    if (status != null && status.updateAvailable) {
      _offerOnce(status);
    }

    return widget.child;
  }
}

class _ForcedUpdate extends StatelessWidget {
  const _ForcedUpdate({required this.status, required this.onDownload});

  final ReleaseStatus status;
  final VoidCallback onDownload;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.ground,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.xl),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Icon(
                  Icons.system_update_rounded,
                  size: 44,
                  color: AppColors.blue,
                ),
                const SizedBox(height: AppSpacing.lg),
                Text(
                  'Please update to continue',
                  textAlign: TextAlign.center,
                  style: AppType.heading,
                ),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  'This version is too old to work safely with our servers. '
                  'Version ${status.latestVersion} fixes that.',
                  textAlign: TextAlign.center,
                  style: AppType.body.copyWith(color: AppColors.grey),
                ),
                const SizedBox(height: AppSpacing.xl),
                AppButton(
                  label: 'Download the update',
                  icon: Icons.download_rounded,
                  onPressed: onDownload,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
