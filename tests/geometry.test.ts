import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  createWasmGeometry,
  javascriptBounds,
  fitViewport,
  loadGeometryAsset,
  type Bounds,
} from "../lib/geometry";
import type { Shape } from "../lib/document";
import manifest from "../lib/wasm/manifest.json";

let bytes: Uint8Array<ArrayBuffer>;
let compiledModule: WebAssembly.Module;
before(async () => {
  bytes = new Uint8Array(await readFile(`public${manifest.url}`));
  compiledModule = await WebAssembly.compile(bytes);
});
const shape = (patch: Partial<Shape> = {}): Shape => ({
  id: "shape",
  type: "rect",
  name: "Shape",
  x: 10,
  y: 20,
  width: 100,
  height: 50,
  rotation: 0,
  fill: "#ffffff",
  ...patch,
});
function near(actual: Bounds | null, expected: Bounds | null) {
  if (!expected) return assert.equal(actual, null);
  assert.ok(actual);
  for (const key of ["x", "y", "width", "height"] as const) {
    assert.ok(
      Math.abs(actual[key] - expected[key]) <
        Math.max(1, Math.abs(expected[key])) * 1e-10,
      `${key}: ${actual[key]} != ${expected[key]}`,
    );
  }
}

test("compiled Rust WASM handles rectangle and ellipse rotation origins", () => {
  const engine = createWasmGeometry(new WebAssembly.Instance(compiledModule));
  assert.equal(engine.kind, "wasm");
  near(engine.bounds([shape({ rotation: 90 })]), {
    x: -40,
    y: 20,
    width: 50,
    height: 100,
  });
  near(engine.bounds([shape({ type: "ellipse", rotation: 90 })]), {
    x: 35,
    y: -5,
    width: 50,
    height: 100,
  });
  const radius = Math.hypot(50 / Math.sqrt(2), 25 / Math.sqrt(2));
  near(engine.bounds([shape({ type: "ellipse", rotation: 45 })]), {
    x: 60 - radius,
    y: 45 - radius,
    width: 2 * radius,
    height: 2 * radius,
  });
});

test("empty pages, hidden objects, and invalid dimensions do not affect WASM bounds", () => {
  const engine = createWasmGeometry(new WebAssembly.Instance(compiledModule));
  near(engine.bounds([]), null);
  near(
    engine.bounds([
      shape({ hidden: true }),
      shape({ width: 0 }),
      shape({ x: NaN }),
      shape({ rotation: Infinity }),
    ]),
    null,
  );
  near(
    engine.bounds([shape(), shape({ hidden: true, x: -10_000 })]),
    javascriptBounds([shape()]),
  );
});

test("WASM and fallback agree on a large mixed scene and release their memory", () => {
  const instance = new WebAssembly.Instance(compiledModule);
  const engine = createWasmGeometry(instance);
  let seed = 734;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const scene = Array.from({ length: 4000 }, (_, i) =>
    shape({
      type: ["rect", "ellipse", "text", "image", "frame"][
        i % 5
      ] as Shape["type"],
      x: (random() - 0.5) * 50_000,
      y: (random() - 0.5) * 50_000,
      width: random() * 2000 + 1,
      height: random() * 1000 + 1,
      rotation: (random() - 0.5) * 2160,
      hidden: i % 11 === 0,
    }),
  );
  const expected = javascriptBounds(scene);
  near(engine.bounds(scene), expected);
  const memory = instance.exports.memory as WebAssembly.Memory;
  const memoryAfterFirstBatch = memory.buffer.byteLength;
  for (let i = 0; i < 60; i++) near(engine.bounds(scene), expected);
  assert.equal(memory.buffer.byteLength, memoryAfterFirstBatch);
  assert.equal(engine.kind, "wasm");
});

test("fit viewport centres and contains distant artwork with margins at small zoom", () => {
  const bounds = { x: -15_000, y: -10_000, width: 60_000, height: 40_000 };
  const size = { width: 960, height: 640 };
  const { zoom, pan } = fitViewport(bounds, size);
  assert.ok(zoom < 0.15);
  assert.ok(pan.x + bounds.x * zoom >= 48 - 1e-9);
  assert.ok(pan.y + bounds.y * zoom >= 48 - 1e-9);
  assert.ok(pan.x + (bounds.x + bounds.width) * zoom <= size.width - 48 + 1e-9);
  assert.ok(
    pan.y + (bounds.y + bounds.height) * zoom <= size.height - 48 + 1e-9,
  );
  assert.equal(pan.x + (bounds.x + bounds.width / 2) * zoom, size.width / 2);
  assert.equal(pan.y + (bounds.y + bounds.height / 2) * zoom, size.height / 2);
  assert.deepEqual(fitViewport(null, size), {
    zoom: 1,
    pan: { x: 480, y: 320 },
  });
  assert.ok(fitViewport(bounds, { width: 20, height: 20 }).zoom > 0);
});

test("browser loader supports streaming, incorrect MIME types, and missing/corrupt assets", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/missing") {
      res.writeHead(404).end();
      return;
    }
    res.setHeader(
      "Content-Type",
      req.url === "/mime" ? "application/octet-stream" : "application/wasm",
    );
    res.end(req.url === "/corrupt" ? "invalid wasm" : bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const route of ["/stream", "/mime", "/missing", "/corrupt"]) {
      const engine = await loadGeometryAsset(url + route);
      assert.equal(
        engine.kind,
        ["/stream", "/mime"].includes(route) ? "wasm" : "javascript",
      );
      near(engine.bounds([shape({ rotation: 90 })]), {
        x: -40,
        y: 20,
        width: 50,
        height: 100,
      });
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  assert.equal((await loadGeometryAsset(url)).kind, "javascript");
});
