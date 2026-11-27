import crypto from 'crypto';

/**
 * Result of a webhook signature verification.
 */
export type WebhookVerifyResult =
  | { valid: true }
  | { valid: false; reason: 'missing_signature' | 'invalid_signature' | 'missing_secret' | 'error' };

/**
 * Verify a Paystack webhook signature.
 *
 * Paystack signs the raw request body with HMAC-SHA512 using the secret key
 * and sends the hex digest in the `x-paystack-signature` header.
 *
 * @param rawBody        The raw request body (string or Buffer). Must be the
 *                       exact bytes Paystack signed, before JSON parsing.
 * @param signatureHeader The value of the `x-paystack-signature` header.
 * @param secret         The Paystack secret key (from serverConfig).
 */
export function verifyPaystackSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined | null,
  secret: string | undefined | null,
): WebhookVerifyResult {
  if (!signatureHeader || typeof signatureHeader !== 'string' || signatureHeader.trim() === '') {
    return { valid: false, reason: 'missing_signature' };
  }

  if (!secret || typeof secret !== 'string' || secret.trim() === '') {
    return { valid: false, reason: 'missing_secret' };
  }

  try {
    const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody ?? '', 'utf8');
    const expected = crypto.createHmac('sha512', secret).update(bodyBuffer).digest('hex');

    const provided = signatureHeader.trim().toLowerCase();
    const expectedBuf = Buffer.from(expected, 'utf8');
    const providedBuf = Buffer.from(provided, 'utf8');

    // Length check is required before timingSafeEqual to avoid throwing.
    if (expectedBuf.length !== providedBuf.length) {
      return { valid: false, reason: 'invalid_signature' };
    }

    const match = crypto.timingSafeEqual(expectedBuf, providedBuf);
    return match ? { valid: true } : { valid: false, reason: 'invalid_signature' };
  } catch {
    return { valid: false, reason: 'error' };
  }
}

/**
 * Verify a Stripe-style webhook signature.
 *
 * Stripe sends a header of the form `t=<timestamp>,v1=<signature>` and signs
 * the string `${timestamp}.${rawBody}` with HMAC-SHA256.
 *
 * @param rawBody         The raw request body (string or Buffer).
 * @param signatureHeader The value of the `stripe-signature` header.
 * @param secret          The Stripe webhook signing secret.
 * @param toleranceSec    Max allowed age of the timestamp (default 300s).
 */
export function verifyStripeSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined | null,
  secret: string | undefined | null,
  toleranceSec = 300,
): WebhookVerifyResult {
  if (!signatureHeader || typeof signatureHeader !== 'string' || signatureHeader.trim() === '') {
    return { valid: false, reason: 'missing_signature' };
  }

  if (!secret || typeof secret !== 'string' || secret.trim() === '') {
    return { valid: false, reason: 'missing_secret' };
  }

  try {
    const parts = signatureHeader.split(',').reduce<Record<string, string>>((acc, part) => {
      const [key, value] = part.split('=');
      if (key && value) {
        acc[key.trim()] = value.trim();
      }
      return acc;
    }, {});

    const timestamp = parts['t'];
    const providedSig = parts['v1'];

    if (!timestamp || !providedSig) {
      return { valid: false, reason: 'invalid_signature' };
    }

    const timestampNum = Number(timestamp);
    if (!Number.isFinite(timestampNum)) {
      return { valid: false, reason: 'invalid_signature' };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - timestampNum) > toleranceSec) {
      return { valid: false, reason: 'invalid_signature' };
    }

    const bodyString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody ?? '');
    const payload = `${timestamp}.${bodyString}`;
    const expected = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');

    const expectedBuf = Buffer.from(expected, 'utf8');
    const providedBuf = Buffer.from(providedSig.toLowerCase(), 'utf8');

    if (expectedBuf.length !== providedBuf.length) {
      return { valid: false, reason: 'invalid_signature' };
    }

    const match = crypto.timingSafeEqual(expectedBuf, providedBuf);
    return match ? { valid: true } : { valid: false, reason: 'invalid_signature' };
  } catch {
    return { valid: false, reason: 'error' };
  }
}