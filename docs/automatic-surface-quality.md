# Automatic surface quality

Thin cylinder caps meeting curved walls could be bridged diagonally by the
uniform tetrahedral grid. The camera lens plate therefore gained a visibly
stepped rim despite accurate vertex roots. Software previews also capped
settled sampling at 96, and a slow draft could leave later settled work at 64.

Both viewports now use one shared settled policy: 128–136 grid resolution on
coarse-pointer devices, 160–164 elsewhere, followed by up to three conforming
surface-refinement passes (.04 field residual target, 350,000 triangle budget).
Project loads and committed changes request that fine policy immediately.
Continuous geometry edits alone use cheap drafts; after 160 ms without a new
geometry change, refinement starts even while a numeric input remains focused.
Opening a tool, releasing an unchanged grip and orbiting the camera retain the
current fine mesh. Software navigation no longer switches to its remembered
40-grid editing mesh. Fine-grid surfaces stream before additional refinement;
every independent solid is included in each streamed frame. Intermediate
frames retain the queue and busy state. Software rendering only reports ready
after its complete final frame reaches the visible canvas.

Zoom magnification selects .04, .02 or .01 field-residual targets, with the same
finite pass/triangle limits. A severely limited solid (maximum face residual
above .15 and mean above .004) can make one bounded sampling retry to 164.
Other already accurate solids retain their own meshes. No retries chase an
unresolved crease indefinitely. Measurements of the actual 20-shape camera
show that increasing uniform sampling beyond 192 brings diminishing returns
at difficult CSG creases; these targets are sampled display quality, not
manufacturing tolerances or a proof of a globally exact triangle surface.

The most recent complete fine result is cached with its exact authored field,
sampling request, refinement target and engine version. Reload can restore it
while an obsolete calculation is cancelled; draft/intermediate frames are not
cached. Storage failure never blocks ordinary evaluation. WebGL uses device
pixel ratio up to 3 when settled; the software fallback uses up to 2.

Interactive drafts keep their previous adaptive budget and four-pass edge roots.
New geometry and camera presets also preempt an obsolete partially painted
software frame, instead of waiting for its dense triangles to finish.
The existing latest-revision queue, worker cancellation and cooperative fallback
also apply during refinement. No new control or confirmation is required.

The common sampling grid adds bounded paired layers at world-aligned disc-like cylinder
caps and torus centre planes. Layers are separated by .02 mm to avoid tiny
Float32 cells. XYZ Euler rotations are respected; arbitrary tilted features and
global deformation retain conservative ordinary sampling. Existing box-face
priority, 24 additional planes per axis and 1.75 sample-growth limits remain.
This affects previews and export sampling without editing authored dimensions.

Regression coverage includes a thin circular cap, rotated axes, arbitrary-angle
fallback, real camera rim error, topology, byte-stable authored documents,
abort during actual refinement, the real worker protocol and stereo clearance.
The simple 42 mm circular fixture at resolution 32 reduces maximum measured
face-centre field residual from .3667 to .02492. This is sampled field error,
not a manufacturing tolerance or a proof for all surfaces.

The camera's narrow seam remains a difficult blended feature. Refinement may
report qualityLimited even when the visual result improves: projection guards
preserve topology rather than force a folded or collapsed patch. Preview
latency is model/device dependent; drafts remain visible during background work.
Cloud-browser verification exercises the actual software fallback. Physical
phone and hardware-WebGL performance must be measured separately.
