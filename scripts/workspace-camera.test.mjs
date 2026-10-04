import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera, OrthographicCamera, Vector3} from 'three';
import {resizeWorkspaceProjection, syncOrthographicCamera} from '../lib/workspace-camera.ts';

function scene() {
  const camera = new PerspectiveCamera(30, 390 / 738, .5, 6000), ortho = new OrthographicCamera();
  const target = new Vector3(21, -13, 9);
  camera.position.set(185, 99, 276);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  return {camera, ortho, target};
}

test('portrait, landscape and desktop resizing preserve the camera pose and target', () => {
  const {camera, ortho, target} = scene();
  const position = camera.position.clone(), rotation = camera.quaternion.clone(), center = target.clone();
  for (const [width, height, mobile] of [[390, 738, true], [844, 282, true], [1280, 720, false]]) {
    resizeWorkspaceProjection(camera, ortho, target, width, height, mobile);
    assert.deepEqual(camera.position.toArray(), position.toArray());
    assert.deepEqual(camera.quaternion.toArray(), rotation.toArray());
    assert.deepEqual(target.toArray(), center.toArray());
    assert.deepEqual(ortho.position.toArray(), position.toArray());
    assert.deepEqual(ortho.quaternion.toArray(), rotation.toArray());
    const projected = target.clone().project(camera);
    assert.ok(Math.abs(projected.x - (mobile && width >= 600 ? -.36 : 0)) < 1e-10);
    assert.ok(Math.abs(projected.y - (mobile && width < 600 ? .44 : 0)) < 1e-10);
  }
});

test('changing projection keeps the target-plane framing after orbit, pan and zoom', () => {
  const {camera, ortho, target} = scene();
  for (const distance of [1, .65, 1.8]) {
    camera.position.sub(target).applyAxisAngle(new Vector3(0, 1, 0), .17).multiplyScalar(distance).add(target);
    const pan = new Vector3(4, -3, 0);
    camera.position.add(pan);
    target.add(pan);
    camera.lookAt(target);
    resizeWorkspaceProjection(camera, ortho, target, 390, 738, true);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    for (const point of [target, target.clone().addScaledVector(right, 32), target.clone().addScaledVector(up, 18)]) {
      const perspective = point.clone().project(camera), orthographic = point.clone().project(ortho);
      assert.ok(Math.abs(perspective.x - orthographic.x) < 1e-10);
      assert.ok(Math.abs(perspective.y - orthographic.y) < 1e-10);
    }
    const position = camera.position.clone(), rotation = camera.quaternion.clone();
    syncOrthographicCamera(camera, ortho, target);
    assert.deepEqual(camera.position.toArray(), position.toArray());
    assert.deepEqual(camera.quaternion.toArray(), rotation.toArray());
  }
});
