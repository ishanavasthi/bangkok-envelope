// Polygon helpers in a local metric frame (metres). All boolean and offset
// work goes through Clipper (Angus Johnson, v6.4.2 JS port) on integer
// millimetres, which keeps it robust for concave, near-degenerate and
// self-touching shapes. (clipper2-js was tried first and returned wrong
// insets for a plain rectangle, so it was dropped.)
import ClipperLib from 'clipper-lib';

export type Pt = [number, number];
/** A set of rings (outer rings and holes, any orientation), Clipper style. */
export type Rings = Pt[][];

type IntPt = { X: number; Y: number };
type Path = IntPt[];

const S = 1000; // metres -> millimetres
const ARC_TOL = 40; // 4 cm chord error on rounded corners: invisible, and keeps vertex counts low
const NZ = ClipperLib.PolyFillType.pftNonZero;

function toPaths(rs: Rings): Path[] {
  return rs.filter((r) => r.length >= 2).map((r) => r.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) })));
}
function fromPaths(ps: Path[]): Rings {
  const out: Rings = [];
  for (const p of ps) {
    const r: Pt[] = [];
    for (const q of p) {
      const pt: Pt = [q.X / S, q.Y / S];
      const last = r[r.length - 1];
      if (!last || last[0] !== pt[0] || last[1] !== pt[1]) r.push(pt);
    }
    while (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
    if (r.length >= 3 && Math.abs(ringArea(r)) > 1e-4) out.push(r);
  }
  return out;
}

function boolOp(type: number, a: Rings, b: Rings): Rings {
  const c = new ClipperLib.Clipper();
  c.AddPaths(toPaths(a), ClipperLib.PolyType.ptSubject, true);
  if (b.length) c.AddPaths(toPaths(b), ClipperLib.PolyType.ptClip, true);
  const sol: Path[] = [];
  c.Execute(type, sol, NZ, NZ);
  return fromPaths(sol);
}

/** Offset paths. Closed: delta grows outers / shrinks holes. Open: delta is the half-width. */
function inflate(ps: Path[], delta: number, join: number, end: number): Path[] {
  const co = new ClipperLib.ClipperOffset(2, ARC_TOL);
  co.AddPaths(ps, join, end);
  const sol: Path[] = [];
  co.Execute(sol, delta);
  return sol;
}

/** Union of several ring sets, each filled on its own (orientation-safe). */
export function unionAll(sets: Rings[]): Rings {
  let acc: Rings = [];
  for (const s of sets) if (s.length) acc = acc.length ? union(acc, s) : clean(s);
  return acc;
}
export function union(a: Rings, b: Rings = []): Rings {
  return boolOp(ClipperLib.ClipType.ctUnion, a, b);
}
export function difference(a: Rings, b: Rings): Rings {
  if (!b.length) return a.map((r) => r.slice());
  return boolOp(ClipperLib.ClipType.ctDifference, a, b);
}
export function intersect(a: Rings, b: Rings): Rings {
  return boolOp(ClipperLib.ClipType.ctIntersection, a, b);
}
/** Normalise a possibly self-intersecting ring set into clean polygons (outers and holes correctly oriented). */
export function clean(a: Rings): Rings {
  return boolOp(ClipperLib.ClipType.ctUnion, a, []);
}
/**
 * Uniform inset (negative d) or outset (positive d). Corners are rounded,
 * which matches "at least d from the boundary" exactly. The inset is grown by
 * the arc tolerance so polygonised arcs never come closer than d.
 */
export function offset(a: Rings, d: number): Rings {
  if (d === 0 || !a.length) return a.map((r) => r.slice());
  const delta = d < 0 ? d * S - ARC_TOL : d * S;
  return fromPaths(inflate(toPaths(clean(a)), delta, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon));
}

/**
 * Everything within distance d of the segment a-b (a capsule). This is the
 * literal reading of "at least d from the boundary": the distance to the
 * boundary segment, including its end points. Arcs are polygonised with
 * vertices on the circle, so chords dip inside it by up to ARC_TOL; the
 * radius is grown by that much so the cut stays conservative.
 */
export function capsule(a: Pt, b: Pt, d: number): Rings {
  if (d <= 0) return [];
  return fromPaths(inflate(toPaths([[a, b]]), d * S + ARC_TOL, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etOpenRound));
}

export function ringArea(r: Pt[]): number {
  let s = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const [x1, y1] = r[i];
    const [x2, y2] = r[(i + 1) % n];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}
/** Net area of a ring set (holes subtract), after normalising. */
export function area(a: Rings): number {
  if (!a.length) return 0;
  return Math.abs(a.reduce((s, r) => s + ringArea(r), 0));
}

export function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function segSegDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(segDist(a, c, d), segDist(b, c, d), segDist(c, a, b), segDist(d, a, b));
}
function orient3(a: Pt, b: Pt, c: Pt) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
export function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o1 = orient3(a, b, c), o2 = orient3(a, b, d), o3 = orient3(c, d, a), o4 = orient3(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}
/** Minimum distance between the outline of a ring set and a segment. */
export function ringsToSegDist(a: Rings, p: Pt, q: Pt): number {
  let m = Infinity;
  for (const r of a) for (let i = 0; i < r.length; i++) m = Math.min(m, segSegDist(r[i], r[(i + 1) % r.length], p, q));
  return m;
}

