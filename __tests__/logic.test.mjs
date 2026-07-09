import { describe, it, expect } from "vitest";
import {
  WORLD_W, WORLD_H, MAX_SCALE, MAX_STROKES,
  minScale, clampViewport, fitViewport, screenToWorld, worldToScreen,
  zoomedViewport, pinchState, pinchedViewport, inWorld,
  trimStrokes, isValidRemoteStroke, isCursorStale, isCursorOnScreen,
} from "../src/logic.js";

// A 960×540 canvas is exactly half the 1920×1080 world in both axes.
const W = 960;
const H = 540;

describe("minScale / fitViewport", () => {
  it("fits the limiting axis", () => {
    expect(minScale(W, H)).toBe(0.5);
    expect(minScale(1920, 540)).toBe(0.5);  // height limits
    expect(minScale(960, 1080)).toBe(0.5);  // width limits
  });

  it("fitViewport centers the world on a canvas wider than the fitted world", () => {
    // 1000×540 at scale 0.5 shows 2000 world px of width — 80 px of slack, centered.
    const vp = fitViewport(1000, 540);
    expect(vp.scale).toBe(0.5);
    expect(vp.x).toBe(-(2000 - WORLD_W) / 2);
    expect(vp.y).toBeCloseTo(0); // -0 from the centering branch
  });
});

describe("clampViewport", () => {
  it("clamps scale between fit and MAX_SCALE", () => {
    expect(clampViewport({ x: 0, y: 0, scale: 0.01 }, W, H).scale).toBe(0.5);
    expect(clampViewport({ x: 0, y: 0, scale: 99 }, W, H).scale).toBe(MAX_SCALE);
  });

  it("keeps the visible window inside the world when zoomed in", () => {
    // At scale 1 the visible window is 960×540; max x is 1920-960=960.
    const vp = clampViewport({ x: 5000, y: -50, scale: 1 }, W, H);
    expect(vp.x).toBe(WORLD_W - W);
    expect(vp.y).toBe(0);
  });

  it("does not mutate the input viewport", () => {
    const input = { x: 5000, y: 0, scale: 1 };
    clampViewport(input, W, H);
    expect(input).toEqual({ x: 5000, y: 0, scale: 1 });
  });
});

describe("screenToWorld / worldToScreen", () => {
  const vp = { x: 100, y: 50, scale: 2 };

  it("converts screen to world and back", () => {
    const [wx, wy] = screenToWorld(200, 100, vp);
    expect([wx, wy]).toEqual([200, 100]);
    expect(worldToScreen(wx, wy, vp)).toEqual([200, 100]);
  });

  it("round-trips arbitrary points", () => {
    const [sx, sy] = worldToScreen(123.4, 567.8, vp);
    const [wx, wy] = screenToWorld(sx, sy, vp);
    expect(wx).toBeCloseTo(123.4);
    expect(wy).toBeCloseTo(567.8);
  });
});

describe("zoomedViewport", () => {
  it("keeps the world point under the zoom center anchored", () => {
    const vp = { x: 0, y: 0, scale: 1 };
    const [beforeX, beforeY] = screenToWorld(480, 270, vp);
    const next = zoomedViewport(vp, 480, 270, 2, W, H);
    expect(next.scale).toBe(2);
    const [afterX, afterY] = screenToWorld(480, 270, next);
    expect(afterX).toBeCloseTo(beforeX);
    expect(afterY).toBeCloseTo(beforeY);
  });

  it("never zooms out past the fitted scale", () => {
    const next = zoomedViewport({ x: 0, y: 0, scale: 0.5 }, 0, 0, 0.1, W, H);
    expect(next.scale).toBe(0.5);
  });

  it("never zooms in past MAX_SCALE", () => {
    const next = zoomedViewport({ x: 0, y: 0, scale: 3.9 }, 0, 0, 2, W, H);
    expect(next.scale).toBe(MAX_SCALE);
  });
});

