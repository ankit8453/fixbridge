import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/states.dart';
import '../home/home_providers.dart';
import '../location/location_sheet.dart';
import 'search_providers.dart';
import 'widgets/provider_card_tile.dart';

/// Search.
///
/// Public — no session needed. Somebody reaches this having decided something
/// is broken, and asking them to make an account before showing a single
/// technician is the fastest way to lose them. The sign-in wall comes at
/// *Book*, not here.
class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key, this.categoryId});

  /// Set when arriving from a home-screen service tile.
  final int? categoryId;

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  final _controller = TextEditingController();
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    if (widget.categoryId != null) {
      // Arriving with a category already chosen: seed it before the first
      // build so results load immediately rather than after a frame.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        ref.read(searchQueryProvider.notifier).state =
            SearchQuery(categoryId: widget.categoryId);
      });
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  String _categoryName(int? id) {
    if (id == null) return 'All services';
    final tree = ref.read(categoriesProvider).valueOrNull ?? const [];
    for (final cluster in tree) {
      if (cluster.id == id) return cluster.name;
      for (final child in cluster.children) {
        if (child.id == id) return child.name;
      }
    }
    return 'Results';
  }

  @override
  Widget build(BuildContext context) {
    final query = ref.watch(searchQueryProvider);
    final results = ref.watch(searchResultsProvider);
    // False while the origin is still resolving, so the banner never flashes
    // up before we know whether it is needed.
    final guessing =
        ref.watch(searchOriginProvider).valueOrNull?.usingFallback ?? false;
    final suggestions = ref.watch(suggestionsProvider);
    final showSuggestions = _focus.hasFocus && query.text.trim().length >= 2;

    return Scaffold(
      backgroundColor: AppColors.ground,
      body: SafeArea(
        child: Column(
          children: [
            _SearchBar(
              controller: _controller,
              focusNode: _focus,
              onChanged: (value) {
                ref.read(searchQueryProvider.notifier).state =
                    query.copyWith(text: value);
                setState(() {});
              },
              onBack: () => context.pop(),
              onClear: () {
                _controller.clear();
                ref.read(searchQueryProvider.notifier).state =
                    query.copyWith(text: '');
                setState(() {});
              },
            ),
            if (showSuggestions)
              Expanded(
                child: _Suggestions(
                  value: suggestions,
                  onPick: (categoryId, name) {
                    _controller.text = name;
                    _focus.unfocus();
                    ref.read(searchQueryProvider.notifier).state =
                        query.copyWith(text: name, categoryId: categoryId);
                    setState(() {});
                  },
                ),
              )
            else ...[
              _Header(
                title: _categoryName(query.categoryId),
                results: results,
              ),
              _SortRow(
                sort: query.sort,
                onSort: (sort) => ref.read(searchQueryProvider.notifier).state =
                    query.copyWith(sort: sort),
              ),
              Expanded(
                child: results.when(
                  loading: () => const _ResultsSkeleton(),
                  error: (e, _) => ErrorState(
                    error: e,
                    onRetry: () => ref.invalidate(searchResultsProvider),
                  ),
                  data: (page) => page.results.isEmpty
                      ? EmptyState(
                          icon: Icons.person_search_outlined,
                          title: 'Nobody available yet',
                          message: query.categoryId == null
                              ? 'No technicians are listed near you right now. '
                                  'We are adding them city by city.'
                              : 'No one is offering this service nearby yet. '
                                  'Try another service, or check back soon.',
                          actionLabel: query.categoryId == null
                              ? null
                              : 'See all services',
                          onAction: () => ref
                              .read(searchQueryProvider.notifier)
                              .state = query.copyWith(clearCategory: true),
                        )
                      : RefreshIndicator(
                          color: AppColors.blue,
                          onRefresh: () async {
                            ref.invalidate(searchResultsProvider);
                            await ref.read(searchResultsProvider.future);
                          },
                          child: ListView.separated(
                            padding: const EdgeInsets.fromLTRB(
                              AppSpacing.screenX,
                              AppSpacing.sm,
                              AppSpacing.screenX,
                              AppSpacing.xl,
                            ),
                            // One extra row for the banner, when the origin
                            // is a guess. A distance measured from the wrong
                            // point looks identical to a correct one.
                            itemCount: page.results.length + (guessing ? 1 : 0),
                            separatorBuilder: (_, __) =>
                                const SizedBox(height: AppSpacing.md),
                            itemBuilder: (_, index) {
                              if (guessing && index == 0) {
                                return const _ApproximateOrigin();
                              }
                              final i = guessing ? index - 1 : index;
                              return ProviderCardTile(
                                provider: page.results[i],
                                // Carry the searched service through, so the
                                // profile prices the job the customer asked
                                // about rather than a different one.
                                onTap: () => context.push(
                                  '/provider/${page.results[i].providerId}'
                                  '${query.categoryId != null ? '?category=${query.categoryId}' : ''}',
                                ),
                              );
                            },
                          ),
                        ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _SearchBar extends StatelessWidget {
  const _SearchBar({
    required this.controller,
    required this.focusNode,
    required this.onChanged,
    required this.onBack,
    required this.onClear,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final ValueChanged<String> onChanged;
  final VoidCallback onBack;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        AppSpacing.sm,
        AppSpacing.screenX,
        AppSpacing.md,
      ),
      child: Row(
        children: [
          AppIconButton(icon: Icons.arrow_back_rounded, onPressed: onBack),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Container(
              height: AppSizes.fieldHeight,
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: AppRadius.fieldR,
                border: Border.all(color: AppColors.rule),
                boxShadow: AppColors.cardShadow,
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.search_rounded,
                    size: 18,
                    color: AppColors.greyLight,
                  ),
                  const SizedBox(width: AppSpacing.sm + 2),
                  Expanded(
                    child: TextField(
                      controller: controller,
                      focusNode: focusNode,
                      onChanged: onChanged,
                      autofocus: true,
                      textInputAction: TextInputAction.search,
                      style: AppType.body.copyWith(fontSize: 14),
                      cursorColor: AppColors.blue,
                      decoration: InputDecoration(
                        // Devanagari in the placeholder, because that is the
                        // default language and the field must look usable in
                        // it before anybody types.
                        hintText: 'पंखा, नल, AC…',
                        hintStyle: AppType.body.copyWith(
                          color: AppColors.greyLight,
                          fontSize: 14,
                        ),
                        border: InputBorder.none,
                        isDense: true,
                        contentPadding: EdgeInsets.zero,
                      ),
                    ),
                  ),
                  if (controller.text.isNotEmpty)
                    GestureDetector(
                      onTap: onClear,
                      child: const Icon(
                        Icons.close_rounded,
                        size: 18,
                        color: AppColors.greyLight,
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Suggestions extends StatelessWidget {
  const _Suggestions({required this.value, required this.onPick});

  final AsyncValue<List<dynamic>> value;
  final void Function(int categoryId, String name) onPick;

  @override
  Widget build(BuildContext context) {
    return value.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(AppSpacing.xl),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Shimmer(width: 180, height: 12),
            SizedBox(height: AppSpacing.lg),
            Shimmer(width: 140, height: 12),
          ],
        ),
      ),
      error: (_, __) => const SizedBox.shrink(),
      data: (items) {
        if (items.isEmpty) {
          return Padding(
            padding: const EdgeInsets.all(AppSpacing.xl),
            child: Text(
              'Nothing matches that yet. Try a simpler word — "fan", "tap", '
              '"AC" — or browse all services.',
              style: AppType.body.copyWith(color: AppColors.grey),
            ),
          );
        }

        return ListView.separated(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screenX),
          itemCount: items.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (_, i) {
            final s = items[i];
            return ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: AppColors.blueSoft,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: const Icon(
                  Icons.search_rounded,
                  size: 16,
                  color: AppColors.blue,
                ),
              ),
              title: Text(s.name as String, style: AppType.bodyMedium),
              // A cluster is a family of services; a leaf is one job. Saying
              // which avoids "why did picking Electrical show me 40 people?"
              subtitle: Text(
                s.parentId == null ? 'Service category' : 'Service',
                style: AppType.caption.copyWith(color: AppColors.greyLight),
              ),
              onTap: () => onPick(s.categoryId as int, s.name as String),
            );
          },
        );
      },
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.title, required this.results});

  final String title;
  final AsyncValue<dynamic> results;

  @override
  Widget build(BuildContext context) {
    final page = results.valueOrNull;
    final count = page?.results.length as int? ?? 0;
    final truncated = page?.truncated as bool? ?? false;

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screenX,
        0,
        AppSpacing.screenX,
        AppSpacing.sm,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: AppType.title.copyWith(fontSize: 21)),
          if (page != null) ...[
            const SizedBox(height: 2),
            Text(
              // `truncated` means more matched than were ranked, so quoting
              // the number as exact would be a small lie.
              count == 0
                  ? 'None available'
                  : truncated
                      ? 'Many available nearby'
                      : '$count available nearby',
              style: AppType.meta.copyWith(color: AppColors.grey),
            ),
          ],
        ],
      ),
    );
  }
}

class _SortRow extends StatelessWidget {
  const _SortRow({required this.sort, required this.onSort});

  final String sort;
  final ValueChanged<String> onSort;

  static const _options = [
    (key: 'rank', label: 'Best match'),
    (key: 'distance', label: 'Nearest'),
    (key: 'price_low', label: 'Price'),
  ];

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 44,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screenX),
        itemCount: _options.length,
        separatorBuilder: (_, __) => const SizedBox(width: AppSpacing.sm),
        itemBuilder: (_, i) => Center(
          child: AppChip(
            label: _options[i].label,
            selected: sort == _options[i].key,
            onTap: () => onSort(_options[i].key),
          ),
        ),
      ),
    );
  }
}

