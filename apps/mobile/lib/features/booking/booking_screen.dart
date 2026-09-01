import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api/api_error.dart';
import '../../core/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../data/models/booking.dart';
import '../../data/models/money.dart';
import '../../data/models/support.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/avatar.dart';
import '../../shared/widgets/states.dart';
import '../bookings/booking_status_ui.dart';
import 'booking_providers.dart';
import 'review_sheet.dart';
import 'widgets/otp_card.dart';
import 'widgets/progress_rail.dart';
import 'widgets/quotation_card.dart';

/// One booking, from request to paid.
///
/// The same screen changes shape eleven times. What is on it is decided by
/// status alone — no local flags, no optimistic state — because the server's
/// event log is the only thing that knows what actually happened.
class BookingScreen extends ConsumerStatefulWidget {
  const BookingScreen({super.key, required this.bookingId});

  final String bookingId;

  @override
  ConsumerState<BookingScreen> createState() => _BookingScreenState();
}

class _BookingScreenState extends ConsumerState<BookingScreen> {
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final booking = ref.watch(bookingProvider(widget.bookingId));

    return Scaffold(
      backgroundColor: AppColors.ground,
      body: SafeArea(
        child: booking.when(
          loading: () => const _Skeleton(),
          error: (e, _) => Column(
            children: [
              _TopBar(onBack: () => context.pop(), title: 'Booking'),
              Expanded(
                child: ErrorState(
                  error: e,
                  onRetry: () => ref
                      .read(bookingProvider(widget.bookingId).notifier)
                      .refresh(),
                ),
              ),
            ],
          ),
          data: (b) => Column(
            children: [
              _TopBar(onBack: () => context.pop(), title: b.shortRef),
              Expanded(
                child: RefreshIndicator(
                  color: AppColors.blue,
                  onRefresh: () => ref
                      .read(bookingProvider(widget.bookingId).notifier)
                      .refresh(),
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(
                      AppSpacing.screenX,
                      0,
                      AppSpacing.screenX,
                      AppSpacing.xl,
                    ),
                    children: _body(b),
                  ),
                ),
              ),
              _Footer(
                booking: b,
                busy: _busy,
                onCancel: () => _cancel(b),
                onPay: () => _pay(b),
              ),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _body(Booking b) {
    return [
      Text(b.status.customerLabel, style: AppType.title),
      const SizedBox(height: AppSpacing.xs),
      Text(
        b.status.customerDetail,
        style: AppType.body.copyWith(color: AppColors.grey),
      ),

      if (b.status.stageIndex >= 0) ...[
        const SizedBox(height: AppSpacing.xl),
        ProgressRail(status: b.status),
      ],

      const SizedBox(height: AppSpacing.xl),
      _Counterpart(booking: b),

      // The pending price takes the whole screen's attention when it exists —
      // it is the one thing that needs a decision.
      if (b.pendingQuotation != null) ...[
        const SectionHeader(title: 'The price'),
        QuotationCard(
          quotation: b.pendingQuotation!,
          visitFeePaise: b.visitFeePaise,
          busy: _busy,
          onApprove: () => _approve(b),
          onReject: () => _reject(b),
          onDecline: () => _declineWork(b),
        ),
      ],

      // Start code from ACCEPTED; end code only while work is in progress —
      // the API withholds each until then, and nothing here caches them.
      if (b.startOtp != null && b.status != BookingStatus.inProgress) ...[
        const SizedBox(height: AppSpacing.xl),
        OtpCard(
          code: b.startOtp!,
          kind: OtpKind.start,
          technicianName: b.counterpart.displayName,
        ),
      ],
      if (b.endOtp != null) ...[
        const SizedBox(height: AppSpacing.xl),
        OtpCard(
          code: b.endOtp!,
          kind: OtpKind.end,
          technicianName: b.counterpart.displayName,
        ),
      ],

      if (b.payable != null) ...[
        const SectionHeader(title: 'What you owe'),
        _PayableCard(booking: b),
      ],

      if (b.approvedQuotation != null && b.pendingQuotation == null) ...[
        const SectionHeader(title: 'Agreed price'),
        QuotationCard(
          quotation: b.approvedQuotation!,
          visitFeePaise: b.visitFeePaise,
        ),
      ],

      // A finished job asks for a rating once, and stops asking after it has
      // one — the API returns both sides' reviews, so it knows.
      if (b.status == BookingStatus.workDone) ...[
        const SizedBox(height: AppSpacing.xl),
        _ReviewPrompt(
          bookingId: b.id,
          technicianName: b.counterpart.displayName,
        ),
      ],

      const SectionHeader(title: 'Details'),
      _Details(booking: b),

      if (b.status.canComplain) ...[
        const SizedBox(height: AppSpacing.lg),
        AppButton(
          label: 'Report a problem',
          kind: AppButtonKind.quiet,
          onPressed: () => _complain(b),
        ),
      ],
    ];
  }

  // ── Actions ────────────────────────────────────────────────────────────

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } on ApiError catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.message)),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _approve(Booking b) async {
    final quote = b.pendingQuotation!;
    await _run(() async {
      await ref.read(bookingRepositoryProvider).approveQuotation(quote.id);
      // A price becoming binding is worth feeling, not just seeing.
      unawaited(HapticFeedback.mediumImpact());
      await ref.read(bookingProvider(widget.bookingId).notifier).refresh();
    });
  }

  Future<void> _reject(Booking b) async {
    final reason = await _askText(
      title: 'Why not at this price?',
      hint: 'They may send a revised price',
      optional: true,
    );
    if (reason == null) return;

    await _run(() async {
      await ref
          .read(bookingRepositoryProvider)
          .rejectQuotation(b.pendingQuotation!.id, reason: reason);
      await ref.read(bookingProvider(widget.bookingId).notifier).refresh();
    });
  }

  /// Ends the job. Separate from rejecting, and confirmed separately, because
  /// the visit fee becomes payable — the technician did come out.
  Future<void> _declineWork(Booking b) async {
    final confirmed = await _confirm(
      title: 'Do not go ahead?',
      message:
          'This ends the booking. You will still be charged the visit fee of '
          '${Paise.format(b.visitFeePaise)}, because ${b.counterpart.displayName} '
          'did come out to you.',
      confirmLabel: 'End the booking',
    );
    if (!confirmed) return;

    await _run(() async {
      final updated =
          await ref.read(bookingRepositoryProvider).declineWork(b.id);
      ref.read(bookingProvider(widget.bookingId).notifier).apply(updated);
    });
  }

  Future<void> _cancel(Booking b) async {
    final reason = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _ReasonSheet(
        title: 'Why are you cancelling?',
        options: CancelReasons.customer,
      ),
    );
    if (reason == null) return;

    await _run(() async {
      final updated = await ref
          .read(bookingRepositoryProvider)
          .cancel(b.id, reason: reason);
      ref.read(bookingProvider(widget.bookingId).notifier).apply(updated);
    });
  }

