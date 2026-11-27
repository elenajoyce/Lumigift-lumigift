/**
 * @jest-environment jsdom
 *
 * Unit tests for the shared DateTimeInput component (issue #51).
 *
 * Coverage areas:
 * - Accessibility: label, hint, error, aria-invalid, aria-describedby
 * - UTC conversion: value displayed as local time; onChange called with UTC ISO
 * - min/max semantics: min defaults to now; custom min/max honoured
 * - Locale / timezone edge cases
 * - DST ambiguity warning
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { DateTimeInput } from "../DateTimeInput";

/* ──────────────────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────────────────── */

/** Returns a fixed UTC ISO string for a known point in time. */
const FIXED_UTC = "2025-06-15T08:00:00.000Z"; // 08:00 UTC

/** Mock the user's local timezone offset to +1 h (e.g. WAT, UTC+1). */
function mockTimezoneOffset(offsetMinutes: number) {
  const original = Date.prototype.getTimezoneOffset;
  beforeEach(() => {
    jest.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-offsetMinutes); // getTimezoneOffset returns negative for east of UTC
  });
  afterEach(() => {
    Date.prototype.getTimezoneOffset = original;
  });
}

/* ──────────────────────────────────────────────────────────────────────────
   Test suite
   ────────────────────────────────────────────────────────────────────────── */

