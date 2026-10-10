import next from "next";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import {
  apply,
  getPages,
  normalizeDocument,
  validOperation,
  type Document,
} from "./lib/document";
import { userClient } from "./lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";
const port = Number(process.env.PORT || 3000),
  dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || (dev ? "0.0.0.0" : "127.0.0.1");
const app = next({ dev, hostname, port });
type Peer = {
  id: string;
  name: string;
  color: string;
  role: string;
  x?: number;
  y?: number;
  selected?: string;
};
type Connection = { peer: Peer; db: SupabaseClient; token: string };
type Room = {
  doc: Document;
  peers: Map<WebSocket, Connection>;
  queue: Promise<void>;
};
const rooms = new Map<string, Room>();
function send(ws: WebSocket, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function broadcastPeers(room: Room) {
  for (const ws of room.peers.keys())
    send(ws, {
      type: "peers",
      peers: [...room.peers.values()].map((c) => c.peer),
    });
}
async function roleFor(c: Connection, id: string) {
  const { data, error } = await c.db.rpc("get_project_role", {
    p_project_id: id,
  });
  if (error) throw error;
  return data as string | null;
}
async function refreshPeers(room: Room, id: string) {
  await Promise.all(
    [...room.peers].map(async ([ws, c]) => {
      try {
        const role = await roleFor(c, id);
        if (!role) {
          ws.close(4403, "Access removed");
          return;
        }
        if (role !== c.peer.role) {
          c.peer.role = role;
          send(ws, { type: "role", role });
        }
      } catch {
        ws.close(1011, "Unable to verify permissions");
      }
    }),
  );
}
async function main() {
  await app.prepare();
  const server = createServer(app.getRequestHandler());
  const wss = new WebSocketServer({ noServer: true, maxPayload: 100000 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname !== "/collaborate") {
      if (dev) app.getUpgradeHandler()(req, socket, head);
      else socket.destroy();
      return;
    }
    if (req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host) {
          socket.destroy();
          return;
        }
      } catch {
        socket.destroy();
        return;
      }
    }
    const roomId = url.searchParams.get("room");
    if (!roomId || !/^[a-zA-Z0-9_-]{1,64}$/.test(roomId)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      let connection: Connection | undefined,
        room: Room | undefined,
        authenticating = false;
      const timeout = setTimeout(
        () => ws.close(4401, "Sign in required"),
        10000,
      );
      ws.on("message", async (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (!connection) {
            if (
              msg.type !== "auth" ||
              typeof msg.token !== "string" ||
              authenticating
            ) {
              ws.close(4401, "Sign in required");
              return;
            }
            authenticating = true;
            const db = userClient(msg.token);
            const {
              data: { user },
              error,
            } = await db.auth.getUser(msg.token);
            if (error || !user) {
              ws.close(4401, "Session expired");
              return;
            }
            const c: Connection = {
              db,
              token: msg.token,
              peer: {
                id: crypto.randomUUID(),
                name:
                  (user.user_metadata?.display_name as string | undefined) ||
                  user.email?.split("@")[0] ||
                  "Designer",
                role: "viewer",
                color: "#7c5cff",
              },
            };
            const role = await roleFor(c, roomId);
            if (!role) {
              ws.close(4403, "You do not have access to this project");
              return;
            }
            const { data: project, error: loadError } = await db
              .from("formwork_projects")
              .select("document")
              .eq("id", roomId)
              .single();
            if (loadError || !project) {
              ws.close(4403, "Project unavailable");
              return;
            }
            if (ws.readyState !== WebSocket.OPEN) return;
            room = rooms.get(roomId);
            if (!room) {
              room = {
                doc: normalizeDocument(project.document as Document),
                peers: new Map(),
                queue: Promise.resolve(),
              };
              rooms.set(roomId, room);
            }
            connection = c;
            c.peer.role = role;
            c.peer.color = ["#7c5cff", "#d98445", "#38a78d", "#d45b85"][
              room.peers.size % 4
            ];
            room.peers.set(ws, c);
            clearTimeout(timeout);
            send(ws, { type: "init", doc: room.doc, self: c.peer.id, role });
            broadcastPeers(room);
            return;
          }
          const c = connection,
            r = room!;
          if (msg.type === "op" && validOperation(msg.op)) {
            const opId =
              typeof msg.opId === "string" && msg.opId.length <= 64
                ? msg.opId
                : undefined;
            r.queue = r.queue
              .then(async () => {
                const {
                  data: { user },
                  error,
                } = await c.db.auth.getUser(c.token);
                if (error || !user) {
                  ws.close(4401, "Session expired");
                  return;
                }
                const role = await roleFor(c, roomId);
                if (role !== "owner" && role !== "editor") {
                  send(ws, {
                    type: "error",
                    message: "This project is read-only",
                    doc: r.doc,
                    opId,
                  });
                  if (role) send(ws, { type: "role", role });
                  else ws.close(4403, "Access removed");
                  return;
                }
                const nextDoc = apply(r.doc, msg.op);
                const { data, error: saveError } = await c.db
                  .from("formwork_projects")
                  .update({
                    document: nextDoc,
                    title: nextDoc.title,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", roomId)
                  .select("id");
                if (saveError || !data?.length) {
                  send(ws, {
                    type: "error",
                    message: "Your edit could not be saved",
                    doc: r.doc,
                    opId,
                  });
                  return;
                }
                r.doc = nextDoc;
                if (opId) send(ws, { type: "ack", opId });
                await refreshPeers(r, roomId);
                for (const client of r.peers.keys())
                  if (client.readyState === WebSocket.OPEN)
                    send(client, { type: "doc", doc: r.doc });
              })
              .catch(() =>
                send(ws, {
                  type: "error",
                  message: "Unable to verify or save this edit",
                  doc: r.doc,
                  opId,
                }),
              );
          } else if (msg.type === "permissions") {
            await refreshPeers(r, roomId);
            broadcastPeers(r);
          } else if (msg.type === "preview") {
            // Drag previews are ephemeral. Only collaborators with edit access
            // may publish them; the final position is persisted by the op path.
            if (
              (c.peer.role === "owner" || c.peer.role === "editor") &&
              typeof msg.id === "string" &&
              msg.id.length <= 64 &&
              Number.isFinite(msg.x) &&
              Number.isFinite(msg.y) &&
              Math.abs(msg.x) <= 100000 &&
              Math.abs(msg.y) <= 100000 &&
              getPages(r.doc).some((page) =>
                page.shapes.some((shape) => shape.id === msg.id),
              )
            ) {
              for (const client of r.peers.keys())
                if (client !== ws)
                  send(client, {
                    type: "preview",
                    peerId: c.peer.id,
                    id: msg.id,
                    x: msg.x,
                    y: msg.y,
                  });
            }
          } else if (msg.type === "presence") {
            if (typeof msg.name === "string")
              c.peer.name = msg.name.slice(0, 32);
            if (Number.isFinite(msg.x) && Number.isFinite(msg.y)) {
              c.peer.x = msg.x;
              c.peer.y = msg.y;
            }
            c.peer.selected =
              typeof msg.selected === "string" ? msg.selected : undefined;
            broadcastPeers(r);
          }
        } catch {
          send(ws, { type: "error", message: "Invalid message" });
        }
      });
      ws.on("close", () => {
        clearTimeout(timeout);
        if (room) {
          room.peers.delete(ws);
          broadcastPeers(room);
          if (!room.peers.size) {
            const old = room;
            void old.queue.finally(() => {
              if (!old.peers.size && rooms.get(roomId) === old)
                rooms.delete(roomId);
            });
          }
        }
      });
    });
  });
  const sweep = setInterval(() => {
    for (const [id, room] of rooms) void refreshPeers(room, id);
  }, 5000);
  sweep.unref();
  server.listen(port, hostname, () =>
    console.log(`ApnaDesign ready at http://${hostname}:${port}`),
  );
}
main().catch(console.error);
