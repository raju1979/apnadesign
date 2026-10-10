import { test } from "node:test";
import assert from "node:assert/strict";
import {
  apply,
  getPageShapes,
  getPages,
  initialDocument,
  normalizeDocument,
  validOperation,
} from "../lib/document";
test("independent collaborator patches preserve both changes", () => {
  let d = initialDocument();
  d = apply(d, { kind: "patch", id: "heading", patch: { x: 250 } });
  d = apply(d, { kind: "patch", id: "heading", patch: { fill: "#ff0000" } });
  assert.equal(d.shapes.find((s) => s.id === "heading")?.x, 250);
  assert.equal(d.shapes.find((s) => s.id === "heading")?.fill, "#ff0000");
});
test("conditional undo restores only fields untouched by collaborators", () => {
  const start = initialDocument(),
    shape = start.shapes.find((s) => s.id === "heading")!;
  const authored = apply(start, {
    kind: "patch",
    id: shape.id,
    patch: { x: 250, fill: "#ff0000" },
  });
  const collaborator = apply(authored, {
    kind: "patch",
    id: shape.id,
    patch: { fill: "#00aa88" },
  });
  const undone = apply(collaborator, {
    kind: "patch_if",
    id: shape.id,
    expected: { x: 250, fill: "#ff0000" },
    patch: { x: shape.x, fill: shape.fill },
  });
  const result = undone.shapes.find((s) => s.id === shape.id)!;
  assert.equal(result.x, shape.x);
  assert.equal(result.fill, "#00aa88");
});
test("conditional delete and reorder do not overwrite newer document state", () => {
  const start = initialDocument(),
    heading = start.shapes.find((s) => s.id === "heading")!;
  const changed = apply(start, {
    kind: "patch",
    id: heading.id,
    patch: { text: "Updated by collaborator" },
  });
  const notDeleted = apply(changed, {
    kind: "delete_if",
    id: heading.id,
    expected: heading,
  });
  assert.equal(
    notDeleted.shapes.some((s) => s.id === heading.id),
    true,
  );
  const moved = apply(start, { kind: "order", id: "heading", direction: 1 });
  assert.equal(
    apply(moved, {
      kind: "order_if",
      id: "heading",
      expectedIndex: 0,
      direction: 1,
    }),
    moved,
  );
});
test("duplicate delivery of an add is idempotent", () => {
  const d = initialDocument(),
    shape = { ...d.shapes[0], id: "new" };
  const once = apply(d, { kind: "add", shape });
  assert.equal(
    apply(once, { kind: "add", shape }).shapes.length,
    once.shapes.length,
  );
});
test("starter artwork is grouped into a prototype frame", () => {
  const doc = initialDocument();
  assert.equal(doc.shapes[0].type, "frame");
  assert.ok(
    doc.shapes
      .filter((shape) => shape.type !== "frame")
      .every((shape) => shape.frameId === doc.shapes[0].id),
  );
});
test("older saved projects gain a frame without moving their artwork", () => {
  const old = initialDocument(),
    legacy = {
      title: old.title,
      shapes: old.shapes.map((shape) => {
        const { frameId: _frameId, ...withoutFrame } = shape;
        return shape.id === "frame"
          ? { ...withoutFrame, type: "rect" as const }
          : withoutFrame;
      }),
    },
    normalized = normalizeDocument(legacy);
  assert.equal(normalized.shapes[0].type, "frame");
  assert.equal(normalized.shapes[1].frameId, "frame");
  assert.equal(normalized.shapes[1].x, old.shapes[1].x);
});
test("pages persist independently and keep the first-page compatibility view", () => {
  const firstPageShapes = initialDocument().shapes;
  let doc = apply(initialDocument(), {
    kind: "page_add",
    id: "page-2",
    name: "Page 2",
  });
  const secondPageShape = { ...firstPageShapes[0], id: "second-page-frame" };
  doc = apply(doc, {
    kind: "add",
    pageId: "page-2",
    shape: secondPageShape,
  });

  assert.equal(getPages(doc).length, 2);
  assert.equal(getPageShapes(doc, "page-2")[0].id, "second-page-frame");
  assert.equal(getPageShapes(doc, "page-1").length, firstPageShapes.length);
  assert.equal(doc.shapes.length, firstPageShapes.length);
});
test("deleted objects are not resurrected by stale patches", () => {
  const d = apply(initialDocument(), { kind: "delete", id: "heading" });
  assert.equal(
    apply(d, { kind: "patch", id: "heading", patch: { x: 100 } }).shapes.some(
      (s) => s.id === "heading",
    ),
    false,
  );
});
test("reject invalid network operations", () => {
  assert.equal(
    validOperation({ kind: "patch", id: "a", patch: { x: Infinity } }),
    false,
  );
  assert.equal(
    validOperation({ kind: "patch", id: "a", patch: { script: "bad" } }),
    false,
  );
  assert.equal(validOperation({ kind: "add", shape: { id: "a" } }), false);
  assert.equal(
    validOperation({ kind: "patch", id: "a", patch: { x: 42 } }),
    true,
  );
  assert.equal(
    validOperation({
      kind: "patch_if",
      id: "a",
      expected: { x: 10 },
      patch: { x: 42 },
    }),
    true,
  );
  assert.equal(
    validOperation({
      kind: "patch_if",
      id: "a",
      expected: {},
      patch: { x: 42 },
    }),
    false,
  );
  assert.equal(
    validOperation({
      kind: "patch_if",
      id: "a",
      expected: { script: "bad" },
      patch: { x: 42 },
    }),
    false,
  );
  assert.equal(
    validOperation({ kind: "page_add", id: "page-2", name: "Page 2" }),
    true,
  );
  assert.equal(
    validOperation({ kind: "page_add", id: "page-2", name: "" }),
    false,
  );
});
