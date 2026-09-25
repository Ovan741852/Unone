const STORAGE_KEY = "unone-frame-atelier-editor-v3";
const OLLAMA_URL = "http://127.0.0.1:11435";
const OLLAMA_MODEL = "gemma4:e4b";
const HOST_API_URL = "/api/frame-atelier";
const PROFILES = {
  desktop: { label: "電腦", width: 1920, height: 1080 },
  mobile: { label: "手機", width: 390, height: 844 },
};
const TYPE_NAMES = { container: "Container", panel: "Panel", scrollview: "ScrollView", button: "Button", label: "Label", checkbox: "Checkbox", input: "Input", image: "Image", progressbar: "ProgressBar" };
const TYPE_ICONS = { container: "▦", panel: "▱", scrollview: "▤", button: "●", label: "T", checkbox: "✓", input: "▤", image: "▧", progressbar: "▰" };
const LAYOUT_NAMES = { free: "自由定位", horizontal: "水平排列", vertical: "垂直排列", grid: "格狀排列", overlay: "疊放" };
const DEFAULT_BUTTON_STYLE = { color: "#2e8f7b", radius: 8 };
const $ = (selector, root = document) => root.querySelector(selector);
const scene = $("#scene");
const artboard = $("#artboard");
const canvasScroll = $("#canvas-scroll");
const inspector = $("#inspector-content");
const tree = $("#element-tree");
const toast = $("#toast");

function sampleState() {
  const state = {
    project: { id: "yes-sir-loadout", name: "Yes Sir · 英雄裝備", buttonStyle: { ...DEFAULT_BUTTON_STYLE }, prefabs: [] },
    profile: "desktop",
    grid: true,
    tool: "select",
    zoom: 0,
    selectedId: "el-006",
    nextId: 20,
    elements: [],
    changeLog: [],
  };
  const add = (id, type, name, parentId, desktop, mobile, data = {}) => state.elements.push({
    id, type, name, parentId,
    purpose: data.purpose || "",
    text: data.text || "",
    placeholder: data.placeholder || "請輸入…",
    variant: data.variant || "primary",
    checked: data.checked ?? true,
    background: data.background || "",
    rects: { desktop: { ...desktop }, mobile: { ...mobile } },
  });
  add("el-001", "panel", "頂部導覽", null, { x: 3, y: 3, width: 94, height: 10 }, { x: 4, y: 2, width: 92, height: 8 }, { background: "#17252b" });
  add("el-002", "label", "遊戲標誌", "el-001", { x: 3, y: 22, width: 34, height: 48 }, { x: 3, y: 25, width: 48, height: 48 }, { text: "YES SIR　／　霧境要塞" });
  add("el-003", "label", "玩家資源", "el-001", { x: 68, y: 28, width: 19, height: 42 }, { x: 55, y: 27, width: 18, height: 46 }, { text: "金幣  12,480" });
  add("el-004", "button", "玩家等級", "el-001", { x: 84, y: 22, width: 13, height: 55 }, { x: 75, y: 24, width: 22, height: 52 }, { text: "LV.42", variant: "quiet" });
  add("el-005", "panel", "英雄資訊", null, { x: 3, y: 16, width: 58, height: 66 }, { x: 4, y: 12, width: 92, height: 34 }, { background: "#17252b" });
  add("el-006", "label", "英雄名稱", "el-005", { x: 43, y: 7, width: 51, height: 12 }, { x: 35, y: 23, width: 60, height: 12 }, { text: "RAVEN　渡鴉" });
  add("el-007", "image", "英雄立繪", "el-005", { x: 4, y: 21, width: 34, height: 70 }, { x: 5, y: 19, width: 26, height: 70 });
  add("el-008", "label", "英雄職業", "el-005", { x: 43, y: 23, width: 51, height: 8 }, { x: 35, y: 43, width: 60, height: 8 }, { text: "森林游擊隊　・　Lv.42" });
  add("el-009", "label", "戰力數值", "el-005", { x: 43, y: 45, width: 51, height: 13 }, { x: 35, y: 58, width: 60, height: 16 }, { text: "戰力  8,742　　裝備評分  A" });
  add("el-010", "checkbox", "自動比較", "el-005", { x: 43, y: 73, width: 48, height: 12 }, { x: 35, y: 80, width: 60, height: 12 }, { text: "比較裝備數值", checked: true });
  add("el-011", "panel", "裝備欄位", null, { x: 63, y: 16, width: 34, height: 43 }, { x: 4, y: 49, width: 92, height: 29 }, { background: "#1a262a" });
  add("el-012", "label", "裝備區標題", "el-011", { x: 5, y: 7, width: 90, height: 12 }, { x: 4, y: 7, width: 92, height: 15 }, { text: "裝備　　已穿戴 4 / 6" });
  add("el-013", "panel", "主武器槽", "el-011", { x: 5, y: 25, width: 90, height: 26 }, { x: 4, y: 27, width: 44, height: 57 }, { background: "#26373a", text: "霧影長弓　　攻擊 +18" });
  add("el-014", "panel", "護甲槽", "el-011", { x: 5, y: 57, width: 90, height: 26 }, { x: 52, y: 27, width: 44, height: 57 }, { background: "#26373a", text: "暮林皮甲　　防禦 +12" });
  add("el-015", "panel", "戰鬥數值", null, { x: 63, y: 61, width: 34, height: 21 }, { x: 4, y: 80, width: 92, height: 9 }, { background: "#19262b" });
  add("el-016", "label", "屬性摘要", "el-015", { x: 5, y: 14, width: 90, height: 72 }, { x: 4, y: 16, width: 92, height: 65 }, { text: "攻擊 164　　防禦 128　　暴擊 28%" });
  add("el-017", "panel", "主要操作列", null, { x: 3, y: 85, width: 94, height: 12 }, { x: 4, y: 91, width: 92, height: 7 }, { background: "#17252b" });
  add("el-018", "label", "操作說明", "el-017", { x: 3, y: 27, width: 65, height: 45 }, { x: 3, y: 25, width: 58, height: 50 }, { text: "配置確認後即可進入戰鬥" });
  add("el-019", "button", "進入戰鬥", "el-017", { x: 73, y: 17, width: 24, height: 67 }, { x: 69, y: 17, width: 28, height: 66 }, { text: "進入戰鬥", variant: "primary" });
  return state;
}
function normalizeChangeLog(entries) {
  return (Array.isArray(entries) ? entries : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item) && typeof item.summary === "string" && item.changes && typeof item.changes === "object")
    .slice(0, 100)
    .map((item) => ({ ...item, prompt: String(item.prompt || "").slice(0, 4000), response: String(item.response || "").slice(0, 2000), summary: item.summary.slice(0, 300) }));
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.elements && saved?.project) {
      const base = sampleState();
      return {
        ...base,
        ...saved,
        project: { ...base.project, ...saved.project, buttonStyle: { ...DEFAULT_BUTTON_STYLE, ...(saved.project.buttonStyle || {}) }, prefabs: saved.project.prefabs || [] },
        elements: saved.elements,
        changeLog: normalizeChangeLog(saved.changeLog),
      };
    }
  } catch { /* Keep the starter project available if a saved draft is damaged. */ }
  return sampleState();
}

let state = loadState();
let toastTimer = 0;
let drawing = null;
let pointerEdit = null;
let gemmaConnection = "checking";
let gemmaConnectionCheck = null;
let aiBusy = false;
const collapsedTreeIds = new Set();
let suppressPaletteClickUntil = 0;
let hostSession = null;
let hostPollBusy = false;
let saveTimer = 0;
let speech = null;
const undoStack = [];
const redoStack = [];
let lastHistorySnapshot = null;

