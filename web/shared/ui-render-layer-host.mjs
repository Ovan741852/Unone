// Only the official host's tested UI path can claim the full-resolution
// contract. Never trust a capability value supplied in exported game content.
export function declareUiRenderLayerHost(project, supported) {
 if (supported === true) project.ui_render_layer_host='full_resolution';
 else delete project.ui_render_layer_host;
 return project;
}
