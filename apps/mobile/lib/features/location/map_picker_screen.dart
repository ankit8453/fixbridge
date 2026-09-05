import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../core/location.dart';
import '../../core/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../data/repositories/geo_repository.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_field.dart';
import 'location_providers.dart';

/// The point the customer confirmed, and what it is called.
class PickedPoint {
  const PickedPoint({required this.lat, required this.lng, this.label});

  final double lat;
  final double lng;

  /// The neighbourhood, when the geocoder could name it. Only ever a hint for
  /// the address text — never a substitute for it.
  final String? label;
}

/// Choosing exactly where a job is.
///
/// The pin is fixed to the centre of the screen and the **map moves underneath
/// it**, which is how Swiggy, Uber and Ola all do it. A draggable marker looks
/// more obvious and is worse on a phone: your thumb covers the very thing you
/// are trying to place, and the last few metres are guesswork.
///
/// It exists because guessing is not good enough. Before it, an address the
/// customer did not explicitly pin got coordinates invented from its text, and
/// a technician navigated to them — so the person who typed their address most
/// carefully was sent the furthest astray.
///
/// The search box is a convenience, not the mechanism. Somebody standing at
/// their own door never needs it: the map opens on their GPS and they confirm.
/// It matters for the other case — a son in Mumbai booking for his mother in
/// Jabalpur — where panning by hand would be intolerable.
class MapPickerScreen extends ConsumerStatefulWidget {
  const MapPickerScreen({super.key, this.initial});

  /// Where to open. The address being edited, if any — otherwise the device
  /// fix, and the city centre only when there is nothing at all.
  final PickedPoint? initial;

  @override
  ConsumerState<MapPickerScreen> createState() => _MapPickerScreenState();
}

class _MapPickerScreenState extends ConsumerState<MapPickerScreen> {
  final _map = MapController();
  final _search = TextEditingController();

  /// Where the pin is. The map's centre, kept in sync as it moves.
  late LatLng _centre = widget.initial == null
      ? LatLng(cityCentre.lat, cityCentre.lng)
      : LatLng(widget.initial!.lat, widget.initial!.lng);

  String? _label;
  bool _servedHere = true;
  bool _naming = false;
  bool _locating = false;

  List<PlaceSuggestion> _suggestions = const [];
  bool _searching = false;

  /// Debounces both the name lookup and the search, for the same reason: the
  /// server allows one lookup per second for everybody, so firing on every
  /// frame of a pan would spend the whole budget on one person's thumb.
  Timer? _nameDebounce;
  Timer? _searchDebounce;

  @override
  void initState() {
    super.initState();
    // Nothing to locate when editing an existing pin — opening on it is the
    // point. A new address starts wherever the phone is.
    if (widget.initial == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _useDevice());
    } else {
      _nameCentre();
    }
  }

  @override
  void dispose() {
    _nameDebounce?.cancel();
    _searchDebounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  GeoRepository get _geo => ref.read(geoRepositoryProvider);

  Future<void> _useDevice() async {
    setState(() => _locating = true);
    final result = await DeviceLocation.current();
    if (!mounted) return;

    setState(() => _locating = false);

    if (result is LocationFound) {
      final point = LatLng(result.lat, result.lng);
      _map.move(point, 16.5);
      setState(() => _centre = point);
      _nameCentre();
    }
    // A refusal is not an error here. The map is already showing Jabalpur and
    // the customer can pan to their street — slower, but never blocked.
  }

  /// Asks what the pin is sitting on. Debounced, and only once the map settles.
  void _nameCentre() {
    _nameDebounce?.cancel();
    _nameDebounce = Timer(const Duration(milliseconds: 600), () async {
      if (!mounted) return;
      setState(() => _naming = true);

      try {
        final name = await _geo.reverse(_centre.latitude, _centre.longitude);
        if (!mounted) return;
        setState(() {
          _label = name.label;
          _servedHere = name.servedHere;
        });
      } catch (_) {
        // A failed name does not stop anybody confirming a pin they can see.
        if (mounted) setState(() => _label = null);
      } finally {
        if (mounted) setState(() => _naming = false);
      }
    });
  }

  void _onSearchChanged(String value) {
    _searchDebounce?.cancel();

    if (value.trim().length < 3) {
      setState(() => _suggestions = const []);
      return;
    }

    _searchDebounce = Timer(const Duration(milliseconds: 500), () async {
      if (!mounted) return;
      setState(() => _searching = true);

      try {
        final results = await _geo.search(value);
        if (mounted) setState(() => _suggestions = results);
      } catch (_) {
        if (mounted) setState(() => _suggestions = const []);
      } finally {
        if (mounted) setState(() => _searching = false);
      }
    });
  }

  void _pick(PlaceSuggestion suggestion) {
    final point = LatLng(suggestion.lat, suggestion.lng);
    _map.move(point, 16.5);

    setState(() {
      _centre = point;
      _suggestions = const [];
      _search.clear();
    });

    FocusScope.of(context).unfocus();
    _nameCentre();
  }

  void _confirm() {
    Navigator.pop(
      context,
      PickedPoint(lat: _centre.latitude, lng: _centre.longitude, label: _label),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.ground,
      appBar: AppBar(
        title: const Text('Where is the job?'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () => Navigator.pop(context),
        ),
      ),
      body: Stack(
        children: [
          FlutterMap(
            mapController: _map,
            options: MapOptions(
              initialCenter: _centre,
              initialZoom: widget.initial == null ? 13 : 16.5,
              minZoom: 11,
              maxZoom: 18,
              onPositionChanged: (position, _) {
                // Tracked on every frame so the pin and the point never
                // disagree; the *lookup* is what gets debounced.
                _centre = position.center;
              },
              onMapEvent: (event) {
                if (event is MapEventMoveEnd ||
                    event is MapEventFlingAnimationEnd ||
                    event is MapEventDoubleTapZoomEnd) {
                  setState(() {});
                  _nameCentre();
                }
              },
            ),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                // Their policy requires an app to identify itself. An
                // anonymous client is blocked, and we would find out from a
                // grey screen rather than a message.
                userAgentPackageName: 'me.fixbridge.customer',
                maxNativeZoom: 19,
              ),
            ],
          ),

          // The pin. Fixed dead centre and lifted by half its own height so
          // the *tip* marks the point rather than the middle of the icon.
          IgnorePointer(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.only(bottom: 36),
                child: Icon(
                  Icons.location_on,
                  size: 42,
                  color: _servedHere ? AppColors.blue : AppColors.red,
                ),
              ),
            ),
          ),

          Positioned(
            left: AppSpacing.md,
            right: AppSpacing.md,
            top: AppSpacing.md,
            child: _SearchBox(
              controller: _search,
              searching: _searching,
              suggestions: _suggestions,
              onChanged: _onSearchChanged,
              onPick: _pick,
            ),
          ),

          Positioned(
            right: AppSpacing.md,
            bottom: 190,
            child: FloatingActionButton.small(
              heroTag: 'locate',
              backgroundColor: AppColors.surface,
              onPressed: _locating ? null : _useDevice,
              child: _locating
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.my_location_rounded, color: AppColors.ink),
            ),
          ),

          Align(
            alignment: Alignment.bottomCenter,
            child: _ConfirmBar(
              label: _label,
              naming: _naming,
              servedHere: _servedHere,
              onConfirm: _confirm,
            ),
          ),
        ],
      ),
    );
  }
}

