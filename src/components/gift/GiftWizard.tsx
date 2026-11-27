"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createGiftSchema, type CreateGiftFormInput } from "@/types/schemas";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { DateTimeInput } from "@/components/ui/DateTimeInput";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { ConfirmationSafetyNotice } from "@/components/ui/ConfirmationSafetyNotice";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useGiftDraft } from "@/hooks/useGiftDraft";
import { TemplateSelector } from "./TemplateSelector";
import { WizardProgress } from "./WizardProgress";
import { GiftPreviewCard } from "./GiftPreviewCard";
import { ThemePicker } from "./ThemePicker";
import { BLANK_TEMPLATE, type GiftTemplate } from "@/lib/giftTemplates";
import styles from "./GiftWizard.module.css";

// Step indices
const STEP_OCCASION = 0;
const STEP_RECIPIENT = 1;
const STEP_AMOUNT = 2;
const STEP_UNLOCK = 3;
const STEP_REVIEW = 4;

/**
 * Human-readable labels for form fields, used in the validation error summary.
 */
const FIELD_LABELS: Partial<Record<keyof CreateGiftFormInput, string>> = {
  recipientName: "Recipient's Name",
  recipientPhone: "Recipient's Phone",
  recipientEmail: "Recipient's Email",
  amountNgn: "Gift Amount",
  message: "Personal Message",
  unlockAt: "Unlock Date & Time",
  paymentProvider: "Payment Method",
  themeId: "Theme",
};

/**
 * Outcome of the last mutation attempt.
 *
 * - `idle`    — no submission yet.
 * - `pending` — request in flight.
 * - `unknown` — request was sent but connectivity dropped before a response
 *               arrived; we cannot confirm success or failure.
 * - `error`   — server returned an error response.
 * - `success` — server returned success.
 */
type MutationOutcome = "idle" | "pending" | "unknown" | "error" | "success";

/**
 * Converts a datetime value to an ISO 8601 UTC string.
 *
 * `DateTimeInput` already produces UTC ISO strings, but drafts restored from
 * localStorage (or values typed by other means) may be local-time strings.
 * Parsing with `new Date()` interprets offset-less strings as local time, so
 * the resulting `toISOString()` is always UTC.
 */
function toUtcIsoString(value: string | undefined | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString();
}

/**
 * Formats a UTC ISO string as the user's local date/time, including a
 * timezone indicator (e.g. "1 Jan 2025, 13:00 GMT+1").
 */
function formatLocalDateTime(utcIso: string): string {
  const parsed = new Date(utcIso);
  if (Number.isNaN(parsed.getTime())) return utcIso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZoneName: "short",
  }).format(parsed);
}

