import { randomUUID } from "crypto";
import pool from "@/lib/db";
import { verifyOtp } from "@/lib/otp";
import { AppError } from "@/server/errors";
import { createAuditLog } from "./audit.service";
import {
  getGiftsBySender,
  getGiftsByRecipient,
  hashPhone,
  redactGiftsForErasedSender,
} from "./gift.service";
import { getTransactionHistory } from "./transaction-history.service";
import { serverConfig } from "@/server/config";
import { sendNotification, NotificationChannel } from "./notification.service";
import type { Gift, GiftStatus } from "@/types";

/**
 * Data subject access (export) and erasure (deletion) workflows — Issue #145.
 *
 * Both workflows:
 *  - run only for the authenticated user, on their own data;
 *  - are recorded in `data_subject_requests` *and* the append-only `audit_logs`;
 *  - keep the financial records we are legally required to retain.
 *
 * Retention exceptions are documented in
 * docs/security/data-retention-and-subject-access.md.
 */

export interface RequestContext {
  userId: string;
  phone: string;
  ipAddress?: string;
  userAgent?: string;
}

/** Sender-side statuses that still have money in flight — erasure must wait. */
const ACTIVE_GIFT_STATUSES: ReadonlySet<GiftStatus> = new Set<GiftStatus>([
  "pending_payment",
  "funded",
  "locked",
  "unlocked",
]);

export const EXPORT_FORMAT_VERSION = "1";

export interface DataExport {
  formatVersion: string;
  generatedAt: string;
  profile: Record<string, unknown> | null;
  notificationPreferences: Record<string, unknown>[];
  knownDevices: Record<string, unknown>[];
  giftsSent: Gift[];
  giftsReceived: Omit<Gift, "recipientPhoneHash" | "senderId">[];
  transactions: Record<string, unknown>[];
  auditTrail: Record<string, unknown>[];
  dataSubjectRequests: Record<string, unknown>[];
}

async function recordRequest(
  ctx: RequestContext,
  requestType: "export" | "deletion",
  status: "completed" | "rejected",
  reason?: string
): Promise<void> {
  await pool.query(
    "INSERT INTO data_subject_requests (user_id, request_type, status, reason, ip_address, user_agent, completed_at) VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $3 = 'completed' THEN NOW() END)",
    [ctx.userId, requestType, status, reason ?? null, ctx.ipAddress ?? null, ctx.userAgent ?? null]
  );
}

/**
 * Builds a machine-readable export of everything we hold about the user.
 * Gifts received are projected without the sender's ID so the export never
 * discloses another person's identifiers.
 */
