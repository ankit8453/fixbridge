import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_error.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../data/models/payout_detail.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_field.dart';
import '../../core/providers.dart';
import '../home/partner_providers.dart';

/// Telling us where the money goes.
///
/// Asked for before the first payout rather than at signup, so by the time
/// anybody sees this there is money waiting — which is the only moment the
/// form is worth filling in and the only moment it will be.
///
/// Bank or UPI, and neither is the lesser answer. Plenty of technicians in
/// Jabalpur have a UPI ID and could not recite an IFSC; asking them to go and
/// find one is how you lose somebody at the last step before getting paid.
class PayoutDetailSheet extends ConsumerStatefulWidget {
  const PayoutDetailSheet({super.key, this.existing});

  /// What is already saved, if anything. Used to preselect the method — never
  /// to prefill the account number, which the API does not send back in full.
  final PayoutDetail? existing;

  @override
  ConsumerState<PayoutDetailSheet> createState() => _PayoutDetailSheetState();
}

class _PayoutDetailSheetState extends ConsumerState<PayoutDetailSheet> {
  late String _method = widget.existing?.method ?? 'upi';

  final _account = TextEditingController();
  final _confirm = TextEditingController();
  final _ifsc = TextEditingController();
  final _holder = TextEditingController();
  final _upi = TextEditingController();
  final _pan = TextEditingController();

  String? _error;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    // Everything except the account number can be prefilled, because
    // everything except the account number comes back whole.
    _ifsc.text = widget.existing?.ifsc ?? '';
    _holder.text = widget.existing?.accountHolder ?? '';
    _upi.text = widget.existing?.upiId ?? '';
  }

  @override
  void dispose() {
    for (final c in [_account, _confirm, _ifsc, _holder, _upi, _pan]) {
      c.dispose();
    }
    super.dispose();
  }

  bool get _isBank => _method == 'bank';

  /// Enough filled in to be worth sending. The real rules live on the server —
  /// this only decides whether the button is pressable.
  bool get _canSave {
    if (_isBank) {
      return _account.text.trim().length >= 9 &&
          _confirm.text.trim().isNotEmpty &&
          _ifsc.text.trim().length == 11 &&
          _holder.text.trim().length >= 2;
    }
    return _upi.text.trim().contains('@');
  }

  Future<void> _save() async {
    if (!_canSave || _saving) return;

    // Checked here as well as on the server so the answer is instant. The
    // server checks too, because this one is worth being sure about: a
    // wrong-but-valid account number pays a stranger and there is no undo.
    if (_isBank && _account.text.trim() != _confirm.text.trim()) {
      setState(() => _error = 'The two account numbers do not match');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      await ref.read(partnerRepositoryProvider).savePayoutDetail(
            method: _method,
            accountNumber: _isBank ? _account.text.trim() : null,
            confirmAccountNumber: _isBank ? _confirm.text.trim() : null,
            ifsc: _isBank ? _ifsc.text.trim() : null,
            accountHolder: _isBank ? _holder.text.trim() : null,
            upiId: _isBank ? null : _upi.text.trim(),
            pan: _pan.text.trim(),
          );

      ref.invalidate(payoutDetailProvider);
      if (mounted) Navigator.pop(context, true);
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.xl,
        AppSpacing.sm,
        AppSpacing.xl,
        AppSpacing.sheetBottom(context),
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('How should we pay you?', style: AppType.heading),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'We send your earnings here. Check it carefully — money sent to '
              'a wrong number cannot be brought back.',
              style: AppType.meta.copyWith(color: AppColors.grey),
            ),
            const SizedBox(height: AppSpacing.lg),

            _MethodPicker(
              method: _method,
              onChanged: (value) => setState(() {
                _method = value;
                _error = null;
              }),
            ),
            const SizedBox(height: AppSpacing.lg),

            if (_isBank) ...[
              AppField(
                controller: _account,
                label: 'Account number',
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                maxLength: 18,
                onChanged: (_) => setState(() => _error = null),
              ),
              const SizedBox(height: AppSpacing.md),
              AppField(
                controller: _confirm,
                label: 'Type the account number again',
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                maxLength: 18,
                onChanged: (_) => setState(() => _error = null),
              ),
              const SizedBox(height: AppSpacing.md),
              AppField(
                controller: _ifsc,
                label: 'IFSC code',
                hint: 'HDFC0001234',
                maxLength: 11,
                textCapitalization: TextCapitalization.characters,
                // Uppercased as they type, because banks print it in caps and
                // the phone keyboard offers lowercase.
                inputFormatters: [UpperCaseFormatter()],
                onChanged: (_) => setState(() => _error = null),
              ),
              const SizedBox(height: AppSpacing.md),
              AppField(
                controller: _holder,
                label: 'Name on the account',
                textCapitalization: TextCapitalization.words,
                maxLength: 120,
                onChanged: (_) => setState(() => _error = null),
              ),
            ] else ...[
              AppField(
                controller: _upi,
                label: 'UPI ID',
                hint: 'yourname@okhdfcbank',
                keyboardType: TextInputType.emailAddress,
                maxLength: 120,
                onChanged: (_) => setState(() => _error = null),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'The same ID people use to send you money on any UPI app.',
                style: AppType.caption.copyWith(color: AppColors.greyLight),
              ),
            ],

            const SizedBox(height: AppSpacing.lg),
            AppField(
              controller: _pan,
              label: 'PAN (optional)',
              hint: 'ABCDE1234F',
              maxLength: 10,
              textCapitalization: TextCapitalization.characters,
              inputFormatters: [UpperCaseFormatter()],
              onChanged: (_) => setState(() => _error = null),
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              widget.existing?.hasPan == true
                  ? 'A PAN is already saved. Leave this blank to keep it.'
                  : 'Needed later for tax. You can add it another time.',
              style: AppType.caption.copyWith(color: AppColors.greyLight),
            ),

            if (_error != null) ...[
              const SizedBox(height: AppSpacing.md),
              Text(
                _error!,
                style: AppType.meta.copyWith(color: AppColors.red),
              ),
            ],

            const SizedBox(height: AppSpacing.xl),
            AppButton(
              label: 'Save',
              loading: _saving,
              onPressed: _canSave ? _save : null,
            ),
          ],
        ),
      ),
    );
  }
}

