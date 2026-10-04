# Form: modelling direction

The canonical model is editable design intent. Geometry, sections, silhouettes, field displays and exports are evaluations of it. Keep direct manipulation and future procedural editing as views of the same state.

Delivered mobile foundation: system-driven graphite themes, one canvas gesture owner, stable framing while editing, selection-specific inspector, coarse previews during edits and refinement after release, rendering only on change, background save, offline static shell, worker mesh export.

Next engine work, informed by official nTop documentation and the supplied architecture prototype:

1. Central parameter schema: bounds, units, step, default, validation and sweep metadata. Preserve existing millimetres and imported studies.
2. Separate source → mapping/falloff → operation. Show a signed slice of the selected field rather than calling summed absolute strength a full field viewer.
3. A camera-grip compound: secondary mass, finger valleys, thumb depression and protected transitions; expose depth, width, angle and softness. Store stable, versioned input IDs.
4. Generalize lens seats into persistent spatial regions with explicit keep-outs and protection; avoid triangle-based identity.
5. Reproducible variants: seeded perturbations, chosen parameter bounds, frozen qualities. An editable dependency graph must represent actual relationships.
6. GPU implicit display with one authoritative evaluator shared with export. The supplied prototype's shared WGSL, dirty rendering and temporary low raster scale are useful patterns. Retain a compatible fallback and validated imports/history.
7. Normalize/remap distance fields before physical offsets or thickness checks. Current coordinate-warped implicit values are not necessarily true signed distances; preview shading or field Laplacians are not validated engineering analysis.

Sources:
- https://support.ntop.com/hc/en-us/articles/32858376456723-What-is-adaptive-resolution
- https://support.ntop.com/hc/en-us/articles/55640271125267-nTop-6-1-What-s-New
- https://learn.ntop.com/courses/220-intro-to-field-driven-design/lessons/field-viewer-visualizing-fields-in-ntop/
- https://learn.ntop.com/courses/220-intro-to-field-driven-design/lessons/transfer-function-block/
- https://support.ntop.com/hc/en-us/articles/7042784039443-How-to-create-a-custom-block
- https://support.ntop.com/hc/en-us/articles/4414893285395-My-part-doesn-t-Offset-to-the-correct-value
- User-supplied implicit-modeling-tool-architecture.zip (read as source; not executed).
