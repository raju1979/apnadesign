import { test } from "node:test";
import assert from "node:assert/strict";
import { apply, type Shape } from "../lib/document";
import { containingFrameId, withAutomaticFrame } from "../lib/frames";

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
