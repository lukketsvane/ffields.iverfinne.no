import {MathUtils, type OrthographicCamera, type PerspectiveCamera, type Vector3} from 'three';

/** Change projection while keeping the user's position, orientation and apparent zoom. */
export function syncOrthographicCamera(camera: PerspectiveCamera, ortho: OrthographicCamera, target: Vector3) {
  camera.updateMatrixWorld();
  const extent = camera.position.distanceTo(target) * Math.tan(MathUtils.degToRad(camera.getEffectiveFOV() / 2));
  ortho.position.copy(camera.position);
  ortho.quaternion.copy(camera.quaternion);
  ortho.up.copy(camera.up);
  ortho.left = -extent * camera.aspect;
  ortho.right = extent * camera.aspect;
  ortho.top = extent;
  ortho.bottom = -extent;
  ortho.zoom = 1;
  const view = camera.view;
  if (view?.enabled) ortho.setViewOffset(view.fullWidth, view.fullHeight, view.offsetX, view.offsetY, view.width, view.height);
  else ortho.clearViewOffset();
  ortho.updateMatrixWorld();
}

/** A canvas resize changes its aperture, never the camera's pose or distance. */
export function resizeWorkspaceProjection(camera: PerspectiveCamera, ortho: OrthographicCamera, target: Vector3, width: number, height: number, mobile: boolean) {
  camera.aspect = width / height;
  if (mobile) {
    const landscape = width >= 600 && height <= 520;
    camera.setViewOffset(width, height, landscape ? width * .18 : 0, landscape ? 0 : height * .22, width, height);
  } else camera.clearViewOffset();
  syncOrthographicCamera(camera, ortho, target);
}
