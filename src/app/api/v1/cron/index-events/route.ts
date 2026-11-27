import { NextRequest, NextResponse } from "next/server";
import { indexEscrowEvents } from "@/server/services/event-indexer.service";
import {
  recordCronSuccess,
  recordCronFailure,
  recordDeadLetter,
} from "@/lib/metrics";
import type { ApiResponse } from "@/types";
import { isAuthorizedCronRequest } from "@/server/cron-auth";
import { withErrorHandler } from "@/server/middleware";
import { requestLogger, getCorrelationId } from "@/lib/logger";

/**
 * GET /api/v1/cron/index-events
 *
 * Cron endpoint — indexes Soroban escrow contract events and syncs gift status.
 *
 * Called by Vercel Cron every 5 minutes (see vercel.json).
 * Protected by the same CRON_SECRET bearer token used by other cron routes.
 *
 * Dead-man's-switch: pings HEALTHCHECK_URL_INDEX_EVENTS (or HEALTHCHECK_URL) on
 * success so operators are alerted when the cron stops firing.
 *
 * Wrapped with `withErrorHandler` so every response carries a
 * request/correlation ID and is logged against it (#509).
 */

/** Ping a dead-man's-switch URL (e.g. Healthchecks.io / BetterUptime). */
async function pingHealthcheck(suffix = "") {
  const url = process.env.HEALTHCHECK_URL_INDEX_EVENTS ?? process.env.HEALTHCHECK_URL;
  if (!url) return;
  try {
    await fetch(`${url}${suffix}`, { method: "GET" });
  } catch (err) {
    console.error("[cron/index-events] healthcheck ping failed", err);
  }
}

export const GET = withErrorHandler(async (req: NextRequest) => {
  const authHeader = req.headers.get("authorization");
  const log = requestLogger(getCorrelationId(req.headers));
  if (!isAuthorizedCronRequest(authHeader)) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const startedAt = Date.now();
  log.info({ startedAt: new Date(startedAt).toISOString() }, "[cron/index-events] run started");

  try {
    const result = await indexEscrowEvents();
    const durationMs = Date.now() - startedAt;

    log.info({ ...result, durationMs }, "[cron/index-events] run complete");

    await pingCronHealthcheck("index-events"); // success ping

    return NextResponse.json<
      ApiResponse<{ processed: number; skipped: number; latestCursor: string; durationMs: number }>
    >({
      success: true,
      data: { ...result, durationMs },
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    log.error({ err, durationMs }, "[cron/index-events] run failed");
    recordCronFailure("cron/v1/index-events", durationMs, err);
    await recordDeadLetter("cron/v1/index-events", durationMs, err);
    await pingCronHealthcheck("index-events", "/fail"); // failure ping
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Event indexing failed" },
      { status: 500 }
    );
  }
});
