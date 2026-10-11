import test from "node:test";
import assert from "node:assert/strict";
import {
  apply,
  validOperation,
  type Shape,
  type Document,
} from "../lib/document";
import {
  boxSelection,
  roots,
  expandSelection,
  layers,
  alignmentPatches,
  snapMove,
  clipboardCopies,
  isHidden,
  isLocked,
} from "../lib/selection";
const a: Shape = {
  id: "a",
  type: "rect",
  name: "A",
  x: 10,
  y: 20,
  width: 40,
  height: 30,
  rotation: 0,
  fill: "red",
};
const b: Shape = { ...a, id: "b", name: "B", x: 100, y: 70 };
const group: Shape = {
  ...a,
  id: "g",
  type: "group",
  name: "Group",
  x: 10,
  y: 20,
  width: 130,
  height: 80,
  fill: "transparent",
};
const scene = [group, { ...a, groupId: "g" }, { ...b, groupId: "g" }];
test("box selection respects hidden and locked ancestors, and promotes members to their group", () => {
  assert.deepEqual(
    boxSelection([a, b], { x: 0, y: 0, width: 60, height: 60 }),
    ["a"],
  );
  assert.deepEqual(
    boxSelection(scene, { x: 0, y: 0, width: 200, height: 200 }),
    ["g"],
  );
  assert.deepEqual(
    boxSelection([{ ...group, locked: true }, ...scene.slice(1)], {
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    }),
    [],
  );
  assert.equal(
    isHidden(scene[1], [{ ...group, hidden: true }, ...scene.slice(1)]),
    true,
  );
  assert.equal(
    isLocked(scene[1], [{ ...group, locked: true }, ...scene.slice(1)]),
    true,
  );
});
test("group and child selected together move once and nested group bounds follow their children", () => {
  assert.deepEqual(
    roots(scene, ["g", "a"]).map((s) => s.id),
    ["g"],
  );
  assert.equal(expandSelection(scene, ["g"]).length, 3);
  const moved = apply(
    { title: "Test", shapes: scene },
    { kind: "patch", id: "g", patch: { x: 30, y: 40 } },
  );
  assert.equal(moved.shapes.find((s) => s.id === "a")!.x, 30);
  assert.equal(moved.shapes.find((s) => s.id === "b")!.x, 120);
  const edited = apply(moved, { kind: "patch", id: "b", patch: { x: 180 } });
  assert.equal(edited.shapes.find((s) => s.id === "g")!.width, 190);
  assert.deepEqual(
    layers(scene).map((r) => [r.shape.id, r.depth]),
    [
      ["g", 0],
      ["b", 1],
      ["a", 1],
    ],
  );
});
test("alignment uses visual bounds and excludes locked targets", () => {
  const edits = alignmentPatches([a, b], ["a", "b"], "left");
  assert.equal(edits.find((e) => e.id === "b")!.patch.x, 10);
  assert.equal(
    alignmentPatches([a, { ...b, locked: true }], ["a", "b"], "left").length,
    0,
  );
});
test("snapping uses edges and centers within the zoom-adjusted tolerance", () => {
  const snapped = snapMove([a, b], ["a"], 49, 49, 3);
  assert.equal(snapped.dx, 50);
  assert.equal(snapped.dy, 50);
  assert.equal(snapped.guides.length, 2);
  assert.deepEqual(snapMove([a], ["a"], 11, 13, 3), {
    dx: 11,
    dy: 13,
    guides: [],
  });
});
test("copying remaps group/frame/prototype references and does not transfer foreign image assets", () => {
  const frame: Shape = { ...a, id: "f", type: "frame" };
  const image: Shape = {
    ...a,
    id: "image",
    type: "image",
    assetPath: "project/asset.webp",
    frameId: "f",
  };
  const original = [
    frame,
    { ...group, frameId: "f" },
    { ...a, groupId: "g", frameId: "f", targetFrameId: "f" },
    image,
  ];
  const copies = clipboardCopies(original, "one", "one");
  assert.notEqual(copies[0].id, "f");
  assert.equal(copies[2].groupId, copies[1].id);
  assert.equal(copies[2].frameId, copies[0].id);
  assert.equal(copies[2].targetFrameId, copies[0].id);
  assert.equal(copies[2].x, a.x + 24);
  assert.equal(
    clipboardCopies(original, "one", "two").some((s) => s.type === "image"),
    false,
  );
});
test("batches validate and preserve conditional undo while applying all members together", () => {
  const batch = {
    kind: "batch",
    operations: [
      { kind: "patch", id: "a", patch: { groupId: "g" } },
      { kind: "patch", id: "b", patch: { groupId: "g" } },
    ],
  };
  assert.equal(validOperation(batch), true);
  assert.equal(validOperation({ kind: "batch", operations: [batch] }), false);
  assert.equal(
    validOperation({
      kind: "batch",
      operations: new Array(501).fill(batch.operations[0]),
    }),
    false,
  );
  assert.equal(validOperation({ kind: "add", shape: group }), true);
  let doc: Document = apply(
    { title: "Test", shapes: [group, a, b] },
    batch as any,
  );
  doc = apply(doc, { kind: "patch", id: "a", patch: { fill: "blue" } });
  doc = apply(doc, {
    kind: "batch",
    operations: [
      {
        kind: "patch_if",
        id: "a",
        expected: { groupId: "g", fill: "red" },
        patch: { groupId: "", fill: "red" },
      },
      {
        kind: "patch_if",
        id: "b",
        expected: { groupId: "g" },
        patch: { groupId: "" },
      },
    ],
  });
  assert.equal(doc.shapes.find((s) => s.id === "a")!.fill, "blue");
  assert.equal(doc.shapes.find((s) => s.id === "a")!.groupId, "");
  const optional = apply(
    { title: "Test", shapes: [a] },
    {
      kind: "patch_if",
      id: "a",
      expected: { groupId: "" },
      patch: { groupId: "g" },
    },
  );
  assert.equal(optional.shapes[0].groupId, "g");
});
