import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_error.dart';
import '../../core/location.dart';
import '../../core/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../data/models/address.dart';
import '../../data/models/money.dart';
import '../../data/models/provider.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/app_field.dart';
import '../../shared/widgets/states.dart';
import '../home/home_providers.dart';
import 'provider_providers.dart';

/// Confirming a booking: where, and what is wrong.
///
/// Deliberately short. Everything that could be asked later is asked later —
/// the technician can phone. What cannot be deferred is an address to come to
/// and the price being fixed at this moment.
class BookSheet extends ConsumerStatefulWidget {
  const BookSheet({
    super.key,
    required this.profile,
    required this.slot,
    required this.card,
  });

  final ProviderProfile profile;
  final ProviderSlot slot;

  /// The price card for the service being booked, chosen upstream.
  ///
  /// Passed in rather than derived here. This sheet used to take
  /// `priceCards.first`, which meant a technician offering tank cleaning at
  /// ₹700 and RO service at ₹350 was always booked at ₹350 — the search
  /// showed one price and the booking took another.
  final PriceCard? card;

  @override
  ConsumerState<BookSheet> createState() => _BookSheetState();
}

class _BookSheetState extends ConsumerState<BookSheet> {
  final _note = TextEditingController();
  String? _addressId;
  String? _error;
  bool _booking = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  PriceCard? get _priceCard => widget.card;

