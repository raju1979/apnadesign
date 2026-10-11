"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import Account from "./account";
import Brand from "./brand";
import LoadingScreen from "./loading-screen";
const Editor = dynamic(() => import("./editor"), {
  ssr: false,
  loading: () => <LoadingScreen />,
});
export default function Page() {
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(false),
    [routeReady, setRouteReady] = useState(false),
    [room, setRoom] = useState<string | null>(null),
    [shareToken, setShareToken] = useState<string | null>(null),
    [shareStatus, setShareStatus] = useState<"loading" | "ready" | "invalid">(
      "loading",
    );
  useEffect(() => {
    const authResult = new URLSearchParams(location.hash.slice(1));
    if (authResult.has("error") || authResult.get("type") === "recovery") {
      location.replace(`/reset-password${location.hash}`);
      return;
    }
    const params = new URLSearchParams(location.search);
    setRoom(params.get("room"));
    setShareToken(params.get("share"));
    setRouteReady(true);
    let cancelled = false;
    let receivedAuthEvent = false;
    const fallback = window.setTimeout(() => {
      if (!cancelled) setReady(true);
    }, 5000);
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      receivedAuthEvent = true;
      if (!cancelled) {
        setSession(s);
        setReady(true);
      }
    });
    void supabase.auth
      .getSession()
      .then(({ data: result }) => {
        if (cancelled) return;
        // Auth events are authoritative if they arrive while getSession is pending.
        if (!receivedAuthEvent) setSession(result.session);
        setReady(true);
      })
      .catch(() => {
        // A failed session read should still let the user reach the sign-in screen.
        if (!cancelled) setReady(true);
      })
      .finally(() => window.clearTimeout(fallback));
    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
      data.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!routeReady) return;
    if (!shareToken || !session || !room) {
      setShareStatus("ready");
      return;
    }
    let cancelled = false;
    setShareStatus("loading");
    void (async () => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(shareToken),
      );
      const tokenHash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const { data, error } = await supabase.rpc("claim_project_share", {
        p_project_id: room,
        p_token_hash: tokenHash,
      });
      if (cancelled) return;
      if (error || data !== true) {
        setShareStatus("invalid");
        return;
      }
      const cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete("share");
      history.replaceState(
        null,
        "",
        `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`,
      );
      setShareToken(null);
      setShareStatus("ready");
    })().catch(() => {
      if (!cancelled) setShareStatus("invalid");
    });
    return () => {
      cancelled = true;
    };
  }, [routeReady, room, session?.user.id, shareToken]);
  if (!ready) return <LoadingScreen />;
  if (!session) return <Account session={session} />;
  if (!routeReady || (shareToken && shareStatus === "loading"))
    return <LoadingScreen message="Checking your guest link…" />;
  if (shareStatus === "invalid")
    return (
      <main className="account-page">
        <header className="account-header">
          <Brand />
        </header>
        <section className="auth-layout">
          <div className="auth-card">
            <h2>Guest link unavailable.</h2>
            <p>
              This link may have expired or been revoked. Ask the owner for a
              new guest link.
            </p>
            <a className="primary-button" href="/">
              Back to your projects
            </a>
          </div>
        </section>
      </main>
    );
  if (!room) return <Account session={session} />;
  return <Editor session={session} roomId={room} />;
}
