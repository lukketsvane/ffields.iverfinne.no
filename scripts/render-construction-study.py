"""Render the actual construction mesh; no inferred or generated geometry.

Python owns camera, lighting and antialiasing. A small temporary C++ rasterizer
supplies correct per-pixel visibility and interpolated surface normals.
Requires numpy, Pillow and a C++17 compiler (CXX or g++).
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

import numpy as np
from PIL import Image


RASTERIZER = r"""
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <limits>
#include <vector>
struct Vertex { float x,y,z,nx,ny,nz; };
struct Pixel { float z,nx,ny,nz; };
int main(int argc, char** argv) {
  if(argc != 6) return 2;
  const int width=std::stoi(argv[1]), height=std::stoi(argv[2]);
  std::ifstream verticesFile(argv[3],std::ios::binary|std::ios::ate);
  std::ifstream indicesFile(argv[4],std::ios::binary|std::ios::ate);
  if(!verticesFile || !indicesFile) return 3;
  std::vector<Vertex> vertices(verticesFile.tellg()/sizeof(Vertex));
  std::vector<uint32_t> indices(indicesFile.tellg()/sizeof(uint32_t));
  verticesFile.seekg(0); verticesFile.read(reinterpret_cast<char*>(vertices.data()),vertices.size()*sizeof(Vertex));
  indicesFile.seekg(0); indicesFile.read(reinterpret_cast<char*>(indices.data()),indices.size()*sizeof(uint32_t));
  std::vector<Pixel> pixels(width*height,Pixel{-std::numeric_limits<float>::infinity(),0,0,0});
  for(size_t i=0;i+2<indices.size();i+=3) {
    const Vertex &a=vertices[indices[i]],&b=vertices[indices[i+1]],&c=vertices[indices[i+2]];
    const float denominator=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);
    if(std::abs(denominator)<1e-9f) continue;
    const int minX=std::max(0,int(std::floor(std::min({a.x,b.x,c.x}))));
    const int maxX=std::min(width-1,int(std::ceil(std::max({a.x,b.x,c.x}))));
    const int minY=std::max(0,int(std::floor(std::min({a.y,b.y,c.y}))));
    const int maxY=std::min(height-1,int(std::ceil(std::max({a.y,b.y,c.y}))));
    const float ux=(b.y-c.y)/denominator,uy=(c.x-b.x)/denominator;
    const float vx=(c.y-a.y)/denominator,vy=(a.x-c.x)/denominator;
    for(int y=minY;y<=maxY;y++) {
      const float dy=float(y)+.5f-c.y;
      float u=ux*(float(minX)+.5f-c.x)+uy*dy;
      float v=vx*(float(minX)+.5f-c.x)+vy*dy;
      for(int x=minX;x<=maxX;x++,u+=ux,v+=vx) {
        const float w=1-u-v;
        if(u<-.00001f || v<-.00001f || w<-.00001f) continue;
        const float z=u*a.z+v*b.z+w*c.z;
        Pixel &pixel=pixels[y*width+x];
        if(z<=pixel.z) continue;
        pixel={z,u*a.nx+v*b.nx+w*c.nx,u*a.ny+v*b.ny+w*c.ny,u*a.nz+v*b.nz+w*c.nz};
      }
    }
  }
  std::ofstream output(argv[5],std::ios::binary);
  output.write(reinterpret_cast<const char*>(pixels.data()),pixels.size()*sizeof(Pixel));
  return output ? 0 : 4;
}
"""


def unit(value):
    value = np.asarray(value, dtype=np.float32)
    return value / max(float(np.linalg.norm(value)), 1e-8)


def studio_image(data, direction, width, height, supersample):
    positions = np.asarray(data["positions"], dtype=np.float32).reshape(-1, 3)
    normals = np.asarray(data["normals"], dtype=np.float32).reshape(-1, 3)
    indices = np.asarray(data["indices"], dtype=np.uint32).reshape(-1, 3)
    if not len(positions) or not len(indices):
        raise ValueError("The construction has no surface to render.")
    direction = unit(direction)
    right = unit(np.cross([0., 1., 0.], direction))
    if np.linalg.norm(right) < .5:
        right = unit(np.cross([1., 0., 0.], direction))
    up = unit(np.cross(direction, right))
    rotation = np.stack((right, up, direction), axis=1)
    relative = positions - (positions.min(axis=0) + positions.max(axis=0)) / 2
    projected = relative @ rotation
    projected[:, 1] *= -1
    extent = np.ptp(projected[:, :2], axis=0)
    scale = min(width * .84 / max(extent[0], 1e-8), height * .82 / max(extent[1], 1e-8))
    screen = projected.copy()
    screen[:, :2] -= (screen[:, :2].min(axis=0) + screen[:, :2].max(axis=0)) / 2
    screen[:, :2] *= scale
    screen[:, :2] += [width / 2, height * .49]
    screen[:, :2] *= supersample
    vertex_data = np.column_stack((screen, normals @ rotation)).astype("<f4")
    rw, rh = width * supersample, height * supersample
    with tempfile.TemporaryDirectory(prefix="ffields-raster-") as directory:
        work = Path(directory)
        source, binary = work / "raster.cpp", work / "raster"
        source.write_text(RASTERIZER, encoding="utf8")
        subprocess.run([os.environ.get("CXX", "g++"), "-O3", "-std=c++17", str(source), "-o", str(binary)], check=True)
        vertex_data.tofile(work / "vertices.bin")
        indices.astype("<u4").tofile(work / "indices.bin")
        subprocess.run([str(binary), str(rw), str(rh), str(work / "vertices.bin"), str(work / "indices.bin"), str(work / "pixels.bin")], check=True)
        raster = np.fromfile(work / "pixels.bin", dtype="<f4").reshape(rh, rw, 4)
    depth = raster[..., 0]
    covered = np.isfinite(depth)
    surface = raster[..., 1:]
    surface /= np.maximum(np.linalg.norm(surface, axis=-1, keepdims=True), 1e-8)
    # Match the workspace's double-sided material on exposed cut faces.
    surface *= np.where(surface[..., 2:3] < 0, -1., 1.)
    key = unit([-.65, .85, .9])
    fill = unit([.8, .25, .4])
    rim = unit([.65, .6, -.45])
    half = unit(key + [0., 0., 1.])
    key_diffuse = np.maximum(0, surface @ key)
    fill_diffuse = np.maximum(0, surface @ fill)
    rim_diffuse = np.maximum(0, surface @ rim)
    # Broad highlights preserve readable curvature without making a CAD study
    # look like a photographic or simulated material result.
    lighting = .24 + .54 * key_diffuse + .19 * fill_diffuse + .11 * rim_diffuse
    highlight = .2 * np.maximum(0, surface @ half) ** 26
    lighting += highlight

    # Restrained screen-space contact shading. Plane compensation avoids
    # mistaking the sloping face of a tube for a cavity.
    safe_depth = np.where(covered, depth, 0)
    occlusion = np.zeros((rh, rw), dtype=np.float32)
    count = 0
    pixels_per_mm = scale * supersample
    visible_cosine = np.maximum(surface[..., 2], .28)
    for radius in (3, 8, 17):
        for angle in np.arange(8) * np.pi / 4:
            dx = round(np.cos(angle) * radius * supersample)
            dy = round(np.sin(angle) * radius * supersample)
            neighbor = np.roll(safe_depth, (-dy, -dx), axis=(0, 1))
            neighbor_covered = np.roll(covered, (-dy, -dx), axis=(0, 1))
            if dy > 0:
                neighbor_covered[-dy:] = False
            elif dy < 0:
                neighbor_covered[:-dy] = False
            if dx > 0:
                neighbor_covered[:, -dx:] = False
            elif dx < 0:
                neighbor_covered[:, :-dx] = False
            plane = safe_depth - (surface[..., 0] * dx - surface[..., 1] * dy) / (visible_cosine * pixels_per_mm)
            difference = neighbor - plane
            occlusion += neighbor_covered * np.clip((difference - .45) / 3., 0, 1) * np.exp(-np.maximum(difference, 0) / 18)
            count += 1
    lighting *= 1 - .36 * np.clip(occlusion / count, 0, 1)
    y, x = np.mgrid[:rh, :rw]
    glow = np.exp(-(((x / rw - .44) / .68) ** 2 + ((y / rh - .31) / .9) ** 2) * 2.4)
    image = np.array([19., 21., 25.], dtype=np.float32) + glow[..., None] * np.array([9., 10., 12.], dtype=np.float32)
    silver = lighting[..., None] * np.array([195., 200., 206.], dtype=np.float32)
    image[covered] = silver[covered]
    image = Image.fromarray(np.clip(image, 0, 255).astype(np.uint8))
    return image.resize((width, height), Image.Resampling.LANCZOS)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("output")
    parser.add_argument("--direction", default="-.55,.30,1")
    parser.add_argument("--width", type=int, default=1152)
    parser.add_argument("--height", type=int, default=864)
    parser.add_argument("--supersample", type=int, default=2)
    args = parser.parse_args()
    direction = [float(value) for value in args.direction.split(",")]
    if len(direction) != 3 or np.linalg.norm(direction) < 1e-8:
        parser.error("direction must be a nonzero three-component vector")
    with open(args.source, encoding="utf8") as source:
        data = json.load(source)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    studio_image(data, direction, args.width, args.height, args.supersample).save(output, optimize=True)


if __name__ == "__main__":
    main()
