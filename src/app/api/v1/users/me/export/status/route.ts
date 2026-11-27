import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { withErrorHandler } from "@/server/middleware";
import { getRedisClient } from "@/lib/redis";
import type { ApiResponse } from "@/types";

/**
 * GET /api/v1/users/me/export/status?jobId=…
 *
 * Issue #515: polling endpoint for a data-export job started via
 * GET /api/v1/users/me/export. Returns `pending | ready | expired`.
 * Jobs in this codebase complete synchronously, so the only states a
 * caller actually observes are `ready` (job key present in Redis) and
 * `expired` (TTL elapsed or token unknown).
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const session = await getServerSession(authOptions);
  const user = session?.user as { id?: string } | undefined;
  if (!user?.id) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "jobId required", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const redis = await getRedisClient();
  const raw = await redis.get(`data-export:${user.id}:${jobId}`);

  const status: "pending" | "ready" | "expired" = raw ? "ready" : "expired";

  const res = NextResponse.json<ApiResponse<{ status: "pending" | "ready" | "expired" }>>({
    success: true,
    data: { status },
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
});
