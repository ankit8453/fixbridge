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
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/states.dart';
import '../home/partner_providers.dart';
import 'job_providers.dart';
import 'job_status_ui.dart';
import 'quote_builder.dart';
import 'widgets/otp_entry_sheet.dart';

/// One job, from accepted to paid.
///
/// The technician drives every transition here, so the screen is organised
/// around the single next action rather than around status. Whatever they
/// should do now is the button at the bottom, and there is only ever one.
class JobScreen extends ConsumerStatefulWidget {
  const JobScreen({super.key, required this.bookingId});

  final String bookingId;

  @override
  ConsumerState<JobScreen> createState() => _JobScreenState();
}

class _JobScreenState extends ConsumerState<JobScreen> {
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final job = ref.watch(jobProvider(widget.bookingId));

    return Scaffold(
      backgroundColor: AppColors.ground,
      body: SafeArea(
        child: job.when(
          loading: () => const _Skeleton(),
          error: (e, _) => Column(
            children: [
              _TopBar(onBack: () => context.pop(), title: 'Job'),
              Expanded(
                child: ErrorState(
                  error: e,
                  onRetry: () => ref
                      .read(jobProvider(widget.bookingId).notifier)
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
                  color: AppColors.graphite,
                  onRefresh: () => ref
                      .read(jobProvider(widget.bookingId).notifier)
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
              _ActionBar(
                booking: b,
                busy: _busy,
                onAction: () => _primaryAction(b),
                onCancel: () => _cancel(b),
              ),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _body(Booking b) {
    final status = b.status;

    return [
      Text(status.partnerLabel, style: AppType.title),
      if (status.nextAction.isNotEmpty) ...[
        const SizedBox(height: AppSpacing.xs),
        Text(
          status.nextAction,
          style: AppType.body.copyWith(color: AppColors.grey),
        ),
      ],

      const SizedBox(height: AppSpacing.xl),
      _CustomerCard(booking: b),

      // Only after acceptance does the API hand over the address at all.
      if (b.address != null) ...[
        const SizedBox(height: AppSpacing.md),
        _AddressCard(address: b.address!),
      ],

      if (b.problemNote != null && b.problemNote!.trim().isNotEmpty) ...[
        const SectionHeader(title: 'What they said'),
        AppCard(
          child: Text(
            '“${b.problemNote!.trim()}”',
            style: AppType.body.copyWith(color: AppColors.inkMuted),
          ),
        ),
      ],

      // A quote awaiting the customer blocks finishing, so it is stated
      // rather than left to be discovered at the OTP step.
      if (b.pendingQuotation != null) ...[
        const SectionHeader(title: 'Price sent'),
        _PendingQuoteCard(
          booking: b,
          busy: _busy,
          onWithdraw: () => _withdraw(b),
        ),
      ],

      if (b.approvedQuotation != null) ...[
        const SectionHeader(title: 'Agreed price'),
        _ApprovedQuoteCard(booking: b),
      ],

      const SectionHeader(title: 'The job'),
      _Details(booking: b),

      if (status.isBillable) ...[
        const SectionHeader(title: 'Getting paid'),
        _PaymentCard(
          booking: b,
          busy: _busy,
          onCash: () => _recordCash(b),
          onNotPaid: () => _reportNotPaid(b),
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

  /// The one thing to do next, decided by status alone.
  Future<void> _primaryAction(Booking b) async {
    switch (b.status) {
      case BookingStatus.accepted:
        await _run(() async {
          final updated =
              await ref.read(partnerRepositoryProvider).enRoute(b.id);
          ref.read(jobProvider(widget.bookingId).notifier).apply(updated);
        });

      case BookingStatus.enRoute:
      case BookingStatus.arrived:
        await _startJob(b);

      case BookingStatus.inProgress:
        // Finishing needs a settled price, so send one first if there is
        // none — the API checks the price before the code and would refuse
        // a perfectly correct OTP.
        if (b.approvedQuotation == null && b.pendingQuotation == null) {
          await _sendQuote(b);
        } else if (b.pendingQuotation != null) {
          _say('${b.counterpart.displayName} has not approved the price yet.');
        } else {
          await _completeJob(b);
        }

      default:
        break;
    }
  }

  Future<void> _startJob(Booking b) async {
    final otp = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (_) => OtpEntrySheet(
        title: 'Ask for the start code',
        blurb:
            '${b.counterpart.displayName} has a 4-digit code on their phone.',
        confirmLabel: 'Start work',
      ),
    );
    if (otp == null) return;

    await _run(() async {
      try {
        final updated =
            await ref.read(partnerRepositoryProvider).start(b.id, otp);
        ref.read(jobProvider(widget.bookingId).notifier).apply(updated);
        unawaited(HapticFeedback.mediumImpact());
      } on ApiError catch (e) {
        // The attempts remaining come back in `details`; surfacing them is
        // the difference between "wrong code" and "wrong code, and you have
        // two tries before this locks for a week".
        _say(e.message);
        rethrow;
      }
    });
  }

  Future<void> _completeJob(Booking b) async {
    final otp = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (_) => OtpEntrySheet(
        title: 'Ask for the end code',
        blurb: '${b.counterpart.displayName} gives this once they are happy '
            'the work is done.',
        confirmLabel: 'Finish job',
      ),
    );
    if (otp == null) return;

    await _run(() async {
      final updated =
          await ref.read(partnerRepositoryProvider).complete(b.id, otp);
      ref.read(jobProvider(widget.bookingId).notifier).apply(updated);
      ref.invalidate(walletProvider);
      unawaited(HapticFeedback.mediumImpact());
    });
  }

  Future<void> _sendQuote(Booking b) async {
    final sent = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => QuoteBuilder(booking: b),
    );
    if (sent ?? false) {
      await ref.read(jobProvider(widget.bookingId).notifier).refresh();
    }
  }

  Future<void> _withdraw(Booking b) async {
    final quote = b.pendingQuotation;
    if (quote == null) return;

    await _run(() async {
      await ref.read(partnerRepositoryProvider).withdrawQuotation(quote.id);
      await ref.read(jobProvider(widget.bookingId).notifier).refresh();
    });
  }

  /// Reports that the customer chose cash and never handed it over.
  ///
  /// Confirmed first, because it sends the customer a message contradicting
  /// them — a mistap here is an accusation, and the technician should mean it.
  Future<void> _reportNotPaid(Booking b) async {
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _NotPaidSheet(),
    );
    if (confirmed != true) return;

    await _run(() async {
      await ref.read(partnerRepositoryProvider).reportCashNotReceived(b.id);
      ref.invalidate(jobPaymentsProvider(b.id));
      await ref.read(jobProvider(widget.bookingId).notifier).refresh();
    });
  }

  Future<void> _recordCash(Booking b) async {
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _CashSheet(booking: b),
    );
    if (confirmed != true) return;

    await _run(() async {
      await ref.read(partnerRepositoryProvider).recordCash(b.id);
      ref.invalidate(jobPaymentsProvider(b.id));
      ref.invalidate(walletProvider);
      await ref.read(jobProvider(widget.bookingId).notifier).refresh();
    });
  }

  Future<void> _cancel(Booking b) async {
    final result = await showModalBottomSheet<({String reason, String? note})>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _CancelSheet(),
    );
    if (result == null) return;

    await _run(() async {
      final updated = await ref.read(partnerRepositoryProvider).cancel(
            b.id,
            reason: result.reason,
            note: result.note,
          );
      ref.read(jobProvider(widget.bookingId).notifier).apply(updated);
    });
  }

  void _say(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }
}

// ── Pieces ───────────────────────────────────────────────────────────────

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

class _CustomerCard extends StatelessWidget {
  const _CustomerCard({required this.booking});

  final Booking booking;

  @override
  Widget build(BuildContext context) {
    final c = booking.counterpart;

    return AppCard(
      child: Row(
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(15),
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [AppColors.graphite, AppColors.graphiteMid],
              ),
            ),
            alignment: Alignment.center,
            child: Text(
              _initials(c.displayName),
              style: AppType.cardTitle.copyWith(color: Colors.white),
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(c.displayName, style: AppType.cardTitle),
                const SizedBox(height: 2),
                Text(
                  // Masked until acceptance. After that both sides genuinely
                  // need to reach each other.
                  c.phone ?? 'Number appears once you accept',
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

  static String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty);
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts.first.substring(0, 1) + parts.last.substring(0, 1))
        .toUpperCase();
  }
}

class _AddressCard extends StatelessWidget {
  const _AddressCard({required this.address});

  final Object address;

  @override
  Widget build(BuildContext context) {
    final map =
        address is Map ? (address as Map).cast<String, dynamic>() : null;
    final text = map?['addressText'] as String? ?? '';
    final landmark = map?['landmark'] as String?;

    /// Coordinates, but only when the customer actually pinned them.
    ///
    /// An unpinned address's point comes from hashing the address text into
    /// somewhere inside Jabalpur. It looks exactly like a real fix and is not
    /// where anybody lives — so navigating to it takes a technician
    /// confidently to a stranger's street, which is worse than making them
    /// read the address. Unpinned means: search the text, and say so.
    final isPinned = map?['isPinned'] as bool? ?? false;
    final lat = isPinned ? (map?['lat'] as num?)?.toDouble() : null;
    final lng = isPinned ? (map?['lng'] as num?)?.toDouble() : null;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'WHERE',
            style: AppType.label.copyWith(color: AppColors.greyLight),
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(text, style: AppType.body),
          if (landmark != null && landmark.isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(
              // The landmark matters more than the street here — it is how
              // somebody is actually found.
              'near $landmark',
              style: AppType.meta.copyWith(color: AppColors.grey),
            ),
          ],
          if (!isPinned) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(
              'This address was not pinned on a map, so search results may be '
              'approximate. Call if you cannot find it.',
              style: AppType.caption.copyWith(color: AppColors.amberText),
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          AppButton(
            label: isPinned ? 'Open in Maps' : 'Search this address',
            kind: AppButtonKind.ghost,
            icon: Icons.map_outlined,
            onPressed: () => _openMaps(
              context,
              lat: lat,
              lng: lng,
              // `join` on a list holding a null writes the word "null" into
              // the query — which is what opened a maps search for "null".
              address: [text, landmark]
                  .whereType<String>()
                  .where((part) => part.isNotEmpty)
                  .join(', '),
            ),
          ),
        ],
      ),
    );
  }
}

class _PendingQuoteCard extends StatelessWidget {
  const _PendingQuoteCard({
    required this.booking,
    required this.busy,
    required this.onWithdraw,
  });

  final Booking booking;
  final bool busy;
  final VoidCallback onWithdraw;

  @override
  Widget build(BuildContext context) {
    final quote = booking.pendingQuotation!;

    return AppCard(
      color: AppColors.amberSoft,
      borderColor: AppColors.amberLine,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.hourglass_top_rounded,
                size: 16,
                color: AppColors.amber,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  'Waiting for ${booking.counterpart.displayName} to approve',
                  style: AppType.meta.copyWith(
                    color: AppColors.amber,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Text(
                Paise.show(quote.totalDisplay, quote.totalPaise),
                style: AppType.amount.copyWith(color: AppColors.amber),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            // The job cannot be finished until this is settled, which is the
            // reason the card exists rather than a status line.
            'You cannot finish the job until they say yes. You can withdraw '
            'this and send a different price.',
            style: AppType.caption.copyWith(color: AppColors.amber),
          ),
          const SizedBox(height: AppSpacing.md),
          AppButton(
            label: 'Withdraw and change it',
            kind: AppButtonKind.ghost,
            onPressed: busy ? null : onWithdraw,
          ),
        ],
      ),
    );
  }
}

class _ApprovedQuoteCard extends StatelessWidget {
  const _ApprovedQuoteCard({required this.booking});

  final Booking booking;

  @override
  Widget build(BuildContext context) {
    final quote = booking.approvedQuotation!;

    return AppCard(
      child: Column(
        children: [
          if (quote.agreedLabourPaise != null)
            _row('Agreed labour', Paise.format(quote.agreedLabourPaise!)),
          if (quote.hasExtraLabour)
            _row('Extra labour', Paise.format(quote.extraLabourPaise!)),
          for (final item in quote.items)
            _row(item.description, Paise.format(item.lineTotalPaise)),
          const Divider(height: AppSpacing.lg),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text('Approved', style: AppType.cardTitle),
              const Spacer(),
              Text(
                Paise.show(quote.totalDisplay, quote.totalPaise),
                style: AppType.amountLarge.copyWith(
                  fontSize: 22,
                  color: AppColors.green,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _row(String label, String amount) => Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
        child: Row(
          children: [
            Expanded(
              child: Text(
                label,
                style: AppType.meta.copyWith(color: AppColors.inkMuted),
              ),
            ),
            Text(amount, style: AppType.amount.copyWith(fontSize: 13)),
          ],
        ),
      );
}

/// Getting paid, from the technician's side.
///
/// **The technician never chooses the method.** They confirm cash, and only
/// once the customer has said that is how they are paying. Before this, both
/// sides had a payment button the moment a bill was frozen — so a customer
/// could pay by card while the technician marked the same job cash, and
/// nothing said which was true.
///
/// Everything here reads from `booking.settlement`, one state from the API,
/// rather than from a set of independent flags that can contradict each other.
class _PaymentCard extends StatelessWidget {
  const _PaymentCard({
    required this.booking,
    required this.busy,
    required this.onCash,
    required this.onNotPaid,
  });

  final Booking booking;
  final bool busy;
  final VoidCallback onCash;
  final VoidCallback onNotPaid;

  @override
  Widget build(BuildContext context) {
    final settlement = booking.settlement;
    final payable = booking.payable;

    if (settlement.isPaid) {
      return _Settled(wasCash: settlement.wasCash);
    }

    final amount = payable == null
        ? '—'
        : Paise.show(payable.payableDisplay, payable.payablePaise);

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text('To collect', style: AppType.cardTitle),
              const Spacer(),
              Text(amount, style: AppType.amountLarge.copyWith(fontSize: 22)),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),

          switch (settlement.state) {
            // The customer has the choice in front of them. Nothing for the
            // technician to do but wait — and saying so is better than an
            // inert button, which invites a tap that would be a guess.
            SettlementState.awaitingChoice => Text(
                'Waiting for ${booking.counterpart.displayName} to choose how '
                'to pay. Ask them to open the app.',
                style: AppType.caption.copyWith(color: AppColors.grey),
              ),

            SettlementState.onlinePending => Text(
                'They are paying online. Nothing for you to do — it will '
                'appear in your next payout.',
                style: AppType.caption.copyWith(color: AppColors.grey),
              ),

            // The one state where the technician acts.
            SettlementState.cashChosen => Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'They chose to pay cash. Confirm only once the money is '
                    'actually in your hand.',
                    style: AppType.caption.copyWith(color: AppColors.grey),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  AppButton(
                    label: 'I have the cash',
                    onPressed: busy ? null : onCash,
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  // The other half of letting the customer choose. Without it
                  // the only button says the money is in your hand, so
                  // somebody who chose cash and walked off left the technician
                  // choosing between lying and being stuck.
                  AppButton(
                    label: 'They have not paid me',
                    kind: AppButtonKind.ghost,
                    onPressed: busy ? null : onNotPaid,
                  ),
                ],
              ),

            _ => Text(
                'Nothing to collect on this job.',
                style: AppType.caption.copyWith(color: AppColors.grey),
              ),
          },
        ],
      ),
    );
  }
}

class _Settled extends StatelessWidget {
  const _Settled({required this.wasCash});

  final bool wasCash;

  @override
  Widget build(BuildContext context) {
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
              wasCash
                  ? 'Paid in cash. Our commission has been added to what you '
                      'owe us.'
                  : 'Paid online. It will appear in your next payout.',
              style: AppType.meta.copyWith(color: AppColors.ink),
            ),
          ),
        ],
      ),
    );
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
          if (booking.agreedLabour.amountPaise != null)
            _row(
              'Agreed rate',
              Paise.format(booking.agreedLabour.amountPaise!),
            ),
          // Only when there is one. It was drawn unconditionally, so a job
          // with no visit fee still showed a "Visit fee" line — and a fee the
          // customer is not being charged is worse than a missing row: the
          // technician quotes from this screen.
          if (booking.visitFeePaise > 0)
            _row('Visit fee', Paise.format(booking.visitFeePaise)),
        ],
      ),
    );
  }

  Widget _row(String label, String value) => Padding(
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

/// The single next action, and nothing else.
class _ActionBar extends StatelessWidget {
  const _ActionBar({
    required this.booking,
    required this.busy,
    required this.onAction,
    required this.onCancel,
  });

  final Booking booking;
  final bool busy;
  final VoidCallback onAction;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final status = booking.status;

    final label = switch (status) {
      BookingStatus.accepted => 'I am on my way',
      BookingStatus.enRoute || BookingStatus.arrived => 'I have arrived',
      BookingStatus.inProgress =>
        booking.approvedQuotation != null ? 'Finish the job' : 'Send the price',
      _ => null,
    };

    if (label == null) return const SizedBox.shrink();

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
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          AppButton(
            label: label,
            kind: AppButtonKind.accent,
            loading: busy,
            onPressed: onAction,
          ),
          // Disappears after arrival: at that point it is a dispute, not a
          // cancellation, and the API refuses it anyway.
          if (status.canProviderCancel) ...[
            const SizedBox(height: AppSpacing.sm),
            AppButton(
              label: 'Cancel this job',
              kind: AppButtonKind.quiet,
              onPressed: busy ? null : onCancel,
            ),
          ],
        ],
      ),
    );
  }
}

