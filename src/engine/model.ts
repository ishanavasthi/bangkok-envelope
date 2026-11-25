// The rules engine: plot + road + building type -> rules, allowed space, designs.
// Every number below is tied to a clause in src/rules/rules.json.
import {
  area,
  capsule,
  clean,
  difference,
  ringArea,
  ringsToSegDist,
  segDist,
  shrinkToArea,
  union,
  unionAll,
  type Pt,
  type Rings,
} from './poly';

export type BuildingType = 'condo' | 'office' | 'hotel';
export type Regime = 'low' | 'high';

export interface Input {
  /** Plot outline in local metres (one ring, no repeated closing point). */
  plot: Pt[];
  /** Indices i of edges plot[i] -> plot[i+1] that face the public road. */
  roadEdges: number[];
  /** Right-of-way width of that road, metres. */
  roadWidth: number;
  type: BuildingType;
  /** FAR bonus taken under plan clauses 51-57, 0..0.2. */
  farBonus: number;
  /** Plot is within 500 m of a rail transit station (plan clause 37). */
  nearStation: boolean;
  /** Share of the plot inside the Y.10 zone, 0..1. */
  inZoneShare: number;
}

export const ZONE = { far: 8, osr: 0.04, permeableShare: 0.5, maxBonus: 0.2 };
export const HIGH_RISE_H = 23; // MR 33 clause 1
export const EXTRA_LARGE_GFA = 10000; // MR 33 clause 1
export const GROUND_FLOOR_H = 4.5;

export const TYPES: Record<BuildingType, { label: string; residential: boolean; f2f: number; note: string }> = {
  condo: { label: 'Condominium', residential: true, f2f: 3.1, note: 'Residential: 30% of the plot must stay open (BMA ord. 52(1)).' },
  office: { label: 'Office', residential: false, f2f: 3.9, note: 'Non-residential: 10% open (ord. 52(2)); over 10,000 m² needs a 12 m road or a station within 500 m (plan 17(10)).' },
  hotel: { label: 'Hotel', residential: false, f2f: 3.3, note: 'Non-residential: 10% open; over 80 rooms needs a 12 m road or a station within 500 m (plan 17(8)).' },
};
export const HOTEL_M2_PER_KEY = 45;
/** Practical minimum floor plates (not law): a tower needs lifts, two fire stairs and units around them. */
export const MIN_PLATE_TOWER = 300;
export const MIN_PLATE_LOW = 120;

/** Longest continuous run of road-facing edges (MR 33 cl. 2 asks for one side of the land ≥ 12 m). */
export function frontageRun(inp: Input): number {
  const es = edges(inp);
  const n = es.length;
  if (!es.some((e) => e.road)) return 0;
  if (es.every((e) => e.road)) return es.reduce((s, e) => s + e.len, 0);
  let best = 0;
  for (let i = 0; i < n; i++) {
    if (!es[i].road || es[(i - 1 + n) % n].road) continue; // start of a run
    let run = 0;
    for (let k = i; es[k % n].road && k < i + n; k++) run += es[k % n].len;
    best = Math.max(best, run);
  }
  return best;
}

/** BMA building ordinance 2544, clause 50 paragraph 2: road setback from the plot's road boundary. */
export function roadSetback(w: number): { d: number; rule: string } {
  if (w < 10) return { d: Math.max(0, 6 - w / 2), rule: `Road < 10 m: 6 m from the road centreline = ${fmt(Math.max(0, 6 - w / 2))} m from the plot edge` };
  if (w <= 20) return { d: w / 10, rule: `Road 10–20 m: 1/10 of road width = ${fmt(w / 10)} m` };
  return { d: 2, rule: 'Road > 20 m: 2 m from the road boundary' };
}
/** Windows/balconies above 9 m: 3 m from a neighbour boundary (ord. 54); covers the 2 m clear space of ord. 55. */
export const NEIGHBOUR_SETBACK_LOW = 3;
export const HIGH_RISE_SETBACK = 6; // MR 33 clause 4

export function fmt(n: number, d = 1) {
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }) : '–';
}

