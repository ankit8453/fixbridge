import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_error.dart';
import '../../core/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../data/models/booking.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/states.dart';
import '../auth/auth_controller.dart';
import '../jobs/widgets/job_row.dart';
import 'partner_providers.dart';
import 'widgets/earnings_header.dart';
import 'widgets/request_card.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  String? _busyId;

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    final jobs = ref.watch(jobsProvider);
    final requests = ref.watch(pendingRequestsProvider);
    final active = ref.watch(activeJobsProvider);
    final week = ref.watch(weekEarningsProvider);
    final wallet = ref.watch(walletProvider).valueOrNull;
    final readiness = ref.watch(readinessProvider);

    return Scaffold(
      backgroundColor: AppColors.ground,
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          color: AppColors.graphite,
          onRefresh: () async {
            ref.invalidate(walletProvider);
            ref.invalidate(partnerProfileProvider);
            await ref.read(jobsProvider.notifier).refresh();
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.screenX,
              AppSpacing.sm,
              AppSpacing.screenX,
              96,
            ),
            children: [
              Text(_greeting(),
                  style: AppType.meta.copyWith(
                    color: AppColors.greyLight,
                    fontWeight: FontWeight.w600,
                  )),
              const SizedBox(height: 3),
              Text(
                user?.name == null
                    ? 'Your work'
                    : 'Hello, ${user!.greetingName}',
                style: AppType.title,
              ),

              const SizedBox(height: AppSpacing.lg),
              EarningsHeader(
                weekPaise: week.paise,
                weekJobs: week.jobs,
                wallet: wallet,
                onTap: () => context.push('/wallet'),
              ),

              // Nothing matters more than this if they cannot be found yet.
              if (!readiness.ready) ...[
                const SizedBox(height: AppSpacing.md),
                _NotListedBanner(
                  listed: readiness.listed,
                  verified: readiness.verified,
                  onTap: () => context.push('/setup'),
                ),
              ],

              if (requests.isNotEmpty) ...[
                SectionHeader(
                  title: requests.length == 1
                      ? 'New request'
                      : '${requests.length} new requests',
                ),
                for (final request in requests)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppSpacing.md),
                    child: RequestCard(
                      booking: request,
                      busy: _busyId == request.id,
                      onAccept: () => _accept(request),
                      onDecline: () => _decline(request),
                    ),
                  ),
              ],

              if (active.isNotEmpty) ...[
                const SectionHeader(title: 'Happening now'),
                for (final job in active)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppSpacing.md),
                    child: JobRow(
                      booking: job,
                      onTap: () => context.push('/job/${job.id}'),
                    ),
                  ),
              ],

              if (requests.isEmpty && active.isEmpty)
                jobs.when(
                  loading: () => const Padding(
                    padding: EdgeInsets.only(top: AppSpacing.xl),
                    child: Column(
                      children: [
                        Shimmer(height: 96, radius: 20),
                        SizedBox(height: AppSpacing.md),
                        Shimmer(height: 96, radius: 20),
                      ],
                    ),
                  ),
                  error: (e, _) => ErrorState(
                    error: e,
                    onRetry: () => ref.read(jobsProvider.notifier).refresh(),
                  ),
                  data: (_) => Padding(
                    padding: const EdgeInsets.only(top: AppSpacing.xxl),
                    child: EmptyState(
                      icon: Icons.work_outline_rounded,
                      title:
                          readiness.ready ? 'No jobs right now' : 'No jobs yet',
                      message: readiness.ready
                          ? 'When a customer books you, it will appear here. '
                              'Keep the app open — you have an hour to answer.'
                          : 'Finish setting up and customers will be able to '
                              'find you.',
                      actionLabel: readiness.ready ? null : 'Finish setup',
                      onAction: () => context.push('/setup'),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  static String _greeting() {
    final h = DateTime.now().hour;
    if (h < 12) return 'GOOD MORNING';
    if (h < 17) return 'GOOD AFTERNOON';
    return 'GOOD EVENING';
  }

  Future<void> _accept(Booking booking) async {
    setState(() => _busyId = booking.id);
    try {
      final updated =
          await ref.read(partnerRepositoryProvider).accept(booking.id);
      ref.read(jobsProvider.notifier).apply(updated);
      unawaited(HapticFeedback.mediumImpact());

      if (mounted) {
        // Straight into the job — the next thing they need is the address.
        unawaited(context.push('/job/${updated.id}'));
      }
    } on ApiError catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.message)),
        );
        await ref.read(jobsProvider.notifier).refresh();
      }
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _decline(Booking booking) async {
    final reason = await showModalBottomSheet<({String reason, String? note})>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _DeclineSheet(),
    );
    if (reason == null) return;

    setState(() => _busyId = booking.id);
    try {
      final updated = await ref.read(partnerRepositoryProvider).reject(
            booking.id,
            reason: reason.reason,
            note: reason.note,
          );
      ref.read(jobsProvider.notifier).apply(updated);
    } on ApiError catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.message)),
        );
      }
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }
}

/// The two gates, when either is unmet.
///
/// Says which one is outstanding rather than "incomplete", because a
/// technician who has filled in everything and is waiting on verification
/// needs to know that no amount of further editing will help.
class _NotListedBanner extends StatelessWidget {
  const _NotListedBanner({
    required this.listed,
    required this.verified,
    required this.onTap,
  });

  final bool listed;
  final bool verified;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final message = !listed && !verified
        ? 'Finish your profile and get verified so customers can find you.'
        : !listed
            ? 'Your profile is not finished yet, so you do not appear in search.'
            : 'Your profile is done. Verification is still being checked — '
                'you will appear in search as soon as it passes.';

    return AppCard(
      onTap: onTap,
      color: AppColors.amberSoft,
      borderColor: AppColors.amberLine,
      child: Row(
        children: [
          const Icon(
            Icons.info_outline_rounded,
            size: 18,
            color: AppColors.amber,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Text(
              message,
              style: AppType.meta.copyWith(color: AppColors.amber),
            ),
          ),
          const Icon(
            Icons.chevron_right_rounded,
            size: 18,
            color: AppColors.amber,
          ),
        ],
      ),
    );
  }
}

/// Why the job is being turned down.
///
/// The API requires a note when the reason is `other`, so the sheet enforces
/// that rather than letting the request fail.
class _DeclineSheet extends StatefulWidget {
  const _DeclineSheet();

  @override
  State<_DeclineSheet> createState() => _DeclineSheetState();
}

class _DeclineSheetState extends State<_DeclineSheet> {
  final _note = TextEditingController();
  String? _reason;

  static const _reasons = <String, String>{
    'too_far': 'Too far from me',
    'busy': 'I am busy then',
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
        bottom: MediaQuery.viewInsetsOf(context).bottom + AppSpacing.xl,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Why are you declining?', style: AppType.heading),
            const SizedBox(height: AppSpacing.xs),
            Text(
              // Honest rather than punitive: declining is allowed, and the
              // score effect belongs to cancelling after accepting.
              'Declining is fine. The customer can book someone else straight '
              'away.',
              style: AppType.meta.copyWith(color: AppColors.grey),
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
              label: 'Decline this job',
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
