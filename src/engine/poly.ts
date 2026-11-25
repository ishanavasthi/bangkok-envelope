// Polygon helpers in a local metric frame (metres). All boolean and offset
// work goes through Clipper2 on integer millimetres, which makes it robust
// for concave, near-degenerate and self-touching shapes.
import {
  Clipper,
  ClipperOffset,
  EndType,
  FillRule,
  JoinType,
  Path64,
  Paths64,
  Point64,
} from 'clipper2-js';

export type Pt = [number, number];
/** A set of rings (outer rings and holes, any orientation), Clipper style. */
export type Rings = Pt[][];

const S = 1000; // metres -> millimetres
const ARC_TOL = 40; // 4 cm chord error on rounded corners: invisible, and keeps vertex counts low

/** Stroke or inflate with a coarse arc tolerance (Clipper's default is ~1 mm, far too fine here). */
function inflate(ps: Paths64, delta: number, join: JoinType, end: EndType): Paths64 {
  const co = new ClipperOffset(2, ARC_TOL);
  co.addPaths(ps, join, end);
  const out = new Paths64();
  // Open paths and joined outlines: Clipper halves delta, so pass the full width.
  co.execute(delta, out);
  return out;
}

function toPath(r: Pt[]): Path64 {
  const p = new Path64();
  for (const [x, y] of r) p.push(new Point64(Math.round(x * S), Math.round(y * S)));
  return p;
}
function toPaths(rs: Rings): Paths64 {
  const ps = new Paths64();
  for (const r of rs) if (r.length >= 2) ps.push(toPath(r));
  return ps;
}
function fromPaths(ps: Paths64): Rings {
  const out: Rings = [];
  for (const p of ps) {
    const r: Pt[] = [];
    for (const q of p) {
      const pt: Pt = [q.x / S, q.y / S];
      const last = r[r.length - 1];
      if (!last || last[0] !== pt[0] || last[1] !== pt[1]) r.push(pt);
    }
    while (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
    if (r.length >= 3 && Math.abs(ringArea(r)) > 1e-4) out.push(r);
  }
  return out;
}

/** Union of several ring sets, each filled on its own (orientation-safe). */
export function unionAll(sets: Rings[]): Rings {
  let acc: Rings = [];
  for (const s of sets) if (s.length) acc = acc.length ? union(acc, s) : clean(s);
  return acc;
}
export function union(a: Rings, b: Rings = []): Rings {
  return fromPaths(Clipper.Union(toPaths(a), toPaths(b), FillRule.NonZero));
}
export function difference(a: Rings, b: Rings): Rings {
  if (!b.length) return a.map((r) => r.slice());
  return fromPaths(Clipper.Difference(toPaths(a), toPaths(b), FillRule.NonZero));
}
export function intersect(a: Rings, b: Rings): Rings {
  return fromPaths(Clipper.Intersect(toPaths(a), toPaths(b), FillRule.NonZero));
}
/** Uniform inset (negative d) or outset (positive d) of closed polygons. */
export function offset(a: Rings, d: number): Rings {
  if (d === 0 || !a.length) return a.map((r) => r.slice());
  // clipper2-js's closed-polygon offset returned shifted shapes in testing, so
  // offset by stroking the outline (a band of half-width |d|) and then
  // subtracting it (inset) or adding it (outset). Corners come out round.
  const band = fromPaths(inflate(toPaths(a), 2 * (Math.abs(d) * S + ARC_TOL), JoinType.Round, EndType.Joined));
  return d < 0 ? difference(a, band) : union(a, band);
}
/** Outer rings positive (counter-clockwise), holes negative, as Clipper's offset expects. */
export function orient(a: Rings): Rings {
  const out: Rings = [];
  for (const poly of toPolygons(a)) {
    poly.forEach((r, i) => {
      const pos = ringArea(r) > 0;
      out.push((i === 0) === pos ? r : r.slice().reverse());
    });
  }
  return out;
}
/** Normalise a possibly self-intersecting ring into clean polygons. */
export function clean(a: Rings): Rings {
  return fromPaths(Clipper.Union(toPaths(a), new Paths64(), FillRule.NonZero));
}

/**
 * Everything within distance d of the segment a-b (a capsule). This is the
 * literal reading of "at least d from the boundary": the distance to the
 * boundary segment, including its end points.
 */
export function capsule(a: Pt, b: Pt, d: number): Rings {
  if (d <= 0) return [];
  const seg = new Paths64();
  seg.push(toPath([a, b]));
  // Clipper2 treats delta as the full width for open paths (it halves it).
  // Arcs are polygonised with vertices on the circle, so chords dip inside it
  // by up to ARC_TOL. Grow the radius by that much so the cut stays conservative.
  return fromPaths(inflate(seg, 2 * (d * S + ARC_TOL), JoinType.Round, EndType.Round));
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
  let lo = 0, hi = 1;
  while (area(offset(a, -hi)) > target && hi < 500) hi *= 2;
  for (let i = 0; i < 40 && hi - lo > 0.01; i++) {
    const mid = (lo + hi) / 2;
    if (area(offset(a, -mid)) > target) lo = mid;
    else hi = mid;
  }
  return { rings: offset(a, -hi), inset: hi };
}
