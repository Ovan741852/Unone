// The developer host and exported player use the same UI projection. A host
// may provide resolveAsset(assetId), returning a URL or a promise for one;
// Core only transports the stable asset id and never performs IO.
export function createUiTree(layer, { resolveAsset = null } = {}) {
  let previous = null;
  let renderGeneration = 0;

  function place(element, node) {
    element.className = `unone-ui-node unone-ui-${node.kind}`;
    element.dataset.nodeId = node.id;
    Object.assign(element.style, {
      left: `${node.rect.x}%`,
      bottom: `${node.rect.y}%`,
      width: `${node.rect.width}%`,
      height: `${node.rect.height}%`,
    });
  }

  function appendNode(node, parent, generation) {
    if (node.kind === "component") {
      const group = document.createElement("div");
      group.className = "unone-ui-component";
      group.dataset.nodeId = node.id;
      group.dataset.component = node.component;
      // A component is a semantic reusable wrapper. Its children keep the
      // Core screen design space, so display:contents avoids a second layout
      // transform while preserving the source identity for inspection.
      group.style.display = "contents";
      parent.appendChild(group);
      for (const child of node.children ?? []) appendNode(child, group, generation);
      return;
    }

    const element = document.createElement(node.kind === "button" ? "button" : node.kind === "image" ? "img" : "div");
    place(element, node);
    if (node.kind === "image") {
      element.alt = node.alt ?? node.id;
      element.decoding = "async";
      element.draggable = false;
      element.style.objectFit = node.fit ?? "contain";
      element.dataset.asset = node.asset;
      if (resolveAsset) {
        Promise.resolve(resolveAsset(node.asset)).then((url) => {
          if (generation === renderGeneration && url && element.isConnected) element.src = url;
        }).catch((error) => {
          if (generation === renderGeneration && element.isConnected) {
            element.dataset.assetError = error?.message ?? String(error);
          }
        });
      }
    } else {
      element.textContent = node.text ?? "";
    }
    if (node.kind === "button") element.dataset.action = node.action;
    parent.appendChild(element);
  }

  return (snapshot) => {
    const ui = (snapshot.world ?? snapshot)?.ui ?? null;
    const serialized = JSON.stringify(ui);
    if (serialized === previous) return;
    previous = serialized; layer.replaceChildren();
    const generation = ++renderGeneration;
    for (const node of ui?.children ?? []) appendNode(node, layer, generation);
  };
}