export interface Edge { a: Pt; b: Pt; road: boolean; len: number; }
export function edges(inp: Input): Edge[] {
  const p = inp.plot;
  return p.map((a, i) => {
    const b = p[(i + 1) % p.length];
    return { a, b, road: inp.roadEdges.includes(i), len: Math.hypot(b[0] - a[0], b[1] - a[1]) };
  });
}

export function setbacksFor(inp: Input, regime: Regime): number[] {
  const rs = roadSetback(inp.roadWidth).d;
  return edges(inp).map((e) =>
    regime === 'high' ? Math.max(HIGH_RISE_SETBACK, e.road ? rs : 0) : e.road ? rs : NEIGHBOUR_SETBACK_LOW,
  );
}

/** Ground footprint the building may occupy in a regime: plot minus a capsule along every edge. */
export function baseFootprint(inp: Input, regime: Regime): Rings {
  const plot = clean([inp.plot]);
  const sb = setbacksFor(inp, regime);
  const cuts: Rings = [];
  edges(inp).forEach((e, i) => cuts.push(...capsule(e.a, e.b, sb[i])));
  return difference(plot, union(cuts));
}

/** BMA ord. 49: at height z the building must be >= z/2 - W from the road edge. */
export function planeCut(inp: Input, rings: Rings, z: number): Rings {
  const need = z / 2 - inp.roadWidth;
  if (need <= 0 || !inp.roadEdges.length) return rings;
  const cuts: Rings = [];
  for (const e of edges(inp)) if (e.road) cuts.push(...capsule(e.a, e.b, need));
  return difference(rings, union(cuts));
}

export function maxHeightAt(inp: Input, p: Pt): number {
  let d = Infinity;
  for (const e of edges(inp)) if (e.road) d = Math.min(d, segDist(p, e.a, e.b));
  return 2 * (d + inp.roadWidth);
}

export interface Slice { z0: number; z1: number; rings: Rings; area: number; }

/** The allowed space as horizontal slices. Low-rise is capped below 23 m. */
export function envelope(inp: Input, regime: Regime, step = 3): Slice[] {
  const base = baseFootprint(inp, regime);
  const out: Slice[] = [];
  const cap = regime === 'low' ? HIGH_RISE_H - 0.01 : 400;
  for (let z = 0; z < cap; z += step) {
    const z1 = Math.min(z + step, cap);
    const r = planeCut(inp, base, z1);
    const a = area(r);
    if (a < 1) break;
    out.push({ z0: z, z1, rings: r, area: a });
  }
  return out;
}

export interface Floor { n: number; z0: number; z1: number; rings: Rings; area: number; }
export interface Check { id: string; label: string; required: string; actual: string; pass: boolean; ref: string; note?: string; }
export interface Design {
  id: string;
  name: string;
  summary: string;
  regime: Regime;
  floors: Floor[];
  gfa: number;
  footprint: number;
  height: number;
  far: number;
  openSpace: number;
  planted: number;
  checks: Check[];
  pass: boolean;
  units?: string;
}

export function stackFloors(inp: Input, fp: Rings, maxFloors: number, gfaCap: number, maxH: number): Floor[] {
  const f2f = TYPES[inp.type].f2f;
  const floors: Floor[] = [];
  let total = 0;
  for (let n = 0; n < maxFloors; n++) {
    const z0 = n === 0 ? 0 : GROUND_FLOOR_H + (n - 1) * f2f;
    const z1 = n === 0 ? GROUND_FLOOR_H : z0 + f2f;
    if (z1 > maxH) break;
    const rings = planeCut(inp, fp, z1);
    const a = area(rings);
    if (a < 25) break; // a sliver is not a usable floor
    if (total + a > gfaCap + 0.5) break;
    floors.push({ n: n + 1, z0, z1, rings, area: a });
    total += a;
  }
  return floors;
}

function plotArea(inp: Input) { return Math.abs(ringArea(inp.plot)); }

export function limits(inp: Input) {
  const A = plotArea(inp);
  const farEff = ZONE.far * (1 + Math.min(ZONE.maxBonus, Math.max(0, inp.farBonus)));
  const openRatio = TYPES[inp.type].residential ? 0.3 : 0.1;
  return { A, farEff, gfaMax: farEff * A, openRatio };
}

/** Largest footprint area such that both open-space rules hold for a given GFA. */
function maxFootprint(A: number, openRatio: number, gfa: number) {
  return A - Math.max(openRatio * A, ZONE.osr * gfa);
}

