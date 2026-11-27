/**
 * GET /api/v1/business/bulk-gifts/:id/invoice — Download the PDF invoice for a bulk order
 *
 * Issue #345 — Business/corporate gifting tier.
 * Issue #514 — Implement business bulk-gift invoice PDF generation.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { withAuth, withErrorHandler, AppError, ERROR_CODES } from "@/server/middleware";
import {
  assertBusinessAccount,
  generateInvoicePdf,
  getBulkGiftOrder,
} from "@/server/services/business.service";

export const GET = withErrorHandler(
  withAuth(async (_req: NextRequest, context?: unknown) => {
    const session = await getServerSession(authOptions);
    const userId = (session!.user as { id: string }).id;
    await assertBusinessAccount(userId);

    const { id } = await (context as { params: Promise<{ id: string }> }).params;
    const order = await getBulkGiftOrder(userId, id);
    if (!order) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "Bulk order not found", 404);
    }

    // Only the account owner may download the invoice.
    const ownerId =
      (order as { ownerId?: string; userId?: string; accountId?: string }).ownerId ??
      (order as { ownerId?: string; userId?: string; accountId?: string }).userId ??
      (order as { ownerId?: string; userId?: string; accountId?: string }).accountId;
    if (ownerId && ownerId !== userId) {
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        "You are not authorized to download this invoice",
        403
      );
    }

    const pdf = generateInvoicePdf(order);

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="lumigift-invoice-${order.id}.pdf"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": "private, no-store",
      },
    });
  })
);