import type { Shape } from "./document";

// Shapes use page coordinates. Ellipses rotate around their center; the other
// canvas objects rotate around their top-left corner.
export function containingFrameId(shape: Shape, shapes: Shape[]): string {
  if (shape.type === "frame") return "";
  const angle = (shape.rotation * Math.PI) / 180;
  const cx =
    shape.x +
    (shape.type === "ellipse"
      ? shape.width / 2
      : (shape.width * Math.cos(angle) - shape.height * Math.sin(angle)) / 2);
  const cy =
    shape.y +
    (shape.type === "ellipse"
      ? shape.height / 2
      : (shape.width * Math.sin(angle) + shape.height * Math.cos(angle)) / 2);
  let parent: Shape | undefined;
  for (const frame of shapes) {
    if (frame.type !== "frame" || frame.hidden) continue;
    const radians = (frame.rotation * Math.PI) / 180;
    const dx = cx - frame.x,
      dy = cy - frame.y;
    const x = dx * Math.cos(radians) + dy * Math.sin(radians);
    const y = -dx * Math.sin(radians) + dy * Math.cos(radians);
    if (
      x >= 0 &&
      y >= 0 &&
      x <= frame.width &&
      y <= frame.height &&
      (!parent || frame.width * frame.height <= parent.width * parent.height)
    ) {
      parent = frame;
    }
  }
  return parent?.id || "";
}

export function withAutomaticFrame(
  shape: Shape,
  patch: Partial<Shape>,
  shapes: Shape[],
): Partial<Shape> {
  if (
    shape.type === "frame" ||
    "frameId" in patch ||
    !["x", "y", "width", "height", "rotation"].some((key) => key in patch)
  )
    return patch;
  const frameId = containingFrameId({ ...shape, ...patch }, shapes);
  return frameId === (shape.frameId || "") ? patch : { ...patch, frameId };
}
