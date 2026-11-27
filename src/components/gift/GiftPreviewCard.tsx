import type { CreateGiftInput } from "@/types/schemas";
import type { GiftTemplate } from "@/lib/giftTemplates";
import { formatUnlockDate } from "@/lib/dateFormat";
import { giftThemeStyle } from "@/lib/giftThemes";
import styles from "./GiftPreviewCard.module.css";

interface GiftPreviewCardProps {
  data: Partial<CreateGiftInput>;
  template?: GiftTemplate;
  onEdit: (step: number) => void;
  /** Render a small, non-interactive preview (no edit buttons or hint text). */
  compact?: boolean;
}

export function GiftPreviewCard({ data, template, onEdit, compact = false }: GiftPreviewCardProps) {
  const unlockDate = data.unlockAt ? new Date(data.unlockAt) : null;
  const themeStyle = giftThemeStyle(data.themeId);
  const cardClassName = [
    styles.card,
    themeStyle ? "gift-theme" : null,
    compact ? styles.compact : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={cardClassName} style={themeStyle}>
      <div className={styles.header}>
        <span className={styles.emoji}>{template?.emoji ?? "🎁"}</span>
        <div>
          <p className={styles.occasion}>{template?.occasion ?? "Custom Gift"}</p>
          <p className={styles.to}>To: {data.recipientName || "—"}</p>
        </div>
      </div>

      <div className={styles.amount}>
        {data.amountNgn ? `₦${data.amountNgn.toLocaleString("en-NG")}` : "₦ ——"}
      </div>

      <div className={styles.row}>
        <span className={styles.rowLabel}>Phone</span>
        <span>{data.recipientPhone || "—"}</span>
        {!compact && (
          <button type="button" className={styles.edit} onClick={() => onEdit(1)}>
            Edit
          </button>
        )}
      </div>

      <div className={styles.row}>
        <span className={styles.rowLabel}>Amount</span>
        <span>{data.amountNgn ? `₦${data.amountNgn.toLocaleString("en-NG")}` : "—"}</span>
        {!compact && (
          <button type="button" className={styles.edit} onClick={() => onEdit(2)}>
            Edit
          </button>
        )}
      </div>

      <div className={styles.row}>
        <span className={styles.rowLabel}>Unlocks</span>
        <span>{unlockDate ? formatUnlockDate(unlockDate) : "—"}</span>
        {!compact && (
          <button type="button" className={styles.edit} onClick={() => onEdit(3)}>
            Edit
          </button>
        )}
      </div>

      {data.message && (
        <div className={styles.message}>
          <span className={styles.rowLabel}>Message</span>
          <p>{data.message}</p>
          {!compact && (
            <button type="button" className={styles.edit} onClick={() => onEdit(2)}>
              Edit
            </button>
          )}
        </div>
      )}

      {!compact && (
        <p className={styles.hint}>
          🔒 The amount and message will be hidden from the recipient until the unlock date.
        </p>
      )}
    </article>
  );
}
