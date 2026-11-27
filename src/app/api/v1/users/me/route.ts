/**
 * GET  /api/v1/users/me — returns the current user's profile and notification preferences.
 * DELETE /api/v1/users/me — account deletion request: schedules a 30-day grace
 *   period instead of deleting immediately (Issue #516).
 *
 * Issue #281: /profile page data source (GET)
 * Issue #516: Account deletion with 30-day grace period (DELETE)
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import pool from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { withErrorHandler, withCsrf } from "@/server/middleware";
import { getPreferences } from "@/server/services/notification-preferences.service";
import { scheduleAccountDeletion } from "@/server/services/privacy.service";
import { AppError } from "@/server/errors";
import type { ApiResponse } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserProfile {
  id: string;
  phone: string;
  displayName: string | null;
  email?: string | null;
}

interface UserMeResponse {
  user: UserProfile;
  notificationPreferences: Array<{
    channel: "sms" | "email" | "push";
    category: "security" | "lifecycle" | "marketing";
    enabled: boolean;
  }>;
}

// ─── Validation schemas ───────────────────────────────────────────────────────

const deleteSchema = z.object({
  confirmOtp: z.string().regex(/^\d{6}$/, "Enter the 6-digit confirmation code"),
});

// ─── GET ──────────────────────────────────────────────────────────────────────

export const GET = withErrorHandler(async (_req: NextRequest) => {
  const session = await getServerSession(authOptions);
  const user = session?.user as { id?: string; phone?: string } | undefined;

  if (!user?.id) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  // Fetch user row
  const userResult = await pool.query<{
    id: string;
    phone: string;
    name: string | null;
    email: string | null;
  }>("SELECT id, phone, name, email FROM users WHERE id = $1 AND deleted_at IS NULL", [user.id]);

  if (userResult.rows.length === 0) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "User not found", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  const row = userResult.rows[0];

  // Fetch notification preferences (lazily seeds defaults if missing)
  const prefs = await getPreferences(user.id);

  return NextResponse.json<ApiResponse<UserMeResponse>>({
    success: true,
    data: {
      user: {
        id: row.id,
        phone: row.phone,
        displayName: row.name,
        email: row.email,
      },
      notificationPreferences: prefs.preferences,
    },
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

export const DELETE = withErrorHandler(
  withCsrf(async (req: NextRequest) => {
    const session = await getServerSession(authOptions);
    const sessionUser = session?.user as { id?: string; phone?: string } | undefined;

    if (!sessionUser?.id || !sessionUser.phone) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    const userId = sessionUser.id;
    const phone = sessionUser.phone;

    // ── Parse and validate body ──────────────────────────────────────────
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Invalid JSON body", code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: parsed.error.issues[0].message, code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    const { confirmOtp } = parsed.data;

    // ── Schedule deletion with a 30-day grace period (Issue #516) ─────────
    // scheduleAccountDeletion re-verifies the OTP, rejects while active
    // gifts are in flight, and emails/SMSes a reactivation link.
    try {
      const { scheduledDeletionAt } = await scheduleAccountDeletion(
        {
          userId,
          phone,
          ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim(),
          userAgent: req.headers.get("user-agent") ?? undefined,
        },
        confirmOtp
      );

      return NextResponse.json<ApiResponse<{ scheduledDeletionAt: string }>>({
        success: true,
        data: { scheduledDeletionAt },
      });
    } catch (err) {
      if (err instanceof AppError) {
        return NextResponse.json<ApiResponse<never>>(
          { success: false, error: err.message, code: err.code },
          { status: err.httpStatus }
        );
      }
      throw err;
    }
  })
);