  Future<void> _complain(Booking b) async {
    final category = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _ReasonSheet(
        title: 'What went wrong?',
        options: ComplaintCategories.all,
      ),
    );
    if (category == null) return;

    final description = await _askText(
      title: 'Tell us what happened',
      hint: 'A few sentences so we can look into it properly',
      minLength: ComplaintCategories.minDescription,
    );
    if (description == null) return;

    await _run(() async {
      await ref.read(bookingRepositoryProvider).raiseComplaint(
            b.id,
            category: category,
            description: description,
          );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              category == 'safety'
                  // A safety complaint suspends the technician before the
                  // request even returns, so saying so is honest, not a boast.
                  ? 'Reported. We have suspended them while we look into it.'
                  : 'Reported. Someone will look at this.',
            ),
          ),
        );
      }
    });
  }

  void _pay(Booking b) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Payment is the next thing being built.')),
    );
  }

  // ── Small dialogs ──────────────────────────────────────────────────────

  Future<bool> _confirm({
    required String title,
    required String message,
    required String confirmLabel,
  }) async {
    final result = await showModalBottomSheet<bool>(
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
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: AppType.heading),
            const SizedBox(height: AppSpacing.sm),
            Text(message, style: AppType.body.copyWith(color: AppColors.grey)),
            const SizedBox(height: AppSpacing.xl),
            Row(
              children: [
                Expanded(
                  child: AppButton(
                    label: 'Go back',
                    kind: AppButtonKind.ghost,
                    onPressed: () => Navigator.pop(context, false),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: AppButton(
                    label: confirmLabel,
                    onPressed: () => Navigator.pop(context, true),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
    return result ?? false;
  }

  Future<String?> _askText({
    required String title,
    required String hint,
    bool optional = false,
    int minLength = 0,
  }) {
    final controller = TextEditingController();
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (context) => StatefulBuilder(
        builder: (context, setSheetState) => Padding(
          padding: EdgeInsets.only(
            left: AppSpacing.xl,
            right: AppSpacing.xl,
            top: AppSpacing.sm,
            bottom: AppSpacing.sheetBottom(context),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: AppType.heading),
              const SizedBox(height: AppSpacing.lg),
              TextField(
                controller: controller,
                autofocus: true,
                maxLines: 4,
                maxLength: 1000,
                onChanged: (_) => setSheetState(() {}),
                style: AppType.body,
                cursorColor: AppColors.blue,
                decoration: InputDecoration(
                  hintText: hint,
                  filled: true,
                  fillColor: AppColors.surface,
                  border: OutlineInputBorder(
                    borderRadius: AppRadius.fieldR,
                    borderSide: const BorderSide(color: AppColors.rule),
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              AppButton(
                label: 'Send',
                onPressed: controller.text.trim().length >= minLength
                    ? () => Navigator.pop(context, controller.text.trim())
                    : null,
              ),
              if (optional)
                AppButton(
                  label: 'Skip',
                  kind: AppButtonKind.quiet,
                  onPressed: () => Navigator.pop(context, ''),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.onBack, required this.title});

  final VoidCallback onBack;
  final String title;

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
          Text(
            title,
            style: AppType.meta.copyWith(
              color: AppColors.grey,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _Counterpart extends StatelessWidget {
  const _Counterpart({required this.booking});

  final Booking booking;

  @override
  Widget build(BuildContext context) {
    final c = booking.counterpart;

    return AppCard(
      child: Row(
        children: [
          Avatar(name: c.displayName, photoUrl: c.photoUrl, size: 46),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(c.displayName, style: AppType.cardTitle),
                const SizedBox(height: 2),
                Text(
                  // Masked until the booking is accepted; both sides genuinely
                  // need to reach each other once a visit is agreed.
                  c.phone ?? 'Number shown once they accept',
                  style: AppType.meta.copyWith(color: AppColors.grey),
                ),
              ],
            ),
          ),
          if (c.phoneRevealed && c.phone != null)
            AppIconButton(
              icon: Icons.phone_rounded,
              background: AppColors.greenSoft,
              foreground: AppColors.green,
              bordered: false,
              size: 40,
              onPressed: () => _call(context, c.phone!),
            ),
        ],
      ),
    );
  }
}

/// Reviews already left on this booking.
///
/// Both directions come back; only the customer's own is relevant here, and
/// its presence is what decides whether to keep asking.
final _myReviewProvider =
    FutureProvider.autoDispose.family<bool, String>((ref, bookingId) async {
  final reviews = await ref.watch(bookingRepositoryProvider).reviews(bookingId);
  return reviews.any((r) => r.isMine);
});

class _ReviewPrompt extends ConsumerWidget {
  const _ReviewPrompt({required this.bookingId, required this.technicianName});

  final String bookingId;
  final String technicianName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final reviewed = ref.watch(_myReviewProvider(bookingId));

    return reviewed.maybeWhen(
      // Nothing while it loads, and nothing on error: a failed lookup should
      // not push somebody to review a job twice.
      data: (alreadyReviewed) {
        if (alreadyReviewed) {
          return AppCard(
            color: AppColors.greenSoft,
            borderColor: AppColors.greenSoft,
            child: Row(
              children: [
                const Icon(
                  Icons.check_circle_rounded,
                  size: 18,
                  color: AppColors.green,
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Text(
                    'Thanks for rating this job.',
                    style: AppType.meta.copyWith(color: AppColors.ink),
                  ),
                ),
              ],
            ),
          );
        }

        return AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('How did it go?', style: AppType.cardTitle),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Your rating is what other people see when they are deciding '
                'who to trust.',
                style: AppType.meta.copyWith(color: AppColors.grey),
              ),
              const SizedBox(height: AppSpacing.md),
              AppButton(
                label: 'Rate $technicianName',
                kind: AppButtonKind.ghost,
                onPressed: () async {
                  final posted = await showModalBottomSheet<bool>(
                    context: context,
                    isScrollControlled: true,
                    builder: (_) => ReviewSheet(
                      bookingId: bookingId,
                      technicianName: technicianName,
                    ),
                  );
                  if (posted ?? false) {
                    ref.invalidate(_myReviewProvider(bookingId));
                  }
                },
              ),
            ],
          ),
        );
      },
      orElse: () => const SizedBox.shrink(),
    );
  }
}

/// Opens the dialler with the number filled in.
///
/// `tel:` deliberately does not place the call — Android shows the number in
/// the dialler and the person presses the button. Falls back to the clipboard
/// only if no dialler answers, which happens on a tablet with no SIM.
Future<void> _call(BuildContext context, String phone) async {
  final digits = phone.replaceAll(RegExp(r'[^\d+]'), '');
  final uri = Uri(scheme: 'tel', path: digits);

  if (await canLaunchUrl(uri)) {
    await launchUrl(uri);
    return;
  }

  await Clipboard.setData(ClipboardData(text: phone));
  if (context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('No dialler here — number copied instead')),
    );
  }
}

class _PayableCard extends StatelessWidget {
  const _PayableCard({required this.booking});

  final Booking booking;

  @override
  Widget build(BuildContext context) {
    final payable = booking.payable!;

    return AppCard(
      child: Column(
        children: [
          for (final component in payable.components)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      // labelKey is an i18n key, never display text. Until the
                      // app ships the catalogue it is humanised rather than
                      // printed raw.
                      _label(component.labelKey),
                      style: AppType.meta.copyWith(color: AppColors.inkMuted),
                    ),
                  ),
                  Text(
                    Paise.format(component.amountPaise),
                    style: AppType.amount.copyWith(
                      fontSize: 13,
                      color: component.waived ? AppColors.green : null,
                    ),
                  ),
                ],
              ),
            ),
          const Divider(height: AppSpacing.lg),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text('You pay', style: AppType.cardTitle),
              const Spacer(),
              Text(
                Paise.show(payable.payableDisplay, payable.payablePaise),
                style: AppType.amountLarge,
              ),
            ],
          ),
        ],
      ),
    );
  }

  static String _label(String key) {
    final leaf = key.split('.').last;
    final spaced = leaf.replaceAllMapped(
      RegExp('([a-z])([A-Z])'),
      (m) => '${m[1]} ${m[2]}',
    );
    return spaced[0].toUpperCase() + spaced.substring(1).toLowerCase();
  }
}

