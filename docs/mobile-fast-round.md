# Mobile modelling round — 5 October 2026

The goal is to make actual modelling possible with a thumb: choose material,
cut it, move an authored form and change its size without opening a large
parameter inspector. The workspace camera belongs to the person editing.

## Delivered workflow

- Docked Add, Cut, Edit, Material and View trays replace the phone's insertion
  and view popovers. Advanced tools remain accessible explicitly.
- Insertion starts in the current working area. Cuts begin inside the active
  form; cylinder cuts run front to back. Sweeps resize their actual controls
  and radii, rather than their unused dimension metadata.
- Selected shapes, components and fields have a constant screen-size move
  grip. Authored bounds update immediately while the surface is evaluated.
  Surface picking identifies contributing unions, blends, cuts and clips.
- A complete drag or value scrub is one undo transaction. Two fingers retain
  navigation and tap-to-undo. Linked clearance cuts are edited through their
  component, so a hidden relationship is not silently detached.
- Solid, Hollow and Cellular are direct material choices. Cell pattern, size,
  thickness, skin and cutaway have large inline controls. Existing lattice
  settings and local material regions survive switching modes.
- Quick tools can also be opened on a desktop or touch laptop.

## Background work

Each model revision invalidates previous display jobs immediately. There is
one active preview and one newest pending snapshot. Cooperative worker jobs
can abort, including settled ambient occlusion. Old geometry cannot replace
new intent. When workers are unavailable, the same evaluator yields between
small blocks and supports cancellation.

Every edit starts a bounded draft; idle time requests a finer surface.
Sampling adapts to model complexity and measured previous work. Draft roots
use four refinement passes. Ordinary meshing, audits and STL export keep the
authoritative 24 passes and existing detail/recovery policy. Drafts can omit
thin features and are never used as export evidence.

Sections have their own cancellable worker and cooperative fallback. Cached
corner sampling cuts field evaluations from 4n² to (n+1)², with identical
sync/async contours. Lighting probes no longer run on the input thread.

The existing on-device save, offline PWA and stable framing remain in use.
Only explicit Fit or camera view commands change framing.

## Reference decisions

[nTop lightweighting](https://resources.ntop.com/resources/blog/design-tips-structural-optimization-lightweighting/)
motivated making shelling, infill and cuts direct operations.
[Field-driven design](https://resources.ntop.com/resources/blog/field-driven-design-product-data-models-for-rapid-collaborative-development/)
motivated retaining editable interfaces and local material domains.
[RICOH camera housing](https://resources.ntop.com/resources/case-studies/designing-a-cooler-camera-housing/)
motivated quick cell-size and wall controls with inspection while editing.
[AddUp floor bracket](https://addupsolutions.com/wp-content/uploads/2023/09/Aircraft-Floor-Bracket-CS-Case-Study-REV-1.pdf)
reinforces the importance of manufacturing constraints and protected mounting
interfaces. These are geometric tools; the app does not calculate structural
or thermal performance from a lattice's appearance.

## Checks and next round

Focused checks exercise real worker cancellation, newest-result scheduling,
sync/async mesh and section equality, authoritative export behavior, bounded
sweep scaling, surface selection and protected component handles.

A local stereo draft at grid 28 produced 11,124 triangles: the full root
policy took about 420 ms and the draft policy about 288 ms. This is a
workspace comparison, not a phone timing claim. Immediate grips remain
necessary while a complex surface evaluates.

The available cloud browser does not supply WebGL or phone viewport
emulation. Live UI checks can verify Quick tools and model state; they cannot
prove iPhone GPU performance, real multitouch or a physical printed fit.
The next round should use a real phone to measure input latency and refine
direct sizing/rotation and local cellular region handles. GPU implicit
display remains a larger follow-up; geometry and export must share intent.
