"use client";

import { useForm } from "react-hook-form";
import { clsx } from "clsx";
import { zodResolver } from "@hookform/resolvers/zod";
import { createGiftSchema, GIFT_MESSAGE_MAX_LENGTH } from "@/types/schemas";
import type { CreateGiftInput } from "@/types/schemas";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { GiftPreview } from "./GiftPreview";
import { GiftPreviewCard } from "./GiftPreviewCard";
import { useState } from "react";
import { useCsrf } from "@/hooks/useCsrf";
import { formatNGN, ngnFromUsd, usdFromNgn } from "@/lib/currency";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GiftFlowErrorBoundary } from "./GiftFlowErrorBoundary";
import styles from "./CreateGiftForm.module.css";

// ── Gift amount limits ────────────────────────────────────────────────────────
const GIFT_MIN_AMOUNT_NGN = 500;
const GIFT_MAX_AMOUNT_NGN = 5_000_000;
const GIFT_DAILY_LIMIT_NGN = 1_000_000;

type Step = "form" | "preview";
type Currency = "NGN" | "USD";

interface ExchangeRateQuote {
  ngnPerUsdc: number;
  fetchedAt: string;
}

/**
 * Fetches the live NGN/USDC quote. A 1-NGN quote is requested so the response
 * yields the rate directly; `ngnPerUsdc` is derived from the USDC equivalent.
 */
async function fetchExchangeRateQuote(): Promise<ExchangeRateQuote> {
  const res = await fetch("/api/v1/exchange-rate/quote?ngn=1");
  if (!res.ok) throw new Error("Failed to fetch exchange rate");
  const json = await res.json();
  const usdc = Number(json.data?.usdc);
  if (!Number.isFinite(usdc) || usdc <= 0) throw new Error("Invalid exchange rate");
  return {
    ngnPerUsdc: 1 / usdc,
    fetchedAt: json.data?.fetchedAt ?? new Date().toISOString(),
  };
}

