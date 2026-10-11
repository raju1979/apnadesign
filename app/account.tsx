"use client";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { initialDocument } from "../lib/document";
import Brand from "./brand";
import {
  ArrowUpRight,
  Plus,
  LogIn,
  LogOut,
  LockKeyhole,
  Mail,
  UserRound,
} from "lucide-react";
type Project = {
  id: string;
  title: string;
  owner_id: string;
  updated_at: string;
};
export default function Account({ session }: { session: Session | null }) {
  const [mode, setMode] = useState<"guest" | "signin" | "signup" | "forgot">(
      "guest",
    ),
    [displayName, setDisplayName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    if (new URLSearchParams(location.search).get("auth") === "signin")
      setMode("signin");
  }, []);
  useEffect(() => {
    if (session)
      supabase
        .from("formwork_projects")
        .select("id,title,owner_id,updated_at")
        .order("updated_at", { ascending: false })
        .then(({ data, error }) => {
          if (error) setMessage(error.message);
          else setProjects(data || []);
        });
  }, [session?.user.id]);
  async function authenticate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(
          email.trim(),
          {
            redirectTo: `${location.origin}/reset-password`,
          },
        );
        if (error) throw error;
        setMessage(
          "If an account exists for this email, you’ll receive a password reset link.",
        );
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: location.origin,
            data: { display_name: displayName.trim() },
          },
        });
        if (error) throw error;
        if (!data.session)
          setMessage("Check your email to confirm your account, then sign in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to sign in");
    } finally {
      setBusy(false);
    }
  }
  async function enterAsGuest(e: React.FormEvent) {
    e.preventDefault();
    const name = displayName.trim();
    if (!name) return;
    setBusy(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.signInAnonymously({
        options: { data: { display_name: name } },
      });
      if (error) throw error;
      localStorage.setItem("formwork-name", name);
    } catch (e) {
      setMessage(
        e instanceof Error
          ? `${e.message}. If guest entry is disabled, enable Anonymous Sign-Ins under Supabase Authentication → Sign In / Providers.`
          : "Unable to enter as a guest.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    setBusy(true);
    setMessage("");
    const id = crypto.randomUUID().slice(0, 8),
      doc = initialDocument();
    const { error } = await supabase.from("formwork_projects").insert({
      id,
      owner_id: session!.user.id,
      title: doc.title,
      document: doc,
    });
    if (error) {
      setMessage(error.message);
      setBusy(false);
    } else location.href = `?room=${id}`;
  }
  return (
    <main className="account-page">
      <header className="account-header">
        <Brand />
        {session && (
          <button
            className="account-signout"
            onClick={() => supabase.auth.signOut()}
          >
            <LogOut size={15} />
            Sign out
          </button>
        )}
      </header>
      {session ? (
        <section className="workspace">
          <span className="account-eyebrow">YOUR CREATIVE SPACE</span>
          <div className="workspace-heading">
            <div>
              <h1>Make something together.</h1>
              <p>
                {session.user.is_anonymous
                  ? `Guest session · ${session.user.user_metadata.display_name || "Designer"}`
                  : `Signed in as ${session.user.email}`}
              </p>
            </div>
            <button className="share-button" disabled={busy} onClick={create}>
              <Plus size={16} />
              New design
            </button>
          </div>
          {message && (
            <div className="auth-message" role="status">
              {message}
            </div>
          )}
          <div className="projects-grid">
            {projects.map((p) => (
              <a className="project-card" href={`?room=${p.id}`} key={p.id}>
                <div className="project-preview">
                  <span>leaf & light</span>
                  <b>
                    Ideas belong
                    <br />
                    out in the world.
                  </b>
                  <i />
                </div>
                <div className="project-card-info">
                  <div>
                    <b>{p.title}</b>
                    <small>
                      {p.owner_id === session.user.id
                        ? "Owned by you"
                        : "Shared with you"}{" "}
                      · {new Date(p.updated_at).toLocaleDateString()}
                    </small>
                  </div>
                  <ArrowUpRight size={19} />
                </div>
              </a>
            ))}
            {!projects.length && (
              <button
                className="empty-project"
                onClick={create}
                disabled={busy}
              >
                <Plus size={30} />
                <b>Your first idea starts here</b>
                <span>Create a design and invite someone to join.</span>
              </button>
            )}
          </div>
          <p className="workspace-note">
            <LockKeyhole size={14} />
            {session.user.is_anonymous
              ? "Guest designs stay with this browser session. Keep this browser data to keep access."
              : "Projects are private. You decide who can view or edit."}
          </p>
        </section>
      ) : (
        <section className="auth-layout">
          <div className="auth-story">
            <span className="account-eyebrow">A SPACE FOR YOUR IDEAS</span>
            <h1>
              Good design.
              <br />
              Great company.
            </h1>
            <p>
              A canvas to explore, a place to collaborate.
              <br />
              Turn your next idea into something real.
            </p>
            <div className="auth-art">
              <span className="art-square" />
              <span className="art-circle" />
              <span className="art-label">made together ↗</span>
            </div>
          </div>
          <div className="auth-card">
            <span className="modal-icon">
              {mode === "guest" ? <UserRound size={23} /> : <Mail size={23} />}
            </span>
            <h2>
              {mode === "guest"
                ? "Come on in."
                : mode === "signup"
                  ? "Create your account."
                  : mode === "forgot"
                    ? "Reset your password."
                    : "Welcome back."}
            </h2>
            <p>
              {mode === "guest"
                ? "Type your name to step into the studio."
                : mode === "signup"
                  ? "A little space for your next big idea."
                  : mode === "forgot"
                    ? "Enter your email and we’ll send you a reset link."
                    : "Sign in to pick up where you left off."}
            </p>
            <form onSubmit={mode === "guest" ? enterAsGuest : authenticate}>
              {mode === "signin" && (
                <button
                  className="auth-switch"
                  onClick={() => {
                    setMode("forgot");
                    setMessage("");
                    setPassword("");
                  }}
                >
                  Forgot password?
                </button>
              )}
              {mode === "guest" ? (
                <label>
                  Your name
                  <input
                    type="text"
                    autoComplete="nickname"
                    maxLength={32}
                    required
                    autoFocus
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Alex"
                  />
                </label>
              ) : (
                <>
                  {mode === "signup" && (
                    <label>
                      Your name
                      <input
                        type="text"
                        maxLength={32}
                        required
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                      />
                    </label>
                  )}
                  <label>
                    Email
                    <input
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  {mode !== "forgot" && (
                    <label>
                      Password
                      <input
                        type="password"
                        autoComplete={
                          mode === "signup"
                            ? "new-password"
                            : "current-password"
                        }
                        minLength={mode === "signup" ? 8 : undefined}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </label>
                  )}
                </>
              )}
              {message && (
                <div className="auth-message" role="status">
                  {message}
                </div>
              )}
              <button className="primary-button" disabled={busy}>
                {busy
                  ? "Please wait…"
                  : mode === "guest"
                    ? "Enter the studio"
                    : mode === "signup"
                      ? "Create account"
                      : mode === "forgot"
                        ? "Send reset link"
                        : "Sign in"}
                {mode === "guest" ? (
                  <ArrowUpRight size={16} />
                ) : (
                  <LogIn size={16} />
                )}
              </button>
            </form>
            {mode === "guest" ? (
              <>
                <button
                  className="auth-switch"
                  onClick={() => {
                    setMode("signup");
                    setMessage("");
                  }}
                >
                  New here? Create an account
                </button>
                <button
                  className="auth-switch"
                  onClick={() => {
                    setMode("signin");
                    setMessage("");
                  }}
                >
                  Already have an account? Sign in
                </button>
              </>
            ) : (
              <button
                className="auth-switch"
                onClick={() => {
                  setMode(
                    mode === "signup" || mode === "forgot"
                      ? "signin"
                      : "signup",
                  );
                  setMessage("");
                }}
              >
                {mode === "signup" || mode === "forgot"
                  ? "Back to sign in"
                  : "New here? Create an account"}
              </button>
            )}
            {mode !== "guest" && (
              <button
                className="auth-switch"
                onClick={() => {
                  setMode("guest");
                  setMessage("");
                }}
              >
                Continue without an account? Enter your name
              </button>
            )}
            <div className="auth-footnote">
              <LockKeyhole size={12} /> Secured by Supabase
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
