"use client";

import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { formatNGN } from "@/lib/currency";
import { formatUnlockDate } from "@/lib/dateFormat";
import { useToast } from "@/components/ui/Toast";
import type { ApiResponse } from "@/types";
import type { ReceiptData } from "@/server/services/transaction-history.service";
import styles from "./page.module.css";

async function fetchReceipt(giftId: string): Promise<ReceiptData> {
  const res = await fetch(`/api/v1/transactions/${encodeURIComponent(giftId)}/receipt`);
  const json: ApiResponse<ReceiptData> = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data;
}

/** Printable transaction receipt (issue #352). */
export default function ReceiptPage({ params }: { params: Promise<{ giftId: string }> }) {
  const { giftId } = use(params);
  const { showToast } = useToast();
  const [isDownloading, setIsDownloading] = useState(false);
  const { data, status } = useQuery({
    queryKey: ["receipt", giftId],
    queryFn: () => fetchReceipt(giftId),
  });

  async function handleDownload() {
    setIsDownloading(true);
    try {
      const res = await fetch(
        `/api/v1/transactions/${encodeURIComponent(giftId)}/receipt`,
        { headers: { Accept: "application/pdf" } },
      );
      if (!res.ok) throw new Error(`Receipt download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `lumigift-receipt-${giftId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      showToast({
        variant: "error",
        message: "Could not generate the receipt PDF. Please try again.",
      });
    } finally {
      setIsDownloading(false);
    }
  }

  if (status === "pending") {
    return (
      <div className="container">
        <p aria-busy="true">Loading receipt…</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="container">
        <p role="alert">Failed to load this receipt.</p>
        <Link href="/dashboard">Back to dashboard</Link>
      </div>
    );
  }

  const rows: Array<[string, string]> = [
    ["Gift ID", data.giftId],
    ["Sender", data.senderName],
    ["Recipient", data.recipientName],
    ["Amount", `${formatNGN(data.amountNgn)} (${data.amountUsdc} USDC)`],
    ["Status", data.status],
    ["Payment provider", data.provider],
    ["Payment reference", data.providerReference],
    ["Created", formatUnlockDate(data.createdAt)],
    ["Completed", data.completedAt ? formatUnlockDate(data.completedAt) : "—"],
    ["Stellar tx hash", data.stellarTxHash ?? "—"],
  ];

  return (
    <div className={`container ${styles.page}`}>
      <div className={`${styles.actions} no-print`}>
        <Link href="/dashboard" className="btn btn--secondary">
          ← Back
        </Link>
        <button
          type="button"
          className="btn btn--primary"
          onClick={handleDownload}
          disabled={isDownloading}
          aria-busy={isDownloading}
        >
          {isDownloading ? "Generating PDF…" : "Download PDF"}
        </button>
        <button type="button" className="btn btn--secondary" onClick={() => window.print()}>
          Print receipt
        </button>
        <button type="button" className="btn btn--secondary" onClick={handleShare}>
          Share receipt
        </button>
      </div>

      {shareStatus && (
        <p className="no-print" role="status">
          {shareStatus}
        </p>
      )}

      <article className={`${styles.receipt} print-receipt`} aria-labelledby="receipt-title">
        <header className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            L
          </span>
          <div>
            <p className={styles.brandName}>Lumigift</p>
            <h1 id="receipt-title" className={styles.title}>
              Transaction Receipt
            </h1>
          </div>
        </header>

        <dl className={styles.details}>
          {rows.map(([label, value]) => (
            <div key={label} className={styles.row}>
              <dt>{label}</dt>
              <dd className={label === "Stellar tx hash" ? styles.hash : undefined}>{value}</dd>
            </div>
          ))}
        </dl>

        <footer className={styles.contact}>
          <p>Lumigift · www.lumigift.com</p>
          <p>Questions? Contact support@lumigift.com</p>
        </footer>
      </article>
    </div>
  );
}
