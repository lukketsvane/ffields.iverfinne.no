# Camera-round sampling findings

The stereo case forced the mesh generator to distinguish dimensional seat detail from ordinary grid density. These changes are reusable; the case is still built from public construction commands.

## Paired planes around sharp faces

`createMeshSamplingGrid` retains the existing ordinary grid and adds paired planes **0.002 mm** to either side of eligible world-axis-aligned, sharp, zero-blend box faces. These are sampling coordinates; the authored shape and its field are unchanged. Exact face-node alignment can put several edge roots on the same Float32 coordinate, so sampling directly on a face is deliberately avoided.

The extra grid is limited to **24 additional planes per axis** and **1.75 times the original number of grid samples**. Subtract interfaces receive priority. Distant through-cut caps outside an unblended mass, and internal caps completely covered by an overlapping final subtract box, do not consume this budget. A later union prevents the latter inference. Global deformations, asymmetry, shelling, lattice cores, rotated boxes and blended or rounded faces keep ordinary sampling.

The analytic test object is a sharp rectangular rim, outer **100 × 50 × 18 mm**, with a **94 × 44 mm** through-cavity. Base resolution 72 produced:

| Measurement | Ordinary grid | Added face planes |
| --- | ---: | ---: |
| Maximum face-centroid residual | 0.39999994 mm | 0.00066821 mm |
| Maximum edge-midpoint residual | 0.59999990 mm | 0.00100040 mm |
| Volume | 15,197.00673 mm³ | 15,551.99885 mm³ |
| Triangles | 44,808 | 61,928 |

The known analytic volume is **15,552 mm³**. Both meshes have one component, zero open/nonmanifold/winding-conflict/degenerate faces, and measured dimensions 100 × 50 × 18 mm. The residuals in this particular test use exact box distance fields. They do not establish an object-wide tolerance for other fields.

## Float32 collapse and bounded retries

An earlier collar prototype, with retention tunnels running through Z, exposed two separate problems. Redundant planes at the overlapping front/rear corridor caps created four collapsed faces at resolution 96. Removing those unnecessary planes gave **70,112 triangles**, one closed component and zero degenerate faces in that earlier geometry. The final study uses rear retention tunnels running across X; that earlier triangle count is not its current result. Enlarging the paired-face offset to 0.01 mm did not solve every parameter variant or the full-resolution object, so the more accurate 0.002 mm offset was retained.

At resolution 220, two faces collapsed even with the ordinary grid. The generator now retries the complete mesh with a deterministic grid phase **[0.173, 0.223, 0.265]**, expressed as fractions of an ordinary interval. Extent endpoints and authored face planes remain fixed. It tries aligned sampling, phased aligned sampling, ordinary sampling, then phased ordinary sampling, stopping as soon as the generated Float32 mesh has no collapsed faces. This is bounded regeneration; no triangle is removed or welded. The area threshold is the same **1e-12 mm² doubled area** used by the independent audit. If every attempt fails, the actual audit still reports the remaining defect.

The final case's Standard resolution-220 mesh has **331,052 triangles**, **165,500 vertices**, volume **46,052.3798 mm³**, one component and zero boundary/nonmanifold/winding-conflict/degenerate faces. Its dimensions are **147.7882 × 74.6476 × 35.1959 mm**. Phased sampling retains eight X and four Y face planes. The automatic path first tries the original grid, so its total generation time includes that discarded attempt; this run took 26.54 seconds in the development environment. An independent triangle/box separating-axis check found zero intersections with both rectangular reference-camera envelopes expanded by **0.45 mm per side**. The production regression checks that separation rather than relying only on the analytic field. The final Refined export was checked separately by the renderer: **332,548 triangles**, **166,248 vertices**, volume **46,052.5215 mm³**, the same measured bounds, zero topology defects and zero reference-envelope intersections. The [camera-round journal](stereo-camera-round.md) records its refinement limits.

`MeshData.sampling` reports the actual `cells`, `nominalSpacing`, `maxSpacing`, `addedPlanes`, `facePlaneOffset`, `featureAligned`, `budgetLimited`, `gridPhase`, `quantizationLimited` and any `skippedReason`. A phase can enlarge the first, padded interval beyond nominal spacing; `maxSpacing` records that fact. None of these interval values is a surface tolerance. The custom 68 × 48 × 38 mm case at base 72 retains its face planes on a phase retry. The maximum-size case at base 72 uses ordinary fallback and explicitly reports that face alignment was abandoned.

Large JavaScript builder arrays and the edge-key map are released after creating independent typed output buffers, before refinement or another complete generation attempt. Worker cancellation still terminates the job.

## Transported-sweep pruning

Flattened Follow curve sweeps return an affine distance bound normalized by their depth ratio. Their positive box-distance bound therefore needs the same ratio; ordinary positive distance would incorrectly discard an active field branch. Negative enclosing-box bounds remain unscaled. Both compiled whole-shape and per-node BVH pruning now use these bounds.

Two regressions compare the optimized field against independent convex minimization of linearly varying balls, and exercise finite CSG limits, interior points, taper, roll and rigid rotation. The existing spatial-field tests also pass. A randomized development probe made 352,000 finite-limit comparisons with zero field difference. The truss at resolution 96 retained byte-identical positions, normals and indices (SHA-256 `3f05fa4af8904492ffdbddeb4b6791d55088654f692a033ba23b0c3ca86d7966`). Its one-shot generation changed from 3.595 to 2.656 seconds; a separate field-grid timing improved only about 9%. These are development-machine observations, not phone timings or an export-time guarantee.

## Reproduction

- `node --test scripts/mesh-sampling.test.mjs scripts/transported-bounds.test.mjs scripts/stereo-camera-study.test.mjs`
- `node scripts/render-construction-study.mjs --study stereo --resolution 220 --refine --views front,rear`

The production-resolution camera test checks the exact quantization failure and retained dimensional planes, alongside topology and triangle/reference-envelope separation. Remaining work should improve sampling without mistaking a closed mesh for full feature detection, material performance or measured hardware fit.
