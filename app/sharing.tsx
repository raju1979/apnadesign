"use client";
import { useEffect, useState } from "react";
import { X, Share2, Copy, Check, Trash2, Plus } from "lucide-react";
import { supabase, type Role } from "../lib/supabase";
type Member = { email: string; role: "editor" | "viewer" };
type GuestLink = { token_hash: string; created_at: string };
async function hashToken(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
function newShareToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export default function Sharing({
  room,
  role,
  onClose,
  onChange,
}: {
  room: string;
  role: Role | null;
  onClose: () => void;
  onChange: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]),
    [email, setEmail] = useState(""),
    [inviteRole, setInviteRole] = useState<"viewer" | "editor">("viewer"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false),
    [guestLink, setGuestLink] = useState<GuestLink | null>(null),
    [guestUrl, setGuestUrl] = useState("");
  async function load() {
    const { data, error } = await supabase
      .from("formwork_members")
      .select("email,role")
      .eq("project_id", room)
      .order("email");
    if (error) setMessage(error.message);
    else setMembers(data || []);
  }
  useEffect(() => {
    if (role === "owner") {
      void load();
      void loadGuestLink();
    }
  }, [room, role]);
  async function loadGuestLink() {
    const { data, error } = await supabase
      .from("formwork_share_links")
      .select("token_hash,created_at")
      .eq("project_id", room)
      .is("revoked_at", null)
      .maybeSingle();
    if (error) {
      setMessage(error.message);
      return;
    }
    setGuestLink(data as GuestLink | null);
    const token = sessionStorage.getItem(`formwork-share-token:${room}`);
    if (data && token && (await hashToken(token)) === data.token_hash) {
      const url = new URL("/", location.origin);
      url.searchParams.set("room", room);
      url.searchParams.set("share", token);
      setGuestUrl(url.toString());
    } else setGuestUrl("");
  }
  async function grant(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const { error } = await supabase.from("formwork_members").upsert(
      {
        project_id: room,
        email: email.trim().toLowerCase(),
        role: inviteRole,
      },
      { onConflict: "project_id,email" },
    );
    if (error) setMessage(error.message);
    else {
      setEmail("");
      setMessage(
        "Access granted. Copy the room link and send it to your collaborator.",
      );
      await load();
      onChange();
    }
    setBusy(false);
  }
  async function change(member: Member, role: string) {
    setMessage("");
    const { error } = await supabase
      .from("formwork_members")
      .update({ role })
      .eq("project_id", room)
      .eq("email", member.email);
    if (error) setMessage(error.message);
    else {
      await load();
      onChange();
    }
  }
  async function remove(member: Member) {
    const { error } = await supabase
      .from("formwork_members")
      .delete()
      .eq("project_id", room)
      .eq("email", member.email);
    if (error) setMessage(error.message);
    else {
      await load();
      onChange();
    }
  }
  async function createGuestLink() {
    setBusy(true);
    setMessage("");
    try {
      const token = newShareToken();
      const tokenHash = await hashToken(token);
      const { error } = await supabase.rpc("create_project_share", {
        p_project_id: room,
        p_token_hash: tokenHash,
      });
      if (error) throw error;
      const url = new URL("/", location.origin);
      url.searchParams.set("room", room);
      url.searchParams.set("share", token);
      sessionStorage.setItem(`formwork-share-token:${room}`, token);
      setGuestUrl(url.toString());
      setMessage("Guest link created. Anyone with it can view this design.");
      await loadGuestLink();
      onChange();
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Unable to create guest link.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function revokeGuestLink() {
    setBusy(true);
    setMessage("");
    const { data, error } = await supabase.rpc("revoke_project_share", {
      p_project_id: room,
    });
    if (error) setMessage(error.message);
    else {
      sessionStorage.removeItem(`formwork-share-token:${room}`);
      setGuestLink(null);
      setGuestUrl("");
      setMessage(
        data
          ? "Guest link revoked. Visitors who used it have lost access."
          : "There was no active guest link to revoke.",
      );
      onChange();
    }
    setBusy(false);
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="share-modal permissions-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="modal-close icon-button"
          aria-label="Close sharing"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <span className="modal-icon">
          <Share2 size={23} />
        </span>
        <h2>Better, together.</h2>
        <p>
          {role === "owner"
            ? "Invite a collaborator and choose what they can do."
            : "This project is private. Only the owner can grant access."}
        </p>
        {role === "owner" && (
          <>
            <form className="invite-form" onSubmit={grant}>
              <label>
                Collaborator email
                <input
                  type="email"
                  required
                  aria-label="Collaborator email"
                  placeholder="designer@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <div className="invite-options">
                <select
                  aria-label="Invite role"
                  value={inviteRole}
                  onChange={(e) =>
                    setInviteRole(e.target.value as "viewer" | "editor")
                  }
                >
                  <option value="viewer">Viewer — can view</option>
                  <option value="editor">Editor — can edit</option>
                </select>
                <button className="share-button" disabled={busy}>
                  <Plus size={14} />
                  Grant access
                </button>
              </div>
            </form>
            <div className="members-list">
              {members.map((m) => (
                <div className="member" key={m.email}>
                  <span title={m.email}>{m.email}</span>
                  <select
                    aria-label={`Role for ${m.email}`}
                    value={m.role}
                    onChange={(e) => change(m, e.target.value)}
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                  </select>
                  <button
                    aria-label={`Remove ${m.email}`}
                    onClick={() => remove(m)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <section className="guest-share">
              <h3>Anonymous guest link</h3>
              <p>
                Anyone with this link can view the design. Guest links are
                view-only.
              </p>
              {guestLink && (
                <div className="guest-link-status">
                  A guest link is active. Creating a replacement will invalidate
                  the old link.
                </div>
              )}
              {guestUrl && (
                <div className="share-link">
                  <input
                    readOnly
                    aria-label="Anonymous guest link"
                    value={guestUrl}
                  />
                  <button
                    aria-label="Copy anonymous guest link"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(guestUrl);
                        setCopied(true);
                        setMessage("Guest link copied.");
                      } catch {
                        setMessage("Select and copy the guest link above.");
                      }
                    }}
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
              )}
              <div className="invite-options guest-link-actions">
                <button
                  className="share-button"
                  disabled={busy}
                  onClick={createGuestLink}
                >
                  <Plus size={14} />
                  {guestLink ? "Replace guest link" : "Create guest link"}
                </button>
                {guestLink && (
                  <button
                    className="revoke-link"
                    disabled={busy}
                    onClick={revokeGuestLink}
                  >
                    Revoke
                  </button>
                )}
              </div>
            </section>
          </>
        )}
        {message && (
          <div className="auth-message" role="status">
            {message}
          </div>
        )}
        <div className="share-link">
          <input readOnly aria-label="Room link" value={location.href} />
          <button
            aria-label="Copy room link"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(location.href);
                setCopied(true);
              } catch {
                setMessage("Select and copy the link above.");
              }
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
        <div className="share-note">
          The project link above is restricted to invited accounts.
          <br />
          Collaborators must sign in with the email you invite. No email is sent
          automatically. Guest links are separate and view-only.
        </div>
      </div>
    </div>
  );
}
