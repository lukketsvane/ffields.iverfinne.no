"""Orthographic studio render of the actual ffIELDS triangulated implicit surface."""
import json
import sys
import numpy as np
from PIL import Image, ImageDraw

with open(sys.argv[1], encoding="utf8") as source:
    data = json.load(source)
positions = np.asarray(data["positions"], dtype=float).reshape(-1, 3)
normals = np.asarray(data["normals"], dtype=float).reshape(-1, 3)
indices = np.asarray(data["indices"], dtype=int).reshape(-1, 3)
direction = np.array([.22, .15, 1.] if data["id"] == "auxetic" else
                     [.65, 1.25, 1.] if data["id"] in ("vortex", "spiral") else
                     [.72, .38, 1.])
direction /= np.linalg.norm(direction)
right = np.cross([0., 1., 0.], direction)
right /= np.linalg.norm(right)
up = np.cross(direction, right)
center = (positions.min(axis=0) + positions.max(axis=0)) / 2
relative = positions - center
xy = np.column_stack((relative @ right, -(relative @ up)))
depth = relative @ direction
width, height, supersample = 768, 576, 2
extent = np.ptp(xy, axis=0)
scale = min(width * .83 / extent[0], height * .84 / extent[1])
xy = (xy - (xy.max(axis=0) + xy.min(axis=0)) / 2) * scale
xy += [width / 2, height / 2]
xy *= supersample

# Soft graphite backdrop, kept independent of model geometry.
y, x = np.mgrid[:height * supersample, :width * supersample]
glow = np.exp(-(((x / supersample - width * .43) / width) ** 2 +
                ((y / supersample - height * .3) / height) ** 2) * 3)
background = np.clip(np.array([18., 20., 23.]) + glow[..., None] * 9, 0, 255).astype(np.uint8)
image = Image.fromarray(background)
draw = ImageDraw.Draw(image)
face_normals = normals[indices].mean(axis=1)
face_normals /= np.maximum(np.linalg.norm(face_normals, axis=1, keepdims=True), 1e-9)
# Render both sides, as the workspace does for cut surfaces.
facing = face_normals @ direction
face_normals *= np.where(facing < 0, -1., 1.)[:, None]
key = right * -.55 + up * .8 + direction * .8
key /= np.linalg.norm(key)
fill = right * .7 + up * .2 + direction * .3
fill /= np.linalg.norm(fill)
half = (key + direction) / np.linalg.norm(key + direction)
lighting = (.25 + .6 * np.maximum(0, face_normals @ key) +
            .18 * np.maximum(0, face_normals @ fill) +
            .2 * np.maximum(0, face_normals @ half) ** 24)
colors = np.clip(lighting[:, None] * np.array([190., 197., 203.]), 0, 255).astype(np.uint8)
triangles = xy[indices]
order = np.argsort(depth[indices].mean(axis=1))
for index in order:
    draw.polygon([tuple(point) for point in triangles[index]], fill=tuple(colors[index]))
image.resize((width, height), Image.Resampling.LANCZOS).save(sys.argv[2], optimize=True)
