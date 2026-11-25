# Handoff for Ishan

**Deadline: Fri 27 Nov 2026, 03:29 IST** (2026-11-26 21:59 UTC). Submissions close at the deadline. Check the time left any time by asking the agent (it calls `time_left` with the key from `~/.secrets/general-machines.env`).

## Done (overnight, unattended)
- **Live tool:** https://bangkok-envelope-sigma.vercel.app (public, no sign-in. Note: `bangkok-envelope.vercel.app` is someone else's project.)
- **Repo:** https://github.com/ishanavasthi/bangkok-envelope (currently **private**)
- Research from Thai primary sources, with every rule cited: `src/rules/rules.json`, `research/`.
- `DECISIONS.md`: every judgment call, and every place a primary source corrected an assumption. This is your raw material for the one-pager and the "what did the AI miss" note.
- 20 engine unit tests. Browser-tested: drawing, corner drag, corner insert, slider drag, type switch, what-if toggles, phone layout.

## Only you can do these (the brief requires them to be yours)
1. **Make the repo public** (`gh repo edit ishanavasthi/bangkok-envelope --visibility public --accept-visibility-change-consequences`). The submit server rejects private links.
2. **Write the one-pager** under the brief's 4 headings: what you understood; what you did and why; technical decisions; what's still wrong. The brief says the write-up must be yours. Use DECISIONS.md and the list below.
3. **Transcripts (part 4).** The first session is the T3 thread where the assignment was started. ⚠️ It contains the **access key** (in tool output and the personal PDF link) and the full contents of your CLAUDE.md files (tailnet IP, the staging VM IP, prod-access notes). The brief asks for raw, unedited transcripts. Decide whether to redact those specific secrets and say so in your note, or rotate what you can. Either way, don't publish it as-is.
4. **The "what did the AI miss" note.** Candidates, all real from this run:
   - It first assumed the 2013 plan from memory, then found "Bangkok City Plan 2026" news. The 2026 plan is only a draft in public review; 2013 is still law.
   - The widely quoted "30% open space" rule is against the largest floor in MR 55 but against the land in Bangkok's own ordinance.
   - Bangkok's own building ordinance, not national MR 55, is the primary source for setbacks and height.
   - Height is a sloped 2:1 plane, not a flat cap.
   - clipper2-js returned wrong insets for a plain rectangle; a unit test caught it.
   - Map tile building ids aren't unique; hiding one emptied a whole block.
   - The agent misread a CLAUDE.md note and asked whether hello@ was retired (it was the Claude login, not the mailbox).
   - **About 20 hours of the 48 elapsed between starting the clock (25 Nov 03:29) and the work beginning (25 Nov 23:28)**, because the session sat idle. Worth owning in the note.
5. **Setup answers (part 5), best project (part 6), about you (part 7):** résumé link, LinkedIn, GitHub, portfolio, phone, current city, Bangalore/hybrid answer.
6. **Submit:** give the agent your details and links, and it can call `submit_application`. You can resubmit until the deadline; the latest one counts.

## Known limitations (for "what's still wrong")
- Only about 1 in 10 nearby buildings has a mapped height (OSM and Overture both checked), so untagged neighbours render low.
- Station distance is measured from the OSM station point, not the platform edge the law uses.
- Road width is user input with a guess from the road class; Bangkok has no open right-of-way dataset.
- Corner plots on two roads of unequal width (ord. 49 paragraph 2, MR 55 clauses 45–46), airport and heritage height zones, parking, and EIA are not modelled.
- Designs are simple extrusions (plate shrunk uniformly, terraced by the height plane), not architecture.
- FAR counts every above-ground floor; basements are not modelled.
