import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../core/theme/app_colors.dart';
import '../core/theme/app_spacing.dart';
import '../core/theme/app_typography.dart';
import '../shared/widgets/app_button.dart';

export '../features/account/account_screen.dart';
export '../features/bookings/bookings_screen.dart';
export '../features/notifications/notifications_screen.dart';

/// Screens the next phase builds.
///
/// Present as routes rather than missing, so navigation, deep links and the
/// back stack are all exercised from the start — a route that does not exist
/// yet fails differently from one that is simply empty, and the second is far
/// easier to find problems in.
class _NotBuiltYet extends StatelessWidget {
  const _NotBuiltYet({
    required this.title,
    required this.what,
    required this.endpoints,
  });

  final String title;
  final String what;
  final List<String> endpoints;

  @override
  Widget build(BuildContext context) {
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
                  color: AppColors.blueSoft,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.construction_rounded,
                  color: AppColors.blue,
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

class SearchScreen extends StatelessWidget {
  const SearchScreen({super.key, this.categoryId});

  final int? categoryId;

  @override
  Widget build(BuildContext context) {
    return const _NotBuiltYet(
      title: 'Search',
      what: 'Type-ahead suggestions and ranked technicians near you.',
      endpoints: ['GET /search/resolve', 'GET /search/providers'],
    );
  }
}

class ProviderScreen extends StatelessWidget {
  const ProviderScreen({super.key, required this.providerId});

  final String providerId;

  @override
  Widget build(BuildContext context) {
    return const _NotBuiltYet(
      title: 'Technician',
      what: 'Their profile, price, open slots and reviews — then Book.',
      endpoints: [
        'GET /providers/:id',
        'GET /providers/:id/slots',
        'GET /providers/:id/reviews',
        'POST /bookings',
      ],
    );
  }
}

class BookingScreen extends StatelessWidget {
  const BookingScreen({super.key, required this.bookingId});

  final String bookingId;

  @override
  Widget build(BuildContext context) {
    return const _NotBuiltYet(
      title: 'Your booking',
      what:
          'The live progress rail, the start and end codes, the quotation, '
          'and payment.',
      endpoints: [
        'GET /bookings/:id  (polled)',
        'GET /bookings/:id/quotations',
        'POST /quotations/:id/approve',
        'POST /bookings/:id/payments',
      ],
    );
  }
}
