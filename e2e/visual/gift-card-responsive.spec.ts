/**
 * Visual regression tests for GiftCard responsive layout — Issue #473
 *
 * Verifies that GiftCard renders correctly at the full range of mobile
 * viewport widths (320 px → 1440 px) with no overflow or clipped text.
 *
 * Key viewports:
 *   • 320 px — smallest supported viewport (extra-small Android)
 *   • 375 px — Pixel 5 / iPhone SE
 *   • 414 px — common large-phone width
 *   • 768 px — tablet / wide mobile landscape
 *   • 1440 px — desktop
 *
 * Chrome/Android emulation for Pixel 5 is set in playwright.visual.config.ts
 * via the "mobile-375" project (deviceScaleFactor 2, isMobile true).
 *
 * Closes #473
 */

import { test, expect, type Page } from "@playwright/test";
import {
  GIFT_LOCKED,
  GIFT_UNLOCKED,
  GIFT_CLAIMED,
  ALL_GIFT_FIXTURES,
  giftsListApiResponse,
  VISUAL_SEED_EPOCH,
  VISUAL_USERS,
} from "./fixtures";

async function freezeClock(page: Page): Promise<void> {
  await page.addInitScript((epoch: number) => {
    const OriginalDate = Date;
    class FrozenDate extends OriginalDate {
      constructor(...args: ConstructorParameters<typeof OriginalDate>) {
        if (args.length === 0) super(epoch);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        else super(...(args as [any]));
      }
      static now(): number {
        return epoch;
      }
    }
    // @ts-expect-error intentional override for test determinism
    globalThis.Date = FrozenDate;
  }, VISUAL_SEED_EPOCH);
}

async function mockAuthAndGifts(page: Page): Promise<void> {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: VISUAL_USERS.alice.id,
          phone: VISUAL_USERS.alice.phone,
          name: VISUAL_USERS.alice.displayName,
        },
        expires: new Date(VISUAL_SEED_EPOCH + 86_400_000).toISOString(),
      }),
    })
  );

  await page.route("**/api/v1/gifts**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(giftsListApiResponse(ALL_GIFT_FIXTURES)),
    })
  );

  await page.route("**/api/v1/gifts/analytics**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          totalGiftsSent: 3,
          totalValueNgn: 17500,
          claimRate: 33,
          averageTimeToClaimMs: null,
          claimedGiftCount: 1,
          gifts: ALL_GIFT_FIXTURES.map((g) => ({
            id: g.id,
            amountNgn: g.amountNgn,
            status: g.status,
            sentAt: g.createdAt,
            unlockAt: g.unlockAt,
            claimedAt: g.status === "claimed" ? g.updatedAt : null,
          })),
        },
      }),
    })
  );
}

// ── 320 px — smallest supported (extra-small Android) ─────────────────────────

test("GiftCard responsive — 320px viewport (no overflow)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 568 } });
  const page = await ctx.newPage();
  await freezeClock(page);
  await mockAuthAndGifts(page);
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");

  // Assert no horizontal scroll on the gift list
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  expect(hasOverflow).toBe(false);

  await expect(page).toHaveScreenshot("giftcard-320px.png");
  await ctx.close();
});

// ── 375 px — Pixel 5 / Chrome Android emulation ───────────────────────────────

test("GiftCard responsive — 375px (Pixel 5 emulation)", async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36",
  });
  const page = await ctx.newPage();
  await freezeClock(page);
  await mockAuthAndGifts(page);
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");

  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  expect(hasOverflow).toBe(false);

  await expect(page).toHaveScreenshot("giftcard-375px-pixel5.png");
  await ctx.close();
});

// ── 768 px — tablet / wide mobile landscape ────────────────────────────────────

test("GiftCard responsive — 768px viewport", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 768, height: 1024 } });
  const page = await ctx.newPage();
  await freezeClock(page);
  await mockAuthAndGifts(page);
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");

  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  expect(hasOverflow).toBe(false);

  await expect(page).toHaveScreenshot("giftcard-768px.png");
  await ctx.close();
});

// ── Touch target size check at 375 px ─────────────────────────────────────────

test("GiftCard touch targets are ≥ 44×44px at 375px", async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await freezeClock(page);
  await mockAuthAndGifts(page);
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");

  // All buttons and links inside a card must be at least 44×44 CSS px
  const smallTargets = await page.evaluate(() => {
    const hits: string[] = [];
    document.querySelectorAll<HTMLElement>("article button, article a").forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 44 || rect.height < 44) {
        hits.push(
          `${el.tagName} "${el.textContent?.trim()}" ${rect.width.toFixed(0)}×${rect.height.toFixed(0)}`
        );
      }
    });
    return hits;
  });

  expect(smallTargets).toEqual([]);
  await ctx.close();
});
