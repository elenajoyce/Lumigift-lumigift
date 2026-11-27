"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useCsrf } from "@/hooks/useCsrf";

export function FulfilWishButton({
  slug,
  className,
  fullWidth = false,
}: {
  slug: string;
  className?: string;
  fullWidth?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const { csrfFetch } = useCsrf();

  const { mutate, isPending } = useMutation({
    mutationFn: async (): Promise<string> => {
      const res = await csrfFetch(`/api/v1/wishlists/${slug}/fulfil`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentProvider: "paystack" }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Could not fulfil this wish");
      return json.data.paymentUrl;
    },
    onMutate: () => setError(null),
    onSuccess: (paymentUrl) => {
      window.location.href = paymentUrl;
    },
    onError: (err: Error) => setError(err.message),
  });

  const buttonClasses = [
    "btn",
    "btn--primary",
    "btn--lg",
    fullWidth ? "btn--block" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={fullWidth ? "w-full" : undefined}>
      <button
        type="button"
        className={buttonClasses}
        style={{ minHeight: "44px", minWidth: "44px" }}
        disabled={isPending}
        aria-busy={isPending}
        onClick={() => mutate()}
      >
        {isPending ? "Starting…" : "Fulfil this wish"}
      </button>
      <p
        role="alert"
        aria-live="assertive"
        className="form-error"
        style={error ? { marginTop: "0.5rem" } : { display: "none" }}
      >
        {error}
      </p>
    </div>
  );
}