import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GiftCard } from "@/components/gift/GiftCard";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import type { Gift } from "@/types";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stellarKey?: string }>;
}

function getGiftImage(gift: Gift | null, id: string): string {
  const giftImage = (gift as { imageUrl?: string } | null)?.imageUrl;
  if (giftImage) return giftImage;
  return `/gifts/${encodeURIComponent(id)}/opengraph-image`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const gift = await fetchGift(id).catch(() => null);

  const title = gift?.title
    ? `${gift.title} — A Time-Locked Gift Awaits`
    : "A Time-Locked Gift Awaits";
  const description =
    gift?.message ??
    gift?.description ??
    "A private gift is waiting to be opened with Lumigift.";
  const image = getGiftImage(gift, id);

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: image, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

async function fetchGift(id: string): Promise<Gift | null> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/v1/gifts/${id}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  // Other failures surface via error.tsx so the user can retry
  if (!res.ok) throw new Error(`Failed to load gift (${res.status})`);
  const json = await res.json();
  return json.success ? (json.data as Gift) : null;
}

export default async function GiftClaimPage({ params, searchParams }: Props) {
  const [{ id }, { stellarKey }] = await Promise.all([params, searchParams]);
  const gift = await fetchGift(id);
  if (!gift) notFound();

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const giftUrl = `${baseUrl}/gifts/${encodeURIComponent(id)}`;
  const image = getGiftImage(gift, id);
  const imageUrl = image.startsWith("http") ? image : `${baseUrl}${image}`;
  const amount = (gift as { amount?: string | number }).amount;
  const currency = (gift as { currency?: string }).currency ?? "NGN";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: gift.title ?? "A Time-Locked Gift Awaits",
    description:
      gift.message ??
      gift.description ??
      "A private gift is waiting to be opened with Lumigift.",
    image: [imageUrl],
    url: giftUrl,
    ...(amount !== undefined && amount !== null
      ? {
          offers: {
            "@type": "Offer",
            price: String(amount),
            priceCurrency: currency,
            availability: "https://schema.org/InStock",
            url: giftUrl,
          },
        }
      : {}),
  };

  return (
    <main
      style={{
        maxWidth: 480,
        margin: "4rem auto",
        /* horizontal padding keeps content away from viewport edges on small screens */
        padding: "0 clamp(1rem, 4vw, 1.5rem)",
      }}
    >
      <script
        type="application/ld+json"
        // JSON.stringify output is safe to inline; escape "<" to avoid breaking out of the script tag
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <OfflineBanner />
      <GiftCard gift={gift} perspective="recipient" recipientStellarKey={stellarKey} />
    </main>
  );
}