function clone(value) { return structuredClone(value); }
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
}
function historySnapshot(source = state) {
  const fields = ["id", "type", "name", "parentId", "purpose", "text", "placeholder", "variant", "checked", "visible", "background", "value", "layoutMode", "gap", "padding", "columns", "contentLength", "order", "rects", "prefabId", "sourceId", "instanceGroupId", "sharedKey", "aiId", "aiRole"];
  return {
    project: { id: source.project.id, name: source.project.name, buttonStyle: clone(source.project.buttonStyle), prefabs: (source.project.prefabs || []).map(({ id, name }) => ({ id, name })) },
    profile: source.profile,
    elements: (source.elements || []).map((item) => Object.fromEntries(fields.filter((key) => item[key] !== undefined).map((key) => [key, clone(item[key])]))),
  };
}
function diffHistory(before, after) {
  const oldItems = new Map((before?.elements || []).map((item) => [item.id, item]));
  const newItems = new Map(after.elements.map((item) => [item.id, item]));
  const added = [...newItems.values()].filter((item) => !oldItems.has(item.id));
  const removed = [...oldItems.values()].filter((item) => !newItems.has(item.id));
  const updated = [];
  for (const [id, next] of newItems) {
    const previous = oldItems.get(id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(next)) updated.push({ before: previous, after: next });
  }
  const projectChanged = JSON.stringify(before?.project) !== JSON.stringify(after.project) || before?.profile !== after.profile;
  return { added, removed, updated, projectChanged };
}
function historySummary(changes) {
  const parts = [];
  if (changes.added.length) parts.push("新增 " + changes.added.length + " 個元件");
  if (changes.removed.length) parts.push("移除 " + changes.removed.length + " 個元件");
  if (changes.updated.length) parts.push("調整 " + changes.updated.length + " 個元件");
  if (changes.projectChanged) parts.push("更新專案／版面設定");
  return parts.join("、") || "沒有元件變更（保留這次 AI 指令與回覆）";
}
function appendHistory(entry) {
  const focus = entry.target || entry.changes?.added?.[0] || entry.changes?.updated?.[0]?.after || entry.changes?.removed?.[0];
  state.changeLog = [{
    id: "change-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
    at: new Date().toISOString(), projectId: state.project.id, projectName: state.project.name,
    source: entry.source || "manual", action: entry.action || "edit",
    target: focus ? { id: focus.id, type: focus.type, name: focus.name } : null,
    provider: entry.provider || "", status: entry.status || "applied",
    prompt: String(entry.prompt || "").slice(0, 4000), response: String(entry.response || "").slice(0, 2000),
    summary: entry.summary || historySummary(entry.changes || { added: [], removed: [], updated: [], projectChanged: false }),
    changes: entry.changes || { added: [], removed: [], updated: [], projectChanged: false },
  }, ...(state.changeLog || [])].slice(0, 100);
  renderChangeHistory();
}
function recordAIHistory(entry) {
  const current = historySnapshot();
  entry.changes = diffHistory(entry.before, current);
  entry.summary = historySummary(entry.changes);
  appendHistory(entry);
  lastHistorySnapshot = current;
  save();
}
function renderChangeHistory() {
  const list = $("#change-history-list");
  if (!list) return;
  const entries = (state.changeLog || []).filter((item) => !item.projectId || item.projectId === state.project.id).slice(0, 10);
  $("#change-history-count").textContent = String(entries.length);
  list.innerHTML = entries.length ? entries.map((entry) => {
    const time = new Date(entry.at).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const status = entry.status === "cancelled" ? " · 已取消" : entry.status === "no_change" ? " · 無變更" : entry.status === "error" ? " · 未連線／未送達" : "";
    const prompt = entry.prompt ? '<blockquote>' + escapeHTML(entry.prompt) + '</blockquote>' : "";
    const response = entry.response ? '<p class="change-entry-response">AI 判斷：' + escapeHTML(entry.response) + '</p>' : "";
    const changes = '<details><summary>查看變更資料</summary><pre>' + escapeHTML(JSON.stringify(entry.changes, null, 2)) + '</pre></details>';
    return '<article class="change-entry"><header><strong>' + escapeHTML(entry.source === "ai" ? "AI 協助" : "手動調整") + ' · ' + escapeHTML(entry.target?.name || entry.projectName || "介面") + '</strong><time>' + escapeHTML(time) + '</time></header><p>' + escapeHTML(entry.summary + status) + '</p>' + prompt + response + changes + '</article>';
  }).join("") : '<p class="change-history-empty">畫布修改與 AI 指令會記錄在這裡。</p>';
}
lastHistorySnapshot = historySnapshot();
function rememberUndo() {
  undoStack.push(clone(state));
  if (undoStack.length > 40) undoStack.shift();
  redoStack.length = 0;
  updateHistoryButtons();
}
function updateHistoryButtons() {
  $("#undo").disabled = undoStack.length === 0;
  $("#redo").disabled = redoStack.length === 0;
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(clone(state));
  const changeLog = state.changeLog || [];
  state = undoStack.pop();
  state.changeLog = changeLog;
  renderAll();
  save();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(clone(state));
  const changeLog = state.changeLog || [];
  state = redoStack.pop();
  state.changeLog = changeLog;
  renderAll();
  save();
}
function recordPendingHistory() {
  const current = historySnapshot();
  const changes = diffHistory(lastHistorySnapshot, current);
  const changed = changes.added.length || changes.removed.length || changes.updated.length || changes.projectChanged;
  if (changed) {
    appendHistory({ source: "manual", action: "edit", changes, summary: historySummary(changes) });
  }
  lastHistorySnapshot = current;
  return Boolean(changed);
}
function save() {
  recordPendingHistory();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { showToast("儲存空間不足，請先匯出專案"); }
  $("#save-state").textContent = "已儲存";
  $("#save-state").parentElement.classList.remove("is-saving");
  syncHostState();
}
function markUnsaved() {
  $("#save-state").textContent = "儲存中…";
  $("#save-state").parentElement.classList.add("is-saving");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 250);
}
function currentProfile() { return PROFILES[state.profile] || PROFILES.desktop; }
function getElement(id) { return state.elements.find((item) => item.id === id) || null; }
function getRect(element, profile = state.profile) {
  return element?.rects?.[profile] || element?.rects?.desktop || { x: 10, y: 10, width: 30, height: 15 };
}
function setRect(element, rect, profile = state.profile) {
  element.rects ||= {};
  const parent = getElement(element.parentId);
  element.rects[profile] = clampRect(rect, parent?.type === "scrollview" ? scrollContentLength(parent) : 100);
}
function clampRect(rect, maxHeight = 100) {
  const x = Math.max(0, Math.min(99, Number(rect.x) || 0));
  const y = Math.max(0, Math.min(maxHeight - 1, Number(rect.y) || 0));
  const width = Math.max(1, Math.min(100 - x, Number(rect.width) || 1));
  const height = Math.max(1, Math.min(maxHeight - y, Number(rect.height) || 1));
  return { x, y, width, height };
}
function childElements(parentId) {
  const items = state.elements.filter((item) => (item.parentId || null) === (parentId || null));
  if (!items.some((item) => Number.isFinite(Number(item.order)))) return items;
  return items.map((item, index) => ({ item, index }))
    .sort((a, b) => (Number.isFinite(Number(a.item.order)) ? Number(a.item.order) : a.index) - (Number.isFinite(Number(b.item.order)) ? Number(b.item.order) : b.index) || a.index - b.index)
    .map(({ item }) => item);
}
function isParentNode(element) { return ["panel", "container", "scrollview"].includes(element?.type); }
function scrollContentLength(element) { return Math.max(100, Math.min(500, Number(element?.contentLength) || 180)); }
function layoutRects(parent) {
  const children = childElements(parent.id);
  const base = children.map((child) => ({ child, rect: { ...getRect(child) } }));
  const mode = parent.layoutMode || "free";
  const gap = Math.max(0, Math.min(20, Number(parent.gap ?? 3)));
  const padding = Math.max(0, Math.min(20, Number(parent.padding ?? 4)));
  const inner = 100 - padding * 2;
  const result = new Map(base.map(({ child, rect }) => [child.id, rect]));
  if (!base.length || mode === "free" || mode === "overlay") return result;

  if (mode === "horizontal") {
    const available = Math.max(1, inner - gap * (base.length - 1));
    const total = base.reduce((sum, item) => sum + item.rect.width, 0);
    const scale = total > available ? available / total : 1;
    let x = padding;
    for (const { child, rect } of base) {
      const width = rect.width * scale;
      const height = Math.min(rect.height, inner);
      result.set(child.id, { x, y: padding + (inner - height) / 2, width, height });
      x += width + gap;
    }
  } else if (mode === "vertical") {
    const available = Math.max(1, inner - gap * (base.length - 1));
    const total = base.reduce((sum, item) => sum + item.rect.height, 0);
    const scale = total > available ? available / total : 1;
    let y = padding;
    for (const { child, rect } of base) {
      const height = rect.height * scale;
      const width = Math.min(rect.width, inner);
      result.set(child.id, { x: padding + (inner - width) / 2, y, width, height });
      y += height + gap;
    }
  } else if (mode === "grid") {
    const columns = Math.max(1, Math.min(6, Number(parent.columns) || 3));
    const rows = Math.ceil(base.length / columns);
    const cellWidth = (inner - gap * (columns - 1)) / columns;
    const cellHeight = (inner - gap * (rows - 1)) / rows;
    base.forEach(({ child }, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      result.set(child.id, { x: padding + column * (cellWidth + gap), y: padding + row * (cellHeight + gap), width: cellWidth, height: cellHeight });
    });
  }
  return result;
}
function displayRect(element) {
  const parent = getElement(element?.parentId);
  return parent?.type === "container" ? layoutRects(parent).get(element.id) || getRect(element) : getRect(element);
}
function parentSpaceRect(parent) {
  const rect = absoluteRect(parent);
  return { ...rect, height: rect.height * (parent?.type === "scrollview" ? scrollContentLength(parent) / 100 : 1) };
}
function isDescendant(candidateId, ancestorId) {
  let current = getElement(candidateId);
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    current = getElement(current.parentId);
  }
  return false;
}
function absoluteRect(element) {
  if (!element?.parentId) return { ...displayRect(element) };
  const parent = getElement(element.parentId);
  if (!parent) return { ...displayRect(element) };
  const outer = parentSpaceRect(parent);
  const inner = displayRect(element);
  return {
    x: outer.x + outer.width * inner.x / 100,
    y: outer.y + outer.height * inner.y / 100,
    width: outer.width * inner.width / 100,
    height: outer.height * inner.height / 100,
  };
}
function relativeRect(absolute, parent) {
  if (!parent) return clampRect(absolute);
  const outer = parentSpaceRect(parent);
  return clampRect({
    x: (absolute.x - outer.x) / outer.width * 100,
    y: (absolute.y - outer.y) / outer.height * 100,
    width: absolute.width / outer.width * 100,
    height: absolute.height / outer.height * 100,
  }, parent?.type === "scrollview" ? scrollContentLength(parent) : 100);
}
function setParent(element, parentId) {
  const parent = parentId ? getElement(parentId) : null;
  if (parentId && (!parent || !isParentNode(parent) || parent.id === element.id || isDescendant(parent.id, element.id))) return false;
  rememberUndo();
  const bounds = absoluteRect(element);
  element.parentId = parent?.id || null;
  setRect(element, relativeRect(bounds, parent));
  markUnsaved();
  renderAll();
  return true;
}
function newElement(type, options = {}) {
  const id = "el-" + String(state.nextId++).padStart(3, "0");
  const rect = options.rect || { x: 10, y: 12, width: ["panel", "container", "scrollview"].includes(type) ? 34 : 25, height: ["panel", "container", "scrollview"].includes(type) ? 28 : 10 };
  const mobileRect = options.mobileRect || rect;
  const parent = getElement(options.parentId);
  const contentLength = parent?.type === "scrollview" ? scrollContentLength(parent) : 100;
  const siblings = childElements(options.parentId || null);
  const siblingOrder = siblings.some((item) => Number.isFinite(Number(item.order)))
    ? Math.max(-1, ...siblings.map((item, index) => Number.isFinite(Number(item.order)) ? Number(item.order) : index)) + 1
    : undefined;
  return {
    id, type, name: options.name || (TYPE_NAMES[type] || "元件"),
    purpose: options.purpose || "", text: options.text || "", placeholder: options.placeholder || "請輸入…",
    parentId: options.parentId || null, variant: options.variant || "primary",
    checked: options.checked ?? true, visible: options.visible !== false, background: options.background || "",
    layoutMode: options.layoutMode || "free", gap: Number(options.gap ?? 3), padding: Number(options.padding ?? 4), columns: Number(options.columns ?? 3),
    value: Math.max(0, Math.min(100, Number(options.value ?? 68))), contentLength: scrollContentLength({ contentLength: options.contentLength }),
    ...(options.order !== undefined ? { order: Number(options.order) } : siblingOrder !== undefined ? { order: siblingOrder } : {}),
    aiId: options.aiId || "", aiRole: options.aiRole || "", sharedKey: options.sharedKey || "",
    prefabId: options.prefabId || "", sourceId: options.sourceId || "", instanceGroupId: options.instanceGroupId || "",
    rects: { desktop: clampRect(options.desktopRect || rect, contentLength), mobile: clampRect(options.mobileRect || mobileRect, contentLength) },
  };
}
function findOpenRect(parent, width, height) {
  if (parent?.type === "container" && !["free", "overlay"].includes(parent.layoutMode || "free")) {
    return { x: 4, y: 4, width, height };
  }
  const siblings = childElements(parent?.id).map((item) => getRect(item));
  const startY = parent?.type === "scrollview" ? 10 : parent ? 22 : 15;
  const maxY = parent?.type === "scrollview" ? scrollContentLength(parent) - 2 : 98;
  for (let y = startY; y + height <= maxY; y += 3) {
    for (let x = 4; x + width <= 98; x += 3) {
      const overlaps = siblings.some((rect) =>
        x < rect.x + rect.width + 1 && x + width + 1 > rect.x &&
        y < rect.y + rect.height + 1 && y + height + 1 > rect.y);
      if (!overlaps) return { x, y, width, height };
    }
  }
  return { x: 5, y: Math.max(startY, maxY - height), width, height };
}
function createElement(type, options = {}) {
  const hasExplicitParent = Object.prototype.hasOwnProperty.call(options, "parentId");
  const selected = getElement(state.selectedId);
  const selectedParent = isParentNode(selected) ? selected : getElement(selected?.parentId);
  const parent = hasExplicitParent
    ? (options.parentId ? getElement(options.parentId) : null)
    : (isParentNode(selectedParent) ? selectedParent : null);
  if (parent && !isParentNode(parent)) return;
  const defaults = {
    container: { width: 44, height: 36, name: "排列容器" },
    panel: { width: 44, height: 36, name: "新 Panel" },
    scrollview: { width: 34, height: 38, name: "ScrollView", contentLength: 180 },
    button: { width: 26, height: 13, name: "新 Button", text: "按鈕" },
    label: { width: 35, height: 9, name: "新 Label", text: "文字" },
    checkbox: { width: 30, height: 10, name: "新 Checkbox", text: "核取方塊" },
    input: { width: 34, height: 12, name: "新 Input", placeholder: "請輸入…" },
    image: { width: 24, height: 30, name: "新 Image" },
    progressbar: { width: 32, height: 8, name: "ProgressBar", value: 68 },
  }[type] || { width: 25, height: 12, name: "新元件" };
  const rect = options.rect || (
    Number.isFinite(options.x) || Number.isFinite(options.y)
      ? { x: Number(options.x) || 0, y: Number(options.y) || 0, width: defaults.width, height: defaults.height }
      : findOpenRect(parent, defaults.width, defaults.height)
  );
  rememberUndo();
  const element = newElement(type, {
    ...defaults, ...options,
    parentId: options.parentId ?? parent?.id ?? null,
    rect,
  });
  state.elements.push(element);
  state.selectedId = element.id;
  markUnsaved();
  renderAll();
  return element;
}
function selectElement(id) {
  state.selectedId = getElement(id)?.id || null;
  tree.querySelectorAll(".tree-row").forEach((row) => row.classList.toggle("is-selected", row.dataset.id === state.selectedId));
  scene.querySelectorAll(".scene-node").forEach((node) => {
    node.classList.toggle("is-selected", node.dataset.id === state.selectedId);
    node.querySelectorAll(":scope > .resize-handle").forEach((handle) => handle.remove());
  });
  const selectedNode = scene.querySelector('[data-node-id="' + CSS.escape(state.selectedId || "") + '"]');
  if (selectedNode) addResizeHandles(selectedNode);
  renderInspector();
  updateFooter();
  renderSelectionBadge();
  renderAIDock();
}
function renderSelectionBadge() {
  const element = getElement(state.selectedId);
  $("#selection-badge").textContent = element ? TYPE_NAMES[element.type] : "未選取";
}
function nodeFace(element) {
  const text = escapeHTML(element.text || element.name);
  if (element.type === "panel") {
    return '<div class="node-face">' + (element.variant === "strong" ? "" : '<span class="node-title">' + escapeHTML(element.name) + '</span><span class="node-subtitle">' + escapeHTML(element.purpose || "") + '</span>') + '</div>';
  }
  if (element.type === "container") {
    return '<div class="node-face container-face"></div>';
  }
  if (element.type === "scrollview") {
    return '<div class="node-face scrollview-face"><span class="node-title">ScrollView · 垂直</span></div>';
  }
  if (element.type === "progressbar") {
    const value = Math.max(0, Math.min(100, Number(element.value ?? 68)));
    return '<div class="node-face progress-face"><span class="progress-label">' + text + '</span><span class="progress-track"><i style="width:' + value + '%"></i></span></div>';
  }
  if (element.type === "button") return '<div class="node-face">' + text + '</div>';
  if (element.type === "checkbox") return '<div class="node-face"><span class="checkbox-box">' + (element.checked ? "✓" : "") + '</span><span>' + text + '</span></div>';
  if (element.type === "input") return '<div class="node-face">' + escapeHTML(element.placeholder || "請輸入…") + '</div>';
  if (element.type === "image" && element.variant === "watermark") return '<div class="node-face image-symbol-face"><svg class="image-symbol image-watermark" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.1 11.5V5.7a1.4 1.4 0 0 1 2.8 0v5.1V4.8a1.4 1.4 0 0 1 2.8 0v6V6a1.4 1.4 0 0 1 2.8 0v5.3V8.2a1.4 1.4 0 0 1 2.8 0v7.2a5.4 5.4 0 0 1-5.4 5.4h-2.1a5 5 0 0 1-4.2-2.2l-3-4.4a1.7 1.7 0 0 1 2.5-2.3l1.8 1.7z"/></svg></div>';
  if (element.type === "image" && element.variant === "icon") return '<div class="node-face image-symbol-face"><svg class="image-symbol image-item-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.5 8 4.3v10.4l-8 4.3-8-4.3V6.8l8-4.3Z"/><path d="m8 9 4-2.1L16 9v5.7l-4 2.2-4-2.2V9Z"/></svg></div>';
  if (element.type === "image") return '<div class="node-face"><span class="image-placeholder">✦</span><span class="image-caption">' + escapeHTML(element.name) + '</span></div>';
  return '<div class="node-face">' + text + '</div>';
}
function isAutoLayoutChild(element) {
  const parent = getElement(element?.parentId);
  return parent?.type === "container" && !["free", "overlay"].includes(parent.layoutMode || "free");
}
function addResizeHandles(node) {
  if (isAutoLayoutChild(getElement(node.dataset.nodeId))) return;
  for (const direction of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
    const handle = document.createElement("span");
    handle.className = "resize-handle resize-" + direction;
    handle.dataset.resize = direction;
    handle.setAttribute("aria-hidden", "true");
    node.append(handle);
  }
}
function renderSceneNode(element, z = 1) {
  const rect = displayRect(element);
  const node = document.createElement("div");
  node.className = "scene-node type-" + element.type + (element.variant ? " variant-" + element.variant : "") + (state.selectedId === element.id ? " is-selected" : "") + (element.visible === false ? " is-hidden" : "");
  node.dataset.nodeId = element.id;
  node.setAttribute("role", element.type === "button" ? "button" : "group");
  node.setAttribute("aria-label", element.name);
  node.style.cssText = "left:" + rect.x + "%;top:" + rect.y + "%;width:" + rect.width + "%;height:" + rect.height + "%;z-index:" + z + ";";
  if (element.background && element.type === "panel") node.style.setProperty("--node-bg", element.background);
  node.innerHTML = nodeFace(element);
  if (element.type === "scrollview") {
    const viewport = document.createElement("div");
    viewport.className = "scroll-viewport";
    viewport.setAttribute("aria-label", element.name + " 可捲動內容");
    const content = document.createElement("div");
    content.className = "scroll-content";
    content.style.height = scrollContentLength(element) + "%";
    for (const child of childElements(element.id)) content.append(renderSceneNode(child, z + 1));
    viewport.append(content);
    node.append(viewport);
  } else {
    for (const child of childElements(element.id)) node.append(renderSceneNode(child, z + 1));
  }
  if (state.selectedId === element.id) addResizeHandles(node);
  return node;
}
function renderScene() {
  scene.replaceChildren();
  const roots = state.elements.filter((item) => !getElement(item.parentId));
  roots.forEach((element, index) => scene.append(renderSceneNode(element, index + 1)));
  if (!roots.length) scene.innerHTML = '<div class="empty-scene-hint"><strong>從容器或 Panel 開始</strong><span>拖入元件、框選畫布，或用下方語音／文字描述</span></div>';
}
function renderTreeRows(parentId = null, depth = 0) {
  return childElements(parentId).map((element) => {
    const hasChildren = childElements(element.id).length > 0;
    const collapsed = collapsedTreeIds.has(element.id);
    const disclosure = hasChildren
      ? '<button class="tree-disclosure" type="button" data-tree-toggle="' + escapeHTML(element.id) + '" aria-label="' + (collapsed ? "展開「" : "收合「") + escapeHTML(element.name) + '」" aria-expanded="' + !collapsed + '" title="' + (collapsed ? "展開" : "收合") + '"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="' + (collapsed ? "m6 3 5 5-5 5" : "m3 6 5 5 5-5") + '" /></svg></button>'
      : '<span class="tree-disclosure-spacer" aria-hidden="true"></span>';
    const deleteLabel = hasChildren ? '刪除「' + escapeHTML(element.name) + '」及其子元件' : '刪除「' + escapeHTML(element.name) + '」';
    const isVisible = element.visible !== false;
    const visibilityLabel = (isVisible ? "隱藏「" : "顯示「") + escapeHTML(element.name) + "」";
    const children = hasChildren && !collapsed
      ? '<div class="tree-children" role="group">' + renderTreeRows(element.id, depth + 1) + '</div>'
      : "";
    return '<div class="tree-row' + (element.id === state.selectedId ? " is-selected" : "") + (isVisible ? "" : " is-hidden") + '" role="treeitem" aria-level="' + (depth + 1) + '" aria-selected="' + (element.id === state.selectedId) + '"' + (hasChildren ? ' aria-expanded="' + !collapsed + '"' : "") + ' draggable="true" data-id="' + escapeHTML(element.id) + '" data-type="' + element.type + '"><div class="tree-row-content">' + disclosure + '<button class="tree-select" type="button" data-select-tree="' + escapeHTML(element.id) + '" aria-label="選取「' + escapeHTML(element.name) + '」"><span class="tree-icon">' + (TYPE_ICONS[element.type] || "·") + '</span><span class="tree-name">' + escapeHTML(element.name) + '</span><span class="tree-type">' + TYPE_NAMES[element.type] + '</span></button><button class="tree-visibility" type="button" data-toggle-visibility="' + escapeHTML(element.id) + '" aria-pressed="' + isVisible + '" aria-label="' + visibilityLabel + '" title="' + visibilityLabel + '"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8s2.3-4 6.5-4 6.5 4 6.5 4-2.3 4-6.5 4-6.5-4-6.5-4Z"/><circle cx="8" cy="8" r="1.7"/>' + (isVisible ? "" : '<path d="m3 3 10 10"/>') + '</svg></button><button class="tree-delete" type="button" data-delete-node="' + escapeHTML(element.id) + '" aria-label="' + deleteLabel + '" title="' + deleteLabel + '"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 4.5h9m-7.5 0 .5 8h5l.5-8m-5-2h4m-3 4v4m2-4v4" /></svg></button></div>' + children + '</div>';
  }).join("");
}
function renderTree() {
  tree.innerHTML = renderTreeRows() || '<div class="prefab-empty">畫布還沒有元件。從上方拖入一個，或用下方描述新增。</div>';
}
function renderPrefabs() {
  const prefabs = state.project.prefabs || [];
  $("#prefab-count").textContent = String(prefabs.length);
  $("#prefab-list").innerHTML = prefabs.length
    ? prefabs.map((prefab) => '<div class="prefab-item"><strong title="' + escapeHTML(prefab.name) + '">' + escapeHTML(prefab.name) + '</strong><button class="prefab-insert" type="button" data-insert-prefab="' + escapeHTML(prefab.id) + '" title="加入畫布">＋</button></div>').join("")
    : '<p class="prefab-empty">選取一組元件，從右側存成可重用元件。</p>';
}
function parentOptions(element) {
  const parents = state.elements.filter((candidate) => isParentNode(candidate) && candidate.id !== element.id && !isDescendant(candidate.id, element.id));
  return '<option value="">畫布根層</option>' + parents.map((parent) => '<option value="' + escapeHTML(parent.id) + '"' + (parent.id === element.parentId ? " selected" : "") + '>' + escapeHTML(parent.name) + '</option>').join("");
}
function renderInspector() {
  const element = getElement(state.selectedId);
  if (!element) {
    inspector.innerHTML = '<div class="inspector-empty"><span class="inspector-empty-icon">⌖</span><strong>選取畫布上的元件</strong><span>拖曳移動、拉角調整大小，或修改下方共用按鈕樣式。</span></div>';
    renderSelectionBadge();
    return;
  }
  const rect = getRect(element);
  const parent = getElement(element.parentId);
  const autoLayout = isAutoLayoutChild(element);
  const maxY = parent?.type === "scrollview" ? scrollContentLength(parent) : 100;
  const backgroundField = element.type === "panel"
    ? '<label class="field-label">面板底色<input data-field="background" type="color" value="' + escapeHTML(element.background || "#17252b") + '"></label>'
    : "";
  const variantField = element.type === "button"
    ? '<label class="field-label">按鈕樣式<select data-field="variant"><option value="primary"' + (element.variant === "primary" ? " selected" : "") + '>主要</option><option value="secondary"' + (element.variant === "secondary" ? " selected" : "") + '>次要</option><option value="quiet"' + (element.variant === "quiet" ? " selected" : "") + '>低調</option></select></label>'
    : "";
  const textField = ["label", "button", "checkbox"].includes(element.type)
    ? '<label class="field-label">顯示文字<input data-field="text" value="' + escapeHTML(element.text) + '" placeholder="輸入畫面文字"></label>'
    : "";
  const placeholderField = element.type === "input"
    ? '<label class="field-label">提示文字<input data-field="placeholder" value="' + escapeHTML(element.placeholder) + '"></label>'
    : "";
  const checkField = element.type === "checkbox"
    ? '<label class="field-label check-property"><span>預設勾選</span><input data-field="checked" type="checkbox"' + (element.checked ? " checked" : "") + '></label>'
    : "";
  const visibilityField = '<label class="field-label check-property"><span>在畫布顯示</span><input data-field="visible" type="checkbox"' + (element.visible !== false ? " checked" : "") + '></label>';
  const imageVariantField = element.type === "image"
    ? '<label class="field-label">圖片呈現<select data-field="variant"><option value="secondary"' + (element.variant === "secondary" ? " selected" : "") + '>一般圖片</option><option value="icon"' + (element.variant === "icon" ? " selected" : "") + '>置中圖示</option><option value="watermark"' + (element.variant === "watermark" ? " selected" : "") + '>浮水印</option></select></label>'
    : "";
  const purposeField = isParentNode(element)
    ? '<label class="field-label">用途說明<textarea data-field="purpose" rows="2" placeholder="這個節點負責什麼？">' + escapeHTML(element.purpose) + '</textarea></label>'
    : "";
  const layoutField = element.type === "container"
    ? '<label class="field-label">子元件排列<select data-field="layoutMode">' + Object.entries(LAYOUT_NAMES).map(([key, label]) => '<option value="' + key + '"' + ((element.layoutMode || "free") === key ? " selected" : "") + '>' + label + '</option>').join("") + '</select></label>' +
      '<div class="geometry-grid"><label class="field-label">間距 %<input data-field="gap" type="number" min="0" max="20" step="0.5" value="' + Number(element.gap ?? 3) + '"></label>' +
      ((element.layoutMode === "grid") ? '<label class="field-label">欄數<input data-field="columns" type="number" min="1" max="6" step="1" value="' + Number(element.columns || 3) + '"></label>' : '<label class="field-label">內距 %<input data-field="padding" type="number" min="0" max="20" step="0.5" value="' + Number(element.padding ?? 4) + '"></label>') + '</div>'
    : "";
  const progressField = element.type === "progressbar"
    ? '<label class="field-label">目前進度 %<input data-field="value" type="number" min="0" max="100" step="1" value="' + Number(element.value ?? 68) + '"></label>'
    : "";
  const scrollField = element.type === "scrollview"
    ? '<label class="field-label">內容長度 %<input data-field="contentLength" type="number" min="100" max="500" step="10" value="' + scrollContentLength(element) + '"></label><p class="field-note">子元件放在內容區；預覽可直接捲動。</p>'
    : "";
  const linked = element.prefabId
    ? '<div class="linked-note">這是共用元件的連結實例。文字與外觀變更會同步到其他實例；大小可個別調整。</div>'
    : "";
  const panelAction = isParentNode(element)
    ? '<button class="inspector-action ai-panel-action" type="button" data-action="decompose">✳ Gemma 拆解這個容器</button>'
    : "";
  const geometryFields = autoLayout
    ? '<label class="field-label">寬<input data-field="width" type="number" min="1" max="100" step="0.1" value="' + rect.width.toFixed(1) + '"></label><label class="field-label">高<input data-field="height" type="number" min="1" max="100" step="0.1" value="' + rect.height.toFixed(1) + '"></label>'
    : '<label class="field-label">X<input data-field="x" type="number" min="0" max="100" step="0.1" value="' + rect.x.toFixed(1) + '"></label>' +
      '<label class="field-label">Y<input data-field="y" type="number" min="0" max="' + maxY + '" step="0.1" value="' + rect.y.toFixed(1) + '"></label>' +
      '<label class="field-label">寬<input data-field="width" type="number" min="1" max="100" step="0.1" value="' + rect.width.toFixed(1) + '"></label>' +
      '<label class="field-label">高<input data-field="height" type="number" min="1" max="' + maxY + '" step="0.1" value="' + rect.height.toFixed(1) + '"></label>';
  const siblings = childElements(element.parentId);
  const orderIndex = siblings.findIndex((item) => item.id === element.id);
  const orderControls = autoLayout
    ? '<div class="layout-order-controls"><span>排列順序</span><button type="button" data-action="order-up" aria-label="往前移"' + (orderIndex <= 0 ? ' disabled' : '') + '>↑ 往前</button><button type="button" data-action="order-down" aria-label="往後移"' + (orderIndex >= siblings.length - 1 ? ' disabled' : '') + '>↓ 往後</button></div>'
    : "";
  inspector.innerHTML =
    '<div class="inspector-form">' +
      '<label class="field-label">名稱<input data-field="name" value="' + escapeHTML(element.name) + '" maxlength="48"></label>' +
      textField + purposeField + layoutField + progressField + scrollField + placeholderField + visibilityField + checkField + imageVariantField + variantField + backgroundField +
      '<hr class="inspector-separator">' +
      '<label class="field-label">父節點<select data-field="parentId">' + parentOptions(element) + '</select></label>' +
      (autoLayout ? '<p class="field-note">位置由 Container 自動排列；可調整大小與順序。</p>' : '') + orderControls +
      '<div class="field-group-heading"><span>位置與大小</span><span class="unit-label">' + (parent?.type === "scrollview" ? '相對於捲動內容 %' : '相對於父節點 %') + '</span></div>' +
      '<div class="geometry-grid">' +
        geometryFields +
      '</div>' +
      linked + panelAction +
      '<div class="inspector-button-row">' +
        '<button class="inspector-action secondary" type="button" data-action="duplicate">複製</button>' +
        '<button class="inspector-action" type="button" data-action="save-prefab">存成共用元件</button>' +
      '</div>' +
      (element.prefabId ? '<button class="inspector-action secondary" type="button" data-action="unlink">解除共用</button>' : "") +
      '<button class="inspector-action danger" type="button" data-action="delete">刪除元件</button>' +
    '</div>';
  renderSelectionBadge();
}
function applyTheme() {
  document.documentElement.style.setProperty("--button-color", state.project.buttonStyle.color || DEFAULT_BUTTON_STYLE.color);
  document.documentElement.style.setProperty("--button-radius", (Number(state.project.buttonStyle.radius) || 0) + "px");
  $("#button-color").value = state.project.buttonStyle.color || DEFAULT_BUTTON_STYLE.color;
  $("#button-radius").value = Number(state.project.buttonStyle.radius) || 0;
}
function renderProfile() {
  const profile = currentProfile();
  artboard.dataset.profile = state.profile;
  document.querySelectorAll(".profile-button[data-profile]").forEach((button) => button.classList.toggle("is-active", button.dataset.profile === state.profile));
  $("#canvas-size").textContent = profile.width + " × " + profile.height;
  $("#project-name").value = state.project.name;
  $("#canvas-scroll").classList.toggle("show-grid", state.grid);
  $("#toggle-grid").setAttribute("aria-pressed", String(state.grid));
  document.querySelectorAll("[data-tool]").forEach((button) => button.classList.toggle("is-active", button.dataset.tool === state.tool));
}
function updateBoardSize() {
  const profile = currentProfile();
  const availableWidth = Math.max(200, canvasScroll.clientWidth - 68);
  const availableHeight = Math.max(160, canvasScroll.clientHeight - 82);
  const ratio = profile.width / profile.height;
  const fitWidth = Math.min(availableWidth, availableHeight * ratio);
  const zoom = state.zoom || 1;
  artboard.style.width = Math.round(fitWidth * zoom) + "px";
  $("#zoom-value").textContent = state.zoom ? Math.round(state.zoom * 100) + "%" : "適合視窗";
}
function updateFooter() {
  const element = getElement(state.selectedId);
  const rect = element ? absoluteRect(element) : null;
  $("#selection-size").textContent = rect ? (Math.round(rect.width * currentProfile().width / 100) + " × " + Math.round(rect.height * currentProfile().height / 100) + " px") : "尚未選取";
}
function renderAIDock() {
  const target = getElement(state.selectedId);
  const scoped = isParentNode(target);
  const dock = $(".ai-dock");
  $("#ai-dock-title").textContent = scoped ? "修改「" + target.name + "」" : "描述整個介面";
  $("#ai-status").textContent = aiBusy ? "Gemma 4 正在處理…" : gemmaConnection === "offline" ? "Gemma 4 未連線" : gemmaConnection === "checking" ? "正在檢查 Gemma 4…" : "Gemma 4 已連線";
  $("#ai-status").dataset.state = gemmaConnection;
  $("#ai-status").title = gemmaConnection === "offline" ? "輸入可以保留，但 AI 不會產生結果；啟動本機 Ollama Gemma 4 後按重試連線。" : "Ollama Gemma 4 本機模型服務狀態";
  dock.dataset.gemmaState = gemmaConnection;
  $("#ai-retry").hidden = gemmaConnection !== "offline" || aiBusy;
  $("#ai-submit").disabled = aiBusy || gemmaConnection !== "online";
  document.querySelectorAll('[data-action="decompose"]').forEach((button) => { button.disabled = aiBusy || gemmaConnection !== "online"; });
  $("#ai-prompt").placeholder = gemmaConnection === "offline"
    ? "Gemma 4 未連線；描述會保留在這裡，連線後再送出。"
    : scoped
      ? "例如：這是道具卡片，上方放 Icon，下方放名稱與說明"
      : "描述整個畫面，例如：做一個英雄裝備頁面，重點是快速比較裝備";
  $("#ai-submit-label").textContent = aiBusy ? "AI 處理中…" : gemmaConnection !== "online" ? (gemmaConnection === "checking" ? "檢查連線…" : "未連線") : scoped ? "修改此容器" : "安排畫面";
}
function renderAll() {
  $("#project-name").value = state.project.name;
  renderProfile();
  applyTheme();
  renderScene();
  renderTree();
  renderPrefabs();
  renderInspector();
  updateFooter();
  updateBoardSize();
  updateHistoryButtons();
  renderAIDock();
  renderChangeHistory();
}
function setProfile(profile) {
  if (!PROFILES[profile] || profile === state.profile) return;
  rememberUndo();
  state.profile = profile;
  markUnsaved();
  renderAll();
}
function setTool(tool) {
  state.tool = tool;
  renderProfile();
  $("#canvas-message").textContent = tool === "draw" ? "在畫布空白處拖曳，建立一個 Panel" : "拖曳移動；自動排列的子元件請在右側調整大小與順序";
}
function updateElementStyle(element) {
  const node = scene.querySelector('[data-node-id="' + CSS.escape(element.id) + '"]');
  if (!node) return;
  node.className = "scene-node type-" + element.type + (element.variant ? " variant-" + element.variant : "") + (state.selectedId === element.id ? " is-selected" : "") + (element.visible === false ? " is-hidden" : "");
  if (element.background && element.type === "panel") node.style.setProperty("--node-bg", element.background);
  else node.style.removeProperty("--node-bg");
  const face = node.querySelector(":scope > .node-face");
  if (face) face.outerHTML = nodeFace(element);
}
function updateSharedValue(element, key, value) {
  const keys = ["name", "text", "purpose", "placeholder", "variant", "checked", "visible", "background"];
  if (!element.prefabId && !element.sharedKey) return;
  const same = (item) => item !== element && ((element.prefabId && item.prefabId === element.prefabId && item.sourceId === element.sourceId) || (element.sharedKey && item.sharedKey === element.sharedKey));
  for (const item of state.elements.filter(same)) {
    if (keys.includes(key)) item[key] = value;
    updateElementStyle(item);
  }
  if (element.prefabId) {
    const prefab = state.project.prefabs.find((entry) => entry.id === element.prefabId);
    const source = prefab?.nodes.find((entry) => entry.id === element.sourceId);
    if (source && keys.includes(key)) source[key] = value;
  }
}
function reflectRect(element) {
  const node = scene.querySelector('[data-node-id="' + CSS.escape(element.id) + '"]');
  if (node) {
    const rect = displayRect(element);
    node.style.left = rect.x + "%";
    node.style.top = rect.y + "%";
    node.style.width = rect.width + "%";
    node.style.height = rect.height + "%";
  }
  for (const key of ["x", "y", "width", "height"]) {
    const input = inspector.querySelector('[data-field="' + key + '"]');
    if (input && document.activeElement !== input) input.value = getRect(element)[key].toFixed(1);
  }
  updateFooter();
}
function handleInspectorInput(event) {
  const field = event.target.dataset.field;
  const element = getElement(state.selectedId);
  if (!field) return;
  if (!element && field !== "button-color" && field !== "button-radius") return;
  if (field === "parentId") return;
  if (["x", "y", "width", "height"].includes(field)) {
    const rect = { ...getRect(element), [field]: Number(event.target.value) };
    setRect(element, rect);
    if (isAutoLayoutChild(element)) { renderScene(); updateFooter(); }
    else reflectRect(element);
    markUnsaved();
    return;
  }
  const numericFields = ["gap", "padding", "columns", "value", "contentLength"];
  let value = ["checked", "visible"].includes(field) ? event.target.checked : numericFields.includes(field) ? Number(event.target.value) : event.target.value;
  if (field === "contentLength") value = Math.max(100, Math.min(500, value || 100));
  if (["gap", "padding"].includes(field)) value = Math.max(0, Math.min(20, value || 0));
  if (field === "columns") value = Math.max(1, Math.min(6, value || 1));
  if (field === "value") value = Math.max(0, Math.min(100, value || 0));
  element[field] = value;
  updateSharedValue(element, field, value);
  if (["layoutMode", "gap", "padding", "columns", "contentLength"].includes(field)) {
    renderScene();
    addResizeHandlesOnly();
    updateFooter();
  } else updateElementStyle(element);
  if (field === "name" || field === "visible") renderTree();
  markUnsaved();
}
function handleInspectorChange(event) {
  const field = event.target.dataset.field;
  const element = getElement(state.selectedId);
  if (!field || !element) return;
  if (field === "parentId") {
    if (!setParent(element, event.target.value || null)) showToast("請選擇有效的容器節點");
    return;
  }
  if (["x", "y", "width", "height"].includes(field)) {
    setRect(element, { ...getRect(element), [field]: Number(event.target.value) });
    reflectRect(element);
    markUnsaved();
  }
}
function updateGlobalButtonStyle(field, value) {
  rememberUndo();
  state.project.buttonStyle[field] = value;
  applyTheme();
  markUnsaved();
}
function getNodeElement(id) { return scene.querySelector('[data-node-id="' + CSS.escape(id) + '"]'); }
function nearestParentForNode(node) {
  let element = node ? getElement(node.dataset.nodeId) : null;
  while (element && !isParentNode(element)) element = getElement(element.parentId);
  return element;
}
function beginPointerEdit(event) {
  if (event.button !== 0 || state.tool !== "select") return;
  const handle = event.target.closest(".resize-handle");
  const node = event.target.closest(".scene-node");
  if (!node) {
    if (event.target.closest(".drop-hint")) return;
    if (state.selectedId) { state.selectedId = null; selectElement(null); }
    return;
  }
  const element = getElement(node.dataset.nodeId);
  if (!element) return;
  if (element.type === "scrollview" && event.target.closest(".scroll-viewport")?.closest(".scene-node") === node) {
    selectElement(element.id);
    return;
  }
  if (isAutoLayoutChild(element)) {
    selectElement(element.id);
    showToast("位置由父 Container 自動排列；可調整寬高或切換自由定位");
    return;
  }
  rememberUndo();
  selectElement(element.id);
  event.preventDefault();
  scene.setPointerCapture(event.pointerId);
  const parentNode = element.parentId ? getNodeElement(element.parentId) : scene;
  const scrollContent = parentNode?.querySelector(":scope > .scroll-viewport > .scroll-content");
  const parentRect = (scrollContent || parentNode || scene).getBoundingClientRect();
  pointerEdit = {
    pointerId: event.pointerId, id: element.id, kind: handle ? "resize" : "move",
    direction: handle?.dataset.resize || "", x: event.clientX, y: event.clientY,
    rect: { ...getRect(element) }, parentWidth: parentRect.width, parentHeight: parentRect.height, changed: false,
  };
}
function movePointerEdit(event) {
  if (!pointerEdit || pointerEdit.pointerId !== event.pointerId) return;
  const element = getElement(pointerEdit.id);
  if (!element) return;
  const dx = (event.clientX - pointerEdit.x) / pointerEdit.parentWidth * 100;
  const dy = (event.clientY - pointerEdit.y) / pointerEdit.parentHeight * 100;
  const base = pointerEdit.rect;
  let rect = { ...base };
  if (pointerEdit.kind === "move") {
    rect.x += dx; rect.y += dy;
  } else {
    const dir = pointerEdit.direction;
    if (dir.includes("e")) rect.width += dx;
    if (dir.includes("s")) rect.height += dy;
    if (dir.includes("w")) { rect.x += dx; rect.width -= dx; }
    if (dir.includes("n")) { rect.y += dy; rect.height -= dy; }
  }
  setRect(element, rect);
  reflectRect(element);
  pointerEdit.changed ||= Math.abs(dx) + Math.abs(dy) > 0.05;
}
function endPointerEdit(event) {
  if (pointerEdit && pointerEdit.pointerId === event.pointerId) {
    if (pointerEdit.changed) {
      markUnsaved();
      renderTree();
      $("#canvas-message").textContent = "位置已更新　·　可按 Ctrl+Z 復原";
    }
    pointerEdit = null;
  }
}
function startDraw(event) {
  if (state.tool !== "draw" || event.button !== 0 || event.target.closest(".scene-node")) return;
  event.preventDefault();
  const rect = scene.getBoundingClientRect();
  const point = { x: (event.clientX - rect.left) / rect.width * 100, y: (event.clientY - rect.top) / rect.height * 100 };
  drawing = { x: point.x, y: point.y, rect };
  let preview = $("#draw-preview", scene);
  if (!preview) { preview = document.createElement("div"); preview.id = "draw-preview"; preview.className = "draw-preview"; scene.append(preview); }
  artboard.setPointerCapture(event.pointerId);
}
function moveDraw(event) {
  if (!drawing) return;
  const rect = drawing.rect;
  const x = (event.clientX - rect.left) / rect.width * 100;
  const y = (event.clientY - rect.top) / rect.height * 100;
  const box = { x: Math.min(x, drawing.x), y: Math.min(y, drawing.y), width: Math.abs(x - drawing.x), height: Math.abs(y - drawing.y) };
  const preview = $("#draw-preview", scene);
  if (preview) preview.style.cssText = "left:" + box.x + "%;top:" + box.y + "%;width:" + box.width + "%;height:" + box.height + "%";
}
function endDraw(event) {
  if (!drawing) return;
  const rect = drawing.rect;
  const x = (event.clientX - rect.left) / rect.width * 100;
  const y = (event.clientY - rect.top) / rect.height * 100;
  const box = { x: Math.min(x, drawing.x), y: Math.min(y, drawing.y), width: Math.abs(x - drawing.x), height: Math.abs(y - drawing.y) };
  $("#draw-preview", scene)?.remove();
  drawing = null;
  if (box.width > 2 && box.height > 2) createElement("panel", { rect: clampRect(box), name: "新 Panel" });
  else showToast("拖曳一段範圍即可新增 Panel");
  setTool("select");
}
function addResizeHandlesOnly() {
  scene.querySelectorAll(".scene-node").forEach((node) => {
    node.classList.toggle("is-selected", node.dataset.nodeId === state.selectedId);
    node.querySelectorAll(":scope > .resize-handle").forEach((handle) => handle.remove());
  });
  const selected = state.selectedId ? getNodeElement(state.selectedId) : null;
  if (selected) addResizeHandles(selected);
}
function renderTreeSelection() {
  tree.querySelectorAll(".tree-row").forEach((row) => row.classList.toggle("is-selected", row.dataset.id === state.selectedId));
}
function duplicateElement(id) {
  const source = getElement(id);
  if (!source) return;
  rememberUndo();
  const descendants = [];
  const collect = (parentId) => childElements(parentId).forEach((item) => { descendants.push(item); collect(item.id); });
  descendants.push(source);
  const ordered = [source, ...descendants.filter((item) => item.id !== source.id)];
  const ids = new Map(ordered.map((item) => [item.id, "el-" + String(state.nextId++).padStart(3, "0")]));
  const copies = ordered.map((item) => {
    const copy = clone(item);
    copy.id = ids.get(item.id);
    copy.parentId = item.id === source.id ? source.parentId : ids.get(item.parentId);
    copy.prefabId = ""; copy.sourceId = ""; copy.instanceGroupId = "";
    copy.sharedKey = "";
    for (const profile of Object.keys(PROFILES)) {
      if (item.id === source.id) {
        copy.rects[profile] = { ...item.rects[profile], x: Math.min(100 - item.rects[profile].width, item.rects[profile].x + 3), y: Math.min(100 - item.rects[profile].height, item.rects[profile].y + 3) };
      }
    }
    return copy;
  });
  state.elements.push(...copies);
  state.selectedId = ids.get(source.id);
  markUnsaved();
  renderAll();
}
function deleteElement(id) {
  const element = getElement(id);
  if (!element) return;
  rememberUndo();
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of state.elements) if (ids.has(item.parentId) && !ids.has(item.id)) { ids.add(item.id); changed = true; }
  }
  const removedCount = ids.size;
  ids.forEach((removedId) => collapsedTreeIds.delete(removedId));
  state.elements = state.elements.filter((item) => !ids.has(item.id));
  state.selectedId = element.parentId || null;
  markUnsaved();
  renderAll();
  showToast(removedCount > 1
    ? '已刪除「' + element.name + '」及 ' + (removedCount - 1) + ' 個子元件，可按 Ctrl+Z 復原'
    : '已刪除「' + element.name + '」，可按 Ctrl+Z 復原');
}
function moveChildOrder(id, direction) {
  const element = getElement(id);
  if (!element?.parentId || !isAutoLayoutChild(element)) return;
  const siblings = childElements(element.parentId);
  const from = siblings.findIndex((item) => item.id === id);
  const to = Math.max(0, Math.min(siblings.length - 1, from + direction));
  if (from === to) return;
  rememberUndo();
  [siblings[from], siblings[to]] = [siblings[to], siblings[from]];
  siblings.forEach((item, index) => { item.order = index; });
  markUnsaved();
  renderAll();
}
function savePrefab(id) {
  const source = getElement(id);
  if (!source) return;
  const prefabName = window.prompt("共用元件名稱", source.name);
  if (!prefabName?.trim()) return;
  rememberUndo();
  const subtree = [];
  const collect = (parentId) => childElements(parentId).forEach((item) => { subtree.push(item); collect(item.id); });
  subtree.push(source);
  const ordered = [source, ...subtree.filter((item) => item.id !== source.id)];
  const templateIdMap = new Map(ordered.map((item, index) => [item.id, "p" + (index + 1)]));
  const prefab = {
    id: "prefab-" + Date.now().toString(36),
    name: prefabName.trim(),
    rootId: templateIdMap.get(source.id),
    nodes: ordered.map((item) => {
      const copy = clone(item);
      copy.id = templateIdMap.get(item.id);
      copy.parentId = item.id === source.id ? null : templateIdMap.get(item.parentId);
      copy.prefabId = ""; copy.sourceId = ""; copy.instanceGroupId = "";
      return copy;
    }),
  };
  state.project.prefabs.push(prefab);
  const groupId = "instance-" + Date.now().toString(36);
  for (const item of ordered) {
    item.prefabId = prefab.id;
    item.sourceId = templateIdMap.get(item.id);
    item.instanceGroupId = groupId;
  }
  markUnsaved();
  renderAll();
  showToast("已加入共用元件庫；之後插入的實例會同步文字與外觀");
}
function insertPrefab(prefabId) {
  const prefab = state.project.prefabs.find((item) => item.id === prefabId);
  if (!prefab) return;
  const selected = getElement(state.selectedId);
  const selectedParent = isParentNode(selected) ? selected : getElement(selected?.parentId);
  const parent = isParentNode(selectedParent) ? selectedParent : null;
  const templateRoot = prefab.nodes.find((item) => item.id === prefab.rootId);
  if (!templateRoot) return;
  rememberUndo();
  const groupId = "instance-" + Date.now().toString(36);
  const idMap = new Map(prefab.nodes.map((item) => [item.id, "el-" + String(state.nextId++).padStart(3, "0")]));
  const copies = prefab.nodes.map((item) => {
    const copy = clone(item);
    copy.id = idMap.get(item.id);
    copy.parentId = item.id === prefab.rootId ? (parent?.id || null) : idMap.get(item.parentId);
    copy.prefabId = prefab.id;
    copy.sourceId = item.id;
    copy.instanceGroupId = groupId;
    const rootRect = clone(item.rects?.[state.profile] || item.rects?.desktop || { x: 10, y: 10, width: 30, height: 15 });
    if (item.id === prefab.rootId) {
      rootRect.x = Math.min(100 - rootRect.width, rootRect.x + 4);
      rootRect.y = Math.min(100 - rootRect.height, rootRect.y + 4);
    }
    copy.rects = clone(item.rects);
    if (item.id === prefab.rootId) copy.rects[state.profile] = rootRect;
    return copy;
  });
  state.elements.push(...copies);
  state.selectedId = idMap.get(prefab.rootId);
  markUnsaved();
  renderAll();
}
function unlinkPrefab(id) {
  const element = getElement(id);
  if (!element?.prefabId) return;
  rememberUndo();
  const group = element.instanceGroupId;
  for (const item of state.elements) {
    if (group && item.instanceGroupId === group) {
      item.prefabId = ""; item.sourceId = ""; item.instanceGroupId = "";
    }
  }
  element.prefabId = ""; element.sourceId = ""; element.instanceGroupId = "";
  markUnsaved();
  renderAll();
  showToast("這組元件已解除共用連結");
}
function renderCanvasSelection() {
  renderTreeSelection();
  addResizeHandlesOnly();
  renderInspector();
  renderSelectionBadge();
  updateFooter();
  renderAIDock();
}
function handleInspectorAction(action) {
  const element = getElement(state.selectedId);
  if (!element) return;
  if (action === "duplicate") duplicateElement(element.id);
  if (action === "order-up") moveChildOrder(element.id, -1);
  if (action === "order-down") moveChildOrder(element.id, 1);
  if (action === "delete") deleteElement(element.id);
  if (action === "save-prefab") savePrefab(element.id);
  if (action === "unlink") unlinkPrefab(element.id);
  if (action === "decompose") decomposePanel(element.id);
}
function roleToType(role) {
  if (role === "button") return "button";
  if (["image", "icon", "illustration"].includes(role)) return "image";
  if (role === "input") return "input";
  if (role === "checkbox") return "checkbox";
  if (["progress", "progressbar"].includes(role)) return "progressbar";
  if (["scroll", "scrollview", "scroll_view"].includes(role)) return "scrollview";
  if (["container", "layout", "layout_group"].includes(role)) return "container";
  return "label";
}
function panelRegistry(parentId = null) {
  return childElements(parentId).map((element) => ({
    id: element.aiId || element.id, parentId: element.parentId || null, label: element.name,
    kind: element.type, purpose: element.purpose || "", rect: displayRect(element),
    visible: element.visible !== false, variant: element.variant,
    children: panelRegistry(element.id),
  }));
}
function requestedContainerIdentity(instruction) {
  const match = instruction.match(/(?:這是|這個是|這張是)\s*([^，,。；;\n]+?)(?=\s*(?:上方|下方|上面|下面|裡面|包含|要|想要)|[，,。；;\n]|$)/);
  return match?.[1]?.trim().slice(0, 36) || "";
}
function requestedContainerPurpose(identity, instruction) {
  const request = instruction.toLowerCase();
  if (/icon|圖示|圖標/.test(request) && /文字|名稱|說明|label|text/.test(request)) {
    return identity + "；上方呈現圖示，下方顯示名稱或簡短說明。";
  }
  return instruction.trim().slice(0, 160);
}
async function requestGemma(messages, { format, maxTokens }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const body = { model: OLLAMA_MODEL, stream: false, think: false, options: { temperature: 0.2, num_predict: maxTokens }, messages };
    if (format) body.format = format;
    const response = await fetch(OLLAMA_URL + "/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: controller.signal,
    });
    if (!response.ok) throw new Error("OLLAMA_HTTP_" + response.status);
    const envelope = await response.json();
    const content = envelope?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("OLLAMA_EMPTY_CONTENT");
    return content;
  } finally {
    clearTimeout(timeout);
  }
}
async function callGemma(payload) {
  const rectSchema = {
    type: "object", additionalProperties: false,
    properties: {
      x: { type: "number", minimum: 0, maximum: 100 },
      y: { type: "number", minimum: 0, maximum: 100 },
      width: { type: "number", minimum: 1, maximum: 100 },
      height: { type: "number", minimum: 1, maximum: 100 },
    },
    required: ["x", "y", "width", "height"],
  };
  const nodeSchema = (depth = 0) => {
    const properties = {
      id: { type: "string", maxLength: 64 },
      role: { type: "string", enum: ["container", "panel", "scrollview", "button", "label", "text", "checkbox", "input", "image", "icon", "illustration", "progress", "progressbar", "scroll", "scroll_view", "layout", "layout_group"] },
      label: { type: "string", maxLength: 48 }, text: { type: "string", maxLength: 80 }, purpose: { type: "string", maxLength: 120 }, rect: rectSchema,
      visible: { type: "boolean" }, variant: { type: "string", enum: ["primary", "secondary", "strong", "quiet", "icon", "watermark"] },
      layout: {
        type: "object", additionalProperties: false,
        properties: {
          mode: { type: "string", enum: ["free", "horizontal", "vertical", "grid", "overlay"] },
          gap: { type: "number", minimum: 0, maximum: 20 }, padding: { type: "number", minimum: 0, maximum: 20 },
        },
        required: ["mode", "gap", "padding"],
      },
    };
    if (depth < 4) properties.children = { type: "array", maxItems: 12, items: nodeSchema(depth + 1) };
    return { type: "object", additionalProperties: false, properties, required: ["id", "role", "label", "purpose", "rect"] };
  };
  const outputSchema = payload.stage === "panel_plan"
    ? {
        type: "object", additionalProperties: false,
        properties: {
          analysis: { type: "string", maxLength: 160 },
          panels: {
            type: "array", minItems: 1, maxItems: 6,
            items: {
              type: "object", additionalProperties: false,
              properties: {
                id: { type: "string", maxLength: 48 }, label: { type: "string", maxLength: 48 },
                purpose: { type: "string", maxLength: 160 },
                role: { type: "string", enum: ["header", "navigation", "content", "support", "actions", "status"] },
                rect: rectSchema,
              },
              required: ["id", "label", "purpose", "role", "rect"],
            },
          },
        },
        required: ["analysis", "panels"],
      }
    : {
        type: "object", additionalProperties: false,
        properties: {
          analysis: { type: "string", maxLength: 160 },
          panel_update: {
            type: "object", additionalProperties: false,
            properties: {
              name: { type: "string", maxLength: 48 }, purpose: { type: "string", maxLength: 200 },
              type: { type: "string", enum: ["container", "panel"] },
              variant: { type: "string", enum: ["primary", "secondary", "strong", "quiet"] },
              rect: rectSchema,
            },
            required: payload.user_request ? ["name", "purpose"] : [],
          },
          children: { type: "array", maxItems: 12, items: nodeSchema() },
          container_layout: {
            type: "object", additionalProperties: false,
            properties: {
              mode: { type: "string", enum: ["free", "horizontal", "vertical", "grid", "overlay"] },
              gap: { type: "number", minimum: 0, maximum: 20 }, padding: { type: "number", minimum: 0, maximum: 20 },
            },
            required: ["mode", "gap", "padding"],
          },
        },
        required: payload.user_request ? ["analysis", "panel_update", "children"] : ["analysis", "children"],
      };
  const scope = payload.stage === "panel_plan" ? "畫面主要區塊" : "所選節點的巢狀子元件";
  const visualPrinciples = "Follow general visual-design principles only: give user-stated emphasis a clear hierarchy; align related elements consistently; use spacing to show grouping; size and proportion elements according to their role and content; leave breathing room for readability; fit the canvas; avoid accidental overlap, clipping, and decoration without purpose. These are flexible visual guidelines, not fixed templates. Functional and domain-specific behavior must come only from the user's explicit request or supplied project data; never invent, assume, or add business rules.";
  const planPrompt = "你是 UI 規劃助手。第一階段只整理需求，不輸出 JSON，也不描述隱藏思考。請用使用者的語言，最多 6 行，列出目標、視覺排列、樹狀父子關係、使用者明確指定的功能／狀態，以及可重用的既有節點。" + visualPrinciples + " 層級要依畫面容納關係展開到必要深度，不要把同一元件的子孫攤平；功能與狀態只照使用者明確提出的內容整理，不推測、不增補。名稱優先沿用使用者指定的識別字。不得漏掉框體、比例或排列，也不可新增需求以外內容。";
  $("#ai-status").textContent = "Gemma 4 · 1/2 整理需求…";
  const planning = await requestGemma([
    { role: "system", content: planPrompt },
    { role: "user", content: JSON.stringify(payload) },
  ], { maxTokens: 256 });

  $("#ai-status").textContent = "Gemma 4 · 2/2 生成 JSON…";
  const jsonInstructions = payload.stage === "panel_plan"
    ? "Generate only the major screen panels from the original request and the organized plan. Keep panel rectangles in 0-100 percentages."
    : "Generate the selected node update and its full nested child tree from the original request and organized plan. Respect the requested parent-child groups; never flatten descendants into siblings. Reuse existing node IDs exactly when reusing or moving nodes. Represent functional behavior and visual states only when explicitly requested by the user or present in project data; do not infer domain conventions, invent states, or add business rules. Use visibility properties only to encode an explicitly requested initial visual state. Use container_layout for the selected container and layout on nested containers when needed. Preserve the selected node's type, style, and rectangle unless the user explicitly requests changing that selected node itself; a size or appearance request for a descendant must only affect that descendant. Use concise labels in the user's language, preserve explicit identifiers exactly, and keep each purpose to one short sentence. Do not copy the whole request into purpose or visible text. Keep local rectangles within 0-100.";
  const content = await requestGemma([
    { role: "system", content: "You are a precise UI hierarchy and layout assistant. " + visualPrinciples + " " + jsonInstructions },
    { role: "user", content: JSON.stringify({ ...payload, organized_plan: planning }) },
  ], { format: outputSchema, maxTokens: payload.stage === "panel_plan" ? 768 : 1024 });
  const result = JSON.parse(content);
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("OLLAMA_INVALID_JSON_RESULT");
  result.analysis = "整理：" + planning.trim() + (result.analysis ? "\nJSON摘要：" + result.analysis : "");
  return { ...result, planning, provider: "ollama/" + OLLAMA_MODEL };
}
async function checkGemmaConnection() {
  if (gemmaConnectionCheck) return gemmaConnectionCheck;
  gemmaConnection = "checking";
  renderAIDock();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  gemmaConnectionCheck = (async () => {
    try {
      const response = await fetch(OLLAMA_URL + "/api/tags", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("OLLAMA_TAGS_HTTP_" + response.status);
      const data = await response.json();
      gemmaConnection = data.models?.some((model) => model.name === OLLAMA_MODEL) ? "online" : "offline";
    } catch {
      gemmaConnection = "offline";
    } finally {
      clearTimeout(timeout);
      gemmaConnectionCheck = null;
      renderAIDock();
    }
    return gemmaConnection === "online";
  })();
  return gemmaConnectionCheck;
}
function reportGemmaUnavailable({ prompt = "", action, target, response = "Ollama Gemma 4 本機服務沒有回應；這次指令未送達，畫布未變更。" }) {
  gemmaConnection = "offline";
  aiBusy = false;
  renderAll();
  $("#canvas-message").textContent = "Gemma 4 未連線；畫布未變更，描述已保留";
  showToast("Gemma 4 未連線；畫布沒有更動，描述已保留。啟動 Ollama 後按「重試連線」。");
  recordAIHistory({
    before: historySnapshot(), source: "ai", action, prompt, response,
    provider: "unavailable", status: "error",
    target: target ? { id: target.id, type: target.type, name: target.name } : undefined,
  });
}
async function reportGemmaFailure({ prompt = "", action, target, error }) {
  aiBusy = false;
  await checkGemmaConnection();
  const connected = gemmaConnection === "online";
  const message = connected
    ? "Gemma 4 回應逾時或格式不完整；畫布未變更，描述已保留。"
    : "Gemma 4 未連線；畫布未變更，描述已保留。";
  renderAll();
  $("#canvas-message").textContent = message;
  showToast(message);
  recordAIHistory({
    before: historySnapshot(), source: "ai", action, prompt,
    response: String(error?.message || message).slice(0, 500),
    provider: connected ? "ollama/" + OLLAMA_MODEL : "unavailable", status: "error",
    target: target ? { id: target.id, type: target.type, name: target.name } : undefined,
  });
}
function arrangeMobilePanels(panels) {
  const header = panels.find((panel) => ["header", "navigation"].includes(panel.role));
  const actions = panels.find((panel) => panel.role === "actions");
  const middle = panels.filter((panel) => panel !== header && panel !== actions);
  const top = header ? 13 : 3;
  const bottom = actions ? 88 : 96;
  const gap = 2;
  const height = middle.length ? Math.max(12, (bottom - top - gap * (middle.length - 1)) / middle.length) : 0;
  if (header) header.rect = { x: 4, y: 2, width: 92, height: 8 };
  middle.forEach((panel, index) => { panel.rect = { x: 4, y: top + index * (height + gap), width: 92, height }; });
  if (actions) actions.rect = { x: 4, y: 90, width: 92, height: 7 };
  return panels;
}
async function planPanels(prompt) {
  const requirement = prompt.trim();
  if (!requirement) { showToast("先描述畫面要做什麼"); return; }
  aiBusy = true;
  renderAIDock();
  $("#canvas-message").textContent = "先安排畫面區塊；要拆內容時選取 Panel";
  const profile = currentProfile();
  const brief = { title: state.project.name, goal: requirement, emphasis: "", systems: "" };
  let result;
  try {
    if (gemmaConnection !== "online" && !await checkGemmaConnection()) {
      reportGemmaUnavailable({ prompt: requirement, action: "plan_panels" });
      return;
    }
    result = await callGemma({
      stage: "panel_plan",
      project: { name: state.project.name, platform: state.profile === "mobile" ? "mobile app" : "desktop game" },
      brief,
      board: { width: profile.width, height: profile.height, ratio: profile.width + ":" + profile.height },
    });
  } catch (error) {
    await reportGemmaFailure({ prompt: requirement, action: "plan_panels", error });
    return;
  }
  if (!Array.isArray(result?.panels) || !result.panels.length) {
    aiBusy = false;
    renderAIDock();
    showToast("Gemma 有回應，但沒有可用的 Panel；畫面未變更，描述已保留。");
    recordAIHistory({ before: historySnapshot(), source: "ai", action: "plan_panels", prompt: requirement, response: "模型回覆未包含有效的 panels。", provider: result?.provider || "ollama/" + OLLAMA_MODEL, status: "error" });
    return;
  }
  const panels = result.panels;
  if (state.profile === "mobile") arrangeMobilePanels(panels);
  const alreadyHasScene = state.elements.length > 0;
  if (alreadyHasScene && !window.confirm("將 AI 規劃的 Panel 加到目前畫面，不會刪除現有元件。要繼續嗎？")) {
    aiBusy = false;
    renderAIDock();
    recordAIHistory({ before: historySnapshot(), source: "ai", action: "plan_panels", prompt: requirement, response: result.analysis || result.summary, provider: result.provider || "unreported", status: "cancelled" });
    return;
  }
  const historyBefore = historySnapshot();
  rememberUndo();
  const created = [];
  for (const panel of panels.slice(0, 6)) {
    const rect = clampRect(panel.rect || { x: 5, y: 10, width: 40, height: 30 });
    const element = newElement("panel", {
      name: panel.label || panel.name || "Panel",
      purpose: panel.purpose || "",
      parentId: null,
      rect,
      mobileRect: { ...rect },
      aiId: panel.id || "",
      aiRole: panel.role || "content",
    });
    state.elements.push(element);
    created.push(element);
  }
  if (created.length) state.selectedId = created[0].id;
  markUnsaved();
  aiBusy = false;
  renderAll();
  $("#ai-prompt").value = "";
  showToast("已加入 " + created.length + " 個 Panel；可逐一選取並交給 Gemma 拆元件");
  recordAIHistory({ before: historyBefore, source: "ai", action: "plan_panels", prompt: requirement, response: result.analysis || result.summary, provider: result.provider || "unreported", status: created.length ? "applied" : "no_change" });
}
async function decomposePanel(panelId, userRequest = "") {
  const panel = getElement(panelId);
  if (!isParentNode(panel)) return;
  if (gemmaConnection !== "online" && !await checkGemmaConnection()) {
    reportGemmaUnavailable({ prompt: userRequest, action: userRequest ? "modify_container" : "decompose_container", target: panel });
    return;
  }
  aiBusy = true;
  renderAIDock();
  const button = inspector.querySelector('[data-action="decompose"]');
  if (button) { button.disabled = true; button.textContent = "Gemma 正在拆這個容器…"; }
  $("#ai-status").textContent = "只分析「" + panel.name + "」…";
  const siblings = state.elements.filter(isParentNode);
  const requestPanel = {
    id: panel.aiId || panel.id, label: panel.name, kind: panel.type, purpose: panel.purpose,
    rect: displayRect(panel), layout: panel.type === "container" ? { mode: panel.layoutMode || "free", gap: panel.gap, padding: panel.padding, columns: panel.columns } : undefined,
    children: panelRegistry(panel.id),
  };
  let result;
  try {
    result = await callGemma({
      stage: "panel_children",
      project: { name: state.project.name, platform: state.profile === "mobile" ? "mobile app" : "desktop game" },
      board: { width: currentProfile().width, height: currentProfile().height },
      brief: { title: state.project.name, goal: userRequest || "只拆解這個容器的子元件；依容器用途安排必要的層級與排列，不延伸到其他容器或自行新增需求。" },
      user_request: userRequest,
      scope: { operation: userRequest ? "modify_selected_node" : "decompose_selected_node", target_id: panel.aiId || panel.id, preserve_existing_children: true, do_not_modify_other_panels: true },
      panel: requestPanel,
      panels: siblings.map((item) => ({ id: item.aiId || item.id, parentId: item.parentId || null, label: item.name, kind: item.type, purpose: item.purpose, rect: displayRect(item) })),
      component_types: Object.keys(TYPE_NAMES),
      layout_modes: Object.entries(LAYOUT_NAMES).map(([id, label]) => ({ id, label })),
      component_registry: panelRegistry(),
      output_contract: { panel_update: "Optional {name,purpose,type,variant,rect} for the selected node", children: "Recursive nodes with id,role,label,purpose,rect,visible,variant,layout,children; preserve parent-child nesting and reuse IDs", container_layout: "Optional {mode,gap,padding} for the selected container", preserve_existing_children: true },
    });
  } catch (error) {
    await reportGemmaFailure({ prompt: userRequest, action: userRequest ? "modify_container" : "decompose_container", target: panel, error });
    return;
  }
  result ||= {};
  const panelUpdate = result.panel_update || {};
  const identity = requestedContainerIdentity(userRequest);
  const nextName = String(panelUpdate.name || identity || panel.name).trim().slice(0, 48);
  const nextPurpose = String(panelUpdate.purpose || (identity ? requestedContainerPurpose(identity, userRequest) : panel.purpose)).trim();
  const metadataChanged = Boolean(userRequest) && (nextName !== panel.name || nextPurpose !== panel.purpose);
  const nextType = ["container", "panel"].includes(panelUpdate.type) ? panelUpdate.type : panel.type;
  const nextVariant = panelUpdate.variant || panel.variant;
  const parentStyleChanged = nextType !== panel.type || nextVariant !== panel.variant;
  const parentNode = getElement(panel.parentId);
  const originalPanelRect = displayRect(panel);
  const resizeSelectedPanel = userRequest && /(?:面板|容器|panel|container).{0,16}(?:尺寸|大小|寬|高|位置|調整|放大|縮小|移動|改成|變成)|(?:resize|move|set|change).{0,24}(?:panel|container)/i.test(userRequest);
  const nextPanelRect = clampRect(resizeSelectedPanel ? panelUpdate.rect || originalPanelRect : originalPanelRect, parentNode?.type === "scrollview" ? scrollContentLength(parentNode) : 100);
  const panelRectChanged = Object.keys(nextPanelRect).some((key) => Math.abs(nextPanelRect[key] - originalPanelRect[key]) > 0.01);
  const children = Array.isArray(result.children) ? result.children : [];
  const requestedLayout = result.container_layout;
  const layoutMode = typeof requestedLayout === "string" ? requestedLayout : requestedLayout?.mode;
  const stackFromInstruction = userRequest && /上方|下方|上面|下面|上.*下|above|below|top.*bottom/.test(userRequest);
  const groupThenLabel = children.some((item) => isParentNode({ type: roleToType(item.role) })) && children.some((item) => ["label", "text"].includes(item.role));
  const nextLayout = LAYOUT_NAMES[layoutMode] ? layoutMode : stackFromInstruction || groupThenLabel ? "vertical" : "";
  const layoutChanged = isParentNode(panel) && Boolean(nextLayout) && panel.layoutMode !== nextLayout;
  const existingById = new Map();
  const indexSubtree = (parentId) => childElements(parentId).forEach((item) => {
    existingById.set(item.id, item);
    if (item.aiId) existingById.set(item.aiId, item);
    indexSubtree(item.id);
  });
  indexSubtree(panel.id);
  const validateChildren = (items, depth = 1) => {
    if (depth > 5) throw new Error("AI_HIERARCHY_TOO_DEEP");
    for (const item of items) {
      const type = roleToType(item.role);
      if ((item.children?.length || 0) && !isParentNode({ type })) throw new Error("AI_NESTED_CHILDREN_REQUIRE_CONTAINER");
      validateChildren(item.children || [], depth + 1);
    }
  };
  validateChildren(children);
  const used = new Set();
  const additions = [];
  const updates = [];
  const wouldChange = children.length || layoutChanged || metadataChanged || parentStyleChanged || panelRectChanged;
  const historyBefore = historySnapshot();
  if (wouldChange) rememberUndo();
  if (metadataChanged) {
    panel.name = nextName;
    panel.purpose = nextPurpose;
  }
  panel.type = nextType;
  panel.variant = nextVariant;
  if (panelRectChanged) setRect(panel, nextPanelRect, state.profile);
  if (layoutChanged) {
    panel.layoutMode = nextLayout;
    if (Number.isFinite(Number(requestedLayout?.gap))) panel.gap = Math.max(0, Math.min(20, Number(requestedLayout.gap)));
    if (Number.isFinite(Number(requestedLayout?.padding))) panel.padding = Math.max(0, Math.min(20, Number(requestedLayout.padding)));
  }
  const applyChildren = (parent, items, depth = 1) => items.forEach((child, order) => {
    const type = roleToType(child.role);
    const label = String(child.label || "子元件").trim().slice(0, 48);
    let element = child.id ? existingById.get(child.id) : null;
    if (element && used.has(element.id)) element = null;
    if (!element) element = childElements(parent.id).find((candidate) => !used.has(candidate.id) && candidate.type === type && candidate.name.trim().toLowerCase() === label.toLowerCase()) || null;
    if (element && !isParentNode({ type }) && childElements(element.id).length && !(child.children?.length)) throw new Error("AI_CANNOT_REPLACE_PARENT_WITH_LEAF");
    const maxHeight = parent.type === "scrollview" ? scrollContentLength(parent) : 100;
    const rect = clampRect(child.rect || (element ? getRect(element) : { x: 8, y: 8, width: 84, height: 84 }), maxHeight);
    const visible = child.visible === undefined ? element?.visible !== false : child.visible !== false;
    const variant = child.variant || element?.variant || "secondary";
    let changed = !element;
    if (element) {
      const beforeRect = getRect(element);
      changed = element.type !== type || element.name !== label || element.parentId !== parent.id
        || element.purpose !== (child.purpose || element.purpose) || element.visible !== visible || element.variant !== variant
        || element.aiRole !== (child.role || element.aiRole) || Object.keys(rect).some((key) => Math.abs(rect[key] - beforeRect[key]) > 0.01)
        || (Number.isFinite(Number(element.order)) && Number(element.order) !== order);
      element.parentId = parent.id;
      element.type = type;
      element.name = label;
      element.text = child.text ?? (element.text || (["label", "button"].includes(type) ? label : ""));
      element.purpose = child.purpose || element.purpose || "";
      element.visible = visible;
      element.variant = variant;
      element.aiRole = child.role || element.aiRole || "";
      element.order = order;
      setRect(element, rect, "desktop");
      setRect(element, rect, "mobile");
      updateSharedValue(element, "visible", visible);
      if (changed) updates.push(element);
    } else {
      element = newElement(type, {
        name: label, text: child.text || (["label", "button"].includes(type) ? label : ""),
        purpose: child.purpose || "", parentId: parent.id, rect, order, visible, variant,
        layoutMode: child.layout?.mode || "free", gap: child.layout?.gap, padding: child.layout?.padding,
        aiId: child.id || "", aiRole: child.role || "", sharedKey: child.id || "",
      });
      state.elements.push(element);
      additions.push(element);
    }
    used.add(element.id);
    if (isParentNode(element)) {
      const childLayout = child.layout;
      if (childLayout && LAYOUT_NAMES[childLayout.mode]) {
        element.layoutMode = childLayout.mode;
        element.gap = Math.max(0, Math.min(20, Number(childLayout.gap) || 0));
        element.padding = Math.max(0, Math.min(20, Number(childLayout.padding) || 0));
      }
      applyChildren(element, child.children || [], depth + 1);
    }
  });
  applyChildren(panel, children);
  state.selectedId = panel.id;
  const changed = additions.length || updates.length || layoutChanged || metadataChanged || parentStyleChanged || panelRectChanged;
  if (changed) markUnsaved();
  aiBusy = false;
  renderAll();
  if (!changed) {
    showToast("沒有新增內容；目前子元件已足夠或需要更具體的描述。");
  } else {
    showToast("已更新「" + panel.name + "」：新增 " + additions.length + "、修改 " + updates.length + " 個子元件；其他 Panel 保持不變。");
  }
  if (userRequest && changed) $("#ai-prompt").value = "";
  recordAIHistory({
    before: historyBefore, source: "ai", action: userRequest ? "modify_container" : "decompose_container",
    prompt: userRequest, response: result.analysis || result.summary, provider: result.provider || "unreported",
    status: changed ? "applied" : "no_change",
    target: { id: panel.id, type: panel.type, name: historyBefore.elements.find((item) => item.id === panel.id)?.name || panel.name },
  });
}
function beginVoiceInput() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    $("#voice-state").textContent = "此瀏覽器沒有語音辨識；可用系統聽寫輸入。";
    return;
  }
  if (speech) { speech.stop(); return; }
  speech = new Recognition();
  speech.lang = "zh-TW";
  speech.interimResults = true;
  speech.continuous = false;
  $("#voice-input").classList.add("is-listening");
  $("#voice-state").textContent = "正在聽…";
  speech.onresult = (event) => {
    let finalText = "";
    let interimText = "";
    for (let index = event.resultIndex; index < event.results.length; index++) {
      if (event.results[index].isFinal) finalText += event.results[index][0].transcript;
      else interimText += event.results[index][0].transcript;
    }
    if (finalText) $("#ai-prompt").value = ($("#ai-prompt").value.trim() + " " + finalText).trim();
    $("#voice-state").textContent = interimText ? interimText : (finalText ? "已轉成文字，可直接送出。" : "正在聽…");
  };
  speech.onerror = (event) => { $("#voice-state").textContent = event.error === "not-allowed" ? "請允許麥克風權限。" : "語音輸入中斷，可再試一次。"; };
  speech.onend = () => {
    speech = null;
    $("#voice-input").classList.remove("is-listening");
    if ($("#voice-state").textContent === "正在聽…") $("#voice-state").textContent = "";
  };
  speech.start();
}
function exportProject() {
  const payload = { protocol: "unone.frame-atelier.v2", exportedAt: new Date().toISOString(), ...clone(state) };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = (state.project.name || "frame-atelier").replace(/[\\/:*?"<>|\s]+/g, "-") + ".json";
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("專案資料已匯出為 JSON");
}
async function importProjectFile(file) {
  if (!file) return;
  try {
    const source = JSON.parse(await file.text());
    if (!source?.project || !Array.isArray(source.elements)) throw new Error("不是 Frame Atelier 專案檔");
    if (state.elements.length && !window.confirm("匯入會取代目前畫布內容。建議先匯出目前專案。要繼續嗎？")) return;
    const allowed = new Set(Object.keys(TYPE_NAMES));
    const elements = source.elements.filter((item) => item && typeof item.id === "string" && allowed.has(item.type)).map((item) => {
      const desktop = item.rects?.desktop || item.rect || { x: 5, y: 5, width: 25, height: 15 };
      const mobile = item.rects?.mobile || desktop;
      return {
        ...item,
        name: String(item.name || TYPE_NAMES[item.type]).slice(0, 48),
        text: String(item.text || ""),
        purpose: String(item.purpose || ""),
        visible: item.visible !== false,
        parentId: typeof item.parentId === "string" ? item.parentId : null,
        rects: { desktop: clampRect(desktop), mobile: clampRect(mobile) },
      };
    });
    const byId = new Map(elements.map((item) => [item.id, item]));
    for (const element of elements) {
      const parent = byId.get(element.parentId);
      const seen = new Set([element.id]);
      let current = parent;
      let invalid = Boolean(element.parentId && !isParentNode(parent));
      while (current && !invalid) {
        if (seen.has(current.id)) { invalid = true; break; }
        seen.add(current.id);
        current = current.parentId ? byId.get(current.parentId) : null;
      }
      if (invalid) element.parentId = null;
    }
    rememberUndo();
    const ids = elements.map((item) => Number(item.id.match(/(\d+)$/)?.[1] || 0));
    state = {
      project: {
        ...source.project,
        id: String(source.project.id || "imported-project"),
        name: String(source.project.name || "匯入的介面").slice(0, 48),
        buttonStyle: { ...DEFAULT_BUTTON_STYLE, ...(source.project.buttonStyle || {}) },
        prefabs: Array.isArray(source.project.prefabs) ? source.project.prefabs : [],
      },
      profile: PROFILES[source.profile] ? source.profile : "desktop",
      grid: source.grid !== false,
      tool: "select",
      zoom: 0,
      selectedId: elements.some((item) => item.id === source.selectedId) ? source.selectedId : null,
      nextId: Math.max(Number(source.nextId) || 1, ...ids.map((id) => id + 1)),
      elements,
      changeLog: Array.isArray(source.changeLog) ? normalizeChangeLog(source.changeLog) : (state.changeLog || []),
    };
    renderAll();
    save();
    showToast("已匯入「" + state.project.name + "」");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "無法讀取這個專案檔");
  } finally {
    $("#project-file").value = "";
  }
}
function createUnoneTree(parentId = null) {
  return childElements(parentId).map((element) => ({
    id: element.id, kind: element.type, name: element.name, text: element.text, visible: element.visible !== false, variant: element.variant, placeholder: element.placeholder,
    rect: clone(displayRect(element)), preferred_rect: clone(getRect(element)), purpose: element.purpose,
    layout: element.type === "container"
      ? { mode: element.layoutMode || "free", gap: Number(element.gap ?? 3), padding: Number(element.padding ?? 4), columns: Number(element.columns || 3) }
      : element.type === "scrollview" ? { mode: "scroll", axis: "vertical", content_length: scrollContentLength(element) } : undefined,
    children: createUnoneTree(element.id),
  }));
}
function inspectState(options = {}) {
  const elements = state.elements.map((element) => ({ ...clone(element), rect: clone(displayRect(element)), preferred_rect: clone(getRect(element)) }));
  const snapshot = clone({
    protocol: "unone.frame-atelier.v2",
    project: state.project,
    active_profile: state.profile,
    board: currentProfile(),
    elements,
    frames: elements,
    prefabs: state.project.prefabs,
    unone_ui: { kind: "canvas", id: "artboard", children: createUnoneTree() },
  });
  if (options.includeHistory === true) {
    snapshot.change_history = getChangeHistory({ limit: options.historyLimit, allProjects: options.allProjects === true });
  }
  return snapshot;
}
function getChangeHistory(payload = {}) {
  save();
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(payload.limit) || 20)));
  let entries = state.changeLog || [];
  if (payload.allProjects !== true) entries = entries.filter((item) => item.projectId === state.project.id);
  if (typeof payload.targetId === "string" && payload.targetId) entries = entries.filter((item) => item.target?.id === payload.targetId);
  return clone({ project: state.project.name, total: entries.length, entries: entries.slice(0, limit) });
}
async function command(name, payload = {}) {
  if (name === "inspect") return inspectState(payload);
  if (name === "get_change_history") return getChangeHistory(payload);
  if (name === "set_profile") { setProfile(payload.profile); return inspectState(); }
  if (name === "select_element" || name === "select_frame") { selectElement(payload.id); return inspectState(); }
  if (name === "add_element" || name === "add_frame") {
    const element = createElement(payload.type || "panel", { ...payload, rect: payload.rect || payload.rects?.[state.profile] });
    return element ? inspectState() : Promise.reject(new Error("PARENT_MUST_BE_A_CONTAINER_NODE"));
  }
  if (name === "update_element" || name === "update_frame") {
    const element = getElement(payload.id) || getElement(state.selectedId);
    if (!element) throw new Error("ELEMENT_NOT_FOUND");
    if (payload.type !== undefined && (!Object.prototype.hasOwnProperty.call(TYPE_NAMES, payload.type)
      || (!isParentNode({ type: payload.type }) && childElements(element.id).length))) throw new Error("INVALID_NODE_TYPE");
    rememberUndo();
    if (payload.type !== undefined) element.type = payload.type;
    for (const key of ["name", "text", "purpose", "placeholder", "variant", "background", "checked", "visible", "layoutMode", "gap", "padding", "columns", "value", "contentLength", "order"]) {
      if (payload[key] !== undefined) {
        const value = ["gap", "padding", "columns", "value", "contentLength", "order"].includes(key) ? Number(payload[key]) : key === "visible" ? payload[key] !== false : payload[key];
        element[key] = value;
        updateSharedValue(element, key, value);
      }
    }
    if (payload.rect) setRect(element, payload.rect);
    if (payload.parentId !== undefined) setParent(element, payload.parentId);
    markUnsaved();
    renderAll();
    return inspectState();
  }
  if (name === "set_parent") {
    const element = getElement(payload.id);
    if (!element || !setParent(element, payload.parentId || null)) throw new Error("INVALID_PARENT");
    return inspectState();
  }
  if (name === "duplicate_element") { duplicateElement(payload.id || state.selectedId); return inspectState(); }
  if (name === "delete_element") { deleteElement(payload.id || state.selectedId); return inspectState(); }
  if (name === "save_prefab") { savePrefab(payload.id || state.selectedId); return inspectState(); }
  if (name === "insert_prefab") { insertPrefab(payload.prefabId); return inspectState(); }
  if (name === "analyze_frame" || name === "decompose_panel") { await decomposePanel(payload.id || state.selectedId, payload.prompt || ""); return inspectState(); }
  if (name === "panel_plan" || name === "generate_interface") { await planPanels(payload.prompt || payload.brief?.goal || ""); return inspectState(); }
  if (name === "add_subframes" || name === "analyze_hierarchy") { await decomposePanel(payload.id || state.selectedId); return inspectState(); }
  if (name === "create_draft") return inspectState();
  if (["apply_suggestion", "apply_suggested_rect", "keep_current_rect"].includes(name)) return inspectState();
  throw new Error("UNKNOWN_FRAME_ATELIER_COMMAND: " + name);
}