describe("pinchState / pinchedViewport", () => {
  it("computes distance and center of two pointers", () => {
    const p = pinchState({ x: 0, y: 0 }, { x: 30, y: 40 });
    expect(p.dist).toBe(50);
    expect(p.cx).toBe(15);
    expect(p.cy).toBe(20);
  });

  it("spreading fingers apart zooms in around the pinch center", () => {
    const vp = { x: 480, y: 270, scale: 1 }; // zoomed-in view
    const last = pinchState({ x: 400, y: 200 }, { x: 500, y: 300 });
    const pinch = pinchState({ x: 350, y: 150 }, { x: 550, y: 350 }); // 2× the spread
    const [beforeX, beforeY] = screenToWorld(last.cx, last.cy, vp);
    const next = pinchedViewport(vp, last, pinch, W, H);
    expect(next.scale).toBeCloseTo(2);
    // The world point under the old center is now under the new center.
    const [afterX, afterY] = screenToWorld(pinch.cx, pinch.cy, next);
    expect(afterX).toBeCloseTo(beforeX);
    expect(afterY).toBeCloseTo(beforeY);
  });
});

describe("inWorld", () => {
  it("accepts points inside and on the world edges", () => {
    expect(inWorld(0, 0)).toBe(true);
    expect(inWorld(WORLD_W, WORLD_H)).toBe(true);
    expect(inWorld(960, 540)).toBe(true);
  });
  it("rejects points outside the world", () => {
    expect(inWorld(-1, 10)).toBe(false);
    expect(inWorld(10, WORLD_H + 1)).toBe(false);
  });
});

describe("trimStrokes", () => {
  const stroke = (i) => ({ id: `s${i}` });

  it("returns the same array when under the cap", () => {
    const strokes = [stroke(1), stroke(2)];
    expect(trimStrokes(strokes)).toBe(strokes);
  });

  it("keeps only the newest MAX_STROKES entries", () => {
    const strokes = Array.from({ length: MAX_STROKES + 5 }, (_, i) => stroke(i));
    const trimmed = trimStrokes(strokes);
    expect(trimmed).toHaveLength(MAX_STROKES);
    expect(trimmed[0].id).toBe("s5");
    expect(trimmed.at(-1).id).toBe(`s${MAX_STROKES + 4}`);
  });

  it("honors a custom cap", () => {
    expect(trimStrokes([stroke(1), stroke(2), stroke(3)], 2).map((s) => s.id)).toEqual(["s2", "s3"]);
  });
});

describe("isValidRemoteStroke", () => {
  const good = { strokeId: "a", points: [[0, 0], [1, 1]] };

  it("accepts a new stroke with at least two points", () => {
    expect(isValidRemoteStroke(good, new Set())).toBe(true);
  });

  it("rejects strokes already seen (echo of our own publish)", () => {
    expect(isValidRemoteStroke(good, new Set(["a"]))).toBe(false);
  });

  it("rejects malformed payloads", () => {
    const seen = new Set();
    expect(isValidRemoteStroke(undefined, seen)).toBe(false);
    expect(isValidRemoteStroke({}, seen)).toBe(false);
    expect(isValidRemoteStroke({ strokeId: "b" }, seen)).toBe(false);
    expect(isValidRemoteStroke({ strokeId: "b", points: "nope" }, seen)).toBe(false);
    expect(isValidRemoteStroke({ strokeId: "b", points: [[0, 0]] }, seen)).toBe(false);
  });
});

describe("cursor helpers", () => {
  it("marks a cursor stale after 5s of silence", () => {
    expect(isCursorStale(1000, 6000)).toBe(false);
    expect(isCursorStale(1000, 6001)).toBe(true);
  });

  it("keeps cursors within a 14px margin of the canvas", () => {
    expect(isCursorOnScreen(-14, 0, W, H)).toBe(true);
    expect(isCursorOnScreen(-15, 0, W, H)).toBe(false);
    expect(isCursorOnScreen(W + 14, H + 14, W, H)).toBe(true);
    expect(isCursorOnScreen(W + 15, H, W, H)).toBe(false);
  });
});
