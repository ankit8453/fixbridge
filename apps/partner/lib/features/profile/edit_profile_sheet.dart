import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_error.dart';
import '../../core/location.dart';
import '../../core/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../data/models/partner_profile.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_field.dart';
import '../home/partner_providers.dart';

/// Editing the parts of a profile that are not skills, prices or hours.
///
/// **Where you work from is a required item** — without it the profile cannot
/// be listed at all — so it sits at the top with its own explanation rather
/// than buried under the optional fields.
class EditProfileSheet extends ConsumerStatefulWidget {
  const EditProfileSheet({super.key, required this.profile});

  final PartnerProfile profile;

  @override
  ConsumerState<EditProfileSheet> createState() => _EditProfileSheetState();
}

class _EditProfileSheetState extends ConsumerState<EditProfileSheet> {
  late final _name = TextEditingController(text: widget.profile.displayName);
  late final _bio = TextEditingController(text: widget.profile.bio);
  late final _years = TextEditingController(
    text: widget.profile.yearsExperience?.toString() ?? '',
  );
  late int _radius = widget.profile.serviceRadiusKm;
  late GeoPoint? _base = widget.profile.baseLocation;

  String? _error;
  String? _locationNote;
  bool _saving = false;
  bool _locating = false;

  @override
  void dispose() {
    _name.dispose();
    _bio.dispose();
    _years.dispose();
    super.dispose();
  }

  /// Reads the phone's location for the base point.
  ///
  /// Standing where you work is the honest way to set this, and it is the one
  /// moment a technician is guaranteed to be there — during onboarding, at
  /// their own shop or home. Refusal is handled rather than blocked: the note
  /// explains what happened and the rest of the form still saves.
  Future<void> _locate() async {
    setState(() {
      _locating = true;
      _locationNote = null;
    });

    final result = await DeviceLocation.current();
    if (!mounted) return;

    setState(() {
      _locating = false;
      switch (result) {
        case LocationFound(:final lat, :final lng):
          _base = GeoPoint(lat, lng);
          _locationNote = null;
        case LocationRefused(:final message):
          _locationNote = message;
      }
    });
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty || _saving) return;
    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      await ref.read(partnerRepositoryProvider).updateProfile(
            displayName: _name.text.trim(),
            // Empty means clear, not "leave alone" — the API distinguishes
            // the two and so does this.
            bio: _bio.text.trim().isEmpty ? null : _bio.text,
            clearBio: _bio.text.trim().isEmpty,
            yearsExperience: int.tryParse(_years.text.trim()),
            clearExperience: _years.text.trim().isEmpty,
            serviceRadiusKm: _radius,
            lat: _base?.lat,
            lng: _base?.lng,
          );

      ref.invalidate(partnerProfileProvider);
      if (mounted) Navigator.pop(context, true);
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.fieldMessage('displayName') ?? e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.xl,
        right: AppSpacing.xl,
        top: AppSpacing.sm,
        bottom: AppSpacing.sheetBottom(context),
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Your details', style: AppType.heading),
            const SizedBox(height: AppSpacing.lg),
            AppField(
              controller: _name,
              label: 'Name customers see',
              error: _error,
              maxLength: 120,
              textCapitalization: TextCapitalization.words,
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: AppSpacing.md),
            AppField(
              controller: _bio,
              label: 'About you (optional)',
              hint: '12 years doing tank cleaning and RO servicing',
              maxLines: 3,
              maxLength: 1000,
            ),
            const SizedBox(height: AppSpacing.md),
            AppField(
              controller: _years,
              label: 'Years of experience (optional)',
              hint: '6',
              keyboardType: TextInputType.number,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(2),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),
            Text('Where do you work from?', style: AppType.cardTitle),
            const SizedBox(height: AppSpacing.xs),
            Text(
              _base == null
                  ? 'Customers are matched to you by distance from here. '
                      'Without it you cannot be found at all.'
                  : 'Set. Customers within your travel distance of this point '
                      'can find you.',
              style: AppType.meta.copyWith(
                color: _base == null ? AppColors.amber : AppColors.grey,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            AppButton(
              label: _base == null
                  ? 'Use my current location'
                  : 'Update to where I am now',
              kind: AppButtonKind.ghost,
              icon: Icons.my_location_rounded,
              loading: _locating,
              onPressed: _locate,
            ),
            if (_locationNote != null) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(
                _locationNote!,
                style: AppType.meta.copyWith(color: AppColors.amber),
              ),
            ],
            const SizedBox(height: AppSpacing.lg),
            Text('How far will you travel?', style: AppType.cardTitle),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Customers further than this will not see you.',
              style: AppType.meta.copyWith(color: AppColors.grey),
            ),
            Slider(
              value: _radius.toDouble(),
              min: 1,
              max: 25,
              divisions: 24,
              label: '$_radius km',
              activeColor: AppColors.graphite,
              onChanged: (v) => setState(() => _radius = v.round()),
            ),
            Center(
              child: Text(
                '$_radius km',
                style: AppType.cardTitle.copyWith(color: AppColors.graphite),
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            AppButton(
              label: 'Save',
              loading: _saving,
              onPressed: _name.text.trim().isEmpty ? null : _save,
            ),
          ],
        ),
      ),
    );
  }
}
