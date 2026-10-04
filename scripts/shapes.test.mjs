import test from 'node:test';
import assert from 'node:assert/strict';
import {makeShape, evaluateShape, shapeBounds, SHAPE_LIMITS} from '../lib/shapes.ts';
import {DEFAULT_MODEL, CAMERA_MODEL, cloneModel, validateModel, isShippedCameraStarter, evaluateBase, generateMesh, modelBounds, makeEntropyModel} from '../lib/form-engine.ts';

const primitive = (kind, edits = {}) => ({...makeShape(kind), x: 0, y: 0, z: 0, blend: 0, ...edits});
const solid = (shapes, edits = {}) => ({
  ...cloneModel(DEFAULT_MODEL), baseEnabled: false, shapes, influences: [], assets: [],
  shell: false, lenses: false, usb: false, buttons: false, fingerGrooves: false, protect: false,
  ...edits,
});
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} ≠ ${expected}`);

function assertClosedMesh(mesh) {
  assert.ok(mesh.indices.length > 0, 'the exported solid has triangles');
  assert.ok(mesh.positions.every(Number.isFinite), 'all exported vertices are finite');
  assert.ok(mesh.normals.every(Number.isFinite), 'all exported normals are finite');
  assert.ok(mesh.volume > 0 && Number.isFinite(mesh.volume), 'the exported solid has finite volume');
  const edges = new Map();
  for (let i = 0; i < mesh.indices.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const a = mesh.indices[i + j], b = mesh.indices[i + (j + 1) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  assert.equal([...edges.values()].filter(count => count !== 2).length, 0, 'every triangle edge has two faces');
}

test('ellipsoids, rounded boxes, capsules and cylinders have their documented dimensions', () => {
  const ellipsoid = primitive('sphere', {width: 60, height: 40, depth: 20});
  assert.ok(evaluateShape(ellipsoid, 0, 0, 0) < 0);
  for (const point of [[30, 0, 0], [0, 20, 0], [0, 0, 10]]) near(evaluateShape(ellipsoid, ...point), 0, 'ellipsoid axis endpoint');
  assert.ok(evaluateShape(ellipsoid, 25, 15, 0) > 0, 'an ellipsoid does not fill its bounding-box corners');
  assert.ok(evaluateShape(ellipsoid, 0, 0, 11) > 0);

  const box = primitive('box', {width: 40, height: 20, depth: 12, roundness: 0});
  assert.ok(evaluateShape(box, 19, 9, 5) < 0);
  near(evaluateShape(box, 20, 0, 0), 0, 'box side');
  assert.ok(evaluateShape(box, 21, 0, 0) > 0);
  assert.ok(evaluateShape({...box, roundness: 5}, 19, 9, 5) > 0, 'rounding removes the sharp corner');

  const capsule = primitive('capsule', {width: 20, height: 60, depth: 20, roundness: 10});
  assert.ok(evaluateShape(capsule, 0, 29, 0) < 0, 'capsule runs along Y');
  near(evaluateShape(capsule, 0, 30, 0), 0, 'capsule cap');
  assert.ok(evaluateShape(capsule, 9, 29, 0) > 0, 'capsule cap is curved');
  assert.ok(evaluateShape(capsule, 11, 0, 0) > 0);

  const cylinder = primitive('cylinder', {width: 40, height: 60, depth: 20});
  assert.ok(evaluateShape(cylinder, 0, 29, 0) < 0, 'cylinder runs along Y');
  assert.ok(evaluateShape(cylinder, 19, 29, 0) < 0, 'cylinder has a flat cap');
  for (const point of [[20, 0, 0], [0, 30, 0], [0, 0, 10]]) near(evaluateShape(cylinder, ...point), 0, 'cylinder endpoint');
  assert.ok(evaluateShape(cylinder, 0, 31, 0) > 0);
});

test('torus has an open center, radial tube and independently controlled tube height', () => {
  const torus = primitive('torus', {width: 80, height: 20, depth: 80, roundness: .25});
  assert.ok(evaluateShape(torus, 0, 0, 0) > 0, 'torus center is a hole');
  assert.ok(evaluateShape(torus, 30, 0, 0) < 0, 'torus ring is material');
  assert.ok(evaluateShape(torus, 0, 0, 30) < 0, 'torus ring lies in XZ');
  near(evaluateShape(torus, 40, 0, 0), 0, 'outer radial edge');
  near(evaluateShape(torus, 30, 10, 0), 0, 'tube height');
  assert.ok(evaluateShape(torus, 30, 11, 0) > 0);
});

test('extreme torus aspect ratios stay inside their declared bounds', () => {
  const torus = primitive('torus', {width: 240, height: 240, depth: 4, roundness: .3});
  assert.ok(evaluateShape(torus, 84, 0, 0) < 0, 'wide radial tube remains material');
  assert.ok(evaluateShape(torus, 0, 0, 1.4) < 0, 'thin radial tube remains material');
  assert.ok(evaluateShape(torus, 84, 119, 0) < 0, 'tube height is independent of its radial thickness');
  near(evaluateShape(torus, 120, 0, 0), 0, 'wide outer edge');
  near(evaluateShape(torus, 0, 0, 2), 0, 'thin outer edge');
  const box = shapeBounds(torus);
  for (let axis = 0; axis < 3; axis++) {
    const other = [0, 1, 2].filter(value => value !== axis);
    for (const side of [0, 1]) for (let i = 0; i <= 16; i++) for (let j = 0; j <= 16; j++) {
      const point = [0, 0, 0];
      point[axis] = box[axis + side * 3] + (side ? .01 : -.01);
      point[other[0]] = box[other[0]] + (box[other[0] + 3] - box[other[0]]) * i / 16;
      point[other[1]] = box[other[1]] + (box[other[1] + 3] - box[other[1]]) * j / 16;
      assert.ok(evaluateShape(torus, ...point) > 0, `torus stays inside axis ${axis} face at ${point}`);
    }
  }
});

test('shape transforms use degrees and bounds follow translated rotated geometry', () => {
  const box = primitive('box', {width: 40, height: 20, depth: 12, roundness: 0, x: 120, y: -30, z: 70, rz: 90});
  assert.ok(evaluateShape(box, 120, -11, 70) < 0, 'long X axis rotates onto world Y');
  assert.ok(evaluateShape(box, 139, -30, 70) > 0, 'the world X extent becomes the shorter axis');
  const expected = [110, -50, 64, 130, -10, 76];
  shapeBounds(box).forEach((value, i) => near(value, expected[i], `rotated bound ${i}`));
  const torus = primitive('torus', {width: 80, height: 20, depth: 80, roundness: .25, rx: 90});
  assert.ok(evaluateShape(torus, 0, 30, 0) < 0, 'rotated torus ring lies in XY');
  assert.ok(evaluateShape(torus, 0, 0, 30) > 0, 'rotated hole axis follows world Z');
});

test('ordered union, subtraction and intersection produce the intended solids', () => {
  const mass = primitive('sphere', {id: 'mass', width: 60, height: 60, depth: 60});
  const cut = primitive('box', {id: 'cut', width: 12, height: 80, depth: 80, roundness: 0, operation: 'subtract'});
  const insert = primitive('sphere', {id: 'insert', width: 10, height: 10, depth: 10});
  assert.ok(evaluateBase(solid([mass, cut]), 0, 0, 0) > 0, 'subtraction removes the center');
  assert.ok(evaluateBase(solid([mass, cut]), 20, 0, 0) < 0, 'subtraction preserves the remaining side');
  assert.ok(evaluateBase(solid([mass, cut, insert]), 0, 0, 0) < 0, 'a later union can fill a cut');
  assert.ok(evaluateBase(solid([mass, insert, cut]), 0, 0, 0) > 0, 'reordering changes the result');
  assert.ok(evaluateBase(solid([mass, {...cut, enabled: false}]), 0, 0, 0) < 0, 'disabled operations are ignored');
  const clip = {...mass, id: 'clip', x: 20, operation: 'intersect'};
  assert.ok(evaluateBase(solid([mass, clip]), 20, 0, 0) < 0, 'intersection retains overlapping material');
  assert.ok(evaluateBase(solid([mass, clip]), -20, 0, 0) > 0, 'intersection removes non-overlapping material');
});

test('subtraction and intersection cannot create geometry in an empty model', () => {
  for (const operation of ['subtract', 'intersect']) {
    const model = solid([primitive('sphere', {operation, width: 40, height: 40, depth: 40})]);
    for (const point of [[0, 0, 0], [10, 0, 0], [50, 0, 0]]) assert.equal(evaluateBase(model, ...point), Infinity, `${operation} leaves an empty field`);
    const mesh = generateMesh(model, 50);
    assert.equal(mesh.indices.length, 0);
    assert.equal(mesh.positions.length, 0);
    assert.equal(mesh.normals.length, 0);
    assert.equal(mesh.volume, 0);
  }
});

test('blend grows a smooth seam between masses and shelling happens after merging', () => {
  const left = primitive('sphere', {id: 'left', width: 40, height: 40, depth: 40, x: -15});
  const right = {...left, id: 'right', x: 15};
  const hard = evaluateBase(solid([left, right]), 0, 0, 0);
  const smooth = evaluateBase(solid([left, {...right, blend: 8}]), 0, 0, 0);
  assert.ok(smooth < hard - 1, 'blend changes the actual field at the shared seam');
  const mergedShell = solid([left, right], {shell: true, wall: 2.6});
  assert.ok(evaluateBase(mergedShell, -5, 0, 0) > 0, 'an internal primitive surface does not become an internal wall');
  assert.ok(evaluateBase(mergedShell, -34, 0, 0) < 0, 'the merged exterior still has a shell wall');
});

test('rotated off-origin shapes export finite closed meshes without clipping', () => {
  for (const kind of ['capsule', 'torus']) {
    const shape = primitive(kind, {id: `offset-${kind}`, width: 80, height: 60, depth: 50, roundness: kind === 'torus' ? .3 : 20, x: 210, y: -100, z: 95, rx: 31, ry: 47, rz: -15});
    const model = solid([shape]);
    const shapeBox = shapeBounds(shape), box = modelBounds(model, false);
    assert.equal(box.length, 6);
    assert.ok(box.every(Number.isFinite));
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(box[axis] <= shapeBox[axis] && box[axis + 3] >= shapeBox[axis + 3], 'model sampling bounds contain the primitive');
    }
    const mesh = generateMesh(model, 50);
    assertClosedMesh(mesh);
    assert.ok(mesh.bounds[0] > 140, 'export preserves the off-origin placement');
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(mesh.bounds[axis] > box[axis] && mesh.bounds[axis + 3] < box[axis + 3], 'the solid does not touch a sampling boundary');
    }
  }
});

test('shape JSON round-trips and malformed transforms, operations and IDs are rejected', () => {
  const shapes = ['sphere', 'box', 'capsule', 'cylinder', 'torus'].map((kind, index) => primitive(kind, {id: `shape-${index}`, x: index * 10, ry: index * 15}));
  const model = solid(shapes);
  assert.deepEqual(validateModel(JSON.parse(JSON.stringify(model))).shapes, shapes);
  for (const invalid of [
    {...shapes[0], id: 'body'}, {...shapes[0], id: ''}, {...shapes[0], kind: 'cone'},
    {...shapes[0], operation: 'xor'}, {...shapes[0], enabled: 'yes'},
    {...shapes[0], width: 0}, {...shapes[0], x: Infinity}, {...shapes[0], rz: NaN},
    {...shapes[0], blend: -1}, {...shapes[0], roundness: 61},
    {...shapes[4], roundness: .01}, {...shapes[4], roundness: .5},
  ]) assert.throws(() => validateModel(solid([invalid])), `reject ${JSON.stringify(invalid)}`);
  assert.throws(() => validateModel(solid([shapes[0], {...shapes[1], id: shapes[0].id}])));
  assert.throws(() => validateModel(solid(Array.from({length: 33}, (_, i) => ({...shapes[0], id: `many-${i}`})))));
  assert.throws(() => validateModel({...model, baseEnabled: 'yes'}));
  for (const [key, [low, high]] of Object.entries(SHAPE_LIMITS)) {
    if (key === 'roundness') continue;
    for (const value of [low - 1, high + 1]) assert.throws(() => validateModel(solid([{...shapes[0], [key]: value}])));
  }
});

test('shape IDs cannot collide with influences or placed components', () => {
  const shape = primitive('sphere', {id: 'shared-id'});
  const influence = {...CAMERA_MODEL.influences[0], id: 'shared-id'};
  assert.throws(() => validateModel(solid([shape], {influences: [influence]})));
  const asset = {id: 'shared-id', sourceId: 'pololu-usb-c', name: 'USB-C', visible: true, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1};
  assert.throws(() => validateModel(solid([shape], {assets: [asset]})));
});

test('existing camera files retain their geometry when the optional shape fields are absent', () => {
  const legacy = cloneModel(CAMERA_MODEL);
  legacy.width = 172;
  legacy.influences[0].strength = 3.2;
  delete legacy.shapes;
  delete legacy.baseEnabled;
  const restored = validateModel(legacy);
  for (const point of [[0, 0, 0], [25, -14, -20], [70, 0, 0], [-30, 5, 20]]) {
    near(evaluateBase(restored, ...point), evaluateBase(legacy, ...point), 'legacy camera field');
  }
  assert.equal(restored.width, 172);
  assert.equal(restored.influences[0].strength, 3.2);
  assert.equal(restored.lenses, true);
  assert.equal(restored.usb, true);
});

test('starter detection ignores property order while validation preserves intentional camera documents', () => {
  assert.equal(isShippedCameraStarter(cloneModel(CAMERA_MODEL)), true);
  assert.deepEqual(validateModel(cloneModel(CAMERA_MODEL)), CAMERA_MODEL, 'validation preserves an intentionally imported camera');
  const reordered = Object.fromEntries(Object.entries(cloneModel(CAMERA_MODEL)).reverse());
  reordered.influences = reordered.influences.map(influence => Object.fromEntries(Object.entries(influence).reverse()));
  assert.equal(isShippedCameraStarter(reordered), true, 'JSON object key order does not change starter detection');
  assert.deepEqual(validateModel(reordered), CAMERA_MODEL, 'validation preserves the camera regardless of key order');
  const initial = {...cloneModel(CAMERA_MODEL), shapes: [], assets: [], baseEnabled: true};
  assert.equal(isShippedCameraStarter(initial), true, 'initial client placement arrays still identify a starter');
  assert.deepEqual(validateModel(initial), initial, 'validation never performs starter migration');
  for (const edits of [{name: 'Authored camera'}, {width: 172}, {baseEnabled: false}]) {
    const authored = {...cloneModel(CAMERA_MODEL), ...edits};
    assert.equal(isShippedCameraStarter(authored), false);
    assert.deepEqual(validateModel(authored), authored, 'authored camera changes stay intact');
  }
  assert.deepEqual(validateModel({...cloneModel(DEFAULT_MODEL), assets: []}), {...DEFAULT_MODEL, assets: []}, 'an initial neutral clone accepts empty arrays');
});

test('Entropy starts without camera features and seeded studies reproduce editable masses', () => {
  for (const key of ['lenses', 'usb', 'buttons', 'fingerGrooves']) assert.equal(DEFAULT_MODEL[key], false, `default ${key} is off`);
  assert.match(DEFAULT_MODEL.name, /entropy/i);
  const first = makeEntropyModel(42), repeated = makeEntropyModel(42), other = makeEntropyModel(43);
  assert.deepEqual(first, repeated, 'same seed reproduces every shape and field');
  assert.notDeepEqual(first.shapes, other.shapes, 'another seed produces another study');
  assert.ok(first.shapes.length >= 3 && first.shapes.length <= 5, 'studies contain three to five masses');
  assert.ok(first.shapes.some(shape => shape.blend > 0), 'generated masses can merge smoothly');
  assert.deepEqual(validateModel(JSON.parse(JSON.stringify(first))), first, 'generated studies remain valid editable documents');
});
