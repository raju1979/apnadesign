import type { Shape } from "./document";
import manifest from "./wasm/manifest.json";

type GeometryShape = Pick<
  Shape,
  "x" | "y" | "width" | "height" | "rotation" | "type" | "hidden"
>;
export type Bounds = { x: number; y: number; width: number; height: number };
export type GeometryEngine = {
  kind: "wasm" | "javascript";
  bounds(shapes: readonly GeometryShape[]): Bounds | null;
  batchBounds(shapes: readonly GeometryShape[]): (Bounds | null)[];
};
type GeometryExports = {
  memory: WebAssembly.Memory;
  abi_version(): number;
  alloc_f64(length: number): number;
  free_f64(pointer: number, length: number): void;
  shape_bounds(input: number, length: number, output: number): void;
  scene_bounds(input: number, length: number, output: number): number;
};

function visibleValidShapes(shapes: readonly GeometryShape[]) {
  return shapes.filter(
    (s) =>
      !s.hidden &&
      s.width > 0 &&
      s.height > 0 &&
      [s.x, s.y, s.width, s.height, s.rotation].every(Number.isFinite),
  );
}

export function javascriptBounds(
  shapes: readonly GeometryShape[],
): Bounds | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const s of visibleValidShapes(shapes)) {
    const angle = ((s.rotation % 360) * Math.PI) / 180;
    const sin = Math.sin(angle),
      cos = Math.cos(angle);
    let xs: number[], ys: number[];
    if (s.type === "ellipse") {
      const cx = s.x + s.width / 2,
        cy = s.y + s.height / 2;
      const dx = Math.hypot((s.width / 2) * cos, (s.height / 2) * sin);
      const dy = Math.hypot((s.width / 2) * sin, (s.height / 2) * cos);
      xs = [cx - dx, cx + dx];
      ys = [cy - dy, cy + dy];
    } else {
      xs = [
        s.x,
        s.x + s.width * cos,
        s.x - s.height * sin,
        s.x + s.width * cos - s.height * sin,
      ];
      ys = [
        s.y,
        s.y + s.width * sin,
        s.y + s.height * cos,
        s.y + s.width * sin + s.height * cos,
      ];
    }
    if (![...xs, ...ys].every(Number.isFinite)) continue;
    minX = Math.min(minX, ...xs);
    minY = Math.min(minY, ...ys);
    maxX = Math.max(maxX, ...xs);
    maxY = Math.max(maxY, ...ys);
  }
  return minX === Infinity
    ? null
    : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export const javascriptGeometry: GeometryEngine = {
  kind: "javascript",
  bounds: javascriptBounds,
  batchBounds: (shapes) => shapes.map((shape) => javascriptBounds([shape])),
};

