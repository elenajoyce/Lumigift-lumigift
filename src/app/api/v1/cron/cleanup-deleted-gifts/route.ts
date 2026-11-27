import { NextRequest, NextResponse } from "next/server";
import { cleanupExpiredSoftDeletedGifts } from "@/server/services/gift.db";
import { recordCronSuccess, recordCronFailure, recordDeadLetter } from "@/lib/metrics";
import type { ApiResponse } from "@/types";
import { isAuthorizedCronRequest } from "@/server/cron-auth";

/**
 * GET /api/v1/cron/cleanup-deleted-gifts
 *
 * Issue #506: Soft-delete cleanup cron job for expired gift records.
 *
 * Runs daily. `gifts` rows are never physically deleted (see
 * migrations/0008_soft_delete_gifts.sql — a DB rule turns DELETE into a
 * no-op for audit/refund reasons), so this job scrubs PII (recipient
 * name, message, media) on gifts that have been soft-deleted for more
 * than the retention window, leaving the audit-relevant record intact.
 */
export const GET = async (req: NextRequest) => {
  const authHeader = req.headers.get("authorization");
  if (!isAuthorizedCronRequest(authHeader)) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const startedAt = new Date();
  console.log("[cron/cleanup-deleted-gifts] run started", { startedAt });

  try {
    const retentionDays = Number(process.env.SOFT_DELETE_RETENTION_DAYS ?? 90);
    const scrubbed = await cleanupExpiredSoftDeletedGifts(retentionDays);
    const durationMs = Date.now() - startedAt.getTime();

    console.log("[cron/cleanup-deleted-gifts] run complete", { durationMs, scrubbed });
    recordCronSuccess("cron/v1/cleanup-deleted-gifts", durationMs);

    return NextResponse.json<ApiResponse<{ message: string; scrubbed: number; durationMs: number }>>(
      {
        success: true,
        data: { message: "Soft-delete cleanup complete", scrubbed, durationMs },
      }
    );
  } catch (err) {
    const durationMs = Date.now() - startedAt.getTime();
    console.error("[cron/cleanup-deleted-gifts] run failed", { startedAt, error: err });
    recordCronFailure("cron/v1/cleanup-deleted-gifts", durationMs, err);
    await recordDeadLetter("cron/v1/cleanup-deleted-gifts", durationMs, err);
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Soft-delete cleanup job failed" },
      { status: 500 }
    );
  }
};
