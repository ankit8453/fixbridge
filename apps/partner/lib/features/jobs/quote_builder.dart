import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_error.dart';
import '../../core/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../data/models/booking.dart';
import '../../data/models/money.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_card.dart';

/// A part or an extra line the technician is adding.
class _Line {
  String description = '';
  int qty = 1;
  int unitPaise = 0;

  int get total => qty * unitPaise;
  bool get isValid =>
      description.trim().isNotEmpty && qty >= 1 && unitPaise >= 1;
}

/// Building the price to send.
///
/// The rules here are the API's, enforced in the UI so a technician finds out
/// before they send rather than after:
///
///   * **The agreed labour cannot be typed over.** The server derives it from
///     the booking snapshot and rejects a different figure outright.
///   * **Extra labour needs a written reason of at least ten characters**, and
///     the customer reads it before approving — so the field says so.
///   * Parts are 1..999 at 1..₹50,000 each, up to 50 lines.
///
/// Above a cap the API flags a quote for ops review rather than refusing it,
/// because blocking a genuinely large job would push it off the platform.
class QuoteBuilder extends ConsumerStatefulWidget {
  const QuoteBuilder({super.key, required this.booking});

  final Booking booking;

  @override
  ConsumerState<QuoteBuilder> createState() => _QuoteBuilderState();
}

class _QuoteBuilderState extends ConsumerState<QuoteBuilder> {
  final _extraController = TextEditingController();
  final _reasonController = TextEditingController();
  final _lines = <_Line>[];

  String? _error;
  bool _sending = false;

  /// Ten characters — "enough to be a sentence, not a shrug".
  static const _minReason = 10;
  static const _maxLines = 50;

  int get _agreedPaise => widget.booking.agreedLabour.amountPaise ?? 0;

  int get _extraPaise {
    final rupees = int.tryParse(_extraController.text.trim());
    return rupees == null ? 0 : rupees * 100;
  }

  int get _partsPaise =>
      _lines.where((l) => l.isValid).fold(0, (sum, l) => sum + l.total);

  int get _totalPaise => _agreedPaise + _extraPaise + _partsPaise;

  bool get _needsReason => _extraPaise > 0;

  bool get _canSend {
    if (_sending || _totalPaise <= 0) return false;
    if (_needsReason && _reasonController.text.trim().length < _minReason) {
      return false;
    }
    // A half-filled part line is a mistake, not an omission.
    return _lines.every((l) => l.isValid || _isEmpty(l));
  }

  bool _isEmpty(_Line l) => l.description.trim().isEmpty && l.unitPaise == 0;