class _ResultsSkeleton extends StatelessWidget {
  const _ResultsSkeleton();

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screenX,
        AppSpacing.sm,
        AppSpacing.screenX,
        AppSpacing.xl,
      ),
      itemCount: 4,
      separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
      itemBuilder: (_, __) => AppCard(
        child: Row(
          children: [
            const Shimmer(width: 46, height: 46, radius: 15),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: const [
                  Shimmer(width: 140, height: 11),
                  SizedBox(height: AppSpacing.sm),
                  Shimmer(width: 100, height: 9),
                  SizedBox(height: 6),
                  Shimmer(width: 80, height: 9),
                ],
              ),
            ),
            const Shimmer(width: 44, height: 16),
          ],
        ),
      ),
    );
  }
}

/// Says plainly that distances are measured from the middle of town.
///
/// Shown only when the app could not get a location and has nothing saved.
/// Without it, "1.2 km away" reads as a fact when it is really a guess from a
/// point the customer may be nowhere near.
/// Says plainly that distances are measured from the middle of town, and
/// opens the same picker the home header uses.
///
/// Deliberately not a second permission flow: one place asks for location in
/// this app, and this is a shortcut to it.
class _ApproximateOrigin extends StatelessWidget {
  const _ApproximateOrigin();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.amberSoft,
        borderRadius: AppRadius.tileR,
        border: Border.all(color: AppColors.amberLine),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.location_off_outlined,
                size: 18,
                color: AppColors.amberText,
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Text(
                  'Distances are measured from the city centre until we know '
                  'where you are.',
                  style: AppType.meta.copyWith(color: AppColors.amberText),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          AppButton(
            label: 'Set your location',
            kind: AppButtonKind.ghost,
            icon: Icons.my_location_rounded,
            onPressed: () => showModalBottomSheet(
              context: context,
              isScrollControlled: true,
              builder: (_) => const LocationSheet(),
            ),
          ),
        ],
      ),
    );
  }
}
