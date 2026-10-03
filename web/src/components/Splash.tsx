"use client";

import { useEffect, useState } from "react";
import { SPLASH_COOKIE } from "@/lib/quotes";

const SHOW_MS = 3600; // 3–5 s: long enough to read the quote, short enough not to annoy
const FADE_MS = 500;

/** Opening screen: logo, wordmark, one quote. Shown once per browser session; click / Esc / Enter skips it. */
export function Splash({ quote }: { quote: string }) {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    document.cookie = `${SPLASH_COOKIE}=1; path=/; samesite=lax`; // session cookie: skip on reloads / later visits this session
    document.body.style.overflow = "hidden";
    const t1 = setTimeout(() => setLeaving(true), SHOW_MS);
    return () => { clearTimeout(t1); document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => { setGone(true); document.body.style.overflow = ""; }, FADE_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  useEffect(() => {
    const skip = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") setLeaving(true); };
    window.addEventListener("keydown", skip);
    return () => window.removeEventListener("keydown", skip);
  }, []);

  if (gone) return null;
  return (
    <div className={`splash${leaving ? " leaving" : ""}`} role="status" aria-label="SurgiTrack is loading" onClick={() => setLeaving(true)}>
      <noscript><style>{`.splash{display:none}`}</style></noscript>
      <div className="splash-panel">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="splash-logo" src="/logo-mark.png" alt="" />
        <h1 className="splash-word head">
          <span className="splash-a" style={{ color: "var(--cream)" }}>Surgi</span>
          <span className="splash-b" style={{ color: "var(--accent)" }}>Track</span>
        </h1>
        <p className="splash-quote">{quote}</p>
        <span className="splash-skip">Click to skip</span>
        <div className="splash-bar" />
      </div>
    </div>
  );
}
