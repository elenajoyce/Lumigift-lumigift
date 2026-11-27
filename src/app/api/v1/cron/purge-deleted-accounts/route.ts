import { NextRequest, NextResponse } from "next/server";
import { purgeExpiredAccountDeletions } from "@/server/services/privacy.service";
import { startTimer, recordCronSuccess, recordCronFailure } from "@/lib/metrics";
import type { ApiResponse } from "@/types";
import { isAuthorizedCronRequest } from "@/server/cron-auth";

/**
 * GET /api/cron/purge-deleted-accounts
 *
 * Issue #516: runs on a daily schedule to permanently anonymise every
 * account whose 30-day deletion grace period has elapsed. Gifts,
 * notifications, and audit logs are anonymised (not deleted) per the
 * retention policy — see docs/security/data-retention-and-subject-access.md.
 *
 * Authentication: Bearer token checked against CRON_SECRET env var.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");

  if (!isAuthorizedCronRequest(authHeader)) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const elapsed = startTimer();

  try {
    const { purged } = await purgeExpiredAccountDeletions();
    const durationMs = elapsed();

    recordCronSuccess("cron/purge-deleted-accounts", durationMs, { purged });

    return NextResponse.json<ApiResponse<{ purged: number }>>({
      success: true,
      data: { purged },
    });
  } catch (err) {
    const durationMs = elapsed();
    recordCronFailure("cron/purge-deleted-accounts", durationMs, err);
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Cron job failed" },
      { status: 500 }
    );
  }
}
