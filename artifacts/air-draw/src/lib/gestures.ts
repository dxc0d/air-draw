export interface LM { x: number; y: number; z: number }
export type GestureMode = "standby" | "draw" | "select" | "erase" | "pinch";

export function dist3(a: LM, b: LM): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Rotation-invariant: tip must be farther from wrist than both PIP and MCP */
export function fingerExtended(lm: LM[], tip: number, pip: number, mcp: number): boolean {
  const w = lm[0];
  return (
    dist3(lm[tip], w) > dist3(lm[pip], w) * 1.09 &&
    dist3(lm[tip], w) > dist3(lm[mcp], w) * 1.25
  );
}

export function extendedCount(lm: LM[]): number {
  const fingers: [number, number, number][] = [
    [8, 7, 5], [12, 11, 9], [16, 15, 13], [20, 19, 17],
  ];
  return fingers.filter(([t, p, m]) => fingerExtended(lm, t, p, m)).length;
}

/** Pinch: thumb tip and index tip very close, middle/ring/pinky down */
export function isPinch(lm: LM[]): boolean {
  return (
    dist3(lm[4], lm[8]) < 0.052 &&
    !fingerExtended(lm, 12, 11, 9) &&
    !fingerExtended(lm, 16, 15, 13) &&
    !fingerExtended(lm, 20, 19, 17)
  );
}

export function rawGesture(lm: LM[]): GestureMode {
  if (isPinch(lm)) return "pinch";
  const n = extendedCount(lm);
  if (n === 0) return "standby";
  if (n === 1) return "draw";
  if (n === 2) return "select";
  return "erase";
}

/** Returns normalised [0-1] cursor position for the given gesture */
export function cursorPoint(lm: LM[], g: GestureMode): { x: number; y: number } {
  if (g === "pinch")  return { x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 };
  if (g === "erase")  return { x: lm[9].x,  y: lm[9].y };
  return { x: lm[8].x, y: lm[8].y };
}
