import { ReactNode, CSSProperties } from "react";

interface GlassProps {
  className?: string;
  children: ReactNode;
  glow?: string;
  style?: CSSProperties;
  dark?: boolean;
}

// IMPORTANT: className must supply the positioning class (absolute/fixed/etc).
// Never adds `relative` to the outer wrapper — it overrides `absolute` in Tailwind's CSS order.
export default function Glass({ className = "", children, glow, style, dark = true }: GlassProps) {
  return (
    <div
      className={className}
      style={{
        backdropFilter: "blur(28px) saturate(210%) brightness(1.08)",
        WebkitBackdropFilter: "blur(28px) saturate(210%) brightness(1.08)",
        background: dark
          ? "linear-gradient(145deg,rgba(255,255,255,0.12) 0%,rgba(255,255,255,0.04) 55%,rgba(255,255,255,0.07) 100%)"
          : "linear-gradient(145deg,rgba(0,0,0,0.10) 0%,rgba(0,0,0,0.03) 55%,rgba(0,0,0,0.07) 100%)",
        border: `1px solid ${dark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.14)"}`,
        borderTopColor:  dark ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.20)",
        borderLeftColor: dark ? "rgba(255,255,255,0.20)" : "rgba(0,0,0,0.15)",
        boxShadow: [
          dark ? "0 16px 48px rgba(0,0,0,0.55)" : "0 8px 32px rgba(0,0,0,0.16)",
          dark ? "inset 0 1px 0 rgba(255,255,255,0.22)" : "inset 0 1px 0 rgba(255,255,255,0.5)",
          glow ? `0 0 32px ${glow}` : "",
        ].filter(Boolean).join(", "),
        ...style,
      }}
    >
      {/* Top-left specular highlight */}
      <div style={{
        position: "absolute", inset: 0, borderRadius: "inherit", pointerEvents: "none",
        background: dark
          ? "linear-gradient(138deg,rgba(255,255,255,0.15) 0%,rgba(255,255,255,0.05) 25%,transparent 52%)"
          : "linear-gradient(138deg,rgba(255,255,255,0.55) 0%,rgba(255,255,255,0.15) 25%,transparent 52%)",
      }} />
      {/* Diagonal shimmer stripe */}
      <div style={{
        position: "absolute", inset: 0, borderRadius: "inherit", pointerEvents: "none",
        background: "linear-gradient(116deg,transparent 34%,rgba(255,255,255,0.055) 50%,transparent 66%)",
      }} />
      <div style={{ position: "relative" }}>{children}</div>
    </div>
  );
}