export async function exportUserData(ctx: RequestContext): Promise<DataExport> {
  const [profile, prefs, devices, audit, requests, transactions] = await Promise.all([
    pool.query(
      "SELECT id, phone, name, role, created_at, updated_at FROM users WHERE id = $1 AND deleted_at IS NULL",
      [ctx.userId]
    ),
    pool.query(
      "SELECT channel, category, enabled, updated_at FROM user_notification_preferences WHERE user_id = $1",
      [ctx.userId]
    ),
    pool.query(
      "SELECT fingerprint, last_seen_at, created_at FROM known_devices WHERE user_id = $1",
      [ctx.userId]
    ),
    pool.query(
      "SELECT event_type, gift_id, amount_ngn, amount_usdc, timestamp, metadata FROM audit_logs WHERE user_id = $1 ORDER BY timestamp DESC",
      [ctx.userId]
    ),
    pool.query(
      "SELECT request_type, status, reason, requested_at, completed_at FROM data_subject_requests WHERE user_id = $1 ORDER BY requested_at DESC",
      [ctx.userId]
    ),
    getTransactionHistory(ctx.userId, { limit: 100 }).then(
      (page) => page.items
    ),
  ]);

  const giftsSent = await getGiftsBySender(ctx.userId);
  const giftsReceived = (await getGiftsByRecipient(ctx.phone)).map(
    ({ recipientPhoneHash: _h, senderId: _s, ...rest }) => rest
  );

  await recordRequest(ctx, "export", "completed");
  await createAuditLog({
    eventType: "data_export_requested",
    userId: ctx.userId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    generatedAt: new Date().toISOString(),
    profile: profile.rows[0] ?? null,
    notificationPreferences: prefs.rows,
    knownDevices: devices.rows,
    giftsSent,
    giftsReceived,
    transactions,
    auditTrail: audit.rows,
    dataSubjectRequests: requests.rows,
  };
}

async function rejectDeletion(
  ctx: RequestContext,
  reason: string,
  error: AppError
): Promise<never> {
  await recordRequest(ctx, "deletion", "rejected", reason);
  await createAuditLog({
    eventType: "data_deletion_rejected",
    userId: ctx.userId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { reason },
  });
  throw error;
}

/**
 * Erases the user's personal data after re-verifying phone ownership with a
 * fresh OTP. Financial records are pseudonymised rather than deleted.
 *
 * @throws {@link AppError} `VERIFICATION_FAILED` (401) if the OTP is wrong.
 * @throws {@link AppError} `ACCOUNT_HAS_ACTIVE_GIFTS` (409) while any sent gift
 *   still has money in flight — the user must cancel or wait for it to settle.
 */
export async function deleteUserData(ctx: RequestContext, otp: string): Promise<void> {
  await createAuditLog({
    eventType: "data_deletion_requested",
    userId: ctx.userId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  const verification = await verifyOtp(ctx.phone, otp);
  if (!verification.success) {
    await rejectDeletion(
      ctx,
      "verification_failed",
      new AppError("VERIFICATION_FAILED", "We couldn't verify that code. Please try again.", 401)
    );
  }

  const active = (await getGiftsBySender(ctx.userId)).filter((g) =>
    ACTIVE_GIFT_STATUSES.has(g.status)
  );
  if (active.length > 0) {
    await rejectDeletion(
      ctx,
      "active_gifts",
      new AppError(
        "ACCOUNT_HAS_ACTIVE_GIFTS",
        `You have ${active.length} gift(s) still in progress. Cancel them or wait until they are claimed before deleting your account.`,
        409
      )
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM user_notification_preferences WHERE user_id = $1", [
      ctx.userId,
    ]);
    await client.query("DELETE FROM known_devices WHERE user_id = $1", [ctx.userId]);
    await client.query("DELETE FROM suspicious_login_reports WHERE user_id = $1", [ctx.userId]);
    // Plaintext phone on invitations addressed to this user; the hash stays for audit.
    await client.query(
      "UPDATE gift_invitations SET recipient_phone = '[redacted]' WHERE recipient_phone_hash = $1",
      [hashPhone(ctx.phone)]
    );
    // Overwrite PII but keep the row so gifts/payments/audit logs stay linked.
    await client.query(
      "UPDATE users SET phone = 'deleted:' || id, name = 'Deleted user', deleted_at = NOW(), updated_at = NOW() WHERE id = $1",
      [ctx.userId]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const redactedGifts = await redactGiftsForErasedSender(ctx.userId);

  await recordRequest(ctx, "deletion", "completed");
  await createAuditLog({
    eventType: "data_deletion_completed",
    userId: ctx.userId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { redactedGifts },
  });
}

// ─── Grace-period account deletion (Issue #516) ───────────────────────────────

/** Statuses with money in flight — a scheduled deletion must wait for them. */
const DELETION_GRACE_PERIOD_DAYS = 30;

interface UserContactRow {
  id: string;
  phone: string;
  email: string | null;
}

/**
 * Initiates account deletion: sets `scheduled_deletion_at` 30 days out and
 * emails/SMSes a reactivation (cancel) link. No PII is touched yet — the
 * permanent purge happens in {@link purgeExpiredAccountDeletions} once the
 * grace period elapses. Re-verifies phone ownership via a fresh OTP first.
 *
 * @throws {@link AppError} `VERIFICATION_FAILED` (401) if the OTP is wrong.
 * @throws {@link AppError} `ACCOUNT_HAS_ACTIVE_GIFTS` (409) while any sent gift
 *   still has money in flight.
 */
export async function scheduleAccountDeletion(
  ctx: RequestContext,
  otp: string
): Promise<{ scheduledDeletionAt: string }> {
  await createAuditLog({
    eventType: "data_deletion_requested",
    userId: ctx.userId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  const verification = await verifyOtp(ctx.phone, otp);
  if (!verification.success) {
    await rejectDeletion(
      ctx,
      "verification_failed",
      new AppError("VERIFICATION_FAILED", "We couldn't verify that code. Please try again.", 401)
    );
  }

  const active = (await getGiftsBySender(ctx.userId)).filter((g) =>
    ACTIVE_GIFT_STATUSES.has(g.status)
  );
  if (active.length > 0) {
    await rejectDeletion(
      ctx,
      "active_gifts",
      new AppError(
        "ACCOUNT_HAS_ACTIVE_GIFTS",
        `You have ${active.length} gift(s) still in progress. Cancel them or wait until they are claimed before deleting your account.`,
        409
      )
    );
  }

  const scheduledDeletionAt = new Date(
    Date.now() + DELETION_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
  );
  const cancelToken = randomUUID();

  const { rows } = await pool.query<UserContactRow>(
    `UPDATE users
     SET scheduled_deletion_at = $1, deletion_cancel_token = $2, updated_at = NOW()
     WHERE id = $3 AND deleted_at IS NULL
     RETURNING id, phone, email`,
    [scheduledDeletionAt.toISOString(), cancelToken, ctx.userId]
  );

  if (rows.length === 0) {
    throw new AppError("NOT_FOUND", "User not found", 404);
  }

  const cancelUrl = `${serverConfig.app.url}/account/deletion/cancel?token=${cancelToken}`;
  const contact = rows[0];

  if (contact.email) {
    await sendNotification(
      NotificationChannel.Email,
      { type: "account_deletion_scheduled", to: contact.email, cancelUrl },
      { dedupKey: `account-deletion:email:${cancelToken}` }
    );
  } else {
    await sendNotification(
      NotificationChannel.Sms,
      { type: "account_deletion_scheduled", phone: contact.phone, cancelUrl },
      { dedupKey: `account-deletion:sms:${cancelToken}` }
    );
  }

  await recordRequest(ctx, "deletion", "completed", "grace_period_scheduled");
  await createAuditLog({
    eventType: "data_deletion_completed",
    userId: ctx.userId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { scheduledDeletionAt: scheduledDeletionAt.toISOString(), status: "pending_grace_period" },
  });

  return { scheduledDeletionAt: scheduledDeletionAt.toISOString() };
}

/**
 * Cancels a pending account deletion via the single-use token issued by
 * {@link scheduleAccountDeletion}. Clears `scheduled_deletion_at` so the
 * purge job skips this account.
 */
export async function cancelAccountDeletion(token: string): Promise<{ userId: string } | null> {
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE users
     SET scheduled_deletion_at = NULL, deletion_cancel_token = NULL, updated_at = NOW()
     WHERE deletion_cancel_token = $1 AND deleted_at IS NULL
     RETURNING id`,
    [token]
  );
  if (rows.length === 0) return null;

  const userId = rows[0].id;
  await createAuditLog({ eventType: "data_deletion_rejected", userId, metadata: { reason: "cancelled_by_user" } });
  return { userId };
}

/**
 * Cron entry point: permanently anonymises every account whose grace period
 * has elapsed. Reuses the same PII-overwrite + cascading redaction logic as
 * the original immediate-deletion flow, so financial records stay linked
 * but personal identifiers are gone.
 */
export async function purgeExpiredAccountDeletions(): Promise<{ purged: number }> {
  const { rows } = await pool.query<{ id: string; phone: string }>(
    `SELECT id, phone FROM users
     WHERE scheduled_deletion_at IS NOT NULL
       AND scheduled_deletion_at <= NOW()
       AND deleted_at IS NULL`
  );

  let purged = 0;
  for (const row of rows) {
    try {
      await purgeOneAccount(row.id, row.phone);
      purged++;
    } catch (err) {
      console.error(`[privacy] failed to purge account ${row.id}:`, (err as Error).message);
    }
  }
  return { purged };
}

async function purgeOneAccount(userId: string, phone: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM user_notification_preferences WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM known_devices WHERE user_id = $1", [userId]);
    await client.query(
      "UPDATE gift_invitations SET recipient_phone = '[redacted]' WHERE recipient_phone_hash = $1",
      [hashPhone(phone)]
    );
    await client.query(
      `UPDATE users
       SET phone = 'deleted:' || id, name = 'Deleted user', email = NULL,
           scheduled_deletion_at = NULL, deletion_cancel_token = NULL,
           deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const redactedGifts = await redactGiftsForErasedSender(userId);
  await createAuditLog({
    eventType: "data_deletion_completed",
    userId,
    metadata: { redactedGifts, status: "purged" },
  });
}
