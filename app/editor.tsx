"use client";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import {
  Stage,
  Layer,
  Rect,
  Ellipse,
  Text,
  Image as KonvaImage,
  Transformer,
  Group,
  Line,
} from "react-konva";
import Konva from "konva";
import {
  MousePointer2,
  Square,
  Circle,
  Type,
  Hand,
  Plus,
  Minus,
  Undo2,
  Redo2,
  Download,
  Share2,
  ChevronDown,
  ChevronRight,
  Layers,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  PanelLeft,
  PanelRight,
  Check,
  Command,
  X,
  ImagePlus,
  Play,
  PanelsTopLeft,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from "lucide-react";
import {
  apply,
  getPageShapes,
  getPages,
  initialDocument,
  normalizeDocument,
  type Document,
  type Shape,
  type Operation,
} from "../lib/document";
import type { Session } from "@supabase/supabase-js";
import { supabase, canEdit, type Role } from "../lib/supabase";
import Sharing from "./sharing";
import Brand from "./brand";
import { containingFrameId, withAutomaticFrame } from "../lib/frames";
import {
  fitViewport,
  javascriptGeometry,
  loadGeometryEngine,
  type GeometryEngine,
} from "../lib/geometry";
type Peer = {
  id: string;
  name: string;
  color: string;
  x?: number;
  y?: number;
  selected?: string;
};
type DragPreview = { peerId: string; x: number; y: number };
type Tool = "select" | "rect" | "ellipse" | "text" | "frame" | "hand";
type QueuedOperation = { id: string; op: Operation };

const MAX_IMAGE_BYTES = 500_000;
const MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024;
const WEBP_QUALITIES = [0.92, 0.86, 0.8, 0.74, 0.68, 0.62, 0.56, 0.5, 0.44];

async function prepareImage(file: File) {
  const objectUrl = URL.createObjectURL(file);
  let image: HTMLImageElement;
  try {
    image = await new Promise((resolve, reject) => {
      const element = new window.Image();
      element.onload = () => resolve(element);
      element.onerror = () =>
        reject(new Error("This image could not be opened."));
      element.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  if (!sourceWidth || !sourceHeight)
    throw new Error("This image has invalid dimensions.");
  if (file.size <= MAX_IMAGE_BYTES)
    return { file, width: sourceWidth, height: sourceHeight, converted: false };
  if (file.type === "image/gif")
    throw new Error(
      "Animated GIFs must already be 500 KB or smaller to preserve animation.",
    );

  let scale = Math.min(1, 2560 / Math.max(sourceWidth, sourceHeight));
  while (scale >= 0.16) {
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not prepare this image.");
    context.drawImage(image, 0, 0, width, height);

    for (const quality of WEBP_QUALITIES) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", quality),
      );
      if (!blob)
        throw new Error("Your browser could not convert this image to WebP.");
      if (blob.type !== "image/webp")
        throw new Error("WebP conversion is not supported by this browser.");
      if (blob.size <= MAX_IMAGE_BYTES) {
        return {
          file: new File([blob], file.name, {
            type: "image/webp",
            lastModified: file.lastModified,
          }),
          width,
          height,
          converted: true,
        };
      }
    }
    scale *= 0.82;
  }
  throw new Error(
    "This image could not be reduced below 500 KB. Try a smaller image.",
  );
}

function CanvasImage({
  src,
  ...props
}: Omit<ComponentProps<typeof KonvaImage>, "image"> & { src: string }) {
  const [image, setImage] = useState<HTMLImageElement>();
  useEffect(() => {
    const element = new window.Image();
    element.crossOrigin = "anonymous";
    element.onload = () => setImage(element);
    element.src = src;
    return () => {
      element.onload = null;
    };
  }, [src]);
  return <KonvaImage {...props} image={image} />;
}

function PrototypePreview({
  shapes,
  imageUrls,
  onClose,
}: {
  shapes: Shape[];
  imageUrls: Record<string, string>;
  onClose: () => void;
}) {
  const frames = shapes.filter((s) => s.type === "frame" && !s.hidden);
  const [activeId, setActiveId] = useState(frames[0]?.id || "");
  const [viewport, setViewport] = useState({ width: 1000, height: 700 });
  const frame = frames.find((s) => s.id === activeId) || frames[0];
  useEffect(() => {
    const resize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  if (!frame)
    return (
      <div className="prototype-overlay">
        <div className="prototype-bar">
          <b>Prototype preview</b>
          <button onClick={onClose}>Close</button>
        </div>
        <p>Create a frame before previewing this design.</p>
      </div>
    );
  const scale = Math.min(
    (viewport.width - 80) / frame.width,
    (viewport.height - 150) / frame.height,
    1.5,
  );
  const x = (viewport.width - frame.width * scale) / 2;
  const y = (viewport.height - frame.height * scale) / 2 + 24;
  const visible = shapes.filter(
    (s) => s.type !== "frame" && s.frameId === frame.id && !s.hidden,
  );
  function navigate(s: Shape) {
    if (
      s.targetFrameId &&
      frames.some((candidate) => candidate.id === s.targetFrameId)
    )
      setActiveId(s.targetFrameId);
  }
  return (
    <div className="prototype-overlay">
      <div className="prototype-bar">
        <b>Prototype preview</b>
        <span>{frame.name}</span>
        <button onClick={onClose}>
          Close preview <X size={14} />
        </button>
      </div>
      <Stage width={viewport.width} height={viewport.height}>
        <Layer
          x={x - frame.x * scale}
          y={y - frame.y * scale}
          scaleX={scale}
          scaleY={scale}
        >
          <Rect
            x={frame.x}
            y={frame.y}
            width={frame.width}
            height={frame.height}
            fill={frame.fill}
            cornerRadius={frame.radius || 0}
            listening={false}
          />
          <Group
            clipX={frame.x}
            clipY={frame.y}
            clipWidth={frame.width}
            clipHeight={frame.height}
          >
            {visible.map((s) => {
              const common = {
                x: s.x,
                y: s.y,
                width: s.width,
                height: s.height,
                rotation: s.rotation,
                onClick: () => navigate(s),
                onTap: () => navigate(s),
              };
              if (s.type === "rect")
                return (
                  <Rect
                    key={s.id}
                    {...common}
                    fill={s.fill}
                    cornerRadius={s.radius || 0}
                  />
                );
              if (s.type === "ellipse")
                return (
                  <Ellipse
                    key={s.id}
                    {...common}
                    x={s.x + s.width / 2}
                    y={s.y + s.height / 2}
                    radiusX={s.width / 2}
                    radiusY={s.height / 2}
                    fill={s.fill}
                  />
                );
              if (s.type === "image") {
                const src = s.assetPath ? imageUrls[s.assetPath] : undefined;
                return src ? (
                  <CanvasImage key={s.id} {...common} src={src} />
                ) : null;
              }
              if (s.type === "text")
                return (
                  <Text
                    key={s.id}
                    {...common}
                    text={s.text || ""}
                    fill={s.fill}
                    fontSize={s.fontSize || 24}
                    fontFamily={s.fontFamily || "Arial"}
                    fontStyle={s.fontStyle || "normal"}
                    align={s.align || "left"}
                  />
                );
              return null;
            })}
          </Group>
        </Layer>
      </Stage>
      <div className="prototype-hint">Click linked objects to navigate</div>
    </div>
  );
}
export default function Editor({
  session,
  roomId,
}: {
  session: Session;
  roomId: string;
}) {
  const [role, setRole] = useState<Role | null>(null),
    [accessError, setAccessError] = useState("");
  const editable = canEdit(role);
  const [doc, setDoc] = useState<Document>(initialDocument()),
    [activePageId, setActivePageId] = useState("page-1"),
    [collapsedPages, setCollapsedPages] = useState<Record<string, boolean>>({}),
    [selected, setSelected] = useState<string>(),
    [tool, setTool] = useState<Tool>("select"),
    [spacePanning, setSpacePanning] = useState(false),
    [canvasDragging, setCanvasDragging] = useState(false),
    [zoom, setZoom] = useState(0.8),
    [pan, setPan] = useState({ x: 36, y: 32 }),
    [geometry, setGeometry] = useState<GeometryEngine>(javascriptGeometry),
    [size, setSize] = useState({ width: 900, height: 800 }),
    [peers, setPeers] = useState<Peer[]>([]),
    [previews, setPreviews] = useState<Record<string, DragPreview>>({}),
    [imageUrls, setImageUrls] = useState<Record<string, string>>({}),
    [self, setSelf] = useState(""),
    [status, setStatus] = useState("Connecting"),
    [room, setRoom] = useState("welcome"),
    [share, setShare] = useState(false),
    [copied, setCopied] = useState(false),
    [notice, setNotice] = useState(""),
    [name, setName] = useState("Designer"),
    [historyVersion, setHistoryVersion] = useState(0),
    [panels, setPanels] = useState({ layers: true, properties: true }),
    [compact, setCompact] = useState(false),
    [mobilePanel, setMobilePanel] = useState<"layers" | "properties" | null>(
      null,
    ),
    [uploading, setUploading] = useState(false),
    [prototypeOpen, setPrototypeOpen] = useState(false);
  const ws = useRef<WebSocket | null>(null),
    stage = useRef<Konva.Stage | null>(null),
    transformer = useRef<Konva.Transformer | null>(null),
    container = useRef<HTMLDivElement>(null),
    canvasSize = useRef<{ width: number; height: number } | null>(null),
    imageInput = useRef<HTMLInputElement>(null),
    docRef = useRef(doc),
    selectionRef = useRef(selected),
    selfRef = useRef(""),
    nameRef = useRef(name),
    undo = useRef<Operation[]>([]),
    redo = useRef<Operation[]>([]),
    initialFit = useRef<string | null>(null),
    lastPresence = useRef(0),
    lastPreview = useRef(new Map<string, number>()),
    previewTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>()),
    pending = useRef<QueuedOperation[]>([]),
    reconnectAttempts = useRef(0);
  docRef.current = doc;
  selectionRef.current = selected;
  nameRef.current = name;
  const pages = getPages(doc);
  const activePage = pages.find((page) => page.id === activePageId) || pages[0];
  const activeShapes = activePage.shapes;
  const layersOpen = compact ? mobilePanel === "layers" : panels.layers;
  const propertiesOpen = compact
    ? mobilePanel === "properties"
    : panels.properties;
  function togglePanel(panel: "layers" | "properties") {
    if (compact)
      setMobilePanel((current) => (current === panel ? null : panel));
    else setPanels((current) => ({ ...current, [panel]: !current[panel] }));
  }
  function toggleBothPanels() {
    if (compact) setMobilePanel((current) => (current ? null : "properties"));
    else
      setPanels((current) => {
        const open = !current.layers && !current.properties;
        return { layers: open, properties: open };
      });
  }
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void loadGeometryEngine().then((engine) => {
      if (!cancelled) setGeometry(engine);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!pages.some((page) => page.id === activePageId)) {
      setActivePageId(pages[0].id);
      setSelected(undefined);
    }
  }, [pages, activePageId]);
  useEffect(() => {
    const el = container.current!;
    const observer = new ResizeObserver(() => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      const previous = canvasSize.current;
      if (previous) {
        setPan((current) => ({
          x: current.x + (next.width - previous.width) / 2,
          y: current.y + (next.height - previous.height) / 2,
        }));
      }
      canvasSize.current = next;
      setSize(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const imagePathKey = activeShapes
    .filter((s) => s.type === "image" && s.assetPath)
    .map((s) => s.assetPath!)
    .sort()
    .join("\n");
  useEffect(() => {
    const paths = [...new Set(imagePathKey.split("\n").filter(Boolean))];
    let cancelled = false;
    async function refreshSignedUrls() {
      const entries = await Promise.all(
        paths.map(async (path) => {
          const { data, error } = await supabase.storage
            .from("formwork-assets")
            .createSignedUrl(path, 3600);
          return [path, error ? "" : data.signedUrl] as const;
        }),
      );
      if (!cancelled)
        setImageUrls(
          Object.fromEntries(entries.filter(([, url]) => url.length > 0)),
        );
    }
    void refreshSignedUrls();
    const timer = window.setInterval(
      () => void refreshSignedUrls(),
      45 * 60 * 1000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [imagePathKey, roomId, session.user.id]);
  useEffect(() => {
    const id = roomId;
    setRoom(id);
    const saved =
      localStorage.getItem("formwork-name") ||
      (session?.user.user_metadata?.display_name as string | undefined) ||
      `Designer ${Math.floor(Math.random() * 90 + 10)}`;
    setName(saved);
    nameRef.current = saved;
    let stopped = false,
      connecting = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    function scheduleReconnect(delay?: number) {
      if (stopped || timer) return;
      const wait =
        delay ??
        Math.min(15000, 750 * 2 ** reconnectAttempts.current++) *
          (0.8 + Math.random() * 0.4);
      setStatus("Reconnecting");
      timer = setTimeout(() => {
        timer = undefined;
        void connect();
      }, wait);
    }
    async function connect() {
      if (stopped || connecting) return;
      if (
        ws.current &&
        (ws.current.readyState === WebSocket.CONNECTING ||
          ws.current.readyState === WebSocket.OPEN)
      )
        return;
      connecting = true;
      let current: Session | null = null;
      try {
        const result = await supabase.auth.getSession();
        current = result.data.session;
      } catch {
        connecting = false;
        scheduleReconnect();
        return;
      }
      connecting = false;
      if (stopped) return;
      if (!current) {
        setAccessError("Please sign in again.");
        return;
      }
      const socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/collaborate?room=${id}`,
      );
      ws.current = socket;
      socket.onopen = () => {
        setStatus("Syncing");
        socket.send(
          JSON.stringify({ type: "auth", token: current.access_token }),
        );
      };
      socket.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === "init") {
          reconnectAttempts.current = 0;
          let currentDoc = normalizeDocument(m.doc as Document);
          if (canEdit(m.role)) {
            for (const entry of pending.current) {
              currentDoc = apply(currentDoc, entry.op);
              socket.send(
                JSON.stringify({ type: "op", op: entry.op, opId: entry.id }),
              );
            }
          } else {
            pending.current = [];
          }
          setDoc(currentDoc);
          docRef.current = currentDoc;
          setActivePageId((current) =>
            getPages(currentDoc).some((page) => page.id === current)
              ? current
              : getPages(currentDoc)[0].id,
          );
          setRole(m.role);
          setSelf(m.self);
          selfRef.current = m.self;
          setStatus("Live");
          setPreviews({});
          socket.send(
            JSON.stringify({ type: "presence", name: nameRef.current }),
          );
        }
        if (m.type === "ack" && typeof m.opId === "string")
          pending.current = pending.current.filter(
            (entry) => entry.id !== m.opId,
          );
        if (m.type === "doc") {
          const nextDoc = pending.current.reduce(
            (currentDoc, entry) => apply(currentDoc, entry.op),
            normalizeDocument(m.doc as Document),
          );
          setDoc(nextDoc);
          docRef.current = nextDoc;
          setPreviews({});
          for (const previewTimer of previewTimers.current.values())
            clearTimeout(previewTimer);
          previewTimers.current.clear();
        }
        if (m.type === "role") {
          setRole(m.role);
          if (!canEdit(m.role)) {
            pending.current = [];
            undo.current = [];
            redo.current = [];
            setTool("select");
          }
        }
        if (m.type === "error") {
          setNotice(m.message);
          if (typeof m.opId === "string")
            pending.current = pending.current.filter(
              (entry) => entry.id !== m.opId,
            );
          if (m.doc) {
            const nextDoc = pending.current.reduce(
              (currentDoc, entry) => apply(currentDoc, entry.op),
              normalizeDocument(m.doc as Document),
            );
            setDoc(nextDoc);
            docRef.current = nextDoc;
          }
          setPreviews({});
          for (const previewTimer of previewTimers.current.values())
            clearTimeout(previewTimer);
          previewTimers.current.clear();
          undo.current = [];
          redo.current = [];
        }
        if (
          m.type === "preview" &&
          typeof m.id === "string" &&
          typeof m.peerId === "string" &&
          Number.isFinite(m.x) &&
          Number.isFinite(m.y)
        ) {
          const shapeId = m.id as string;
          const existingTimer = previewTimers.current.get(shapeId);
          if (existingTimer) clearTimeout(existingTimer);
          setPreviews((currentPreviews) => ({
            ...currentPreviews,
            [shapeId]: { peerId: m.peerId, x: m.x, y: m.y },
          }));
          previewTimers.current.set(
            shapeId,
            setTimeout(() => {
              setPreviews((currentPreviews) => {
                if (currentPreviews[shapeId]?.peerId !== m.peerId)
                  return currentPreviews;
                const next = { ...currentPreviews };
                delete next[shapeId];
                return next;
              });
              previewTimers.current.delete(shapeId);
            }, 15000),
          );
        }
        if (m.type === "peers") setPeers(m.peers);
      };
      socket.onclose = (event) => {
        setPreviews({});
        for (const previewTimer of previewTimers.current.values())
          clearTimeout(previewTimer);
        previewTimers.current.clear();
        if (event.code === 4403) {
          setAccessError(
            event.reason || "You do not have access to this project.",
          );
          setRole(null);
          return;
        }
        if (!stopped) scheduleReconnect();
      };
      socket.onerror = () => socket.close();
    }
    const onOnline = () => {
      if (
        ws.current?.readyState !== WebSocket.OPEN &&
        ws.current?.readyState !== WebSocket.CONNECTING
      ) {
        if (timer) clearTimeout(timer);
        timer = undefined;
        void connect();
      }
    };
    window.addEventListener("online", onOnline);
    void connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      for (const previewTimer of previewTimers.current.values())
        clearTimeout(previewTimer);
      previewTimers.current.clear();
      ws.current?.close();
    };
  }, [roomId, session.user.id, session.access_token]);
  useEffect(() => {
    const node = stage.current?.findOne("#" + selected);
    transformer.current?.nodes(
      node && editable && !activeShapes.find((s) => s.id === selected)?.locked
        ? [node]
        : [],
    );
  }, [selected, activeShapes, editable]);
  useEffect(() => {
    if (
      role &&
      size.width > 0 &&
      size.height > 0 &&
      initialFit.current !== activePage.id
    ) {
      initialFit.current = activePage.id;
      const view = fitViewport(geometry.bounds(activeShapes), size);
      setZoom(view.zoom);
      setPan(view.pan);
    }
  }, [size, role, activePage.id, activeShapes, geometry]);
  const selectedShape = activeShapes.find((s) => s.id === selected);
  function presence(x?: number, y?: number) {
    if (ws.current?.readyState === WebSocket.OPEN)
      ws.current.send(
        JSON.stringify({
          type: "presence",
          name: nameRef.current,
          selected: selectionRef.current,
          x,
          y,
        }),
      );
  }
  useEffect(() => {
    presence();
  }, [selected]);
  function inverse(op: Operation): Operation | undefined {
    const d = docRef.current;
    const pageId = "pageId" in op ? op.pageId : undefined;
    const shapes = getPageShapes(d, pageId);
    if (op.kind === "add")
      return {
        kind: "delete_if",
        id: op.shape.id,
        expected: op.shape,
        pageId,
      };
    if (op.kind === "delete") {
      const s = shapes.find((s) => s.id === op.id);
      return s ? { kind: "add", shape: s, pageId } : undefined;
    }
    if (op.kind === "patch") {
      const s = shapes.find((s) => s.id === op.id);
      if (!s) return;
      const patch: Partial<Shape> = {};
      for (const key of Object.keys(op.patch) as (keyof Shape)[])
        Object.assign(patch, { [key]: s[key] });
      return {
        kind: "patch_if",
        id: op.id,
        expected: op.patch,
        patch,
        pageId,
      };
    }
    if (op.kind === "patch_if")
      return {
        kind: "patch_if",
        id: op.id,
        expected: op.patch,
        patch: op.expected,
        pageId,
      };
    if (op.kind === "delete_if")
      return { kind: "add", shape: op.expected as Shape, pageId };
    if (op.kind === "title")
      return { kind: "title_if", expected: op.title, title: d.title };
    if (op.kind === "title_if")
      return { kind: "title_if", expected: op.title, title: op.expected };
    if (op.kind === "order" || op.kind === "order_if")
      return {
        kind: "order_if",
        id: op.id,
        expectedIndex:
          op.kind === "order_if"
            ? op.expectedIndex + op.direction
            : shapes.findIndex((s) => s.id === op.id) + op.direction,
        direction: -op.direction,
        pageId,
      };
  }
  function guardedForReplay(op: Operation, before: Document): Operation {
    if (op.kind === "page_add") return op;
    const pageId = "pageId" in op ? op.pageId : undefined;
    const shapes = getPageShapes(before, pageId);
    if (op.kind === "patch") {
      const shape = shapes.find((s) => s.id === op.id);
      if (!shape) return op;
      const expected: Partial<Shape> = {};
      for (const key of Object.keys(op.patch) as (keyof Shape)[])
        Object.assign(expected, { [key]: shape[key] });
      return {
        kind: "patch_if",
        id: op.id,
        expected,
        patch: op.patch,
        pageId,
      };
    }
    if (op.kind === "delete") {
      const shape = shapes.find((s) => s.id === op.id);
      return shape
        ? { kind: "delete_if", id: op.id, expected: shape, pageId }
        : op;
    }
    if (op.kind === "title")
      return { kind: "title_if", expected: before.title, title: op.title };
    if (op.kind === "order")
      return {
        kind: "order_if",
        id: op.id,
        expectedIndex: shapes.findIndex((s) => s.id === op.id),
        direction: op.direction,
        pageId,
      };
    return op;
  }
  function enqueue(op: Operation, before: Document) {
    const entry = {
      id: crypto.randomUUID(),
      op: guardedForReplay(op, before),
    };
    pending.current.push(entry);
    if (ws.current?.readyState === WebSocket.OPEN)
      ws.current.send(
        JSON.stringify({ type: "op", op: entry.op, opId: entry.id }),
      );
  }
  function commit(op: Operation, record = true) {
    if (!editable) {
      setNotice("You have view-only access to this design.");
      return;
    }
    if (op.kind === "patch") {
      const shapes = getPageShapes(docRef.current, op.pageId || activePage.id);
      const id = op.id;
      const shape = shapes.find((s) => s.id === id);
      if (shape)
        op = { ...op, patch: withAutomaticFrame(shape, op.patch, shapes) };
    }
    const scopedOp =
      op.kind === "add" ||
      op.kind === "patch" ||
      op.kind === "patch_if" ||
      op.kind === "delete" ||
      op.kind === "delete_if" ||
      op.kind === "order" ||
      op.kind === "order_if"
        ? { ...op, pageId: op.pageId || activePage.id }
        : op;
    if (record) {
      const inv = inverse(scopedOp);
      if (inv) undo.current.push(inv);
      redo.current = [];
      setHistoryVersion((v) => v + 1);
    }
    const before = docRef.current;
    enqueue(scopedOp, before);
    setDoc((d) => apply(d, scopedOp));
    docRef.current = apply(docRef.current, scopedOp);
  }
  function previewDrag(id: string, x: number, y: number) {
    const socket = ws.current;
    if (socket?.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now - (lastPreview.current.get(id) || 0) < 33) return;
    lastPreview.current.set(id, now);
    socket.send(JSON.stringify({ type: "preview", id, x, y }));
  }
  function travel(back: boolean) {
    if (!editable) return;
    const source = back ? undo.current : redo.current,
      target = back ? redo.current : undo.current,
      op = source.pop();
    if (op) {
      const inv = inverse(op);
      if (inv) target.push(inv);
      commit(op, false);
      setHistoryVersion((v) => v + 1);
    }
  }
  function patch(p: Partial<Shape>) {
    if (selected) commit({ kind: "patch", id: selected, patch: p });
  }
  function addPage() {
    if (!editable) return;
    const id = "p" + crypto.randomUUID().replaceAll("-", "");
    const page = { id, name: `Page ${pages.length + 1}` };
    commit({ kind: "page_add", ...page }, false);
    setActivePageId(id);
    setSelected(undefined);
    setTool("select");
  }
  function add(type: Shape["type"], x?: number, y?: number) {
    if (!editable) return;
    let px = x ?? 220,
      py = y ?? 200;
    if (type === "frame") {
      const rightEdge = Math.max(
        80,
        ...getPageShapes(docRef.current, activePage.id)
          .filter((s) => s.type === "frame")
          .map((s) => s.x + s.width + 100),
      );
      if (x === undefined && y === undefined) {
        px = rightEdge;
        py = 65;
      }
    }
    const width = type === "frame" ? 800 : type === "text" ? 260 : 160;
    const height = type === "frame" ? 600 : type === "text" ? 60 : 120;
    const shape: Shape = {
      id: "s" + crypto.randomUUID().replaceAll("-", ""),
      type,
      name:
        type === "text"
          ? "Text"
          : type === "frame"
            ? "Frame"
            : type === "rect"
              ? "Rectangle"
              : "Ellipse",
      x: px,
      y: py,
      width,
      height,
      fill:
        type === "text" ? "#29342f" : type === "frame" ? "#ffffff" : "#a99bef",
      rotation: 0,
      radius: type === "rect" || type === "frame" ? 8 : 0,
      text: type === "text" ? "Your next big idea" : undefined,
      fontSize: type === "text" ? 28 : undefined,
      fontFamily: type === "text" ? "Arial" : undefined,
      fontStyle: type === "text" ? "normal" : undefined,
      align: type === "text" ? "left" : undefined,
    };
    if (type !== "frame")
      shape.frameId = containingFrameId(
        shape,
        getPageShapes(docRef.current, activePage.id),
      );
    commit({ kind: "add", shape });
    setSelected(shape.id);
    setTool("select");
  }
  async function uploadImage(file?: File) {
    if (!file || !editable) return;
    if (
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        file.type,
      ) ||
      file.size > MAX_SOURCE_IMAGE_BYTES
    ) {
      setNotice("Choose a PNG, JPG, WebP, or GIF image up to 10 MB.");
      return;
    }
    setUploading(true);
    setNotice(
      file.size > MAX_IMAGE_BYTES ? "Compressing image to 500 KB…" : "",
    );
    try {
      const prepared = await prepareImage(file),
        uploadFile = prepared.file,
        extension = uploadFile.type.split("/")[1].replace("jpeg", "jpg"),
        path = `${roomId}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage
        .from("formwork-assets")
        .upload(path, uploadFile, {
          contentType: uploadFile.type,
          cacheControl: "3600",
          upsert: false,
        });
      if (error) throw error;
      const scale = Math.min(1, 480 / prepared.width, 360 / prepared.height),
        x = (size.width / 2 - pan.x) / zoom,
        y = (size.height / 2 - pan.y) / zoom,
        shape: Shape = {
          id: "s" + crypto.randomUUID().replaceAll("-", ""),
          type: "image",
          name: file.name.slice(0, 80) || "Image",
          x,
          y,
          width: prepared.width * scale,
          height: prepared.height * scale,
          fill: "#ffffff",
          rotation: 0,
          assetPath: path,
        };
      shape.frameId = containingFrameId(
        shape,
        getPageShapes(docRef.current, activePage.id),
      );
      commit({ kind: "add", shape });
      setSelected(shape.id);
      setNotice(
        prepared.converted
          ? `Converted to WebP (${Math.ceil(uploadFile.size / 1024)} KB).`
          : "",
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Image upload failed.",
      );
    } finally {
      setUploading(false);
    }
  }
  function duplicate() {
    if (!editable) return;
    if (selectedShape) {
      const shape = {
        ...selectedShape,
        id: "s" + crypto.randomUUID().replaceAll("-", ""),
        x: selectedShape.x + 24,
        y: selectedShape.y + 24,
        name: selectedShape.name + " copy",
      };
      commit({ kind: "add", shape });
      setSelected(shape.id);
    }
  }
  function remove() {
    if (!editable) return;
    if (selected) {
      commit({ kind: "delete", id: selected });
      setSelected(undefined);
    }
  }
  function fit() {
    const view = fitViewport(geometry.bounds(activeShapes), size);
    setZoom(view.zoom);
    setPan(view.pan);
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.code === "Backslash") {
        e.preventDefault();
        toggleBothPanels();
        return;
      }
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest(
          'input,textarea,select,button,[contenteditable="true"],[role="textbox"]',
        )
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        setSpacePanning(true);
        return;
      }
      if (mod && e.key === "z") {
        e.preventDefault();
        travel(!e.shiftKey);
        return;
      }
      if (mod && e.key === "d") {
        e.preventDefault();
        duplicate();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      }
      const tools: Record<string, Tool> = {
        v: "select",
        r: "rect",
        o: "ellipse",
        t: "text",
        f: "frame",
        h: "hand",
      };
      if (
        tools[e.key.toLowerCase()] &&
        (editable || ["select", "hand"].includes(tools[e.key.toLowerCase()]))
      )
        setTool(tools[e.key.toLowerCase()]);
      if (e.key === "Escape") {
        setSelected(undefined);
        setTool("select");
      }
      if (e.key === "1" && e.shiftKey) fit();
    }
    function releaseSpace(e: KeyboardEvent) {
      if (e.code === "Space") setSpacePanning(false);
    }
    function releaseOnBlur() {
      setSpacePanning(false);
      setCanvasDragging(false);
    }
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", releaseSpace);
    window.addEventListener("blur", releaseOnBlur);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", releaseSpace);
      window.removeEventListener("blur", releaseOnBlur);
    };
  }, [selectedShape, size, editable, activeShapes, geometry, compact]);
  function exportPng() {
    transformer.current?.hide();
    const url = stage.current?.toDataURL({ pixelRatio: 2 });
    transformer.current?.show();
    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.download = "apnadesign-design.png";
      a.click();
    }
  }
  const tools = [
    { id: "select", Icon: MousePointer2, label: "Select (V)" },
    { id: "hand", Icon: Hand, label: "Pan (H)" },
    { id: "rect", Icon: Square, label: "Rectangle (R)" },
    { id: "frame", Icon: PanelsTopLeft, label: "Frame (F)" },
    { id: "ellipse", Icon: Circle, label: "Ellipse (O)" },
    { id: "text", Icon: Type, label: "Text (T)" },
  ] as const;
  return (
    <>
      <main
        className={
          "app" +
          (!layersOpen ? " layers-hidden" : "") +
          (!propertiesOpen ? " properties-hidden" : "")
        }
        data-history={historyVersion}
      >
        <header className="topbar">
          <Brand />
          <div className="document-title">
            <span className="breadcrumb">Workspace /</span>
            <input
              disabled={!editable}
              aria-label="Document title"
              value={doc.title}
              readOnly={!editable}
              onChange={(e) => commit({ kind: "title", title: e.target.value })}
            />
            <ChevronDown size={14} />
            <span className={"connection " + (status === "Live" ? "live" : "")}>
              {status === "Live" ? "Saved · Live" : status}
            </span>
          </div>
          <div className="header-actions">
            <span className="role-badge">
              {role === "viewer" ? "View only" : role || "Connecting"}
            </span>
            <button
              className="icon-button"
              title="Your projects"
              onClick={() => (location.href = "/")}
            >
              <Layers size={17} />
            </button>
            <button
              className="icon-button"
              title="Sign out"
              onClick={() => supabase.auth.signOut()}
            >
              <X size={16} />
            </button>
            <div className="avatars">
              {peers.slice(0, 4).map((p) => (
                <span key={p.id} title={p.name} style={{ background: p.color }}>
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
              ))}
            </div>
            <button
              className="icon-button"
              title="Export PNG"
              onClick={exportPng}
            >
              <Download size={17} />
            </button>
            <button
              className="share-button prototype-trigger"
              title="Preview the linked frames"
              disabled={!activeShapes.some((s) => s.type === "frame")}
              onClick={() => setPrototypeOpen(true)}
            >
              <Play size={14} /> Preview
            </button>
            <button className="share-button" onClick={() => setShare(true)}>
              <Share2 size={15} /> Share
            </button>
          </div>
        </header>
        <aside
          id="layers-sidebar"
          aria-label="Layers"
          className={
            "left-sidebar" + (compact && layersOpen ? " mobile-open" : "")
          }
        >
          <div className="sidebar-tabs">
            <b>
              <Layers size={14} /> Layers
            </b>
            <span>{activeShapes.length} objects</span>
          </div>
          <div className="page-title">
            <span className="page-dot" />
            <label className="page-picker-wrap">
              <select
                aria-label="Current page"
                value={activePage.id}
                onChange={(event) => {
                  setActivePageId(event.target.value);
                  setSelected(undefined);
                  setTool("select");
                }}
              >
                {pages.map((page, index) => (
                  <option key={page.id} value={page.id}>
                    {page.name || `Page ${index + 1}`}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} />
            </label>
            <button
              className="page-control"
              title="Add page"
              aria-label="Add page"
              disabled={!editable}
              onClick={addPage}
            >
              <Plus size={14} />
            </button>
            <button
              className="page-control"
              title={
                collapsedPages[activePage.id]
                  ? "Expand page layers"
                  : "Collapse page layers"
              }
              aria-label={
                collapsedPages[activePage.id]
                  ? "Expand page layers"
                  : "Collapse page layers"
              }
              aria-expanded={!collapsedPages[activePage.id]}
              onClick={() =>
                setCollapsedPages((current) => ({
                  ...current,
                  [activePage.id]: !current[activePage.id],
                }))
              }
            >
              {collapsedPages[activePage.id] ? (
                <ChevronRight size={13} />
              ) : (
                <ChevronDown size={13} />
              )}
            </button>
          </div>
          {!collapsedPages[activePage.id] && (
            <div className="layers">
              {[...activeShapes].reverse().map((s) => (
                <div
                  className={
                    "layer-row " +
                    (selected === s.id ? "selected" : "") +
                    (s.hidden ? " muted" : "")
                  }
                  key={s.id}
                >
                  <button
                    className="layer-select"
                    onClick={() => setSelected(s.id)}
                  >
                    {s.type === "text" ? (
                      <Type size={14} />
                    ) : s.type === "image" ? (
                      <ImagePlus size={14} />
                    ) : s.type === "frame" ? (
                      <PanelsTopLeft size={14} />
                    ) : s.type === "ellipse" ? (
                      <Circle size={14} />
                    ) : (
                      <Square size={14} />
                    )}
                    <span>{s.name}</span>
                  </button>
                  <button
                    className="layer-action"
                    disabled={!editable}
                    aria-label={`${s.hidden ? "Show" : "Hide"} ${s.name}`}
                    onClick={() =>
                      commit({
                        kind: "patch",
                        id: s.id,
                        patch: { hidden: !s.hidden },
                      })
                    }
                  >
                    {s.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                  <button
                    className="layer-action"
                    disabled={!editable}
                    aria-label={`${s.locked ? "Unlock" : "Lock"} ${s.name}`}
                    onClick={() =>
                      commit({
                        kind: "patch",
                        id: s.id,
                        patch: { locked: !s.locked },
                      })
                    }
                  >
                    {s.locked ? <Lock size={12} /> : <Unlock size={12} />}
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="sidebar-bottom">
            <span className="tiny-logo">✳</span>
            <div>
              <b>A space for your ideas</b>
              <p>Made together, in real time.</p>
            </div>
          </div>
        </aside>
        <section
          className={
            "canvas-shell" +
            (tool === "hand" || spacePanning ? " pan-ready" : "") +
            (canvasDragging ? " panning" : "")
          }
          ref={container}
          data-geometry-engine={geometry.kind}
        >
          <button
            type="button"
            className="sidebar-toggle toggle-layers"
            title={layersOpen ? "Hide layers sidebar" : "Show layers sidebar"}
            aria-label={
              layersOpen ? "Hide layers sidebar" : "Show layers sidebar"
            }
            aria-expanded={layersOpen}
            aria-controls="layers-sidebar"
            onClick={() => togglePanel("layers")}
          >
            <PanelLeft size={16} />
          </button>
          <button
            type="button"
            className="sidebar-toggle toggle-properties"
            title={
              propertiesOpen
                ? "Hide properties sidebar"
                : "Show properties sidebar"
            }
            aria-label={
              propertiesOpen
                ? "Hide properties sidebar"
                : "Show properties sidebar"
            }
            aria-expanded={propertiesOpen}
            aria-controls="properties-sidebar"
            onClick={() => togglePanel("properties")}
          >
            <PanelRight size={16} />
          </button>
          <div className="canvas-label">
            <span className="green-dot" /> DESIGN CANVAS{" "}
            <span>Room / {room}</span>
          </div>
          <Stage
            ref={stage}
            width={size.width}
            height={size.height}
            x={pan.x}
            y={pan.y}
            scaleX={zoom}
            scaleY={zoom}
            draggable={tool === "hand" || spacePanning || canvasDragging}
            onDragStart={(e) => {
              if (e.target === stage.current) setCanvasDragging(true);
            }}
            onDragEnd={(e) => {
              if (e.target === stage.current) {
                setPan({ x: e.target.x(), y: e.target.y() });
                setCanvasDragging(false);
              }
            }}
            onWheel={(e) => {
              e.evt.preventDefault();
              if (e.evt.ctrlKey || e.evt.metaKey) {
                const pointer = stage.current!.getPointerPosition()!,
                  next = Math.max(
                    0.0001,
                    Math.min(3, zoom * (e.evt.deltaY > 0 ? 0.92 : 1.08)),
                  ),
                  point = {
                    x: (pointer.x - pan.x) / zoom,
                    y: (pointer.y - pan.y) / zoom,
                  };
                setZoom(next);
                setPan({
                  x: pointer.x - point.x * next,
                  y: pointer.y - point.y * next,
                });
              } else
                setPan((p) => ({
                  x: p.x - e.evt.deltaX,
                  y: p.y - e.evt.deltaY,
                }));
            }}
            onMouseMove={() => {
              if (Date.now() - lastPresence.current < 50) return;
              lastPresence.current = Date.now();
              const p = stage.current?.getPointerPosition();
              if (p) presence((p.x - pan.x) / zoom, (p.y - pan.y) / zoom);
            }}
            onMouseDown={(e) => {
              if (e.target === stage.current) {
                if (tool === "hand" || spacePanning || canvasDragging) return;
                if (
                  tool === "rect" ||
                  tool === "ellipse" ||
                  tool === "text" ||
                  tool === "frame"
                ) {
                  const p = stage.current!.getPointerPosition()!;
                  add(tool, (p.x - pan.x) / zoom, (p.y - pan.y) / zoom);
                } else setSelected(undefined);
              }
            }}
          >
            <Layer>
              {activeShapes
                .filter((s) => !s.hidden)
                .map((s) => {
                  const common = {
                    id: s.id,
                    x: previews[s.id]?.x ?? s.x,
                    y: previews[s.id]?.y ?? s.y,
                    width: s.width,
                    height: s.height,
                    fill: s.fill,
                    rotation: s.rotation,
                    draggable:
                      editable &&
                      tool === "select" &&
                      !spacePanning &&
                      !canvasDragging &&
                      !s.locked,
                    onClick: () =>
                      tool === "select" && !spacePanning && setSelected(s.id),
                    onTap: () =>
                      tool === "select" && !spacePanning && setSelected(s.id),
                    onDragStart: () => setSelected(s.id),
                    onDragMove: (e: Konva.KonvaEventObject<DragEvent>) =>
                      previewDrag(s.id, e.target.x(), e.target.y()),
                    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) =>
                      commit({
                        kind: "patch",
                        id: s.id,
                        patch: { x: e.target.x(), y: e.target.y() },
                      }),
                    onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
                      const n = e.target,
                        patch = {
                          x: n.x(),
                          y: n.y(),
                          width: Math.max(5, s.width * n.scaleX()),
                          height: Math.max(5, s.height * n.scaleY()),
                          rotation: n.rotation(),
                        };
                      n.scaleX(1);
                      n.scaleY(1);
                      commit({ kind: "patch", id: s.id, patch });
                    },
                  };
                  return s.type === "rect" || s.type === "frame" ? (
                    <Rect
                      key={s.id}
                      {...common}
                      stroke={s.type === "frame" ? "#cbd0d9" : undefined}
                      strokeWidth={s.type === "frame" ? 1 / zoom : 0}
                      dash={
                        s.type === "frame" ? [5 / zoom, 4 / zoom] : undefined
                      }
                      cornerRadius={s.radius || 0}
                    />
                  ) : s.type === "ellipse" ? (
                    <Ellipse
                      key={s.id}
                      {...common}
                      x={(previews[s.id]?.x ?? s.x) + s.width / 2}
                      y={(previews[s.id]?.y ?? s.y) + s.height / 2}
                      radiusX={s.width / 2}
                      radiusY={s.height / 2}
                      onDragMove={(e) =>
                        previewDrag(
                          s.id,
                          e.target.x() - s.width / 2,
                          e.target.y() - s.height / 2,
                        )
                      }
                      onDragEnd={(e) =>
                        commit({
                          kind: "patch",
                          id: s.id,
                          patch: {
                            x: e.target.x() - s.width / 2,
                            y: e.target.y() - s.height / 2,
                          },
                        })
                      }
                      onTransformEnd={(e) => {
                        const n = e.target,
                          w = s.width * n.scaleX(),
                          h = s.height * n.scaleY();
                        n.scale({ x: 1, y: 1 });
                        commit({
                          kind: "patch",
                          id: s.id,
                          patch: {
                            x: n.x() - w / 2,
                            y: n.y() - h / 2,
                            width: w,
                            height: h,
                            rotation: n.rotation(),
                          },
                        });
                      }}
                    />
                  ) : s.type === "image" ? (
                    s.assetPath && imageUrls[s.assetPath] ? (
                      <CanvasImage
                        key={s.id}
                        {...common}
                        src={imageUrls[s.assetPath]}
                      />
                    ) : (
                      <Rect
                        key={s.id}
                        {...common}
                        fill="#e9e7f8"
                        stroke="#8064ec"
                        dash={[5, 4]}
                      />
                    )
                  ) : (
                    <Text
                      key={s.id}
                      {...common}
                      text={s.text}
                      fontSize={s.fontSize || 24}
                      fontFamily={s.fontFamily || "Arial"}
                      fontStyle={s.fontStyle || "normal"}
                      align={s.align || "left"}
                      lineHeight={1.2}
                      onDblClick={() => {
                        setSelected(s.id);
                        setNotice("Edit this text in the right panel.");
                      }}
                    />
                  );
                })}
              <Transformer
                ref={transformer}
                rotateEnabled
                flipEnabled={false}
                borderStroke="#8064ec"
                anchorStroke="#8064ec"
                anchorFill="#fff"
                anchorSize={7}
                boundBoxFunc={(old, next) =>
                  next.width < 5 || next.height < 5 ? old : next
                }
              />
              {peers
                .filter((p) => p.id !== self)
                .map((p) => (
                  <Group key={p.id}>
                    {p.selected &&
                      (() => {
                        const s = activeShapes.find((s) => s.id === p.selected);
                        return s ? (
                          <Rect
                            x={s.x - 3}
                            y={s.y - 3}
                            width={s.width + 6}
                            height={s.height + 6}
                            stroke={p.color}
                            strokeWidth={1.5 / zoom}
                            dash={[6, 4]}
                            listening={false}
                          />
                        ) : null;
                      })()}
                    {p.x !== undefined && p.y !== undefined && (
                      <Group x={p.x} y={p.y} listening={false}>
                        <Line
                          points={[0, 0, 3, 17, 7, 12, 14, 12, 0, 0]}
                          fill={p.color}
                          closed
                          stroke="white"
                          strokeWidth={1}
                        />
                        <Rect
                          x={12}
                          y={16}
                          width={p.name.length * 7 + 14}
                          height={23}
                          fill={p.color}
                          cornerRadius={4}
                        />
                        <Text
                          x={19}
                          y={22}
                          text={p.name}
                          fontSize={12}
                          fill="white"
                        />
                      </Group>
                    )}
                  </Group>
                ))}
            </Layer>
          </Stage>
          <div className="floating-toolbar">
            {tools.map(({ id, Icon, label }) => (
              <button
                key={id}
                title={label}
                disabled={!editable && id !== "select" && id !== "hand"}
                aria-label={label}
                className={tool === id ? "active" : ""}
                onClick={() => setTool(id)}
              >
                <Icon size={19} />
              </button>
            ))}
            <input
              ref={imageInput}
              hidden
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => {
                void uploadImage(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              title={uploading ? "Uploading image…" : "Upload image"}
              aria-label="Upload image"
              disabled={!editable || uploading}
              onClick={() => imageInput.current?.click()}
            >
              <ImagePlus size={18} />
            </button>
            <span className="divider" />
            <button
              title="Undo"
              disabled={!editable || !undo.current.length}
              onClick={() => travel(true)}
            >
              <Undo2 size={18} />
            </button>
            <button
              title="Redo"
              disabled={!editable || !redo.current.length}
              onClick={() => travel(false)}
            >
              <Redo2 size={18} />
            </button>
          </div>
          <div className="zoom-controls">
            <button
              aria-label="Zoom out"
              onClick={() => setZoom((z) => Math.max(0.0001, z / 1.1))}
            >
              <Minus size={13} />
            </button>
            <button onClick={fit} title="Fit canvas">
              {zoom < 0.01 ? (zoom * 100).toFixed(2) : Math.round(zoom * 100)}%
            </button>
            <button
              aria-label="Zoom in"
              onClick={() => setZoom((z) => Math.min(3, z * 1.1))}
            >
              <Plus size={13} />
            </button>
          </div>
          <div className="canvas-hint">
            {tool === "select"
              ? "V select · Space + drag to pan · F frame · R rectangle · O ellipse · T text"
              : tool === "hand"
                ? "Drag to move around your canvas"
                : `Click the canvas to add ${tool === "ellipse" ? "an" : "a"} ${tool} · Space + drag to pan`}
            <span>⌘/Ctrl + \ panels · ⌘ + scroll to zoom</span>
          </div>
        </section>
        <aside
          id="properties-sidebar"
          aria-label="Properties"
          className={
            "right-sidebar " +
            (compact && propertiesOpen ? "mobile-open " : "") +
            (!editable ? "read-only" : "")
          }
        >
          <div className="sidebar-tabs">
            <b>Design</b>
            <span className="design-tag">PROPERTIES</span>
          </div>
          {selectedShape ? (
            <>
              {selectedShape.type !== "frame" && (
                <div className="property-section">
                  <h4>Frame & prototype</h4>
                  <label className="full-input">
                    Belongs to
                    <select
                      disabled={!editable}
                      aria-label="Belongs to frame"
                      value={selectedShape.frameId || ""}
                      onChange={(e) => patch({ frameId: e.target.value })}
                    >
                      <option value="">Canvas</option>
                      {activeShapes
                        .filter((s) => s.type === "frame")
                        .map((frame) => (
                          <option key={frame.id} value={frame.id}>
                            {frame.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="full-input">
                    On click, go to
                    <select
                      disabled={!editable}
                      aria-label="Prototype destination"
                      value={selectedShape.targetFrameId || ""}
                      onChange={(e) => patch({ targetFrameId: e.target.value })}
                    >
                      <option value="">No interaction</option>
                      {activeShapes
                        .filter((s) => s.type === "frame")
                        .map((frame) => (
                          <option key={frame.id} value={frame.id}>
                            {frame.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              )}
              <div className="property-section">
                <div className="section-heading">
                  {selectedShape.type === "text" ? (
                    <Type size={15} />
                  ) : (
                    <Square size={15} />
                  )}
                  <input
                    disabled={!editable}
                    aria-label="Layer name"
                    value={selectedShape.name}
                    onChange={(e) => patch({ name: e.target.value })}
                  />
                </div>
                <h4>Layout</h4>
                <div className="property-grid">
                  {(["x", "y", "width", "height", "rotation"] as const).map(
                    (k) => (
                      <label key={k}>
                        <span>
                          {
                            {
                              x: "X",
                              y: "Y",
                              width: "W",
                              height: "H",
                              rotation: "↻",
                            }[k]
                          }
                        </span>
                        <input
                          disabled={!editable}
                          aria-label={k}
                          type="number"
                          value={Math.round(selectedShape[k])}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            patch({
                              [k]:
                                k === "width" || k === "height"
                                  ? Math.max(5, v)
                                  : v,
                            });
                          }}
                        />
                      </label>
                    ),
                  )}
                  {selectedShape.type === "rect" && (
                    <label>
                      <span>⌗</span>
                      <input
                        disabled={!editable}
                        aria-label="Corner radius"
                        type="number"
                        value={selectedShape.radius || 0}
                        onChange={(e) =>
                          patch({ radius: Math.max(0, Number(e.target.value)) })
                        }
                      />
                    </label>
                  )}
                </div>
              </div>
              {selectedShape.type !== "image" && (
                <div className="property-section">
                  <h4>Fill</h4>
                  <label className="fill-control">
                    <input
                      disabled={!editable}
                      aria-label="Fill color"
                      type="color"
                      value={selectedShape.fill}
                      onChange={(e) => patch({ fill: e.target.value })}
                    />
                    <span>{selectedShape.fill.toUpperCase()}</span>
                    <span>100%</span>
                  </label>
                  <div className="swatches">
                    {[
                      "#a99bef",
                      "#284c38",
                      "#e3e9dc",
                      "#f4d5a7",
                      "#b87c5f",
                      "#ffffff",
                      "#202b28",
                    ].map((c) => (
                      <button
                        key={c}
                        aria-label={`Set fill ${c}`}
                        style={{ background: c }}
                        onClick={() => patch({ fill: c })}
                      />
                    ))}
                  </div>
                </div>
              )}
              {selectedShape.type === "text" && (
                <div className="property-section">
                  <h4>Typography</h4>
                  <label className="full-input">
                    Font family
                    <select
                      disabled={!editable}
                      aria-label="Font family"
                      value={selectedShape.fontFamily || "Arial"}
                      onChange={(e) => patch({ fontFamily: e.target.value })}
                    >
                      {[
                        "Arial",
                        "Georgia",
                        "Verdana",
                        "Trebuchet MS",
                        "Courier New",
                      ].map((font) => (
                        <option key={font} value={font}>
                          {font}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="full-input">
                    Font style
                    <select
                      disabled={!editable}
                      aria-label="Font style"
                      value={selectedShape.fontStyle || "normal"}
                      onChange={(e) =>
                        patch({
                          fontStyle: e.target.value as Shape["fontStyle"],
                        })
                      }
                    >
                      <option value="normal">Regular</option>
                      <option value="bold">Bold</option>
                      <option value="italic">Italic</option>
                      <option value="bold italic">Bold italic</option>
                    </select>
                  </label>
                  <div
                    className="text-align-controls"
                    aria-label="Text alignment"
                  >
                    {[
                      ["left", AlignLeft],
                      ["center", AlignCenter],
                      ["right", AlignRight],
                    ].map(([align, Icon]) => {
                      const AlignIcon = Icon as typeof AlignLeft;
                      return (
                        <button
                          key={align as string}
                          type="button"
                          aria-label={`Align ${align as string}`}
                          disabled={!editable}
                          className={
                            (selectedShape.align || "left") === align
                              ? "active"
                              : ""
                          }
                          onClick={() =>
                            patch({ align: align as Shape["align"] })
                          }
                        >
                          <AlignIcon size={15} />
                        </button>
                      );
                    })}
                  </div>
                  <label className="full-input">
                    Font size
                    <input
                      disabled={!editable}
                      aria-label="Font size"
                      type="number"
                      value={selectedShape.fontSize || 24}
                      onChange={(e) =>
                        patch({ fontSize: Math.max(1, Number(e.target.value)) })
                      }
                    />
                  </label>
                  <textarea
                    disabled={!editable}
                    aria-label="Text content"
                    value={selectedShape.text || ""}
                    onChange={(e) => patch({ text: e.target.value })}
                  />
                </div>
              )}
              <div className="property-section">
                <h4>Arrange</h4>
                <div className="action-grid">
                  <button
                    onClick={() =>
                      commit({ kind: "order", id: selected!, direction: 1 })
                    }
                  >
                    <ArrowUp size={14} />
                    Forward
                  </button>
                  <button
                    onClick={() =>
                      commit({ kind: "order", id: selected!, direction: -1 })
                    }
                  >
                    <ArrowDown size={14} />
                    Backward
                  </button>
                  <button onClick={duplicate}>
                    <Copy size={14} />
                    Duplicate
                  </button>
                  <button onClick={remove}>
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="property-section">
                <h4>Canvas</h4>
                <div className="fill-control">
                  <span className="canvas-swatch" />
                  <span>F4F5F7</span>
                  <span>100%</span>
                </div>
              </div>
              <div className="empty-selection">
                <MousePointer2 size={27} />
                <h3>Ideas start here.</h3>
                <p>
                  Select an object to make it yours, or pick a tool and create
                  something new.
                </p>
                <button onClick={() => add("rect")}>
                  <Plus size={14} /> Add a shape
                </button>
              </div>
              <div className="property-section">
                <h4>Quick guide</h4>
                <div className="shortcut">
                  <span>Select</span>
                  <kbd>V</kbd>
                </div>
                <div className="shortcut">
                  <span>Rectangle</span>
                  <kbd>R</kbd>
                </div>
                <div className="shortcut">
                  <span>Text</span>
                  <kbd>T</kbd>
                </div>
                <div className="shortcut">
                  <span>Pan canvas</span>
                  <kbd>H</kbd>
                </div>
                <div className="shortcut">
                  <span>Duplicate</span>
                  <kbd>⌘ D</kbd>
                </div>
              </div>
            </>
          )}
          <div className="collab-card">
            <span className="green-dot" />
            <b>
              {peers.length} {peers.length === 1 ? "designer" : "designers"} in
              this room
            </b>
            <p>Good things happen together.</p>
            <button onClick={() => setShare(true)}>
              Invite a collaborator <Share2 size={12} />
            </button>
          </div>
        </aside>
        {notice && (
          <div className="toast" onClick={() => setNotice("")}>
            {notice} <X size={13} />
          </div>
        )}
        {share && (
          <Sharing
            room={room}
            role={role}
            onClose={() => setShare(false)}
            onChange={() =>
              ws.current?.send(JSON.stringify({ type: "permissions" }))
            }
          />
        )}
        {accessError && (
          <div className="modal-backdrop">
            <div className="share-modal">
              <h2>Project access required.</h2>
              <p>{accessError}</p>
              <p>
                {session.user.is_anonymous
                  ? "This guest session needs an active guest link. Ask the owner to create one, or sign in with an invited email."
                  : `Ask the owner to invite ${session.user.email}.`}
              </p>
              <button
                className="primary-button"
                onClick={() => (location.href = "/")}
              >
                Back to your projects
              </button>
            </div>
          </div>
        )}
      </main>
      {prototypeOpen && (
        <PrototypePreview
          shapes={activeShapes}
          imageUrls={imageUrls}
          onClose={() => setPrototypeOpen(false)}
        />
      )}
    </>
  );
}
