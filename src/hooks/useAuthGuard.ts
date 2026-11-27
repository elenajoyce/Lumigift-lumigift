"use client";

/**
 * useAuthGuard — redirects unauthenticated users to the login page,
 * preserving a validated same-origin return URL so they land back on
 * the page they were trying to reach after signing in.
 *
 * Returns { status: "loading" | "authenticated" | "unauthenticated" }
 * so callers can render a stable loading state instead of a flash of
 * protected content.
 */

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

type GuardStatus = "loading" | "authenticated" | "unauthenticated";

interface UseAuthGuardOptions {
  /**
   * Where to send the user if they are not authenticated.
   * Defaults to "/auth/login".
   */
  loginPath?: string;
}

/**
 * Validates that a return-URL is safe (same origin, no open-redirect).
 * Only relative paths that start with "/" and do not contain "//"
 * (protocol-relative) are allowed.
 */
function isSafeReturnUrl(url: string): boolean {
  if (!url.startsWith("/")) return false;
  if (url.startsWith("//")) return false;
  // Block attempts like /\example.com
  if (/^\/[/\\]/.test(url)) return false;
  return true;
}

export function useAuthGuard({ loginPath = "/auth/login" }: UseAuthGuardOptions = {}): {
  status: GuardStatus;
} {
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (status === "unauthenticated") {
      // Preserve the full current URL (pathname + query string) so deep
      // links like /claim?token=... survive the auth redirect.
      const search = searchParams?.toString() ?? "";
      const currentUrl = search ? `${pathname}?${search}` : pathname;
      // Build a safe, validated callbackUrl
      const callbackUrl = isSafeReturnUrl(currentUrl) ? currentUrl : "/dashboard";
      router.replace(`${loginPath}?callbackUrl=${encodeURIComponent(callbackUrl)}`);
    }
  }, [status, router, pathname, searchParams, loginPath]);

  return { status: status as GuardStatus };
}
