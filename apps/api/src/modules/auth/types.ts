import { z } from 'zod';
import type { Role as SharedRole } from '@fixbridge/shared';
import type { Role as PrismaRole } from '@prisma/client';
import { normalizePhone } from './phone';

/* -------------------------------------------------------------------------- */
/* Keep the shared Role union and the Prisma enum in lockstep                  */
/* -------------------------------------------------------------------------- */

/**
 * Compile-time assertion, both directions. If someone adds a role to
 * `schema.prisma` without adding it to `packages/shared`, or vice versa, the
 * build fails here rather than at runtime in a role check.
 */
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _rolesAreInSync: AssertEqual<SharedRole, `${PrismaRole}`> = true;
void _rolesAreInSync;

/* -------------------------------------------------------------------------- */
/* Reusable field schemas                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Accepts anything a human might type and yields E.164. Because it is a
 * transform, every downstream layer only ever sees the normalised form.
 */
export const phoneField = z
  .string()
  .trim()
  .min(1)
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);

    if (normalized === null) {
      ctx.addIssue({
        code: 'custom',
        message: 'must be a valid 10-digit Indian mobile number',
      });
      return z.NEVER;
    }

    return normalized;
  });

/**
 * Client-generated, stable per install. Constrained so it cannot be used to
 * smuggle unbounded data into the database or the JWT.
 */
export const deviceIdField = z
  .string()
  .trim()
  .min(8, 'must be at least 8 characters')
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, 'may only contain letters, digits and . _ : -');

export const otpField = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'must be exactly 6 digits');

export const refreshTokenField = z.string().trim().min(20).max(512);

/* -------------------------------------------------------------------------- */
/* Request schemas                                                            */
/* -------------------------------------------------------------------------- */

export const requestOtpSchema = z.object({
  phone: phoneField,
});

export const verifyOtpSchema = z.object({
  phone: phoneField,
  otp: otpField,
  deviceId: deviceIdField,
});

export const refreshSchema = z.object({
  refreshToken: refreshTokenField,
  deviceId: deviceIdField,
});

export const logoutSchema = z.object({
  refreshToken: refreshTokenField,
});

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;

/* -------------------------------------------------------------------------- */
/* Service-level types                                                        */
/* -------------------------------------------------------------------------- */

/** Caller metadata the service needs but that is not part of the request body. */
export interface RequestContextInfo {
  ip: string;
  userAgent: string | null;
}

export interface RequestOtpResult {
  /** Masked — echoes back what we normalised so a client can show it. */
  phone: string;
  expiresInSeconds: number;
}

/* -------------------------------------------------------------------------- */
/* The ops console's two-step sign-in                                         */
/* -------------------------------------------------------------------------- */

/**
 * `loginId` is the staff member's phone number.
 *
 * Not a username: the second factor is an OTP, which has to reach a phone
 * anyway, so a separate identifier would be one more thing to issue, store and
 * reset for no gain. It is called `loginId` rather than `phone` because the
 * console's sign-in screen says "ID", and because a future SSO integration would
 * put something else here without renaming the field.
 */
export const adminPasswordSchema = z
  .object({
    loginId: z.string().trim().min(1).max(40),
    password: z.string().min(1).max(200),
  })
  .strict();

export type AdminPasswordInput = z.infer<typeof adminPasswordSchema>;

export const adminVerifySchema = z
  .object({
    challengeId: z.string().uuid(),
    otp: z
      .string()
      .trim()
      .regex(/^\d{4,8}$/, 'must be the code that was sent'),
    deviceId: z.string().trim().min(1).max(128),
  })
  .strict();

export type AdminVerifyInput = z.infer<typeof adminVerifySchema>;
