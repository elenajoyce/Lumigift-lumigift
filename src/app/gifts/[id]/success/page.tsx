"use client";

/**
 * /gifts/[id]/success — Gift creation confirmation screen (issue #475)
 *
 * Shown after Paystack redirects back via /api/v1/payments/callback following
 * a successful payment. Fires a canvas-confetti burst once to celebrate
 * the most important funnel moment.
 *
 * Accessibility:
 *   - Confetti is skipped when `prefers-reduced-motion: reduce` is set.
 *   - The canvas element is removed from the DOM after the animation
 *     completes to prevent memory leaks.
 *   - Navigation and API calls are not blocked by the animation because
 *     canvas-confetti runs entirely on a pointer-events:none overlay.
 */

import { useEffect, useRef } from "react";
import Link from "next/link";
import styles from "./page.module.css";

interface Props {
  params: { id: string };
}

export default function GiftSuccessPage({ params }: Props) {
  const { id: giftId } = params;
  const firedRef = useRef(false);

  useEffect(() => {
    // Guard: fire confetti only once per mount, never on re-renders.
    if (firedRef.current) return;
    firedRef.current = true;

    // Respect the OS/browser reduced-motion preference.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let canvas: HTMLCanvasElement | null = null;

    import("canvas-confetti")
      .then(({ default: confetti }) => {
        // Create an isolated canvas so the animation never overlaps page
        // controls and is fully cleaned up after it finishes.
        canvas = document.createElement("canvas");
        canvas.style.cssText =
          "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;";
        document.body.appendChild(canvas);

        const myConfetti = confetti.create(canvas, { resize: true, useWorker: true });

        return myConfetti({
          particleCount: 120,
          spread: 80,
          origin: { y: 0.55 },
          disableForReducedMotion: true,
        });
      })
      .then(() => {
        // Remove the canvas after the animation promise resolves (~3 s).
        canvas?.remove();
      })
      .catch(() => {
        // Non-critical — the confirmation screen still functions without confetti.
        canvas?.remove();
      });
  }, []);

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        {/* Gift-box icon */}
        <div className={styles.iconWrapper} aria-hidden="true">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="56"
            height="56"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="8" width="18" height="4" rx="1" />
            <path d="M12 8v13" />
            <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
            <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
          </svg>
        </div>

        <h1 className={styles.title}>Gift sent! 🎉</h1>

        <p className={styles.message}>
          Your gift is locked and ready. We&rsquo;ll notify your recipient when it unlocks.
        </p>

        <div className={styles.actions}>
          <Link href={`/gifts/${giftId}`} className="btn btn--primary">
            View your gift
          </Link>
          <Link href="/dashboard" className="btn btn--secondary">
            Go to dashboard
          </Link>
          <Link href="/send" className="btn btn--secondary">
            Send another gift
          </Link>
        </div>
      </div>
    </main>
  );
}
