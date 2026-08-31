import 'dart:io';

import 'package:dio/dio.dart';

import '../../core/api/api_client.dart';
import '../../core/api/api_error.dart';
import '../models/verification.dart';

/// Getting verified: uploading documents and submitting the three levels.
class VerificationRepository {
  VerificationRepository(this._api);

  final ApiClient _api;

  /// Asks for a signed URL to PUT a file to.
  ///
  /// [sizeBytes] is declared up front because it is signed into the URL —
  /// storage rejects a body of a different length, so it cannot be a guess.
  Future<UploadTarget> requestUpload({
    required String docType,
    required String contentType,
    required int sizeBytes,
  }) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/verification/documents/upload-url',
      body: {
        'docType': docType,
        'contentType': contentType,
        'sizeBytes': sizeBytes,
      },
    );
    return UploadTarget.fromJson(json);
  }

  /// PUTs the bytes straight to storage.
  ///
  /// Deliberately a bare Dio rather than the app's client: this does not go to
  /// our API, must not carry our Authorization header, and the signed headers
  /// have to arrive exactly as issued.
  Future<void> putFile(UploadTarget target, File file) async {
    final bytes = await file.readAsBytes();
    try {
      await Dio().put<void>(
        target.url,
        data: Stream.fromIterable([bytes]),
        options: Options(
          headers: {
            ...target.headers,
            Headers.contentLengthHeader: bytes.length,
          },
        ),
      );
    } on DioException catch (e) {
      throw ApiError.fromDio(
        e,
        fallbackMessage: 'Could not upload that file. Try again.',
      );
    }
  }

  /// Tells the API the object is really there. Until this runs the document
  /// stays `pending` and cannot be attached to a level.
  Future<VerificationDocument> confirm(String documentId) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/verification/documents/$documentId/confirm',
    );
    return VerificationDocument.fromJson(
        (json['document'] as Map).cast<String, dynamic>());
  }

  Future<List<VerificationDocument>> documents() async {
    final json =
        await _api.get<Map<String, dynamic>>('/verification/documents');
    return (json['documents'] as List)
        .map((d) =>
            VerificationDocument.fromJson((d as Map).cast<String, dynamic>()))
        .toList();
  }

  Future<VerificationSummary> summary() async {
    final json = await _api.get<Map<String, dynamic>>('/verification/cases');
    return VerificationSummary.fromJson(json);
  }

  /// Level 0 — identity.
  ///
  /// **Only the last four digits of the ID number are ever sent.** The API
  /// scans every string for a run of 8+ digits and refuses the whole
  /// submission if it finds one: a full Aadhaar number must not exist in our
  /// systems at all, so it cannot be logged, error-reported or backed up.
  Future<void> submitIdentity({
    required String idType,
    required String idLast4,
    required String idProofDocumentId,
    required String selfieDocumentId,
  }) async {
    await _api.post<Map<String, dynamic>>(
      '/verification/levels/0/submit',
      body: {
        'idType': idType,
        'idLast4': idLast4,
        'idProofDocumentId': idProofDocumentId,
        'selfieDocumentId': selfieDocumentId,
      },
    );
  }

  /// Level 1 — background. Consent and nothing else; it must be literal true.
  Future<void> submitBackground() async {
    await _api.post<Map<String, dynamic>>(
      '/verification/levels/1/submit',
      body: {'consent': true},
    );
  }

  /// Level 2 — skill.
  ///
  /// At least one of a certificate, a trade test or a field audit. Asking for
  /// a test or an audit requires a note, because a human has to arrange it.
  Future<void> submitSkill({
    String? certificateDocumentId,
    bool tradeTest = false,
    bool fieldAudit = false,
    String? notes,
  }) async {
    await _api.post<Map<String, dynamic>>(
      '/verification/levels/2/submit',
      body: {
        if (certificateDocumentId != null)
          'certificateDocumentId': certificateDocumentId,
        if (tradeTest) 'tradeTest': true,
        if (fieldAudit) 'fieldAudit': true,
        if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
      },
    );
  }

  /// Answers an ops request for more. Puts the case straight back in review.
  Future<void> provideInfo(
    String caseId, {
    required String notes,
    List<String> documentIds = const [],
  }) async {
    await _api.post<Map<String, dynamic>>(
      '/verification/cases/$caseId/info',
      body: {
        'notes': notes.trim(),
        if (documentIds.isNotEmpty) 'documentIds': documentIds,
      },
    );
  }
}