class _Details extends StatelessWidget {
  const _Details({required this.booking});

  final Booking booking;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(
        children: [
          _row('When', formatWhen(booking.startsAt)),
          if (booking.address != null)
            _row('Where', booking.address!.shortLine),
          if (booking.problemNote != null && booking.problemNote!.isNotEmpty)
            _row('Problem', booking.problemNote!),
          if (booking.agreedLabour.amountPaise != null)
            _row(
              'Agreed labour',
              Paise.format(booking.agreedLabour.amountPaise!),
            ),
        ],
      ),
    );
  }

  Widget _row(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 92,
            child: Text(
              label,
              style: AppType.meta.copyWith(color: AppColors.greyLight),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: AppType.meta.copyWith(color: AppColors.ink),
            ),
          ),
        ],
      ),
    );
  }
}

extension on BookingAddress {
  String get shortLine {
    final l = landmark;
    if (l == null || l.isEmpty) return addressText;
    return '$addressText, near $l';
  }
}

class _Footer extends StatelessWidget {
  const _Footer({
    required this.booking,
    required this.busy,
    required this.onCancel,
    required this.onPay,
  });

  final Booking booking;
  final bool busy;
  final VoidCallback onCancel;
  final VoidCallback onPay;

  @override
  Widget build(BuildContext context) {
    final status = booking.status;

    // Nothing at all once the booking is over and settled — a footer with a
    // disabled button in it is just noise.
    if (status.isTerminal && !status.isBillable) {
      return const SizedBox.shrink();
    }
    if (booking.pendingQuotation != null) return const SizedBox.shrink();

    Widget? action;
    if (status.isBillable && booking.payable != null) {
      action = AppButton(
        label:
            'Pay ${Paise.show(booking.payable!.payableDisplay, booking.payable!.payablePaise)}',
        kind: AppButtonKind.accent,
        onPressed: onPay,
      );
    } else if (status.canCustomerCancel) {
      // Disappears entirely from ARRIVED onward, rather than sitting there
      // and failing: once somebody is at the door it is a dispute, not a
      // cancellation.
      action = AppButton(
        label: 'Cancel booking',
        kind: AppButtonKind.ghost,
        onPressed: busy ? null : onCancel,
      );
    }

    if (action == null) return const SizedBox.shrink();

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
      child: action,
    );
  }
}

class _ReasonSheet extends StatelessWidget {
  const _ReasonSheet({required this.title, required this.options});

  final String title;
  final Map<String, String> options;

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
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: AppType.heading),
          const SizedBox(height: AppSpacing.lg),
          for (final entry in options.entries)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(entry.value, style: AppType.bodyMedium),
              trailing: const Icon(
                Icons.chevron_right_rounded,
                size: 18,
                color: AppColors.greyLight,
              ),
              onTap: () => Navigator.pop(context, entry.key),
            ),
        ],
      ),
    );
  }
}

class _Skeleton extends StatelessWidget {
  const _Skeleton();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.screenX),
      children: const [
        SizedBox(height: AppSpacing.xl),
        Shimmer(width: 180, height: 20),
        SizedBox(height: AppSpacing.md),
        Shimmer(width: 240, height: 11),
        SizedBox(height: AppSpacing.xxl),
        Shimmer(height: 40, radius: 8),
        SizedBox(height: AppSpacing.xl),
        Shimmer(height: 74, radius: 20),
        SizedBox(height: AppSpacing.xl),
        Shimmer(height: 150, radius: 20),
      ],
    );
  }
}
