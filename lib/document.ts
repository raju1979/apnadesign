export type Shape = {
  id: string;
  type: "rect" | "ellipse" | "text" | "image" | "frame";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  rotation: number;
  text?: string;
  fontSize?: number;
  radius?: number;
  hidden?: boolean;
  locked?: boolean;
  assetPath?: string;
  fontFamily?: string;
  fontStyle?: "normal" | "bold" | "italic" | "bold italic";
  align?: "left" | "center" | "right";
  frameId?: string;
  targetFrameId?: string;
};
export type Page = { id: string; name: string; shapes: Shape[] };
export type Document = { title: string; shapes: Shape[]; pages?: Page[] };
export type Operation =
  | { kind: "add"; shape: Shape; pageId?: string }
  | { kind: "patch"; id: string; patch: Partial<Shape>; pageId?: string }
  | {
      kind: "patch_if";
      id: string;
      expected: Partial<Shape>;
      patch: Partial<Shape>;
      pageId?: string;
    }
  | { kind: "delete"; id: string; pageId?: string }
  | { kind: "delete_if"; id: string; expected: Partial<Shape>; pageId?: string }
  | { kind: "order"; id: string; direction: number; pageId?: string }
  | {
      kind: "order_if";
      id: string;
      expectedIndex: number;
      direction: number;
      pageId?: string;
    }
  | { kind: "page_add"; id: string; name: string }
  | { kind: "title"; title: string }
  | { kind: "title_if"; expected: string; title: string };

export function getPages(doc: Document): Page[] {
  return doc.pages?.length
    ? doc.pages
    : [{ id: "page-1", name: "Page 1", shapes: doc.shapes || [] }];
}

export function getPageShapes(doc: Document, pageId?: string): Shape[] {
  const pages = getPages(doc);
  return (
    pages.find((page) => page.id === (pageId || pages[0].id))?.shapes || []
  );
}

export function normalizeDocument(doc: Document): Document {
  const sourceShapes = Array.isArray(doc.shapes) ? doc.shapes : [];
  const hasPages = Array.isArray(doc.pages) && doc.pages.length > 0;
  let pages: Page[] = hasPages
    ? doc.pages!.map((page, index) => ({
        id: typeof page.id === "string" ? page.id : `page-${index + 1}`,
        name:
          typeof page.name === "string" && page.name.trim()
            ? page.name.slice(0, 60)
            : `Page ${index + 1}`,
        shapes: Array.isArray(page.shapes) ? page.shapes : [],
      }))
    : [{ id: "page-1", name: "Page 1", shapes: sourceShapes }];

  // Older saved projects contain one top-level shapes array. Keep their
  // existing starter-frame migration, then wrap that data as their first page.
  if (!hasPages) {
    const existingFrame = sourceShapes.find((s) => s.id === "frame");
    let shapes = sourceShapes;
    if (existingFrame) {
      shapes = sourceShapes.map((s) =>
        s.id === existingFrame.id
          ? { ...s, type: "frame" }
          : { ...s, frameId: s.frameId || existingFrame.id },
      );
    } else if (!sourceShapes.some((s) => s.type === "frame")) {
      const id = "legacy-frame";
      shapes = [
        {
          id,
          type: "frame",
          name: "Prototype frame",
          x: 0,
          y: 0,
          width: 1280,
          height: 720,
          fill: "#ffffff",
          rotation: 0,
        },
        ...sourceShapes.map((s) => ({ ...s, frameId: s.frameId || id })),
      ];
    }
    pages = [{ ...pages[0], shapes }];
  }

  return {
    ...doc,
    pages,
    shapes: pages[0].shapes,
  };
}

function updatePage(
  doc: Document,
  pageId: string,
  update: (shapes: Shape[]) => Shape[],
): Document {
  const pages = getPages(doc);
  if (!pages.some((page) => page.id === pageId)) return doc;
  const nextPages = pages.map((page) =>
    page.id === pageId ? { ...page, shapes: update(page.shapes) } : page,
  );
  return { ...doc, pages: nextPages, shapes: nextPages[0].shapes };
}

