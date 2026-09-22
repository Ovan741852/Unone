import { inspectLayout, validateTree } from "../../../UnoneUI/src/components.mjs?v=1";

const STORAGE_KEY = "unone-frame-atelier-v2";
const ASSIST_URL = "http://127.0.0.1:8787/api/layout-assist";
const HOST_API_URL = "/api/frame-atelier";
const PROJECT = {
  id: "yessir-ashen-legion",
  name: "森林領主 · YesSir",
  platform: "desktop game",
  brief: {
    genre: "computer game",
    screen: "hero loadout and equipment management",
    audience_action: "玩家查看角色、替換裝備、比較數值並進入戰鬥",
    behavior_rules: {
      dynamic: "會因玩家操作、數值、庫存或冷卻改變的內容要標記 dynamic",
      fixed: "固定標題、按鈕、圖示位置與導覽要標記 fixed",
      panel_children: "每個 dynamic panel 必須列出內部可變元素",
    },
    reuse_rules: "可在多個畫面重複的 item card、equipment slot、action button、stat row 優先標記為共用元件",
    nine_grid_rules: "角色主體與連續場景不做九宮格；裝備圖示、道具、卡片主視覺與可替換物件可做九宮格候選",
  },
};
const DESIGN_SCREENSHOT_URL = "/YesSir/_Games/ashen-legion/concept-art/generated-equipment-screen/equipment-screen-mockup-1920x1080-final.png";
const BOARD_PROFILES = {
  desktop: { label: "Desktop", ratio: "16:9", width: 1920, height: 1080 },
  mobile: { label: "Mobile", ratio: "9:16", width: 390, height: 844 },
};
const UNDERLAY_ELEMENTS = {
  desktop: [
    { id: "character", name: "角色主體", purpose: "呈現森林領主與目前穿戴外觀", note: "保留角色完整輪廓", rect: { x: 21, y: 23, width: 25, height: 49 } },
    { id: "equipment-slots", name: "裝備槽", purpose: "顯示 HEAD、BODY、HANDS、FEET、WEAPON 位置", note: "每個槽位都要能獨立互動", rect: { x: 11, y: 22, width: 42, height: 60 } },
    { id: "hands-slot", name: "HANDS 手部槽", purpose: "顯示手部裝備或空格", note: "保留手部圖示與操作空間", rect: { x: 14, y: 20, width: 14, height: 20 } },
    { id: "body-slot", name: "BODY 身體槽", purpose: "顯示身體裝備與防具外觀", note: "保留裝備輪廓", rect: { x: 14, y: 43, width: 14, height: 22 } },
    { id: "weapon-slot", name: "WEAPON 武器槽", purpose: "顯示目前裝備的武器", note: "保留武器完整形狀", rect: { x: 37, y: 20, width: 14, height: 23 } },
    { id: "inventory-grid", name: "裝備卡列", purpose: "讓玩家瀏覽並選取可穿戴裝備", note: "保留 DETAILS 與 EQUIP", rect: { x: 60, y: 21, width: 35, height: 67 } },
    { id: "card-actions", name: "卡片操作", purpose: "提供單張裝備的 DETAILS 與 EQUIP 操作", note: "操作按鈕要跟卡片內容分開", rect: { x: 62, y: 23, width: 31, height: 17 } },
    { id: "primary-action", name: "主要操作", purpose: "承接確認後的穿戴、購買或進入戰鬥", note: "保持高對比與清楚的操作回饋", rect: { x: 61, y: 3, width: 34, height: 10 } },
  ],
  mobile: [
    { id: "mobile-character", name: "角色主體", purpose: "呈現角色目前外觀", note: "保留臉部與身體輪廓", rect: { x: 15, y: 47, width: 70, height: 34 } },
    { id: "mobile-equipment", name: "裝備資訊", purpose: "顯示角色與裝備狀態", note: "避免壓到安全區", rect: { x: 10, y: 45, width: 80, height: 40 } },
    { id: "mobile-action", name: "主要操作", purpose: "提供下一步確認操作", note: "放在拇指容易觸及的位置", rect: { x: 14, y: 2, width: 72, height: 7 } },
  ],
};
const board = document.querySelector("#device-board");
const deviceContent = document.querySelector("#device-content");
const frameList = document.querySelector("#frame-list");
const assetRow = document.querySelector("#asset-row");
const toast = document.querySelector("#toast");
const saveState = document.querySelector("#save-state");

const DEFAULT_STATE = {
  selectedId: "F01",
  tool: "select",
  grid: false,
  profile: "desktop",
  frames: [
    { id: "F01", name: "角色與裝備區", purpose: "呈現目前角色、裝備槽與已經穿戴的外觀，讓玩家確認出戰配置。", note: "不要裁掉角色與武器", ratio: "auto", status: "draft", rects: { desktop: { x: 4, y: 9, width: 53, height: 84 }, mobile: { x: 8, y: 48, width: 84, height: 40 } } },
    { id: "F02", name: "Inventory 卡列", purpose: "顯示可以查看與穿戴的裝備卡片；每張卡都要能獨立被選取。", note: "卡片需保留 DETAILS 與 EQUIP action", ratio: "auto", status: "needs_review", rects: { desktop: { x: 59, y: 20, width: 37, height: 70 }, mobile: { x: 8, y: 8, width: 84, height: 36 } } },
    { id: "F03", name: "Primary action", purpose: "承接確認後的正向操作，例如穿戴、購買或進入戰鬥。", note: "返回／關閉統一放右上角", ratio: "auto", status: "draft", rects: { desktop: { x: 60, y: 3, width: 36, height: 10 }, mobile: { x: 14, y: 2, width: 72, height: 7 } } },
  ],
  assets: [],
  hierarchy: null,
  brief: {
    title: "英雄裝備介面",
    goal: "讓玩家查看英雄狀態、替換裝備並準備出戰。",
    emphasis: "英雄身分和目前裝備要一眼看懂。",
    systems: "生命、攻擊、防禦、裝備槽、背包、出戰按鈕",
  },
  generatedSpec: null,
};

let state = loadState();
let suggestion = null;
let toastTimer = null;
let drawing = null;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.frames?.length) return { ...DEFAULT_STATE, ...saved, brief: { ...DEFAULT_STATE.brief, ...(saved.brief || {}) }, frames: saved.frames };
  } catch { /* A broken local draft should never block the editor. */ }
  return structuredClone(DEFAULT_STATE);
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  saveState.textContent = "已儲存";
  syncHostState();
}

function markUnsaved() {
  saveState.textContent = "儲存中…";
  window.clearTimeout(markUnsaved.timer);
  markUnsaved.timer = window.setTimeout(save, 220);
}

function selectedFrame() {
  return state.frames.find((frame) => frame.id === state.selectedId) ?? state.frames[0] ?? null;
}

function activeProfile() {
  return BOARD_PROFILES[state.profile] ?? BOARD_PROFILES.desktop;
}

function activeRect(frame) {
  return frame?.rects?.[state.profile] ?? frame?.rect ?? { x: 10, y: 10, width: 80, height: 20 };
}

function viewportRect(frame) {
  const rect = activeRect(frame);
  return { x: rect.x, y: 100 - rect.y - rect.height, width: rect.width, height: rect.height };
}

