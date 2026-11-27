/**
 * gift.db.ts — Database-transactional gift persistence layer
 *
 * Issue #55: Ensure gift row, payment reference, and initial status are written
 * atomically so a partial failure never leaves orphaned records.
 *
 * All public functions here use a single PostgreSQL client acquired from the
 * connection pool, wrap their writes in BEGIN/COMMIT, and roll back on any
 * error so the database is always left in a consistent state.
 *
 * Callers (gift.service.ts) call persistGiftWithPaymentRef() instead of
 * writing directly to the in-memory Map for anything that touches real data.
 */

import { randomUUID } from "crypto";
import pool, { readPool } from "@/lib/db";
import type { Gift, GiftStatus } from "@/types";

// ─── SQL safety ───────────────────────────────────────────────────────────────

/**
 * Allowed gift lifecycle values. Every raw SQL statement in this module is
 * already fully parameterised ($1, $2, ...), but status values originate
 * from caller-supplied strings (TS types do not exist at runtime). This
 * whitelist is a defense-in-depth guard so a future caller can never smuggle
 * anything other than a known status token into a query parameter.
 */
const VALID_GIFT_STATUSES: readonly GiftStatus[] = [
  "draft",
  "pending_payment",
  "funded",
  "locked",
  "unlocked",
  "claimed",
  "expired_pending_refund",
  "expired",
  "cancelled",
];

