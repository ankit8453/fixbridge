import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../data/models/category.dart';
import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/states.dart';
import 'home_providers.dart';
import 'widgets/live_booking_card.dart';
import 'widgets/service_tile.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final live = ref.watch(liveBookingProvider);
    final categories = ref.watch(categoriesProvider);
    final locale = ref.watch(localeProvider);

    // The greeting is the one place the app speaks the chosen language
    // without waiting for a server string, because it is the first thing
    // rendered and it must not flash.
    final greeting = locale.languageCode == 'hi'
        ? 'क्या ठीक करवाना है?'
        : 'What needs fixing?';

    return Scaffold(
      backgroundColor: AppColors.ground,
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          color: AppColors.blue,
          onRefresh: () async {
            ref.invalidate(categoriesProvider);
            ref.invalidate(myBookingsProvider);
            await ref.read(categoriesProvider.future);
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.screenX,
              AppSpacing.sm,
              AppSpacing.screenX,
              // Room for the floating nav to sit over the scroll.
              96,
            ),
            children: [
              // Single-city pilot, so this is fixed for now. It becomes a
              // picker when there is a second city to pick.
              const _LocationLine(city: 'Jabalpur'),
              const SizedBox(height: 3),
              Text(greeting, style: AppType.title),

              const SizedBox(height: AppSpacing.md + 2),
              _SearchField(onTap: () => context.push('/search')),

              if (live != null) ...[
                const SizedBox(height: AppSpacing.md + 2),
                LiveBookingCard(
                  booking: live,
                  onTap: () => context.push('/booking/${live.id}'),
                ),
              ],

              SectionHeader(
                title: 'Services',
                actionLabel: 'All services',
                onAction: () => context.push('/search'),
              ),

              categories.when(
                loading: () => const _TileGridSkeleton(),
                error: (e, _) => ErrorState(
                  error: e,
                  onRetry: () => ref.invalidate(categoriesProvider),
                ),
                data: (tree) => _ServiceGrid(categories: _flatten(tree)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// The home grid shows the top-level clusters, which is what somebody
  /// recognises — "Electrician", not "Ceiling fan capacitor replacement".
  /// The narrowing happens on the next screen.
  List<ServiceCategory> _flatten(List<ServiceCategory> tree) {
    final top = tree.where((c) => c.providerCount > 0).toList();
    return (top.isEmpty ? tree : top).take(6).toList();
  }
}

class _LocationLine extends StatelessWidget {
  const _LocationLine({required this.city});

  final String city;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Icon(Icons.place_rounded, size: 12, color: AppColors.blue),
        const SizedBox(width: 4),
        Text(
          city,
          style: AppType.meta.copyWith(
            color: AppColors.greyLight,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}

class _SearchField extends StatelessWidget {
  const _SearchField({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: AppRadius.fieldR,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppRadius.fieldR,
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg,
            vertical: AppSpacing.md + 1,
          ),
          decoration: BoxDecoration(
            borderRadius: AppRadius.fieldR,
            border: Border.all(color: AppColors.rule),
            boxShadow: AppColors.cardShadow,
          ),
          child: Row(
            children: [
              const Icon(Icons.search_rounded,
                  size: 18, color: AppColors.greyLight),
              const SizedBox(width: AppSpacing.sm + 2),
              Text(
                'पंखा, नल, AC…',
                style: AppType.body.copyWith(
                  color: AppColors.greyLight,
                  fontSize: 13.5,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ServiceGrid extends StatelessWidget {
  const _ServiceGrid({required this.categories});

  final List<ServiceCategory> categories;

  @override
  Widget build(BuildContext context) {
    if (categories.isEmpty) {
      return const EmptyState(
        icon: Icons.handyman_outlined,
        title: 'No services yet',
        message: 'Services will appear here as technicians join in your city.',
      );
    }

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: AppSpacing.sm + 2,
        mainAxisSpacing: AppSpacing.sm + 2,
        // Tuned so a two-line Devanagari name still fits without clipping;
        // Hindi runs longer than the same label in English.
        mainAxisExtent: 118,
      ),
      itemCount: categories.length,
      itemBuilder: (context, i) {
        final category = categories[i];
        return ServiceTile(
          category: category,
          onTap: () => context.push('/search?category=${category.id}'),
        );
      },
    );
  }
}

class _TileGridSkeleton extends StatelessWidget {
  const _TileGridSkeleton();

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: AppSpacing.sm + 2,
        mainAxisSpacing: AppSpacing.sm + 2,
        mainAxisExtent: 118,
      ),
      itemCount: 4,
      itemBuilder: (_, __) => Container(
        padding: const EdgeInsets.all(AppSpacing.md + 2),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: AppRadius.tileR,
          border: Border.all(color: AppColors.rule),
        ),
        child: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Shimmer(width: 38, height: 38, radius: 12),
            SizedBox(height: AppSpacing.md),
            Shimmer(width: 80, height: 10),
            SizedBox(height: AppSpacing.sm),
            Shimmer(width: 50, height: 8),
          ],
        ),
      ),
    );
  }
}