  @override
  void dispose() {
    _extraController.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (!_canSend) return;
    setState(() {
      _sending = true;
      _error = null;
    });

    try {
      await ref.read(partnerRepositoryProvider).sendQuotation(
        widget.booking.id,
        labourPaise: _agreedPaise + _extraPaise,
        agreedLabourPaise: _agreedPaise,
        extraLabourPaise: _extraPaise > 0 ? _extraPaise : null,
        extraLabourReason: _extraPaise > 0 ? _reasonController.text : null,
        items: [
          for (final line in _lines.where((l) => l.isValid))
            {
              'kind': 'part',
              'description': line.description.trim(),
              'qty': line.qty,
              'unitPaise': line.unitPaise,
            },
        ],
      );

      unawaited(HapticFeedback.mediumImpact());
      if (mounted) Navigator.pop(context, true);
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _sending = false);
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
            Text('Send the price', style: AppType.heading),
            const SizedBox(height: AppSpacing.xs),
            Text(
              '${widget.booking.counterpart.displayName} approves this before '
              'you can finish the job.',
              style: AppType.meta.copyWith(color: AppColors.grey),
            ),

            const SizedBox(height: AppSpacing.lg),

            // Locked. Shown, never editable.
            AppCard(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.lg,
                vertical: AppSpacing.md + 2,
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Text(
                              'Agreed labour',
                              style: AppType.bodyMedium.copyWith(fontSize: 13),
                            ),
                            const SizedBox(width: AppSpacing.sm),
                            const _LockedChip(),
                          ],
                        ),
                        const SizedBox(height: 1),
                        Text(
                          'What the customer booked at',
                          style: AppType.caption
                              .copyWith(color: AppColors.greyLight),
                        ),
                      ],
                    ),
                  ),
                  Text(Paise.format(_agreedPaise), style: AppType.amount),
                ],
              ),
            ),

            const SizedBox(height: AppSpacing.sm),
            _ExtraLabourField(
              controller: _extraController,
              onChanged: (_) => setState(() {}),
            ),

            if (_needsReason) ...[
              const SizedBox(height: AppSpacing.sm),
              _ReasonField(
                controller: _reasonController,
                customerName: widget.booking.counterpart.displayName,
                minLength: _minReason,
                onChanged: (_) => setState(() {}),
              ),
            ],

            const SizedBox(height: AppSpacing.lg),
            Row(
              children: [
                Text('Parts used', style: AppType.cardTitle),
                const Spacer(),
                if (_lines.length < _maxLines)
                  TextButton.icon(
                    onPressed: () => setState(() => _lines.add(_Line())),
                    icon: const Icon(Icons.add_rounded, size: 16),
                    label: const Text('Add'),
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.graphite,
                      textStyle:
                          AppType.meta.copyWith(fontWeight: FontWeight.w600),
                    ),
                  ),
              ],
            ),

            if (_lines.isEmpty)
              Text(
                'Nothing yet. Add anything you had to buy or fit.',
                style: AppType.meta.copyWith(color: AppColors.greyLight),
              )
            else
              for (var i = 0; i < _lines.length; i++)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                  child: _LineEditor(
                    line: _lines[i],
                    onChanged: () => setState(() {}),
                    onRemove: () => setState(() => _lines.removeAt(i)),
                  ),
                ),

            const SizedBox(height: AppSpacing.lg),
            Container(
              padding: const EdgeInsets.only(top: AppSpacing.md + 2),
              decoration: const BoxDecoration(
                border: Border(
                  top: BorderSide(color: AppColors.ink, width: 2),
                ),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text('Total', style: AppType.cardTitle),
                  const Spacer(),
                  Text(
                    Paise.format(_totalPaise),
                    style: AppType.amountLarge.copyWith(fontSize: 27),
                  ),
                ],
              ),
            ),

            if (_error != null) ...[
              const SizedBox(height: AppSpacing.md),
              Text(
                _error!,
                style: AppType.meta.copyWith(color: AppColors.red),
              ),
            ],

            const SizedBox(height: AppSpacing.lg),
            AppButton(
              label: 'Send to ${widget.booking.counterpart.displayName}',
              kind: AppButtonKind.accent,
              loading: _sending,
              onPressed: _canSend ? _send : null,
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'You can send a revised price if they say no.',
              style: AppType.caption.copyWith(color: AppColors.grey),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class _LockedChip extends StatelessWidget {
  const _LockedChip();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
      decoration: BoxDecoration(
        color: AppColors.graphiteSoft,
        borderRadius: AppRadius.chipR,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.lock_rounded, size: 8, color: AppColors.graphite),
          const SizedBox(width: 3),
          Text(
            'LOCKED',
            style:
                AppType.label.copyWith(color: AppColors.graphite, fontSize: 8),
          ),
        ],
      ),
    );
  }
}

class _ExtraLabourField extends StatelessWidget {
  const _ExtraLabourField({
    required this.controller,
    required this.onChanged,
  });

