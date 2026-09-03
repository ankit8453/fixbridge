import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../data/models/money.dart';
import '../../data/models/provider.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/avatar.dart';
import '../../shared/widgets/states.dart';
import '../auth/auth_controller.dart';
import 'book_sheet.dart';
import 'provider_providers.dart';

/// A technician's public profile.
///
/// The price shown here is the price the booking is made at, and the API
/// snapshots it at that moment — it cannot be moved afterwards. That is the
/// product's central promise, so the price sits above the fold rather than
/// buried under a bio.
class ProviderScreen extends ConsumerStatefulWidget {
  const ProviderScreen({
    super.key,
    required this.providerId,
    this.categoryId,
  });

  final String providerId;

  /// The service the customer was actually searching for.
  ///
  /// Load-bearing: a technician with two price cards — tank cleaning at ₹700
  /// and RO service at ₹350 — must be booked at the price for the service
  /// that was chosen. Without this the screen falls back to whichever card
  /// happens to be first, which books the wrong job at the wrong price.
  final int? categoryId;

  @override
  ConsumerState<ProviderScreen> createState() => _ProviderScreenState();
}

class _ProviderScreenState extends ConsumerState<ProviderScreen> {
  ProviderSlot? _selectedSlot;

  /// Which service is being booked. Seeded from the search, and changeable
  /// on this screen when somebody arrived without one.
  int? _categoryId;

  @override
  void initState() {
    super.initState();
    _categoryId = widget.categoryId;
  }

  /// The card for the chosen service — never simply the first one.
  PriceCard? _cardFor(ProviderProfile p) {
    if (p.priceCards.isEmpty) return null;
    if (_categoryId != null) {
      for (final card in p.priceCards) {
        if (card.categoryId == _categoryId) return card;
      }
    }
    // Arrived with no category and only one service on offer: unambiguous.
    return p.priceCards.length == 1 ? p.priceCards.first : null;
  }

  @override
  Widget build(BuildContext context) {
    final profile = ref.watch(providerProfileProvider(widget.providerId));
    final slots = ref.watch(providerSlotsProvider(widget.providerId));

    return Scaffold(
      backgroundColor: AppColors.ground,
      body: SafeArea(
        child: profile.when(
          loading: () => const _ProfileSkeleton(),
          error: (e, _) => Column(
            children: [
              _TopBar(onBack: () => context.pop()),
              Expanded(
                child: EmptyState(
                  icon: Icons.person_off_outlined,
                  title: 'Not available',
                  // The API returns the same 404 for missing, unlisted and
                  // suspended, deliberately, so that a status code cannot be
                  // used to discover a suspension. The copy has to match that
                  // — anything more specific would be a guess.
                  message: 'This technician is not available right now. '
                      'Try another one nearby.',
                  actionLabel: 'Back to search',
                  onAction: () => context.pop(),
                ),
              ),
            ],
          ),
          data: (p) => Column(
            children: [
              _TopBar(onBack: () => context.pop()),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.screenX,
                    0,
                    AppSpacing.screenX,
                    AppSpacing.xl,
                  ),
                  children: [
                    _Identity(profile: p),
                    const SizedBox(height: AppSpacing.lg),
                    _Stats(profile: p),
                    if (p.bio != null && p.bio!.trim().isNotEmpty) ...[
                      const SizedBox(height: AppSpacing.lg),
                      Text(
                        p.bio!,
                        style: AppType.body.copyWith(color: AppColors.inkMuted),
                      ),
                    ],
                    if (p.priceCards.isNotEmpty) ...[
                      SectionHeader(
                        title: p.priceCards.length == 1
                            ? 'Price'
                            : 'Which service do you need?',
                      ),
                      _Prices(
                        cards: p.priceCards,
                        selectedCategoryId: _categoryId,
                        onSelect: (card) =>
                            setState(() => _categoryId = card.categoryId),
                      ),
                    ],
                    const SectionHeader(title: 'When they can come'),
                    _Slots(
                      value: slots,
                      selected: _selectedSlot,
                      onSelect: (s) => setState(() => _selectedSlot = s),
                      onRetry: () => ref.invalidate(
                        providerSlotsProvider(widget.providerId),
                      ),
                    ),
                    _Reviews(providerId: widget.providerId),
                  ],
                ),
              ),
              _BookBar(
                card: _cardFor(p),
                needsService: p.priceCards.length > 1 && _cardFor(p) == null,
                slot: _selectedSlot,
                onBook: () => _book(p),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _book(ProviderProfile profile) async {
    final slot = _selectedSlot;
    final card = _cardFor(profile);
    if (slot == null) return;
    // Refuse rather than guess. Booking the wrong service at the wrong price
    // is the exact failure this screen exists to prevent.
    if (card == null && profile.priceCards.length > 1) return;

    // The whole browse path is public; this is the wall. Bounce through
    // sign-in and come straight back to this profile rather than dumping
    // somebody on the home screen having lost their choice.
    if (!ref.read(authControllerProvider).isSignedIn) {
      requireSignIn(context, then: '/provider/${widget.providerId}');
      return;
    }

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => BookSheet(profile: profile, slot: slot, card: card),
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.onBack});

  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        AppSpacing.sm,
        AppSpacing.md,
        AppSpacing.sm,
      ),
      child: Row(
        children: [
          AppIconButton(icon: Icons.arrow_back_rounded, onPressed: onBack),
        ],
      ),
    );
  }
}