interface Spec { id: string; name: string; summary: string; regime: Regime; plateShare: number; }

function build(inp: Input, spec: Spec): Design {
  const { A, gfaMax, openRatio } = limits(inp);
  const base = baseFootprint(inp, spec.regime);
  const baseA = area(base);
  const low = spec.regime === 'low';
  const gfaCap = low ? Math.min(gfaMax, EXTRA_LARGE_GFA - 1) : gfaMax;
  const maxH = low ? HIGH_RISE_H - 0.01 : 1000;
  // Footprint must leave enough open space for the GFA it will carry. Iterate
  // because a smaller plate means less GFA, which relaxes the OSR rule.
  let target = Math.min(baseA, maxFootprint(A, openRatio, gfaCap)) * spec.plateShare;
  if (low) {
    // Spread the capped floor area over every floor that fits under 23 m,
    // instead of one huge plate that uses up the 10,000 m² in a single storey.
    const f2f = TYPES[inp.type].f2f;
    const nMax = Math.floor((HIGH_RISE_H - 0.01 - GROUND_FLOOR_H) / f2f) + 1;
    target = Math.min(target, (gfaCap / nMax) * (spec.plateShare < 1 ? spec.plateShare : 1));
  }
  let floors: Floor[] = [];
  let fp: Rings = [];
  for (let it = 0; it < 6; it++) {
    fp = target > 0 ? shrinkToArea(base, target).rings : [];
    floors = fp.length ? stackFloors(inp, fp, low ? 40 : 200, gfaCap, maxH) : [];
    const gfa = floors.reduce((s, f) => s + f.area, 0);
    const allowed = Math.min(baseA, maxFootprint(A, openRatio, gfa)) * spec.plateShare;
    const ground = floors[0]?.area ?? 0;
    if (ground <= allowed + 0.5) break;
    target = allowed - 0.5;
  }
  return evaluate(inp, spec, floors);
}

