import '../../core/api/api_client.dart';
import '../models/legal.dart';

/// The partner agreement: whether it has been accepted, and accepting it.
///
/// The server records each acceptance with the version, time, IP and device,
/// as evidence. The app's job is only to show the version it is asking about
/// and to send that same version back.
class LegalRepository {
  LegalRepository(this._api);

  final ApiClient _api;

  Future<LegalStatus> status() async {
    final json = await _api.get<Object?>('/legal/me');
    return LegalStatus.fromJson(json);
  }

  /// Accepts [version] of the partner agreement — the version that was on
  /// screen, never "whatever is current". If it has moved on since, the API
  /// answers 409 `LEGAL_VERSION_OUTDATED` and the person has to read again.
  Future<LegalStatus> acceptPartnerTerms(String version) async {
    final json = await _api.post<Object?>(
      '/legal/accept',
      body: {'document': 'partner_terms', 'version': version},
    );
    return LegalStatus.fromJson(json);
  }
}
