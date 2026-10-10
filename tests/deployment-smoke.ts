// Explicit integration check against a running deployment. Creates a disposable
// project and guest link, then removes the project and signs out test sessions.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { WebSocket } from "ws";
import { initialDocument, getPageShapes, type Document } from "../lib/document";

const base = new URL(process.env.TEST_BASE_URL || "http://localhost:3000");
const endpoint = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!endpoint || !key) throw new Error("Supabase environment is required.");
const client = () =>
  createClient(endpoint, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const owner = client(),
  guest = client();
const room = `qa-${randomUUID().slice(0, 8)}`;
type Message = {
  type: string;
  role?: string;
  doc?: Document;
  opId?: string;
  id?: string;
  x?: number;
  y?: number;
};
const sockets: WebSocket[] = [];
function connect(token: string) {
  const url = new URL(`/collaborate?room=${room}`, base);
  url.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(url, { origin: base.origin });
  const messages: Message[] = [];
  let failure: Error | undefined;
  sockets.push(ws);
  ws.on("error", (error) => {
    failure = error;
  });
  ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
  ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  return { ws, messages, failure: () => failure };
}
async function wait(check: () => boolean, description: string) {
  const deadline = Date.now() + 30000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
async function main() {
  let created = false;
  let asset: string | undefined;
  try {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /ApnaDesign/);
    const a = await owner.auth.signInAnonymously({
      options: { data: { display_name: "Deployment QA" } },
    });
    if (a.error || !a.data.session)
      throw new Error(a.error?.message || "Guest login failed");
    const b = await guest.auth.signInAnonymously({
      options: { data: { display_name: "Deployment viewer QA" } },
    });
    if (b.error || !b.data.session)
      throw new Error(b.error?.message || "Viewer login failed");
    const document = initialDocument();
    const project = await owner
      .from("formwork_projects")
      .insert({
        id: room,
        owner_id: a.data.user!.id,
        title: "Disposable deployment QA",
        document,
      });
    if (project.error) throw new Error(project.error.message);
    created = true;
    const tokenHash = createHash("sha256")
      .update(randomBytes(32))
      .digest("hex");
    const share = await owner.rpc("create_project_share", {
      p_project_id: room,
      p_token_hash: tokenHash,
    });
    if (share.error) throw new Error(share.error.message);
    const claim = await guest.rpc("claim_project_share", {
      p_project_id: room,
      p_token_hash: tokenHash,
    });
    if (claim.error) throw new Error(claim.error.message);
    assert.equal(claim.data, true);
    console.log(
      "PASS: HTTPS page, anonymous login, project creation, and guest link access.",
    );

    const first = connect(a.data.session.access_token),
      second = connect(a.data.session.access_token),
      viewer = connect(b.data.session.access_token);
    await wait(
      () =>
        [first, second, viewer].every((c) =>
          c.messages.some((m) => m.type === "init"),
        ),
      "three authenticated WebSocket connections",
    );
    for (const connection of [first, second, viewer])
      assert.equal(connection.failure(), undefined);
    assert.equal(
      viewer.messages.find((m) => m.type === "init")!.role,
      "viewer",
    );
    const shape = getPageShapes(
      first.messages.find((m) => m.type === "init")!.doc!,
    ).find((s) => s.type !== "frame")!;
    const previewAt = Date.now();
    first.ws.send(
      JSON.stringify({ type: "preview", id: shape.id, x: 321, y: 222 }),
    );
    await wait(
      () =>
        second.messages.some(
          (m) => m.type === "preview" && m.id === shape.id && m.x === 321,
        ),
      "live drag preview",
    );
    console.log(
      `PASS: live WebSocket drag preview (${Date.now() - previewAt} ms observed).`,
    );
    first.ws.send(
      JSON.stringify({
        type: "op",
        opId: "qa-move",
        op: { kind: "patch", id: shape.id, patch: { x: 321 } },
      }),
    );
    second.ws.send(
      JSON.stringify({
        type: "op",
        opId: "qa-fill",
        op: { kind: "patch", id: shape.id, patch: { fill: "#123456" } },
      }),
    );
    const bothEdits = (doc?: Document) => {
      const result = doc && getPageShapes(doc).find((s) => s.id === shape.id);
      return result?.x === 321 && result.fill === "#123456";
    };
    await wait(
      () => viewer.messages.some((m) => m.type === "doc" && bothEdits(m.doc)),
      "both collaborator edits reach viewer",
    );
    await wait(
      () =>
        first.messages.some((m) => m.type === "ack" && m.opId === "qa-move") &&
        second.messages.some((m) => m.type === "ack" && m.opId === "qa-fill"),
      "saved edit acknowledgements",
    );
    viewer.ws.send(
      JSON.stringify({
        type: "op",
        opId: "qa-blocked",
        op: { kind: "title", title: "Unauthorized change" },
      }),
    );
    await wait(
      () =>
        viewer.messages.some(
          (m) => m.type === "error" && m.opId === "qa-blocked",
        ),
      "viewer write rejection",
    );
    const persisted = await owner
      .from("formwork_projects")
      .select("document")
      .eq("id", room)
      .single();
    if (persisted.error) throw new Error(persisted.error.message);
    assert.equal(bothEdits(persisted.data.document), true);
    const reconnected = connect(a.data.session.access_token);
    await wait(
      () => reconnected.messages.some((m) => m.type === "init"),
      "reconnect",
    );
    assert.equal(
      bothEdits(reconnected.messages.find((m) => m.type === "init")!.doc),
      true,
    );
    console.log(
      "PASS: concurrent edits, database persistence, viewer protection, and reconnect.",
    );

    asset = `${room}/qa.png`;
    const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    );
    const upload = await owner.storage
      .from("formwork-assets")
      .upload(asset, pixel, { contentType: "image/png" });
    if (upload.error) throw new Error(upload.error.message);
    const signed = await guest.storage
      .from("formwork-assets")
      .createSignedUrl(asset, 60);
    if (signed.error) throw new Error(signed.error.message);
    assert.equal((await fetch(signed.data.signedUrl)).status, 200);
    const blockedUpload = await guest.storage
      .from("formwork-assets")
      .upload(`${room}/blocked.png`, pixel, { contentType: "image/png" });
    assert.ok(blockedUpload.error);
    console.log(
      "PASS: private image upload, viewer image access, and viewer upload rejection.",
    );
  } finally {
    for (const socket of sockets) socket.terminate();
    if (asset) {
      const removed = await owner.storage
        .from("formwork-assets")
        .remove([asset]);
      if (removed.error)
        throw new Error(`Test asset cleanup failed: ${removed.error.message}`);
    }
    if (created) {
      const removed = await owner
        .from("formwork_projects")
        .delete()
        .eq("id", room);
      if (removed.error)
        throw new Error(
          `Test project cleanup failed: ${removed.error.message}`,
        );
    }
    await Promise.all([owner.auth.signOut(), guest.auth.signOut()]);
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