describe("DateTimeInput – accessibility", () => {
  it("renders a visible label linked to the input via htmlFor/id", () => {
    render(<DateTimeInput label="Unlock Date" />);
    const input = screen.getByLabelText("Unlock Date");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "datetime-local");
  });

  it("shows hint text below the input when no error is present", () => {
    render(<DateTimeInput label="Unlock Date" hint="Choose a future date" />);
    expect(screen.getByText("Choose a future date")).toBeInTheDocument();
  });

  it("does not show hint when error is present", () => {
    render(
      <DateTimeInput label="Unlock Date" hint="Choose a future date" error="Date is required" />
    );
    expect(screen.queryByText("Choose a future date")).not.toBeInTheDocument();
    expect(screen.getByText("Date is required")).toBeInTheDocument();
  });

  it("marks input as aria-invalid when error prop is set", () => {
    render(<DateTimeInput label="Unlock Date" error="Invalid date" />);
    const input = screen.getByLabelText("Unlock Date");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("sets aria-invalid=false when no error", () => {
    render(<DateTimeInput label="Unlock Date" />);
    const input = screen.getByLabelText("Unlock Date");
    expect(input).toHaveAttribute("aria-invalid", "false");
  });

  it("error message has role=alert and is referenced by aria-describedby", () => {
    render(<DateTimeInput label="Unlock Date" error="Date must be in future" />);
    const errorEl = screen.getByRole("alert");
    expect(errorEl).toHaveTextContent("Date must be in future");

    const input = screen.getByLabelText("Unlock Date");
    const describedBy = input.getAttribute("aria-describedby") ?? "";
    expect(describedBy).toContain(errorEl.id);
  });

  it("hint is referenced by aria-describedby when no error", () => {
    render(<DateTimeInput label="Unlock Date" hint="Pick carefully" />);
    const hintEl = screen.getByText("Pick carefully");
    const input = screen.getByLabelText("Unlock Date");
    const describedBy = input.getAttribute("aria-describedby") ?? "";
    expect(describedBy).toContain(hintEl.id);
  });

  it("renders timezone information", () => {
    render(<DateTimeInput label="Unlock Date" />);
    // Timezone display should be present (exact value depends on the test runner's TZ)
    expect(screen.getByText(/UTC|GMT|[A-Z]{2,5}/)).toBeInTheDocument();
  });

  it("is disabled when disabled prop is passed", () => {
    render(<DateTimeInput label="Unlock Date" disabled />);
    expect(screen.getByLabelText("Unlock Date")).toBeDisabled();
  });

  it("uses a custom id when provided", () => {
    render(<DateTimeInput label="Unlock Date" id="custom-id" />);
    const input = document.getElementById("custom-id");
    expect(input).toBeInTheDocument();
  });
});

describe("DateTimeInput – UTC conversion", () => {
  it("converts UTC ISO value to local datetime-local format for display", () => {
    // In the test runner (UTC+0), 2025-06-15T08:00:00.000Z should show as 2025-06-15T08:00
    render(<DateTimeInput label="Unlock Date" value={FIXED_UTC} />);
    const input = screen.getByLabelText("Unlock Date") as HTMLInputElement;
    // The displayed value should be in YYYY-MM-DDTHH:mm format (16 chars)
    expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("calls onChange with a UTC ISO string when the user picks a date", () => {
    const handleChange = jest.fn();
    render(<DateTimeInput label="Unlock Date" onChange={handleChange} />);
    const input = screen.getByLabelText("Unlock Date");

    fireEvent.change(input, { target: { value: "2025-12-25T10:00" } });

    expect(handleChange).toHaveBeenCalledTimes(1);
    const [calledWith] = handleChange.mock.calls[0];
    // Result should be a valid ISO string
    expect(() => new Date(calledWith)).not.toThrow();
    expect(new Date(calledWith).toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("calls onChange with empty string when input is cleared", () => {
    const handleChange = jest.fn();
    render(<DateTimeInput label="Unlock Date" value={FIXED_UTC} onChange={handleChange} />);
    const input = screen.getByLabelText("Unlock Date");

    fireEvent.change(input, { target: { value: "" } });

    expect(handleChange).toHaveBeenCalledWith("");
  });

  it("renders empty input when value prop is empty string", () => {
    render(<DateTimeInput label="Unlock Date" value="" />);
    const input = screen.getByLabelText("Unlock Date") as HTMLInputElement;
    expect(input.value).toBe("");
  });
});

describe("DateTimeInput – min/max semantics", () => {
  it("sets a default min attribute to prevent past dates", () => {
    render(<DateTimeInput label="Unlock Date" />);
    const input = screen.getByLabelText("Unlock Date");
    const min = input.getAttribute("min");
    expect(min).toBeTruthy();
    // min should be in datetime-local format
    expect(min).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("applies a custom minUtc attribute", () => {
    const minUtc = "2025-01-01T00:00:00.000Z";
    render(<DateTimeInput label="Unlock Date" minUtc={minUtc} />);
    const input = screen.getByLabelText("Unlock Date");
    const min = input.getAttribute("min");
    expect(min).toMatch(/^2025-01-01T/);
  });

  it("applies a custom maxUtc attribute", () => {
    const maxUtc = "2025-12-31T23:59:59.000Z";
    render(<DateTimeInput label="Unlock Date" maxUtc={maxUtc} />);
    const input = screen.getByLabelText("Unlock Date");
    expect(input.getAttribute("max")).toMatch(/^2025-12-31T/);
  });

  it("does not set a max attribute when maxUtc is not provided", () => {
    render(<DateTimeInput label="Unlock Date" />);
    const input = screen.getByLabelText("Unlock Date");
    expect(input.getAttribute("max")).toBeNull();
  });
});

describe("DateTimeInput – timezone conversion (#481)", () => {
  const originalGetTimezoneOffset = Date.prototype.getTimezoneOffset;

  afterEach(() => {
    Date.prototype.getTimezoneOffset = originalGetTimezoneOffset;
  });

  /**
   * Force the runtime's local timezone offset (in minutes east of UTC).
   * `getTimezoneOffset()` returns minutes *behind* UTC, so we negate.
   */
  function setOffsetMinutesEast(minutesEast: number) {
    Date.prototype.getTimezoneOffset = () => -minutesEast;
  }

  it("converts WAT (UTC+1) local input to the correct UTC ISO string", () => {
    setOffsetMinutesEast(60); // WAT = UTC+1
    const handleChange = jest.fn();
    render(<DateTimeInput label="Unlock Date" onChange={handleChange} />);
    const input = screen.getByLabelText("Unlock Date");

    // 10:00 local in WAT is 09:00 UTC
    fireEvent.change(input, { target: { value: "2025-12-25T10:00" } });

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(handleChange.mock.calls[0][0]).toBe("2025-12-25T09:00:00.000Z");
  });

  it("converts UTC-5 local input to the correct UTC ISO string", () => {
    setOffsetMinutesEast(-300); // UTC-5 (e.g. EST)
    const handleChange = jest.fn();
    render(<DateTimeInput label="Unlock Date" onChange={handleChange} />);
    const input = screen.getByLabelText("Unlock Date");

    // 10:00 local in UTC-5 is 15:00 UTC
    fireEvent.change(input, { target: { value: "2025-12-25T10:00" } });

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(handleChange.mock.calls[0][0]).toBe("2025-12-25T15:00:00.000Z");
  });

  it("converts UTC+5:30 (IST) local input to the correct UTC ISO string", () => {
    setOffsetMinutesEast(330); // UTC+5:30
    const handleChange = jest.fn();
    render(<DateTimeInput label="Unlock Date" onChange={handleChange} />);
    const input = screen.getByLabelText("Unlock Date");

    // 10:00 local in UTC+5:30 is 04:30 UTC
    fireEvent.change(input, { target: { value: "2025-12-25T10:00" } });

    expect(handleChange.mock.calls[0][0]).toBe("2025-12-25T04:30:00.000Z");
  });

  it("displays a UTC value as local time in WAT (UTC+1)", () => {
    setOffsetMinutesEast(60);
    render(<DateTimeInput label="Unlock Date" value="2025-12-25T09:00:00.000Z" />);
    const input = screen.getByLabelText("Unlock Date") as HTMLInputElement;

    // 09:00 UTC should display as 10:00 local in WAT
    expect(input.value).toBe("2025-12-25T10:00");
  });

  it("displays a UTC value as local time in UTC-5", () => {
    setOffsetMinutesEast(-300);
    render(<DateTimeInput label="Unlock Date" value="2025-12-25T15:00:00.000Z" />);
    const input = screen.getByLabelText("Unlock Date") as HTMLInputElement;

    // 15:00 UTC should display as 10:00 local in UTC-5
    expect(input.value).toBe("2025-12-25T10:00");
  });

  it("shows a timezone indicator alongside the local time", () => {
    setOffsetMinutesEast(60);
    render(<DateTimeInput label="Unlock Date" />);
    // A timezone indicator (e.g. "UTC+1", "GMT+1", or an abbreviation) must be shown
    expect(screen.getByText(/UTC[+-]\d|GMT[+-]\d|[A-Z]{2,5}/)).toBeInTheDocument();
  });
});

describe("DateTimeInput – locale and timezone edge cases", () => {
  it("returns a valid UTC ISO string for any local datetime-local value", () => {
    const handleChange = jest.fn();
    render(<DateTimeInput label="Unlock Date" onChange={handleChange} />);
    const input = screen.getByLabelText("Unlock Date");

    // Simulate entering a date in local format
    fireEvent.change(input, { target: { value: "2026-03-01T12:00" } });

    const utcResult: string = handleChange.mock.calls[0][0];
    const parsed = new Date(utcResult);
    expect(isNaN(parsed.getTime())).toBe(false);
  });

  it("renders without crashing when value is an invalid string", () => {
    // Should not throw; just display an empty input
    expect(() => render(<DateTimeInput label="Unlock Date" value="not-a-date" />)).not.toThrow();
    const input = screen.getByLabelText("Unlock Date") as HTMLInputElement;
    expect(input.value).toBe("");
  });
});