class _SearchBox extends StatelessWidget {
  const _SearchBox({
    required this.controller,
    required this.searching,
    required this.suggestions,
    required this.onChanged,
    required this.onPick,
  });

  final TextEditingController controller;
  final bool searching;
  final List<PlaceSuggestion> suggestions;
  final ValueChanged<String> onChanged;
  final ValueChanged<PlaceSuggestion> onPick;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Material(
          elevation: 2,
          borderRadius: AppRadius.tileR,
          child: AppField(
            controller: controller,
            hint: 'Search an area — Vijay Nagar, Surtalai',
            prefix: const Icon(
              Icons.search_rounded,
              size: 18,
              color: AppColors.grey,
            ),
            suffix: searching
                ? const Padding(
                    padding: EdgeInsets.all(12),
                    child: SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : null,
            onChanged: onChanged,
          ),
        ),
        if (suggestions.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.xs),
          Material(
            elevation: 2,
            borderRadius: AppRadius.tileR,
            color: AppColors.surface,
            child: Column(
              children: [
                for (final suggestion in suggestions)
                  ListTile(
                    dense: true,
                    leading: const Icon(
                      Icons.place_outlined,
                      size: 18,
                      color: AppColors.grey,
                    ),
                    title: Text(
                      suggestion.label,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: AppType.meta,
                    ),
                    onTap: () => onPick(suggestion),
                  ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _ConfirmBar extends StatelessWidget {
  const _ConfirmBar({
    required this.label,
    required this.naming,
    required this.servedHere,
    required this.onConfirm,
  });

  final String? label;
  final bool naming;
  final bool servedHere;
  final VoidCallback onConfirm;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.fromLTRB(
        AppSpacing.xl,
        AppSpacing.lg,
        AppSpacing.xl,
        AppSpacing.screenBottom,
      ),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        boxShadow: [
          BoxShadow(color: Color(0x14000000), blurRadius: 16, offset: Offset(0, -4)),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            servedHere
                ? 'Move the map so the pin sits on the door'
                : 'Outside our area',
            style: AppType.bodyMedium,
          ),
          const SizedBox(height: 2),
          Text(
            !servedHere
                // Said here rather than at save time. Somebody who has panned
                // to the wrong city should learn it while looking at the map,
                // not after typing out a full address.
                ? 'FixBridge only works in Jabalpur for now.'
                : naming
                    ? 'Finding the area…'
                    : label ?? 'Drop the pin anywhere you can point to',
            style: AppType.caption.copyWith(
              color: servedHere ? AppColors.grey : AppColors.red,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          AppButton(
            label: 'Confirm this location',
            onPressed: servedHere ? onConfirm : null,
          ),
        ],
      ),
    );
  }
}
