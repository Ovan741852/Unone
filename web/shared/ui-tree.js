// The developer host and exported player use the same UI projection.
export function createUiTree(layer) {
  let previous = null;
  return (snapshot) => {
    const ui = (snapshot.world ?? snapshot)?.ui ?? null;
    const serialized = JSON.stringify(ui);
    if (serialized === previous) return;
    previous = serialized; layer.replaceChildren();
    for (const node of ui?.children ?? []) {
      const element = document.createElement(node.kind === "button" ? "button" : "div");
      element.className = `unone-ui-node unone-ui-${node.kind}`;
      element.textContent = node.text; element.dataset.nodeId = node.id;
      if (node.kind === "button") element.dataset.action = node.action;
      Object.assign(element.style,{left:`${node.rect.x}%`,bottom:`${node.rect.y}%`,width:`${node.rect.width}%`,height:`${node.rect.height}%`});
      layer.appendChild(element);
    }
  };
}