async function hostRequest(path, options = {}) {
  hostSession ||= fetch(HOST_API_URL + "/session", { headers: { "X-Frame-Atelier": "1" }, cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error("FRAME_ATELIER_SESSION_FAILED");
      return (await response.json()).token;
    }).catch((error) => { hostSession = null; throw error; });
  const token = await hostSession;
  const response = await fetch(HOST_API_URL + "/" + path, {
    ...options,
    headers: { ...options.headers, Authorization: "Bearer " + token },
  });
  if (response.status === 401) hostSession = null;
  if (!response.ok) throw new Error("FRAME_ATELIER_REQUEST_FAILED");
  return response;
}
function syncHostState() {
  if (!window.frameAtelier?.inspect) return;
  hostRequest("state", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(window.frameAtelier.inspect()), keepalive: true,
  }).catch(() => {});
}
async function postHostResult(id, result, error = null) {
  await hostRequest("result", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ok: !error, result: error ? null : result, error }),
  });
}
async function pollHostCommands() {
  if (hostPollBusy || !window.frameAtelier?.command) return;
  hostPollBusy = true;
  try {
    const response = await hostRequest("poll", { cache: "no-store" });
    const { commands = [] } = await response.json();
    for (const request of commands) {
      try { await postHostResult(request.id, await command(request.name, request.payload || {})); }
      catch (error) { await postHostResult(request.id, null, error instanceof Error ? error.message : String(error)); }
    }
  } catch { /* The editor stays local when the optional command bridge is offline. */ }
  finally { hostPollBusy = false; }
}

