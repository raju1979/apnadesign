"use client";
import { useEffect, useState } from "react";
import Brand from "./brand";

export default function LoadingScreen({
  message = "Opening your studio…",
  overlay = false,
}: {
  message?: string;
  overlay?: boolean;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 15000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div
      className={`studio-loading${overlay ? " studio-loading-overlay" : ""}`}
    >
      <Brand />
      <div className="studio-loading-card" role="status" aria-live="polite">
        <span className="studio-spinner" aria-hidden="true" />
        <h1>Getting your studio ready.</h1>
        <p>{message}</p>
        {slow && (
          <div className="studio-loading-slow">
            <p>
              This is taking longer than usual. Check your connection or try
              again.
            </p>
            <button
              className="primary-button"
              onClick={() => location.reload()}
            >
              Try again
            </button>
            <a href="/">Back to projects</a>
          </div>
        )}
      </div>
    </div>
  );
}
