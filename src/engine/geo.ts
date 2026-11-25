// Local metric projection around a reference point. Equirectangular is
// accurate to well under 0.1% over a few hundred metres at Bangkok's
// latitude, which is far below survey tolerance for a plot.
import type { Pt } from './poly';

export type LngLat = [number, number];
const R = 6378137;

export interface Frame {
  origin: LngLat;
  toLocal(p: LngLat): Pt;
  toLngLat(p: Pt): LngLat;
}

export function makeFrame(origin: LngLat): Frame {
  const k = Math.cos((origin[1] * Math.PI) / 180);
  const d2r = Math.PI / 180;
  return {
    origin,
    toLocal: ([lng, lat]) => [(lng - origin[0]) * d2r * R * k, (lat - origin[1]) * d2r * R],
    toLngLat: ([x, y]) => [origin[0] + x / (d2r * R * k), origin[1] + y / (d2r * R)],
  };
}

export function centroid(ring: LngLat[]): LngLat {
  let x = 0, y = 0;
  const n = ring.length;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / n, y / n];
}

/** Great-circle-ish distance in metres (fine for < 10 km). */
export function distM(a: LngLat, b: LngLat): number {
  const f = makeFrame(a);
  const [x, y] = f.toLocal(b);
  return Math.hypot(x, y);
}