function semanticDefaults(id) {
  const defaults = {
    character: { label: "角色主體", role: "character", behavior: "dynamic_content", dynamicFields: ["外觀", "裝備", "狀態"], fixedFields: ["角色舞台位置", "角色輪廓安全區"], component: { reusable: true, type: "character-stage" }, nineGrid: { eligible: false, reason: "需要保留完整連續構圖" } },
    "equipment-slots": { label: "裝備槽面板", role: "panel", behavior: "dynamic_slot", dynamicFields: ["每個槽位的裝備內容", "數值", "空缺狀態"], fixedFields: ["槽位 label", "icon 位置", "操作入口"], children: ["hands-slot", "body-slot", "weapon-slot"], component: { reusable: true, type: "equipment-slot-panel" }, nineGrid: { eligible: false, reason: "這是互動面板，不是單一生成圖片" } },
    "hands-slot": { label: "手套裝備槽", role: "equipment_slot", behavior: "dynamic_slot", dynamicFields: ["裝備圖示", "裝備名稱", "攻速數值", "空缺狀態"], fixedFields: ["槽位 label", "icon 位置", "替換入口"], component: { reusable: true, type: "equipment-slot" }, nineGrid: { eligible: true, reason: "可生成多個手部裝備圖示候選" }, icon: { required: true, purpose: "手部裝備圖示" } },
    "body-slot": { label: "胸甲裝備槽", role: "equipment_slot", behavior: "dynamic_slot", dynamicFields: ["裝備圖示", "裝備名稱", "防禦數值", "空缺狀態"], fixedFields: ["槽位 label", "icon 位置", "替換入口"], component: { reusable: true, type: "equipment-slot" }, nineGrid: { eligible: true, reason: "可生成多個身體防具圖示候選" }, icon: { required: true, purpose: "身體防具圖示" } },
    "weapon-slot": { label: "主武器裝備槽", role: "equipment_slot", behavior: "dynamic_slot", dynamicFields: ["武器圖示", "武器名稱", "傷害數值", "空缺狀態"], fixedFields: ["槽位 label", "icon 位置", "替換入口"], component: { reusable: true, type: "equipment-slot" }, nineGrid: { eligible: true, reason: "可生成多個武器圖示候選" }, icon: { required: true, purpose: "主武器圖示" } },
    "inventory-grid": { label: "裝備卡列", role: "dynamic_list", behavior: "dynamic_list", dynamicFields: ["物品數量", "排序", "篩選結果", "選取狀態"], fixedFields: ["清單欄位", "篩選控制", "卡片結構"], children: ["card-actions"], component: { reusable: true, type: "inventory-list" }, nineGrid: { eligible: true, reason: "裝備卡主視覺適合批次產生候選" } },
    "card-actions": { label: "卡片操作列", role: "action_group", behavior: "fixed", fixedFields: ["DETAILS", "EQUIP"], component: { reusable: true, type: "item-action-row" }, nineGrid: { eligible: false, reason: "互動控制不是生成圖片" }, icon: { required: false, purpose: "可選的詳情與裝備操作圖示" } },
    "primary-action": { label: "主要操作按鈕", role: "button", behavior: "dynamic_state", dynamicFields: ["可用/不可用狀態", "操作文字", "回饋狀態"], fixedFields: ["按鈕 label", "操作位置", "回饋區域"], component: { reusable: true, type: "primary-action" }, nineGrid: { eligible: false, reason: "固定互動元件" }, icon: { required: true, purpose: "進入、確認或穿戴操作圖示" } },
  };
  return defaults[id] ?? {};
}

function normalizeSemanticElement(element, index = 0) {
  const defaults = semanticDefaults(element?.id);
  const component = typeof element?.component === "object" ? element.component : defaults.component || { reusable: false, type: "one-off" };
  const nineGrid = typeof element?.nine_grid === "object" ? element.nine_grid : defaults.nineGrid || { eligible: false, reason: "尚未判定" };
  return {
    ...defaults,
    ...element,
    id: String(element?.id || `element-${index + 1}`),
    label: String(element?.label || element?.name || defaults.label || "未命名元素"),
    name: String(element?.name || element?.label || defaults.label || "未命名元素"),
    role: String(element?.role || defaults.role || "region"),
    behavior: String(element?.behavior || defaults.behavior || "unknown"),
    dynamicFields: Array.isArray(element?.dynamicFields) ? element.dynamicFields : (Array.isArray(element?.dynamic_fields) ? element.dynamic_fields : (defaults.dynamicFields || [])),
    fixedFields: Array.isArray(element?.fixedFields) ? element.fixedFields : (Array.isArray(element?.fixed_fields) ? element.fixed_fields : (defaults.fixedFields || [])),
    children: Array.isArray(element?.children) ? element.children : (defaults.children || []),
    component: { reusable: Boolean(component.reusable), type: String(component.type || "one-off") },
    nine_grid: { eligible: Boolean(nineGrid.eligible), reason: String(nineGrid.reason || "尚未判定") },
    icon: element?.icon || defaults.icon || { required: false, purpose: "不需要額外 icon" },
  };
}

function underlayElements() {
  return (UNDERLAY_ELEMENTS[state.profile] ?? []).map((element, index) => normalizeSemanticElement(element, index));
}

