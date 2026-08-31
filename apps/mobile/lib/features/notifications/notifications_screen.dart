import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../data/models/notification.dart';
import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/states.dart';
import '../auth/auth_controller.dart';
import '../home/home_providers.dart';

final _inboxProvider = FutureProvider<NotificationPage>((ref) async {
  final auth = ref.watch(authControllerProvider);
  if (!auth.isSignedIn) {
    return const NotificationPage(
      notifications: [],
      page: 1,
      pageSize: 20,
      total: 0,
      unread: 0,
    );
  }
  return ref.watch(accountRepositoryProvider).notifications();
});

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final inbox = ref.watch(_inboxProvider);

    return Scaffold(
      backgroundColor: AppColors.ground,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.screenX,
                AppSpacing.sm,
                AppSpacing.screenX,
                AppSpacing.md,
              ),
              child: Row(
                children: [
                  Expanded(child: Text('Updates', style: AppType.title)),
                  if ((inbox.valueOrNull?.unread ?? 0) > 0)
                    TextButton(
                      onPressed: () async {
                        await ref
                            .read(accountRepositoryProvider)
                            .markAllRead();
                        ref.invalidate(_inboxProvider);
                        ref.invalidate(unreadCountProvider);
                      },
                      child: Text(
                        'Mark all read',
                        style: AppType.meta.copyWith(
                          color: AppColors.blue,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            Expanded(
              child: !auth.isSignedIn
                  ? const EmptyState(
                      icon: Icons.notifications_none_rounded,
                      title: 'Nothing to show',
                      message:
                          'Sign in to get updates about your bookings here.',
                    )
                  : inbox.when(
                      loading: () => const _InboxSkeleton(),
                      error: (e, _) => ErrorState(
                        error: e,
                        onRetry: () => ref.invalidate(_inboxProvider),
                      ),
                      data: (page) => page.notifications.isEmpty
                          ? const EmptyState(
                              icon: Icons.notifications_none_rounded,
                              title: 'No updates yet',
                              message:
                                  'When a technician accepts, sets off or '
                                  'sends you a price, you will hear about it '
                                  'here and on WhatsApp.',
                            )
                          : RefreshIndicator(
                              color: AppColors.blue,
                              onRefresh: () async {
                                ref.invalidate(_inboxProvider);
                                await ref.read(_inboxProvider.future);
                              },
                              child: ListView.separated(
                                padding: const EdgeInsets.fromLTRB(
                                  AppSpacing.screenX,
                                  0,
                                  AppSpacing.screenX,
                                  96,
                                ),
                                itemCount: page.notifications.length,
                                separatorBuilder: (_, __) =>
                                    const SizedBox(height: AppSpacing.sm + 2),
                                itemBuilder: (_, i) => _NotificationRow(
                                  item: page.notifications[i],
                                  onTap: () => _open(
                                    context,
                                    ref,
                                    page.notifications[i],
                                  ),
                                ),
                              ),
                            ),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _open(
    BuildContext context,
    WidgetRef ref,
    AppNotification item,
  ) async {
    if (!item.read) {
      await ref.read(accountRepositoryProvider).markRead(item.id);
      ref.invalidate(_inboxProvider);
      ref.invalidate(unreadCountProvider);
    }

    // `deepLink` arrives already resolved — "booking/9f3c…" — so it is routed
    // rather than parsed. The leading slash is ours to add.
    final link = item.deepLink;
    if (link != null && link.isNotEmpty && context.mounted) {
      context.push(link.startsWith('/') ? link : '/$link');
    }
  }
}

class _NotificationRow extends StatelessWidget {
  const _NotificationRow({required this.item, required this.onTap});

  final AppNotification item;
  final VoidCallback onTap;

  IconData get _icon => switch (item.group) {
        'booking' => Icons.event_available_rounded,
        'quotation' => Icons.receipt_long_rounded,
        'payment' => Icons.payments_rounded,
        'verification' => Icons.verified_user_rounded,
        _ => Icons.notifications_rounded,
      };

  @override
  Widget build(BuildContext context) {
    // Unread is carried by a tinted surface and a dot, not by bold text —
    // bold body copy at this size is harder to read, which is the opposite
    // of what an unread marker is for.
    final unread = !item.read;

    return AppCard(
      onTap: onTap,
      color: unread ? AppColors.blueSoft : AppColors.surface,
      borderColor: unread ? AppColors.blueSoft : AppColors.rule,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: item.isCritical ? AppColors.amberSoft : AppColors.surface,
              borderRadius: BorderRadius.circular(11),
              border: Border.all(color: AppColors.rule),
            ),
            child: Icon(
              _icon,
              size: 17,
              color: item.isCritical ? AppColors.amberText : AppColors.blue,
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        item.title,
                        style: AppType.cardTitle.copyWith(fontSize: 13.5),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (unread)
                      Container(
                        width: 7,
                        height: 7,
                        margin: const EdgeInsets.only(left: AppSpacing.sm),
                        decoration: const BoxDecoration(
                          color: AppColors.blue,
                          shape: BoxShape.circle,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 3),
                Text(
                  item.body,
                  style: AppType.meta.copyWith(color: AppColors.inkMuted),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 5),
                Text(
                  _ago(item.createdAt),
                  style: AppType.caption.copyWith(color: AppColors.greyLight),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static String _ago(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inMinutes < 1) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes} min ago';
    if (diff.inHours < 24) return '${diff.inHours} hr ago';
    if (diff.inDays == 1) return 'Yesterday';
    return '${diff.inDays} days ago';
  }
}

class _InboxSkeleton extends StatelessWidget {
  const _InboxSkeleton();

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screenX,
        0,
        AppSpacing.screenX,
        96,
      ),
      itemCount: 4,
      separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm + 2),
      itemBuilder: (_, __) => AppCard(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Shimmer(width: 36, height: 36, radius: 11),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: const [
                  Shimmer(width: 140, height: 10),
                  SizedBox(height: AppSpacing.sm),
                  Shimmer(height: 9),
                  SizedBox(height: 6),
                  Shimmer(width: 60, height: 8),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
