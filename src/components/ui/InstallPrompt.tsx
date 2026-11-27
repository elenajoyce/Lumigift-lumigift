'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './InstallPrompt.module.css';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt: () => Promise<void>;
}

const VISIT_COUNT_KEY = 'pwa_visit_count';
const SNOOZE_UNTIL_KEY = 'pwa_install_snooze_until';
const SNOOZE_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MIN_VISITS = 2;

function trackEvent(name: string, params?: Record<string, unknown>): void {
  try {
    if (typeof window === 'undefined') return;
    const w = window as unknown as {
      gtag?: (...args: unknown[]) => void;
      dataLayer?: unknown[];
    };
    if (typeof w.gtag === 'function') {
      w.gtag('event', name, params);
    } else if (Array.isArray(w.dataLayer)) {
      w.dataLayer.push({ event: name, ...params });
    }
  } catch {
    // Analytics must never break the UI.
  }
}

function readNumber(key: string): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors (private mode, quota, etc.).
  }
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Increment visit counter once per mount.
    const visits = readNumber(VISIT_COUNT_KEY) + 1;
    writeValue(VISIT_COUNT_KEY, String(visits));

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      const promptEvent = event as BeforeInstallPromptEvent;
      deferredRef.current = promptEvent;
      setDeferredPrompt(promptEvent);
    };

    const handleAppInstalled = () => {
      trackEvent('pwa_install', { outcome: 'installed' });
      deferredRef.current = null;
      setDeferredPrompt(null);
      setVisible(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt,
      );
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const visits = readNumber(VISIT_COUNT_KEY);
    const snoozeUntil = readNumber(SNOOZE_UNTIL_KEY);
    const snoozed = snoozeUntil > Date.now();

    if (deferredPrompt && visits >= MIN_VISITS && !snoozed) {
      setVisible(true);
    }
  }, [deferredPrompt]);

  const handleInstall = useCallback(async () => {
    const promptEvent = deferredRef.current;
    if (!promptEvent) return;

    setInstalling(true);
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      trackEvent('pwa_install', {
        outcome: choice.outcome,
        platform: choice.platform,
      });
    } catch {
      trackEvent('pwa_install', { outcome: 'error' });
    } finally {
      deferredRef.current = null;
      setDeferredPrompt(null);
      setVisible(false);
      setInstalling(false);
    }
  }, []);

  const handleDismiss = useCallback(() => {
    writeValue(SNOOZE_UNTIL_KEY, String(Date.now() + SNOOZE_DURATION_MS));
    trackEvent('pwa_install_dismissed');
    setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <div className={styles.banner} role="dialog" aria-label="Install app">
      <div className={styles.content}>
        <span className={styles.icon} aria-hidden="true">
          📲
        </span>
        <div className={styles.text}>
          <p className={styles.title}>Add to Home Screen</p>
          <p className={styles.description}>
            Install our app for a faster, offline-ready experience.
          </p>
        </div>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.installButton}
          onClick={handleInstall}
          disabled={installing}
        >
          {installing ? 'Installing…' : 'Add to Home Screen'}
        </button>
        <button
          type="button"
          className={styles.dismissButton}
          onClick={handleDismiss}
          aria-label="Dismiss install prompt"
        >
          Not now
        </button>
      </div>
    </div>
  );
}