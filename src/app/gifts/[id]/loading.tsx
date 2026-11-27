import { GiftCardSkeleton } from "@/components/gift/GiftCardSkeleton";

const mainStyle = { maxWidth: 480, margin: "4rem auto", padding: "0 clamp(1rem, 4vw, 1.5rem)" };

const cardStyle = {
  background: "#fff",
  borderRadius: 16,
  boxShadow: "0 4px 24px rgba(0, 0, 0, 0.08)",
  padding: "clamp(1.5rem, 5vw, 2rem)",
  display: "flex",
  flexDirection: "column" as const,
  gap: "1.25rem",
};

const bannerStyle = {
  height: 40,
  borderRadius: 8,
  background: "#f0f0f0",
  marginBottom: "1rem",
};

const headerRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
};

const emojiStyle = {
  width: 48,
  height: 48,
  borderRadius: "50%",
  background: "#f0f0f0",
  flexShrink: 0,
};

const headerTextStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: "0.5rem",
  flex: 1,
};

const occasionStyle = {
  height: 20,
  width: "60%",
  borderRadius: 4,
  background: "#f0f0f0",
};

const recipientStyle = {
  height: 16,
  width: "40%",
  borderRadius: 4,
  background: "#f0f0f0",
};

const amountStyle = {
  height: 40,
  width: "50%",
  borderRadius: 6,
  background: "#f0f0f0",
  margin: "0.5rem 0",
};

const messageStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: "0.5rem",
};

const messageLineStyle = {
  height: 16,
  borderRadius: 4,
  background: "#f0f0f0",
};

const buttonStyle = {
  height: 48,
  borderRadius: 8,
  background: "#f0f0f0",
  marginTop: "0.5rem",
};

export default function GiftClaimLoading() {
  return (
    <main style={mainStyle} aria-busy="true">
      <div style={bannerStyle} aria-hidden="true" />
      <div style={cardStyle} aria-hidden="true">
        <div style={headerRowStyle}>
          <div style={emojiStyle} />
          <div style={headerTextStyle}>
            <div style={occasionStyle} />
            <div style={recipientStyle} />
          </div>
        </div>
        <div style={amountStyle} />
        <div style={messageStyle}>
          <div style={{ ...messageLineStyle, width: "100%" }} />
          <div style={{ ...messageLineStyle, width: "85%" }} />
          <div style={{ ...messageLineStyle, width: "60%" }} />
        </div>
        <div style={buttonStyle} />
      </div>
      <GiftCardSkeleton count={0} />
    </main>
  );
}