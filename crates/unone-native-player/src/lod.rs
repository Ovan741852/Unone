//! Presentation-only selection; shared asset validation lives in Core.
pub fn validate(p: &[f32], uv: &[f32], i: &[u32]) -> Result<(), String> {
    unone_engine::validate_mesh_geometry(p, uv, i).map_err(|e| e.to_string())
}
pub fn levels(value: &serde_json::Value) -> Result<Vec<unone_engine::MeshLod>, String> {
    let mesh: unone_engine::MeshAsset =
        serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
    mesh.validate().map_err(|e| e.to_string())?;
    Ok(mesh.lods)
}
pub fn select(position: [f32; 3], camera: [f32; 3], distances: &[f32]) -> usize {
    let d = position
        .iter()
        .zip(camera)
        .map(|(p, c)| (p - c) * (p - c))
        .sum::<f32>();
    distances.iter().take_while(|v| d >= **v * **v).count()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn distance_boundaries() {
        assert_eq!(select([0.; 3], [9., 0., 0.], &[10., 20.]), 0);
        assert_eq!(select([0.; 3], [10., 0., 0.], &[10., 20.]), 1);
        assert_eq!(select([0.; 3], [20., 0., 0.], &[10., 20.]), 2);
    }
    #[test]
    fn malformed_geometry_fails() {
        assert!(validate(&[0.; 9], &[0.; 6], &[0, 1, 4]).is_err());
        assert!(validate(&[f32::NAN; 9], &[0.; 6], &[0, 1, 2]).is_err());
    }
}

#[derive(Clone, Copy, PartialEq)]
pub struct View {
    pub position: [f32; 3],
    f: [f32; 3],
    r: [f32; 3],
    u: [f32; 3],
    tan: f32,
    aspect: f32,
}
impl View {
    pub fn new(c: &unone_engine::Camera3DData, aspect: f32) -> Self {
        fn norm(v: [f32; 3]) -> [f32; 3] {
            let n = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-12);
            v.map(|x| x / n)
        }
        let p = [
            c.position.x as f32,
            c.position.y as f32,
            c.position.z as f32,
        ];
        let f = norm([
            c.target.x as f32 - p[0],
            c.target.y as f32 - p[1],
            c.target.z as f32 - p[2],
        ]);
        let r = if f[0].abs() + f[2].abs() < 1e-6 {
            [1., 0., 0.]
        } else {
            norm([-f[2], 0., f[0]])
        };
        let u = [
            r[1] * f[2] - r[2] * f[1],
            r[2] * f[0] - r[0] * f[2],
            r[0] * f[1] - r[1] * f[0],
        ];
        Self {
            position: p,
            f,
            r,
            u,
            tan: (c.fov_degrees as f32 * std::f32::consts::PI / 360.).tan(),
            aspect,
        }
    }
    pub fn uniform(&self) -> [f32; 16] {
        [
            self.position[0],
            self.position[1],
            self.position[2],
            self.tan,
            self.f[0],
            self.f[1],
            self.f[2],
            self.aspect,
            self.r[0],
            self.r[1],
            self.r[2],
            0.1,
            self.u[0],
            self.u[1],
            self.u[2],
            10000.,
        ]
    }
    pub fn intersects(&self, p: [f32; 3], radius: f32) -> bool {
        let d = std::array::from_fn::<_, 3, _>(|n| p[n] - self.position[n]);
        let dot = |v: [f32; 3]| (0..3).map(|n| d[n] * v[n]).sum::<f32>();
        let z = dot(self.f);
        let x = self.tan * self.aspect;
        z + radius >= 0.1
            && z - radius <= 10000.
            && dot(self.r).abs() <= z * x + radius * (1. + x * x).sqrt()
            && dot(self.u).abs() <= z * self.tan + radius * (1. + self.tan * self.tan).sqrt()
    }
}

#[cfg(test)]
mod view_tests {
    use super::*;
    #[test]
    fn frustum_rejects_offscreen_and_behind_camera() {
        let c=serde_json::from_value(serde_json::json!({"position":{"x":0,"y":0,"z":10},"target":{"x":0,"y":0,"z":0},"fov_degrees":60})).unwrap();
        let v = View::new(&c, 16. / 9.);
        assert!(v.intersects([0.; 3], 1.));
        assert!(!v.intersects([1000., 0., 0.], 1.));
        assert!(!v.intersects([0., 0., 30.], 1.));
    }
    #[test]
    fn vertical_camera_has_nonzero_basis() {
        let c=serde_json::from_value(serde_json::json!({"position":{"x":0,"y":10,"z":0},"target":{"x":0,"y":0,"z":0},"fov_degrees":60})).unwrap();
        let v = View::new(&c, 1.);
        assert!(v.intersects([0.; 3], 1.));
        assert!(!v.intersects([1000., 0., 0.], 1.));
    }
}
