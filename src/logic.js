// Pure viewport/stroke helpers for the whiteboard. index.html imports these;
// tests exercise them without a canvas or DOM.

export const WORLD_W = 1920;
export const WORLD_H = 1080;
export const MAX_SCALE = 4;
export const MAX_STROKES = 2000;

export function minScale(w, h) {
  return Math.min(w / WORLD_W, h / WORLD_H);
}

export function clampViewport(viewport, w, h) {
  const scale = Math.max(minScale(w, h), Math.min(MAX_SCALE, viewport.scale));
  const visW = w / scale;
  const visH = h / scale;
  const x = visW >= WORLD_W
    ? -(visW - WORLD_W) / 2
    : Math.max(0, Math.min(WORLD_W - visW, viewport.x));
  const y = visH >= WORLD_H
    ? -(visH - WORLD_H) / 2
    : Math.max(0, Math.min(WORLD_H - visH, viewport.y));
  return { x, y, scale };
}

export function fitViewport(w, h) {
  return clampViewport({ x: 0, y: 0, scale: minScale(w, h) }, w, h);
}

export function screenToWorld(sx, sy, viewport) {
  return [sx / viewport.scale + viewport.x, sy / viewport.scale + viewport.y];
}

export function worldToScreen(wx, wy, viewport) {
  return [(wx - viewport.x) * viewport.scale, (wy - viewport.y) * viewport.scale];
}

// New viewport after zooming by `factor` while keeping the world point under
// (screenCx, screenCy) anchored to that same screen position.
export function zoomedViewport(viewport, screenCx, screenCy, factor, w, h) {
  const [wx, wy] = screenToWorld(screenCx, screenCy, viewport);
  const scale = Math.max(minScale(w, h), Math.min(MAX_SCALE, viewport.scale * factor));
  return clampViewport({ scale, x: wx - screenCx / scale, y: wy - screenCy / scale }, w, h);
}

export function pinchState(a, b) {
  return {
    dist: Math.hypot(b.x - a.x, b.y - a.y),
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
  };
}

// New viewport after a two-finger move: zoom by the distance ratio and anchor
// the world point that was under the old pinch center to the new pinch center.
export function pinchedViewport(viewport, last, pinch, w, h) {
  const [wx, wy] = screenToWorld(last.cx, last.cy, viewport);
  const scale = Math.max(minScale(w, h), Math.min(MAX_SCALE, viewport.scale * (pinch.dist / last.dist)));
  return clampViewport({ scale, x: wx - pinch.cx / scale, y: wy - pinch.cy / scale }, w, h);
}

export function inWorld(wx, wy) {
  return wx >= 0 && wx <= WORLD_W && wy >= 0 && wy <= WORLD_H;
}

export function trimStrokes(strokes, max = MAX_STROKES) {
  return strokes.length > max ? strokes.slice(-max) : strokes;
}

/**
 * Normalizes whatever is stored under the `strokes` key into
 * `{ rev, strokes }`.
 *
 * The canvas used to be persisted as a bare JSON array, rewritten in full on
 * every save. That is why a clear could be undone: any client still holding the
 * old array wrote all of it back, stroke for stroke. The object form carries a
 * revision that a clear increments, so a client can tell it missed one — and
 * strokes are appended individually (`array_append`) rather than rewritten, so
 * a stale client contributes only what it actually drew.
 *
 * Bare arrays are still read, because households have them stored today.
 */
export function parseCanvas(raw) {
  if (Array.isArray(raw)) return { rev: 0, strokes: raw, legacy: true };
  if (raw && typeof raw === "object" && Array.isArray(raw.strokes)) {
    return { rev: Number(raw.rev) || 0, strokes: raw.strokes, legacy: false };
  }
  return { rev: 0, strokes: [], legacy: false };
}

/** Whether an incoming clear is newer than what this client has applied. */
export function isNewerClear(payloadRev, currentRev) {
  const rev = Number(payloadRev);
  // A clear published before revisions existed carries none; honour it rather
  // than ignoring a real clear from an older client.
  return Number.isFinite(rev) ? rev > currentRev : true;
}

export function isValidRemoteStroke(payload, seenIds) {
  const { strokeId, points } = payload ?? {};
  return Boolean(strokeId) && !seenIds.has(strokeId) && Array.isArray(points) && points.length >= 2;
}

export function isCursorStale(lastSeen, now, ttlMs = 5000) {
  return now - lastSeen > ttlMs;
}

export function isCursorOnScreen(sx, sy, w, h, margin = 14) {
  return sx >= -margin && sy >= -margin && sx <= w + margin && sy <= h + margin;
}
