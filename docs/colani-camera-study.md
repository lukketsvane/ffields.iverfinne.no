# Colani camera reference study

The `Colani camera` project template builds an upright camera form from the
user's supplied photograph. It is an editable field construction, not an
imported mesh. Open **File → Project templates → Colani camera → Start**.

## Construction and scale

`lib/camera-pod-study.ts` creates 19 individually named shapes: the lower body,
upper grip mass, leaning crown, continuous lamp shoulder, convex back, flat
sole, three unequal swept grip valleys, curved lamp perimeter and panel seat,
lamp heel, low circular lens plate and seam, vertical lens socket and small
aperture, connected timer stem and button, and indicator recess. The hidden
default base and its camera features are disabled. Swept paths remain editable
and each fresh template has its own deep copy.

The photo does not establish physical dimensions. Nominal model dimensions
are approximately **81.3 × 123.3 × 41.2 mm**; they describe this study, not a
measured original or a verified fit for the user's camera module. This is a
solid exterior form study. The current viewport has one material, so the cream
shell, dark optical insert and amber lamp in the reference are represented by
geometry rather than separate material assignments. Branding is omitted.

## Verification on 2026-10-05

- `node --test scripts/project-templates.test.mjs`: **5/5 pass**, including
  deep-copy editing of a swept valley, valid finite geometry for all nine
  templates, actual STL output and a connected camera mesh with a level sole.
- `pnpm build`: pass, including TypeScript and production build.
- ESLint for the two template modules: pass without warnings.
- The registered creator is deeply equal to the frozen model used for the
  audited export and thumbnail.
- Public app UI: selected the upper swept valley, increased its span from
  74.5 to 75 mm and used Undo to restore 74.5 mm and the original form. All
  19 objects appeared with their separate merge/cut/intersect operations.

Full export at resolution 220, with two refinement passes:

| Measurement | Result |
| --- | ---: |
| Dimensions | 81.2963 × 123.2878 × 41.2498 mm |
| Triangles / vertices | 262,032 / 131,018 |
| Connected components | 1 |
| Boundary / nonmanifold edges | 0 / 0 |
| Inconsistent winding edges | 0 |
| Degenerate triangles / invalid indices | 0 / 0 |
| Finite coordinates | yes |
| Enclosed solid volume | 245,770.5 mm³ |

Topology passes. Refinement reports `qualityLimited: true` and
`budgetLimited: false`: maximum face residual is approximately 0.328 mm and
maximum edge-midpoint residual 0.370 mm. Do not claim every face meets the
0.12 mm refinement target. The lamp-seat and plate-seam rims retain local
faceting, especially in the coarse interactive preview. These checks establish
mesh topology, not manufacturing suitability, structural performance or fit.

## Next modelling loop

1. Refine curved seam and swept-seat meshing locally; keep the low-latency
   interactive preview while resolving visible rim faceting.
2. Add per-part material assignments for shell, lens insert, timer and lamp.
3. With measured module dimensions, design the internal shell, supports,
   cable exit, assembly split and tolerances as a separate fit-checked design.
4. Verify phone touch editing on a physical device. This release was exercised
   in the cloud browser's software viewport, not on physical iPhone hardware.