export function apply(doc: Document, op: Operation): Document {
  if (op.kind === "title") return { ...doc, title: op.title.slice(0, 120) };
  if (op.kind === "title_if")
    return doc.title === op.expected
      ? { ...doc, title: op.title.slice(0, 120) }
      : doc;
  if (op.kind === "page_add") {
    const pages = getPages(doc);
    if (pages.some((page) => page.id === op.id)) return doc;
    const nextPages = [
      ...pages,
      { id: op.id, name: op.name.slice(0, 60), shapes: [] },
    ];
    return { ...doc, pages: nextPages, shapes: nextPages[0].shapes };
  }

  const pages = getPages(doc);
  const pageId = op.pageId || pages[0].id;
  const shapes = getPageShapes(doc, pageId);
  if (!pages.some((page) => page.id === pageId)) return doc;
  if (op.kind === "add")
    return shapes.some((s) => s.id === op.shape.id)
      ? doc
      : updatePage(doc, pageId, (items) =>
          op.shape.type === "frame"
            ? [op.shape, ...items]
            : [...items, op.shape],
        );
  if (op.kind === "delete")
    return updatePage(doc, pageId, (items) =>
      items.filter((s) => s.id !== op.id),
    );
  if (op.kind === "delete_if") {
    const shape = shapes.find((s) => s.id === op.id);
    return shape &&
      Object.entries(op.expected).every(([key, value]) =>
        Object.is(shape[key as keyof Shape], value),
      )
      ? updatePage(doc, pageId, (items) => items.filter((s) => s.id !== op.id))
      : doc;
  }
  if (op.kind === "patch")
    return updatePage(doc, pageId, (items) =>
      items.map((s) => (s.id === op.id ? { ...s, ...op.patch, id: s.id } : s)),
    );
  if (op.kind === "patch_if")
    return updatePage(doc, pageId, (items) =>
      items.map((s) => {
        if (s.id !== op.id) return s;
        const patch = Object.fromEntries(
          Object.entries(op.patch).filter(([key]) =>
            Object.is(s[key as keyof Shape], op.expected[key as keyof Shape]),
          ),
        ) as Partial<Shape>;
        return { ...s, ...patch, id: s.id };
      }),
    );
  const i = shapes.findIndex((s) => s.id === op.id);
  if (op.kind === "order_if" && i !== op.expectedIndex) return doc;
  if (i < 0) return doc;
  return updatePage(doc, pageId, (items) => {
    const next = [...items];
    const j = Math.max(0, Math.min(next.length - 1, i + op.direction));
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
}
export function initialDocument(): Document {
  const shape = (
    id: string,
    type: Shape["type"],
    name: string,
    x: number,
    y: number,
    width: number,
    height: number,
    fill: string,
    extra: Partial<Shape> = {},
  ): Shape => ({
    id,
    type,
    name,
    x,
    y,
    width,
    height,
    fill,
    rotation: 0,
    ...extra,
  });
  const shapes = (
    [
      shape(
        "frame",
        "frame",
        "Desktop / Landing",
        80,
        65,
        920,
        660,
        "#ffffff",
        {
          radius: 12,
        },
      ),
      shape("logo", "text", "Brand", 125, 110, 240, 38, "#202b28", {
        text: "leaf & light",
        fontSize: 26,
      }),
      shape("nav", "text", "Navigation", 645, 119, 300, 28, "#64736d", {
        text: "Our story     Collection     Contact",
        fontSize: 14,
      }),
      shape("tag", "text", "Eyebrow", 130, 245, 340, 30, "#73886c", {
        text: "A LITTLE SPACE TO SLOW DOWN",
        fontSize: 13,
      }),
      shape("heading", "text", "Hero heading", 125, 289, 445, 175, "#233a2d", {
        text: "Make room\nfor a softer life.",
        fontSize: 58,
      }),
      shape("body", "text", "Description", 130, 470, 370, 80, "#7c8780", {
        text: "Thoughtfully made objects for everyday rituals.\nFind beauty in the things you come home to.",
        fontSize: 17,
      }),
      shape("button", "rect", "Shop button", 130, 573, 176, 49, "#284c38", {
        radius: 25,
      }),
      shape(
        "button-label",
        "text",
        "Button label",
        157,
        588,
        155,
        25,
        "#ffffff",
        { text: "Explore collection  ↗", fontSize: 14 },
      ),
      shape("art", "rect", "Sage backdrop", 610, 218, 333, 397, "#e3e9dc", {
        radius: 160,
      }),
      shape("orb", "ellipse", "Sun", 748, 264, 108, 108, "#f4d5a7"),
      shape("vase", "rect", "Ceramic vase", 699, 425, 150, 158, "#b87c5f", {
        radius: 44,
      }),
      shape("stem", "rect", "Stem", 770, 340, 6, 135, "#44664d", {
        rotation: -12,
      }),
      shape("leaf1", "ellipse", "Leaf / 01", 720, 337, 73, 34, "#668367", {
        rotation: -30,
      }),
      shape("leaf2", "ellipse", "Leaf / 02", 770, 365, 78, 32, "#8a9d73", {
        rotation: 20,
      }),
      shape("footer", "text", "Footer note", 130, 677, 600, 25, "#8c948e", {
        text: "NATURAL MATERIALS     •     CONSIDERED DESIGN     •     EVERYDAY JOY",
        fontSize: 11,
      }),
    ] as Shape[]
  ).map((s) => (s.id === "frame" ? s : { ...s, frameId: "frame" }));
  return {
    title: "Untitled · Studio exploration",
    shapes,
    pages: [{ id: "page-1", name: "Page 1", shapes }],
  };
}
export function validOperation(value: unknown): value is Operation {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  if (o.kind === "title") return typeof o.title === "string";
  if (o.kind === "title_if")
    return typeof o.expected === "string" && typeof o.title === "string";
  if (
    o.pageId !== undefined &&
    (typeof o.pageId !== "string" || o.pageId.length > 64)
  )
    return false;
  if (o.kind === "page_add")
    return (
      typeof o.id === "string" &&
      o.id.length > 0 &&
      o.id.length <= 64 &&
      typeof o.name === "string" &&
      o.name.trim().length > 0 &&
      o.name.length <= 60
    );
  if (o.kind === "delete") return typeof o.id === "string";
  if (o.kind === "order")
    return (
      typeof o.id === "string" && (o.direction === 1 || o.direction === -1)
    );
  const check = (s: Record<string, unknown>) =>
    Object.entries(s).every(([k, v]) =>
      ["x", "y", "width", "height", "rotation", "fontSize", "radius"].includes(
        k,
      )
        ? typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 100000
        : ["hidden", "locked"].includes(k)
          ? typeof v === "boolean"
          : [
                "id",
                "name",
                "fill",
                "text",
                "assetPath",
                "fontFamily",
                "frameId",
                "targetFrameId",
              ].includes(k)
            ? typeof v === "string" && v.length < 10000
            : k === "fontStyle"
              ? ["normal", "bold", "italic", "bold italic"].includes(String(v))
              : k === "align"
                ? ["left", "center", "right"].includes(String(v))
                : k === "type"
                  ? ["rect", "ellipse", "text", "image", "frame"].includes(
                      String(v),
                    )
                  : false,
    );
  const partial = (value: unknown) =>
    !!value &&
    typeof value === "object" &&
    check(value as Record<string, unknown>);
  if (o.kind === "patch") return typeof o.id === "string" && partial(o.patch);
  if (o.kind === "patch_if")
    return (
      typeof o.id === "string" &&
      partial(o.expected) &&
      partial(o.patch) &&
      Object.keys(o.expected as object).length > 0 &&
      Object.keys(o.patch as object).every(
        (key) => key in (o.expected as object),
      )
    );
  if (o.kind === "delete_if")
    return (
      typeof o.id === "string" &&
      partial(o.expected) &&
      (o.expected as Record<string, unknown>).id === o.id
    );
  if (o.kind === "order_if")
    return (
      typeof o.id === "string" &&
      Number.isInteger(o.expectedIndex) &&
      (o.direction === 1 || o.direction === -1)
    );
  if (o.kind === "add") {
    const s = o.shape as Record<string, unknown>;
    return (
      !!s &&
      typeof s === "object" &&
      check(s) &&
      ["id", "name", "type", "fill"].every((k) => typeof s[k] === "string") &&
      ["x", "y", "width", "height", "rotation"].every(
        (k) => typeof s[k] === "number",
      )
    );
  }
  return false;
}
