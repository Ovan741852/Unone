// Runs inside Chromium through locator.evaluate. All measurements are in CSS pixels.
export function measure(root, actions) {
  const box = (r) => ({ x: r.x, y: r.y, w: r.width, h: r.height });
  const region = box(root.getBoundingClientRect());
  if (!region.w || !region.h) throw new Error('The selected element has an empty bounding box');
  const nodes = [],
    warnings = new Set(),
    bindings = Object.create(null);
  const textRuns = [],
    occupied = [];
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  function color(css) {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = 'transparent';
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data, (v) => v / 255);
  }
  function intersect(a, b) {
    const x = Math.max(a.x, b.x),
      y = Math.max(a.y, b.y);
    return {
      x,
      y,
      w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x),
      h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y)
    };
  }
  const unit = (value) => (Number.parseFloat(value) * 100) / region.h;
  const round = (value) => Number(value.toFixed(5));
  function append(node, bounds, clip, owners) {
    const part = intersect(bounds, clip);
    if (part.w < 0.05 || part.h < 0.05) return;
    const x = round(((part.x - region.x) * 100) / region.w),
      y = round(((region.y + region.h - part.y - part.h) * 100) / region.h);
    node.rect = {
      x,
      y,
      width: Math.min(100 - x, round((part.w * 100) / region.w)),
      height: Math.min(100 - y, round((part.h * 100) / region.h))
    };
    if (node.raster) node.raster.crop = { x: part.x - bounds.x, y: part.y - bounds.y, w: part.w, h: part.h };
    for (const name of owners) (bindings[name] ??= []).push(node.id);
    nodes.push(node);
    return part;
  }
  const boxProps = [
    'background-color',
    'background-image',
    'background-position',
    'background-size',
    'background-repeat',
    'background-origin',
    'background-clip',
    'background-blend-mode',
    'box-shadow',
    'outline',
    'outline-offset',
    ...['top', 'right', 'bottom', 'left'].map((s) => 'border-' + s),
    ...['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((s) => 'border-' + s + '-radius')
  ];
  function decoration(el, s, r) {
    const edges = ['Top', 'Right', 'Bottom', 'Left'];
    const unequal = edges.some((edge) => s['border' + edge] !== s.borderTop);
    const radii = [
      s.borderTopLeftRadius,
      s.borderTopRightRadius,
      s.borderBottomLeftRadius,
      s.borderBottomRightRadius
    ];
    const fancy =
      s.backgroundImage !== 'none' ||
      s.boxShadow !== 'none' ||
      unequal ||
      new Set(radii).size > 1 ||
      radii.some((value) => value.includes(' ') || value.includes('%')) ||
      (s.borderTopWidth !== '0px' && s.borderTopStyle !== 'solid') ||
      s.outlineStyle !== 'none';
    const style = { background: color(s.backgroundColor) };
    if (s.borderTopWidth !== '0px') {
      style.border_width = unit(s.borderTopWidth);
      style.border_color = color(s.borderTopColor);
    }
    if (parseFloat(radii[0])) style.border_radius = Math.min(100, unit(radii[0]));
    const css = Object.fromEntries(boxProps.map((k) => [k, s.getPropertyValue(k)]));
    const pad = { left: 0, right: 0, top: 0, bottom: 0 };
    for (const shadow of s.boxShadow.split(/,(?![^()]*\))/)) {
      if (shadow.includes('inset')) continue;
      const nums = Array.from(shadow.matchAll(/(-?[\d.]+)px/g), (m) => Number(m[1]));
      const [x = 0, y = 0, blur = 0, spread = 0] = nums;
      const ext = blur * 1.6 + spread;
      for (const [k, delta] of Object.entries({ left: -x, right: x, top: -y, bottom: y }))
        pad[k] = Math.max(pad[k], Math.ceil(ext + delta));
    }
    if (s.outlineStyle !== 'none') {
      const outline = Math.ceil(parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset));
      for (const k of Object.keys(pad)) pad[k] = Math.max(outline, pad[k]);
    }
    return { fancy, visible: style.background[3] > 0 || style.border_width > 0, style, css, pad };
  }
  function typography(s, opacity) {
    const px = Number.parseFloat(s.fontSize);
    const size = Math.min(100, unit(px));
    const family = s.fontFamily
      .split(',')[0]
      .trim()
      .replace(/^["']|["']$/g, '');
    const useProjectFamily = /^(system-ui|-apple-system|BlinkMacSystemFont|ui-sans-serif|sans-serif)$/i.test(
      family
    );
    return {
      font_size: size,
      ...(!useProjectFamily && family ? { font_family: family } : {}),
      font_weight: Math.min(900, Math.max(100, Math.round(Number(s.fontWeight) || 400))),
      color: color(s.color),
      line_height: Math.min(4, Math.max(0.5, parseFloat(s.lineHeight) / px || 1.2)),
      letter_spacing: Math.max(-10, Math.min(10, unit(s.letterSpacing) || 0)),
      text_align: 'start',
      vertical_align: 'middle',
      wrap: 'none',
      overflow: 'clip',
      opacity
    };
  }
  const range = document.createRange();
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  function contentRight(el, clip) {
    for (let owner = el; owner; owner = owner.parentElement) {
      const css = getComputedStyle(owner);
      if (css.display !== 'inline' && css.display !== 'contents') {
        return Math.min(
          clip.x + clip.w,
          owner.getBoundingClientRect().right -
            parseFloat(css.paddingRight) -
            parseFloat(css.borderRightWidth)
        );
      }
      if (owner === root) break;
    }
    return clip.x + clip.w;
  }
  function emitText(text, id, s, clip, opacity, owners) {
    const preserve = /pre|break-spaces/.test(s.whiteSpace);
    let run,
      serial = 0;
    function flush() {
      if (!run) return;
      let value = run.text;
      if (!preserve) value = value.replace(/\s+/gu, ' ');
      if (s.textTransform === 'uppercase') value = value.toLocaleUpperCase();
      if (s.textTransform === 'lowercase') value = value.toLocaleLowerCase();
      if (value.trim()) {
        const node = { kind: 'text', id: id + '-' + ++serial, text: value, style: typography(s, opacity) };
        const original = append(node, run.box, clip, owners);
        if (original) {
          occupied.push(original);
          if (s.direction === 'ltr' && s.writingMode === 'horizontal-tb') {
            textRuns.push({ node, original, end: contentRight(text.parentElement, clip) });
          }
        }
      }
      run = null;
    }
    for (const { segment, index } of segments.segment(text.data)) {
      range.setStart(text, index);
      range.setEnd(text, index + segment.length);
      const r = box(range.getBoundingClientRect());
      if (r.w < 0.01 || !intersect(r, clip).w || !intersect(r, clip).h) continue;
      if (run && (Math.abs(run.box.y - r.y) > 0.9 || Math.abs(run.box.h - r.h) > 0.9)) flush();
      if (!run) run = { text: '', box: r };
      else {
        const right = Math.max(run.box.x + run.box.w, r.x + r.w);
        run.box.x = Math.min(run.box.x, r.x);
        run.box.w = right - run.box.x;
      }
      run.text += segment;
    }
    flush();
  }
  const selectors = Object.entries(actions);
  for (const [sel] of selectors) root.matches(sel); // Fail early on an invalid selector.
  function visit(el, id, clip, ancestorOpacity, inheritedBindings) {
    const s = getComputedStyle(el);
    if (s.display === 'none') return;
    const opacity = ancestorOpacity * Number(s.opacity);
    if (!opacity) return;
    const r = box(el.getBoundingClientRect());
    const named = el.getAttribute('data-unone-bind');
    const owners = named ? [...inheritedBindings, named] : inheritedBindings;
    const visible = s.visibility === 'visible' && r.w > 0 && r.h > 0;
    const mapped = selectors.find(([sel]) => el.matches(sel))?.[1] ?? el.getAttribute('data-unone-action');
    const enabled =
      visible &&
      s.pointerEvents !== 'none' &&
      !el.matches(':disabled,[aria-disabled="true"]') &&
      !el.closest('[inert]');
    const action = enabled ? mapped : null;
    const d = decoration(el, s, r);
    const pseudo = ['::before', '::after'].some(
      (p) => !['none', 'normal', '""', "''"].includes(getComputedStyle(el, p).content)
    );
    if (pseudo)
      warnings.add(
        'Generated ::before/::after content needs an explicit DOM element for native text or imagery.'
      );
    if (s.transform !== 'none' && !/^matrix\(1, 0, 0, 1,/.test(s.transform))
      warnings.add('Rotations and non-axis-aligned CSS transforms use their measured bounding box.');
    if (s.filter !== 'none' || s.backdropFilter !== 'none')
      warnings.add('CSS filters and backdrop filters need native effects.');
    const isImage = el instanceof HTMLImageElement;
    if (visible && (action || isImage || d.visible || d.fancy || s.display.startsWith('inline')))
      occupied.push(intersect(r, clip));
    range.selectNodeContents(el);
    const isSimple =
      el.tagName === 'BUTTON' &&
      action &&
      !el.children.length &&
      !d.fancy &&
      !pseudo &&
      el.textContent.trim() &&
      range.getClientRects().length === 1 &&
      !el.innerText.includes('\n') &&
      el.scrollWidth <= el.clientWidth + 1;
    if (isSimple) {
      const style = {
        ...d.style,
        ...typography(s, opacity),
        text_align: { right: 'end', end: 'end', start: 'start', left: 'start' }[s.textAlign] || 'center'
      };
      style.padding = Object.fromEntries(
        ['top', 'right', 'bottom', 'left'].map((k) => [k, unit(s.getPropertyValue('padding-' + k))])
      );
      append(
        { kind: 'button', id: id + '-button', text: el.innerText.trim(), action, style },
        r,
        clip,
        owners
      );
      return;
    }
    if (visible && (d.fancy || isImage)) {
      const p = d.pad;
      const bounds = {
        x: r.x - p.left,
        y: r.y - p.top,
        w: r.w + p.left + p.right,
        h: r.h + p.top + p.bottom
      };
      const raster = { css: d.css, pad: p, w: r.w, h: r.h };
      const node = {
        kind: 'image',
        id: id + (isImage ? '-image' : '-decoration'),
        fit: 'stretch',
        style: { opacity },
        raster
      };
      if (isImage) {
        raster.src = el.currentSrc || el.src;
        raster.css['object-fit'] = s.objectFit;
        raster.css['object-position'] = s.objectPosition;
        node.alt = el.alt;
      } else node.background_for = { screen: true };
      append(node, bounds, clip, owners);
    } else if (visible && d.visible) {
      append(
        {
          kind: 'panel',
          id: id + '-panel',
          style: { ...d.style, opacity },
          background_for: { screen: true }
        },
        r,
        clip,
        owners
      );
    }
    // Native hit testing scans backwards. A nested mapped action must precede its parent under the finger.
    if (action) append({ kind: 'input_region', id: id + '-hit', action }, r, clip, owners);
    else if (enabled && el.matches('button,a[href],[role=button]'))
      warnings.add('Unmapped interactive elements have visuals only. Supply --actions or data-unone-action.');
    let contentClip = clip;
    if (s.display !== 'contents') {
      const horizontal = s.overflowX !== 'visible',
        vertical = s.overflowY !== 'visible';
      if (horizontal || vertical)
        contentClip = intersect(clip, {
          x: horizontal ? r.x : clip.x,
          y: vertical ? r.y : clip.y,
          w: horizontal ? r.w : clip.w,
          h: vertical ? r.h : clip.h
        });
    }
    if (!isImage && !el.matches('script,style,template,noscript')) {
      if (el.matches('canvas,video,iframe,svg,input,textarea,select'))
        warnings.add(
          'Embedded media, vector DOM and form controls require an authored native equivalent: ' +
            el.localName
        );
      else {
        const ordered = Array.from(el.childNodes, (child, i) => ({
          child,
          i,
          z: child.nodeType === 1 ? parseInt(getComputedStyle(child).zIndex) || 0 : 0
        })).sort((a, b) => a.z - b.z);
        for (const { child, i } of ordered) {
          if (child.nodeType === 1) visit(child, id + '-' + i, contentClip, opacity, owners);
          else if (child.nodeType === 3 && s.visibility === 'visible' && child.data.trim())
            emitText(child, id + '-text' + i, s, contentClip, opacity, owners);
        }
      }
    }
  }
  visit(root, 'dom', region, 1, []);
  // DOM ranges fit Chromium's glyph metrics exactly. A native font can be a few pixels wider.
  // Allocate only clear space on the same line and preserve the measured origin of every run.
  for (const { node, original, end } of textRuns) {
    let right = end;
    for (const other of occupied) {
      if (other.w <= 0 || other.h <= 0 || other.x <= original.x + 0.05 || other.x >= right) continue;
      const overlap = Math.min(original.y + original.h, other.y + other.h) - Math.max(original.y, other.y);
      if (overlap > Math.min(original.h, other.h) * 0.25) right = other.x;
    }
    const { rect } = node;
    rect.width = Math.max(rect.width, Math.min(100 - rect.x, round(((right - original.x) * 100) / region.w)));
  }
  return {
    width: region.w,
    height: region.h,
    bounds: { x: region.x, y: region.y, width: region.w, height: region.h },
    nodes,
    warnings: [...warnings],
    bindings
  };
}
