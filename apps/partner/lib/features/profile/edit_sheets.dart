import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../data/models/category.dart';
import '../../data/models/partner_profile.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/app_field.dart';
import '../../shared/widgets/states.dart';

/// The service tree, for picking a skill.
final _categoriesProvider = FutureProvider<List<ServiceCategory>>((ref) async {
  final json = await ref
      .watch(apiClientProvider)
      .get<Map<String, dynamic>>('/categories', auth: false);
  return (json['categories'] as List)
      .map((c) => ServiceCategory.fromJson((c as Map).cast<String, dynamic>()))
      .toList();
});

/// Choosing a service to add.
///
/// Only leaves are selectable — a cluster like "Electrical" is a browsing
/// heading, not a job somebody does, and the API only accepts leaf categories.
class SkillPickerSheet extends ConsumerWidget {
  const SkillPickerSheet({super.key, required this.alreadyHave});

  final List<OwnSkill> alreadyHave;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final categories = ref.watch(_categoriesProvider);
    final have = alreadyHave.map((s) => s.categoryId).toSet();

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.xl,
        AppSpacing.sm,
        AppSpacing.xl,
        AppSpacing.xl,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('What do you do?', style: AppType.heading),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Pick the exact work. You can add more than one.',
            style: AppType.meta.copyWith(color: AppColors.grey),
          ),
          const SizedBox(height: AppSpacing.lg),
          ConstrainedBox(
            constraints: BoxConstraints(
              maxHeight: MediaQuery.sizeOf(context).height * 0.5,
            ),
            child: categories.when(
              loading: () => const Column(
                children: [
                  Shimmer(height: 44, radius: 14),
                  SizedBox(height: AppSpacing.sm),
                  Shimmer(height: 44, radius: 14),
                ],
              ),
              error: (e, _) => ErrorState(
                error: e,
                onRetry: () => ref.invalidate(_categoriesProvider),
              ),
              data: (tree) => ListView(
                shrinkWrap: true,
                children: [
                  for (final cluster in tree) ...[
                    Padding(
                      padding: const EdgeInsets.only(
                        top: AppSpacing.md,
                        bottom: AppSpacing.sm,
                      ),
                      child: Text(
                        cluster.name,
                        style: AppType.label.copyWith(
                          color: AppColors.greyLight,
                        ),
                      ),
                    ),
                    // A cluster with no children is itself the job.
                    for (final leaf in cluster.children.isEmpty
                        ? [cluster]
                        : cluster.children)
                      Padding(
                        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                        child: AppCard(
                          onTap: have.contains(leaf.id)
                              ? null
                              : () => Navigator.pop(context, leaf.id),
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.lg,
                            vertical: AppSpacing.md,
                          ),
                          child: Row(
                            children: [
                              Expanded(
                                child: Text(
                                  leaf.name,
                                  style: AppType.bodyMedium.copyWith(
                                    color: have.contains(leaf.id)
                                        ? AppColors.greyLight
                                        : AppColors.ink,
                                  ),
                                ),
                              ),
                              if (have.contains(leaf.id))
                                Text(
                                  'Added',
                                  style: AppType.caption
                                      .copyWith(color: AppColors.green),
                                ),
                            ],
                          ),
                        ),
                      ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// What a technician typed for a new price.
class PriceDraft {
  const PriceDraft({
    required this.categoryId,
    required this.title,
    required this.amountPaise,
  });

  final int categoryId;
  final String title;
  final int amountPaise;
}

/// Setting a price.
///
/// The wording is deliberate about consequence: this is the number a customer
/// books at, and the API snapshots it onto the booking so it cannot be raised
/// afterwards. Somebody should know that before they type it, not when a
/// quotation gets refused.
class PriceSheet extends StatefulWidget {
  const PriceSheet({super.key, required this.skills});

  final List<OwnSkill> skills;

  @override
  State<PriceSheet> createState() => _PriceSheetState();
}

class _PriceSheetState extends State<PriceSheet> {
  final _title = TextEditingController();
  final _amount = TextEditingController();
  int? _categoryId;

  @override
  void initState() {
    super.initState();
    if (widget.skills.length == 1) {
      _categoryId = widget.skills.first.categoryId;
    }
  }

  @override
  void dispose() {
    _title.dispose();
    _amount.dispose();
    super.dispose();
  }

  int get _paise {
    final rupees = int.tryParse(_amount.text.trim());
    return rupees == null ? 0 : rupees * 100;
  }

  bool get _valid =>
      _categoryId != null && _title.text.trim().isNotEmpty && _paise >= 100;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.xl,
        right: AppSpacing.xl,
        top: AppSpacing.sm,
        bottom: MediaQuery.viewInsetsOf(context).bottom + AppSpacing.xl,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Add a price', style: AppType.heading),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'A customer books at this price, and it cannot be raised '
              'afterwards. Anything extra needs their approval on the day.',
              style: AppType.meta.copyWith(color: AppColors.grey),
            ),
            if (widget.skills.length > 1) ...[
              const SizedBox(height: AppSpacing.lg),
              Text('For which work?', style: AppType.cardTitle),
              const SizedBox(height: AppSpacing.sm),
              Wrap(
                spacing: AppSpacing.sm,
                runSpacing: AppSpacing.sm,
                children: [
                  for (final skill in widget.skills)
                    AppChip(
                      label: skill.categoryName,
                      selected: _categoryId == skill.categoryId,
                      onTap: () =>
                          setState(() => _categoryId = skill.categoryId),
                    ),
                ],
              ),
            ],
            const SizedBox(height: AppSpacing.lg),
            AppField(
              controller: _title,
              label: 'What is it?',
              hint: '500–1000 litre tank cleaning',
              maxLength: 120,
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: AppSpacing.md),
            AppField(
              controller: _amount,
              label: 'Your price',
              hint: '700',
              keyboardType: TextInputType.number,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(6),
              ],
              prefix: const Padding(
                padding: EdgeInsets.only(
                  left: AppSpacing.lg,
                  right: AppSpacing.sm,
                ),
                child: Text('₹'),
              ),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: AppSpacing.lg),
            AppButton(
              label: 'Save this price',
              onPressed: _valid
                  ? () => Navigator.pop(
                        context,
                        PriceDraft(
                          categoryId: _categoryId!,
                          title: _title.text.trim(),
                          amountPaise: _paise,
                        ),
                      )
                  : null,
            ),
          ],
        ),
      ),
    );
  }
}

