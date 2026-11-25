# Plan

Goal: a browser tool for one Bangkok zone (ย.10 / Y.10, high-density residential). Draw any plot on the map, mark the road it faces, pick a building type, and see in 3D among the real neighbouring buildings:
1. which rules apply (with Thai source and clause),
2. the space a building may fill,
3. at least two concept designs, each with a pass/fail checklist computed from its actual geometry.

## Stack
- Vite + TypeScript, no framework (small UI, fast load).
- MapLibre GL JS + OpenFreeMap vector tiles (free, no key): real roads and OSM buildings extruded by height.
- terra-draw for drawing and editing the plot polygon on the map.
- clipper2-js for robust polygon offset and boolean operations, in a local metric frame (equirectangular around the plot centroid, error < 0.1% at plot scale).
- Everything is client-side: static deploy on Vercel.

## Geometry engine (pure module, unit-tested)
- Plot polygon (lng/lat) → local metres.
- Road frontage = the plot edges the user marks as facing the road, with the road width.
- Per-edge setbacks: allowed footprint = plot − ∪ buffer(edge_i, d_i). This handles concave and irregular plots, unlike a uniform inset.
- Two regimes:
  - Low-rise (< 23 m and < 10,000 m²): road setback (BMA ord. 50), 3 m from neighbour edges for openings above 9 m (ord. 54).
  - High-rise (≥ 23 m or ≥ 10,000 m²): 6 m from every edge (MR 33, clause 4), frontage checks (MR 33, clause 2).
- Height plane: max height at point p = 2 × (distance from p to the road frontage line + road width) (BMA ord. 49), capped at zone and model limits. The envelope is shown as stacked floor-height slices, clipped by that plane.
- Area rules: FAR ≤ 8; open space ≥ max(30% of plot for residential or 10% otherwise, 4% of floor area); ≥ 50% of open space permeable.

## Designs
- For each regime, find the tallest and fattest massing that fits: choose a footprint inset and floor count so that floor area ≤ FAR, coverage ≤ the open-space limit, and every floor sits under the height plane (terraced back from the road).
- At least two designs: A, a low-rise block (≤ 7 floors, < 23 m); B, a high-rise tower (6 m setbacks). If a regime is illegal, for example a road under 10 m for a high-rise, the design shows FAIL with the reason, and a smaller alternative passes.
- Checklist per design: FAR, open space (plot and OSR), permeable area, road setback, side setbacks, height plane, frontage, use permission, plus totals that add up (floor-by-floor table).

## Building types
Condo (residential, 30% open space), office (non-residential, 10%; over 10,000 m² needs a road ≥ 12 m or a station within 500 m), hotel (non-residential, 10%; over 80 rooms needs a road ≥ 12 m or a station within 500 m). Stations are baked from OSM.

## Order
1. Research and rules.json with citations (done).
2. Engine and tests.
3. Map, drawing, zone check, 3D envelope.
4. Designs and checklist panel.
5. Deploy to Vercel, check the public URL.
6. Polish: client-ready look, performance, edge cases (tiny, self-intersecting or out-of-zone plots).

## Build-time estimate (stated before the build)
Single inline builder, pure-frontend repo.
- 4 workstreams × (build, review, fix) + deploy + e2e QA = 14 sequential stages.
- At the default 6.5 min/stage, that is about 91 min of workflow time, or about 109 min including overhead.
- Realistic wall-clock is higher, because one agent writes everything sequentially and research is excluded. My working estimate is about 6 hours to a polished deploy.
- Start: 2026-11-25 23:45 IST. Deadline: 2026-11-27 03:29 IST.
