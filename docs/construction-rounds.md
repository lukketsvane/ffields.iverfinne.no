# Construction rounds: interfaces, spatial profiles and export detail

These three rounds extend the reusable modelling tools and exercise them on the same Truss bracket study. The study still starts from a blank document and builds 27 editable shapes through [public construction commands](../lib/construction.ts); it is not an imported surface or a new template gallery. Its dimensions are study proportions. No load, strength, impact, thermal or manufacturing validation is performed.

The [first construction findings](truss-study-findings.md) record the earlier mesh and browser trials. This journal records the changes and evidence from the next three rounds; earlier timing and mesh counts should not be treated as measurements of this revised geometry.

## Round 1: persistent endpoint attachments

Manual endpoint placement made the original construction fragile: moving a mounting interface could leave its rails behind. A sweep endpoint can now reference another shape's local origin or a local bounding-face anchor, plus a target-local XYZ offset. The reference follows the target's translation, rotation and relevant size changes.

The docked endpoint editor shows both endpoint relationships, an inline target list, seven anchor choices and exact offsets. Choosing a target or anchor captures the offset and preserves the existing endpoint position. **Align to anchor** explicitly resets the offset and moves the endpoint. **Detach** freezes its current position. Directly dragging or numerically moving an endpoint in the sketch detaches that endpoint; radius, interior-point and section edits retain its link. Untouched numeric fields and Escape do not round and move precise endpoints.

The [study recipe](../lib/truss-study.ts) adds these ten links, with captured offsets rather than snapping every rail onto a flange centre:

| Sweep | Start target | End target |
| --- | --- | --- |
| Main curved spine (`upper-front`) | Upright flange (`a-flange`) | Round mounting flange (`c-flange`) |
| Rear upper rail (`upper-rear`) | Upright flange | Round mounting flange |
| Front perimeter (`lower-front`) | Front flange (`b-flange`) | Round mounting flange |
| Rear perimeter (`lower-rear`) | Upright flange | Round mounting flange |
| Socket bridge (`left-bridge`) | Upright flange | Front flange |

The command workflow exercised capturing a position, moving and rotating its target, resolving chained sweep references, changing one endpoint, detaching, deleting a target and mirroring a linked sweep. References resolve in dependency order. Circular dependencies are rejected atomically, hidden targets retain their links, and a mirrored copy is independently editable rather than inheriting the source's relationships.

[Attachment tests](../scripts/attachments.test.mjs) cover those behaviours, JSON import of stale endpoint coordinates, legacy documents without attachment metadata, and agreement between the resolved field and generated mesh. The mesh fixture's vertex field residual is below `2e-5`, with every mesh edge having two neighbouring faces. This verifies the resolved geometry path; it is not an object-wide approximation tolerance.

## Round 2: transported elliptical profiles and direction-based orientation

Flattening every sweep along local Z could not describe the section orientation of a spatial rib. **Fixed** preserves that existing field. **Follow curve** carries an elliptical section with a minimal-rotation transported frame along the sampled path; **Section roll** rotates the section about the curve. Circular transported sweeps use the existing circular evaluator. Mirroring a transported sweep reflects its section roll as well as its geometry.

Only two of the study's ten paths switch to transported sections: **Main curved spine** (`upper-front`, section depth 55%) and **Socket bridge** (`left-bridge`, 75%), both with zero section roll. The other paths retain fixed sections. The centreline coordinates remain editable.

The XY/XZ/YZ editor projects each transported ellipsoid cap into an oriented ellipse, including its tangent extent. **Fit sketch** uses the projected extents. The selected control point displays its corresponding section frame; fixed-mode previews retain their previous appearance. The preview's connecting envelope is a drawing aid, not the export triangulation.

**Orient by direction** aims a chosen local X, Y or Z axis along a world vector. Vector length does not affect size. The minimal rotation retains the existing bank instead of asking the user to solve three Euler angles; aiming along the unchanged direction returns the original angles.

Evidence includes six [spatial sweep/orientation tests](../scripts/spatial-sweep.test.mjs), the 24 legacy sweep/shape tests, and four [projection tests](../scripts/sweep-projection.test.mjs). They cover legacy-field agreement, circular compatibility, authored caps and roll, orthonormal transported frames, distance bounds and compiled-field pruning, rigid transforms and mirrors, all local-axis aiming, projected ellipsoid containment and sketch fitting in all three planes.

## Round 3: rigid group movement and audited export

Moving a socket alone does not move its flange, bore and fixing cuts. **Move together** provides an inline membership list and draft world translation, rotation and pivot. **Apply** records one validated construction action: rotate about the world pivot, then translate. Include the socket, flange and relevant cuts to retain their alignment. Attached rails follow the moved interfaces. Moving an entire linked construction retains its local sweep paths and ten relationships.

The [group-transform checks](../scripts/group-transform.test.mjs) exercise a seven-part upright assembly translated 6 mm along X and rotated 12° about world Z around its flange origin. They compare transformed points, confirm the attached spine follows, and check that the moved bore stays empty. A second case transforms all study shapes together; invalid membership, vectors and final bounds fail atomically.

