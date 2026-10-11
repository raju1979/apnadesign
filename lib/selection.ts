import type { Shape } from "./document";
import { javascriptBounds, type Bounds } from "./geometry";

export function parentId(shape: Shape, shapes: Shape[]): string | undefined {
  if (
    shape.groupId &&
    shapes.some((s) => s.id === shape.groupId && s.type === "group")
  )
    return shape.groupId;
  if (
    shape.frameId &&
    shapes.some((s) => s.id === shape.frameId && s.type === "frame")
  )
    return shape.frameId;
}
export function ancestors(shape: Shape, shapes: Shape[]): Shape[] {
  const result: Shape[] = [],
    seen = new Set([shape.id]);
  let id = parentId(shape, shapes);
  while (id && !seen.has(id)) {
    seen.add(id);
    const parent = shapes.find((s) => s.id === id);
    if (!parent) break;
    result.push(parent);
    id = parentId(parent, shapes);
  }
  return result;
}
export function isHidden(shape: Shape, shapes: Shape[]) {
  return !!shape.hidden || ancestors(shape, shapes).some((s) => s.hidden);
}
export function isLocked(shape: Shape, shapes: Shape[]) {
  return !!shape.locked || ancestors(shape, shapes).some((s) => s.locked);
}
export function roots(shapes: Shape[], ids: Iterable<string>) {
  const selected = new Set(ids);
  return shapes.filter(
    (s) =>
      selected.has(s.id) &&
      !ancestors(s, shapes).some((p) => selected.has(p.id)),
  );
}
export function expandSelection(shapes: Shape[], ids: Iterable<string>) {
  const selected = new Set(ids);
  return shapes.filter(
    (s) =>
      selected.has(s.id) ||
      ancestors(s, shapes).some((p) => selected.has(p.id)),
  );
}
export function selectionTarget(shape: Shape, shapes: Shape[]) {
  return (
    ancestors(shape, shapes)
      .filter((p) => p.type === "group")
      .at(-1)?.id || shape.id
  );
}
export function layers(shapes: Shape[]) {
  const reversed = [...shapes].reverse(),
    result: { shape: Shape; depth: number; ancestors: string[] }[] = [],
    seen = new Set<string>();
  function visit(shape: Shape, path: string[]) {
    if (seen.has(shape.id)) return;
    seen.add(shape.id);
    result.push({ shape, depth: path.length, ancestors: path });
    for (const child of reversed.filter(
      (s) => parentId(s, shapes) === shape.id,
    ))
      visit(child, [...path, shape.id]);
  }
  for (const shape of reversed.filter((s) => !parentId(s, shapes)))
    visit(shape, []);
  // Corrupt/legacy references must never make a layer disappear.
  for (const shape of reversed) if (!seen.has(shape.id)) visit(shape, []);
  return result;
}
export function boxSelection(shapes: Shape[], box: Bounds) {
  const contained = shapes.filter((s) => {
    if (isHidden(s, shapes) || isLocked(s, shapes)) return false;
    const b = javascriptBounds([s]);
    return (
      b &&
      b.x >= box.x &&
      b.y >= box.y &&
      b.x + b.width <= box.x + box.width &&
      b.y + b.height <= box.y + box.height
    );
  });
  return roots(
    shapes,
    contained.map((s) => selectionTarget(s, shapes)),
  ).map((s) => s.id);
}
export function alignmentPatches(
  shapes: Shape[],
  ids: Iterable<string>,
  align: string,
) {
  const items = roots(shapes, ids).filter((s) => !isLocked(s, shapes));
  const bounds = javascriptBounds(items);
  if (!bounds || items.length < 2) return [];
  return items.map((shape) => {
    const b = javascriptBounds([shape])!;
    const dx =
      align === "left"
        ? bounds.x - b.x
        : align === "center"
          ? bounds.x + bounds.width / 2 - b.x - b.width / 2
          : align === "right"
            ? bounds.x + bounds.width - b.x - b.width
            : 0;
    const dy =
      align === "top"
        ? bounds.y - b.y
        : align === "middle"
          ? bounds.y + bounds.height / 2 - b.y - b.height / 2
          : align === "bottom"
            ? bounds.y + bounds.height - b.y - b.height
            : 0;
    return { id: shape.id, patch: { x: shape.x + dx, y: shape.y + dy } };
  });
}
export function snapMove(
  shapes: Shape[],
  ids: Iterable<string>,
  dx: number,
  dy: number,
  tolerance: number,
) {
  const items = roots(shapes, ids),
    bounds = javascriptBounds(items);
  if (!bounds)
    return { dx, dy, guides: [] as { axis: "x" | "y"; value: number }[] };
  const moving = new Set(
    expandSelection(
      shapes,
      items.map((s) => s.id),
    ).map((s) => s.id),
  );
  let bestX = tolerance + 1,
    bestY = tolerance + 1,
    offsetX = 0,
    offsetY = 0;
  const guides: { axis: "x" | "y"; value: number }[] = [];
  let xGuide: number | undefined, yGuide: number | undefined;
  for (const shape of shapes.filter(
    (s) => !moving.has(s.id) && !isHidden(s, shapes) && s.type !== "group",
  )) {
    const b = javascriptBounds([shape]);
    if (!b) continue;
    for (const target of [b.x, b.x + b.width / 2, b.x + b.width])
      for (const anchor of [
        bounds.x + dx,
        bounds.x + bounds.width / 2 + dx,
        bounds.x + bounds.width + dx,
      ]) {
        const diff = target - anchor;
        if (Math.abs(diff) < bestX) {
          bestX = Math.abs(diff);
          offsetX = diff;
          xGuide = target;
        }
      }
    for (const target of [b.y, b.y + b.height / 2, b.y + b.height])
      for (const anchor of [
        bounds.y + dy,
        bounds.y + bounds.height / 2 + dy,
        bounds.y + bounds.height + dy,
      ]) {
        const diff = target - anchor;
        if (Math.abs(diff) < bestY) {
          bestY = Math.abs(diff);
          offsetY = diff;
          yGuide = target;
        }
      }
  }
  if (bestX <= tolerance && xGuide !== undefined) {
    dx += offsetX;
    guides.push({ axis: "x", value: xGuide });
  }
  if (bestY <= tolerance && yGuide !== undefined) {
    dy += offsetY;
    guides.push({ axis: "y", value: yGuide });
  }
  return { dx, dy, guides };
}
export function clipboardCopies(
  shapes: Shape[],
  sourceProject: string,
  destinationProject: string,
  offset = 24,
) {
  const allowed = shapes.filter(
    (s) => s.type !== "image" || sourceProject === destinationProject,
  );
  const ids = new Map(
    allowed.map((s) => [s.id, "s" + crypto.randomUUID().replaceAll("-", "")]),
  );
  return allowed.map((s) => ({
    ...s,
    id: ids.get(s.id)!,
    x: s.x + offset,
    y: s.y + offset,
    groupId: ids.get(s.groupId || "") || "",
    frameId: ids.get(s.frameId || "") || "",
    targetFrameId: ids.get(s.targetFrameId || "") || "",
    locked: false,
  }));
}
