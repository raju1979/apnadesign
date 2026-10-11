import { readFile } from "node:fs/promises";
import { createWasmGeometry, javascriptGeometry } from "../lib/geometry";
import manifest from "../lib/wasm/manifest.json";
import { performance } from "node:perf_hooks";
import { snapMove, boxSelection, prepareSnapMove } from "../lib/selection";
import type { Shape } from "../lib/document";
export function scene(count: number): Shape[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    type: i % 3 ? "rect" : "ellipse",
    name: "Benchmark",
    x: (i % 100) * 137,
    y: Math.floor(i / 100) * 113,
    width: 80,
    height: 60,
    rotation: i % 7 ? 0 : 27,
    fill: "#fff",
  }));
}
export function measure(fn: (iteration: number) => unknown, runs = 20) {
  for (let i = 0; i < 100; i++) fn(i);
  const times = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn(i);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return Number(times[Math.floor(times.length / 2)].toFixed(6));
}
async function main() {
  const { instance } = await WebAssembly.instantiate(
    await readFile(`public${manifest.url}`),
  );
  const wasm = createWasmGeometry(instance);
  for (const count of [1000, 5000]) {
    const shapes = scene(count);
    const jsSnap = prepareSnapMove(shapes, ["s0"], javascriptGeometry);
    const wasmSnap = prepareSnapMove(shapes, ["s0"], wasm);
    console.log(
      JSON.stringify({
        count,
        legacySnapMs: measure((i) =>
          snapMove(
            shapes,
            ["s0"],
            ((i * 73) % 1000) - 500,
            ((i * 97) % 1000) - 500,
            6,
          ),
        ),
        indexedJsSnapMs: measure(
          (i) => jsSnap(((i * 73) % 1000) - 500, ((i * 97) % 1000) - 500, 6),
          1000,
        ),
        indexedWasmSnapMs: measure(
          (i) => wasmSnap(((i * 73) % 1000) - 500, ((i * 97) % 1000) - 500, 6),
          1000,
        ),
        jsPrepareMs: measure(() =>
          prepareSnapMove(shapes, ["s0"], javascriptGeometry),
        ),
        wasmPrepareMs: measure(() => prepareSnapMove(shapes, ["s0"], wasm)),
        jsBatchBoundsMs: measure(() => javascriptGeometry.batchBounds(shapes)),
        wasmBatchBoundsMs: measure(() => wasm.batchBounds(shapes)),
        jsBoxMs: measure(() =>
          boxSelection(shapes, { x: 0, y: 0, width: 500, height: 500 }),
        ),
        wasmBoxMs: measure(() =>
          boxSelection(shapes, { x: 0, y: 0, width: 500, height: 500 }, wasm),
        ),
      }),
    );
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