function intersectionArea(first, second) {
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function clipRect(rect, boundary) {
  const left = Math.max(rect.x, boundary.x);
  const bottom = Math.max(rect.y, boundary.y);
  const right = Math.min(rect.x + rect.width, boundary.x + boundary.width);
  const top = Math.min(rect.y + rect.height, boundary.y + boundary.height);
  return { x: left, y: bottom, width: Math.max(5, right - left), height: Math.max(5, top - bottom) };
}

function subframeSuggestions(frame) {
  const rect = activeRect(frame);
  return underlayElements()
    .map((element) => ({ ...element, overlap: intersectionArea(rect, element.rect) / Math.max(1, Math.min(rect.width * rect.height, element.rect.width * element.rect.height)) }))
    .filter((element) => element.overlap >= 0.18)
    .sort((first, second) => second.overlap - first.overlap || (first.rect.width * first.rect.height) - (second.rect.width * second.rect.height))
    .slice(0, 4)
    .map(({ overlap, ...element }) => ({ ...element, sourceRect: element.rect, rect: clipRect(element.rect, rect) }));
}

function normalizedRect(rect, fallback = { x: 10, y: 10, width: 30, height: 20 }) {
  const value = (key, defaultValue) => Number.isFinite(Number(rect?.[key])) ? Number(rect[key]) : defaultValue;
  const width = clamp(value("width", fallback.width), 5, 100);
  const height = clamp(value("height", fallback.height), 5, 100);
  return {
    x: clamp(value("x", fallback.x), 0, 100 - width),
    y: clamp(value("y", fallback.y), 0, 100 - height),
    width,
    height,
  };
}

function reviewSuggestion(result, frame) {
  const current = activeRect(frame);
  const fallbackSubframes = subframeSuggestions(frame);
  const candidates = Array.isArray(result.subframes) && result.subframes.length ? result.subframes : fallbackSubframes;
  const area = current.width * current.height;
  const maxSubframes = area < 600 ? 1 : area < 1500 ? 2 : 4;
  const reviewedSubframes = candidates.slice(0, maxSubframes);
  result.subframes = reviewedSubframes.map((item, index) => {
    const semantic = normalizeSemanticElement(item, index);
    return { ...semantic, rect: clipRect(normalizedRect(item.rect, current), current), sourceRect: item.sourceRect || item.rect };
  });
  result.suggested_rect = clipRect(normalizedRect(result.suggested_rect || result.subframes[0]?.sourceRect || result.subframes[0]?.rect, result.subframes[0]?.rect || current), { x: 0, y: 0, width: 100, height: 100 });
  result.layout = area < 600 ? "single_focus" : result.subframes.length >= 3 ? "nine_grid" : result.subframes.length === 2 ? "two_column" : "single_focus";
  result.review = {
    label: result.provider === "gemma3-local" ? "Gemma 3 回覆 · 已整理" : "離線提示 · 已整理",
    note: result.pipeline ? "先辨識元素，再分開確認每個 rect；最後檢查邊界與重疊。" : candidates.length > result.subframes.length ? "已依 frame 面積收斂拆解候選，避免小區域被過度拆分。" : result.subframes.length ? "已檢查 rect 邊界，並把拆解限制在目前 frame 內。" : "沒有足夠的底層元素，先保留目前尺寸。",
    resize: result.subframes.length > 0,
  };
  return result;
}

function setActiveRect(frame, rect) {
  frame.rects ??= {};
  frame.rects[state.profile] = rect;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function setSelected(id) {
  if (!state.frames.some((frame) => frame.id === id)) return;
  state.selectedId = id;
  suggestion = null;
  render();
}

function frameTop(frame) {
  const rect = activeRect(frame);
  return 100 - rect.y - rect.height;
}

function renderFrameList() {
  frameList.replaceChildren();
  for (const frame of state.frames) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `frame-item${frame.parentId ? " is-child" : ""}${frame.id === state.selectedId ? " is-active" : ""}`;
    button.innerHTML = `<span class="frame-thumb">${frame.id}</span><span><strong>${escapeHtml(frame.name || "未命名 frame")}</strong><span>${escapeHtml(frame.purpose || "尚未描述用途")}</span></span><i class="frame-status ${frame.status}"></i>`;
    button.addEventListener("click", () => setSelected(frame.id));
    frameList.append(button);
  }
  document.querySelector("#frame-count").textContent = `${String(state.frames.length).padStart(2, "0")} frames`;
}

function generatedChildMarkup(child) {
  const role = child.role || "text";
  const label = escapeHtml(child.label || child.name || "未命名元件");
  const data = child.data || child.note || child.purpose || "介面資訊";
  if (role === "image") return `<div class="generated-visual"><span>${label}</span><i>HERO ART</i></div>`;
  if (role === "equipment_slot") return `<div class="generated-slot"><span class="generated-slot-icon">◇</span><span><strong>${label}</strong><small>${escapeHtml(data || "裝備狀態")}</small></span></div>`;
  if (role === "stat") return `<div class="generated-stat"><span>${label}</span><strong>${escapeHtml(data || "—")}</strong></div>`;
  if (role === "progress") return `<div class="generated-progress"><span>${label}</span><i><b></b></i></div>`;
  if (role === "list" || role === "list_row") return `<div class="generated-list-row"><span class="generated-mini-icon">◈</span><span><strong>${label}</strong><small>${escapeHtml(data || "可替換裝備")}</small></span><em>選取</em></div>`;
  if (role === "button") return `<button class="generated-action" type="button">${label}<span>→</span></button>`;
  if (role === "tab") return `<span class="generated-tab">${label}</span>`;
  if (role === "badge") return `<span class="generated-badge">${label}</span>`;
  return `<div class="generated-copy"><strong>${label}</strong><small>${escapeHtml(data)}</small></div>`;
}

function generatedScreenMarkup() {
  const spec = state.generatedSpec;
  const brief = state.brief || {};
  const roots = state.frames.filter((frame) => !frame.parentId);
  return `<div class="generated-ui-topline"><div><span class="generated-brand-mark">✦</span><strong>${escapeHtml(spec?.plan?.screen_title || brief.title || "未命名介面")}</strong><small>${escapeHtml(brief.goal || "")}</small></div><span class="generated-live">GEMMA DRAFT · 1920 × 1080</span></div>${roots.map((frame) => {
    const rect = activeRect(frame);
    const children = state.frames.filter((child) => child.parentId === frame.id);
    const role = String(frame.role || "content").replace(/[^a-z_]/g, "");
    return `<section class="generated-panel generated-panel-${role}" style="left:${rect.x}%;top:${frameTop(frame)}%;width:${rect.width}%;height:${rect.height}%"><header><span>${escapeHtml(frame.role || "PANEL")}</span><strong>${escapeHtml(frame.name || "未命名 panel")}</strong><small>${escapeHtml(frame.purpose || "")}</small></header><div class="generated-panel-content">${children.map(generatedChildMarkup).join("")}</div></section>`;
  }).join("")}`;
}

function renderBoard() {
  const background = document.createElement("div");
  background.className = `mock-screen ${state.profile}`;
  if (state.generatedSpec && state.profile === "desktop") {
    background.classList.add("generated-screen");
    background.innerHTML = generatedScreenMarkup();
  } else if (state.profile === "desktop") {
    background.style.backgroundImage = 'url("/YesSir/_Games/ashen-legion/concept-art/generated-equipment-screen/equipment-screen-mockup-1920x1080-final.png")';
  } else {
    background.innerHTML = `<div class="mock-sky"></div><div class="mock-moon"></div><div class="mock-platform"><span>森林領主</span><i></i><i></i><i></i></div><div class="mock-train"></div>`;
  }
  deviceContent.replaceChildren(background);
  board.dataset.profile = state.profile;
  const visibleFrames = state.generatedSpec ? state.frames.filter((frame) => !frame.parentId) : state.frames;
  for (const frame of visibleFrames) {
    const rect = activeRect(frame);
    const element = document.createElement("button");
    element.type = "button";
    element.className = `frame-rect${frame.id === state.selectedId ? " is-selected" : ""}`;
    element.dataset.frameId = frame.id;
    element.style.left = `${rect.x}%`;
    element.style.top = `${frameTop(frame)}%`;
    element.style.width = `${rect.width}%`;
    element.style.height = `${rect.height}%`;
    element.innerHTML = `<span class="frame-label">${escapeHtml(frame.id)} · ${escapeHtml(frame.name || "未命名")}</span>`;
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.tool === "select") setSelected(frame.id);
    });
    deviceContent.append(element);
  }
  board.classList.toggle("show-grid", state.grid);
  board.classList.toggle("is-drawing", state.tool === "draw");
  document.querySelector("#selection-caption").textContent = selectedFrame() ? `${selectedFrame().id} · ${selectedFrame().name || "未命名 frame"}` : "選取一個 frame 開始";
  document.querySelector("#stage-dimensions").textContent = `${activeProfile().width} × ${activeProfile().height}`;
  document.querySelector("#device-clock").textContent = state.profile === "desktop" ? "" : "9:41";
}

function renderBrief() {
  const brief = state.brief || DEFAULT_STATE.brief;
  for (const [id, value] of [["#brief-title", brief.title], ["#brief-goal", brief.goal], ["#brief-emphasis", brief.emphasis], ["#brief-systems", brief.systems]]) {
    const field = document.querySelector(id);
    if (field && field.value !== (value || "")) field.value = value || "";
  }
  const status = document.querySelector("#brief-status");
  if (status) status.textContent = state.generatedSpec ? `已完成 ${state.frames.filter((frame) => !frame.parentId).length} 個 panel；可以逐個選取修改。` : "人類只提供需求；panel、元件與版面交給 AI。";
}

function renderInspector() {
  const frame = selectedFrame();
  const disabled = !frame;
  document.querySelector("#inspector-id").textContent = frame?.id ?? "—";
  const fields = [
    ["#frame-name", frame?.name ?? ""],
    ["#frame-purpose", frame?.purpose ?? ""],
    ["#frame-note", frame?.note ?? ""],
    ["#frame-ratio", frame?.ratio ?? "auto"],
    ["#frame-status", frame?.status ?? "draft"],
  ];
  for (const [selector, value] of fields) {
    const field = document.querySelector(selector);
    field.value = value;
    field.disabled = disabled;
  }
  document.querySelector("#apply-suggestion").disabled = !suggestion || disabled;
  if (!suggestion) {
    document.querySelector("#assistant-status").textContent = frame?.purpose ? "描述一個 frame，我來拆解它" : "不用先寫完整，AI 會先補用途再拆元素";
    document.querySelector("#assistant-body").innerHTML = `<p class="empty-assistant">單一 frame 用「補全與拆解」；整張畫面用下方「依粗框展開」，先列 panel，再遞迴找出 panel 裡的元件。</p>`;
  } else {
    renderSuggestion();
  }
}

