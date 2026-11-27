import axios, { AxiosError } from "axios";
import { serverConfig } from "@/server/config";
import { generateOtp, storeOtp } from "@/lib/otp";

const termiiClient = axios.create({
  baseURL: "https://api.ng.termii.com/api",
  headers: { "Content-Type": "application/json" },
});

type TermiiResponse = {
  status?: string;
  message?: string;
  data?: unknown;
};

/**
 * Circuit breaker state for Termii SMS deliveries.
 *
 * Opens after `maxFailures` consecutive failures within `windowMs`, then
 * rejects new sends for `cooldownMs`. Resets automatically on success.
 */
class TermiiCircuitBreaker {
  private failureCount = 0;
  private lastFailureTime: number | null = null;
  private openUntil = 0;

  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;

  constructor({
    maxFailures = 5,
    windowMs = 60_000,
    cooldownMs = 60_000,
  }: { maxFailures?: number; windowMs?: number; cooldownMs?: number } = {}) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.cooldownMs = cooldownMs;
  }

  /** Returns true if the circuit is closed (sends allowed). */
  isClosed(): boolean {
    if (Date.now() >= this.openUntil) {
      this.openUntil = 0;
    }
    return this.openUntil === 0;
  }

  /** Records a successful send, resetting the breaker. */
  recordSuccess(): void {
    this.failureCount = 0;
    this.lastFailureTime = null;
  }

  /**
   * Records a failure and returns true when the breaker should open.
   * The breaker opens after `maxFailures` consecutive failures within
   * `windowMs`.
   */
  recordFailure(): boolean {
    const now = Date.now();
    if (
      this.lastFailureTime &&
      now - this.lastFailureTime <= this.windowMs
    ) {
      this.failureCount += 1;
    } else {
      this.failureCount = 1;
    }
    this.lastFailureTime = now;

    if (this.failureCount >= this.maxFailures) {
      this.openUntil = now + this.cooldownMs;
      return true;
    }
    return false;
  }
}

const circuitBreaker = new TermiiCircuitBreaker();

/**
 * Sleeps for `ms` milliseconds. Used for exponential backoff between retries.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extracts the Termii response status and body from an axios error for
 * logging purposes.
 */
function extractTermiiError(error: unknown): {
  status?: number;
  body?: unknown;
} {
  const axiosError = error as AxiosError<TermiiResponse>;
  return {
    status: axiosError?.response?.status,
    body: axiosError?.response?.data ?? axiosError?.message ?? String(error),
  };
}

/**
 * Sends an SMS payload to Termii with retry logic and circuit breaking.
 *
 * Retries up to 3 times with exponential backoff (1s, 2s, 4s) on transient
 * failures (timeouts and 5xx responses). After 3 failures, throws a helpful
 * error. Circuit breaker opens after 5 consecutive failures within 1 minute,
 * rejecting new sends while open.
 */
async function sendWithRetry(payload: unknown): Promise<void> {
  if (!circuitBreaker.isClosed()) {
    const error = new Error(
      "SMS delivery is temporarily unavailable. Please try again in a minute.",
    );
    console.error(
      "[termii] circuit breaker open, refusing send",
      extractTermiiError(error),
    );
    throw error;
  }

  const delaysMs = [1_000, 2_000, 4_000];
  let lastError: { status?: number; body?: unknown };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await termiiClient.post("/sms/send", payload);
      circuitBreaker.recordSuccess();
      return;
    } catch (error) {
      lastError = extractTermiiError(error);
      console.error(
        `[termii] send attempt ${attempt + 1}/3 failed`,
        lastError,
      );

      const isTransient =
        lastError.status === undefined ||
        lastError.status >= 500 ||
        lastError.status === 408 ||
        lastError.status === 429;

      if (!isTransient || attempt === 2) {
        break;
      }

      await sleep(delaysMs[attempt]);
    }
  }

  const opened = circuitBreaker.recordFailure();

  throw new Error(
    `Failed to send SMS after 3 attempts. ${lastError?.body ? String(lastError.body) : "no response"}`,
  );
}

/**
 * Sends a new-device login alert to the user via SMS.
 * Called when a login is detected from an unrecognised device fingerprint.
 *
 * @param phone - E.164-formatted destination phone number.
 * @param options.time - Human-readable timestamp of the login event (UTC string).
 * @param options.country - Country name resolved from the login IP address.
 * @param options.reportUrl - URL the user can visit to report a suspicious login.
 * @returns Resolves when the SMS has been dispatched to Termii.
 * @throws If the Termii API returns a non-2xx response after retries.
 */
export async function sendNewDeviceAlert(
  phone: string,
  { time, country, reportUrl }: { time: string; country: string; reportUrl: string }
): Promise<void> {
  await sendWithRetry({
    to: phone,
    from: serverConfig.termii.senderId,
    sms:
      `Lumigift: New login detected on your account.\n` +
      `Time: ${time}\nLocation: ${country}\n` +
      `Not you? Report it: ${reportUrl}`,
    type: "plain",
    channel: "generic",
    api_key: serverConfig.termii.apiKey,
  });
}

/**
 * Generates a 6-digit OTP, sends it to the given phone number via SMS,
 * and returns the generated OTP so the caller can persist it.
 *
 * @param phone - E.164-formatted destination phone number.
 * @returns The 6-digit OTP string that was sent.
 * @throws If the Termii API returns a non-2xx response after retries.
 */
export async function sendOtp(phone: string): Promise<string> {
  const otp = generateOtp();
  await storeOtp(phone, otp);

  await sendWithRetry({
    to: phone,
    from: serverConfig.termii.senderId,
    sms: `Your Lumigift verification code is: ${otp}. Valid for 10 minutes.`,
    type: "plain",
    channel: "generic",
    api_key: serverConfig.termii.apiKey,
  });
  return otp;
}

