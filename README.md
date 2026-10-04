# Form Fields

A browser-based implicit modelling workspace for exploring an entropy design language through editable masses, blends and deformation fields.

## Run

Requires Node.js 24 and pnpm 11.25.0.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

```sh
pnpm build
node --test scripts/camera.test.mjs scripts/mobile.test.mjs scripts/pwa.test.mjs
```

The production build is a static site in `out/`. `vercel.json` supplies the build command and output directory; connect this repository to Vercel and use `main` as the production branch. No runtime secrets or backend are required.

## Workspace

- Grey, eye-free starter form. Camera enclosures and component references remain optional tools.
- Editable ellipsoids, rounded boxes, capsules, cylinders and tori with ordered Merge, Cut and Intersect operations, smooth blending, transforms and duplication.
- Blank construction and curved sweeps with editable control points, varying radius and flattened sections. Docked XY/XZ/YZ sketches support dragging, keyboard nudges and exact numeric editing; world-plane mirrors create independent editable copies.
- One carefully inspected Truss bracket worked study exercises these tools from an empty document. Open it from File or Insert; its parts, curves and cuts remain editable. [Development findings](docs/truss-study-findings.md) record the observed limits and next work.
- [Construction round journal](docs/construction-rounds.md).
- An entropy generator creates a seeded composition of blended masses and deformation fields; its result remains editable and undoable.
- Eight editable engineering studies: Counterflow, Vortex, Halo, Strut, Confluence, Oculus, Cellular panel and Spiral. Each opens as primitive operations and analytic lattice settings, with its actual geometry shown in the project picker.
- Gyroid and diamond sheets, honeycomb channels and octet struts with cell size, nominal thickness, thickness gradient, exterior skin and progressive cutaway controls. Optional regions retain solid mounting features outside the cellular core.
- Continuous GPU ripple deformation starts on launch and stays active during selection, editing, undo and shape insertion. Pause is explicit.
- Camera pose survives editing, asset loading and projection changes. Fit and named views are explicit actions.
- User-selected canvas colour, retained on the device.
- Docked asset/field browser. Real component assets insert into the 3D scene with position, rotation, scale and visibility controls.
- Empty variants collection until a user saves a model. Previous shipped starter clones are removed from saved studies.
- Undo/redo, JSON project interchange, enclosure STL, section SVG and viewport PNG export.
- Desktop workspace and a touch layout with orbit, pinch/pan, field handles and overlay sheets. Opening or resizing mobile sheets preserves the canvas and camera; the keyboard clears only the dock and sheets.
- Device-local project persistence and offline application assets.

## Source map

| File | Responsibility |
| --- | --- |
| `app/page.tsx` | Document state, undo, selection, tools and inspector |
| `lib/form-engine.ts` | Shape composition, deformation fields, shell/apertures, mesh generation and exports |
| `lib/shapes.ts` | Primitive fields, transforms and conservative sampling bounds |
| `lib/construction.ts` | Validated, undoable from-scratch modelling commands shared by UI and WebMCP |
| `lib/truss-study.ts` | One reproducible worked construction using those commands |
| `components/form/sweep-editor.tsx` | Docked planar curve sketch and precise control-point editing |
| `lib/lattice.ts` | Constant-size periodic lattice fields, material regions, skin and cutaways |
| `lib/project-templates.ts` | Editable engineering study construction recipes |
| `lib/workspace-camera.ts` | Projection changes that preserve the camera pose |
| `lib/ripple-material.ts` | GPU surface deformation and matching normal transformation |
| `components/form/viewport.tsx` | Three.js renderer, camera/touch controls, asset loading |
| `components/form/camera-parts.ts` | Parametric optical and shutter display assemblies |
| `components/form/asset-browser.tsx` | Docked assets and field insertion |
| `lib/asset-catalog.json` | Component metadata, dimensions and original-source provenance |
| `public/assets/components/` | Runtime component GLBs and geometry thumbnails |
| `scripts/camera.test.mjs` | Shell/aperture, deformation and mesh-topology checks |

The base mass and inserted shapes form editable implicit geometry; Merge, Cut, Intersect and Blend affect their combined mesh and STL export. Imported CAD components are reference meshes: moving them does not automatically create Boolean cavities. JSON preserves component placements. GLBs use metres and are displayed in the millimetre workspace at scale 1000.

The wall parameter is the undeformed field offset; deformation can change physical wall thickness. This is a modelling application, not a manufacturing validation certificate. Native STEP originals remain the precision sources linked from the asset catalog.

Lattices are part of the same implicit geometry used by the viewport, sections and STL export. When enabled, a lattice replaces the hollow-shell operation and uses its own exterior skin; disabling it restores the composed solid or selected shell. Existing bores and apertures remain open. Gradient changes nominal thickness without shifting the cell phase. Gyroid and diamond values are calibrated implicit fields rather than exact signed distances; displayed thickness is approximate. Meshes sample a finite grid, so very thin walls or strong gradients need inspection at export resolution. Template names describe geometric studies: no thermal, fluid, structural, impact or auxetic simulation is performed.

## Verification

The build, model tests, shape-operation tests, camera-pose tests, touch-state tests and offline-cache tests run locally with `node --test scripts/*.test.mjs`.

For interaction regression checks, install `agent-browser`, serve the production `out/` directory, then run `node scripts/mobile-layout-check.mjs http://localhost:3001`. It checks fixed canvas/control bounds across sheets and menus, numeric editing, simulated keyboard clearance, phone portrait/landscape and desktop panels. Set `AGENT_BROWSER_EXECUTABLE_PATH` if Chromium is outside its default location. Headless keyboard simulation checks layout behavior; native iPhone keyboard timing and sustained GPU frame rate need device verification.

Run `node scripts/entropy-workspace-check.mjs http://localhost:3001` to verify shape construction, Boolean operations, blending, Entropy generation, undo, persistence, actual ripple frames and camera composition through the visible controls.

## Development conventions

Keep the CPU field and GPU deformation in agreement. Preserve a positive deformation Jacobian. Shell the exterior before subtracting openings. Keep imported components separate from the implicit enclosure unless a real conversion/Boolean operation is implemented. Do not ship generated starter variants or static model images as the live editing surface.
