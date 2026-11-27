import { NextRequest, NextResponse } from "next/server";
import { processUnlocks } from "@/server/services/scheduler.service";
import { startTimer, recordCronSuccess, recordCronFailure } from "@/lib/metrics";
import type { ApiResponse } from "@/types";
import { isAuthorizedCronRequest } from "@/server/cron-auth";
import { withErrorHandler } from "@/server/middleware";
import { requestLogger, getCorrelationId } from "@/lib/logger";

/**
 * GET /api/cron/unlock
 *
 * Triggered by Vercel Cron (or any scheduler) to unlock gifts whose
 * `unlockAt` timestamp has passed.
 *
 * Authentication: Bearer token checked against CRON_SECRET env var.
 * Wrapped with `withErrorHandler` so every response (success or failure)
 * carries a request/correlation ID and is logged against it (#509).
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const authHeader = req.headers.get("authorization");
  const log = requestLogger(getCorrelationId(req.headers));

  if (!isAuthorizedCronRequest(authHeader)) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const elapsed = startTimer();

  try {
    const unlocked = await processUnlocks();
    const durationMs = elapsed();

    recordCronSuccess("cron/unlock", durationMs, { unlocked });
    log.info({ unlocked, durationMs }, "[cron/unlock] run complete");

    // Ping only after the job has completed successfully.
    await pingCronHealthcheck("cron/unlock", { status: "success" });

    return NextResponse.json<ApiResponse<{ unlocked: number }>>({
      success: true,
      data: { unlocked },
    });
  } catch (err) {
    const durationMs = elapsed();
    recordCronFailure("cron/unlock", durationMs, err);
    log.error({ err, durationMs }, "[cron/unlock] run failed");
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Cron job failed" },
      { status: 500 }
    );
  }
});