function renderSuggestion() {
  const data = suggestion;
  const subframes = Array.isArray(data.subframes) ? data.subframes : [];
  const suggested = data.suggested_rect;
  const sizeMarkup = suggested
    ? `<div class="suggestion-size"><div class="suggestion-size-head"><strong>AI 尺寸候選</strong><span>${formatRect(suggested)}</span></div><p>${escapeHtml(data.review?.note || "先預覽，再決定要不要套用 AI 尺寸。")}</p><div class="suggestion-size-actions"><button class="resize-button" id="apply-suggested-rect" type="button" ${data.resizeDecision === "applied" ? "disabled" : ""}>${data.resizeDecision === "applied" ? "已採用 AI 尺寸" : "採用 AI 尺寸"}</button><button class="keep-size-button" id="keep-current-rect" type="button" ${data.resizeDecision === "kept" ? "disabled" : ""}>${data.resizeDecision === "kept" ? "已保留目前尺寸" : "保留目前尺寸"}</button></div></div>`
    : "";
  const subframeMarkup = subframes.length
    ? `<div class="suggestion-subframes"><strong>可以繼續拆成 ${subframes.length} 個 frame</strong><div class="subframe-list">${subframes.map((item) => `<div class="subframe-item"><div><strong>${escapeHtml(item.label || item.name || "未命名區域")}</strong><span>${escapeHtml(item.purpose || "可獨立處理的畫面元素")}</span><small>${escapeHtml(behaviorLabel(item.behavior))} · ${item.component?.reusable ? "共用元件" : "單次元素"} · ${item.nine_grid?.eligible ? "可九宮格" : "不建議九宮格"}</small>${item.dynamicFields?.length ? `<small class="dynamic-fields">動態：${escapeHtml(item.dynamicFields.join("、"))}</small>` : ""}${item.children?.length ? `<small>子元素：${escapeHtml(item.children.join("、"))}</small>` : ""}</div></div>`).join("")}</div><button class="subframe-add" id="add-subframes" type="button">＋ 加入這些拆解 frame</button></div>`
    : "";
  document.querySelector("#assistant-status").textContent = `${data.review?.label || (data.provider === "gemma3-local" ? "Gemma 3 本機" : "離線提示")} · ${data.latency_ms ? `${data.latency_ms} ms` : "已回覆"}`;
  const stageCount = data.pipeline?.stages?.length || 0;
  document.querySelector("#assistant-body").innerHTML = `<div class="suggestion-list"><div class="suggestion-line"><span>用途</span><span>${escapeHtml(purposeLabel(data.purpose))}</span></div><div class="suggestion-line"><span>構圖</span><span>${escapeHtml(layoutLabel(data.layout))}</span></div><div class="suggestion-line"><span>建議標題</span><span>${escapeHtml(data.title || "未命名候選")}</span></div><div class="suggestion-line"><span>拆解流程</span><span>${stageCount ? `${stageCount} 個 atomic stage` : "逐項確認"}</span></div></div><p class="suggestion-analysis">${escapeHtml(data.analysis || "先把這個區域當成一個可獨立處理的 frame。")}</p><p class="suggestion-next">${escapeHtml(data.advice || "可以先生成一版，再回頭調整 frame。")}</p>${sizeMarkup}${subframeMarkup}`;
  document.querySelector("#apply-suggested-rect")?.addEventListener("click", applySuggestedRect);
  document.querySelector("#keep-current-rect")?.addEventListener("click", keepCurrentRect);
  document.querySelector("#add-subframes")?.addEventListener("click", addSuggestedFrames);
}

function renderAssets() {
  assetRow.replaceChildren();
  if (!state.assets.length) {
    const empty = document.createElement("div");
    empty.className = "asset-empty";
    empty.textContent = "選一個 frame，建立第一個生成草稿";
    assetRow.append(empty);
    return;
  }
  for (const asset of state.assets) {
    const card = document.createElement("div");
    card.className = "asset-card";
    card.style.setProperty("--asset-gradient", asset.gradient);
    card.innerHTML = `<span class="asset-index">${escapeHtml(asset.id)}</span><strong>${escapeHtml(asset.title)}</strong><span>${escapeHtml(asset.frameId)} · ${escapeHtml(asset.ratio)}</span>`;
    assetRow.append(card);
  }
}

function render() {
  renderBrief();
  renderFrameList();
  renderBoard();
  renderInspector();
  renderHierarchy();
  renderAssets();
  updateToolUI();
  markUnoneContract();
}

const hierarchyRoleLabels = { root: "畫面", panel: "panel", region: "區域", dynamic_list: "動態清單", metric: "數值面板", ability_bar: "技能列", card: "卡片", list: "清單", list_row: "清單列", nav: "導覽", button: "按鈕", image: "圖片", icon: "圖示", heading: "標題", text: "文字", status: "狀態", progress: "進度", stat: "數值", tab: "分頁", equipment_slot: "裝備槽", unknown: "元件" };

function hierarchyNodeMarkup(nodeId, nodes, depth = 0, trail = new Set()) {
  const node = nodes.get(nodeId);
  if (!node || trail.has(nodeId)) return "";
  const nextTrail = new Set(trail).add(nodeId);
  const children = (node.children || []).map((childId) => hierarchyNodeMarkup(childId, nodes, depth + 1, nextTrail)).join("");
  const role = hierarchyRoleLabels[node.role] || node.role || "元件";
  const childLabels = (node.children || []).map((childId) => nodes.get(childId)?.label || nodes.get(childId)?.name).filter(Boolean);
  const open = depth < 2 ? " open" : "";
  const leaf = node.children?.length ? "" : " is-leaf";
  return `<details class="hierarchy-node${leaf}"${open}><summary><span><strong>${escapeHtml(node.label || node.name || "未命名單位")}</strong><small>${escapeHtml(role)} · ${formatRect(node.rect || {})}</small></span><em>${node.children?.length || 0} 子</em></summary><p class="hierarchy-node-purpose">${escapeHtml(node.purpose || "負責組織這個區域的介面內容")}</p>${childLabels.length ? `<p class="hierarchy-node-composition">組成：${escapeHtml(childLabels.join("、"))}</p>` : ""}${children ? `<div class="hierarchy-children">${children}</div>` : ""}</details>`;
}

function renderHierarchy() {
  const card = document.querySelector("#hierarchy-card");
  const body = document.querySelector("#hierarchy-body");
  const data = state.hierarchy;
  if (!card || !body) return;
  if (!data?.hierarchy?.nodes?.length) {
    card.hidden = true;
    body.replaceChildren();
    return;
  }
  const nodes = new Map(data.hierarchy.nodes.map((node) => [node.id, node]));
  const roots = data.hierarchy.root?.children || data.hierarchy.nodes.filter((node) => node.parent_id === "screen").map((node) => node.id);
  document.querySelector("#hierarchy-count").textContent = `${data.hierarchy.nodes.length} nodes · ${roots.length} panels`;
  body.innerHTML = `<div class="hierarchy-tree">${roots.map((id) => hierarchyNodeMarkup(id, nodes)).join("")}</div>`;
  card.hidden = false;
}

function updateToolUI() {
  document.querySelectorAll("[data-tool]").forEach((button) => button.classList.toggle("is-active", button.dataset.tool === state.tool));
  document.querySelectorAll("[data-profile]").forEach((button) => button.classList.toggle("is-active", button.dataset.profile === state.profile));
  document.querySelector("#active-tool-label").textContent = state.tool === "draw" ? "畫 frame 模式" : state.tool === "grid" ? "九宮格檢視" : "選取模式";
}

function updateFrameField(field, value) {
  const frame = selectedFrame();
  if (!frame) return;
  const key = field === "name" ? "name" : field === "purpose" ? "purpose" : field === "note" ? "note" : field;
  frame[key] = value;
  renderFrameList();
  renderBoard();
  markUnsaved();
}

function nextFrameNumber() {
  return state.frames.reduce((highest, frame) => Math.max(highest, Number(frame.id.match(/\d+/)?.[0]) || 0), 0) + 1;
}

function formatRect(rect) {
  return `x${Math.round(rect.x)} y${Math.round(rect.y)} · ${Math.round(rect.width)} × ${Math.round(rect.height)}`;
}

function applySuggestedRect() {
  const frame = selectedFrame();
  if (!frame || !suggestion?.suggested_rect) return;
  setActiveRect(frame, suggestion.suggested_rect);
  frame.status = "needs_review";
  suggestion.resizeDecision = "applied";
  markUnsaved();
  render();
  showToast(`已套用 ${frame.id} 的 AI 尺寸，可以繼續微調`);
}

