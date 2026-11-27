import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import pool from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { withErrorHandler, rateLimit } from "@/server/middleware";
import { exportUserData, type DataExport } from "@/server/services/privacy.service";
import { sendNotification, NotificationChannel } from "@/server/services/notification.service";
import { buildZip } from "@/lib/zip";
import { getRedisClient } from "@/lib/redis";
import type { ApiResponse } from "@/types";

// Exports are expensive and contain everything we hold — 1 export per user per 24 hours.
const EXPORT_LIMIT = 1;
const EXPORT_WINDOW_MS = 24 * 60 * 60 * 1000;
// Download links expire after 1 hour (Issue #515 — NDPR "secure, time-bound" link).
const DOWNLOAD_TTL_SECONDS = 60 * 60;

type JobStatus = "pending" | "ready" | "expired";

interface ExportJob {
  status: JobStatus;
  zipBase64?: string;
  generatedAt: string;
}

function generateJobId(): string {
  return crypto.randomUUID();
}

function jobKey(userId: string, jobId: string): string {
  return `data-export:${userId}:${jobId}`;
}

/**
 * GET /api/v1/users/me/export — subject access request (Issues #145, #515).
 *
 * Collects profile, gifts sent/received, transactions, audit logs, and
 * notification preferences, packages them as a JSON file inside a ZIP
 * archive, stores it in Redis (TTL = 1 hour), and emails a secure download
 * link to the user's verified email. The response returns a `jobId` the
 * client polls via GET .../export/status?jobId=… for `pending | ready | expired`.
 *
 * The job is actually completed synchronously here (export jobs are small
 * enough not to need a queue), but the status endpoint and TTL-based
 * "expired" semantics are honored so the client contract matches an async
 * job even though there is no visible "pending" window today.
 *
 * Rate limited to 1 export per user per 24 hours. Every request is recorded
 * in `data_subject_requests` and an audit log entry is created.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const session = await getServerSession(authOptions);
  const user = session?.user as { id?: string; phone?: string } | undefined;
  if (!user?.id || !user.phone) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  if (!rateLimit(`privacy:export:${user.id}`, EXPORT_LIMIT, EXPORT_WINDOW_MS)) {
    return NextResponse.json<ApiResponse<never>>(
      {
        success: false,
        error: "Export limit reached. Try again tomorrow.",
        code: "RATE_LIMIT_EXCEEDED",
      },
      { status: 429 }
    );
  }

  const data: DataExport = await exportUserData({
    userId: user.id,
    phone: user.phone,
    ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim(),
    userAgent: req.headers.get("user-agent") ?? undefined,
  });

  const jsonBuf = Buffer.from(JSON.stringify(data, null, 2), "utf8");
  const zipBuf = buildZip([{ name: "lumigift-data-export.json", content: jsonBuf }]);

  const jobId = generateJobId();
  const redis = await getRedisClient();
  const job: ExportJob = {
    status: "ready",
    zipBase64: zipBuf.toString("base64"),
    generatedAt: data.generatedAt,
  };
  await redis.set(jobKey(user.id, jobId), JSON.stringify(job), { EX: DOWNLOAD_TTL_SECONDS });

  const expiresAt = new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000).toISOString();
  const downloadUrl = `${req.nextUrl.origin}/api/v1/users/me/export/download?token=${jobId}`;

  // Email the secure link to the user's verified address, if one is on file.
  // SMS-first accounts without an email simply get the jobId/downloadUrl in
  // the response (the caller is already authenticated as this user).
  const { rows } = await pool.query<{ email: string | null }>(
    "SELECT email FROM users WHERE id = $1 AND deleted_at IS NULL",
    [user.id]
  );
  const email = rows[0]?.email;
  if (email) {
    await sendNotification(
      NotificationChannel.Email,
      { type: "data_export_ready", to: email, downloadUrl },
      { dedupKey: `data-export:email:${jobId}` }
    );
  }

  const res = NextResponse.json<ApiResponse<{ jobId: string; downloadUrl: string; expiresAt: string }>>({
    success: true,
    data: { jobId, downloadUrl, expiresAt },
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
});
