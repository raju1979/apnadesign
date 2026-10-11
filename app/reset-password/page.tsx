"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import Brand from "../brand";

export default function ResetPassword() {
  const [ready, setReady] = useState(false);
  const [valid, setValid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.has("error")) {
      setMessage(
        params.get("error_code") === "otp_expired"
          ? "This reset link has expired or has already been used. Request a fresh email and open its newest link once."
          : "We couldn’t verify this reset link. Please request a new one.",
      );
      history.replaceState(null, "", location.pathname);
      setValid(false);
      setReady(true);
      return;
    }
    let cancelled = false;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!cancelled && event === "PASSWORD_RECOVERY") {
        setValid(!!session && !session.user.is_anonymous);
        setReady(true);
      }
    });
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (cancelled) return;
        setValid(!error && !!data.session && !data.session.user.is_anonymous);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setMessage("Passwords do not match.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword("");
      setConfirm("");
      setDone(true);
      await supabase.auth.signOut({ scope: "local" });
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to update your password.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="account-page">
      <header className="account-header">
        <Brand />
      </header>
      <section className="auth-layout">
        <div className="auth-card">
          <h2>{done ? "Password updated." : "Choose a new password."}</h2>
          {!ready ? (
            <p>Checking your reset link…</p>
          ) : done ? (
            <>
              <p>You can now sign in with your new password.</p>
              <a className="primary-button" href="/?auth=signin">
                Back to sign in
              </a>
            </>
          ) : !valid ? (
            <>
              <p>
                {message ||
                  "This reset link is unavailable or has expired. Request a new link from the sign-in screen."}
              </p>
              <a className="primary-button" href="/?auth=signin">
                Back to sign in
              </a>
            </>
          ) : (
            <>
              <p>Use at least 8 characters.</p>
              <form onSubmit={save}>
                <label>
                  New password
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <label>
                  Confirm new password
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </label>
                {message && (
                  <div className="auth-message" role="status">
                    {message}
                  </div>
                )}
                <button className="primary-button" disabled={busy}>
                  {busy ? "Saving…" : "Update password"}
                </button>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