/// A weekly working window.
class AvailabilityDraft {
  const AvailabilityDraft({
    required this.dayOfWeek,
    required this.startTime,
    required this.endTime,
  });

  final int dayOfWeek;
  final String startTime;
  final String endTime;
}

/// Setting the hours somebody works.
///
/// Saving one materialises bookable slots straight away, so the copy says so
/// — a technician who adds hours and sees nothing happen assumes it failed.
class AvailabilitySheet extends StatefulWidget {
  const AvailabilitySheet({super.key});

  @override
  State<AvailabilitySheet> createState() => _AvailabilitySheetState();
}

class _AvailabilitySheetState extends State<AvailabilitySheet> {
  final _days = <int>{};
  TimeOfDay _start = const TimeOfDay(hour: 9, minute: 0);
  TimeOfDay _end = const TimeOfDay(hour: 18, minute: 0);

  static const _dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  bool get _valid =>
      _days.isNotEmpty &&
      (_end.hour * 60 + _end.minute) > (_start.hour * 60 + _start.minute);

  String _fmt(TimeOfDay t) => '${t.hour.toString().padLeft(2, '0')}:'
      '${t.minute.toString().padLeft(2, '0')}';

  Future<void> _pick(bool isStart) async {
    final picked = await showTimePicker(
      context: context,
      initialTime: isStart ? _start : _end,
    );
    if (picked == null) return;
    setState(() {
      if (isStart) {
        _start = picked;
      } else {
        _end = picked;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.xl,
        AppSpacing.sm,
        AppSpacing.xl,
        AppSpacing.xl,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('When do you work?', style: AppType.heading),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Customers can only book you in these hours. They become bookable '
            'as soon as you save.',
            style: AppType.meta.copyWith(color: AppColors.grey),
          ),
          const SizedBox(height: AppSpacing.lg),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              for (var day = 0; day < 7; day++)
                GestureDetector(
                  onTap: () => setState(() {
                    if (_days.contains(day)) {
                      _days.remove(day);
                    } else {
                      _days.add(day);
                    }
                  }),
                  child: Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: _days.contains(day)
                          ? AppColors.graphite
                          : AppColors.surface,
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: _days.contains(day)
                            ? AppColors.graphite
                            : AppColors.rule,
                      ),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      _dayNames[day],
                      style: AppType.caption.copyWith(
                        color:
                            _days.contains(day) ? Colors.white : AppColors.grey,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          Row(
            children: [
              Expanded(
                child: _TimeBox(
                  label: 'From',
                  value: _start.format(context),
                  onTap: () => _pick(true),
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: _TimeBox(
                  label: 'Until',
                  value: _end.format(context),
                  onTap: () => _pick(false),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          AppButton(
            label: _days.length > 1
                ? 'Save for ${_days.length} days'
                : 'Save these hours',
            onPressed: _valid
                ? () => Navigator.pop(
                      context,
                      AvailabilityDraft(
                        // One window per call; the caller loops. The API
                        // takes a single day at a time.
                        dayOfWeek: _days.first,
                        startTime: _fmt(_start),
                        endTime: _fmt(_end),
                      ),
                    )
                : null,
          ),
        ],
      ),
    );
  }
}

class _TimeBox extends StatelessWidget {
  const _TimeBox({
    required this.label,
    required this.value,
    required this.onTap,
  });

  final String label;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.md,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label.toUpperCase(),
            style: AppType.label.copyWith(color: AppColors.greyLight),
          ),
          const SizedBox(height: 3),
          Text(value, style: AppType.cardTitle.copyWith(fontSize: 15)),
        ],
      ),
    );
  }
}
