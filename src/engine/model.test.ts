import { describe, expect, it } from 'vitest';
import { area, type Pt } from './poly';
import { baseFootprint, designs, envelope, roadSetback, type Input } from './model';

const rect = (w: number, d: number): Pt[] => [[0, 0], [w, 0], [w, d], [0, d]];
// Arc cuts are grown 4 cm to stay conservative, so exact rectangles come out
// a hair small: allow 1%, never larger than the hand answer.
const near = (got: number, want: number) => {
  expect(got).toBeLessThanOrEqual(want + 0.01);
  expect(got).toBeGreaterThan(want * 0.99);
};
const base = (plot: Pt[], over: Partial<Input> = {}): Input => ({
  plot, roadEdges: [0], roadWidth: 12, type: 'condo', farBonus: 0, nearStation: false, inZoneShare: 1, ...over,
});

describe('road setback (BMA ord. 50)', () => {
  it('follows the three road-width bands', () => {
    expect(roadSetback(6).d).toBe(3); // 6 m from centreline of a 6 m road
    expect(roadSetback(8).d).toBe(2);
    expect(roadSetback(12).d).toBeCloseTo(1.2);
    expect(roadSetback(20).d).toBe(2);
    expect(roadSetback(30).d).toBe(2);
  });
});

describe('40 x 50 m plot on a 12 m road', () => {
  const inp = base(rect(40, 50));
  it('low-rise footprint = (40-3-3) x (50-1.2-3)', () => {
    near(area(baseFootprint(inp, 'low')), 34 * 45.8);
  });
  it('high-rise footprint = (40-12) x (50-12)', () => {
    near(area(baseFootprint(inp, 'high')), 28 * 38);
  });
  it('mid-rise design: 70% coverage, 6 floors under 23 m, all checks pass', () => {
    const [a] = designs(inp);
    expect(a.footprint).toBeCloseTo(1400, -1);
    expect(a.floors.length).toBe(6);
    expect(a.height).toBeLessThan(23);
    expect(a.gfa).toBeCloseTo(a.floors.reduce((s, f) => s + f.area, 0), 6);
    expect(a.checks.filter((c) => !c.pass)).toEqual([]);
  });
  it('tower reaches close to FAR 8 without breaking any rule', () => {
    const b = designs(inp)[1];
    expect(b.far).toBeLessThanOrEqual(8);
    expect(b.far).toBeGreaterThan(7);
    expect(b.checks.filter((c) => !c.pass)).toEqual([]);
    // terraces: upper floors get smaller once the 2:1 plane bites (z > 36 m)
    expect(b.floors[b.floors.length - 1].area).toBeLessThan(b.floors[1].area);
  });
  it('envelope slices shrink under the height plane', () => {
    const env = envelope(inp, 'high');
    near(env[0].area, 28 * 38);
    expect(env[env.length - 1].area).toBeLessThan(env[0].area);
  });
});

describe('narrow 6 m road', () => {
  const inp = base(rect(40, 50), { roadWidth: 6 });
  it('towers fail on frontage, and at least two designs still pass', () => {
    const ds = designs(inp);
    expect(ds[1].pass).toBe(false);
    expect(ds[1].checks.find((c) => c.id === 'front')?.pass).toBe(false);
    expect(ds.filter((d) => d.pass).length).toBeGreaterThanOrEqual(2);
  });
});

describe('L-shaped plot', () => {
  const L: Pt[] = [[0, 0], [60, 0], [60, 25], [25, 25], [25, 55], [0, 55]];
  it('respects the reflex corner: footprint stays 3 m from every edge', () => {
    const inp = base(L);
    const [a] = designs(inp);
    const side = a.checks.find((c) => c.id === 'side')!;
    expect(side.pass).toBe(true);
    expect(a.pass).toBe(true);
  });
});

describe('degenerate plots', () => {
  it('a 5 m sliver has no buildable footprint and says so', () => {
    const inp = base(rect(5, 80));
    for (const d of designs(inp)) {
      expect(d.pass).toBe(false);
      expect(d.floors.length).toBe(0);
    }
  });
  it('self-intersecting bow-tie does not throw', () => {
    const inp = base([[0, 0], [40, 40], [40, 0], [0, 40]]);
    expect(() => designs(inp)).not.toThrow();
  });
  it('no road edge marked: height check fails', () => {
    const inp = base(rect(40, 50), { roadEdges: [] });
    expect(designs(inp)[0].checks.find((c) => c.id === 'plane')?.pass).toBe(false);
  });
  it('outside the zone fails the zone check', () => {
    expect(designs(base(rect(40, 50), { inZoneShare: 0.5 }))[0].pass).toBe(false);
  });
});

describe('building type changes the rules', () => {
  it('office over 10,000 m2 on an 8 m road far from a station fails use', () => {
    const inp = base(rect(60, 70), { type: 'office', roadWidth: 8 });
    const b = designs(inp)[1];
    expect(b.checks.find((c) => c.id === 'use')?.pass).toBe(false);
  });
  it('office gets 10% open space, so a bigger plate than condo', () => {
    const c = designs(base(rect(40, 50)))[0];
    const o = designs(base(rect(40, 50), { type: 'office' }))[0];
    expect(o.footprint).toBeGreaterThan(c.footprint);
  });
});