function keepCurrentRect() {
  if (!suggestion) return;
  suggestion.resizeDecision = "kept";
  renderInspector();
  showToast("已保留目前尺寸；AI 建議仍可參考");
}

function addSuggestedFrames() {
  const parent = selectedFrame();
  const items = suggestion?.subframes ?? [];
  if (!parent || !items.length) return;
  const otherProfile = state.profile === "desktop" ? "mobile" : "desktop";
  const fallback = activeRect(parent);
  let index = nextFrameNumber();
  for (const item of items) {
    const id = `F${String(index++).padStart(2, "0")}`;
    const rect = clipRect(normalizedRect(item.rect, fallback), fallback);
    state.frames.push({
      id,
      name: item.label || item.name || "拆解 frame",
      purpose: item.purpose || "從父 frame 拆出的可獨立處理區域",
      note: item.note || `由 ${parent.id} 拆解`,
      label: item.label || item.name || "拆解 frame",
      role: item.role || "region",
      behavior: item.behavior || "unknown",
      dynamicFields: item.dynamicFields || [],
      fixedFields: item.fixedFields || [],
      component: item.component || { reusable: false, type: "one-off" },
      nine_grid: item.nine_grid || { eligible: false, reason: "尚未判定" },
      icon: item.icon || { required: false, purpose: "不需要額外 icon" },
      children: item.children || [],
      ratio: parent.ratio || "auto",
      status: "draft",
      parentId: parent.id,
      rects: { [state.profile]: rect, [otherProfile]: { x: 15, y: 18, width: 70, height: 16 } },
    });
  }
  suggestion = { ...suggestion, subframes: [] };
  save();
  render();
  showToast(`已從 ${parent.id} 加入 ${items.length} 個拆解 frame`);
}

async function requestAssistant(payload) {
  const response = await fetch(ASSIST_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`assistant ${response.status}`);
  return response.json();
}

function currentBrief() {
  return {
    title: document.querySelector("#brief-title")?.value.trim() || state.brief?.title || "未命名介面",
    goal: document.querySelector("#brief-goal")?.value.trim() || state.brief?.goal || "",
    emphasis: document.querySelector("#brief-emphasis")?.value.trim() || state.brief?.emphasis || "",
    systems: document.querySelector("#brief-systems")?.value.trim() || state.brief?.systems || "",
  };
}

function plannerRectToFrameRect(rect) {
  const top = clamp(Number(rect?.y) || 0, 0, 100);
  const width = clamp(Number(rect?.width) || 10, 5, 100);
  const height = clamp(Number(rect?.height) || 10, 5, 100);
  return normalizedRect({ x: rect?.x, y: 100 - top - height, width, height });
}

function childRectToFrameRect(panelRect, childRect) {
  const parentTop = 100 - panelRect.y - panelRect.height;
  const x = panelRect.x + (Number(childRect?.x) || 0) * panelRect.width / 100;
  const top = parentTop + (Number(childRect?.y) || 0) * panelRect.height / 100;
  const width = Math.max(5, (Number(childRect?.width) || 30) * panelRect.width / 100);
  const height = Math.max(5, (Number(childRect?.height) || 20) * panelRect.height / 100);
  return normalizedRect({ x, y: 100 - top - height, width, height });
}

function buildFrameFirstHierarchy(plan, panelResults) {
  const nodes = [];
  for (const panel of plan.panels || []) {
    const children = panelResults.find((item) => item.panel_id === panel.id)?.children || [];
    nodes.push({ id: panel.id, parent_id: "screen", label: panel.label, role: "panel", purpose: panel.purpose, rect: plannerRectToFrameRect(panel.rect), children: children.map((child) => child.id), source: "gemma-panel-plan" });
    for (const child of children) {
      nodes.push({ id: child.id, parent_id: panel.id, label: child.label, role: child.role, purpose: child.purpose, rect: child.rect, children: [], source: "gemma-panel-children" });
    }
  }
  return {
    root: { id: "screen", label: plan.screen_title || "畫面", children: (plan.panels || []).map((panel) => panel.id) },
    nodes,
  };
}

async function generateInterface() {
  const button = document.querySelector("#generate-interface");
  const status = document.querySelector("#brief-status");
  const brief = currentBrief();
  state.brief = brief;
  button.disabled = true;
  button.innerHTML = "<span>⌁</span><span><strong>Gemma 正在安排…</strong><small>先決定 panel 責任</small></span><span>…</span>";
  try {
    status.textContent = "第 1 步／Gemma 正在決定需要幾個 panel…";
    const boardPayload = { ratio: "16:9", profile: "desktop", width: 1920, height: 1080 };
    let plan = await requestAssistant({ stage: "panel_plan", project: PROJECT, board: boardPayload, brief });
    if (!Array.isArray(plan.panels) || !plan.panels.length) throw new Error("Gemma 沒有產生 panel");
    status.textContent = "第 1.5 步／Gemma 正在檢查 panel 是否擠在一起或留下大空白…";
    const reviewedPlan = await requestAssistant({ stage: "panel_review", project: PROJECT, board: boardPayload, brief, plan });
    if (reviewedPlan.provider === "gemma3-local" && Array.isArray(reviewedPlan.panels) && reviewedPlan.panels.length === plan.panels.length) {
      plan = { ...plan, panels: reviewedPlan.panels, layout: reviewedPlan.layout || plan.layout, geometry_review: reviewedPlan };
    }
    const panelResults = [];
    const componentRegistry = [];
    for (let index = 0; index < plan.panels.length; index += 1) {
      const panel = plan.panels[index];
      status.textContent = `第 2 步／拆解第 ${index + 1} 個 panel：${panel.label || panel.id}…`;
      const result = await requestAssistant({ stage: "panel_children", project: PROJECT, brief, board: boardPayload, panels: plan.panels, panel, component_registry: componentRegistry });
      const panelRect = plannerRectToFrameRect(panel.rect);
      const children = (result.children || []).map((child) => ({ ...child, rect: childRectToFrameRect(panelRect, child.rect) }));
      panelResults.push({ ...result, panel_id: panel.id, children, registry_before: componentRegistry });
      componentRegistry.push({
        panel_id: panel.id,
        panel_label: panel.label,
        panel_role: panel.role,
        children: children.map((child) => ({ id: child.id, label: child.label, role: child.role, purpose: child.purpose })),
      });
    }
    const frames = [];
    for (const panel of plan.panels) {
      const panelRect = plannerRectToFrameRect(panel.rect);
      frames.push({ id: panel.id, name: panel.label, purpose: panel.purpose, note: "由人類需求交給 Gemma 安排", ratio: "auto", status: "needs_review", role: panel.role, rects: { desktop: panelRect, mobile: { x: 8, y: 8, width: 84, height: 26 } } });
      for (const child of panelResults.find((item) => item.panel_id === panel.id)?.children || []) {
        frames.push({ id: child.id, name: child.label, purpose: child.purpose, note: child.data, ratio: "auto", status: "needs_review", role: child.role, behavior: child.behavior, parentId: panel.id, rects: { desktop: child.rect, mobile: { x: 12, y: 12, width: 76, height: 10 } } });
      }
    }
    state.frames = frames;
    state.selectedId = plan.panels[0].id;
    state.profile = "desktop";
    state.hierarchy = { stage: "frame_first", provider: `${plan.provider || "gemma3-local"}+panel-review+panel-children`, plan, geometry_review: plan.geometry_review || reviewedPlan, hierarchy: buildFrameFirstHierarchy(plan, panelResults), panel_results: panelResults, component_registry: componentRegistry, latency_ms: plan.latency_ms || null, analysis: "先由人類說明需求，再由 Gemma 決定 panel 數量，經過版面 QA 後，逐個 panel 拆解元件並同步登記共用元件。" };
    state.generatedSpec = { brief, plan, panelResults, componentRegistry, createdAt: new Date().toISOString() };
    suggestion = null;
    save();
    render();
    showToast(`介面已生成：${plan.panels.length} panels，${frames.length - plan.panels.length} 個子元件`);
  } catch (error) {
    status.textContent = `生成失敗：${error.message || "請確認 Gemma 服務"}`;
    showToast(`生成失敗：${error.message || "未知錯誤"}`);
  } finally {
    button.disabled = false;
    button.innerHTML = "<span>✦</span><span><strong>讓 Gemma 安排介面</strong><small>先決定 panel，再逐一拆解</small></span><span>→</span>";
  }
}