export function evaluate(inp: Input, spec: Spec, floors: Floor[]): Design {
  const { A, farEff, openRatio } = limits(inp);
  const t = TYPES[inp.type];
  const gfa = floors.reduce((s, f) => s + f.area, 0);
  const footprint = floors.length ? area(unionAll(floors.map((f) => f.rings))) : 0;
  const height = floors.length ? floors[floors.length - 1].z1 : 0;
  const openSpace = A - footprint;
  const planted = openSpace * ZONE.permeableShare;
  const isHigh = height >= HIGH_RISE_H || gfa >= EXTRA_LARGE_GFA;
  const es = edges(inp);
  const rs = roadSetback(inp.roadWidth);
  const reqRoad = isHigh ? Math.max(HIGH_RISE_SETBACK, rs.d) : rs.d;
  const reqSide = isHigh ? HIGH_RISE_SETBACK : NEIGHBOUR_SETBACK_LOW;
  const all = floors.flatMap((f) => f.rings);
  let minRoad = Infinity, minSide = Infinity;
  for (const e of es) {
    if (!all.length) break;
    const d = ringsToSegDist(all, e.a, e.b);
    if (e.road) minRoad = Math.min(minRoad, d);
    else minSide = Math.min(minSide, d);
  }
  // Height plane, checked on every vertex of every floor at its roof level.
  let worst = Infinity;
  if (inp.roadEdges.length) for (const f of floors) for (const r of f.rings) for (const p of r) worst = Math.min(worst, maxHeightAt(inp, p) - f.z1);
  const frontage = frontageRun(inp);
  const plate = floors.reduce((m, f) => Math.max(m, f.area), 0);
  const minPlate = isHigh ? MIN_PLATE_TOWER : MIN_PLATE_LOW;
  const needRoad = gfa > 30000 ? 18 : 10;
  const tol = 0.02;
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  add({ id: 'zone', label: 'Plot is inside zone Y.10', required: '100% of plot', actual: `${fmt(inp.inZoneShare * 100, 0)}%`, pass: inp.inZoneShare > 0.99, ref: 'Plan 2556, land-use map' });
  // Use permission
  if (inp.type === 'hotel') {
    const keys = Math.floor(gfa / HOTEL_M2_PER_KEY);
    const ok = keys <= 80 || inp.roadWidth >= 12 || inp.nearStation;
    add({ id: 'use', label: 'Hotel allowed at this size', required: '≤ 80 rooms, or road ≥ 12 m / station ≤ 500 m', actual: `~${keys} rooms, road ${fmt(inp.roadWidth)} m${inp.nearStation ? ', near station' : ''}`, pass: ok, ref: 'Plan 2556 cl. 17(8)' });
  } else if (inp.type === 'office') {
    const ok = gfa <= 10000 || inp.roadWidth >= 12 || inp.nearStation;
    add({ id: 'use', label: 'Office allowed at this size', required: '≤ 10,000 m², or road ≥ 12 m / station ≤ 500 m', actual: `${fmt(gfa, 0)} m², road ${fmt(inp.roadWidth)} m${inp.nearStation ? ', near station' : ''}`, pass: ok, ref: 'Plan 2556 cl. 17(10)' });
  } else {
    add({ id: 'use', label: 'Condominium allowed', required: 'Not prohibited in Y.10', actual: 'Allowed', pass: true, ref: 'Plan 2556 cl. 17' });
  }
  add({ id: 'far', label: 'Floor area ratio', required: `≤ ${fmt(farEff, 2)} (${fmt(farEff * A, 0)} m²)`, actual: `${fmt(gfa / A, 2)} (${fmt(gfa, 0)} m²)`, pass: gfa <= farEff * A + 0.5, ref: inp.farBonus > 0 ? 'Plan 2556 cl. 17(1) + bonus cl. 51–57' : 'Plan 2556 cl. 17(1)' });
  add({ id: 'open', label: `Open space ≥ ${openRatio * 100}% of plot`, required: `≥ ${fmt(openRatio * A, 0)} m²`, actual: `${fmt(openSpace, 0)} m² (${fmt((openSpace / A) * 100, 0)}%)`, pass: openSpace >= openRatio * A - 0.5, ref: `BMA ord. 2544 cl. 52(${t.residential ? 1 : 2})` });
  add({ id: 'osr', label: 'Open space ratio (OSR) ≥ 4% of floor area', required: `≥ ${fmt(ZONE.osr * gfa, 0)} m²`, actual: `${fmt(gfa ? (openSpace / gfa) * 100 : 0, 1)}%`, pass: openSpace >= ZONE.osr * gfa - 0.5, ref: 'Plan 2556 cl. 17(2)' });
  add({ id: 'class', label: 'Building class', required: 'High-rise if ≥ 23 m or ≥ 10,000 m²', actual: isHigh ? `High-rise / extra-large (${fmt(height)} m, ${fmt(gfa, 0)} m²)` : `Below high-rise (${fmt(height)} m, ${fmt(gfa, 0)} m²)`, pass: true, ref: 'MR 33 cl. 1' });
  add({ id: 'road', label: 'Setback from road edge', required: `≥ ${fmt(reqRoad, 2)} m`, actual: Number.isFinite(minRoad) ? `${fmt(minRoad, 2)} m` : '–', pass: !floors.length || minRoad >= reqRoad - tol, ref: isHigh ? 'MR 33 cl. 4; BMA ord. 50' : 'BMA ord. 50' });
  add({ id: 'side', label: 'Setback from neighbour edges', required: `≥ ${fmt(reqSide)} m`, actual: Number.isFinite(minSide) ? `${fmt(minSide, 2)} m` : 'no neighbour edges', pass: !floors.length || minSide >= reqSide - tol, ref: isHigh ? 'MR 33 cl. 4' : 'BMA ord. 54' });
  add({ id: 'plane', label: 'Height ≤ 2 × distance to far side of road', required: 'Every point under the 2:1 plane', actual: Number.isFinite(worst) ? (worst >= -tol ? `${fmt(worst)} m clearance at tightest point` : `${fmt(-worst)} m over`) : inp.roadEdges.length ? '–' : 'No road edge marked', pass: inp.roadEdges.length > 0 && (worst >= -tol || !floors.length), ref: 'BMA ord. 49' });
  if (isHigh) {
    add({ id: 'front', label: 'High-rise needs 12 m frontage on a public road', required: `≥ 12 m on a road ≥ ${needRoad} m wide`, actual: `${fmt(frontage)} m on a ${fmt(inp.roadWidth)} m road`, pass: frontage >= 12 && inp.roadWidth >= needRoad, ref: 'MR 33 cl. 2' });
  }
  add({ id: 'plate', label: 'Usable floor plate (practical, not legal)', required: `≥ ${fmt(minPlate, 0)} m² for ${isHigh ? 'a tower core + units' : 'a stair core + units'}`, actual: floors.length ? `${fmt(plate, 0)} m² largest floor` : 'No buildable floor fits', pass: floors.length > 0 && plate >= minPlate, ref: 'Design assumption', note: 'Our assumption, not a regulation.' });
  const units = inp.type === 'condo' ? `~${fmt((gfa * 0.75) / 35, 0)} units at 35 m² (75% efficiency)` : inp.type === 'hotel' ? `~${fmt(gfa / HOTEL_M2_PER_KEY, 0)} keys` : `${fmt(gfa * 0.8, 0)} m² net lettable (80%)`;
  return {
    id: spec.id, name: spec.name, summary: spec.summary, regime: spec.regime,
    floors, gfa, footprint, height, far: gfa / A, openSpace, planted, checks,
    pass: floors.length > 0 && checks.every((c) => c.pass), units,
  };
}

