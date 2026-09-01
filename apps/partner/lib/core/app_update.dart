import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

import 'providers.dart';

/// What the server says about this build.
class ReleaseStatus {
  const ReleaseStatus({
    required this.latestVersion,
    required this.downloadUrl,
    required this.updateAvailable,
    required this.updateRequired,
  });

  final String latestVersion;
  final String downloadUrl;

  /// A newer build exists. Worth offering, safe to dismiss.
  final bool updateAvailable;

  /// This build is below the minimum the API still supports. **Not
  /// dismissible** — it is the only lever that can retire a build already on
  /// somebody's phone, and it exists for the case where an old client would
  /// misread a response badly enough to matter.
  final bool updateRequired;

  static ReleaseStatus? fromJson(Map<String, dynamic> json) {
    final url = json['downloadUrl'] as String?;
    if (url == null || url.isEmpty) return null;

    return ReleaseStatus(
      latestVersion: json['latestVersion'] as String? ?? '',
      downloadUrl: url,
      updateAvailable: json['updateAvailable'] as bool? ?? false,
      updateRequired: json['updateRequired'] as bool? ?? false,
    );
  }
}

/// Asks the API whether this build is still current.
///
/// The app is sideloaded from our own site rather than a store, so nothing
/// tells anyone an update exists — this is that mechanism, and without it a
/// phone keeps running whatever it was given for as long as it is installed.
///
/// **Never throws.** A failed check must not block the app: no network on a
/// launch is the normal case in Jabalpur, not an error worth a screen.
final releaseStatusProvider = FutureProvider<ReleaseStatus?>((ref) async {
  try {
    final info = await PackageInfo.fromPlatform();
    final json = await ref.read(apiClientProvider).get<Map<String, dynamic>>(
          '/releases/partner',
          query: {'version': info.version},
          auth: false,
        );
    return ReleaseStatus.fromJson(json);
  } catch (_) {
    return null;
  }
});