The export workflow separates **Standard**, the default sampled mesh, from optional **Refined** surface detail. Both production worker jobs use base resolution 220. The UI's current Refined settings are `tolerance: 0.12`, two passes and a 900,000-triangle ceiling, with the other refiner defaults. **Check export mesh** reports dimensions, triangle count, connected pieces, open edges, nonmanifold edges, winding conflicts, collapsed triangles, finite/index validity, volume and generation time. The worker audits the generated mesh used for STL; refinement and audit do not create a separate model. Editing clears the previous check result.

Refinement splits shared edges conformingly and projects new vertices toward the implicit surface within a bounded displacement. Difficult patches are frozen rather than accepting folds, new degeneracies or poorer sampled residuals. Seven [refinement tests](../scripts/mesh-refinement.test.mjs) cover spheres, budget-limited splits, tilted flanges and bores, unreachable projections, invalid/nonfinite input and the actual spatial truss. Two [audit tests](../scripts/mesh-audit.test.mjs) distinguish closed, disconnected, open, reversed, duplicated and invalid triangle data.

### Measured truss probe

The revised, attached spatial study was generated at base resolution **96** and refined with `tolerance: 0.04`, one pass, a 250,000-triangle ceiling and a 1.5 mm maximum projection displacement. This development probe is separate from a full-resolution production export.

| Sample statistic | Before | After | Change |
| --- | ---: | ---: | ---: |
| Triangles | 64,920 | 160,210 | Additional local detail |
| Mean edge-midpoint field residual | 0.045865216 | 0.019595181 | 57.277% lower |
| Mean face-centroid field residual | 0.058455372 | 0.024663101 | 57.809% lower |
| Maximum edge-midpoint field residual | 1.965823044 | 1.965823044 | Unchanged |
| Maximum face-centroid field residual | 1.451988505 | 1.451988505 | Unchanged |

The probe marked 47,645 edges and projected 41,053 new vertices. Total generation plus refinement took 19.2 seconds in the development environment. Its regression, including topology and bore-ray checks, took approximately 20.7 seconds. Neither is a phone performance measurement.

Input and output had zero degenerate triangles, boundary edges, nonmanifold edges and winding conflicts; the Euler characteristic was unchanged. Ray segments through all three authored bore axes remained unobstructed. Original surface vertices stayed fixed. These are sampled geometry and connectivity checks, not proof against self-intersection or a manufacturing certificate.

`qualityLimited` remains **true**. The mean improvements are field-sample statistics, not a global geometric error bound in millimetres. The requested `0.04` is not achieved across the whole object: the worst sharp-feature patches remain frozen. A refiner cannot recover a hole or disconnected feature that the original sampling grid never detected. Standard remains the default, and Refined stays opt-in.

### Full production-resolution result

A subsequent run used the revised study at resolution **220** and the production Refined settings: `tolerance: 0.12`, two passes and a 900,000-triangle ceiling. Refinement added 15.765 seconds after the Standard mesh had been generated; this is not the total export time or a phone timing.

| Sample statistic | Standard | Refined |
| --- | ---: | ---: |
| Triangles | 349,720 | 372,168 |
| Mean edge-midpoint field residual | 0.008442 | 0.007726 |
| Mean face-centroid field residual | 0.010851 | 0.009750 |
| Maximum edge-midpoint field residual | 0.6863 | 0.5883 |
| Maximum face-centroid field residual | 0.5883 | 0.4530 |

The result had one connected component, with zero boundary edges, nonmanifold edges, winding conflicts and degenerate triangles. Both mean and maximum sampled residuals improved at this resolution. `budgetLimited` was false, while `qualityLimited` remained true: the requested `0.12` was still not achieved object-wide. The figures remain field-unit sampling statistics. Fresh renders were generated for visual inspection; their existence alone is not dimensional or manufacturing validation.

## Verification scope and camera-case next step

The construction workflows above were exercised through the shared command API and CPU geometry tests. The complete Node regression run passed all 98 tests in approximately 23 seconds; full TypeScript checks, scoped component lint and the production build also passed. The earlier browser workflow verified construction, sketches, undo and persistence with WebGL disabled in the test environment; new numerical geometry evidence does not establish sustained native-phone GPU performance or end-to-end visual validation of every new control. The browser trial for these new controls was still pending when this entry was written.

The three requested construction rounds are complete. The next design task is a camera case around specific component dimensions; another tooling round is not a prerequisite. Remaining checks and limits should guide that design:

1. Define camera-specific interfaces, component clearances, wall and opening requirements from real component dimensions. Triangle connectivity and attractive bracket geometry do not establish those enclosure requirements.
2. Inspect the revised bracket and ensuing case from opposing views and sections, including thin branches, small holes and flange transitions. The numerical export checks do not settle every visible feature or fit dimension.
3. Where needed, improve initial sampling near sharp corners and small holes. Measure worst-case residual and preservation of detected features rather than using triangle count or mean residual alone as acceptance criteria.
4. Exercise attachments, signed numeric inputs, profile roll, group movement, undo and audit cancellation on a native phone; measure live mesh response, export duration and memory there. Native-phone performance remains unmeasured.

Endpoint references are modelling relationships, not contact constraints: a centre anchor is the target's local origin, and face anchors are bounding-face centres. Sweeps still use 2–12 control points and planar sketches; section frames and export meshes are sampled approximations. More direct spatial editing, feature-aware sampling and explicit dimensional checks remain useful work for that next round.