export function designs(inp: Input): Design[] {
  const specs: Spec[] = [
    { id: 'A', name: 'Mid-rise block', summary: 'Widest legal plate, kept just under 23 m and 10,000 m² to stay out of high-rise rules.', regime: 'low', plateShare: 1 },
    { id: 'B', name: 'Tower', summary: 'High-rise on the largest plate the 6 m setbacks and open-space rules allow, stacked to the FAR limit.', regime: 'high', plateShare: 1 },
    { id: 'C', name: 'Slender tower + garden', summary: 'A 60% plate: taller, more garden and light. Reaches full FAR only where the height plane leaves room.', regime: 'high', plateShare: 0.6 },
  ];
  const out = specs.map((s) => build(inp, s));
  if (out.filter((d) => d.pass).length < 2) {
    out.push(build(inp, { id: 'D', name: 'Low-rise courtyard', summary: 'A smaller mid-rise plate that leaves a garden court: a fallback when towers are not allowed here.', regime: 'low', plateShare: 0.65 }));
  }
  return out;
}

export interface Rule { id: string; label: string; value: string; ref: string; binding?: boolean; }

export function applicableRules(inp: Input): Rule[] {
  const { A, farEff, openRatio } = limits(inp);
  const rs = roadSetback(inp.roadWidth);
  const t = TYPES[inp.type];
  return [
    { id: 'far', label: 'Max floor area (FAR)', value: `${fmt(farEff, 2)} × ${fmt(A, 0)} m² = ${fmt(farEff * A, 0)} m²`, ref: 'Plan 2556 cl. 17(1)' },
    { id: 'osr', label: 'Min open space (OSR)', value: `4% of total floor area (${fmt(0.04 * farEff * A, 0)} m² at full FAR)`, ref: 'Plan 2556 cl. 17(2)' },
    { id: 'open', label: `Min open space, ${t.residential ? 'residential' : 'non-residential'}`, value: `${openRatio * 100}% of plot = ${fmt(openRatio * A, 0)} m²`, ref: `BMA ord. 52(${t.residential ? 1 : 2})` },
    { id: 'road', label: `Road setback (${fmt(inp.roadWidth)} m road)`, value: `${fmt(rs.d, 2)} m from plot edge`, ref: 'BMA ord. 50' },
    { id: 'side', label: 'Neighbour setback, below high-rise', value: '3 m (windows above 9 m)', ref: 'BMA ord. 54' },
    { id: 'hr', label: 'High-rise (≥ 23 m or ≥ 10,000 m²)', value: '6 m from every edge; 12 m frontage on ≥ 10 m road', ref: 'MR 33 cl. 2, 4' },
    { id: 'plane', label: 'Height limit', value: `≤ 2 × distance to far road edge (${fmt(2 * inp.roadWidth)} m at the road edge, +2 m per metre back)`, ref: 'BMA ord. 49' },
    { id: 'use', label: 'Use', value: t.note, ref: 'Plan 2556 cl. 17' },
  ];
}
