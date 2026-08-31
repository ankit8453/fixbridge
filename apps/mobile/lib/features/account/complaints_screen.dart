import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../data/models/support.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/states.dart';
import '../auth/auth_controller.dart';
import '../bookings/booking_status_ui.dart';

final _complaintsProvider = FutureProvider<List<Complaint>>((ref) async {
  if (!ref.watch(authControllerProvider).isSignedIn) return const [];
  return ref.watch(bookingRepositoryProvider).complaints();
});

/// Complaints raised, and their outcome.
///
/// Read-only: raising one happens on the booking it is about, because a
/// complaint detached from a job is one nobody can act on.
class ComplaintsScreen extends ConsumerWidget {
  const ComplaintsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final complaints = ref.watch(_complaintsProvider);

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
        title: const Text('Complaints'),
      ),
      body: SafeArea(
        child: complaints.when(
          loading: () => ListView(
            padding: const EdgeInsets.all(AppSpacing.screenX),
            children: const [
              Shimmer(height: 96, radius: 20),
              SizedBox(height: AppSpacing.md),
              Shimmer(height: 96, radius: 20),
            ],
          ),
          error: (e, _) => ErrorState(
            error: e,
            onRetry: () => ref.invalidate(_complaintsProvider),
          ),
          data: (list) => list.isEmpty
              ? const EmptyState(
                  icon: Icons.support_agent_rounded,
                  title: 'Nothing reported',
                  message:
                      'If something goes wrong on a job, you can report it '
                      'from that booking and it will show up here.',
                )
              : RefreshIndicator(
                  color: AppColors.blue,
                  onRefresh: () async {
                    ref.invalidate(_complaintsProvider);
                    await ref.read(_complaintsProvider.future);
                  },
                  child: ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.screenX),
                    itemCount: list.length,
                    separatorBuilder: (_, __) =>
                        const SizedBox(height: AppSpacing.md),
                    itemBuilder: (_, i) => _ComplaintCard(
                      complaint: list[i],
                      onOpenBooking: () =>
                          context.push('/booking/${list[i].bookingId}'),
                    ),
                  ),
                ),
        ),
      ),
    );
  }
}

class _ComplaintCard extends StatelessWidget {
  const _ComplaintCard({
    required this.complaint,
    required this.onOpenBooking,
  });

  final Complaint complaint;
  final VoidCallback onOpenBooking;

  ({String label, Color tone, Color soft}) get _status =>
      switch (complaint.status) {
        'open' => (
            label: 'Open',
            tone: AppColors.amberText,
            soft: AppColors.amberSoft,
          ),
        'in_review' => (
            label: 'Being looked at',
            tone: AppColors.blue,
            soft: AppColors.blueSoft,
          ),
        'resolved' => (
            label: 'Resolved',
            tone: AppColors.green,
            soft: AppColors.greenSoft,
          ),
        _ => (
            label: 'Closed',
            tone: AppColors.grey,
            soft: AppColors.mist,
          ),
      };

  @override
  Widget build(BuildContext context) {
    final status = _status;

    return AppCard(
      onTap: onOpenBooking,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  ComplaintCategories.all[complaint.category] ??
                      complaint.category,
                  style: AppType.cardTitle,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.sm + 2,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: status.soft,
                  borderRadius: AppRadius.chipR,
                ),
                child: Text(
                  status.label,
                  style: AppType.meta.copyWith(
                    color: status.tone,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            complaint.description,
            style: AppType.meta.copyWith(color: AppColors.inkMuted),
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
          ),

          // What ops decided, once they have. Shown verbatim — a complaint
          // resolved without the person hearing why is not resolved.
          if (complaint.resolutionNote != null) ...[
            const SizedBox(height: AppSpacing.md),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.mist,
                borderRadius: AppRadius.tileR,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'WHAT WE DID',
                    style: AppType.label.copyWith(
                      color: AppColors.greyLight,
                      fontSize: 8.5,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    complaint.resolutionNote!,
                    style: AppType.meta.copyWith(color: AppColors.inkMuted),
                  ),
                ],
              ),
            ),
          ],

          const SizedBox(height: AppSpacing.sm),
          Text(
            formatWhen(complaint.createdAt),
            style: AppType.caption.copyWith(color: AppColors.greyLight),
          ),
        ],
      ),
    );
  }
}
