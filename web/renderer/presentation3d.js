// Shared textured-mesh presentation policy. Gameplay never selects a sampler
// or camera clip convention. Native references: render.rs and lod.rs::View.
export function configureTexture(THREE,texture) {
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.magFilter=THREE.NearestFilter;
  texture.minFilter=THREE.NearestFilter;
  texture.generateMipmaps=false;
  texture.wrapS=THREE.ClampToEdgeWrapping;
  texture.wrapT=THREE.ClampToEdgeWrapping;
  // Static mesh assets use Three's image convention. Native converts 1-v in
  // vertex loading instead; changing both here would flip the image twice.
  texture.flipY=true;
  texture.needsUpdate=true;
  return texture;
}

export function createPerspectiveCamera(THREE) {
  return new THREE.PerspectiveCamera(60,1,0.1,10000);
}
