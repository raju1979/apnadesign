import { test } from "node:test";
import assert from "node:assert/strict";
import { apply, type Shape } from "../lib/document";
import {
  containingFrameId,
  withAutomaticFrame,
  frameLayerRows,
} from "../lib/frames";

const first: Shape = {
  id: "first",
  name: "First",
  type: "frame",
  x: 0,
  y: 0,
  width: 800,
  height: 600,
  rotation: 0,
  fill: "#fff",
};
const second: Shape = { ...first, id: "second", x: 1100 };
const oval: Shape = {
  ...first,
  id: "oval",
  type: "ellipse",
  x: 100,
  y: 100,
  width: 160,
  height: 120,
  frameId: first.id,
};

test("moving an oval between frames updates membership in the same operation", () => {
  const shapes = [first, second, oval];
  const patch = withAutomaticFrame(oval, { x: 1465, y: 276 }, shapes);
  const moved = apply(
    { title: "Test", shapes },
    { kind: "patch", id: oval.id, patch },
  );
  const result = moved.shapes.find((s) => s.id === oval.id)!;
  assert.equal(result.frameId, second.id);
  assert.equal(result.x, 1465);
  assert.equal(moved.shapes.filter((s) => s.frameId === second.id).length, 1);
});

test("moving outside frames clears membership; other edits preserve it", () => {
  assert.equal(
    withAutomaticFrame(oval, { x: 900 }, [first, second]).frameId,
    "",
  );
  assert.deepEqual(
    withAutomaticFrame(oval, { fill: "#abc" }, [first, second]),
    { fill: "#abc" },
  );
  assert.deepEqual(
    withAutomaticFrame(oval, { x: 900, frameId: first.id }, [first, second]),
    { x: 900, frameId: first.id },
  );
  assert.deepEqual(withAutomaticFrame(first, { x: 900 }, [first, second]), {
    x: 900,
  });
});

test("frame containment uses object center and handles rotation and overlap", () => {
  assert.equal(containingFrameId({ ...oval, x: -50 }, [first]), first.id);
  assert.equal(containingFrameId({ ...oval, x: 750 }, [first]), "");
  const rotated = { ...first, x: 800, rotation: 90 };
  assert.equal(
    containingFrameId({ ...oval, x: 300, y: 300 }, [rotated]),
    first.id,
  );
  const inner = { ...first, id: "inner", width: 300, height: 300 };
  assert.equal(containingFrameId(oval, [first, inner]), inner.id);
  assert.equal(
    containingFrameId(oval, [first, { ...inner, hidden: true }]),
    first.id,
  );
  assert.equal(containingFrameId(oval, [{ ...first, hidden: true }]), "");
});

test("frame moves carry children and conditional undo preserves newer child edits", () => {
  let doc = { title: "Test", shapes: [first, second, oval] };
  doc = apply(doc, { kind: "patch", id: first.id, patch: { x: 40, y: 70 } });
  assert.equal(doc.shapes.find((s) => s.id === oval.id)!.x, 140);
  assert.equal(doc.shapes.find((s) => s.id === oval.id)!.y, 170);
  assert.equal(doc.shapes.find((s) => s.id === second.id)!.x, 1100);
  doc = apply(doc, {
    kind: "patch",
    id: oval.id,
    patch: { x: 160, fill: "red" },
  });
  doc = apply(doc, {
    kind: "patch_if",
    id: first.id,
    expected: { x: 40, y: 70 },
    patch: { x: 0, y: 0 },
  });
  assert.equal(doc.shapes.find((s) => s.id === oval.id)!.x, 120);
  assert.equal(doc.shapes.find((s) => s.id === oval.id)!.fill, "red");
  const unchanged = apply(doc, {
    kind: "patch_if",
    id: first.id,
    expected: { x: 40 },
    patch: { x: 500 },
  });
  assert.deepEqual(unchanged, doc);
});

test("Layers nests assigned objects while keeping unassigned and orphan objects visible", () => {
  const loose = { ...oval, id: "loose", frameId: "missing" };
  const rows = frameLayerRows([first, second, oval, loose]);
  assert.equal(rows.length, 4);
  const index = rows.findIndex((r) => r.shape.id === first.id);
  assert.equal(rows[index + 1].shape.id, oval.id);
  assert.equal(rows[index + 1].depth, 1);
  assert.equal(rows.find((r) => r.shape.id === loose.id)!.depth, 0);
});
