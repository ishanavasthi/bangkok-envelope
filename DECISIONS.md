# Decisions and research log

These are working notes for Ishan's write-up. Each entry records a call that was made, why, and the source it rests on.

## Where an earlier assumption was corrected by a primary source

1. **Which plan is in force.** I first assumed the 2013 plan, from memory. Then I found news of a "Bangkok City Plan 2026", which is the 4th revision. Checked: it is a draft that finished its 90-day review on 9 Nov 2026 and is expected around 2027. The 2013 plan (B.E. 2556) is still the law (TCC, Feb 2026). This matters because the draft raises FAR by about 0.5 per zone. Using it would overstate what can be built.
2. **The 30% open space for condos.** The rule is commonly quoted as "30% of the plot". MR 55 clause 33 actually says 30% of the *largest floor plate*. Bangkok has its own ordinance (BMA 2544, clause 52(1)), which says 30% of the *land*. MR 33 clause 6(1) also says 30% of the plot for residential high-rises. We use the Bangkok ordinance, which is the local rule and the stricter one for towers.
3. **Which building code applies in Bangkok.** The national MR 55 setbacks and height rule are duplicated in Bangkok's own ordinance, with differences. The ordinance exempts small residential buildings (≤ 3 floors, ≤ 10 m, ≤ 1,000 m²) from the road setback (clause 50), and it allows height to be measured from a road ≥ 80 m wide within 100 m (clause 49). We cite the BMA ordinance as primary and MR 55 as the parallel source.
4. **Height is not a flat cap.** Y.10 has no height limit in the zone layer (LUP_MAX_HEIGHT is null). The binding height rule is the 2:1 sloped plane from the far side of the road (ord. 49). So the allowed space is a sloped or terraced volume, not "inset then cap".
5. **The high-rise threshold creates two regimes.** At 23 m or 10,000 m², the whole building must be 6 m from every boundary (MR 33, clause 4) and needs 12 m frontage on a road ≥ 10 m wide (MR 33, clause 2). There is a discontinuity: on a narrow road, the best legal design may be a mid-rise just under 23 m.
6. **Data anomalies in the official GIS layer.** One พ.3 polygon carries FAR 8 / OSR 4 and one ย.9 carries FAR 6 / OSR 5, which don't match the law text for those zones. All 13 Y.10 sub-areas match the law (FAR 8, OSR 4). We take rule values from the gazette text, not the GIS attributes.

## Scope calls

- **Zone: ย.10 (Y.10).** It is the condo zone, covering 13 sub-areas, about 13 km² of the inner city: Sukhumvit/Asok/Phrom Phong, Sathorn, Phaya Thai and Ari. It has dense OSM coverage, and condo use is unrestricted there. The plan's FAR ceiling here (8) is below MR 33's absolute 10:1, so the zone rule binds.
- **Zone boundaries** come from the BMA City Planning GIS (official), downloaded once and bundled. The plot is checked against them. A plot outside Y.10 is flagged, not silently computed.
- **Floor area counts all floors, including parking.** The plan defines FAR as "all floors of all buildings" and only exempts extra public parking under the station bonus (clause 54). Basements are not modelled; above-ground podium parking is common in Bangkok because of the high water table.
- **FAR bonus (clauses 51-57, up to +20%)** is shown as an optional toggle, not the default. It needs affordable units, public open space, retention tanks or green certification, so the developer has to opt in.
- **Hotel room count** is estimated from floor area (about 45 m² gross per key) to test the 80-room trigger.
- **Station distance** is measured from OSM station nodes. The law measures from the platform edge (plan clause 37), so we're within tens of metres. This is flagged in the UI.
- **Neighbour heights:** only about 9% of buildings near Asok have height data, in both OSM and Overture (checked 4,002 OSM and 6,400 Overture buildings). Tall towers are mostly tagged; untagged buildings render at a low default. This is a known limitation.

## Not modelled (and why)
- Airport height zones, Rattanakosin/heritage height controls, and the specific BMA bans on high-rises in some sois: these are separate regulations that don't cover the Y.10 core, and listing them as warnings is honest. Parking ratios, EIA (needed for condos of 80+ units or 4,000 m²+), fire-lane geometry beyond the 6 m clearance, corner plots on two roads of unequal width (ord. 49 paragraph 2, MR 55 clauses 45-46).
