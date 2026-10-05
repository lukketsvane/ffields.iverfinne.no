# Direct mobile modelling round — 5 October 2026

The next step after the docked tools is to change the authored form directly.
Size, Move and Rotate select their canvas grip automatically. Soften uses
its inline controls and hides the transform grip. Inspecting the same object
retains its current mode. An empty construction offers shape insertion.

The square grip scales all primitive dimensions uniformly from the model at
pointer-down; actual sweep controls and radii scale with it. The rotation grip
uses a visible ring and the chosen X/Y/Z axis. Incremental angular motion is
accumulated across complete turns, with equivalent authored Euler angles
wrapped to their valid range. Camera framing stays unchanged. A complete
gesture is one undo transaction, including interruption for navigation.

Component clearance cuts and attached curve sources do not offer independent
transform grips. Component changes regenerate their linked geometry. Surface
selection still uses the evaluated model's contributing shape rather than a
nearest object centre. Grip offsets and hit areas use CSS pixels at every zoom.

Software preview interpolates shared vertex lighting across each triangle
instead of painting one flat brightness per triangle. Drafts stay bounded at
40 cells; idle detail adapts between 64 and 96. Completed frames remain visible
during cooperative painting. Direct input can interrupt dense idle painting
to draw a lighter frame. This remains a lower-detail fallback for browsers
without WebGL, with the same previously recorded component/ripple limitations.

Authoritative export retains the existing grid, root refinement and detail
policy. If a worker cannot start or fails, mesh generation, refinement,
topology/fit checks and STL writing now yield between algorithm groups and
support cancellation. Deterministic synchronous algorithms and asynchronous
fallbacks share ordering; preview shortcuts are excluded from export.

The combined suite passes 213/213 tests. Production build and TypeScript pass;
scoped lint has zero errors and twelve existing warnings, with the two known
legacy React hook error rules disabled. Four original refinement fixtures and
six original audit fixtures retain their exact results. Cooperative export
checks preserve refined STL bytes and verify timer-delivered cancellation.
Direct checks cover snapshot scaling, protected links, rotation wrapping,
smooth shared-edge lighting and contact-sequence ownership.

The available browser still cannot verify real iPhone GPU
timings or multitouch. The next round should measure these on a physical
phone, then explore direct curve control points and local material regions.
