import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../core/theme/app_colors.dart';
import '../core/theme/app_spacing.dart';
import '../core/theme/app_typography.dart';
import '../shared/widgets/app_button.dart';

/// Screens still being written.
///
/// Present as real routes so navigation, the tab shell and deep links are all
/// exercised from the first run — a route that does not exist yet fails in a
/// different way from one that is merely empty, and the second is far easier
/// to find problems in.
///
/// Each names the endpoints it will use, so what is missing is legible rather
/// than mysterious.
class ComingNext extends StatelessWidget {
  const ComingNext({
    super.key,
    required this.title,
    required this.what,
    required this.endpoints,
    this.showBack = true,
  });

  final String title;
  final String what;
  final List<String> endpoints;
  final bool showBack;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.ground,
      appBar: AppBar(
        leading: showBack && context.canPop()
            ? Padding(
                padding: const EdgeInsets.only(left: AppSpacing.md),
                child: AppIconButton(
                  icon: Icons.arrow_back_rounded,
                  onPressed: () => context.pop(),
                ),
              )
            : null,
        automaticallyImplyLeading: false,
        title: Text(title),
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 64,
                height: 64,
                decoration: const BoxDecoration(
                  color: AppColors.graphiteSoft,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.construction_rounded,
                  color: AppColors.graphite,
                  size: 28,
                ),
              ),
              const SizedBox(height: AppSpacing.lg),
              Text(title, style: AppType.heading, textAlign: TextAlign.center),
              const SizedBox(height: AppSpacing.sm),
              Text(
                what,
                style: AppType.body.copyWith(color: AppColors.grey),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.xl),
              Container(
                padding: const EdgeInsets.all(AppSpacing.md),
                decoration: BoxDecoration(
                  color: AppColors.mist,
                  borderRadius: AppRadius.tileR,
                  border: Border.all(color: AppColors.rule),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'WIRES UP TO',
                      style: AppType.label.copyWith(color: AppColors.greyLight),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    for (final endpoint in endpoints)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 3),
                        child: Text(
                          endpoint,
                          style: AppType.caption.copyWith(
                            color: AppColors.inkMuted,
                            fontFamily: 'monospace',
                          ),
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

class JobScreen extends StatelessWidget {
  const JobScreen({super.key, required this.bookingId});

  final String bookingId;

  @override
  Widget build(BuildContext context) {
    return const ComingNext(
      title: 'The job',
      what: 'Set off, take the start code, send the price, and finish with '
          'the end code.',
      endpoints: [
        'POST /bookings/:id/en-route',
        'POST /bookings/:id/start',
        'POST /bookings/:id/quotations',
        'POST /bookings/:id/complete',
      ],
    );
  }
}

class JobsScreen extends StatelessWidget {
  const JobsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const ComingNext(
      title: 'Jobs',
      what: 'Everything you have done, and everything still open.',
      endpoints: ['GET /bookings?side=provider'],
      showBack: false,
    );
  }
}

class WalletScreen extends StatelessWidget {
  const WalletScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const ComingNext(
      title: 'Money',
      what: 'What you are owed, what you owe, and every payout with its bank '
          'reference.',
      endpoints: ['GET /providers/me/wallet'],
      showBack: false,
    );
  }
}

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const ComingNext(
      title: 'You',
      what: 'Your services, your prices, when you work, and your standing.',
      endpoints: [
        'GET /providers/me',
        'GET /providers/me/trust',
        'POST /providers/me/skills',
        'POST /providers/me/price-cards',
        'POST /providers/me/availability',
      ],
      showBack: false,
    );
  }
}

class SetupScreen extends StatelessWidget {
  const SetupScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const ComingNext(
      title: 'Finish setting up',
      what: 'The two things that have to be done before customers can find '
          'you: your profile, and getting verified.',
      endpoints: [
        'GET /providers/me  (completeness)',
        'GET /verification/cases',
        'POST /verification/levels/:level/submit',
      ],
    );
  }
}
