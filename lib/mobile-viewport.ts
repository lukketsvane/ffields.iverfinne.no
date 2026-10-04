type KeyboardViewport = {
  appHeight: number;
  visualHeight: number;
  offsetTop: number;
  scale: number;
  mobile: boolean;
  editing: boolean;
};

/** Browser chrome and pinch zoom should never move the modelling tools. */
export function keyboardObstruction(viewport: KeyboardViewport) {
  if (!viewport.mobile || !viewport.editing || Math.abs(viewport.scale - 1) > .02) return 0;
  const hidden = Math.max(0, viewport.appHeight - viewport.visualHeight - viewport.offsetTop);
  return hidden >= 100 ? Math.round(hidden) : 0;
}