export function pointInRing(p: Pt, r: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Group a flat ring set into polygons [outer, ...holes] (for GeoJSON). */
export function toPolygons(a: Rings): Pt[][][] {
  const rings = a.filter((r) => r.length >= 3 && Math.abs(ringArea(r)) > 1e-6);
  if (!rings.length) return [];
  // Clipper output: outer and hole rings have opposite orientation.
  const biggest = rings.reduce((m, r) => (Math.abs(ringArea(r)) > Math.abs(ringArea(m)) ? r : m));
  const outerSign = Math.sign(ringArea(biggest));
  const outers = rings.filter((r) => Math.sign(ringArea(r)) === outerSign);
  const holes = rings.filter((r) => Math.sign(ringArea(r)) !== outerSign);
  const polys: Pt[][][] = outers.map((o) => [o]);
  for (const h of holes) {
    const owner = polys
      .filter((p) => pointInRing(h[0], p[0]))
      .sort((x, y) => Math.abs(ringArea(x[0])) - Math.abs(ringArea(y[0])))[0];
    if (owner) owner.push(h);
  }
  return polys;
}

/** Shrink a polygon by a uniform inset until its area is at most target. */
export function shrinkToArea(a: Rings, target: number): { rings: Rings; inset: number } {
  const full = area(a);
  if (full <= target) return { rings: a, inset: 0 };
  // Newton steps on area(δ): d(area)/dδ ≈ -perimeter. Converges in a few
  // iterations, where bisection needed ~20 offsets of a many-vertex shape.
  // We keep the best inset that is at or under target, so the result never
  // exceeds it.
  let d = 0, cur = a, curA = full;
  let best: { rings: Rings; inset: number } | null = null;
  // No inset can exceed half the smaller bounding-box side (the shape is gone by then).
  const xs = a.flat().map((p) => p[0]), ys = a.flat().map((p) => p[1]);
  const maxInset = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + 0.01;
  let lo = 0, hi = maxInset; // bracket: area(lo) > target >= area(hi)
  const tol = Math.max(0.5, target * 0.002);
  for (let i = 0; i < 16; i++) {
    const per = perimeter(cur) || 1;
    // Aim half a tolerance under target so millimetre rounding cannot leave
    // us stuck a hair above it.
    let next = d + (curA - (target - tol / 2)) / per;
    if (next - d < 1e-3 && curA > target) next = d + 1e-3;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    d = next;
    cur = offset(a, -d);
    curA = area(cur);
    if (curA > target) lo = d;
    else {
      hi = d;
      best = { rings: cur, inset: d };
      if (target - curA < tol) break;
    }
    if (!curA) break;
  }
  return best ?? { rings: offset(a, -hi), inset: hi };
}

export function perimeter(a: Rings): number {
  let s = 0;
  for (const r of a) for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length];
    s += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  return s;
}