class _Identity extends StatelessWidget {
  const _Identity({required this.profile});

  final ProviderProfile profile;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Avatar(
          name: profile.name,
          size: AppSizes.avatarLarge,
          radius: AppSizes.avatarLarge / 2,
          badge: profile.badge,
        ),
        const SizedBox(height: AppSpacing.md),
        Text(
          profile.name,
          style: AppType.title.copyWith(fontSize: 20),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 3),
        Text(
          [
            if (profile.skills.isNotEmpty) profile.skills.first.name,
            // City granularity only — the API never exposes a locality or a
            // coordinate on a public profile.
            if (profile.cityName != null) profile.cityName!,
            if (profile.badge.isEarned) 'Verified',
          ].join(' · '),
          style: AppType.meta.copyWith(color: AppColors.grey),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }
}

class _Stats extends StatelessWidget {
  const _Stats({required this.profile});

  final ProviderProfile profile;

  @override
  Widget build(BuildContext context) {
    final rating = profile.rating;

    final cells = <({String value, String label})>[
      (
        // "New" rather than a fabricated 0.0 — the API sends null until
        // somebody has actually rated this person.
        value: rating == null || rating.count == 0
            ? 'New'
            : rating.average.toStringAsFixed(1),
        label: 'Rating',
      ),
      (value: '${profile.jobsCompleted}', label: 'Jobs'),
      if (profile.yearsExperience != null)
        (value: '${profile.yearsExperience} yr', label: 'Experience'),
    ];

    return AppCard(
      padding: EdgeInsets.zero,
      child: IntrinsicHeight(
        child: Row(
          children: [
            for (var i = 0; i < cells.length; i++) ...[
              if (i > 0) const VerticalDivider(width: 1, color: AppColors.rule),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    vertical: AppSpacing.md + 1,
                    horizontal: AppSpacing.xs,
                  ),
                  child: Column(
                    children: [
                      Text(
                        cells[i].value,
                        style: AppType.heading.copyWith(fontSize: 16),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        cells[i].label.toUpperCase(),
                        style: AppType.label.copyWith(
                          color: AppColors.greyLight,
                        ),
                      ),
                    ],
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

/// The technician's services, as a chooser.
///
/// Selectable rather than informational, because the choice decides what is
/// booked and at what price. With one card it is just a price; with several
/// the customer has to say which, and the row they pick is the row that is
/// snapshotted onto the booking.
class _Prices extends StatelessWidget {
  const _Prices({
    required this.cards,
    required this.selectedCategoryId,
    required this.onSelect,
  });

  final List<PriceCard> cards;
  final int? selectedCategoryId;
  final ValueChanged<PriceCard> onSelect;

  @override
  Widget build(BuildContext context) {
    final single = cards.length == 1;

    return Column(
      children: [
        for (final card in cards)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: AppCard(
              onTap: single ? null : () => onSelect(card),
              selected: !single && card.categoryId == selectedCategoryId,
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.lg,
                vertical: AppSpacing.md + 1,
              ),
              child: Row(
                children: [
                  if (!single) ...[
                    Icon(
                      card.categoryId == selectedCategoryId
                          ? Icons.radio_button_checked_rounded
                          : Icons.radio_button_unchecked_rounded,
                      size: 18,
                      color: card.categoryId == selectedCategoryId
                          ? AppColors.blue
                          : AppColors.greyLight,
                    ),
                    const SizedBox(width: AppSpacing.md),
                  ],
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(card.title, style: AppType.bodyMedium),
                        const SizedBox(height: 1),
                        Text(
                          'Fixed price, agreed when you book',
                          style: AppType.caption.copyWith(
                            color: AppColors.greyLight,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Text(
                    Paise.show(card.display, card.amountPaise),
                    style: AppType.amount,
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _Slots extends StatelessWidget {
  const _Slots({
    required this.value,
    required this.selected,
    required this.onSelect,
    required this.onRetry,
  });

  final AsyncValue<List<ProviderSlot>> value;
  final ProviderSlot? selected;
  final ValueChanged<ProviderSlot> onSelect;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return value.when(
      loading: () => const Row(
        children: [
          Expanded(child: Shimmer(height: 58, radius: 14)),
          SizedBox(width: AppSpacing.sm),
          Expanded(child: Shimmer(height: 58, radius: 14)),
          SizedBox(width: AppSpacing.sm),
          Expanded(child: Shimmer(height: 58, radius: 14)),
        ],
      ),
      error: (e, _) => ErrorState(error: e, onRetry: onRetry),
      data: (slots) {
        if (slots.isEmpty) {
          return AppCard(
            child: Row(
              children: [
                const Icon(
                  Icons.event_busy_outlined,
                  size: 18,
                  color: AppColors.greyLight,
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Text(
                    'No free times in the next week. Try another technician.',
                    style: AppType.meta.copyWith(color: AppColors.grey),
                  ),
                ),
              ],
            ),
          );
        }

        // Grouped by day so "today" and "tomorrow" are one glance apart.
        final byDay = <String, List<ProviderSlot>>{};
        for (final slot in slots) {
          byDay.putIfAbsent(_dayLabel(slot.startsAt), () => []).add(slot);
        }

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final entry in byDay.entries) ...[
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                child: Text(
                  entry.key,
                  style: AppType.meta.copyWith(
                    color: AppColors.inkMuted,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Wrap(
                spacing: AppSpacing.sm,
                runSpacing: AppSpacing.sm,
                children: [
                  for (final slot in entry.value)
                    _SlotChip(
                      slot: slot,
                      selected: selected?.id == slot.id,
                      onTap: () => onSelect(slot),
                    ),
                ],
              ),
              const SizedBox(height: AppSpacing.md),
            ],
          ],
        );
      },
    );
  }

  /// The weekday and the date, always — matching the website.
  ///
  /// This used to read "Today", "Tomorrow", then a bare "5/9". Two problems.
  /// A day heading of "5/9" does not read as a date at a glance, and nothing
  /// past tomorrow named its weekday at all — so somebody booking for the
  /// weekend had no way to tell which chip was Saturday. "Today" still leads,
  /// because that is genuinely the most useful thing to say about today, but
  /// the date now comes with it.
  static String _dayLabel(DateTime dt) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final day = DateTime(dt.year, dt.month, dt.day);
    final diff = day.difference(today).inDays;

    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];

    final date = '${dt.day} ${months[dt.month - 1]}';

    return switch (diff) {
      0 => 'Today, $date',
      1 => 'Tomorrow, $date',
      _ => '${weekdays[dt.weekday - 1]}, $date',
    };
  }
}

class _SlotChip extends StatelessWidget {
  const _SlotChip({
    required this.slot,
    required this.selected,
    required this.onTap,
  });

  final ProviderSlot slot;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final h = slot.startsAt.hour;
    final h12 = h % 12 == 0 ? 12 : h % 12;
    final period = h < 12 ? 'am' : 'pm';
    final minute = slot.startsAt.minute;

    return Material(
      color: selected ? AppColors.blueSoft : AppColors.surface,
      borderRadius: AppRadius.fieldR,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppRadius.fieldR,
        child: Container(
          width: 74,
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
          decoration: BoxDecoration(
            borderRadius: AppRadius.fieldR,
            border: Border.all(
              color: selected ? AppColors.blue : AppColors.rule,
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Column(
            children: [
              Text(
                minute == 0
                    ? '$h12 $period'
                    : '$h12:${minute.toString().padLeft(2, '0')}',
                style: AppType.cardTitle.copyWith(
                  fontSize: 13,
                  color: selected ? AppColors.blue : AppColors.ink,
                ),
              ),
              const SizedBox(height: 1),
              Text(
                '${slot.startsAt.day}/${slot.startsAt.month}',
                style: AppType.caption.copyWith(
                  color: AppColors.greyLight,
                  fontSize: 9,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Reviews extends ConsumerWidget {
  const _Reviews({required this.providerId});

  final String providerId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final reviews = ref.watch(providerReviewsProvider(providerId));

    return reviews.maybeWhen(
      data: (page) {
        if (page.reviews.isEmpty) return const SizedBox.shrink();

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SectionHeader(title: 'What people said (${page.reviewCount})'),
            for (final review in page.reviews.take(3))
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.sm + 2),
                child: AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          for (var i = 0; i < 5; i++)
                            Icon(
                              Icons.star_rounded,
                              size: 14,
                              color: i < review.stars
                                  ? AppColors.amberText
                                  : AppColors.rule,
                            ),
                          const SizedBox(width: AppSpacing.sm),
                          Text(
                            // First name and an initial only — the API never
                            // returns a full name here, and a full name on a
                            // public review is a real safety problem.
                            review.authorName,
                            style: AppType.meta.copyWith(
                              color: AppColors.grey,
                            ),
                          ),
                        ],
                      ),
                      if (review.text != null &&
                          review.text!.trim().isNotEmpty) ...[
                        const SizedBox(height: AppSpacing.sm),
                        Text(
                          review.text!,
                          style: AppType.meta.copyWith(
                            color: AppColors.inkMuted,
                          ),
                        ),
                      ],
                      if (review.tags.isNotEmpty) ...[
                        const SizedBox(height: AppSpacing.sm),
                        Wrap(
                          spacing: AppSpacing.xs + 2,
                          runSpacing: AppSpacing.xs + 2,
                          children: [
                            for (final tag in review.tags)
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: AppSpacing.sm,
                                  vertical: 3,
                                ),
                                decoration: BoxDecoration(
                                  color: AppColors.mist,
                                  borderRadius: AppRadius.chipR,
                                ),
                                child: Text(
                                  tag.replaceAll('_', ' '),
                                  style: AppType.caption.copyWith(
                                    color: AppColors.inkMuted,
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              ),
          ],
        );
      },
      orElse: () => const SizedBox.shrink(),
    );
  }
}

/// The sticky footer. Always visible, because booking is the one thing this
/// screen exists to make happen.
class _BookBar extends StatelessWidget {
  const _BookBar({
    required this.card,
    required this.needsService,
    required this.slot,
    required this.onBook,
  });

  /// The price card for the chosen service, or null if none is chosen yet.
  final PriceCard? card;

  /// True when there are several services and the customer has not said which.
  final bool needsService;

  final ProviderSlot? slot;
  final VoidCallback onBook;

  @override
  Widget build(BuildContext context) {
    final price =
        card == null ? null : Paise.show(card!.display, card!.amountPaise);

    return Container(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screenX,
        AppSpacing.md,
        AppSpacing.screenX,
        AppSpacing.screenBottom,
      ),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.rule)),
      ),
      child: Row(
        children: [
          if (price != null) ...[
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(price, style: AppType.amountLarge.copyWith(fontSize: 20)),
                Text(
                  'agreed now',
                  style: AppType.caption.copyWith(color: AppColors.greyLight),
                ),
              ],
            ),
            const SizedBox(width: AppSpacing.lg),
          ],
          Expanded(
            child: AppButton(
              // The label names whatever is still missing, so a disabled
              // button is never a dead end somebody has to guess at.
              label: needsService
                  ? 'Pick a service'
                  : slot == null
                      ? 'Pick a time'
                      : 'Book this time',
              onPressed: (slot == null || needsService) ? null : onBook,
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileSkeleton extends StatelessWidget {
  const _ProfileSkeleton();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.screenX),
      children: const [
        SizedBox(height: AppSpacing.xl),
        Center(child: Shimmer(width: 86, height: 86, radius: 43)),
        SizedBox(height: AppSpacing.lg),
        Center(child: Shimmer(width: 160, height: 16)),
        SizedBox(height: AppSpacing.sm),
        Center(child: Shimmer(width: 110, height: 10)),
        SizedBox(height: AppSpacing.xl),
        Shimmer(height: 70, radius: 20),
        SizedBox(height: AppSpacing.xl),
        Shimmer(height: 90, radius: 20),
      ],
    );
  }
}
