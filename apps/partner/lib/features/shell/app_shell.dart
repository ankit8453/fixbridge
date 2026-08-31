import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../home/partner_providers.dart';

/// The four-tab shell.
///
/// A `bottomNavigationBar` rather than a Stack layer, so bottom sheets and the
/// keyboard sit above it — the customer app had that bug and it hid a Save
/// button.
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // A waiting request is the one thing worth a badge — money expiring.
    final waiting = ref.watch(pendingRequestsProvider).length;

    return Scaffold(
      backgroundColor: AppColors.ground,
      extendBody: true,
      body: navigationShell,
      bottomNavigationBar: SafeArea(
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
            waiting: waiting,
            onTap: (i) => navigationShell.goBranch(
              i,
              initialLocation: i == navigationShell.currentIndex,
            ),
          ),
        ),
      ),
    );
  }
}

class _FloatingNav extends StatelessWidget {
  const _FloatingNav({
    required this.index,
    required this.waiting,
    required this.onTap,
  });

  final int index;
  final int waiting;
  final ValueChanged<int> onTap;

  static const _items = [
    (icon: Icons.home_rounded, label: 'Today'),
    (icon: Icons.work_rounded, label: 'Jobs'),
    (icon: Icons.account_balance_wallet_rounded, label: 'Money'),
    (icon: Icons.person_rounded, label: 'You'),
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
                width: AppSizes.minTouch,
                height: AppSizes.minTouch,
                child: Center(
                  child: AnimatedContainer(
                    duration: AppMotion.quick,
                    curve: AppMotion.enter,
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: active ? AppColors.graphite : Colors.transparent,
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
                        // Green, not red: a waiting request is money, not a
                        // problem.
                        if (i == 0 && waiting > 0)
                          Positioned(
                            top: 7,
                            right: 7,
                            child: Container(
                              width: 9,
                              height: 9,
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