/// Uppercases as the field is typed. IFSC and PAN are both printed in capitals
/// and neither is case-sensitive, so correcting silently beats rejecting.
class UpperCaseFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    return newValue.copyWith(text: newValue.text.toUpperCase());
  }
}

class _MethodPicker extends StatelessWidget {
  const _MethodPicker({required this.method, required this.onChanged});

  final String method;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _MethodTile(
            label: 'UPI',
            caption: 'Fastest',
            icon: Icons.qr_code_rounded,
            selected: method == 'upi',
            onTap: () => onChanged('upi'),
          ),
        ),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: _MethodTile(
            label: 'Bank account',
            caption: 'Any amount',
            icon: Icons.account_balance_rounded,
            selected: method == 'bank',
            onTap: () => onChanged('bank'),
          ),
        ),
      ],
    );
  }
}

class _MethodTile extends StatelessWidget {
  const _MethodTile({
    required this.label,
    required this.caption,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final String caption;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppRadius.tileR,
        child: Container(
          padding: const EdgeInsets.symmetric(
            vertical: AppSpacing.md,
            horizontal: AppSpacing.md,
          ),
          decoration: BoxDecoration(
            color: selected ? AppColors.surface : AppColors.mist,
            borderRadius: AppRadius.tileR,
            border: Border.all(
              color: selected ? AppColors.blue : AppColors.rule,
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                icon,
                size: 20,
                color: selected ? AppColors.blue : AppColors.grey,
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(label, style: AppType.bodyMedium),
              Text(
                caption,
                style: AppType.caption.copyWith(color: AppColors.greyLight),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
