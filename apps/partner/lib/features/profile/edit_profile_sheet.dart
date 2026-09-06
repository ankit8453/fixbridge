import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_error.dart';
import '../location/map_picker_screen.dart';
import '../../core/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../data/models/partner_profile.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_field.dart';
import '../home/partner_providers.dart';
import '../../l10n/app_text.dart';

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

  @override
  void dispose() {
    _name.dispose();
    _bio.dispose();
    _years.dispose();
    super.dispose();
  }

  /// Sets the base point on a map.
  ///
  /// It used to read the phone's GPS and nothing else, on the reasoning that a
  /// technician setting this up is standing where they work. Two problems with
  /// that. A base location is **required** to be listed, so somebody who
  /// refused the permission could never be found by a customer and had no way
  /// to fix it. And plenty set this up at home for a shop two streets away,
  /// which pinned them to the wrong building with no way to see that it had.
  ///
  /// The map answers both: it opens on the phone's position when that is
  /// available, and works by panning when it is not.
  Future<void> _locate() async {
    final picked = await Navigator.of(context).push<PickedPoint>(
      MaterialPageRoute(
        builder: (_) => MapPickerScreen(
          initial: _base == null
              ? null
              : PickedPoint(lat: _base!.lat, lng: _base!.lng),
        ),
        fullscreenDialog: true,
      ),
    );

    if (picked == null || !mounted) return;

    setState(() {
      _base = GeoPoint(picked.lat, picked.lng);
      _locationNote = null;
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
            Text(tr('profile.yourDetails'), style: AppType.heading),
            const SizedBox(height: AppSpacing.lg),
            AppField(
              controller: _name,
              label: tr('profile.nameCustomersSee'),
              error: _error,
              maxLength: 120,
              textCapitalization: TextCapitalization.words,
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: AppSpacing.md),
            AppField(
              controller: _bio,
              label: tr('profile.aboutYouOptional'),
              hint: tr('profile.yearsDoingTankCleaningAnd'),
              maxLines: 3,
              maxLength: 1000,
            ),
            const SizedBox(height: AppSpacing.md),
            AppField(
              controller: _years,
              label: tr('profile.yearsOfExperienceOptional'),
              hint: '6',
              keyboardType: TextInputType.number,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(2),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),
            Text(tr('profile.whereDoYouWorkFrom'), style: AppType.cardTitle),
            const SizedBox(height: AppSpacing.xs),
            Text(
              _base == null
                  ? tr('profile.customersAreMatchedToYou')
                  : tr('profile.setCustomersWithinYourTravel'),
              style: AppType.meta.copyWith(
                color: _base == null ? AppColors.amber : AppColors.grey,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            AppButton(
              label: _base == null ? tr('profile.setOnMap') : tr('profile.changeLocation'),
              kind: _base == null ? AppButtonKind.primary : AppButtonKind.ghost,
              icon: _base == null ? Icons.map_outlined : Icons.check_rounded,
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
            Text(tr('profile.howFarWillYouTravel'), style: AppType.cardTitle),
            const SizedBox(height: AppSpacing.xs),
            Text(
              tr('profile.customersFurtherThanThisWill'),
              style: AppType.meta.copyWith(color: AppColors.grey),
            ),
            Slider(
              value: _radius.toDouble(),
              min: 1,
              max: 25,
              divisions: 24,
              label: tr('profile.radiusKm', {'_radius': _radius}),
              activeColor: AppColors.graphite,
              onChanged: (v) => setState(() => _radius = v.round()),
            ),
            Center(
              child: Text(
                tr('profile.radiusKm2', {'_radius': _radius}),
                style: AppType.cardTitle.copyWith(color: AppColors.graphite),
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            AppButton(
              label: tr('profile.save'),
              loading: _saving,
              onPressed: _name.text.trim().isEmpty ? null : _save,
            ),
          ],
        ),
      ),
    );
  }
}