async function screenshotBase64() {
  const response = await fetch(DESIGN_SCREENSHOT_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`screenshot ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  return btoa(binary);
}

async function analyzeHierarchy() {
  const button = document.querySelector("#analyze-hierarchy");
  const roughFrames = state.frames.filter((frame) => !frame.parentId);
  const frames = roughFrames.length ? roughFrames : (selectedFrame() ? [selectedFrame()] : []);
  if (!frames.length) return;
  button.disabled = true;
  button.textContent = "⌁ 正在逐層展開…";
  document.querySelector("#assistant-status").textContent = "先確認粗框 panel，再逐層找內部元件…";
  try {
    const encoded = await screenshotBase64();
    const roughPanels = frames.map((frame) => ({
      id: frame.id,
      name: frame.name,
      label: frame.name,
      purpose: frame.purpose,
      note: frame.note,
      rect: viewportRect(frame),
      hint: "使用者粗略標記的父級 panel；請保留此框，往下找直接子元件。",
    }));
    const result = await requestAssistant({
      stage: "guided_hierarchy",
      screenshot_base64: encoded,
      rough_panels: roughPanels,
      max_depth: 3,
      max_scans: 12,
    });
    if (result.warning && !result.hierarchy?.nodes?.length) throw new Error(result.warning);
    state.hierarchy = result;
    save();
    renderHierarchy();
    document.querySelector("#assistant-status").textContent = `樹狀拆解完成 · ${result.hierarchy?.nodes?.length || 0} nodes`;
    showToast(`已從 ${frames.length} 個粗框展開畫面結構`);
  } catch (error) {
    document.querySelector("#assistant-status").textContent = "樹狀拆解失敗，請確認 Vision 服務";
    showToast(`樹狀拆解失敗：${error.message || "未知錯誤"}`);
  } finally {
    button.disabled = false;
    button.textContent = "⌘ 依粗框展開整張畫面";
  }
}

async function askAssistant() {
  const frame = selectedFrame();
  if (!frame) return null;
  const button = document.querySelector("#ask-assistant");
  button.disabled = true;
  button.textContent = "⌁ 分析用途與元素…";
  document.querySelector("#assistant-status").textContent = "Gemma 3 先辨識畫面元素…";
  const payload = {
    project: { ...PROJECT, profile: state.profile },
    board: { ratio: activeProfile().ratio, profile: state.profile, width: activeProfile().width, height: activeProfile().height, frames: state.frames.map((item) => ({ id: item.id, name: item.name, purpose: item.purpose, parentId: item.parentId, rect: activeRect(item) })), underlay_elements: underlayElements() },
    frame: { id: frame.id, name: frame.name, purpose: frame.purpose, note: frame.note, rect: activeRect(frame), ratio: frame.ratio },
  };
  try {
    const scan = await requestAssistant({ ...payload, stage: "elements" });
    const scannedElements = Array.isArray(scan.elements) ? scan.elements : [];
    const semanticStages = [
      ["label", "label"],
      ["purpose", "用途"],
      ["behavior", "動態或固定"],
      ["dynamic_fields", "動態欄位"],
      ["fixed_fields", "固定欄位"],
      ["children", "子元素"],
      ["component", "共用元件"],
      ["nine_grid", "九宮格候選"],
      ["icon", "icon 用途"],
    ];
    const semanticByKey = new Map(scannedElements.map((item) => [item.id || item.name, normalizeSemanticElement(item)]));
    const microLatency = [];
    const stageLog = [{ stage: "element_scan", latency_ms: scan.latency_ms ?? null, provider: scan.provider || "unknown", returned_count: scannedElements.length }];
    for (const [focus, label] of semanticStages) {
      if (!semanticByKey.size) break;
      document.querySelector("#assistant-status").textContent = `Gemma 3 逐項確認 ${label}…`;
      try {
        const micro = await requestAssistant({ ...payload, stage: "micro_semantics", focus, elements: [...semanticByKey.values()] });
        if (Number.isFinite(micro.latency_ms)) microLatency.push(micro.latency_ms);
        stageLog.push({ stage: `semantic_${focus}`, latency_ms: micro.latency_ms ?? null, provider: micro.provider || "unknown", returned_count: Array.isArray(micro.elements) ? micro.elements.length : 0 });
        for (const item of micro.elements || []) {
          const key = item.id || item.name;
          const current = semanticByKey.get(key);
          if (current) semanticByKey.set(key, normalizeSemanticElement({ ...current, ...item }));
        }
      } catch {
        // One atomic stage may fail; preserve previous fields and continue with the next one.
      }
    }
    const elements = scannedElements.map((item, index) => semanticByKey.get(item.id || item.name) || normalizeSemanticElement(item, index));
    let sizeCheck = { sizes: [] };
    if (elements.length) {
      document.querySelector("#assistant-status").textContent = `Gemma 3 最後確認 ${elements.length} 個元素尺寸…`;
      sizeCheck = await requestAssistant({ ...payload, stage: "sizes", elements });
    }
    const sizeByKey = new Map((sizeCheck.sizes || []).map((item) => [item.id || item.name, item]));
    const result = {
      ...scan,
      ...sizeCheck,
      subframes: elements.map((element) => ({
        ...element,
        ...(sizeByKey.get(element.id) || sizeByKey.get(element.name) || {}),
        rect: (sizeByKey.get(element.id) || sizeByKey.get(element.name) || {}).rect || frame.rect,
        sourceRect: (sizeByKey.get(element.id) || sizeByKey.get(element.name) || {}).rect || frame.rect,
      })),
      suggested_rect: sizeCheck.suggested_rect || sizeCheck.sizes?.[0]?.rect || frame.rect,
      analysis: scan.analysis || (elements.length ? `先辨識到 ${elements.map((item) => item.name).join("、")}，再確認各自的 frame 大小。` : "目前看起來適合先保留成一個整體 frame。"),
      pipeline: { stages: ["element_scan", ...semanticStages.map(([focus]) => `semantic_${focus}`), "size_confirmation", "rule_review"], atomic: true, element_count: elements.length, stage_log: [...stageLog, { stage: "size_confirmation", latency_ms: sizeCheck.latency_ms ?? null, provider: sizeCheck.provider || "unknown", returned_count: Array.isArray(sizeCheck.sizes) ? sizeCheck.sizes.length : 0 }] },
      latency_ms: [scan.latency_ms, ...microLatency, sizeCheck.latency_ms].filter(Number.isFinite).reduce((total, value) => total + value, 0) || null,
    };
    if ((!result.title || /目前用途還不明確|未命名|candidate/i.test(result.title)) && frame.purpose) result.title = frame.purpose.slice(0, 48);
    result.subframes = result.subframes.length ? result.subframes : subframeSuggestions(frame);
    suggestion = reviewSuggestion(result, frame);
    frame.lastAnalysis = {
      version: "atomic-semantic-v2",
      recordedAt: new Date().toISOString(),
      latency_ms: result.latency_ms,
      provider: result.provider,
      pipeline: structuredClone(result.pipeline),
      elements: result.subframes.map(({ id, label, purpose, role, behavior, dynamicFields, fixedFields, children, component, nine_grid, icon, rect }) => ({ id, label, purpose, role, behavior, dynamicFields, fixedFields, children, component, nine_grid, icon, rect })),
    };
    save();
    renderInspector();
    showToast(result.provider === "gemma3-local" ? "Gemma 3 已完成元素辨識與尺寸確認" : "本機助手尚未連線，先用離線提示試走流程");
    return suggestion;
  } catch {
    suggestion = reviewSuggestion(offlineSuggestion(frame), frame);
    renderInspector();
    showToast("Gemma 3 尚未連線，已切換離線提示");
    return suggestion;
  } finally {
    button.disabled = false;
    button.innerHTML = "✦ 補全與拆解";
  }
}

function applySuggestion() {
  const frame = selectedFrame();
  if (!frame || !suggestion) return;
  if (suggestion.title && !/目前用途還不明確|未命名|candidate/i.test(suggestion.title)) frame.name = suggestion.title;
  if (suggestion.label) frame.label = suggestion.label;
  if (!frame.purpose && suggestion.purpose_text) frame.purpose = suggestion.purpose_text;
  else if (!frame.purpose && suggestion.purpose && suggestion.purpose !== "other") frame.purpose = `${purposeLabel(suggestion.purpose)}區域，依照畫面需求配置。`;
  for (const key of ["role", "behavior", "dynamicFields", "fixedFields", "component", "nine_grid", "icon", "children"]) {
    if (suggestion[key] !== undefined) frame[key] = structuredClone(suggestion[key]);
  }
  frame.status = "needs_review";
  markUnsaved();
  render();
  showToast("已套用。你可以繼續調整用途或直接建立草稿");
}

function createDraft() {
  const frame = selectedFrame();
  if (!frame) return;
  const index = state.assets.length + 1;
  const gradients = ["linear-gradient(145deg, #7d8f62, #253520)", "linear-gradient(145deg, #8e6c5f, #2a2420)", "linear-gradient(145deg, #5c8290, #202f31)", "linear-gradient(145deg, #a28756, #302619)"];
  state.assets.unshift({ id: `A${String(index).padStart(2, "0")}`, frameId: frame.id, title: frame.name || "未命名候選", ratio: frame.ratio === "auto" ? activeProfile().ratio : frame.ratio, profile: state.profile, gradient: gradients[(index - 1) % gradients.length] });
  frame.status = "needs_review";
  save();
  render();
  showToast(`已建立 ${frame.id} 的生成草稿；下一步可接 ComfyUI 出圖`);
}

function addFrame() {
  const index = state.frames.length + 1;
  const id = `F${String(index).padStart(2, "0")}`;
  state.frames.push({ id, name: "新 frame", purpose: "", note: "", ratio: "auto", status: "draft", rects: { desktop: { x: 10, y: 42, width: 80, height: 18 }, mobile: { x: 15, y: 18, width: 70, height: 16 } } });
  state.selectedId = id;
  save();
  render();
  showToast(`${id} 已加入畫布，拖曳即可開始調整`);
}

function resetProject() {
  state = structuredClone(DEFAULT_STATE);
  suggestion = null;
  save();
  render();
  showToast("已回到範例畫面");
}

function exportProject() {
  const payload = { protocol: "unone.frame-atelier.v1", project: PROJECT, profiles: BOARD_PROFILES, active_profile: state.profile, board: { ratio: activeProfile().ratio, frames: state.frames.map((frame) => ({ ...frame, rect: activeRect(frame) })) }, assets: state.assets, hierarchy: state.hierarchy, unone: createUnoneTree() };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "yessir-loadout-frame-gdd.json";
  link.click();
  URL.revokeObjectURL(url);
  showToast("GDD JSON 已匯出");
}

function boardPoint(event) {
  const rect = board.getBoundingClientRect();
  return { x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100), top: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100) };
}

function beginDraw(event) {
  if (state.tool !== "draw") return;
  event.preventDefault();
  board.setPointerCapture(event.pointerId);
  const point = boardPoint(event);
  drawing = { pointerId: event.pointerId, start: point, current: point, preview: null };
  updateDrawPreview();
}

function moveDraw(event) {
  if (!drawing || event.pointerId !== drawing.pointerId) return;
  drawing.current = boardPoint(event);
  const crosshair = document.querySelector("#draw-crosshair");
  crosshair.style.display = "block";
  crosshair.style.left = `${drawing.current.x}%`;
  crosshair.style.top = `${drawing.current.top}%`;
  updateDrawPreview();
}

function endDraw(event) {
  if (!drawing || event.pointerId !== drawing.pointerId) return;
  const preview = drawing.preview;
  drawing = null;
  document.querySelector("#draw-crosshair").style.display = "none";
  board.querySelector(".draw-preview")?.remove();
  if (!preview || preview.width < 5 || preview.height < 5) return;
  const index = state.frames.length + 1;
  const id = `F${String(index).padStart(2, "0")}`;
  const rect = { x: preview.x, y: 100 - preview.top - preview.height, width: preview.width, height: preview.height };
  const otherProfile = state.profile === "desktop" ? "mobile" : "desktop";
  state.frames.push({ id, name: "新 frame", purpose: "", note: "", ratio: "auto", status: "draft", rects: { [state.profile]: rect, [otherProfile]: { x: 15, y: 18, width: 70, height: 16 } } });
  state.selectedId = id;
  save();
  render();
  showToast(`${id} 已建立，右側可以輸入它的用途`);
}

function updateDrawPreview() {
  if (!drawing) return;
  const start = drawing.start;
  const current = drawing.current;
  const top = Math.min(start.top, current.top);
  const left = Math.min(start.x, current.x);
  drawing.preview = { x: left, top, width: Math.abs(current.x - start.x), height: Math.abs(current.top - start.top) };
  let preview = board.querySelector(".draw-preview");
  if (!preview) { preview = document.createElement("div"); preview.className = "frame-rect draw-preview"; deviceContent.append(preview); }
  preview.style.left = `${left}%`;
  preview.style.top = `${top}%`;
  preview.style.width = `${drawing.preview.width}%`;
  preview.style.height = `${drawing.preview.height}%`;
  preview.innerHTML = `<span class="frame-label">新 frame</span>`;
}

function setTool(tool) {
  if (tool === "grid") {
    state.grid = !state.grid;
    renderBoard();
    updateToolUI();
    return;
  }
  state.tool = tool;
  renderBoard();
  updateToolUI();
}

function setProfile(profile) {
  if (!BOARD_PROFILES[profile] || profile === state.profile) return;
  state.profile = profile;
  save();
  render();
  showToast(`${activeProfile().label} 版型：${activeProfile().width} × ${activeProfile().height}`);
}

function offlineSuggestion(frame) {
  const text = `${frame.name} ${frame.purpose} ${frame.note}`;
  const purpose = /角色|人物|主角|character/i.test(text) ? "character" : /背景|場景|街|房間|background|scene/i.test(text) ? "background" : /文字|標題|文案|title|copy/i.test(text) ? "text" : /裝備|武器|盔甲|物品|道具|空格|slot|prop|product/i.test(text) ? "prop" : /app|介面|畫面|ui|screen/i.test(text) ? "app_screen" : "image";
  const subframes = subframeSuggestions(frame);
  return { frameId: frame.id, purpose, purpose_text: `${purposeLabel(purpose)}區域，依照畫面需求配置。`, layout: subframes.length > 1 ? "nine_grid" : "single_focus", next: "adjust", title: frame.name && frame.name !== "新 frame" ? frame.name : `${purposeLabel(purpose)}候選`, analysis: subframes.length ? `看見 ${subframes.map((item) => item.label || item.name).join("、")}，可以各自成為可調整的 frame。` : "目前看起來適合先保留成一個整體 frame。", subframes, advice: "先套用用途標籤，再決定是否加入拆解 frame。生成後仍可回到畫布調整大小。", provider: "offline-fallback", confidence: .62, latency_ms: null };
}

function purposeLabel(value) { return ({ character: "角色", app_screen: "APP 畫面", background: "背景", prop: "道具", text: "文字資訊", image: "主視覺", other: "待釐清" })[value] ?? "待釐清"; }
function layoutLabel(value) { return ({ single_focus: "單一焦點", two_column: "雙欄配置", stacked: "上下堆疊", nine_grid: "九宮格" })[value] ?? value ?? "待決定"; }
function behaviorLabel(value) { return ({ fixed: "固定", dynamic_content: "動態內容", dynamic_list: "動態清單", dynamic_value: "動態數值", dynamic_state: "動態狀態", dynamic_slot: "動態槽位", unknown: "待判定" })[value] ?? "待判定"; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }

function createUnoneTree() {
  const frame = selectedFrame();
  return {
    kind: "screen",
    id: "frame_atelier",
    node: "workbench",
    children: [
      { kind: "text", id: "project_title", text: "森林領主 · YesSir", rect: { x: 4, y: 92, width: 30, height: 5 } },
      { kind: "button", id: "add_frame", text: "新增 frame", action: "AddFrame", rect: { x: 89, y: 91, width: 8, height: 5 } },
      { kind: "text", id: "selected_frame", text: frame ? `${frame.id} · ${frame.name}` : "未選取", rect: { x: 35, y: 92, width: 30, height: 5 } },
      { kind: "button", id: "ask_gemma", text: "Gemma 3 補全", action: "AskAssistant", rect: { x: 70, y: 6, width: 13, height: 5 } },
      { kind: "button", id: "export_gdd", text: "匯出 GDD", action: "ExportGdd", rect: { x: 85, y: 6, width: 11, height: 5 } },
    ],
  };
}

function markUnoneContract() {
  const tree = createUnoneTree();
  const validation = validateTree(tree);
  const layout = validation.ok ? inspectLayout(tree, { aspect: 16 / 9 }) : null;
  const ready = validation.ok && layout?.findings?.length === 0;
  document.querySelector("#contract-status").textContent = ready ? "5 nodes · layout clear" : "需要檢查 layout";
  document.querySelector("#contract-dot").classList.toggle("is-error", !ready);
  document.querySelector("#unone-contract").title = ready ? "Unone UI tree validated" : JSON.stringify({ validation, layout });
}

function inspectState() {
  return structuredClone({
    protocol: "unone.frame-atelier.v1",
    project: PROJECT,
    active_profile: state.profile,
    board: activeProfile(),
    frames: state.frames.map((frame) => ({ ...frame, rect: activeRect(frame) })),
    assets: state.assets,
    hierarchy: state.hierarchy,
    assistant: suggestion,
    unone_ui: createUnoneTree(),
  });
}

async function command(name, payload = {}) {
  if (name === "inspect") return inspectState();
  if (name === "select_frame") { setSelected(payload.id); return inspectState(); }
  if (name === "set_profile") { setProfile(payload.profile); return inspectState(); }
  if (name === "add_frame") { addFrame(); return inspectState(); }
  if (name === "update_frame") {
    const frame = state.frames.find((item) => item.id === payload.id) ?? selectedFrame();
    if (!frame) throw new Error("FRAME_NOT_FOUND");
    for (const key of ["name", "purpose", "note", "ratio", "status"]) if (payload[key] !== undefined) frame[key] = String(payload[key]);
    if (payload.rect) setActiveRect(frame, normalizedRect(payload.rect, activeRect(frame)));
    save();
    render();
    return inspectState();
  }
  if (name === "analyze_frame") {
    if (payload.id) setSelected(payload.id);
    await askAssistant();
    return inspectState();
  }
  if (name === "generate_interface") {
    if (payload.brief) state.brief = { ...state.brief, ...payload.brief };
    await generateInterface();
    return inspectState();
  }
  if (name === "analyze_hierarchy") { await analyzeHierarchy(); return inspectState(); }
  if (name === "apply_suggestion") { applySuggestion(); return inspectState(); }
  if (name === "apply_suggested_rect") { applySuggestedRect(); return inspectState(); }
  if (name === "keep_current_rect") { keepCurrentRect(); return inspectState(); }
  if (name === "add_subframes") { addSuggestedFrames(); return inspectState(); }
  if (name === "create_draft") { if (payload.id) setSelected(payload.id); createDraft(); return inspectState(); }
  throw new Error(`UNKNOWN_FRAME_ATELIER_COMMAND: ${name}`);
}

let hostPollBusy = false;
let hostSession = null;

async function hostRequest(path, options = {}) {
  hostSession ??= fetch(`${HOST_API_URL}/session`, { headers: { "X-Frame-Atelier": "1" }, cache: "no-store" })
    .then(async response => {
      if (!response.ok) throw new Error(`FRAME_ATELIER_SESSION_FAILED: ${response.status}`);
      return (await response.json()).token;
    }).catch(error => { hostSession = null; throw error; });
  const token = await hostSession;
  const response = await fetch(`${HOST_API_URL}/${path}`, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
  if (response.status === 401) hostSession = null; // Next poll reconnects after a server restart; never replay mutations.
  if (!response.ok) throw new Error(`FRAME_ATELIER_REQUEST_FAILED: ${response.status}`);
  return response;
}

function syncHostState() {
  if (!window.frameAtelier?.inspect) return;
  hostRequest("state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(window.frameAtelier.inspect()), keepalive: true }).catch(() => {});
}

async function postHostResult(id, result, error = null) {
  await hostRequest("result", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ok: !error, result: error ? null : result, error }) });
}

async function pollHostCommands() {
  if (hostPollBusy || !window.frameAtelier?.command) return;
  hostPollBusy = true;
  try {
    const response = await hostRequest("poll", { cache: "no-store" });
    if (!response.ok) return;
    const { commands = [] } = await response.json();
    for (const request of commands) {
      try {
        const result = await window.frameAtelier.command(request.name, request.payload ?? {});
        await postHostResult(request.id, result);
      } catch (error) {
        await postHostResult(request.id, null, error instanceof Error ? error.message : String(error));
      }
    }
  } catch { /* The command bridge is optional; the local editor remains usable. */ }
  finally { hostPollBusy = false; }
}

// This is the host-side equivalent of an Unone developer protocol surface.
// An agent can inspect and mutate semantic state without looking at pixels.
window.frameAtelier = Object.freeze({
  protocol: "unone.frame-atelier.v1",
  inspect: inspectState,
  command,
});

syncHostState();
window.setInterval(syncHostState, 1000);
window.setInterval(pollHostCommands, 250);

document.querySelectorAll("[data-tool]").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
document.querySelectorAll("[data-profile]").forEach((button) => button.addEventListener("click", () => setProfile(button.dataset.profile)));
document.querySelector("#add-frame").addEventListener("click", addFrame);
document.querySelector("#reset-project").addEventListener("click", resetProject);
document.querySelector("#export-project").addEventListener("click", exportProject);
document.querySelector("#ask-assistant").addEventListener("click", askAssistant);
document.querySelector("#generate-interface").addEventListener("click", generateInterface);
document.querySelector("#analyze-hierarchy").addEventListener("click", analyzeHierarchy);
document.querySelector("#apply-suggestion").addEventListener("click", applySuggestion);
document.querySelector("#generate-draft").addEventListener("click", createDraft);
document.querySelector("#clear-assets").addEventListener("click", () => { state.assets = []; save(); renderAssets(); showToast("已清除生成草稿"); });
document.querySelector("#frame-name").addEventListener("input", (event) => updateFrameField("name", event.target.value));
document.querySelector("#frame-purpose").addEventListener("input", (event) => updateFrameField("purpose", event.target.value));
document.querySelector("#frame-note").addEventListener("input", (event) => updateFrameField("note", event.target.value));
document.querySelector("#frame-ratio").addEventListener("change", (event) => updateFrameField("ratio", event.target.value));
document.querySelector("#frame-status").addEventListener("change", (event) => updateFrameField("status", event.target.value));
for (const [id, key] of [["#brief-title", "title"], ["#brief-goal", "goal"], ["#brief-emphasis", "emphasis"], ["#brief-systems", "systems"]]) {
  document.querySelector(id).addEventListener("input", (event) => {
    state.brief[key] = event.target.value;
    markUnsaved();
  });
}
board.addEventListener("pointerdown", beginDraw);
board.addEventListener("pointermove", moveDraw);
board.addEventListener("pointerup", endDraw);
board.addEventListener("pointercancel", endDraw);

render();
