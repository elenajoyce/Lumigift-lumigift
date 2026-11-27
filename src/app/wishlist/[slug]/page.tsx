import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getWishlist } from "@/server/services/wishlist.service";
import { FulfilWishButton } from "@/components/gift/FulfilWishButton";
import { formatNGN } from "@/lib/currency";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const wish = await getWishlist(slug);
  if (!wish) {
    return {
      title: "Wishlist not found",
      description: "This wishlist could not be found on Lumigift.",
    };
  }

  const title = `${wish.title} — A Lumigift Wish`;
  const description = `${wish.recipientName} is wishing for ${formatNGN(
    wish.targetAmountNgn
  )} on Lumigift.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
    },
  };
}

export default async function WishlistPage({ params }: Props) {
  const { slug } = await params;
  const wish = await getWishlist(slug);
  if (!wish) notFound();

  const fulfilled = wish.status === "fulfilled";

  return (
    <main className="wishlist-page">
      <style>{`
        .wishlist-page {
          max-width: 960px;
          margin: 0 auto;
          padding: 24px 16px;
        }
        .wishlist-page h1 {
          font-size: 1.75rem;
          margin-bottom: 8px;
          word-break: break-word;
        }
        .wishlist-summary {
          margin-bottom: 24px;
          color: #444;
          line-height: 1.5;
        }
        .wishlist-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
          gap: 16px;
        }
        .wishlist-item {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 16px;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          background: #fff;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        }
        .wishlist-item__amount {
          font-size: 1.25rem;
          font-weight: 700;
        }
        .wishlist-item__description {
          color: #374151;
          line-height: 1.4;
          word-break: break-word;
        }
        .wishlist-item__status {
          font-size: 0.875rem;
          font-weight: 600;
        }
        .wishlist-item__status--fulfilled {
          color: #16a34a;
        }
        .wishlist-item__status--unfulfilled {
          color: #b45309;
        }
        .wishlist-item__action {
          margin-top: auto;
        }
        .wishlist-item--fulfilled {
          opacity: 0.6;
          background: #f9fafb;
        }
        .wishlist-item--fulfilled .wishlist-item__amount,
        .wishlist-item--fulfilled .wishlist-item__description {
          text-decoration: line-through;
          color: #9ca3af;
        }
        @media (max-width: 480px) {
          .wishlist-page {
            padding: 16px 12px;
          }
          .wishlist-page h1 {
            font-size: 1.375rem;
          }
          .wishlist-grid {
            grid-template-columns: 1fr;
            gap: 12px;
          }
          .wishlist-item {
            padding: 14px;
          }
        }
      `}</style>

      <h1>{wish.title}</h1>
      <p className="wishlist-summary">
        {wish.recipientName} is wishing for{" "}
        <strong>{formatNGN(wish.targetAmountNgn)}</strong>, unlocking on{" "}
        {new Date(wish.unlockAt).toDateString()}.
      </p>
      <p className="wishlist-summary">
        Status: <strong>{fulfilled ? "Fulfilled ✓" : "Unfulfilled"}</strong>
      </p>

      {wish.items && wish.items.length > 0 ? (
        <div className="wishlist-grid">
          {wish.items.map((item) => {
            const itemFulfilled = item.status === "fulfilled";
            return (
              <div
                key={item.id}
                className={`wishlist-item${
                  itemFulfilled ? " wishlist-item--fulfilled" : ""
                }`}
              >
                <div className="wishlist-item__amount">
                  {formatNGN(item.amountNgn)}
                </div>
                <div className="wishlist-item__description">
                  {item.description}
                </div>
                <div
                  className={`wishlist-item__status ${
                    itemFulfilled
                      ? "wishlist-item__status--fulfilled"
                      : "wishlist-item__status--unfulfilled"
                  }`}
                >
                  {itemFulfilled ? "Fulfilled ✓" : "Unfulfilled"}
                </div>
                {!itemFulfilled && (
                  <div className="wishlist-item__action">
                    <FulfilWishButton slug={wish.slug} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        !fulfilled && (
          <div className="wishlist-item__action">
            <FulfilWishButton slug={wish.slug} />
          </div>
        )
      )}
    </main>
  );
}