window.frameAtelier = Object.freeze({
  protocol: "unone.frame-atelier.v2",
  inspect: inspectState,
  command,
});
window.setInterval(syncHostState, 1000);
window.setInterval(pollHostCommands, 250);

$("#component-palette").addEventListener("click", (event) => {
  const tile = event.target.closest("[data-add-type]");
  if (!tile || Date.now() < suppressPaletteClickUntil) return;
  createElement(tile.dataset.addType);
});
$("#component-palette").addEventListener("dragstart", (event) => {
  const tile = event.target.closest("[data-add-type]");
  if (!tile) return;
  event.dataTransfer.setData("application/x-frame-element", tile.dataset.addType);
  event.dataTransfer.effectAllowed = "copy";
  suppressPaletteClickUntil = Date.now() + 700;
  tile.classList.add("is-dragging");
});
$("#component-palette").addEventListener("dragend", (event) => event.target.closest("[data-add-type]")?.classList.remove("is-dragging"));
artboard.addEventListener("dragover", (event) => {
  if (event.dataTransfer.types.includes("application/x-frame-element") || event.dataTransfer.types.includes("text/plain")) {
    event.preventDefault();
    artboard.classList.add("is-drop-target");
    $("#drop-hint").hidden = false;
  }
});
artboard.addEventListener("dragleave", (event) => {
  if (!artboard.contains(event.relatedTarget)) { artboard.classList.remove("is-drop-target"); $("#drop-hint").hidden = true; }
});
artboard.addEventListener("drop", (event) => {
  event.preventDefault();
  artboard.classList.remove("is-drop-target");
  $("#drop-hint").hidden = true;
  const type = event.dataTransfer.getData("application/x-frame-element");
  if (type) {
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".scene-node");
    const parent = nearestParentForNode(target);
    const parentNode = parent ? getNodeElement(parent.id) : null;
    const scrollContent = parentNode?.querySelector(":scope > .scroll-viewport > .scroll-content");
    const rect = (scrollContent || parentNode || scene).getBoundingClientRect();
    const x = Math.max(0, Math.min(92, (event.clientX - rect.left) / rect.width * 100));
    const y = Math.max(0, Math.min(92, (event.clientY - rect.top) / rect.height * 100));
    createElement(type, { parentId: parent?.id || null, x, y });
  } else {
    const treeId = event.dataTransfer.getData("text/plain");
    if (treeId && treeId.startsWith("tree:")) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".scene-node");
      const parent = nearestParentForNode(target);
      const moved = getElement(treeId.slice(5));
      if (moved && !setParent(moved, parent?.id || null)) showToast("無法將元件放進自己的子節點");
    }
  }
});