/** Formats an ISO timestamp as HH:MM in the user's local timezone. */
function formatRateTime(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * Returns true when the supplied datetime-local string falls within a
 * known DST transition gap (heuristic: offset changes within ±1 hour).
 */
function isAmbiguousDstTransition(isoString: string): boolean {
  try {
    const date = new Date(isoString);
    const before = new Date(date.getTime() - 60 * 60 * 1000);
    const after = new Date(date.getTime() + 60 * 60 * 1000);
    return before.getTimezoneOffset() !== after.getTimezoneOffset();
  } catch {
    return false;
  }
}

export function CreateGiftForm() {
  return (
    <GiftFlowErrorBoundary>
      <CreateGiftFormContent />
    </GiftFlowErrorBoundary>
  );
}

function CreateGiftFormContent() {
  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [usdcEquivalent, setUsdcEquivalent] = useState("…");
  const [showUnregisteredWarning, setShowUnregisteredWarning] = useState(false);
  const [recipientRegistered, setRecipientRegistered] = useState<boolean | null>(null);
  // Stable per-form key so network retries of the same submission are deduplicated server-side
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [unlockDstWarning, setUnlockDstWarning] = useState(false);
  // Raw datetime-local value — the form stores ISO for the shared Zod schema,
  // but the DST gap check needs the wall-clock time the user typed.
  const [unlockLocal, setUnlockLocal] = useState("");
  // Currency the amount input is displayed in; the form value stays in NGN.
  const [currency, setCurrency] = useState<Currency>("NGN");
  // Amount as typed in the currently selected display currency.
  const [displayAmount, setDisplayAmount] = useState("");

  const { csrfFetch } = useCsrf();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    watch,
    formState: { errors, isValid },
  } = useForm<CreateGiftInput>({
    // Same schema the API validates against (src/types/schemas.ts).
    resolver: zodResolver(createGiftSchema) as any,
    defaultValues: { paymentProvider: "paystack", recipientIsRegistered: true },
    // Validate each field on first blur, then on every change so errors
    // clear as soon as the value is corrected.
    mode: "onTouched",
  });

  // Destructure the phone field's react-hook-form bindings so we can pass them
  // to PhoneInput separately (it uses forwardRef + onChange/onBlur callbacks).
  const phoneFieldProps = register("recipientPhone");

  // Live exchange rate — only fetched once the user switches to USD so NGN-only
  // users never pay for the extra request.
  const {
    data: rateQuote,
    isError: rateError,
  } = useQuery({
    queryKey: ["exchange-rate", "quote"],
    queryFn: fetchExchangeRateQuote,
    enabled: currency === "USD",
    staleTime: 60_000,
  });

  const ngnPerUsdc = rateQuote?.ngnPerUsdc;

  /** Converts the typed display amount into NGN and writes it to the form. */
  const syncAmountNgn = (raw: string, from: Currency, rate: number | undefined) => {
    if (raw.trim() === "") {
      setValue("amountNgn", NaN, { shouldValidate: true });
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setValue("amountNgn", NaN, { shouldValidate: true });
      return;
    }
    const ngn = from === "USD" && rate ? ngnFromUsd(parsed, rate) : parsed;
    setValue("amountNgn", ngn, { shouldValidate: true });
  };

  const onAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setDisplayAmount(raw);
    syncAmountNgn(raw, currency, ngnPerUsdc);
  };

  const onToggleCurrency = () => {
    const next: Currency = currency === "NGN" ? "USD" : "NGN";
    const currentNgn = Number(getValues("amountNgn"));
    if (Number.isFinite(currentNgn) && currentNgn > 0 && ngnPerUsdc) {
      const converted =
        next === "USD" ? usdFromNgn(currentNgn, ngnPerUsdc) : ngnFromUsd(currentNgn, ngnPerUsdc);
      // For NGN→USD we already hold the NGN value; for USD→NGN the typed value
      // was USD, so convert it back to NGN for submission.
      const nextDisplay = String(converted);
      setDisplayAmount(nextDisplay);
      setValue("amountNgn", next === "USD" ? currentNgn : ngnFromUsd(converted, ngnPerUsdc), {
        shouldValidate: true,
      });
    } else {
      setDisplayAmount("");
    }
    setCurrency(next);
  };

  // useMutation for gift creation — invalidates the gifts cache on success so
  // the dashboard reflects the new gift without a manual reload.
  const createGiftMutation = useMutation({
    mutationFn: async (data: CreateGiftInput) => {
      const res = await csrfFetch("/api/v1/gifts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          ...data,
          recipientIsRegistered: recipientRegistered ?? true,
        }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to create gift");
      }
      return res.json();
    },
    onSuccess: (json) => {
      // Invalidate all pages of the gifts list so the dashboard is up-to-date.
      queryClient.invalidateQueries({ queryKey: ["gifts"] });
      window.location.href = json.data.paymentUrl;
    },
    onError: (err: Error) => {
      setError(err.message);
      setApiError(classifyApiError(err.message));
    },
  });

  // Step 1 → Step 2: fetch USDC estimate then show preview
  const onFormSubmit = async (data: CreateGiftInput) => {
    setLoading(true);
    setError(null);
    setApiError(null);
    // Warn if the chosen local time falls in a DST gap
    setUnlockDstWarning(isAmbiguousDstTransition(unlockLocal));
    try {
      // Check if recipient is registered (GET — no CSRF needed)
      const checkRes = await fetch(
        `/api/v1/users?phone=${encodeURIComponent(data.recipientPhone)}`
      );
      if (checkRes.ok) {
        const checkJson = await checkRes.json();
        setRecipientRegistered(checkJson.data?.exists ?? false);
        if (!checkJson.data?.exists) {
          setShowUnregisteredWarning(true);
          setLoading(false);
          return; // Don't proceed to preview yet
        }
      } else {
        // If check fails, assume registered to not block the happy path
        setRecipientRegistered(true);
      }

      // GET — no CSRF needed
      const res = await fetch(`/api/v1/exchange-rate?ngn=${data.amountNgn}`);
      if (res.ok) {
        const json = await res.json();
        setUsdcEquivalent(json.data?.usdc ?? "—");
      }
    } catch {
      // Exchange-rate is non-critical — preview still shows without USDC estimate
    }
    setStep("preview");
    setLoading(false);
  };

  const onProceedUnregistered = async () => {
    setShowUnregisteredWarning(false);
    try {
      const data = getValues();
      const res = await fetch(`/api/v1/exchange-rate?ngn=${data.amountNgn}`);
      if (res.ok) {
        const json = await res.json();
        setUsdcEquivalent(json.data?.usdc ?? "—");
      }
    } catch {
      // non-critical
    }
    setStep("preview");
  };

  const onCancelUnregistered = () => {
    setShowUnregisteredWarning(false);
    // Return focus to the submit button for keyboard users
    submitButtonRef.current?.focus();
  };

  const onConfirm = () => {
    setError(null);
    setApiError(null);
    const data = getValues();
    // The form always stores NGN; guard against a stale USD display value.
    if (currency === "USD" && ngnPerUsdc) {
      const parsed = Number(displayAmount);
      if (Number.isFinite(parsed)) {
        data.amountNgn = ngnFromUsd(parsed, ngnPerUsdc);
      }
    }
    createGiftMutation.mutate(data);
  };

  const messageLength = (watch("message") ?? "").length;
  const messageRemaining = GIFT_MESSAGE_MAX_LENGTH - messageLength;

  if (step === "preview") {
    return (
      <GiftPreview
        data={getValues()}
        usdcEquivalent={usdcEquivalent}
        onEdit={() => setStep("form")}
        onConfirm={onConfirm}
        loading={createGiftMutation.isPending}
        error={error}
      />
    );
  }

  return (
    <>
      <form
        className={styles.form}
        onSubmit={handleSubmit(onFormSubmit as Parameters<typeof handleSubmit>[0])}
        noValidate
      >
        <h2 className={styles.title}>Send a Gift</h2>

        <Input
          label="Recipient's Name"
          placeholder="e.g. Amara"
          error={errors.recipientName?.message}
          {...register("recipientName")}
        />

        {/*
         * PhoneInput: live E.164 normalisation with human-readable preview.
         * The Zod schema (via zodResolver) handles the final validation;
         * PhoneInput also gives inline feedback before Zod fires (issue #271).
         */}
        <PhoneInput
          {...phoneFieldProps}
          label="Recipient's Phone"
          error={errors.recipientPhone?.message}
          defaultNigerian
        />

        {/* Amount — limits enforced in Zod schema, mirrored here (#270).
            The input displays the selected currency; the form value is NGN. */}
        <div className={styles.amountRow}>
          <Input
            label={`Gift Amount (${currency === "NGN" ? "₦" : "$"})`}
            type="number"
            placeholder={currency === "NGN" ? "5000" : "5"}
            min={currency === "NGN" ? GIFT_MIN_AMOUNT_NGN : undefined}
            max={currency === "NGN" ? GIFT_MAX_AMOUNT_NGN : undefined}
            step={currency === "USD" ? "0.01" : undefined}
            error={errors.amountNgn?.message}
            value={displayAmount}
            onChange={onAmountChange}
            onBlur={() => syncAmountNgn(displayAmount, currency, ngnPerUsdc)}
          />
          <button
            type="button"
            className={styles.currencyToggle}
            onClick={onToggleCurrency}
            aria-label={`Switch amount currency to ${currency === "NGN" ? "USD" : "NGN"}`}
          >
            {currency === "NGN" ? "₦ NGN" : "$ USD"}
          </button>
        </div>
        {currency === "USD" && (
          <p className={styles.rateLabel} aria-live="polite">
            {rateError
              ? "Exchange rate unavailable — enter amount in NGN"
              : rateQuote
                ? `Rate as of ${formatRateTime(rateQuote.fetchedAt)}`
                : "Fetching rate…"}
          </p>
        )}
        <p className="input-hint">
          Min {formatNGN(GIFT_MIN_AMOUNT_NGN)} · Max {formatNGN(GIFT_MAX_AMOUNT_NGN)} · Daily limit{" "}
          {formatNGN(GIFT_DAILY_LIMIT_NGN)}
        </p>

        <Input
          label="Unlock Date &amp; Time"
          type="datetime-local"
          error={errors.unlockAt?.message}
          {...register("unlockAt", {
            setValueAs: (v: string) => {
              const date = new Date(v);
              return v && !isNaN(date.getTime()) ? date.toISOString() : v;
            },
            onChange: (e) => setUnlockLocal(e.target.value),
          })}
        />
        {unlockDstWarning && (
          <p role="alert" className={styles.dstWarning}>
            ⚠️ The selected time may be ambiguous due to a daylight-saving transition in your
            timezone. Please double-check the unlock time.
          </p>
        )}

        <Textarea
          label="Personal Message (optional)"
          id="message"
          rows={3}
          placeholder="Write something heartfelt…"
          maxLength={GIFT_MESSAGE_MAX_LENGTH}
          error={errors.message?.message}
          aria-describedby={clsx("message-counter", errors.message && "message-error")}
          {...register("message")}
        />
        <p
          id="message-counter"
          className={clsx(styles.counter, messageRemaining < 20 && styles.counterWarning)}
          aria-live="polite"
        >
          {messageLength}/{GIFT_MESSAGE_MAX_LENGTH}
        </p>

        <section aria-label="Gift card preview">
          <GiftPreviewCard data={watch()} onEdit={() => {}} />
        </section>

        <Button type="submit" fullWidth loading={loading} disabled={!isValid}>
          Preview Gift →
        </Button>
      </form>

      {showUnregisteredWarning && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <h3>Unregistered Recipient</h3>
            <p>
              The recipient&apos;s phone number is not registered with Lumigift. They will receive
              an SMS invitation to claim the gift, but must register first.
            </p>
            <p>Are you sure you want to proceed?</p>
            <div className={styles.modalActions}>
              <Button onClick={onCancelUnregistered} variant="secondary">
                Cancel
              </Button>
              <Button onClick={onProceedUnregistered}>Proceed</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
