import React, { useState } from "react";

/**
 * Authentic ABYX brand icon with flawless fallback to prevent broken image icons.
 */
export default function BrandMark({ size = 26, className = "", title = "ABYX" }) {
  const [loadFailed, setLoadFailed] = useState(false);

  if (loadFailed) {
    return (
      <div
        className={`brand-mark-fallback ${className}`}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: "6px",
          background: "linear-gradient(135deg, #0984e3, #6c5ce7)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#ffffff",
          fontWeight: 800,
          fontSize: `${Math.max(10, Math.round(size * 0.55))}px`,
          userSelect: "none",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)"
        }}
        title={title}
      >
        A
      </div>
    );
  }

  return (
    <img
      src="/icon-transparent.png"
      alt=""
      className={`brand-mark-img ${className}`}
      width={size}
      height={size}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        objectFit: "contain",
        borderRadius: "6px",
        display: "inline-block",
        verticalAlign: "middle"
      }}
      onError={() => setLoadFailed(true)}
    />
  );
}