  Future<void> _confirm() async {
    final addressId = _addressId;
    if (addressId == null || _booking) return;

    setState(() {
      _booking = true;
      _error = null;
    });

    try {
      final booking = await ref.read(bookingRepositoryProvider).create(
            slotId: widget.slot.id,
            categoryId: _priceCard?.categoryId ??
                (widget.profile.skills.isNotEmpty
                    ? widget.profile.skills.first.categoryId
                    : 0),
            addressId: addressId,
            priceCardId: _priceCard?.id,
            problemNote: _note.text,
          );

      // The home screen's live card reads from this, so it has to know.
      ref.invalidate(myBookingsProvider);

      if (!mounted) return;
      Navigator.pop(context);
      // Straight to the booking they just made — the sheet closing onto the
      // profile they have finished with would be a dead end.
      unawaited(context.push('/booking/${booking.id}'));
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _booking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final addresses = ref.watch(myAddressesProvider);

    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.xl,
        right: AppSpacing.xl,
        top: AppSpacing.sm,
        // Lifts the sheet above the keyboard when the note field is focused.
        bottom: AppSpacing.sheetBottom(context),
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Confirm booking', style: AppType.heading),
            const SizedBox(height: AppSpacing.xs),
            Text(
              '${widget.profile.name} · ${_when(widget.slot.startsAt)}',
              style: AppType.meta.copyWith(color: AppColors.grey),
            ),
            const SizedBox(height: AppSpacing.lg),
            _PriceRow(card: _priceCard),
            const SizedBox(height: AppSpacing.lg),
            Text(
              'Where should they come?',
              style: AppType.cardTitle.copyWith(fontSize: 13),
            ),
            const SizedBox(height: AppSpacing.sm),
            addresses.when(
              loading: () => const Shimmer(height: 62, radius: 18),
              error: (e, _) => ErrorState(
                error: e,
                onRetry: () => ref.invalidate(myAddressesProvider),
              ),
              data: (list) => list.isEmpty
                  ? _NoAddress(onAdd: _addAddress)
                  : Column(
                      children: [
                        for (final address in list)
                          Padding(
                            padding:
                                const EdgeInsets.only(bottom: AppSpacing.sm),
                            child: _AddressRow(
                              address: address,
                              selected: _addressId == address.id,
                              onTap: () =>
                                  setState(() => _addressId = address.id),
                            ),
                          ),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: TextButton.icon(
                            onPressed: _addAddress,
                            icon: const Icon(Icons.add_rounded, size: 16),
                            label: const Text('Add another address'),
                            style: TextButton.styleFrom(
                              foregroundColor: AppColors.blue,
                              textStyle: AppType.meta.copyWith(
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
            ),
            const SizedBox(height: AppSpacing.md),
            AppField(
              controller: _note,
              label: "What's the problem? (optional)",
              hint: 'Fan makes noise and stops after a while',
              maxLines: 3,
              maxLength: 500,
            ),
            if (_error != null) ...[
              const SizedBox(height: AppSpacing.md),
              Text(
                _error!,
                style: AppType.meta.copyWith(color: AppColors.red),
              ),
            ],
            const SizedBox(height: AppSpacing.lg),
            AppButton(
              label: 'Confirm booking',
              loading: _booking,
              onPressed: _addressId == null ? null : _confirm,
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'They have one hour to accept. Nothing is charged until the '
              'work is done.',
              style: AppType.caption.copyWith(color: AppColors.grey),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _addAddress() async {
    final added = await showModalBottomSheet<Address>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const AddAddressSheet(),
    );
    if (added != null && mounted) {
      ref.invalidate(myAddressesProvider);
      setState(() => _addressId = added.id);
    }
  }

  static String _when(DateTime dt) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final day = DateTime(dt.year, dt.month, dt.day);
    final diff = day.difference(today).inDays;
    final h = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    final period = dt.hour < 12 ? 'am' : 'pm';
    final time = dt.minute == 0
        ? '$h $period'
        : '$h:${dt.minute.toString().padLeft(2, '0')} $period';

    return switch (diff) {
      0 => 'today, $time',
      1 => 'tomorrow, $time',
      _ => '${dt.day}/${dt.month}, $time',
    };
  }
}

class _PriceRow extends StatelessWidget {
  const _PriceRow({required this.card});

  final PriceCard? card;

  @override
  Widget build(BuildContext context) {
    if (card == null) return const SizedBox.shrink();

    return AppCard(
      color: AppColors.blueSoft,
      borderColor: AppColors.blueSoft,
      child: Row(
        children: [
          const Icon(Icons.lock_outline_rounded,
              size: 16, color: AppColors.blue),
          const SizedBox(width: AppSpacing.sm + 2),
          Expanded(
            child: Text(
              // The whole product in one sentence. The API snapshots this
              // amount onto the booking and holds every later quotation to it.
              'The labour price is fixed at ${Paise.show(card!.display, card!.amountPaise)} '
              'now. It cannot be changed later.',
              style: AppType.meta.copyWith(color: AppColors.ink),
            ),
          ),
        ],
      ),
    );
  }
}

class _AddressRow extends StatelessWidget {
  const _AddressRow({
    required this.address,
    required this.selected,
    required this.onTap,
  });

  final Address address;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onTap,
      selected: selected,
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md + 2,
        vertical: AppSpacing.md,
      ),
      child: Row(
        children: [
          Icon(
            address.label == 'home'
                ? Icons.home_rounded
                : address.label == 'shop'
                    ? Icons.storefront_rounded
                    : Icons.place_rounded,
            size: 18,
            color: selected ? AppColors.blue : AppColors.greyLight,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(address.displayLabel, style: AppType.bodyMedium),
                const SizedBox(height: 1),
                Text(
                  address.shortLine,
                  style: AppType.caption.copyWith(color: AppColors.grey),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          if (selected)
            const Icon(
              Icons.check_circle_rounded,
              size: 18,
              color: AppColors.blue,
            ),
        ],
      ),
    );
  }
}

class _NoAddress extends StatelessWidget {
  const _NoAddress({required this.onAdd});

  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'No saved address yet',
            style: AppType.cardTitle.copyWith(fontSize: 13),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'The technician needs somewhere to come to.',
            style: AppType.meta.copyWith(color: AppColors.grey),
          ),
          const SizedBox(height: AppSpacing.md),
          AppButton(
            label: 'Add an address',
            kind: AppButtonKind.ghost,
            onPressed: onAdd,
          ),
        ],
      ),
    );
  }
}

