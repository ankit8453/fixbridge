import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_typography.dart';
import '../../data/models/provider.dart';

/// A technician's face, or their initials when there is no photo.
///
/// The photo only exists once a booking is accepted — before that the API
/// does not hand it over — so initials are the normal case while browsing,
/// not a failure. They are drawn on a stable colour derived from the id, so
/// the same person looks the same on every screen and in every session.
class Avatar extends StatelessWidget {
  const Avatar({
    super.key,
    required this.name,
    this.photoUrl,
    this.size = 46,
    this.badge,
    this.radius,
  });

  final String name;
  final String? photoUrl;
  final double size;

  /// Draws the small verified tick over the corner.
  final TrustBadge? badge;

  /// Square-ish by default; pass a large value for a circle.
  final double? radius;

  static const _palette = [
    [Color(0xFF2563EB), Color(0xFF38BDF8)],
    [Color(0xFF0891B2), Color(0xFF22D3EE)],
    [Color(0xFF7C5CFA), Color(0xFFA78BFA)],
    [Color(0xFF12B76A), Color(0xFF4ADE80)],
    [Color(0xFF475467), Color(0xFF98A2B3)],
  ];

  String get _initials {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty);
    if (parts.isEmpty) return '?';
    if (parts.length == 1) {
      return parts.first.substring(0, 1).toUpperCase();
    }
    return (parts.first.substring(0, 1) + parts.last.substring(0, 1))
        .toUpperCase();
  }

  List<Color> get _colors {
    // Stable from the name, so a person's tile does not change colour
    // between the search results and their profile.
    final hash = name.codeUnits.fold<int>(0, (a, b) => a + b);
    return _palette[hash % _palette.length];
  }

  @override
  Widget build(BuildContext context) {
    final r = radius ?? size * 0.32;

    final face = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(r),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: _colors,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      alignment: Alignment.center,
      child: photoUrl == null
          ? Text(
              _initials,
              style: AppType.cardTitle.copyWith(
                color: Colors.white,
                fontSize: size * 0.34,
                fontWeight: FontWeight.w800,
              ),
            )
          : Image.network(
              photoUrl!,
              width: size,
              height: size,
              fit: BoxFit.cover,
              // A signed URL that has expired, or a dead connection, must not
              // leave a broken-image glyph on a trust screen.
              errorBuilder: (_, __, ___) => Text(
                _initials,
                style: AppType.cardTitle.copyWith(
                  color: Colors.white,
                  fontSize: size * 0.34,
                  fontWeight: FontWeight.w800,
                ),
              ),
              loadingBuilder: (context, child, progress) {
                if (progress == null) return child;
                return const SizedBox.shrink();
              },
            ),
    );

    if (badge == null || !badge!.isEarned) return face;

    final tickSize = size * 0.30;
    return SizedBox(
      width: size + 4,
      height: size + 4,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          face,
          Positioned(
            right: 0,
            bottom: 0,
            child: Container(
              width: tickSize,
              height: tickSize,
              decoration: BoxDecoration(
                color: badge == TrustBadge.gold ? AppColors.amberText : AppColors.green,
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.ground, width: 2.2),
              ),
              child: Icon(
                Icons.check_rounded,
                size: tickSize * 0.58,
                color: Colors.white,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The badge as a word, for a row where a tick is not enough.
class BadgeChip extends StatelessWidget {
  const BadgeChip({super.key, required this.badge});

  final TrustBadge badge;

  @override
  Widget build(BuildContext context) {
    if (!badge.isEarned) {
      // Not a failure state — somebody new has simply not been rated yet,
      // and saying so plainly is more honest than an empty space.
      return _pill('NEW', AppColors.blue, AppColors.blueSoft);
    }

    return switch (badge) {
      TrustBadge.gold => _pill('GOLD', AppColors.amberText, AppColors.amberSoft),
      TrustBadge.silver => _pill('SILVER', AppColors.inkMuted, AppColors.mist),
      _ => _pill('VERIFIED', AppColors.green, AppColors.greenSoft),
    };
  }

  Widget _pill(String text, Color fg, Color bg) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        text,
        style: AppType.label.copyWith(color: fg, fontSize: 8),
      ),
    );
  }
}

/// The green rating chip — the pattern every Indian user already reads
/// fluently from a dozen other apps.
class RatingChip extends StatelessWidget {
  const RatingChip({super.key, required this.rating});

  /// Null until somebody has actually rated this person. The API never
  /// invents a default, and neither does this: it renders "New" instead.
  final Rating? rating;

  @override
  Widget build(BuildContext context) {
    if (rating == null || rating!.count == 0) {
      return Text(
        'New',
        style: AppType.meta.copyWith(
          color: AppColors.grey,
          fontWeight: FontWeight.w600,
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2.5),
      decoration: BoxDecoration(
        color: AppColors.green,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            rating!.average.toStringAsFixed(1),
            style: AppType.label.copyWith(color: Colors.white, fontSize: 9.5),
          ),
          const SizedBox(width: 2),
          const Icon(Icons.star_rounded, size: 10, color: Colors.white),
        ],
      ),
    );
  }
}
