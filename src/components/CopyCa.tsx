"use client";

import { useState } from "react";

export function CopyCa({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ca"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <span>{label}</span>
      <b>{value}</b>
      <i>{copied ? "Copied" : "Copy"}</i>
    </button>
  );
}
