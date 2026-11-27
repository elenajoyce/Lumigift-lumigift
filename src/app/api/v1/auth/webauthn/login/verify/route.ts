/**
 * POST /api/v1/auth/webauthn/login/verify — Complete passkey sign-in
 *
 * Body: `{ phone: string, response: AuthenticationResponseJSON }`.
 * Verifies the assertion against the challenge issued by login/options,
 * bumps the stored credential counter (replay prevention — handled inside
 * `verifyAuthentication`), and issues a NextAuth session cookie equivalent
 * to a successful OTP login.
 *
 * Issue #525 — the login options endpoint existed but verify did not, so
 * passkey sign-in could never actually complete.
 */
import { NextRequest, NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { withErrorHandler, AppError, ERROR_CODES } from "@/server/middleware";
import pool from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { verifyAuthentication } from "@/lib/webauthn";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { ApiResponse } from "@/types";

const isProd = process.env.NODE_ENV === "production";
const SESSION_COOKIE_NAME = isProd
  ? "__Secure-next-auth.session-token"
  : "next-auth.session-token";
// Matches the default NextAuth JWT session maxAge (30 days).
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export const POST = withErrorHandler(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  const phone = typeof body?.phone === "string" ? normalizePhone(body.phone) : null;
  const response = body?.response as AuthenticationResponseJSON | undefined;
  if (!phone || !response || typeof response.id !== "string") {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "phone and response are required", 400);
  }

  const { rows } = await pool.query<{ id: string; phone: string }>(
    "SELECT id, phone FROM users WHERE phone = $1",
    [phone]
  );
  const user = rows[0];
  if (!user) {
    throw new AppError(ERROR_CODES.VERIFICATION_FAILED, "Passkey login failed", 400);
  }

  const verified = await verifyAuthentication(user.id, response);
  if (!verified) {
    throw new AppError(ERROR_CODES.VERIFICATION_FAILED, "Passkey login failed", 400);
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Auth is not configured", 500);
  }

  // Shape mirrors the jwt() callback in @/lib/auth for the "Phone OTP" provider,
  // so this session is indistinguishable from an OTP-based login.
  const token = await encode({
    secret,
    maxAge: SESSION_MAX_AGE_SECONDS,
    token: { id: user.id, phone: user.phone },
  });

  const res = NextResponse.json<ApiResponse<{ loggedIn: boolean }>>({
    success: true,
    data: { loggedIn: true },
  });
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: isProd,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
});
