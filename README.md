# Plot Envelope · Bangkok

**Live:** https://bangkok-envelope-sigma.vercel.app

Draw a plot anywhere in Bangkok's **ย.10 (Y.10)** zone (high-density residential, the condo zone around Sukhumvit, Sathorn, Phaya Thai and Ari). Mark the road it faces and pick a building type. The tool then shows:

1. **The rules that apply**, each linked to the Thai legal source and clause.
2. **The allowed space** in 3D: the footprint after per-edge setbacks, stepped back under the 2:1 road height plane, in two regimes (below 23 m, and high-rise).
3. **Concept designs** (mid-rise block, tower, slender tower, plus a low-rise fallback when towers are illegal). Each has a pass/fail checklist computed from its own geometry, and a floor-by-floor area table that adds up to the total.

Everything recomputes live, with no reload, when you drag a corner, add or remove a corner, click an edge to mark or unmark it as road frontage, change the road width, or switch the building type.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # engine unit tests (vitest)
npm run build
```

## How it works

| Part | File |
|---|---|
| Rules, with citations | `src/rules/rules.json` |
| Rules engine (setbacks, height plane, regimes, designs, checks) | `src/engine/model.ts` |
| Polygon ops (Clipper 6.4.2 on integer mm) | `src/engine/poly.ts` |
| Road-edge bookkeeping through edits | `src/engine/road.ts` |
| Map, drawing, 3D, panel | `src/main.ts` |
| Zone polygons (official BMA GIS), stations (OSM) | `src/data/` |
| Primary sources (Thai PDFs) and extracted text | `research/` |
| Research log and judgment calls | `DECISIONS.md` |

**Allowed footprint.** Plot minus a capsule (every point within *d* of the edge segment) along each edge, where *d* depends on the edge type: road or neighbour, low-rise or high-rise. Unlike a uniform inset, this handles concave and irregular plots and mixed setbacks.

**Height.** BMA ordinance clause 49: height at any point ≤ 2 × the distance to the far side of the road. At height *z* the floor must be at least *z*/2 − *W* from the road edge, so each floor is the footprint minus a capsule of that radius. The result is the terraced top.

**Checks.** Each check is measured on the finished design, not assumed from how it was built: the minimum distance from every floor outline to every edge, every floor vertex against the height plane, and floor areas summed floor by floor.

## Sources
- กฎกระทรวงให้ใช้บังคับผังเมืองรวมกรุงเทพมหานคร พ.ศ. ๒๕๕๖ (Bangkok Comprehensive Plan 2013, in force): Y.10 FAR 8, OSR 4%, uses, FAR bonus.
- ข้อบัญญัติกรุงเทพมหานคร เรื่อง ควบคุมอาคาร พ.ศ. ๒๕๔๔ (Bangkok Building Control Ordinance): setbacks, open space, height plane.
- กฎกระทรวง ฉบับที่ ๓๓ (+ ๕๐): high-rise and extra-large buildings.
- BMA City Planning GIS: zone polygons. OpenStreetMap / OpenFreeMap: buildings, roads, stations.

This is a feasibility sketch, not a permit check. See the in-app "Sources and assumptions" section and `DECISIONS.md` for what is and isn't modelled.
