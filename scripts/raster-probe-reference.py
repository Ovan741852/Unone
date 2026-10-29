"""Independent CPU top-left raster reference; never reads GPU/browser outputs."""
import argparse
import json
import math
from pathlib import Path

BG = [17, 24, 39]


def linear(value):
    return value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4


def encoded(value):
    return value * 12.92 if value <= .0031308 else 1.055 * value ** (1 / 2.4) - .055


def cross(a, b, p):
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])


def weights(positions, ids, point):
    ids = list(ids)
    if cross(*(positions[i] for i in ids)) < 0:
        ids[1], ids[2] = ids[2], ids[1]
    a, b, c = [positions[i] for i in ids]
    area = cross(a, b, c)
    if not area:
        return None
    for p, q in [(a, b), (b, c), (c, a)]:
        edge = cross(p, q, point)
        include = q[1] < p[1] or (q[1] == p[1] and q[0] > p[0])
        if edge < 0 or (edge == 0 and not include):
            return None
    return ids, [cross(b, c, point) / area, cross(c, a, point) / area, cross(a, b, point) / area]


def sample(image, uv, batch):
    width, height = image['width'], image['height']
    def texel(x, y):
        if batch['address_mode'] == 'repeat':
            x, y = x % width, y % height
        x, y = max(0, min(width - 1, x)), max(0, min(height - 1, y))
        return [n / 255 for n in image['rgba'][(y * width + x) * 4:(y * width + x + 1) * 4]]
    if batch['filter'] == 'nearest':
        return texel(math.floor(uv[0] * width), math.floor((1 - uv[1]) * height))
    x, y = uv[0] * width - .5, (1 - uv[1]) * height - .5
    ix, iy = math.floor(x), math.floor(y)
    fx, fy = x - ix, y - iy
    pixels = [texel(ix, iy), texel(ix + 1, iy), texel(ix, iy + 1), texel(ix + 1, iy + 1)]
    factors = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy]
    result = []
    for channel in range(4):
        decode = channel < 3 and batch['sampling_space'] == 'linear'
        n = sum((linear(p[channel]) if decode else p[channel]) * f for p, f in zip(pixels, factors))
        result.append(encoded(n) if decode else n)
    return result


def fragment(batch, triangle, point, images):
    result = weights(batch['positions'], triangle, point)
    if result is None:
        return None
    ids, bary = result
    perspective = [value / batch['w'][index] for value, index in zip(bary, ids)]
    total = sum(perspective)
    interpolate = lambda field, c: sum(batch[field][index][c] * value for index, value in zip(ids, perspective)) / total
    uv = [interpolate('uv', c) for c in range(2)]
    rgba = [interpolate('rgba', c) for c in range(4)]
    texel = sample(images[batch['texture']], uv, batch)
    alpha, cutoff = texel[3] * rgba[3], batch['alpha_cutoff']
    if alpha < cutoff or (batch.get('alpha_compare') == 'greater' and alpha == cutoff):
        return None
    rgb = [texel[c] * rgba[c] if batch['color_mode'] == 'encoded' else encoded(linear(texel[c]) * rgba[c]) for c in range(3)]
    return [max(0, min(255, math.floor(n * 255 + .5))) for n in rgb]


def pixel(case, point, images):
    rgb, depth, owners = BG, 1, []
    for batch in sorted(case['batches'], key=lambda b: (b['order'], b['id'].encode('utf-8'))):
        s = batch.get('scissor')
        if s and not (s['x'] <= point[0] < s['x'] + s['width'] and s['y'] <= point[1] < s['y'] + s['height']):
            continue
        for start in range(0, len(batch['indices']), 3):
            triangle = batch['indices'][start:start + 3]
            value = fragment(batch, triangle, point, images)
            if value is None or (batch['depth_test'] and batch['z'] >= depth):
                continue
            owners.append([batch['id'], start // 3])
            rgb = value
            if batch['depth_write']:
                depth = batch['z']
    return {'point': point, 'rgb': rgb, 'surviving_draws': owners}


def registry(data):
    cases = {}
    for case in data['cases']:
        cases[case['id']] = {'description': case['description'], 'region': case['region'],
                             'pixels': [pixel(case, p, data['images']) for p in case['points']]}
    assert [r['rgb'] for r in cases['alpha8']['pixels']] == [[0,255,0],BG,[0,0,255],BG,[255,0,0],BG,[255,255,0],BG]
    assert [r['rgb'] for r in cases['material11']['pixels']] == [[93]*3,[64]*3,[188]*3,[128]*3,[128]*3,BG,[255,0,0],[0,255,0],[0,0,255],[255]*3,[128,128,255]]
    assert {tuple(r['point']):r['rgb'] for r in cases['integer']['pixels']}[(100,100)] == [255,0,0]
    return {'profile':'fixed original integer-center top-left reference; independent half-plane/perspective/sRGB arithmetic',
            'tolerance':1,'gpu_verified':False,'cases':cases}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('authored', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.write_text(json.dumps(registry(json.loads(args.authored.read_text('utf-8'))), indent=2) + '\n', encoding='utf-8')
