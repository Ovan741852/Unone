// Canonical native/browser batch spatial kernel. One invocation scans one query.
// v1 intentionally uses a bounded linear scan, not a spatial grid.
struct Params { body_count: u32, query_count: u32, pad0: u32, pad1: u32 }
@group(0) @binding(0) var<storage, read> bodies: array<u32>;
@group(0) @binding(1) var<storage, read> queries: array<u32>;
@group(0) @binding(2) var<storage, read_write> results: array<u32>;
@group(0) @binding(3) var<uniform> params: Params;
const BODY_WORDS: u32 = 12u;
const QUERY_WORDS: u32 = 16u;
const HIT_WORDS: u32 = 12u;
const MAX_HITS: u32 = 64u;
const RESULT_WORDS: u32 = 772u;

fn bvec(base: u32) -> vec3<f32> {
    return vec3<f32>(bitcast<f32>(bodies[base]), bitcast<f32>(bodies[base+1u]), bitcast<f32>(bodies[base+2u]));
}
fn qvec(base: u32) -> vec3<f32> {
    return vec3<f32>(bitcast<f32>(queries[base]), bitcast<f32>(queries[base+1u]), bitcast<f32>(queries[base+2u]));
}
// Keep scalar accumulation order aligned with the CPU reference.
fn squared(v: vec3<f32>) -> f32 { return (v.x*v.x + v.y*v.y) + v.z*v.z; }
fn scalar_dot(a: vec3<f32>, b: vec3<f32>) -> f32 { return (a.x*b.x + a.y*b.y) + a.z*b.z; }
fn normal_of(v: vec3<f32>) -> vec3<f32> {
    let scale = max(max(abs(v.x),abs(v.y)),abs(v.z));
    if scale > 0.0 {
        let scaled = v / scale;
        return scaled / sqrt(squared(scaled));
    }
    return vec3<f32>(0.0,0.0,1.0);
}
// GPUs may flush subnormal arithmetic inputs/results to zero. For tiny source
// coordinates, form the direction after scaling by 2^126 using their bit
// representation. Normal inputs can adjust their exponent directly; subnormal
// mantissas become ordinary finite floats without subnormal arithmetic.
fn scale_tiny_component(v: f32) -> f32 {
    let bits = bitcast<u32>(v);
    let magnitude = bits & 0x7fffffffu;
    if magnitude < 0x00800000u {
        let value = f32(magnitude) * 0.00000011920928955078125;
        return select(value,-value,(bits & 0x80000000u) != 0u);
    }
    return bitcast<f32>(bits + 0x3f000000u);
}
fn normal_between(a: vec3<f32>, b: vec3<f32>) -> vec3<f32> {
    let abits = bitcast<vec3<u32>>(a) & vec3<u32>(0x7fffffffu);
    let bbits = bitcast<vec3<u32>>(b) & vec3<u32>(0x7fffffffu);
    let largest = max(max(max(abits.x,abits.y),abits.z),max(max(bbits.x,bbits.y),bbits.z));
    if largest < 0x20000000u {
        let scaled_a = vec3<f32>(scale_tiny_component(a.x),scale_tiny_component(a.y),scale_tiny_component(a.z));
        let scaled_b = vec3<f32>(scale_tiny_component(b.x),scale_tiny_component(b.y),scale_tiny_component(b.z));
        return normal_of(scaled_a-scaled_b);
    }
    return normal_of(a-b);
}
fn write_hit(base: u32, slot: u32, id: u32, distance: f32, fraction: f32, point: vec3<f32>, normal: vec3<f32>) {
    let out = base + 4u + slot*HIT_WORDS;
    results[out] = id;
    results[out+1u] = bitcast<u32>(distance);
    results[out+2u] = bitcast<u32>(fraction);
    results[out+3u] = 0u;
    results[out+4u] = bitcast<u32>(point.x);
    results[out+5u] = bitcast<u32>(point.y);
    results[out+6u] = bitcast<u32>(point.z);
    results[out+7u] = 0u;
    results[out+8u] = bitcast<u32>(normal.x);
    results[out+9u] = bitcast<u32>(normal.y);
    results[out+10u] = bitcast<u32>(normal.z);
    results[out+11u] = 0u;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
    let index = invocation.x;
    if index >= params.query_count { return; }
    let query = index*QUERY_WORDS;
    let output = index*RESULT_WORDS;
    let kind = queries[query];
    let mask = queries[query+1u];
    let exclude_id = queries[query+2u];
    let has_exclude = queries[query+3u] != 0u;
    let origin = qvec(query+4u);
    let radius = bitcast<f32>(queries[query+7u]);
    let destination = qvec(query+8u);
    let max_distance = bitcast<f32>(queries[query+11u]);
    var count = 0u;
    var best_distance = max_distance;
    var best_fraction = 1.0;
    var best_id = 0xffffffffu;
    for (var i = 0u; i < params.body_count; i = i+1u) {
        let body = i*BODY_WORDS;
        let id = bodies[body];
        if (bodies[body+1u] & mask) == 0u || (has_exclude && id == exclude_id) { continue; }
        let body_radius = bitcast<f32>(bodies[body+2u]);
        let position = bvec(body+4u);
        let relative = origin-position;
        let distance = sqrt(squared(relative));
        if kind == 0u {
            if distance <= max_distance && (count == 0u || distance < best_distance || (distance == best_distance && id < best_id)) {
                let normal = normal_between(origin,position);
                write_hit(output,0u,id,distance,0.0,position+normal*body_radius,normal);
                best_distance = distance;
                best_id = id;
                count = 1u;
            }
        } else if kind == 1u {
            let extent = radius+body_radius;
            if squared(relative) <= extent*extent {
                if count < MAX_HITS {
                    let normal = normal_between(origin,position);
                    write_hit(output,count,id,distance,0.0,position+normal*body_radius,normal);
                }
                count = count+1u;
            }
        } else {
            let previous = bvec(body+8u);
            let start = origin-previous;
            let movement = (destination-origin)-(position-previous);
            let extent = radius+body_radius;
            let c = squared(start)-extent*extent;
            var fraction = 0.0;
            var normal = vec3<f32>(0.0,0.0,1.0);
            if c > 0.0 {
                let a = squared(movement);
                if a == 0.0 { continue; }
                // Closest approach avoids subtracting two enormous squared
                // discriminant terms when small spheres travel long distances.
                let closest_fraction = -scalar_dot(start,movement)/a;
                let closest = start+movement*closest_fraction;
                let remaining = extent*extent-squared(closest);
                if remaining < 0.0 { continue; }
                fraction = closest_fraction-sqrt(remaining/a);
                if fraction < 0.0 || fraction > 1.0 { continue; }
                normal = normal_of(start+movement*fraction);
            }
            if count == 0u || fraction < best_fraction || (fraction == best_fraction && id < best_id) {
                let center = previous+(position-previous)*fraction;
                write_hit(output,0u,id,sqrt(squared(destination-origin))*fraction,fraction,center+normal*body_radius,normal);
                best_fraction = fraction;
                best_id = id;
                count = 1u;
            }
        }
    }
    if count > MAX_HITS {
        results[output] = 0u;
        results[output+1u] = 1u;
        return;
    }
    // Stable ID ordering is part of the overlap contract, independent of body order.
    if kind == 1u {
        for (var i = 1u; i < count; i = i+1u) {
            var j = i;
            while j > 0u {
                let right = output+4u+j*HIT_WORDS;
                let left = right-HIT_WORDS;
                if results[left] <= results[right] { break; }
                for (var word = 0u; word < HIT_WORDS; word = word+1u) {
                    let temporary = results[left+word];
                    results[left+word] = results[right+word];
                    results[right+word] = temporary;
                }
                j = j-1u;
            }
        }
    }
    results[output] = count;
    results[output+1u] = 0u;
}
