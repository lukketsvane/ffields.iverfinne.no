/** Frame a bounding sphere in the narrower camera aperture, including portrait. */
export function perspectiveFit(radius:number,fovDegrees:number,aspect:number,margin=1.08){const vertical=fovDegrees*Math.PI/360,horizontal=Math.atan(Math.tan(vertical)*aspect);return radius/Math.sin(Math.min(vertical,horizontal))*margin}
export function orthographicHalfHeight(halfWidth:number,halfHeight:number,aspect:number,margin=1.2){return Math.max(halfHeight,halfWidth/aspect,25)*margin}
