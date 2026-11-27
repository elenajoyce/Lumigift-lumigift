/**
 * GET /api/v1/transactions
 *
 * Returns a paginated transaction history (gifts sent + associated payments)
 * for the authenticated user.
 *
 * Query params:
 *   cursor — opaque pagination cursor from a previous response's `nextCursor`
 *   limit  — items per page (default: 20, max: 50)
 *   status — optional filter by gift status
 *
 * Response includes `nextCursor` (null when there are no further pages) and
 * `hasMore`. Cursor-based (keyset) pagination avoids the OFFSET cost blowup
 * that a plain page-number scheme hits for users with long transaction
 * history (issue #511).
 *
 * Issue #150 — Transaction history & downloadable receipts.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { withAuth, withErrorHandler } from "@/server/middleware";
import { setPrivateNoStore } from "@/lib/cache";
import {
  getTransactionHistoryByCursor,
  type CursorTransactionPage,
} from "@/server/services/transaction-history.service";
import type { ApiResponse } from "@/types";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

export const GET = withErrorHandler(
  withAuth(async (req: NextRequest) => {
    const session = await getServerSession(authOptions);
    const userId = (session!.user as { id: string }).id;

    const { searchParams } = req.nextUrl;

    const cursor = searchParams.get("cursor") ?? undefined;
    const rawLimit = parseInt(searchParams.get("limit") ?? "", 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(MAX_LIMIT, rawLimit)
      : DEFAULT_LIMIT;
    const status = searchParams.get("status") ?? undefined;

    const result = await getTransactionHistoryByCursor(userId, { cursor, limit, status });

    // User-specific transaction data must never be cached in shared caches
    return setPrivateNoStore(
      NextResponse.json<ApiResponse<CursorTransactionPage>>({ success: true, data: result })
    );
  })
);
