import { useCallback, useEffect, useRef, useState } from "react";

export async function copyText(text) {
  const value = String(text ?? "");
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  // Fallback for insecure contexts and embedded webviews without the async Clipboard API
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!ok) throw new Error("Copy command was rejected");
}

// state: "idle" | "copied" | "error"
export function useClipboard(resetMs = 1800) {
  const [state, setState] = useState("idle");
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const copy = useCallback(async (text) => {
    clearTimeout(timerRef.current);
    try {
      await copyText(text);
      setState("copied");
    } catch (_) {
      setState("error");
    }
    timerRef.current = setTimeout(() => setState("idle"), resetMs);
  }, [resetMs]);

  return [state, copy];
}
