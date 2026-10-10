import { WebSocket } from "ws";
import assert from "node:assert/strict";
const base = new URL(process.env.TEST_BASE_URL || "http://localhost:3000");
const socketUrl = new URL("/collaborate?room=secure", base);
socketUrl.protocol = base.protocol === "https:" ? "wss:" : "ws:";
async function reject(message: unknown) {
  return new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(socketUrl);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(Error("Authentication check timed out"));
    }, 15000);
    socket.on("open", () => socket.send(JSON.stringify(message)));
    socket.on("message", () => {
      clearTimeout(timer);
      socket.terminate();
      reject(Error("Unauthenticated client received project data"));
    });
    socket.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    socket.on("error", reject);
  });
}
async function main() {
  assert.equal(
    await reject({
      type: "op",
      role: "owner",
      op: { kind: "title", title: "Unauthorized" },
    }),
    4401,
  );
  assert.equal(
    await reject({ type: "auth", token: "invalid-token", role: "owner" }),
    4401,
  );
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(socketUrl, {
      origin: "https://untrusted.example",
    });
    ws.on("open", () => {
      ws.terminate();
      reject(Error("Cross-origin handshake accepted"));
    });
    ws.on("error", () => resolve());
  });
  console.log(
    "PASS: unauthenticated edits, forged sessions, and cross-origin connections rejected.",
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
