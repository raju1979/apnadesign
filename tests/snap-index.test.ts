import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { snapMove, prepareSnapMove, boxSelection } from "../lib/selection";
import { createWasmGeometry } from "../lib/geometry";
import manifest from "../lib/wasm/manifest.json";
import type { Shape } from "../lib/document";

test("indexed snapping matches legacy snapping, including ties and parent visibility", async () => {
  const { instance } = await WebAssembly.instantiate(
    await readFile(`public${manifest.url}`),
  );
  const wasm = createWasmGeometry(instance);
  const shapes: Shape[] = Array.from({ length: 500 }, (_, i) => ({
    id: `s${i}`,
    type: i % 3 ? "rect" : "ellipse",
    name: "Test",
    x: (i % 20) * 100,
    y: Math.floor(i / 20) * 100,
    width: 60,
    height: 40,
    rotation: i % 7 ? 0 : 90,
    fill: "#fff",
    hidden: i % 31 === 0,
  }));
  shapes[0].hidden = false;
  shapes[1].type = "group";
  shapes[2].groupId = "s1";
  shapes[3].groupId = "s1";
  shapes[1].hidden = true;
  for (const ids of [["s0"], ["s0", "s7"], ["s1"]]) {
    const indexed = prepareSnapMove(shapes, ids);
    const accelerated = prepareSnapMove(shapes, ids, wasm);
    for (let i = 0; i < 200; i++) {
      const dx = ((i * 73) % 1000) - 500,
        dy = ((i * 97) % 1000) - 500;
      const expected = snapMove(shapes, ids, dx, dy, 6);
      assert.deepEqual(indexed(dx, dy, 6), expected);
      const result = accelerated(dx, dy, 6);
      assert.ok(Math.abs(result.dx - expected.dx) < 1e-9);
      assert.ok(Math.abs(result.dy - expected.dy) < 1e-9);
      assert.equal(result.guides.length, expected.guides.length);
    }
  }
  for (const box of [
    { x: 0, y: 0, width: 500, height: 500 },
    { x: -1000, y: -1000, width: 1, height: 1 },
  ])
    assert.deepEqual(
      boxSelection(shapes, box, wasm),
      boxSelection(shapes, box),
    );
  assert.deepEqual(prepareSnapMove([], [])(10, 20, 6), {
    dx: 10,
    dy: 20,
    guides: [],
  });
});