tree.addEventListener("click", (event) => {
  const visibilityButton = event.target.closest("[data-toggle-visibility]");
  if (visibilityButton) {
    const element = getElement(visibilityButton.dataset.toggleVisibility);
    if (!element) return;
    rememberUndo();
    element.visible = element.visible === false;
    updateSharedValue(element, "visible", element.visible);
    markUnsaved();
    renderAll();
    return;
  }
  const deleteButton = event.target.closest("[data-delete-node]");
  if (deleteButton) {
    event.preventDefault();
    const id = deleteButton.dataset.deleteNode;
    const parentId = getElement(id)?.parentId;
    deleteElement(id);
    requestAnimationFrame(() => {
      const parentRow = parentId && tree.querySelector('.tree-row[data-id="' + CSS.escape(parentId) + '"] .tree-select');
      (parentRow || tree).focus();
    });
    return;
  }
  const toggleButton = event.target.closest("[data-tree-toggle]");
  if (toggleButton) {
    event.preventDefault();
    const id = toggleButton.dataset.treeToggle;
    const row = toggleButton.closest(".tree-row");
    const collapsed = !collapsedTreeIds.has(id);
    if (collapsed) collapsedTreeIds.add(id);
    else collapsedTreeIds.delete(id);
    row.setAttribute("aria-expanded", String(!collapsed));
    toggleButton.setAttribute("aria-expanded", String(!collapsed));
    toggleButton.setAttribute("aria-label", (collapsed ? "展開「" : "收合「") + getElement(id).name + "」");
    toggleButton.title = collapsed ? "展開" : "收合";
    toggleButton.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="' + (collapsed ? "m6 3 5 5-5 5" : "m3 6 5 5 5-5") + '" /></svg>';
    row.querySelector(":scope > .tree-children").hidden = collapsed;
    return;
  }
  const selectButton = event.target.closest("[data-select-tree]");
  if (selectButton) {
    const id = selectButton.dataset.selectTree;
    selectElement(id);
    $("#canvas-message").textContent = "已選取「" + getElement(id).name + "」";
  }
});
tree.addEventListener("dragstart", (event) => {
  const row = event.target.closest(".tree-row");
  if (!row) return;
  event.dataTransfer.setData("text/plain", "tree:" + row.dataset.id);
  event.dataTransfer.effectAllowed = "move";
});
tree.addEventListener("dragover", (event) => {
  const row = event.target.closest(".tree-row");
  if (!row || !isParentNode(getElement(row.dataset.id))) return;
  event.preventDefault();
  row.classList.add("is-drop-target");
});
tree.addEventListener("dragleave", (event) => event.target.closest(".tree-row")?.classList.remove("is-drop-target"));
tree.addEventListener("drop", (event) => {
  const row = event.target.closest(".tree-row");
  if (!row || !isParentNode(getElement(row.dataset.id))) return;
  event.preventDefault();
  const value = event.dataTransfer.getData("text/plain");
  if (value.startsWith("tree:")) {
    const element = getElement(value.slice(5));
    if (element && !setParent(element, row.dataset.id)) showToast("無法將元件放進這個父節點");
  }
});
$("#prefab-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-insert-prefab]");
  if (button) insertPrefab(button.dataset.insertPrefab);
});
inspector.addEventListener("focusin", () => rememberUndo(), { once: false });
inspector.addEventListener("input", handleInspectorInput);
inspector.addEventListener("change", handleInspectorChange);
inspector.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (button) handleInspectorAction(button.dataset.action);
});
scene.addEventListener("pointerdown", beginPointerEdit);
scene.addEventListener("pointermove", movePointerEdit);
scene.addEventListener("pointerup", endPointerEdit);
scene.addEventListener("pointercancel", endPointerEdit);
artboard.addEventListener("pointerdown", startDraw);
artboard.addEventListener("pointermove", moveDraw);
artboard.addEventListener("pointerup", endDraw);
artboard.addEventListener("pointercancel", endDraw);
document.querySelectorAll(".profile-button[data-profile]").forEach((button) => button.addEventListener("click", () => setProfile(button.dataset.profile)));
document.querySelectorAll("[data-tool]").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
$("#toggle-grid").addEventListener("click", () => {
  state.grid = !state.grid;
  renderProfile();
  markUnsaved();
});
$("#add-root").addEventListener("click", () => {
  state.selectedId = null;
  createElement("panel", { parentId: null, x: 12, y: 14, name: "新 Panel" });
});
$("#project-name").addEventListener("input", (event) => {
  state.project.name = event.target.value;
  markUnsaved();
});
$("#button-color").addEventListener("input", (event) => updateGlobalButtonStyle("color", event.target.value));
$("#button-radius").addEventListener("input", (event) => {
  const radius = Math.max(0, Math.min(32, Number(event.target.value) || 0));
  event.target.value = String(radius);
  updateGlobalButtonStyle("radius", radius);
});
function submitAIPrompt() {
  if (aiBusy) return;
  if (gemmaConnection !== "online") {
    showToast(gemmaConnection === "checking" ? "正在檢查 Gemma 4 連線；描述會保留。" : "Gemma 4 未連線；描述已保留，連線後再送出。請先按「重試連線」。");
    return;
  }
  const prompt = $("#ai-prompt").value.trim();
  if (!prompt) { showToast("先說明想新增或修改什麼"); return; }
  const selected = getElement(state.selectedId);
  if (isParentNode(selected)) decomposePanel(selected.id, prompt);
  else planPanels(prompt);
}
$("#ai-submit").addEventListener("click", submitAIPrompt);
$("#ai-retry").addEventListener("click", async () => {
  if (await checkGemmaConnection()) showToast("Gemma 4 已連線，可以送出指令了。");
  else showToast("Gemma 4 仍未連線；啟動本機 Ollama 後再試。輸入內容會保留。");
});
$("#ai-prompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitAIPrompt(); }
});
$("#voice-input").addEventListener("click", beginVoiceInput);
$("#export-project").addEventListener("click", exportProject);
$("#import-project").addEventListener("click", () => $("#project-file").click());
$("#project-file").addEventListener("change", (event) => importProjectFile(event.currentTarget.files?.[0]));
$("#reset-project").addEventListener("click", () => {
  if (!window.confirm("還原成 Yes Sir 範例？目前畫布內容會被取代。建議先匯出專案。")) return;
  rememberUndo();
  const changeLog = state.changeLog || [];
  state = sampleState();
  state.changeLog = changeLog;
  renderAll();
  save();
  showToast("已還原 Yes Sir 英雄裝備範例");
});
$("#new-project").addEventListener("click", () => {
  if (state.elements.length && !window.confirm("建立空白專案？目前畫面會被清空。建議先匯出專案。")) return;
  rememberUndo();
  state = {
    project: { id: "project-" + Date.now().toString(36), name: "未命名介面", buttonStyle: { ...DEFAULT_BUTTON_STYLE }, prefabs: [] },
    profile: "desktop", grid: true, tool: "select", zoom: 0, selectedId: null, nextId: 1, elements: [], changeLog: state.changeLog || [],
  };
  renderAll();
  save();
  showToast("已建立空白專案");
});
$("#zoom-in").addEventListener("click", () => { state.zoom = Math.min(1.8, (state.zoom || 1) + 0.1); updateBoardSize(); markUnsaved(); });
$("#zoom-out").addEventListener("click", () => { state.zoom = Math.max(0.35, (state.zoom || 1) - 0.1); updateBoardSize(); markUnsaved(); });
$("#zoom-fit").addEventListener("click", () => { state.zoom = 0; updateBoardSize(); markUnsaved(); });
$("#undo").addEventListener("click", undo);
$("#redo").addEventListener("click", redo);
window.addEventListener("resize", updateBoardSize);
window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d" && state.selectedId) { event.preventDefault(); duplicateElement(state.selectedId); return; }
  if ((event.key === "Delete" || event.key === "Backspace") && state.selectedId && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) { event.preventDefault(); deleteElement(state.selectedId); }
  if (event.key === "Escape") { state.selectedId = null; renderCanvasSelection(); }
});

const resizeObserver = new ResizeObserver(updateBoardSize);
resizeObserver.observe(canvasScroll);
$("#button-color").value = state.project.buttonStyle.color;
renderAll();
save();
void checkGemmaConnection();