function assertValidGiftStatus(status: string, label: string): void {
  if (!VALID_GIFT_STATUSES.includes(status as GiftStatus)) {
    throw new Error(`[gift.db] Invalid ${label}: ${JSON.stringify(status)}`);
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateGiftDbInput {
  id: string;
  senderId: string;
  recipientPhoneHash: string;
  recipientName: string;
  recipientEmail?: string;
  amountNgn: number;
  amountUsdc: string;
  message?: string;
  mediaUrl?: string;
  themeId?: string;
  unlockAt: Date;
  /** Payment provider used for this gift */
  provider?: "paystack" | "stripe";
  /** Provider-specific payment reference (e.g. Paystack reference) */
  paymentReference: string;
  /** Currency actually charged: "ngn" (Paystack) or "usd"/"gbp"/"eur" (Stripe). Issue #527. */
  paymentCurrency?: string;
  /** Amount charged in paymentCurrency major units, locked at order creation. Issue #527. */
  paymentAmount?: number;
}

export interface GiftDbRow {
  id: string;
  sender_id: string;
  recipient_phone_hash: string;
  recipient_name: string;
  recipient_email: string | null;
  amount_ngn: string;
  amount_usdc: string;
  message: string | null;
  media_url: string | null;
  theme_id?: string | null;
  unlock_at: Date;
  status: GiftStatus;
  contract_id: string | null;
  stellar_tx_hash: string | null;
  claim_tx_hash: string | null;
  payment_currency?: string | null;
  payment_amount?: string | null;
  created_at: Date;
  updated_at: Date;
}

// ─── Row → Domain mapper ──────────────────────────────────────────────────────

export function rowToGift(row: GiftDbRow): Gift {
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientPhoneHash: row.recipient_phone_hash,
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email ?? undefined,
    amountNgn: Number(row.amount_ngn),
    amountUsdc: row.amount_usdc,
    message: row.message ?? undefined,
    mediaUrl: row.media_url ?? undefined,
    themeId: row.theme_id ?? undefined,
    unlockAt: new Date(row.unlock_at),
    status: row.status,
    contractId: row.contract_id ?? undefined,
    stellarTxHash: row.stellar_tx_hash ?? undefined,
    claimTxHash: row.claim_tx_hash ?? undefined,
    paymentCurrency: row.payment_currency ?? undefined,
    paymentAmount: row.payment_amount != null ? Number(row.payment_amount) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Records the Stripe currency/amount locked for a gift after the
 * PaymentIntent is created (the exact minor-unit amount is only known once
 * the FX conversion runs, which happens after the initial insert). Issue #527.
 */
export async function recordPaymentCurrency(
  giftId: string,
  currency: string,
  amount: number
): Promise<void> {
  await pool.query("UPDATE gifts SET payment_currency = $1, payment_amount = $2 WHERE id = $3", [
    currency,
    amount,
    giftId,
  ]);
}

// ─── Transactional writes ─────────────────────────────────────────────────────

/**
 * Atomically inserts a gift row **and** a corresponding payment_references row
 * inside a single PostgreSQL transaction.
 *
 * If either INSERT fails the whole transaction is rolled back, so there is no
 * risk of a gift row without a payment record or vice versa.
 *
 * A failed side effect (invitation, email) that is called *after* this function
 * returns has no impact on the persisted gift/payment records — the DB is
 * already committed and the gift is safely retryable.
 *
 * @returns The persisted {@link Gift} domain object.
 * @throws If the transaction cannot be committed.
 */
export async function persistGiftWithPaymentRef(input: CreateGiftDbInput): Promise<Gift> {
  const paymentRefId = randomUUID();
  const provider = input.provider ?? "paystack";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Insert the gift row at status = 'pending_payment'
    const { rows } = await client.query<GiftDbRow>(
      `INSERT INTO gifts (
          id, sender_id, recipient_phone_hash, recipient_name, recipient_email,
          amount_ngn, amount_usdc, message, media_url, unlock_at,
          theme_id, payment_currency, payment_amount, status, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, 'pending_payment', NOW(), NOW()
        )
        RETURNING *`,
      [
        input.id,
        input.senderId,
        input.recipientPhoneHash,
        input.recipientName,
        input.recipientEmail ?? null,
        input.amountNgn,
        input.amountUsdc,
        input.message ?? null,
        input.mediaUrl ?? null,
        input.unlockAt,
        input.themeId ?? null,
        input.paymentCurrency ?? "ngn",
        input.paymentAmount ?? null,
      ]
    );

    // 2. Insert the payment reference row in the same transaction
    await client.query(
      `INSERT INTO payment_references (
          id, gift_id, provider, reference, status, amount_ngn, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, 'pending', $5, NOW(), NOW()
        )`,
      [paymentRefId, input.id, provider, input.paymentReference, input.amountNgn]
    );

    await client.query("COMMIT");

    return rowToGift(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[gift.db] persistGiftWithPaymentRef transaction rolled back", {
      giftId: input.id,
      err,
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Atomically transitions a gift's status and updates the associated
 * payment_references row, all inside a single transaction.
 *
 * A status guard (`AND status = $2`) prevents double-transitions:
 * if another process already moved the gift forward, the UPDATE returns 0 rows
 * and this call returns `null` (treated as a no-op by callers).
 *
 * @param id - Gift UUID.
 * @param fromStatus - The expected current status (optimistic lock guard).
 * @param toStatus - The desired target status.
 * @param paymentStatus - Optional payment_references status update.
 * @returns The updated {@link Gift}, or `null` if the guard failed.
 */
export async function transitionGiftStatus(
  id: string,
  fromStatus: GiftStatus,
  toStatus: GiftStatus,
  paymentStatus?: "success" | "failed" | "refunded"
): Promise<Gift | null> {
  assertValidGiftStatus(fromStatus, "fromStatus");
  assertValidGiftStatus(toStatus, "toStatus");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Status-guarded UPDATE — no-op if the gift is already in a different state
    const { rows } = await client.query<GiftDbRow>(
      `UPDATE gifts
          SET status = $1, updated_at = NOW()
        WHERE id = $2
          AND status = $3
        RETURNING *`,
      [toStatus, id, fromStatus]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }

    if (paymentStatus) {
      await client.query(
        `UPDATE payment_references
            SET status = $1, updated_at = NOW()
          WHERE gift_id = $2`,
        [paymentStatus, id]
      );
    }

    await client.query("COMMIT");
    return rowToGift(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[gift.db] transitionGiftStatus transaction rolled back", { id, err });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Looks up a gift row by ID.
 *
 * @param id - Gift UUID.
 * @returns The {@link Gift} domain object, or `null` if not found.
 */
export async function findGiftById(id: string): Promise<Gift | null> {
  const { rows } = await pool.query<GiftDbRow>(`SELECT * FROM gifts WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] ? rowToGift(rows[0]) : null;
}

/**
 * Looks up all gifts for a given sender, newest first.
 *
 * @param senderId - User ID of the sender.
 * @returns Array of {@link Gift} domain objects (may be empty).
 */
export async function findGiftsBySender(senderId: string): Promise<Gift[]> {
  // Uses idx_gifts_sender_created (migration 0010) for the sender_id filter + created_at ordering.
  const { rows } = await readPool.query<GiftDbRow>(
    `SELECT * FROM gifts WHERE sender_id = $1 ORDER BY created_at DESC`,
    [senderId]
  );
  return rows.map(rowToGift);
}

/**
 * Looks up all gifts for a given sender filtered by status, newest first.
 *
 * Backs the dashboard gift list; benefits from the composite
 * `(sender_id, status)` index added in migration 0010.
 *
 * @param senderId - User ID of the sender.
 * @param status - Gift status to filter on.
 * @returns Array of {@link Gift} domain objects (may be empty).
 */
export async function findGiftsBySenderAndStatus(
  senderId: string,
  status: GiftStatus
): Promise<Gift[]> {
  // Uses idx_gifts_sender_status_created (migration 0010) — composite (sender_id, status).
  const { rows } = await readPool.query<GiftDbRow>(
    `SELECT * FROM gifts WHERE sender_id = $1 AND status = $2 ORDER BY created_at DESC`,
    [senderId, status]
  );
  return rows.map(rowToGift);
}

/**
 * Looks up all locked gifts whose unlock time has passed, oldest unlock first.
 *
 * Used by the unlock scheduler; benefits from the composite
 * `(unlock_at, status)` index added in migration 0010.
 *
 * @param now - Reference timestamp (defaults to the current time).
 * @returns Array of {@link Gift} domain objects (may be empty).
 */
export async function findGiftsDueForUnlock(now: Date = new Date()): Promise<Gift[]> {
  // Uses idx_gifts_unlock_at_status (migration 0010) — composite (unlock_at, status).
  const { rows } = await readPool.query<GiftDbRow>(
    `SELECT * FROM gifts WHERE unlock_at <= $1 AND status = 'locked' ORDER BY unlock_at ASC`,
    [now]
  );
  return rows.map(rowToGift);
}

/**
 * Looks up all gifts where the recipient's phone hash matches.
 *
 * @param recipientPhoneHash - SHA-256 hash of the E.164 phone number.
 * @returns Array of {@link Gift} domain objects (may be empty).
 */
export async function findGiftsByRecipientHash(recipientPhoneHash: string): Promise<Gift[]> {
  const { rows } = await readPool.query<GiftDbRow>(
    `SELECT * FROM gifts WHERE recipient_phone_hash = $1 ORDER BY created_at DESC`,
    [recipientPhoneHash]
  );
  return rows.map(rowToGift);
}

/**
 * Looks up a gift row by its on-chain contract ID.
 *
 * @param contractId - Soroban contract ID associated with the gift.
 * @returns The {@link Gift} domain object, or `null` if not found.
 */
export async function findGiftByContractId(contractId: string): Promise<Gift | null> {
  const { rows } = await readPool.query<GiftDbRow>(
    `SELECT * FROM gifts WHERE contract_id = $1 LIMIT 1`,
    [contractId]
  );
  return rows[0] ? rowToGift(rows[0]) : null;
}

/**
 * Sums the NGN amount of all gifts created by a sender since a given date.
 *
 * Used to enforce daily creation limits without relying on in-memory state.
 *
 * @param senderId - User ID of the sender.
 * @param since - Lower bound (inclusive) on `created_at`.
 * @returns Total amount in NGN (0 when no rows match).
 */
export async function sumGiftAmountNgnBySenderSince(senderId: string, since: Date): Promise<number> {
  const { rows } = await readPool.query<{ total: string | null }>(
    `SELECT COALESCE(SUM(amount_ngn), 0) AS total
       FROM gifts
      WHERE sender_id = $1
        AND created_at >= $2`,
    [senderId, since]
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Records the claim transaction hash for a gift.
 *
 * @param id - Gift UUID.
 * @param claimTxHash - Stellar transaction hash of the claim.
 * @returns The updated {@link Gift}, or `null` if the gift does not exist.
 */
export async function updateGiftClaimTxHash(id: string, claimTxHash: string): Promise<Gift | null> {
  const { rows } = await pool.query<GiftDbRow>(
    `UPDATE gifts
        SET claim_tx_hash = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *`,
    [claimTxHash, id]
  );
  return rows[0] ? rowToGift(rows[0]) : null;
}

/**
 * Soft-deletes a gift by stamping `deleted_at`.
 *
 * @param id - Gift UUID.
 * @returns `true` if a row was updated, `false` if the gift was not found.
 */
export async function softDeleteGift(id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE gifts
        SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1
        AND deleted_at IS NULL`,
    [id]
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Hard-deletes gifts that were soft-deleted before the given cutoff.
 *
 * @param olderThan - Only rows with `deleted_at < olderThan` are removed.
 * @returns Number of rows deleted.
 */
export async function purgeSoftDeletedGifts(olderThan: Date): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM gifts
      WHERE deleted_at IS NOT NULL
        AND deleted_at < $1`,
    [olderThan]
  );
  return rowCount ?? 0;
}

export interface FindGiftsBySenderOptions {
  /** Maximum number of rows to return (defaults to 20). */
  limit?: number;
  /** Filter by gift status. */
  status?: GiftStatus;
}

export interface GiftPage {
  gifts: Gift[];
  /** Cursor to pass as `cursor` for the next page, or `null` when exhausted. */
  nextCursor: string | null;
}

/**
 * Cursor-paginated lookup of a sender's gifts, newest first.
 *
 * The cursor is the `created_at` timestamp of the last row of the previous
 * page (ISO string). Rows sharing the same timestamp are disambiguated by id.
 *
 * @param senderId - User ID of the sender.
 * @param options - Pagination and filter options.
 * @param cursor - Opaque cursor from a previous {@link GiftPage}.
 * @returns A page of gifts plus the cursor for the next page.
 */
export async function findGiftsBySenderCursor(
  senderId: string,
  options: FindGiftsBySenderOptions = {},
  cursor?: string | null
): Promise<GiftPage> {
  const limit = options.limit ?? 20;
  const params: unknown[] = [senderId];
  const conditions: string[] = ["sender_id = $1", "deleted_at IS NULL"];

  if (options.status) {
    params.push(options.status);
    conditions.push(`status = $${params.length}`);
  }

  if (cursor) {
    const cursorDate = new Date(cursor);
    params.push(cursorDate);
    conditions.push(`created_at < $${params.length}`);
  }

  params.push(limit + 1);

  const { rows } = await readPool.query<GiftDbRow>(
    `SELECT * FROM gifts
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params
  );

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];

  return {
    gifts: pageRows.map(rowToGift),
    nextCursor: hasMore && last ? new Date(last.created_at).toISOString() : null,
  };
}

/**
 * Offset-paginated lookup of a sender's gifts, newest first.
 *
 * @param senderId - User ID of the sender.
 * @param options - Pagination and filter options.
 * @param offset - Number of rows to skip (defaults to 0).
 * @returns A page of gifts plus the total row count for the filter.
 */
export async function findGiftsBySenderOffset(
  senderId: string,
  options: FindGiftsBySenderOptions = {},
  offset = 0
): Promise<{ gifts: Gift[]; total: number }> {
  const limit = options.limit ?? 20;
  const params: unknown[] = [senderId];
  const conditions: string[] = ["sender_id = $1", "deleted_at IS NULL"];

  if (options.status) {
    params.push(options.status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.join(" AND ");

  const countResult = await readPool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM gifts WHERE ${where}`,
    params
  );

  const pageParams = [...params, limit, offset];
  const { rows } = await readPool.query<GiftDbRow>(
    `SELECT * FROM gifts
      WHERE ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
    pageParams
  );

  return {
    gifts: rows.map(rowToGift),
    total: Number(countResult.rows[0]?.count ?? 0),
  };
}
