"use client";

import { useEffect, useState } from "react";
import styles from "./ThemeToggle.module.css";

type Theme = "dark" | "light";

const STORAGE_KEY = "theme";
const LIGHT_QUERY = "(prefers-color-scheme: light)";

/**
 * Reads the persisted theme from localStorage, if any.
 * Returns null when the user has never toggled (or the value is invalid).
 */
function getStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "dark" || stored === "light" ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Reads the OS colour-scheme preference.
 * Must only be called after mount (requires window).
 */
function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia(LIGHT_QUERY).matches ? "light" : "dark";
}

/**
 * Resolves the active theme: a stored user preference always wins,
 * otherwise fall back to the OS preference.
 */
function getInitialTheme(): Theme {
  return getStoredTheme() ?? getSystemTheme();
}

/**
 * ThemeToggle — switches between dark and light mode.
 *
 * Behaviour:
 * - On first mount, reads theme from localStorage; falls back to OS preference.
 * - Writes the user's choice to localStorage so it survives page reloads.
 * - Sets `data-theme` on <html> so CSS tokens pick up the correct palette.
 * - Renders `null` until mounted to avoid a server/client hydration mismatch
 *   (the inline script in layout.tsx already applies the correct class before
 *   paint, so there is no visible flash of wrong theme).
 * - Keyboard accessible: standard <button>, full focus ring via globals.css.
 * - aria-label is updated dynamically to announce the *next* action.
 * - aria-pressed reflects the current state for AT users.
 */
export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");

  // Sync theme state from DOM / localStorage on mount only.
  // Using `suppressHydrationWarning` on <html> in layout.tsx means the
  // server-rendered markup is accepted as-is; this effect corrects state.
  useEffect(() => {
    const t = getInitialTheme();
    setTheme(t);
    document.documentElement.setAttribute("data-theme", t);
    setMounted(true);
  }, []);

  // Follow the OS preference while the user has no stored choice.
  useEffect(() => {
    if (!mounted) return;
    const mql = window.matchMedia(LIGHT_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      if (getStoredTheme() !== null) return;
      const next: Theme = event.matches ? "light" : "dark";
      setTheme(next);
      document.documentElement.setAttribute("data-theme", next);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [mounted]);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable (private mode, quota) — theme still applies.
    }
  }

  // Render nothing until mounted — the FOUC-prevention script in layout.tsx
  // already set `data-theme` before React hydrates, so the page looks correct
  // even while this component is invisible.
  if (!mounted) {
    return (
      <button
        className={styles.toggle}
        aria-label="Toggle colour theme"
        aria-pressed={false}
        disabled
        aria-hidden="true"
      />
    );
  }

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      className={styles.toggle}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      aria-pressed={!isDark}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
    >
      {/* Icon is decorative — aria-label on the button carries the meaning */}
      <span aria-hidden="true">{isDark ? "☀️" : "🌙"}</span>
    </button>
  );
}
