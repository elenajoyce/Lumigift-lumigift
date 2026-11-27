/**
 * POST /api/v1/users/me/deletion/cancel
 *
 * Issue #516: cancels a pending account deletion within the 30-day grace
 * period using the single-use token emailed/SMS-ed at request time. No
 * session is required — the token itself is the credential, mirroring the
 * existing invitation/reset-link pattern — but it is single-use and
 * unguessable (UUID v4).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withErrorHandler } from "@/server/middleware";
import { cancelAccountDeletion } from "@/server/services/privacy.service";
import type { ApiResponse } from "@/types";

const bodySchema = z.object({
  token: z.string().uuid("Invalid or expired cancellation token"),
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Invalid JSON body", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: parsed.error.issues[0].message, code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const result = await cancelAccountDeletion(parsed.data.token);
  if (!result) {
    return NextResponse.json<ApiResponse<never>>(
      {
        success: false,
        error: "This cancellation link is invalid or has already been used.",
        code: "NOT_FOUND",
      },
      { status: 404 }
    );
  }

  return NextResponse.json<ApiResponse<{ cancelled: true }>>({
    success: true,
    data: { cancelled: true },
  });
});
