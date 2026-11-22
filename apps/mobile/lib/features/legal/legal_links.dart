import 'package:url_launcher/url_launcher.dart';

import '../../core/config/env.dart';

/// The legal pages on the website. The app links to them rather than carrying
/// its own copy, so there is exactly one text of each and it is the one the
/// acceptance refers to.
enum LegalPage {
  terms('terms'),
  privacy('privacy'),
  refund('refund-policy'),
  deleteAccount('delete-account');

  const LegalPage(this.slug);

  final String slug;
}

/// Hindi is the site's default and lives at the root; English is under `/en`.
Uri legalPageUri(LegalPage page, String languageCode) {
  final prefix = languageCode == 'hi' ? '' : '/en';
  return Uri.parse('${Env.siteUrl}$prefix/${page.slug}');
}

/// Opens the page in the phone's browser, outside the app.
///
/// Returns false when nothing could open it rather than throwing — a missing
/// browser must not take the terms screen down with it.
Future<bool> openLegalPage(LegalPage page, String languageCode) async {
  try {
    return await launchUrl(
      legalPageUri(page, languageCode),
      mode: LaunchMode.externalApplication,
    );
  } catch (_) {
    return false;
  }
}