  final TextEditingController controller;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.sm,
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Extra labour',
                  style: AppType.bodyMedium.copyWith(fontSize: 13),
                ),
                const SizedBox(height: 1),
                Text(
                  'Only if the job was more than agreed',
                  style: AppType.caption.copyWith(color: AppColors.greyLight),
                ),
              ],
            ),
          ),
          SizedBox(
            width: 96,
            child: TextField(
              controller: controller,
              onChanged: onChanged,
              keyboardType: TextInputType.number,
              textAlign: TextAlign.right,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(6),
              ],
              style: AppType.amount.copyWith(color: AppColors.amber),
              cursorColor: AppColors.graphite,
              decoration: InputDecoration(
                prefixText: '₹ ',
                prefixStyle: AppType.amount.copyWith(color: AppColors.grey),
                hintText: '0',
                hintStyle: AppType.amount.copyWith(color: AppColors.greyLight),
                border: InputBorder.none,
                isDense: true,
                contentPadding: EdgeInsets.zero,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ReasonField extends StatelessWidget {
  const _ReasonField({
    required this.controller,
    required this.customerName,
    required this.minLength,
    required this.onChanged,
  });

  final TextEditingController controller;
  final String customerName;
  final int minLength;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final short = controller.text.trim().length < minLength;

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
          Text(
            // Naming the reader is the point: this is the sentence the
            // customer weighs before approving.
            'WHY — ${customerName.toUpperCase()} WILL READ THIS',
            style: AppType.label.copyWith(
              color: AppColors.amber,
              fontSize: 8.5,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          TextField(
            controller: controller,
            onChanged: onChanged,
            maxLines: 3,
            maxLength: 300,
            style: AppType.meta.copyWith(color: AppColors.amber, height: 1.5),
            cursorColor: AppColors.amber,
            decoration: InputDecoration(
              hintText: 'Capacitor had burnt and the board needed rewiring — '
                  'about 45 minutes more',
              hintStyle: AppType.meta.copyWith(
                color: AppColors.amber.withValues(alpha: 0.5),
              ),
              border: InputBorder.none,
              isDense: true,
              contentPadding: EdgeInsets.zero,
              counterText: '',
            ),
          ),
          if (short)
            Text(
              'A sentence, not a word — at least $minLength characters.',
              style: AppType.caption.copyWith(color: AppColors.amber),
            ),
        ],
      ),
    );
  }
}

class _LineEditor extends StatelessWidget {
  const _LineEditor({
    required this.line,
    required this.onChanged,
    required this.onRemove,
  });

  final _Line line;
  final VoidCallback onChanged;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md + 2,
        vertical: AppSpacing.sm,
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  onChanged: (v) {
                    line.description = v;
                    onChanged();
                  },
                  maxLength: 120,
                  style: AppType.bodyMedium.copyWith(fontSize: 13),
                  cursorColor: AppColors.graphite,
                  decoration: InputDecoration(
                    hintText: 'What was it?',
                    hintStyle: AppType.bodyMedium.copyWith(
                      fontSize: 13,
                      color: AppColors.greyLight,
                    ),
                    border: InputBorder.none,
                    isDense: true,
                    contentPadding: EdgeInsets.zero,
                    counterText: '',
                  ),
                ),
              ),
              IconButton(
                onPressed: onRemove,
                icon: const Icon(
                  Icons.close_rounded,
                  size: 16,
                  color: AppColors.greyLight,
                ),
                visualDensity: VisualDensity.compact,
              ),
            ],
          ),
          Row(
            children: [
              SizedBox(
                width: 58,
                child: TextField(
                  onChanged: (v) {
                    line.qty = int.tryParse(v) ?? 1;
                    onChanged();
                  },
                  keyboardType: TextInputType.number,
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(3),
                  ],
                  style: AppType.meta.copyWith(color: AppColors.ink),
                  cursorColor: AppColors.graphite,
                  decoration: InputDecoration(
                    hintText: 'Qty',
                    hintStyle:
                        AppType.meta.copyWith(color: AppColors.greyLight),
                    border: InputBorder.none,
                    isDense: true,
                    contentPadding: EdgeInsets.zero,
                  ),
                ),
              ),
              Text('×',
                  style: AppType.meta.copyWith(color: AppColors.greyLight)),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: TextField(
                  onChanged: (v) {
                    final rupees = int.tryParse(v);
                    line.unitPaise = rupees == null ? 0 : rupees * 100;
                    onChanged();
                  },
                  keyboardType: TextInputType.number,
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(6),
                  ],
                  style: AppType.meta.copyWith(color: AppColors.ink),
                  cursorColor: AppColors.graphite,
                  decoration: InputDecoration(
                    prefixText: '₹ ',
                    prefixStyle:
                        AppType.meta.copyWith(color: AppColors.greyLight),
                    hintText: 'Each',
                    hintStyle:
                        AppType.meta.copyWith(color: AppColors.greyLight),
                    border: InputBorder.none,
                    isDense: true,
                    contentPadding: EdgeInsets.zero,
                  ),
                ),
              ),
              if (line.total > 0)
                Text(Paise.format(line.total), style: AppType.amount),
            ],
          ),
        ],
      ),
    );
  }
}
