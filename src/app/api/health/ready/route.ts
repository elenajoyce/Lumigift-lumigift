import { NextResponse } from "next/server";
import pool, { getPoolMetrics } from "@/lib/db";
import { getRedisClient } from "@/lib/redis";
import { serverConfig } from "@/server/config";

/**
 * Readiness probe — checks all dependencies before accepting traffic.
 * GET /api/health/ready
 *
 * Returns 200 when all checks pass; 503 when any dependency is degraded.
 *
 * Response shape:
 *   {
 *     status: "ok" | "degraded",
 *     timestamp: string,
 *     checks: { db: "ok"|"error", redis: "ok"|"error", horizon: "ok"|"error" },
 *     metrics: {
 *       db: { total, idle, waiting, min, max, idleTimeoutMs, connectionTimeoutMs },
 *       redis: { ... }
 *     }
 *   }
 *
 * Security: check status values are "ok" | "error" only — no connection
 * strings, stack traces, or internal details are ever returned.
 */
export async function GET() {
  const [postgres, redis, horizon] = await Promise.all([
    checkDb(),
    checkRedis(),
    checkHorizon(serverConfig.stellar.horizonUrl),
  ]);

  // Pool metrics are always included so operators can detect exhaustion
  const poolMetrics = getPoolMetrics();

  // Treat a fully saturated pool (no idle connections and requests queued)
  // as unready — the DB probe above can still succeed even when the pool
  // has no spare capacity to serve new requests.
  const poolExhausted = poolMetrics.waiting > 0 && poolMetrics.idle === 0;
  const dbCheck = postgres === "ok" && poolExhausted ? "error" : postgres;

  const checks = { db: dbCheck, redis, horizon };
  const degraded = Object.values(checks).some((s) => s === "error");
  const status = degraded ? "degraded" : "ok";

  return NextResponse.json(
    {
      status,
      timestamp: new Date().toISOString(),
      checks,
      metrics: { db: poolMetrics },
    },
    { status: degraded ? 503 : 200 }
  );
}

async function checkDb(): Promise<"ok" | "error"> {
  try {
    await pool.query("SELECT 1");
    return "ok";
  } catch {
    return "error";
  }
}

/** Redis probe timeout — keeps the readiness probe from hanging. */
const REDIS_TIMEOUT_MS = 500;

async function checkRedis(): Promise<"ok" | "error"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Redis health check timed out")), REDIS_TIMEOUT_MS);
    });
    await Promise.race([getRedisClient().then((client) => client.ping()), timeout]);
    return "ok";
  } catch {
    return "error";
  } finally {
    clearTimeout(timer);
  }
}

async function checkHorizon(url: string): Promise<"ok" | "error"> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}