/** One batched WASM call per scene; allocations never escape this adapter. */
export function createWasmGeometry(
  instance: WebAssembly.Instance,
): GeometryEngine {
  const api = instance.exports as unknown as GeometryExports;
  if (
    !(api.memory instanceof WebAssembly.Memory) ||
    [
      api.abi_version,
      api.alloc_f64,
      api.free_f64,
      api.scene_bounds,
      api.shape_bounds,
    ].some((fn) => typeof fn !== "function") ||
    api.abi_version() !== 1
  )
    throw new Error("Unsupported geometry WASM module.");

  const engine: GeometryEngine = {
    kind: "wasm",
    batchBounds(shapes) {
      if (engine.kind === "javascript")
        return javascriptGeometry.batchBounds(shapes);
      if (!shapes.length) return [];
      let input = 0,
        output = 0;
      try {
        input = api.alloc_f64(shapes.length * 6);
        output = api.alloc_f64(shapes.length * 4);
        const records = new Float64Array(
          api.memory.buffer,
          input,
          shapes.length * 6,
        );
        for (let i = 0; i < shapes.length; i++) {
          const s = shapes[i],
            at = i * 6;
          records[at] = s.hidden ? NaN : s.x;
          records[at + 1] = s.y;
          records[at + 2] = s.width;
          records[at + 3] = s.height;
          records[at + 4] = s.rotation;
          records[at + 5] = s.type === "ellipse" ? 1 : 0;
        }
        api.shape_bounds(input, shapes.length * 6, output);
        const values = new Float64Array(
          api.memory.buffer,
          output,
          shapes.length * 4,
        );
        return shapes.map((_, i) => {
          const at = i * 4;
          const x = values[at],
            y = values[at + 1],
            right = values[at + 2],
            bottom = values[at + 3];
          return [x, y, right, bottom].every(Number.isFinite)
            ? { x, y, width: right - x, height: bottom - y }
            : null;
        });
      } catch {
        engine.kind = "javascript";
        return javascriptGeometry.batchBounds(shapes);
      } finally {
        if (output) api.free_f64(output, shapes.length * 4);
        if (input) api.free_f64(input, shapes.length * 6);
      }
    },
    bounds(shapes) {
      if (engine.kind === "javascript") return javascriptBounds(shapes);
      const valid = visibleValidShapes(shapes);
      if (!valid.length) return null;
      const records = new Float64Array(valid.length * 6);
      valid.forEach((s, i) =>
        records.set(
          [
            s.x,
            s.y,
            s.width,
            s.height,
            s.rotation,
            s.type === "ellipse" ? 1 : 0,
          ],
          i * 6,
        ),
      );
      let input = 0,
        output = 0;
      try {
        input = api.alloc_f64(records.length);
        output = api.alloc_f64(4);
        // Both allocations may grow memory, so construct views afterwards.
        new Float64Array(api.memory.buffer, input, records.length).set(records);
        if (!api.scene_bounds(input, records.length, output)) return null;
        const [minX, minY, maxX, maxY] = new Float64Array(
          api.memory.buffer,
          output,
          4,
        );
        if (![minX, minY, maxX, maxY].every(Number.isFinite))
          throw new Error("Invalid geometry bounds.");
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
      } catch {
        engine.kind = "javascript";
        return javascriptBounds(shapes);
      } finally {
        if (output) api.free_f64(output, 4);
        if (input) api.free_f64(input, records.length);
      }
    },
  };
  return engine;
}

let loading: Promise<GeometryEngine> | undefined;

/** Load once without blocking the editor; failure keeps the JS implementation. */
export function loadGeometryEngine(): Promise<GeometryEngine> {
  return (loading ||= loadGeometryAsset(manifest.url));
}

export async function loadGeometryAsset(url: string): Promise<GeometryEngine> {
  if (typeof WebAssembly === "undefined") return javascriptGeometry;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error("Geometry module could not be loaded.");
    let instance: WebAssembly.Instance;
    try {
      // clone preserves the bytes for servers with an incorrect WASM MIME type.
      ({ instance } = await WebAssembly.instantiateStreaming(
        response.clone(),
        {},
      ));
    } catch {
      ({ instance } = await WebAssembly.instantiate(
        await response.arrayBuffer(),
        {},
      ));
    }
    return createWasmGeometry(instance);
  } catch {
    return javascriptGeometry;
  } finally {
    clearTimeout(timeout);
  }
}

export function fitViewport(
  bounds: Bounds | null,
  size: { width: number; height: number },
  padding = 48,
) {
  if (!bounds)
    return { zoom: 1, pan: { x: size.width / 2, y: size.height / 2 } };
  const inset = Math.max(
    0,
    Math.min(padding, (size.width - 1) / 2, (size.height - 1) / 2),
  );
  const zoom = Math.min(
    3,
    (size.width - inset * 2) / Math.max(1, bounds.width),
    (size.height - inset * 2) / Math.max(1, bounds.height),
  );
  return {
    zoom,
    pan: {
      x: size.width / 2 - (bounds.x + bounds.width / 2) * zoom,
      y: size.height / 2 - (bounds.y + bounds.height / 2) * zoom,
    },
  };
}
