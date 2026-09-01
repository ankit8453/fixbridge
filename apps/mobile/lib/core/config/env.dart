/// Build-time configuration.
///
/// Everything here is overridable with `--dart-define`, so a debug build
/// against a laptop and a release build against the real host are the same
/// source with different flags:
///
/// ```
/// flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3001/api/v1
/// ```
///
/// The default is the Android emulator's alias for the host machine
/// (`10.0.2.2`), not `localhost` — inside the emulator `localhost` is the
/// emulated device itself, which is the first thing that trips a new setup.
/// On a physical phone this must be the laptop's LAN address.
abstract final class Env {
  const Env._();

  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:3001/api/v1',
  );

  /// `/health` sits outside `/api/v1`, deliberately, so it is derived rather
  /// than assumed.
  static String get healthUrl {
    final root = apiBaseUrl.replaceFirst(RegExp(r'/api/v1/?$'), '');
    return '$root/health';
  }

  /// The brand name, settled as FixBridge. Still read from the environment so
  /// a white-label build needs no code change, and so the value lives in one
  /// place rather than scattered through the copy.
  static const appName = String.fromEnvironment(
    'APP_NAME',
    defaultValue: 'FixBridge',
  );

  static const connectTimeout = Duration(seconds: 10);
  static const receiveTimeout = Duration(seconds: 20);

  /// How often the booking detail is re-fetched while the customer is
  /// watching. Two rates, because REQUESTED is the anxious wait and the rest
  /// is a slow burn — see BookingPoller.
  static const pollWaiting = Duration(seconds: 10);
  static const pollActive = Duration(seconds: 20);

  /// After checkout returns, how often to ask whether the webhook has landed.
  static const pollPayment = Duration(seconds: 4);
  static const paymentConfirmTimeout = Duration(minutes: 2);
}