/**
 * Sends a gift invitation SMS to an unregistered recipient.
 * The invitation includes a link to claim the gift after registering.
 *
 * @param phone - E.164-formatted destination phone number.
 * @param invitationToken - The invitation token for the gift.
 * @param recipientName - The name of the person sending the gift.
 * @returns Resolves when the SMS has been dispatched to Termii.
 * @throws If the Termii API returns a non-2xx response after retries.
 */
export async function sendGiftInvitation(
  phone: string,
  invitationToken: string,
  senderName: string
): Promise<void> {
  const claimLink = `${serverConfig.app.url}/auth/register?invitation=${encodeURIComponent(invitationToken)}`;

  await sendWithRetry({
    to: phone,
    from: serverConfig.termii.senderId,
    sms:
      `${senderName} sent you a gift on Lumigift! ðŸŽ\n` +
      `Register to claim it: ${claimLink}\n` +
      `Valid for 30 days.`,
    type: "plain",
    channel: "generic",
    api_key: serverConfig.termii.apiKey,
  });
}

/**
 * Reminds a recipient that their gift has expired but can still be claimed
 * during the grace period before the escrow is refunded to the sender.
 *
 * @param phone - E.164-formatted destination phone number.
 * @param amountUsdc - The gift amount in USDC.
 * @param refundDueAt - When the grace period ends and the refund is processed.
 * @returns Resolves when the SMS has been dispatched to Termii.
 * @throws If the Termii API returns a non-2xx response.
 */
/**
 * Notifies the sender that their on-chain escrow has been claimed by the
 * recipient (dispatched from the Stellar event indexer, issue #517).
 *
 * @param phone - E.164-formatted destination phone number (sender's).
 * @param recipientName - Display name of the recipient who claimed the gift.
 * @param amountUsdc - The gift amount in USDC.
 */
export async function sendGiftClaimedAlert(
  phone: string,
  recipientName: string,
  amountUsdc: string
): Promise<void> {
  await termiiClient.post("/sms/send", {
    to: phone,
    from: serverConfig.termii.senderId,
    sms: `Lumigift: 🎉 ${recipientName} just claimed your ${amountUsdc} USDC gift!`,
    type: "plain",
    channel: "generic",
    api_key: serverConfig.termii.apiKey,
  });
}

/**
 * Notifies the recipient that their gift escrow has been funded on-chain
 * (dispatched from the Stellar event indexer, issue #517).
 *
 * @param phone - E.164-formatted destination phone number (recipient's).
 * @param amountUsdc - The gift amount in USDC.
 */
export async function sendGiftFundedAlert(phone: string, amountUsdc: string): Promise<void> {
  await termiiClient.post("/sms/send", {
    to: phone,
    from: serverConfig.termii.senderId,
    sms: `Lumigift: 🎁 A ${amountUsdc} USDC gift has been funded for you! Open the app to claim it.`,
    type: "plain",
    channel: "generic",
    api_key: serverConfig.termii.apiKey,
  });
}

/**
 * Sent when a user requests account deletion (Issue #516). Gives them a
 * reactivation link to cancel the scheduled deletion within the 30-day
 * grace period.
 */
export async function sendAccountDeletionAlert(phone: string, cancelUrl: string): Promise<void> {
  await termiiClient.post("/sms/send", {
    to: phone,
    from: serverConfig.termii.senderId,
    sms:
      `Lumigift: Your account is scheduled for deletion in 30 days. ` +
      `Didn't mean to? Cancel here: ${cancelUrl}`,
    type: "plain",
    channel: "generic",
    api_key: serverConfig.termii.apiKey,
  });
}

export async function sendExpiryGraceReminder(
  phone: string,
  amountUsdc: string,
  refundDueAt: Date
): Promise<void> {
  await termiiClient.post("/sms/send", {
    to: phone,
    from: serverConfig.termii.senderId,
    sms:
      `Lumigift: Your ${amountUsdc} USDC gift has expired. 🎁\n` +
      `Claim it before ${refundDueAt.toUTCString()} or it will be refunded to the sender: ` +
      `${serverConfig.app.url}/claim`,
    type: "plain",
    channel: "generic",
    api_key: serverConfig.termii.apiKey,
  });
}

/**
 * Sends an occasion reminder SMS to the occasion owner, with a deep link to
 * `/send` pre-filled with the saved contact so they can start a gift in one
 * tap. Issue #519.
 *
 * @param phone - E.164-formatted destination phone number (the occasion owner).
 * @param contactName - The saved contact's name for this occasion.
 * @param label - The occasion label (e.g. "Birthday", "Anniversary").
 * @param occasionId - Used to pre-fill the `/send` link.
 * @param daysUntil - How many days remain until the occasion (7 or 1).
 */
export async function sendOccasionReminder(
  phone: string,
  contactName: string,
  label: string,
  occasionId: string,
  daysUntil: number
): Promise<void> {
  const when = daysUntil <= 1 ? "tomorrow" : `in ${daysUntil} days`;
  const link = `${serverConfig.app.url}/send?occasionId=${encodeURIComponent(occasionId)}`;
  await termiiClient.post("/sms/send", {
    to: phone,
    from: serverConfig.termii.senderId,
    sms:
      `Lumigift: ${contactName}'s ${label} is ${when}! 🎁\n` +
      `Send a time-locked gift now: ${link}`,
    type: "plain",
    channel: "generic",
    api_key: serverConfig.termii.apiKey,
  });
}