/// Adding an address.
///
/// No map picker and no GPS: the API geocodes from the text, and coordinates
/// are optional as long as they travel as a pair. A landmark matters more than
/// a pin here — "near Surtalai bus stop" is how somebody is actually found.
class AddAddressSheet extends ConsumerStatefulWidget {
  const AddAddressSheet({super.key});

  @override
  ConsumerState<AddAddressSheet> createState() => _AddAddressSheetState();
}

class _AddAddressSheetState extends ConsumerState<AddAddressSheet> {
  final _address = TextEditingController();
  final _landmark = TextEditingController();
  String _label = 'home';
  String? _error;
  bool _saving = false;

  ({double lat, double lng})? _coords;
  String? _geoNote;
  bool _locating = false;

  @override
  void dispose() {
    _address.dispose();
    _landmark.dispose();
    super.dispose();
  }

  /// Pins the address to real coordinates.
  ///
  /// Optional on purpose. Without it the server geocodes the address text, so
  /// a refusal costs accuracy rather than blocking the save — and a customer
  /// who is not at the address they are adding should not be pinning it to
  /// where they happen to be standing.
  Future<void> _locate() async {
    setState(() {
      _locating = true;
      _geoNote = null;
    });

    final result = await DeviceLocation.current();
    if (!mounted) return;

    setState(() {
      _locating = false;
      switch (result) {
        case LocationFound(:final lat, :final lng):
          _coords = (lat: lat, lng: lng);
          _geoNote = null;
        case LocationRefused(:final message):
          _geoNote = message;
      }
    });
  }

  Future<void> _save() async {
    if (_address.text.trim().length < 5 || _saving) return;

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      final address = await ref.read(accountRepositoryProvider).addAddress(
            addressText: _address.text,
            label: _label,
            landmark: _landmark.text,
            lat: _coords?.lat,
            lng: _coords?.lng,
          );
      if (mounted) Navigator.pop(context, address);
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.fieldMessage('addressText') ?? e.message);
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
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Add an address', style: AppType.heading),
            const SizedBox(height: AppSpacing.lg),
            Row(
              children: [
                for (final option in const [
                  (key: 'home', label: 'Home'),
                  (key: 'shop', label: 'Shop'),
                  (key: 'other', label: 'Other'),
                ])
                  Padding(
                    padding: const EdgeInsets.only(right: AppSpacing.sm),
                    child: AppChip(
                      label: option.label,
                      selected: _label == option.key,
                      onTap: () => setState(() => _label = option.key),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),
            AppField(
              controller: _address,
              label: 'Address',
              hint: 'House number, street, area',
              error: _error,
              autofocus: true,
              maxLines: 2,
              maxLength: 500,
              // Always rebuilds. Save is enabled from this field's length,
              // so a keystroke that does not repaint leaves it disabled.
              onChanged: (_) => setState(() => _error = null),
            ),
            const SizedBox(height: AppSpacing.md),
            AppField(
              controller: _landmark,
              label: 'Landmark (optional)',
              hint: 'Near Surtalai bus stop',
              maxLength: 200,
            ),
            const SizedBox(height: AppSpacing.md),
            AppButton(
              label: _coords == null
                  ? 'Use my current location'
                  : 'Location pinned',
              kind: AppButtonKind.ghost,
              icon: _coords == null
                  ? Icons.my_location_rounded
                  : Icons.check_rounded,
              loading: _locating,
              onPressed: _coords == null ? _locate : null,
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              _coords == null
                  ? 'Helps a technician find you. If you skip it we work the '
                      'location out from the address above.'
                  : 'Saved with this address.',
              style: AppType.caption.copyWith(
                color: _coords == null ? AppColors.grey : AppColors.green,
              ),
            ),
            if (_geoNote != null) ...[
              const SizedBox(height: AppSpacing.xs),
              Text(
                _geoNote!,
                style: AppType.caption.copyWith(color: AppColors.amberText),
              ),
            ],
            const SizedBox(height: AppSpacing.lg),
            AppButton(
              label: 'Save address',
              loading: _saving,
              onPressed: _address.text.trim().length < 5 ? null : _save,
            ),
          ],
        ),
      ),
    );
  }
}
