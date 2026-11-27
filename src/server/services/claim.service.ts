import { sendUsdcPayment } from "@/lib/stellar";
import { updateGiftStatus, atomicTransitionGiftStatus, storeClaimTxHash } from "./gift.service";
import {
  createEscrowClient,
  EscrowContractError,
  EscrowError,
} from "@/lib/contracts/escrow-client";
import { sendClaimConfirmationEmail } from "@/lib/email";
import type { Gift } from "@/types";

/**
 * Thrown when a gift has already been claimed (or transitioned away from
 * `"unlocked"`) by a concurrent request. Routes should map this to 409.
 */
export class GiftAlreadyClaimedError extends Error {
  constructor(giftId: string) {
    super(`Gift ${giftId} is not claimable (already claimed or not unlocked).`);
    this.name = "GiftAlreadyClaimedError";
  }
}

/**
 * Claims a gift by transferring its USDC amount to the recipient's Stellar account.
 *
 * Steps performed:
 * 1. Validates that the gift status is `"unlocked"` (unlock time has passed).
 * 2. Verifies on-chain state via the typed escrow client (`get_state`).
 * 3. Submits a USDC payment on Stellar to `recipientStellarKey`.
 * 4. Persists the transaction hash on the gift record.
 * 5. Transitions the gift status to `"claimed"`.
 *
 * @param gift - The {@link Gift} to claim. Must have status `"unlocked"`.
 * @param recipientStellarKey - The recipient's Stellar public key (G…).
 * @returns An object containing the Stellar `txHash` of the payment.
 * @throws `Error("Gift is not yet unlocked.")` if the gift status is not `"unlocked"`.
 * @throws {@link EscrowContractError} if the on-chain state check fails.
 * @throws If the Stellar payment submission fails (e.g. insufficient balance,
 *   missing trustline).
 */
export async function claimGift(
  gift: Gift,
  recipientStellarKey: string
): Promise<{ txHash: string }> {
  if (gift.status !== "unlocked") {
    throw new Error("Gift is not yet unlocked.");
  }

  // Redis `claim-guard` is the first-line defence against double-claims, but
  // if Redis is down it is a no-op. This atomic, in-process compare-and-set
  // is the last-resort guard: it flips the gift to "claimed" only if it is
  // still "unlocked", closing the window where two concurrent requests could
  // both pass the status check above before either one wrote the update.
  const locked = atomicTransitionGiftStatus(gift.id, "unlocked", "claimed");
  if (!locked) {
    throw new GiftAlreadyClaimedError(gift.id);
  }
  gift.status = "claimed";

  try {
    // Verify on-chain state before submitting the payment
    if (gift.contractId) {
      const escrow = createEscrowClient();
      try {
        const state = await escrow.getState();
        if (state.claimed) {
          throw new EscrowContractError(EscrowError.AlreadyClaimed);
        }
      } catch (err) {
        if (err instanceof EscrowContractError) throw err;
        // Non-fatal: log and proceed if RPC is unavailable
        console.warn("escrow get_state check skipped:", (err as Error).message);
      }
    }

    const txHash = await sendUsdcPayment(recipientStellarKey, gift.amountUsdc);
    await storeClaimTxHash(gift.id, txHash);

    if (gift.recipientEmail) {
      sendClaimConfirmationEmail(gift.recipientEmail, {
        recipientName: gift.recipientName,
        amountNgn: gift.amountNgn,
      }).catch((err: unknown) => console.error("[email] claim_confirmation failed:", err));
    }

    return { txHash };
  } catch (err) {
    // The atomic lock already flipped status to "claimed" above. If the
    // actual payment never went through, release the lock so the gift can
    // be retried instead of being stuck permanently "claimed" with no txHash.
    const reverted = atomicTransitionGiftStatus(gift.id, "claimed", "unlocked");
    if (reverted) {
      gift.status = "unlocked";
    } else {
      // Fall back to the throwing updater if the direct CAS above somehow
      // didn't apply (e.g. status changed again concurrently).
      await updateGiftStatus(gift.id, "unlocked").catch(() => undefined);
    }
    throw err;
  }
}
