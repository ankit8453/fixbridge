import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../home/home_providers.dart';

/// The four-tab shell.
///
/// The nav floats over the content rather than sitting in a bar below it —
/// which is why every scrolling tab leaves ~96px of bottom padding. A docked
/// bar would eat a sixth of a small phone's screen permanently.
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unread = ref.watch(unreadCountProvider).valueOrNull ?? 0;

    return Scaffold(
      backgroundColor: AppColors.ground,
      body: Stack(
        children: [
          navigationShell,
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.xxl,
                  0,
                  AppSpacing.xxl,
                  AppSpacing.md,
                ),
                child: _FloatingNav(
                  index: navigationShell.currentIndex,
                  unread: unread,
                  onTap: (i) => navigationShell.goBranch(
                    i,
                    // Tapping the tab you are already on returns to its root,
                    // which is the behaviour people expect from every other
                    // app on the phone.
                    initialLocation: i == navigationShell.currentIndex,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _FloatingNav extends StatelessWidget {
  const _FloatingNav({
    required this.index,
    required this.unread,
    required this.onTap,
  });

  final int index;
  final int unread;
  final ValueChanged<int> onTap;

  static const _items = [
    (icon: Icons.home_rounded, label: 'Home'),
    (icon: Icons.receipt_long_rounded, label: 'Bookings'),
    (icon: Icons.notifications_rounded, label: 'Alerts'),
    (icon: Icons.person_rounded, label: 'Account'),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm + 2,
        vertical: AppSpacing.sm + 1,
      ),
      decoration: BoxDecoration(
        color: AppColors.ink,
        borderRadius: BorderRadius.circular(AppRadius.chip),
        boxShadow: AppColors.raisedShadow,
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: List.generate(_items.length, (i) {
          final item = _items[i];
          final active = i == index;

          return Semantics(
            label: item.label,
            selected: active,
            button: true,
            child: InkWell(
              onTap: () => onTap(i),
              customBorder: const CircleBorder(),
              child: SizedBox(
                // The painted circle is 40px; the tap target stays at the
                // 48dp floor so it is comfortable one-handed.
                width: AppSizes.minTouch,
                height: AppSizes.minTouch,
                child: Center(
                  child: AnimatedContainer(
                    duration: AppMotion.quick,
                    curve: AppMotion.enter,
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: active ? AppColors.blue : Colors.transparent,
                      shape: BoxShape.circle,
                    ),
                    child: Stack(
                      clipBehavior: Clip.none,
                      alignment: Alignment.center,
                      children: [
                        Icon(
                          item.icon,
                          size: 19,
                          color:
                              active ? Colors.white : const Color(0xFF8A8F9C),
                        ),
                        if (i == 2 && unread > 0)
                          Positioned(
                            top: 7,
                            right: 8,
                            child: Container(
                              width: 8,
                              height: 8,
                              decoration: BoxDecoration(
                                color: AppColors.green,
                                shape: BoxShape.circle,
                                border: Border.all(
                                  color: AppColors.ink,
                                  width: 1.5,
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          );
        }),
      ),
    );
  }
}
