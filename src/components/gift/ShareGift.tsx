"use client";

import { useToast } from "@/components/ui/ToastContext";
import { Button } from "@/components/ui/Button";
import { useAnalytics } from "@/lib/analytics";
import styles from "./ShareGift.module.css";

interface ShareGiftProps {
  giftId: string;
  recipientName: string;
}

export interface ShareGiftPayload {
  title: string;
  text: string;
  url: string;
}

export type ShareMethod = "web-share" | "clipboard";

/**
 * Feature-detects the Web Share API. Optionally verifies that the given
 * payload is shareable via `navigator.canShare` when available.
 */
export function canUseWebShare(payload?: ShareGiftPayload): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
    return false;
  }
  if (payload && typeof navigator.canShare === "function") {
    try {
      return navigator.canShare(payload);
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Shares the gift via the Web Share API when supported, otherwise falls back
 * to copying the URL to the clipboard. Returns the method used, or `null` if
 * the user dismissed the native sheet (no analytics fired in that case).
 */
export async function shareGift(
  payload: ShareGiftPayload,
  track: (event: string, props: Record<string, unknown>) => void,
): Promise<ShareMethod | null> {
  if (canUseWebShare(payload)) {
    try {
      await navigator.share({ title: payload.title, text: payload.text, url: payload.url });
      track("gift_share", { method: "web-share" });
      return "web-share";
    } catch (err) {
      // AbortError = user dismissed the sheet; fall through to clipboard.
      if (err instanceof Error && err.name !== "AbortError") {
        console.warn("[ShareGift] navigator.share failed:", err);
      }
    }
  }

  await navigator.clipboard.writeText(payload.url);
  track("gift_share", { method: "clipboard" });
  return "clipboard";
}

/**
 * Builds the gift claim URL from the gift ID only — no PII is included.
 */
function buildClaimUrl(giftId: string): string {
  const base =
    typeof window !== "undefined"
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_APP_URL ?? "");
  return `${base}/gifts/${giftId}`;
}

function buildShareText(recipientName: string, claimUrl: string): string {
  return `🎁 You have a surprise gift waiting, ${recipientName}! Claim it here: ${claimUrl}`;
}

function buildSharePayload(recipientName: string, claimUrl: string): ShareGiftPayload {
  return {
    title: "Lumigift",
    text: buildShareText(recipientName, claimUrl),
    url: claimUrl,
  };
}

/**
 * ShareGift — renders sharing options for a created gift.
 *
 * Priority order:
 *   1. Web Share API (native sheet on mobile — iOS Safari, Android Chrome)
 *   2. Clipboard copy with a success toast (desktop fallback)
 *
 * The shared URL contains only the gift ID — no PII.
 */
export function ShareGift({ giftId, recipientName }: ShareGiftProps) {
  const { addToast } = useToast();
  const track = useAnalytics();

  const claimUrl = buildClaimUrl(giftId);
  const payload = buildSharePayload(recipientName, claimUrl);
  const text = payload.text;

  const handleShare = async () => {
    try {
      const method = await shareGift(payload, track);
      if (method === "clipboard") {
        addToast("Gift link copied to clipboard!", "success");
      }
    } catch {
      // Clipboard API unavailable (e.g. non-secure context in older browsers)
      addToast("Could not copy link. Please copy it manually.", "error");
    }
  };

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const smsUrl = `sms:?body=${encodeURIComponent(text)}`;

  const trackChannel = (channel: string) => {
    track("gift_share", { method: channel });
  };

  return (
    <div className={styles.container}>
      <Button variant="secondary" size="sm" onClick={handleShare} aria-label="Share gift link">
        Share
      </Button>

      <a
        href={whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.link}
        aria-label="Share on WhatsApp"
        onClick={() => trackChannel("whatsapp")}
      >
        WhatsApp
      </a>

      <a
        href={smsUrl}
        className={styles.link}
        aria-label="Share via SMS"
        onClick={() => trackChannel("sms")}
      >
        SMS
      </a>
    </div>
  );
}
