// Run against the active server with two real Supabase sessions.
// These tokens stay in environment variables, never URLs or test output.
import assert from "node:assert/strict";
import { WebSocket } from "ws";
const room = process.env.TEST_ROOM,
  editor = process.env.TEST_EDITOR_TOKEN,
  viewer = process.env.TEST_VIEWER_TOKEN;
if (!room || !editor || !viewer)
  throw Error(
    "Set TEST_ROOM, TEST_EDITOR_TOKEN and TEST_VIEWER_TOKEN for an invited viewer and owner/editor.",
  );
function client(token: string) {
  const ws = new WebSocket(`ws://localhost:3000/collaborate?room=${room}`);
  const messages: any[] = [];
  ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
  ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  return { ws, messages };
}
async function wait(predicate: () => boolean) {
  const deadline = Date.now() + 15000;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw Error("Timed out waiting for authenticated collaboration");
    await new Promise((r) => setTimeout(r, 25));
  }
}
async function main() {
  const a = client(editor!),
    b = client(viewer!);
  try {
    await wait(
      () =>
        a.messages.some((m) => m.type === "init") &&
        b.messages.some((m) => m.type === "init"),
    );
    assert.equal(b.messages.find((m) => m.type === "init").role, "viewer");
    const before = a.messages.find((m) => m.type === "init").doc.title;
    b.ws.send(
      JSON.stringify({
        type: "op",
        op: { kind: "title", title: "UNAUTHORIZED" },
      }),
    );
    await wait(() => b.messages.some((m) => m.type === "error"));
    assert.equal(b.messages.find((m) => m.type === "error").doc.title, before);
    a.ws.send(
      JSON.stringify({ type: "op", op: { kind: "title", title: before } }),
    );
    await wait(() => b.messages.some((m) => m.type === "doc"));
    console.log(
      "PASS: viewer receives shared document, viewer mutation rejected, editor mutation accepted.",
    );
  } finally {
    a.ws.close();
    b.ws.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
