import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api/api_error.dart';
import '../../core/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../data/models/verification.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/app_field.dart';
import '../home/partner_providers.dart';

/// Submitting one verification level.
///
/// Three different forms behind one screen, because to a technician this is
/// one errand with three parts, not three features.
class VerificationScreen extends ConsumerStatefulWidget {
  const VerificationScreen({super.key, required this.level, this.caseId});

  final int level;

  /// Set when answering an ops request for more, rather than submitting the
  /// level for the first time. Replying puts the case straight back in review.
  final String? caseId;

  @override
  ConsumerState<VerificationScreen> createState() => _VerificationScreenState();
}

class _VerificationScreenState extends ConsumerState<VerificationScreen> {
  final _last4 = TextEditingController();
  final _notes = TextEditingController();

  String _idType = 'aadhaar';
  String? _idDocId;
  String? _selfieDocId;
  String? _certDocId;
  bool _tradeTest = false;
  bool _consent = false;

  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _last4.dispose();
    _notes.dispose();
    super.dispose();
  }

  bool get _isReply => widget.caseId != null;

  bool get _canSubmit {
    // Answering a request for more only needs the answer itself.
    if (_isReply) return _notes.text.trim().isNotEmpty;

    return switch (widget.level) {
      0 => _last4.text.length == 4 && _idDocId != null && _selfieDocId != null,
      1 => _consent,
      // At least one of a certificate or a trade test; a test needs a note
      // because a person has to arrange it.
      2 => _certDocId != null || (_tradeTest && _notes.text.trim().isNotEmpty),
      _ => false,
    };
  }

  /// Uploads a photo and returns its document id.
  ///
  /// Three steps, because storage is written directly: ask the API for a
  /// signed URL, PUT the bytes to it, then tell the API the object landed.
  /// Until that last confirm the document stays `pending` and cannot be
  /// attached to a level.
  Future<String?> _pickAndUpload(String docType) async {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.camera,
      // Kept modest: these are read by a human, not archived, and a technician
      // on patchy 4G should not be uploading 8 megapixels of it.
      maxWidth: 1600,
      imageQuality: 80,
    );
    if (picked == null) return null;

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      final file = File(picked.path);
      final size = await file.length();
      final repo = ref.read(verificationRepositoryProvider);

      final target = await repo.requestUpload(
        docType: docType,
        contentType: 'image/jpeg',
        sizeBytes: size,
      );
      await repo.putFile(target, file);
      final document = await repo.confirm(target.documentId);

      return document.id;
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
      return null;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submit() async {
    if (!_canSubmit || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      final repo = ref.read(verificationRepositoryProvider);

      // Answering ops rather than submitting fresh: same screen, different
      // endpoint, and the case goes straight back into review.
      if (_isReply) {
        await repo.provideInfo(
          widget.caseId!,
          notes: _notes.text,
          documentIds: [
            if (_idDocId != null) _idDocId!,
            if (_selfieDocId != null) _selfieDocId!,
            if (_certDocId != null) _certDocId!,
          ],
        );
        ref.invalidate(verificationProvider);
        if (mounted) context.pop();
        return;
      }

      switch (widget.level) {
        case 0:
          await repo.submitIdentity(
            idType: _idType,
            idLast4: _last4.text,
            idProofDocumentId: _idDocId!,
            selfieDocumentId: _selfieDocId!,
          );
        case 1:
          await repo.submitBackground();
        case 2:
          await repo.submitSkill(
            certificateDocumentId: _certDocId,
            tradeTest: _tradeTest,
            notes: _notes.text,
          );
      }

      ref.invalidate(verificationProvider);
      ref.invalidate(partnerProfileProvider);
      if (mounted) context.pop();
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.ground,
      appBar: AppBar(
        leading: Padding(
          padding: const EdgeInsets.only(left: AppSpacing.md),
          child: AppIconButton(
            icon: Icons.arrow_back_rounded,
            onPressed: () => context.pop(),
          ),
        ),
        title: Text(VerificationLevels.titles[widget.level] ?? 'Verification'),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.screenX,
                  0,
                  AppSpacing.screenX,
                  AppSpacing.xl,
                ),
                children: [
                  Text(
                    _isReply
                        ? 'We need a bit more before we can finish checking '
                            'this. Add whatever was asked for.'
                        : VerificationLevels.blurbs[widget.level] ?? '',
                    style: AppType.body.copyWith(color: AppColors.grey),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  ...(_isReply
                      ? _replyForm()
                      : switch (widget.level) {
                          0 => _identityForm(),
                          1 => _backgroundForm(),
                          _ => _skillForm(),
                        }),
                  if (_error != null) ...[
                    const SizedBox(height: AppSpacing.lg),
                    Text(
                      _error!,
                      style: AppType.meta.copyWith(color: AppColors.red),
                    ),
                  ],
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.screenX,
                AppSpacing.md,
                AppSpacing.screenX,
                AppSpacing.screenBottom,
              ),
              decoration: const BoxDecoration(
                color: AppColors.surface,
                border: Border(top: BorderSide(color: AppColors.rule)),
              ),
              child: AppButton(
                label: 'Submit',
                kind: AppButtonKind.accent,
                loading: _busy,
                onPressed: _canSubmit ? _submit : null,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Answering an ops request. Free text plus optional extra photos, since
  /// what was asked for varies and cannot be guessed at.
  List<Widget> _replyForm() => [
        AppField(
          controller: _notes,
          label: 'Your answer',
          hint: 'Type what was asked for',
          autofocus: true,
          maxLines: 5,
          maxLength: 2000,
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: AppSpacing.lg),
        Text('Add a photo, if that is what they need',
            style: AppType.cardTitle),
        const SizedBox(height: AppSpacing.sm),
        _UploadTile(
          label: 'Another photo',
          done: _idDocId != null,
          busy: _busy,
          onTap: () async {
            final id = await _pickAndUpload('other');
            if (id != null) setState(() => _idDocId = id);
          },
        ),
      ];

  List<Widget> _identityForm() => [
        Text('Which document?', style: AppType.cardTitle),
        const SizedBox(height: AppSpacing.sm),
        Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.sm,
          children: [
            for (final entry in VerificationLevels.idTypes.entries)
              AppChip(
                label: entry.value,
                selected: _idType == entry.key,
                onTap: () => setState(() => _idType = entry.key),
              ),
          ],
        ),
        const SizedBox(height: AppSpacing.lg),
        AppField(
          controller: _last4,
          label: 'Last 4 digits only',
          hint: '1234',
          keyboardType: TextInputType.number,
          inputFormatters: [
            FilteringTextInputFormatter.digitsOnly,
            LengthLimitingTextInputFormatter(4),
          ],
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: AppSpacing.sm),
        Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: AppColors.graphiteSoft,
            borderRadius: AppRadius.tileR,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(
                Icons.lock_outline_rounded,
                size: 16,
                color: AppColors.graphite,
              ),
              const SizedBox(width: AppSpacing.sm + 2),
              Expanded(
                child: Text(
                  // Not a nicety: the API scans every field for a run of 8+
                  // digits and refuses the submission. A full Aadhaar number
                  // must not exist in our systems at all — so it cannot be
                  // logged, error-reported, or found in a backup.
                  'We only ever store the last four digits. Never type the '
                  'whole number — we will refuse it.',
                  style: AppType.meta.copyWith(color: AppColors.inkMuted),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        _UploadTile(
          label: 'Photo of the document',
          done: _idDocId != null,
          busy: _busy,
          onTap: () async {
            final id = await _pickAndUpload('id_proof');
            if (id != null) setState(() => _idDocId = id);
          },
        ),
        const SizedBox(height: AppSpacing.sm),
        _UploadTile(
          label: 'Photo of yourself',
          // docType 'photo' is the one that also satisfies the profile's
          // photoDocument completeness item — the profile picture does not.
          done: _selfieDocId != null,
          busy: _busy,
          onTap: () async {
            final id = await _pickAndUpload('photo');
            if (id != null) setState(() => _selfieDocId = id);
          },
        ),
      ];

  List<Widget> _backgroundForm() => [
        AppCard(
          onTap: () => setState(() => _consent = !_consent),
          selected: _consent,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                _consent
                    ? Icons.check_box_rounded
                    : Icons.check_box_outline_blank_rounded,
                size: 22,
                color: _consent ? AppColors.graphite : AppColors.greyLight,
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Text(
                  'I agree to a standard background check.',
                  style: AppType.bodyMedium,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        Text(
          'Nothing to upload. Customers are letting you into their homes, so '
          'this is the step that lets us say you have been checked.',
          style: AppType.meta.copyWith(color: AppColors.grey),
        ),
      ];

  List<Widget> _skillForm() => [
        _UploadTile(
          label: 'A certificate, if you have one',
          done: _certDocId != null,
          busy: _busy,
          onTap: () async {
            final id = await _pickAndUpload('certificate');
            if (id != null) setState(() => _certDocId = id);
          },
        ),

        const SizedBox(height: AppSpacing.lg),
        Row(
          children: [
            Expanded(
              child: Divider(color: AppColors.rule),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              child: Text(
                'OR',
                style: AppType.label.copyWith(color: AppColors.greyLight),
              ),
            ),
            const Expanded(child: Divider(color: AppColors.rule)),
          ],
        ),
        const SizedBox(height: AppSpacing.lg),

        AppCard(
          onTap: () => setState(() => _tradeTest = !_tradeTest),
          selected: _tradeTest,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(
                    _tradeTest
                        ? Icons.check_box_rounded
                        : Icons.check_box_outline_blank_rounded,
                    size: 22,
                    color:
                        _tradeTest ? AppColors.graphite : AppColors.greyLight,
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Text(
                      'Ask us for a trade test instead',
                      style: AppType.bodyMedium,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'No certificate needed — someone will arrange a practical '
                'test with you.',
                style: AppType.meta.copyWith(color: AppColors.grey),
              ),
            ],
          ),
        ),

        // Required when asking for a test: a human has to arrange it, and
        // they need to know what to arrange.
        if (_tradeTest) ...[
          const SizedBox(height: AppSpacing.md),
          AppField(
            controller: _notes,
            label: 'What work do you do?',
            hint: 'Water tank cleaning and RO servicing, 6 years',
            maxLines: 3,
            maxLength: 1000,
            onChanged: (_) => setState(() {}),
          ),
        ],
      ];
}

class _UploadTile extends StatelessWidget {
  const _UploadTile({
    required this.label,
    required this.done,
    required this.busy,
    required this.onTap,
  });

  final String label;
  final bool done;
  final bool busy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: busy ? null : onTap,
      selected: done,
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: done ? AppColors.greenSoft : AppColors.mist,
              borderRadius: BorderRadius.circular(13),
            ),
            child: Icon(
              done ? Icons.check_rounded : Icons.photo_camera_outlined,
              size: 18,
              color: done ? AppColors.green : AppColors.greyLight,
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: AppType.bodyMedium.copyWith(fontSize: 13.5)),
                const SizedBox(height: 1),
                Text(
                  done ? 'Uploaded' : 'Tap to take a photo',
                  style: AppType.caption.copyWith(
                    color: done ? AppColors.green : AppColors.greyLight,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
