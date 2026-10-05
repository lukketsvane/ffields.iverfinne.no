# Automatic surface quality

Thin cylinder caps meeting curved walls could be bridged diagonally by the
uniform tetrahedral grid. The camera lens plate therefore gained a visibly
stepped rim despite accurate vertex roots. Software previews also capped
settled sampling at 96, and a slow draft could leave later settled work at 64.

Both viewports now use one shared settled policy: 128–136 grid resolution on
coarse-pointer devices, 160–164 elsewhere, followed by up to three conforming
surface-refinement passes (.04 field residual target, 350,000 triangle budget).
Interactive drafts keep their previous adaptive budget and four-pass edge roots.
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
