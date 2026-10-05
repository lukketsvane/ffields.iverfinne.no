# Mobile workspace and automatic fine surfaces

The normal phone editor now uses a 48 px dock and one short tool strip. Size,
Move, Rotate and Soften share a mode picker and a single active parameter.
Membership, STL export, operations, the range slider and advanced tools remain
available under Tool details. Minimize keeps the canvas grip available. View,
camera, fit and ripple commands share one tray that closes after a choice.
Project templates open on the clear canvas. Only one panel can be active.
Portrait details have a bounded height; landscape uses one side strip. Keyboard
clearance also accounts for Safari's visual viewport offset.

Numeric focus, blur and dismissal preserve authored precision. Dismissal
flushes a focused number before closing its undo transaction, including Safari
buttons that do not reliably blur an input themselves. Nudges retain the
existing fractional value rather than rounding the document to three decimals.

Opening a project or committing an edit requests fine geometry directly.
Only actual geometry changes during a continuous gesture request a draft.
After input pauses, the latest draft is promoted even if a number remains
focused. Reopening a panel, ending an unchanged gesture or moving the view
cannot replace an existing fine mesh with coarse geometry.

The worker streams the full fine base surface before refinement and shading.
Intermediate messages do not release the latest-revision queue. Every separate
solid remains present in each streamed assembly. The software renderer keeps
its previous complete image until a new complete frame is painted, and reports
ready only after publication. Settled raster density honors up to DPR 3 in
WebGL and DPR 2 in the software fallback.

A severely unresolved part can receive one bounded 164-grid retry. Other parts
retain their meshes. Camera magnification requests .04, .02 or .01 display
refinement buckets and never downgrades an already finer surface on zoom-out.
These targets are implicit-field residuals, not manufacturing tolerances or a
guarantee that every sharp CSG crease meets the target. Further uniform retries
have diminishing returns; feature-aware seam sampling is the next geometry
improvement, rather than unbounded grid growth.

The latest completed fine preview is cached independently of the document.
Cache keys include the field snapshot, sampling request, refinement bucket and
engine version. Storage retains one surface, capped at 24 MiB. Storage failure
falls back to ordinary evaluation; cache results are rejected after revision
changes. Export always evaluates the authored fields. Prepared field samplers
remove repeated component ownership scans without changing sampled geometry
or the existing shading calculation.

Regression coverage uses actual rendered JSX, the real worker protocol, exact
compiled-field equivalence, the current two-solid camera, cache validation,
precision retention, cancellation and stage promotion. Browser checks exercise
mobile widths, panel transitions, numeric dismissal, undo, completed painting
and persistence. They do not substitute for physical phone GPU measurements.
