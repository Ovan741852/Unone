// Accepted decoder routes, not a guarantee that bytes decode on this device.
export const DECODER_ROUTES = Object.freeze({
  mesh: { "unone-mesh-json": "application/json" },
  image: { svg: "image/svg+xml", png: "image/png", jpeg: "image/jpeg", webp: "image/webp" },
  audio: { wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg" },
  spine: { "spine-json": "application/json" },
  effekseer: { efkefc: "application/octet-stream" },
});

export function requireAssetEncoding(asset, decoder) {
  const encoding = asset.encoding;
  if (encoding == null) return; // Legacy manifests explicitly have unspecified encoding.
  const mime = DECODER_ROUTES[decoder]?.[encoding.format];
  if (encoding.decoder !== decoder || !mime || encoding.mime !== mime || encoding.format_version != null) {
    const error = new Error(`HOST_ASSET_ENCODING_UNSUPPORTED: ${asset.id} requests ${JSON.stringify(encoding)}`);
    error.code = "HOST_ASSET_ENCODING_UNSUPPORTED";
    throw error;
  }
}
