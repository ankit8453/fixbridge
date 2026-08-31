import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';

/// A text field.
///
/// Errors come from the API's `details[]`, which names the field it rejected,
/// so a screen can map a server error onto the right box rather than dumping
/// one message at the top of the form.
class AppField extends StatelessWidget {
  const AppField({
    super.key,
    this.controller,
    this.label,
    this.hint,
    this.error,
    this.prefix,
    this.suffix,
    this.keyboardType,
    this.inputFormatters,
    this.onChanged,
    this.onSubmitted,
    this.autofocus = false,
    this.enabled = true,
    this.maxLines = 1,
    this.maxLength,
    this.textCapitalization = TextCapitalization.none,
  });

  final TextEditingController? controller;
  final String? label;
  final String? hint;
  final String? error;
  final Widget? prefix;
  final Widget? suffix;
  final TextInputType? keyboardType;
  final List<TextInputFormatter>? inputFormatters;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final bool autofocus;
  final bool enabled;
  final int maxLines;
  final int? maxLength;
  final TextCapitalization textCapitalization;

  @override
  Widget build(BuildContext context) {
    final hasError = error != null && error!.isNotEmpty;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (label != null) ...[
          Text(
            label!,
            style: AppType.meta.copyWith(
              color: AppColors.inkMuted,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
        ],
        TextField(
          controller: controller,
          keyboardType: keyboardType,
          inputFormatters: inputFormatters,
          onChanged: onChanged,
          onSubmitted: onSubmitted,
          autofocus: autofocus,
          enabled: enabled,
          maxLines: maxLines,
          maxLength: maxLength,
          textCapitalization: textCapitalization,
          style: AppType.body.copyWith(color: AppColors.ink),
          cursorColor: AppColors.blue,
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: AppType.body.copyWith(color: AppColors.greyLight),
            prefixIcon: prefix,
            // Without this a text prefix like "+91" is squeezed into the
            // default 48px icon box and clips.
            prefixIconConstraints: const BoxConstraints(minWidth: 0, minHeight: 0),
            suffixIcon: suffix,
            filled: true,
            fillColor: enabled ? AppColors.surface : AppColors.mist,
            counterText: '',
            contentPadding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg,
              vertical: AppSpacing.lg,
            ),
            border: _border(AppColors.rule),
            enabledBorder: _border(hasError ? AppColors.red : AppColors.rule),
            focusedBorder: _border(
              hasError ? AppColors.red : AppColors.blue,
              width: 1.5,
            ),
            disabledBorder: _border(AppColors.rule),
          ),
        ),
        if (hasError) ...[
          const SizedBox(height: 6),
          Text(
            error!,
            style: AppType.caption.copyWith(color: AppColors.red),
          ),
        ],
      ],
    );
  }

  OutlineInputBorder _border(Color color, {double width = 1}) {
    return OutlineInputBorder(
      borderRadius: AppRadius.fieldR,
      borderSide: BorderSide(color: color, width: width),
    );
  }
}
