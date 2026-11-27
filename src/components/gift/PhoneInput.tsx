"use client";

/**
 * PhoneInput — E.164-normalising phone number input (issue #469)
 *
 * Features:
 *  - Accepts any E.164 format (+[country code][number])
 *  - Country selector dropdown with flag icons
 *  - Live E.164 normalisation via src/lib/phone.ts
 *  - Human-readable formatted preview below the input
 *  - Validation error displayed for unrecognisable numbers
 *  - Defaults to Nigerian (+234); international dropdown enables full E.164 input
 *  - Nigerian-specific OTP flow unchanged (defaultNigerian=true)
 */

import { useState, forwardRef, useCallback } from "react";
import type { ChangeEvent, FocusEvent } from "react";
import { normalizePhone } from "@/lib/phone";
import styles from "./PhoneInput.module.css";

// ── Country data ──────────────────────────────────────────────────────────────

interface Country {
  code: string; // dial code e.g. "+234"
  iso: string; // ISO 3166-1 alpha-2 e.g. "NG"
  name: string;
  flag: string; // emoji flag
  placeholder: string;
}

const COUNTRIES: Country[] = [
  { code: "+234", iso: "NG", name: "Nigeria", flag: "🇳🇬", placeholder: "0801 234 5678" },
  { code: "+1", iso: "US", name: "United States", flag: "🇺🇸", placeholder: "415 555 2671" },
  { code: "+44", iso: "GB", name: "United Kingdom", flag: "🇬🇧", placeholder: "7911 123456" },
  { code: "+49", iso: "DE", name: "Germany", flag: "🇩🇪", placeholder: "151 23456789" },
  { code: "+33", iso: "FR", name: "France", flag: "🇫🇷", placeholder: "6 12 34 56 78" },
  { code: "+91", iso: "IN", name: "India", flag: "🇮🇳", placeholder: "98765 43210" },
  { code: "+27", iso: "ZA", name: "South Africa", flag: "🇿🇦", placeholder: "71 234 5678" },
  { code: "+254", iso: "KE", name: "Kenya", flag: "🇰🇪", placeholder: "712 345 678" },
  { code: "+233", iso: "GH", name: "Ghana", flag: "🇬🇭", placeholder: "24 123 4567" },
  { code: "+1", iso: "CA", name: "Canada", flag: "🇨🇦", placeholder: "416 555 1234" },
];

const DEFAULT_COUNTRY = COUNTRIES[0]; // Nigeria

// ── Human-readable formatter ──────────────────────────────────────────────────

function formatE164Human(e164: string): string {
  if (!e164.startsWith("+")) return e164;

  if (e164.startsWith("+234") && e164.length === 14) {
    return `+234 ${e164.slice(4, 7)} ${e164.slice(7, 10)} ${e164.slice(10)}`;
  }

  if (e164.startsWith("+1") && e164.length === 12) {
    return `+1 ${e164.slice(2, 5)} ${e164.slice(5, 8)} ${e164.slice(8)}`;
  }

  const digits = e164.slice(1);
  if (digits.length <= 4) return e164;
  const ccLen = digits.length > 11 ? 3 : digits.length > 9 ? 2 : 1;
  const cc = digits.slice(0, ccLen);
  const rest = digits.slice(ccLen);
  return `+${cc} ${rest}`;
}

// ── Component props ───────────────────────────────────────────────────────────

interface PhoneInputProps {
  /** Field name used by react-hook-form register. */
  name?: string;
  /** Controlled or initial value (raw or E.164). */
  value?: string;
  /** Error message from react-hook-form validation. */
  error?: string;
  /** Called whenever the underlying input changes. */
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  /** Called when the input loses focus. */
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  /** Whether to default to Nigerian (+234) mode (true by default). */
  defaultNigerian?: boolean;
  /** aria-label for the input. */
  label?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(
  {
    name,
    value: controlledValue,
    error,
    onChange,
    onBlur,
    defaultNigerian = true,
    label = "Recipient's Phone",
  },
  ref
) {
  const [rawValue, setRawValue] = useState(controlledValue ?? "");
  const [selectedCountry, setSelectedCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [touched, setTouched] = useState(false);

  // When the user picks a country, prepend its dial code to the current number
  // (stripping any existing dial code first so we don't double-prefix).
  const handleCountryChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const country = COUNTRIES.find((c) => c.iso === e.target.value) ?? DEFAULT_COUNTRY;
      setSelectedCountry(country);
      // Strip any existing leading + prefix so the dial code is clean
      const stripped = rawValue.replace(/^\+\d{1,3}/, "").trim();
      setRawValue(`${country.code}${stripped}`);
    },
    [rawValue]
  );

  // Derived normalisation state — computed on every render (cheap)
  // Try the raw value as-is first; if that fails, prepend the country code.
  const valueForNorm = rawValue.startsWith("+") ? rawValue : `${selectedCountry.code}${rawValue}`;
  const normalized = normalizePhone(valueForNorm) ?? normalizePhone(rawValue);
  const humanFormatted = normalized ? formatE164Human(normalized) : null;

  const showError = touched && error;
  const showNormalized = touched && rawValue.length > 3 && normalized;
  const showInvalidHint = touched && rawValue.length > 3 && !normalized && !error;

  const placeholder = `${selectedCountry.code} ${selectedCountry.placeholder}`;

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setRawValue(e.target.value);
      onChange?.(e);
    },
    [onChange]
  );

  const handleBlur = useCallback(
    (e: FocusEvent<HTMLInputElement>) => {
      setTouched(true);
      onBlur?.(e);
    },
    [onBlur]
  );

  // For the Nigerian OTP flow, the defaultNigerian prop keeps the selector
  // locked to +234 by pre-selecting Nigeria — the flow itself is unaffected.
  const selectValue = defaultNigerian && !touched ? "NG" : selectedCountry.iso;

  return (
    <div className={styles.wrapper}>
      {/* Label */}
      <label className={styles.label} htmlFor={name}>
        {label}
      </label>

      {/* Country selector + phone input row */}
      <div className={styles.inputRow}>
        <select
          className={styles.countrySelect}
          value={selectValue}
          onChange={handleCountryChange}
          aria-label="Country code"
          title="Select country code"
        >
          {COUNTRIES.map((c) => (
            <option key={`${c.iso}-${c.code}`} value={c.iso}>
              {c.flag} {c.code}
            </option>
          ))}
        </select>

        <input
          ref={ref}
          id={name}
          name={name}
          type="tel"
          autoComplete="tel"
          className={`${styles.input} ${showError ? styles.inputError : ""}`}
          placeholder={placeholder}
          value={controlledValue !== undefined ? controlledValue : rawValue}
          onChange={handleChange}
          onBlur={handleBlur}
          aria-invalid={!!showError}
          aria-describedby={
            [showError && `${name}-error`, showNormalized && `${name}-hint`]
              .filter(Boolean)
              .join(" ") || undefined
          }
        />
      </div>

      {/* Live E.164 normalisation preview */}
      {showNormalized && humanFormatted && (
        <p id={`${name}-hint`} className={styles.hint} aria-live="polite">
          ✓ Will be stored as <span className={styles.e164}>{normalized}</span>
          {" · "}
          <span className={styles.human}>{humanFormatted}</span>
        </p>
      )}

      {/* Unrecognisable number hint (before Zod fires) */}
      {showInvalidHint && (
        <p className={styles.invalidHint} aria-live="polite">
          Enter a valid phone number, e.g. {selectedCountry.code} {selectedCountry.placeholder}
        </p>
      )}

      {/* react-hook-form validation error */}
      {showError && (
        <p id={`${name}-error`} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
});
