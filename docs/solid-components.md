# Separate solid components

A shape's optional `componentId` owns its Boolean operation. Untagged shapes belong to Body. A component starts with a self-owned Merge shape; its cuts and further masses use that root's ID. Legacy untagged documents keep their original field and mesh path.

Each component is sampled and refined against its own implicit field, then buffers are concatenated without welding vertices. This retains separate closed solids even if parts touch or overlap. Occupancy queries use the minimum of the independent fields. Component triangle ranges, sampling and refinement metadata survive worker transfers and export checks. Combined STL contains separate shells; Export this component produces a standalone STL.

The camera reference has a 16-shape Body and a four-shape lens plate. A nominal cylindrical receiving pocket provides 0.25 mm radial and 0.4 mm rear clearance. These are authored study dimensions, not verified hardware or printing fit. Only the exactly unchanged previous reference upgrades automatically; edited files remain unchanged.

Moving or rotating a component root carries all its owned cuts and masses. The group transform editor selects the whole component by default. Root duplicate, mirror and remove actions include owned shapes. New quick cuts inherit the selected shape's component. Assigning a root to another component requires all its owned shapes; malformed edits remain atomic.

Regression tests cover overlapping closed solids, isolated cuts, sync/async/export equivalence, refinement, standalone STL, ownership validation, rigid edits, copy/mirror/removal, migration preservation, camera clearance and cancellation. The original single-body camera smoothing regression remains against the historical reference.
