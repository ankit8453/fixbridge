import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_error.dart';
import '../../core/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../data/models/partner_profile.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/states.dart';

/// The next week's slots, with the ability to block one.
///
/// Weekly hours say when somebody normally works; this is for the afternoon
/// they cannot. Blocking takes one hour off sale without touching the pattern
/// — the alternative would be editing their working hours every time
/// something comes up, and then remembering to put them back.
final _slotsProvider = FutureProvider.autoDispose<List<OwnSlot>>((ref) {
  final now = DateTime.now();
  return ref.watch(partnerRepositoryProvider).slots(
        from: now,
        to: now.add(const Duration(days: 7)),
      );
});

class CalendarScreen extends ConsumerStatefulWidget {
  const CalendarScreen({super.key});

  @override
  ConsumerState<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends ConsumerState<CalendarScreen> {
  String? _busyId;

  Future<void> _toggle(OwnSlot slot, bool blocked) async {
    setState(() => _busyId = slot.id);
    final messenger = ScaffoldMessenger.of(context);

    try {
      final repo = ref.read(partnerRepositoryProvider);
      if (blocked) {
        await repo.unblockSlot(slot.id);
      } else {
        await repo.blockSlot(slot.id);
      }
      ref.invalidate(_slotsProvider);
    } on ApiError catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final slots = ref.watch(_slotsProvider);

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
        title: const Text('Your week'),
      ),
      body: SafeArea(
        child: slots.when(
          loading: () => ListView(
            padding: const EdgeInsets.all(AppSpacing.screenX),
            children: const [
              Shimmer(height: 60, radius: 16),
              SizedBox(height: AppSpacing.sm),
              Shimmer(height: 60, radius: 16),
            ],
          ),
          error: (e, _) => ErrorState(
            error: e,
            onRetry: () => ref.invalidate(_slotsProvider),
          ),
          data: (list) {
            if (list.isEmpty) {
              return const EmptyState(
                icon: Icons.event_busy_outlined,
                title: 'No hours yet',
                message:
                    'Set the days and times you work, and bookable hours will '
                    'appear here.',
              );
            }

            // Grouped by day so "today" and "tomorrow" are one glance apart.
            final byDay = <String, List<OwnSlot>>{};
            for (final slot in list) {
              byDay.putIfAbsent(_dayLabel(slot.startsAt), () => []).add(slot);
            }

            return RefreshIndicator(
              color: AppColors.graphite,
              onRefresh: () async {
                ref.invalidate(_slotsProvider);
                await ref.read(_slotsProvider.future);
              },
              child: ListView(
                padding: const EdgeInsets.all(AppSpacing.screenX),
                children: [
                  Text(
                    'Tap an hour to take it off sale. Booked hours cannot be '
                    'changed here.',
                    style: AppType.meta.copyWith(color: AppColors.grey),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  for (final entry in byDay.entries) ...[
                    Padding(
                      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                      child: Text(
                        entry.key,
                        style: AppType.cardTitle,
                      ),
                    ),
                    Wrap(
                      spacing: AppSpacing.sm,
                      runSpacing: AppSpacing.sm,
                      children: [
                        for (final slot in entry.value)
                          _SlotChip(
                            slot: slot,
                            busy: _busyId == slot.id,
                            onTap: () => _toggle(
                              slot,
                              slot.status == 'blocked',
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.lg),
                  ],
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  static String _dayLabel(DateTime dt) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final day = DateTime(dt.year, dt.month, dt.day);
    final diff = day.difference(today).inDays;
    return switch (diff) {
      0 => 'Today',
      1 => 'Tomorrow',
      _ => '${dt.day}/${dt.month}',
    };
  }
}

class _SlotChip extends StatelessWidget {
  const _SlotChip({
    required this.slot,
    required this.busy,
    required this.onTap,
  });

  final OwnSlot slot;
  final bool busy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final booked = slot.status == 'booked';
    final blocked = slot.status == 'blocked';

    final (bg, border, fg) = booked
        ? (AppColors.greenSoft, AppColors.green, AppColors.greenDeep)
        : blocked
            ? (AppColors.mist, AppColors.rule, AppColors.greyLight)
            : (AppColors.surface, AppColors.rule, AppColors.ink);

    final h = slot.startsAt.hour % 12 == 0 ? 12 : slot.startsAt.hour % 12;
    final period = slot.startsAt.hour < 12 ? 'am' : 'pm';

    return Material(
      color: bg,
      borderRadius: AppRadius.fieldR,
      child: InkWell(
        // A booked hour belongs to a customer; only ops can move it.
        onTap: booked || busy ? null : onTap,
        borderRadius: AppRadius.fieldR,
        child: Container(
          width: 82,
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
          decoration: BoxDecoration(
            borderRadius: AppRadius.fieldR,
            border: Border.all(color: border),
          ),
          child: Column(
            children: [
              Text(
                '$h $period',
                style: AppType.cardTitle.copyWith(
                  fontSize: 13,
                  color: fg,
                  decoration: blocked ? TextDecoration.lineThrough : null,
                ),
              ),
              const SizedBox(height: 1),
              Text(
                booked
                    ? 'Booked'
                    : blocked
                        ? 'Off'
                        : 'Free',
                style: AppType.caption.copyWith(color: fg, fontSize: 9),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
