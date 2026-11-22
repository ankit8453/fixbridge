import '../../core/api/api_client.dart';
import '../models/legal.dart';

/// The terms a signed-in customer has accepted, and accepting them.
///
/// Both calls need the session — the acceptance is recorded against the
/// account, with the version, time, IP and device as evidence.
class LegalRepository {
  LegalRepository(this._api);

  final ApiClient _api;

  /// The document this app asks for. The API also knows `partner_terms`,
  /// which belongs to the partner app.
  static const customerTermsDocument = 'customer_terms';

  /// Answered when the version sent is no longer the current one — the
  /// terms changed while the screen was open.
  static const versionOutdatedCode = 'LEGAL_VERSION_OUTDATED';

  Future<LegalStatus> status() async {
    final json = await _api.get<Object?>('/legal/me');
    return LegalStatus.fromJson(json);
  }

  /// Records acceptance of exactly the [version] that was on screen. Throws
  /// `ApiError` with [versionOutdatedCode] if that is no longer current.
  Future<LegalStatus> acceptCustomerTerms(String version) async {
    final json = await _api.post<Object?>(
      '/legal/accept',
      body: {'document': customerTermsDocument, 'version': version},
    );
    return LegalStatus.fromJson(json);
  }
}
