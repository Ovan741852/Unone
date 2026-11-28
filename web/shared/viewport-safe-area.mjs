// Intersect the host's usable CSS viewport with the game stage, which may be letterboxed.
// Return normalized left, top, right and bottom distances, or null for an invisible stage.
export function stageSafeInsets(stage, viewport, insets) {
  if (!(stage.width > 0 && stage.height > 0 && viewport.width > 0 && viewport.height > 0)) return null;
  const x = viewport.left ?? 0, y = viewport.top ?? 0;
  const l = Math.max(0, x + insets.left - stage.left);
  const t = Math.max(0, y + insets.top - stage.top);
  const r = Math.max(0, stage.left + stage.width - (x + viewport.width - insets.right));
  const b = Math.max(0, stage.top + stage.height - (y + viewport.height - insets.bottom));
  if (l + r >= stage.width || t + b >= stage.height) return null;
  return [100*l/stage.width,100*t/stage.height,100*r/stage.width,100*b/stage.height];
}

export function createStageSafeAreaReader(stage) {
  const doc = stage.ownerDocument, win = doc.defaultView;
  const probe = doc.createElement('div');
  probe.setAttribute('aria-hidden','true');
  probe.style.cssText = 'position:fixed;inset:0 auto auto 0;width:0;height:0;visibility:hidden;pointer-events:none;contain:strict;' +
    'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  doc.documentElement.append(probe);
  return () => {
    const css = win.getComputedStyle(probe);
    return stageSafeInsets(stage.getBoundingClientRect(), {width:win.innerWidth,height:win.innerHeight}, {
      left:parseFloat(css.paddingLeft)||0, top:parseFloat(css.paddingTop)||0,
      right:parseFloat(css.paddingRight)||0, bottom:parseFloat(css.paddingBottom)||0
    });
  };
}
