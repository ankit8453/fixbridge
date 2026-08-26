-- Coupon spend gets its own expense account: the discount is debited here at
-- capture so provider_payable and platform_revenue keep their pre-discount
-- values (platform-funded coupons; see payments/service.ts).
ALTER TYPE "account_type" ADD VALUE 'marketing_discount';