export function GiftWizard() {
  const { draft, saveDraft, clearDraft } = useGiftDraft();
  const {
    register,
    handleSubmit,
    trigger,
    getValues,
    setValue,
    watch,
    reset,
    formState: { errors },
    reset,
  } = useForm<CreateGiftFormInput>({
    resolver: zodResolver(createGiftSchema),
    defaultValues: {
      paymentProvider: draft?.paymentProvider ?? "paystack",
      recipientIsRegistered: false,
      recipientName: "",
      recipientEmail: "",
      amountNgn: undefined,
      message: "",
      unlockAt: "",
    },
    mode: "onTouched",
  });

  // Track whether we've shown the restore draft banner
  const [showRestoreBanner, setShowRestoreBanner] = useState(false);

  // Initialise step from draft (if available) so the wizard resumes after refresh.
  // Also re-sync step and form values whenever the draft changes — this covers
  // both the initial localStorage load (mount) and cross-tab storage events.
  const [step, setStep] = useState<number>(STEP_OCCASION);

  useEffect(() => {
    if (!draft) return;
    // Show restore banner on mount if there's a draft with meaningful data
    const hasMeaningfulData =
      draft.recipientName ||
      draft.recipientEmail ||
      draft.amountNgn ||
      draft.message ||
      draft.unlockAt;
    if (hasMeaningfulData) {
      setShowRestoreBanner(true);
    }
    // Never restore directly to the review step — require the user to complete
    // the flow again so no stale data is submitted.
    if (draft.step > STEP_OCCASION && draft.step < STEP_REVIEW) {
      setStep(draft.step);
    }
    reset({
      paymentProvider: "paystack",
      recipientIsRegistered: false,
      recipientName: draft.recipientName ?? "",
      recipientEmail: draft.recipientEmail ?? "",
      amountNgn: draft.amountNgn,
      message: draft.message ?? "",
      unlockAt: draft.unlockAt ?? "",
    });
  }, [draft, reset]);

  /**
   * Idempotency key — generated once per wizard session.
   * Sending the same key on a retry lets the server recognise the duplicate
   * and return the original result instead of creating a second gift.
   */
  const idempotencyKeyRef = useRef<string>(
    typeof crypto !== "undefined" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  );

  /** Saves current non-sensitive form values to localStorage with the given step index. */
  function persistDraft(targetStep: number) {
    const values = getValues();
    saveDraft({
      step: targetStep,
      recipientName: values.recipientName,
      recipientEmail: values.recipientEmail,
      amountNgn: values.amountNgn,
      message: values.message,
      unlockAt: values.unlockAt,
      paymentProvider: values.paymentProvider,
    });
  }

  /** Accept the restored draft — keep the data and dismiss the banner. */
  function acceptDraft() {
    setShowRestoreBanner(false);
  }

  /** Discard the restored draft — clear localStorage and reset form. */
  function discardDraft() {
    clearDraft();
    reset({
      paymentProvider: "paystack",
      recipientIsRegistered: false,
      recipientName: "",
      recipientEmail: "",
      amountNgn: undefined,
      message: "",
      unlockAt: "",
    });
    setStep(STEP_OCCASION);
    setShowRestoreBanner(false);
  }

  function handleTemplateSelect(tpl: GiftTemplate) {
    setTemplate(tpl);
    if (tpl.suggestedMessage) {
      setValue("message", tpl.suggestedMessage);
    }
    const next = STEP_RECIPIENT;
    persistDraft(next);
    setStep(next);
  }

  async function next(fields: (keyof CreateGiftFormInput)[]) {
    if (navigating) return;
    setNavigating(true);
    const valid = await trigger(fields);
    if (valid) setStep((s) => s + 1);
    setNavigating(false);
  }

  function back() {
    const prevStep = Math.max(0, step - 1);
    persistDraft(prevStep);
    setStep(prevStep);
  }

  const doSubmit = useCallback(
    async (data: CreateGiftFormInput) => {
      if (!isOnline) {
        setError("You appear to be offline. Please check your connection and try again.");
        return;
      }

      setLoading(true);
      setError(null);
      setMutationOutcome("pending");

      // Track whether we received any HTTP response before a potential error
      let responseReceived = false;

      // DateTimeInput already emits an ISO 8601 UTC string (e.g. "2025-01-01T12:00:00.000Z").
      // Normalise defensively so the backend always receives UTC, never a local-time string.
      const payload: CreateGiftFormInput = {
        ...data,
        unlockAt: toUtcIsoString(data.unlockAt),
      };

      try {
        const res = await fetch("/api/gifts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // The server can use this key to detect and deduplicate retries,
            // preventing a second gift from being created on reconnect.
            "Idempotency-Key": idempotencyKeyRef.current,
          },
          body: JSON.stringify(payload),
        });

        responseReceived = true;
        const json = await res.json();

        if (!json.success) {
          setMutationOutcome("error");
          throw new Error(json.error);
        }

        setMutationOutcome("success");
        clearDraft();
        // Stripe uses the embedded Payment Element; Paystack uses hosted checkout.
        if (json.data.clientSecret) {
          setStripeCheckout({ clientSecret: json.data.clientSecret, giftId: json.data.gift.id });
        } else {
          window.location.href = json.data.paymentUrl;
        }
      } catch (err) {
        if (!responseReceived) {
          // No HTTP response arrived — likely a connectivity drop mid-flight.
          // We explicitly flag this as "unknown" so the UI can communicate the
          // ambiguity rather than showing a plain error message.
          setMutationOutcome("unknown");
          setError(
            "Your connection dropped while the request was in flight. " +
              "We don\u2019t know if it was received. " +
              "Reconnect and press \u2018Retry\u2019 \u2014 it will not create a duplicate gift."
          );
        } else {
          setMutationOutcome("error");
          setError(err instanceof Error ? err.message : "Something went wrong");
        }
      } finally {
        setLoading(false);
      }
    },
    [isOnline]
  );

  const onSubmit = async (data: CreateGiftFormInput) => {
    await doSubmit(data);
  };

  /** Safe retry — reuses the same idempotency key so the server can deduplicate. */
  const handleRetry = () => {
    const data = getValues();
    doSubmit(data as CreateGiftFormInput);
  };

  const canRetry = mutationOutcome === "unknown" || mutationOutcome === "error";

  return (
    <div className={styles.wrapper}>
      {/* Restore draft banner — shown on mount if a draft exists in localStorage */}
      {showRestoreBanner && (
        <div
          className={styles.restoreBanner}
          role="status"
          aria-live="polite"
          aria-label="Draft restoration options"
        >
          <p className={styles.restoreMessage}>
            You have a saved draft from a previous session. Would you like to restore it?
          </p>
          <div className={styles.restoreActions}>
            <Button variant="secondary" onClick={discardDraft}>
              Discard
            </Button>
            <Button onClick={acceptDraft}>Restore</Button>
          </div>
        </div>
      )}

      {step > STEP_OCCASION && <WizardProgress currentStep={step} />}

      {/* Offline / reconnect banner — scoped to the review step where the
          mutation fires, to avoid confusing users on earlier wizard steps. */}
      {step === STEP_REVIEW && <OfflineBanner onRetry={canRetry ? handleRetry : undefined} />}

      {step === STEP_OCCASION && <TemplateSelector onSelect={handleTemplateSelect} />}

      {step === STEP_RECIPIENT && (
        <div className={styles.stepContent}>
          <h2 className={styles.stepTitle}>Who is this gift for?</h2>
          <Input
            label="Recipient's Name"
            placeholder="e.g. Amara"
            error={errors.recipientName?.message}
            {...register("recipientName")}
          />
          {/*
           * Phone is intentionally NOT pre-filled from the draft.
           * Raw phone numbers must never be persisted (issue #33 security rule).
           */}
          <Input
            label="Recipient's Phone"
            type="tel"
            placeholder="+2348012345678"
            error={errors.recipientPhone?.message}
            {...register("recipientPhone")}
          />
          <Input
            label="Recipient's Email (optional — for email notifications)"
            type="email"
            placeholder="amara@example.com"
            error={errors.recipientEmail?.message}
            {...register("recipientEmail")}
          />
          <ThemePicker value={watch("themeId")} onChange={(id) => setValue("themeId", id)} />
          <div className={styles.nav}>
            <Button variant="secondary" onClick={back}>
              Back
            </Button>
            <Button onClick={() => next(["recipientName", "recipientPhone"])} loading={navigating}>
              Next
            </Button>
          </div>
        </div>
      )}

      {step === STEP_AMOUNT && (
        <div className={styles.stepContent}>
          <h2 className={styles.stepTitle}>Amount &amp; Message</h2>
          <Input
            label="Gift Amount (₦)"
            type="number"
            placeholder="5000"
            min={500}
            error={errors.amountNgn?.message}
            {...register("amountNgn", { valueAsNumber: true })}
          />
          <div className="input-group">
            <label className="input-label" htmlFor="message">
              Personal Message (optional)
            </label>
            <textarea
              id="message"
              className="input"
              rows={4}
              placeholder="Write something heartfelt…"
              {...register("message")}
            />
            {errors.message && <span className="input-error-msg">{errors.message.message}</span>}
          </div>
          <div className={styles.nav}>
            <Button variant="secondary" onClick={back}>
              Back
            </Button>
            <Button onClick={() => next(["amountNgn"])} loading={navigating}>
              Next
            </Button>
          </div>
        </div>
      )}

      {step === STEP_UNLOCK && (
        <div className={styles.stepContent}>
          <h2 className={styles.stepTitle}>When should it unlock?</h2>
          <DateTimeInput
            label="Unlock Date &amp; Time"
            value={getValues("unlockAt")}
            onChange={(utcIso) => setValue("unlockAt", utcIso, { shouldValidate: true })}
            hint="Choose a future date and time. The recipient won't see the gift until then."
            error={errors.unlockAt?.message}
            required
          />
          {getValues("unlockAt") && (
            <p className={styles.localTimeHint} role="note">
              Your local time: {formatLocalDateTime(getValues("unlockAt"))}
            </p>
          )}
          <div className={styles.nav}>
            <Button variant="secondary" onClick={back}>
              Back
            </Button>
            <Button onClick={() => next(["unlockAt"])} loading={navigating}>
              Review Gift
            </Button>
          </div>
        </div>
      )}

      {step === STEP_REVIEW && stripeCheckout && (
        <div className={styles.stepContent}>
          <h2 className={styles.stepTitle}>Pay with card (USD)</h2>
          <StripePaymentForm
            clientSecret={stripeCheckout.clientSecret}
            giftId={stripeCheckout.giftId}
          />
        </div>
      )}

      {step === STEP_REVIEW && !stripeCheckout && (
        <form onSubmit={handleSubmit(onSubmit as Parameters<typeof handleSubmit>[0])} noValidate>
          <h2 className={styles.stepTitle}>Review your gift</h2>
          <GiftPreviewCard
            data={getValues()}
            template={template}
            onEdit={(targetStep) => {
              persistDraft(targetStep);
              setStep(targetStep);
            }}
          />

          <fieldset className={styles.providerGroup}>
            <legend className={styles.stepTitle}>Payment method</legend>
            <label className={styles.providerOption}>
              <input
                type="radio"
                value="paystack"
                {...register("paymentProvider", { onChange: () => persistDraft(STEP_UNLOCK) })}
              />
              <span>
                <span className={styles.providerLabel}>Paystack — Nigeria (NGN)</span>
                <span className={styles.providerMeta}>
                  Card, bank transfer or USSD. Charged in NGN · 1.5% processing fee. Redirects to
                  Paystack checkout.
                </span>
              </span>
            </label>
            <label className={styles.providerOption}>
              <input
                type="radio"
                value="stripe"
                {...register("paymentProvider", { onChange: () => persistDraft(STEP_UNLOCK) })}
              />
              <span>
                <span className={styles.providerLabel}>Stripe — International (USD)</span>
                <span className={styles.providerMeta}>
                  Card, Apple Pay or Google Pay. Charged in USD at the locked exchange rate · 2.9% +
                  $0.30 fee. Pay securely on this page.
                </span>
              </span>
            </label>
          </fieldset>

          {/* Safety notice — reminds users that payment is irreversible on-chain */}
          <ConfirmationSafetyNotice
            type="payment"
            isTestnet={(process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet") !== "mainnet"}
          />

          {/* Distinguish "unknown outcome" (connectivity drop mid-flight) from
              a confirmed server error so the user understands the difference. */}
          {error && mutationOutcome === "unknown" && (
            <p className={styles.unknownOutcome} role="status" aria-live="polite">
              {error}
            </p>
          )}
          {error && mutationOutcome === "error" && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <div className={styles.nav}>
            <Button type="button" variant="secondary" onClick={back} disabled={loading}>
              Back
            </Button>
            <Button type="submit" loading={loading} disabled={!isOnline}>
              {isOnline ? "Continue to Payment" : "Offline…"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}