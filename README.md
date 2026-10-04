# Form Fields

A browser-based implicit modelling workspace for sculpting camera enclosures around real components.

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

- Hollow camera enclosure, lens apertures, shutter socket, USB-C passage and finger valleys.
- Continuous GPU ripple deformation; Play/Pause is visible immediately on launch. Lens and mechanical regions remain fixed.
- User-selected canvas colour, retained on the device.
- Docked asset/field browser. Real component assets insert into the 3D scene with position, rotation, scale and visibility controls.
- Empty variants collection until a user saves a model. Previous shipped starter clones are removed from saved studies.
- Undo/redo, JSON project interchange, enclosure STL, section SVG and viewport PNG export.
- Desktop workspace and a touch layout with orbit, pinch/pan, field handles and a docked inspector.
- Device-local project persistence and offline application assets.

## Source map

| File | Responsibility |
| --- | --- |
| `app/page.tsx` | Document state, undo, selection, tools and inspector |
| `lib/form-engine.ts` | Implicit camera field, shell/apertures, mesh generation and exports |
| `lib/ripple-material.ts` | GPU surface deformation and matching normal transformation |
| `components/form/viewport.tsx` | Three.js renderer, camera/touch controls, asset loading |
| `components/form/camera-parts.ts` | Parametric optical and shutter display assemblies |
| `components/form/asset-browser.tsx` | Docked assets and field insertion |
| `lib/asset-catalog.json` | Component metadata, dimensions and original-source provenance |
| `public/assets/components/` | Runtime component GLBs and geometry thumbnails |
| `scripts/camera.test.mjs` | Shell/aperture, deformation and mesh-topology checks |

The implicit enclosure is editable geometry. Imported CAD components are reference meshes: moving them does not automatically create Boolean cavities. STL currently exports the enclosure; JSON preserves component placements. GLBs use metres and are displayed in the millimetre workspace at scale 1000.

The wall parameter is the undeformed field offset; deformation can change physical wall thickness. This is a modelling application, not a manufacturing validation certificate. Native STEP originals remain the precision sources linked from the asset catalog.

## Verification

The build, model tests, touch-state tests and offline-cache tests run locally. Camera geometry was inspected using an offline renderer; the modified material/depth vertex shaders were compiled in an offscreen OpenGL context. The available cloud browser has WebGL disabled, so live GPU rendering and sustained iPhone frame rate still need hardware verification.

## Development conventions

Keep the CPU field and GPU deformation in agreement. Preserve a positive deformation Jacobian. Shell the exterior before subtracting openings. Keep imported components separate from the implicit enclosure unless a real conversion/Boolean operation is implemented. Do not ship generated starter variants or static model images as the live editing surface.