/// Recording cash, with what it actually costs them stated plainly.
class _CashSheet extends StatelessWidget {
  const _CashSheet({required this.booking});

  final Booking booking;

  @override
  Widget build(BuildContext context) {
    final payable = booking.payable;

    return Padding(
      // Same reason as every other sheet: a constant inset puts the button
      // under the gesture bar on a phone with no physical buttons.
      padding: EdgeInsets.fromLTRB(
        AppSpacing.xl,
        AppSpacing.sm,
        AppSpacing.xl,
        AppSpacing.sheetBottom(context),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Did they pay you in cash?', style: AppType.heading),
          const SizedBox(height: AppSpacing.sm),
          Text(
            payable == null
                ? 'Only confirm this if the money is in your hand.'
                : 'Only confirm this if ${Paise.show(payable.payableDisplay, payable.payablePaise)} '
                    'is in your hand.',
            style: AppType.body.copyWith(color: AppColors.grey),
          ),
          const SizedBox(height: AppSpacing.lg),
          Container(
            padding: const EdgeInsets.all(AppSpacing.md),
            decoration: BoxDecoration(
              color: AppColors.amberSoft,
              borderRadius: AppRadius.tileR,
              border: Border.all(color: AppColors.amberLine),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(
                  Icons.info_outline_rounded,
                  size: 16,
                  color: AppColors.amber,
                ),
                const SizedBox(width: AppSpacing.sm + 2),
                Expanded(
                  child: Text(
                    // The accounting asymmetry, said plainly. The gross went
                    // hand to hand, so only the commission moves through our
                    // books — which means recording cash *raises* their dues.
                    'The whole amount stays with you, so our commission gets '
                    'added to what you owe us. It comes out of your next '
                    'payout.',
                    style: AppType.meta.copyWith(color: AppColors.amber),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.xl),
          Row(
            children: [
              Expanded(
                child: AppButton(
                  label: 'Not yet',
                  kind: AppButtonKind.ghost,
                  onPressed: () => Navigator.pop(context, false),
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: AppButton(
                  label: 'Yes, cash',
                  onPressed: () => Navigator.pop(context, true),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Cancelling after accepting — different from declining, and it counts.
class _CancelSheet extends StatefulWidget {
  const _CancelSheet();

  @override
  State<_CancelSheet> createState() => _CancelSheetState();
}

class _CancelSheetState extends State<_CancelSheet> {
  final _note = TextEditingController();
  String? _reason;

  static const _reasons = <String, String>{
    'emergency': 'Something urgent came up',
    'vehicle_issue': 'Vehicle trouble',
    'wrong_skill': 'Not the work I do',
    'other': 'Another reason',
  };

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  bool get _valid =>
      _reason != null && (_reason != 'other' || _note.text.trim().isNotEmpty);

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
            Text('Cancel this job?', style: AppType.heading),
            const SizedBox(height: AppSpacing.sm),
            Text(
              // Honest about the consequence. Cancelling after accepting feeds
              // the reliability score and, repeated, triggers suspension —
              // finding that out later would feel like a trap.
              'The customer is expecting you. Cancelling after accepting '
              'affects your reliability score.',
              style: AppType.body.copyWith(color: AppColors.grey),
            ),
            const SizedBox(height: AppSpacing.lg),
            for (final entry in _reasons.entries)
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                child: AppCard(
                  onTap: () => setState(() => _reason = entry.key),
                  selected: _reason == entry.key,
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.lg,
                    vertical: AppSpacing.md + 2,
                  ),
                  child: Row(
                    children: [
                      Icon(
                        _reason == entry.key
                            ? Icons.radio_button_checked_rounded
                            : Icons.radio_button_unchecked_rounded,
                        size: 18,
                        color: _reason == entry.key
                            ? AppColors.graphite
                            : AppColors.greyLight,
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Text(entry.value, style: AppType.bodyMedium),
                    ],
                  ),
                ),
              ),
            if (_reason == 'other') ...[
              const SizedBox(height: AppSpacing.sm),
              TextField(
                controller: _note,
                autofocus: true,
                maxLength: 500,
                onChanged: (_) => setState(() {}),
                style: AppType.body,
                cursorColor: AppColors.graphite,
                decoration: InputDecoration(
                  hintText: 'Tell us briefly',
                  filled: true,
                  fillColor: AppColors.surface,
                  border: OutlineInputBorder(
                    borderRadius: AppRadius.fieldR,
                    borderSide: const BorderSide(color: AppColors.rule),
                  ),
                ),
              ),
            ],
            const SizedBox(height: AppSpacing.md),
            AppButton(
              label: 'Cancel the job',
              onPressed: _valid
                  ? () => Navigator.pop(
                        context,
                        (
                          reason: _reason!,
                          note: _note.text.trim().isEmpty
                              ? null
                              : _note.text.trim(),
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
        Shimmer(height: 74, radius: 20),
        SizedBox(height: AppSpacing.md),
        Shimmer(height: 120, radius: 20),
      ],
    );
  }
}

/// Opens the dialler. `tel:` fills the number in without placing the call.
Future<void> _call(BuildContext context, String phone) async {
  final uri = Uri(scheme: 'tel', path: phone.replaceAll(RegExp(r'[^\d+]'), ''));
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

/// Opens the customer's location in whatever maps app is installed.
///
/// Coordinates first. The booking snapshot holds the exact point the customer
/// picked, and a text search for "Surtalai, near the bus stop" lands a
/// technician somewhere in the right neighbourhood at best — which on a job
/// where they are being timed is not good enough.
///
/// The text is kept as the query on the pin so the maps app has something to
/// label it with, and as the whole fallback for a booking made before
/// coordinates were captured.
Future<void> _openMaps(
  BuildContext context, {
  required double? lat,
  required double? lng,
  required String address,
}) async {
  final label = Uri.encodeComponent(address.trim());
  final hasPoint = lat != null && lng != null;

  final uri = hasPoint
      // `geo:lat,lng?q=lat,lng(label)` drops a pin on the point itself. Giving
      // `q` the coordinates rather than the text matters: with text there, most
      // maps apps search for it and ignore the point entirely.
      ? Uri.parse('geo:$lat,$lng?q=$lat,$lng($label)')
      : Uri.parse('geo:0,0?q=$label');

  if (await canLaunchUrl(uri)) {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
    return;
  }

  // Nothing to copy but the text — coordinates in a clipboard help nobody.
  await Clipboard.setData(ClipboardData(text: address));
  if (context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('No maps app — address copied instead')),
    );
  }
}


/// Confirming that the money never arrived.
///
/// Says plainly what happens next, because the technician is usually standing
/// in front of the customer when they tap it and needs to be able to explain
/// it out loud.
class _NotPaidSheet extends StatelessWidget {
  const _NotPaidSheet();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.xl,
        AppSpacing.sm,
        AppSpacing.xl,
        AppSpacing.sheetBottom(context),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('They have not paid you?', style: AppType.heading),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'We will tell the customer the job is still unpaid and ask them to '
            'pay again — they can pay online instead. Nobody is charged and '
            'nothing is taken from you.',
            style: AppType.body.copyWith(color: AppColors.grey),
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            'Only do this if you really have not been paid.',
            style: AppType.meta.copyWith(color: AppColors.amberText),
          ),
          const SizedBox(height: AppSpacing.xl),
          AppButton(
            label: 'Yes, I have not been paid',
            onPressed: () => Navigator.pop(context, true),
          ),
          const SizedBox(height: AppSpacing.sm),
          AppButton(
            label: 'Cancel',
            kind: AppButtonKind.ghost,
            onPressed: () => Navigator.pop(context, false),
          ),
        ],
      ),
    );
  }
}
