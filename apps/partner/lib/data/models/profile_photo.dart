/// The picture a customer sees.
///
/// **Not the verification photo.** The KYC portrait is a document with
/// `docType: 'photo'` that ops review and no customer ever sees; this is the
/// display picture shown to a customer once they have accepted a booking, so
/// they can match a face to the person at their door. Uploading one does not
/// satisfy the other, and the two are different endpoints entirely.
class ProfilePhoto {
  const ProfilePhoto({
    required this.status,
    required this.url,
    required this.uploadedAt,
    required this.rejectionNote,
  });

  /// `approved` or `removed`. There is no pending state — a photo is usable
  /// the moment it is confirmed, and only taken down if it is reported.
  final String status;

  /// A signed URL, and therefore **short-lived**. Fetch it when it is about
  /// to be shown rather than caching it anywhere.
  final String url;

  final DateTime? uploadedAt;

  /// Why it was taken down, when it was.
  final String? rejectionNote;

  bool get isVisible => status == 'approved';
  bool get wasRemoved => status == 'removed';

  /// Null in, null out — no photo is the normal state for somebody who has
  /// not set one, not a parse failure.
  static ProfilePhoto? fromJson(Map<String, dynamic>? json) {
    if (json == null) return null;

    final url = json['url'] as String?;
    if (url == null || url.isEmpty) return null;

    return ProfilePhoto(
      status: json['status'] as String? ?? 'approved',
      url: url,
      uploadedAt:
          DateTime.tryParse(json['uploadedAt'] as String? ?? '')?.toLocal(),
      rejectionNote: json['rejectionNote'] as String?,
    );
  }
}
