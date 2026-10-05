# Current-form selection and export loop — 5 October 2026

This round fixes two interruptions in the modelling flow: tapping a previous
display mesh while the authored form has already changed, and losing access
to cancellation after leaving the export inspector.

GPU and software taps now cast through the current static implicit field.
The software ray uses the unchanged camera projection and starts ahead of the
current model bounds. Selection no longer needs an old rendered triangle.
Grips keep priority, visible imported parts are compared by depth, and section
view retains its separate interaction policy. Unattributed lattice surfaces
open Material in the quick workspace.

Picking uses bounded front-to-back sampling and bracket refinement. It does
not assume that deformation, smooth CSG or lattice fields are normalized
distance functions. Time and evaluation budgets include setup and provenance;
an exhausted budget returns no selection rather than selecting old geometry.
Very thin sub-step surfaces and difficult tangent rays can still be missed.
Ripple selection uses the same static mesh frame as earlier provenance.

STL and mesh checks report actual generation, refinement, analysis and file
preparation boundaries. They show no estimated percentage. A fixed workspace
strip keeps status, inspector access and a 44-pixel Cancel target available
after another tool or object is selected. The inspector also offers Cancel
export. The Export menu and More entry remain available during a job.

Cancellation invalidates the task sequence before stopping its worker or
cooperative fallback. Late progress, error, completion and cleanup from an
older task cannot alter a replacement task or create a late download. An
intentional abort is quiet. Status and cancellation do not edit the model,
change its history or explicitly reset its camera.

Export still uses the full 220-cell policy and authoritative refinement,
component checks and STL serialization. The separate worker and cooperative
fallback share the same export stage boundaries and geometry algorithms.

The combined suite passes 238/238 tests. Production build and TypeScript pass;
scoped lint has zero errors and eleven existing warnings, excluding the two
known legacy React hook error rules. Current-field tests include absent or
obsolete meshes, moved and disabled objects, holes, shells, resolved curve
attachments, lattices, rays starting inside, near misses, and budgets that
stop provenance compilation or evaluation. Export tests preserve exact mesh
and STL bytes, and cover intermediate worker messages, cancellation and
late updates. Deployed observations follow the browser checks.
Physical iPhone GPU timings and multitouch remain unmeasured. The next loop
should explore direct curve-point editing and local material regions, and
measure picking on complex sweeps and thin lattices on a physical phone.
