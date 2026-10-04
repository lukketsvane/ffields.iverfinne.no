# Three-interface organic bracket: construction review

This is a visual reconstruction study of the selected reference, not an engineering validation. The photograph cannot establish hidden topology, manufacturing dimensions, loads, stiffness, or strength. Dimensions below are deliberate study proportions in millimetres.

## Geometric reading

The object joins three unlike interfaces with an asymmetric, three-dimensional open framework: an upright rectangular socket at the low left, a wider rectangular socket leaning out toward the viewer, and a circular socket elevated at the right. These interfaces must define the structure before individual ribs are added.

Use x for the long left-to-right span, y for height, and positive z toward the front. A suitable envelope is approximately 235 × 170 × 120. Suggested flange centres and outward sleeve axes:

| Interface | Centre (x, y, z) | Outward axis | Study proportions |
|---|---|---|---|
| A: upright left socket | (−92, −22, −32) | (−0.98, 0.05, −0.18) | flange 42 × 57 × 5; sleeve 33 × 46 × 25; bore 26 × 38 |
| B: wide front socket | (−68, −62, 45) | (−0.35, −0.46, 0.815) | flange 66 × 38 × 5; sleeve 58 × 30 × 22; bore 49 × 22 |
| C: elevated round socket | (90, 68, 0) | (0.64, 0.74, −0.20) | flange diameter 56 × 5; sleeve OD 44, ID 32, length 30 |

For the current primitive conventions, rectangular sleeves have their axis along local z and cylinders along local y. Approximate XYZ rotations: A (0, −90, 0); B (29.4, −20.5, 0); C (−15.1, 0, −39.8). The simplified A rotation omits the small directional lean.

## Sweep structure

Build four longitudinal paths with different elevation and depth. Join these with a small number of tapered diagonal branches. Do not create a flat triangular lattice and thicken it. The photograph's apparent webs gain character from changing section, arch curvature, depth separation, and merged branch roots.

The upper front spine is the broadest diagonal and carries the main Y-shaped junction. The rear upper rail is noticeably thinner. The lower front perimeter bows down and then climbs sharply into the circular flange. The lower rear perimeter is narrower and shallower. A curved bridge between A and B establishes the left-side depth and triangular footprint.

Suggested `(x, y, z, radius)` sweep control points:

```text
upper_front: (-86,0,-17,9), (-47,8,-8,7), (-8,19,5,7),
             (33,31,15,10), (65,55,20,8), (89,70,22,7)
upper_rear:  (-86,2,-47,5.6), (-47,7,-37,4.2), (-10,10,-28,4),
             (30,29,-22,4.8), (60,55,-20,5.5), (89,68,-20,7)
lower_front: (-73,-61,47,8), (-33,-60,43,6.5), (8,-46,42,6),
             (40,-17,36,7), (64,15,29,8), (89,58,22,7)
lower_rear:  (-88,-45,-34,6), (-48,-48,-30,4.7), (-5,-38,-22,5),
             (35,-15,-14,6), (65,21,-11,6.5), (88,59,-13,7)
left_bridge:(-89,-40,-35,7), (-95,-57,-6,6), (-87,-69,22,6),
             (-72,-68,43,8)
front_rib_1:(-33,-60,43,6), (-27,-34,25,4.8), (-20,-10,11,4.7), (-8,19,5,6)
front_rib_2:(8,-46,42,5.8), (15,-15,28,4.7), (25,13,19,5), (33,31,15,7)
front_rib_3:(40,-17,36,6), (49,17,27,5), (58,42,22,5.6), (65,55,20,7)
```

These paths are a starting construction, not an achieved match. Adjust endpoint penetration so rails actually merge into flange backs. The circular flange needs separated front and rear roots, not all rails terminating at its centre. Bore cutters should run fully through the relevant sleeves and flange thickness.

Use a small blend (approximately 2–4 mm) for secondary rails and 5–7 mm at major roots. Excessive global blending rounds the whole framework into swollen tubes and erases the triangular windows. The reference reads as lean tapering branches with broad roots, not a network of equal-radius pipes.

## Acceptance criteria

- All three distinct interfaces remain readable at the same three-quarter view.
- C is clearly higher than A and B; B projects toward the viewer and is wider than A.
- At least two levels of rails are visibly separated in depth, including in an opposite three-quarter view.
- The main spine is curved, tapers between broad branch roots, and carries the silhouette.
- Openings remain long rounded triangles or irregular trapezoids, with varied spacing and proportions.
- Every intended branch connects continuously; no detached rods or tangent-only contacts.
- Socket bores remain open; no rib crosses the openings or projects through a socket face.
- Flanges retain planar machined faces and restrained edge radii despite the organic framework.
- The output has no visible faceted capsule chain, melted junction, repeated equal-size window pattern, or planar extrusion reading.

## Recording results

Record the actual render settings, observed defects, accepted changes, and remaining mismatch after each inspection. Label each observation as visual evidence or an untested hypothesis. Do not report structural performance, printability, or simulation results without the corresponding checks.
