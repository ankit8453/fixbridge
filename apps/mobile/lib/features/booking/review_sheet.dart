import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_error.dart';
import '../../core/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../data/models/support.dart';
import '../../shared/widgets/app_button.dart';

/// Rating a finished job.
///
/// Stars first, tags second, words optional — in that order because that is
/// the order of decreasing likelihood that somebody will actually fill it in.
/// The tags come from the API's own customer→provider list; the technician's
/// side has a negative tag and this one deliberately does not.
class ReviewSheet extends ConsumerStatefulWidget {
  const ReviewSheet({
    super.key,
    required this.bookingId,
    required this.technicianName,
  });

  final String bookingId;
  final String technicianName;

  @override
  ConsumerState<ReviewSheet> createState() => _ReviewSheetState();
}

class _ReviewSheetState extends ConsumerState<ReviewSheet> {
  final _text = TextEditingController();
  final _tags = <String>{};
  int _stars = 0;
  String? _error;
  bool _saving = false;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_stars == 0 || _saving) return;

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      await ref.read(bookingRepositoryProvider).leaveReview(
            widget.bookingId,
            stars: _stars,
            tags: _tags.toList(),
            text: _text.text,
          );
      if (mounted) Navigator.pop(context, true);
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.xl,
        right: AppSpacing.xl,
        top: AppSpacing.sm,
        bottom: AppSpacing.sheetBottom(context),
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'How was ${widget.technicianName}?',
              style: AppType.heading,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.xl),

            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var i = 1; i <= 5; i++)
                  GestureDetector(
                    onTap: () {
                      HapticFeedback.selectionClick();
                      setState(() => _stars = i);
                    },
                    behavior: HitTestBehavior.opaque,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 6),
                      child: Icon(
                        i <= _stars
                            ? Icons.star_rounded
                            : Icons.star_outline_rounded,
                        size: 40,
                        color:
                            i <= _stars ? AppColors.amberText : AppColors.rule,
                      ),
                    ),
                  ),
              ],
            ),

            // Tags only once a rating exists — asking what was good before
            // knowing whether it was good is the wrong order.
            if (_stars > 0) ...[
              const SizedBox(height: AppSpacing.xl),
              Text(
                'What stood out? (optional)',
                style: AppType.meta.copyWith(color: AppColors.grey),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.md),
              Wrap(
                alignment: WrapAlignment.center,
                spacing: AppSpacing.sm,
                runSpacing: AppSpacing.sm,
                children: [
                  for (final tag in ReviewTags.customerToProvider.entries)
                    _Tag(
                      label: tag.value,
                      selected: _tags.contains(tag.key),
                      onTap: () => setState(() {
                        if (_tags.contains(tag.key)) {
                          _tags.remove(tag.key);
                          // The API caps a review at five tags and rejects a
                          // sixth, so the limit is enforced here rather than
                          // surfaced as a validation error afterwards.
                        } else if (_tags.length < ReviewTags.maxTags) {
                          _tags.add(tag.key);
                        }
                      }),
                    ),
                ],
              ),
              const SizedBox(height: AppSpacing.lg),
              TextField(
                controller: _text,
                maxLines: 3,
                maxLength: 500,
                style: AppType.body,
                cursorColor: AppColors.blue,
                decoration: InputDecoration(
                  hintText: 'Anything else? (optional)',
                  hintStyle: AppType.body.copyWith(color: AppColors.greyLight),
                  filled: true,
                  fillColor: AppColors.surface,
                  border: OutlineInputBorder(
                    borderRadius: AppRadius.fieldR,
                    borderSide: const BorderSide(color: AppColors.rule),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: AppRadius.fieldR,
                    borderSide: const BorderSide(color: AppColors.rule),
                  ),
                ),
              ),
            ],

            if (_error != null) ...[
              const SizedBox(height: AppSpacing.md),
              Text(
                _error!,
                style: AppType.meta.copyWith(color: AppColors.red),
                textAlign: TextAlign.center,
              ),
            ],

            const SizedBox(height: AppSpacing.lg),
            AppButton(
              label: 'Post review',
              loading: _saving,
              onPressed: _stars == 0 ? null : _submit,
            ),
            const SizedBox(height: AppSpacing.sm),
            AppButton(
              label: 'Not now',
              kind: AppButtonKind.quiet,
              onPressed: _saving ? null : () => Navigator.pop(context, false),
            ),
          ],
        ),
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.blueSoft : AppColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: AppRadius.chipR,
        side: BorderSide(color: selected ? AppColors.blue : AppColors.rule),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md + 2,
            vertical: AppSpacing.sm + 2,
          ),
          child: Text(
            label,
            style: AppType.meta.copyWith(
              color: selected ? AppColors.blue : AppColors.inkMuted,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ),
    );
  }
}
