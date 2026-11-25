import type { LngLat } from './geo';

const key = (p: LngLat) => `${p[0].toFixed(8)},${p[1].toFixed(8)}`;
/**
 * Keep the road marking through edits. Dragging a corner or the whole plot
 * keeps the corner count, so indices stay valid. Adding a corner splits an
 * edge (both halves inherit it); deleting one merges two edges (road if
 * either was). Unchanged corners are matched by exact coordinates.
 */
export function remapRoad(old: LngLat[], nw: LngLat[], idx: number[]): number[] {
  if (old.length === nw.length) return idx.filter((i) => i < nw.length);
  const n = old.length;
  const pos = new Map(old.map((p, i) => [key(p), i]));
  const oi = nw.map((p) => pos.get(key(p)) ?? -1);
  if (!oi.some((i) => i >= 0)) return [];
  const prevOld = (j: number) => { for (let k = 0; k < nw.length; k++) { const v = oi[(j - k + nw.length) % nw.length]; if (v >= 0) return v; } return -1; };
  const nextOld = (j: number) => { for (let k = 0; k < nw.length; k++) { const v = oi[(j + k) % nw.length]; if (v >= 0) return v; } return -1; };
  const out: number[] = [];
  for (let j = 0; j < nw.length; j++) {
    const a = prevOld(j), b = nextOld((j + 1) % nw.length);
    if (a < 0 || b < 0) continue;
    // old edges from a forward to b (one edge normally, several after a deletion; the split edge after an insertion)
    let road = false;
    for (let k = a, steps = 0; steps < n; k = (k + 1) % n, steps++) {
      if (idx.includes(k)) road = true;
      if ((k + 1) % n === b) break;
    }
    if (road) out.push(j);
  }
  return out;
}

