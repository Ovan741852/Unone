use std::path::Path;

use serde::Serialize;

use crate::diagnostics::{ActionSuggestion, Diagnostic, EngineResult};
use crate::{project::ProjectPaths, systems::SystemSettings};

#[derive(Debug, Clone, Serialize)]
pub struct ApiParameter {
    pub name: String,
    pub type_name: String,
    pub meaning: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiDescriptor {
    pub name: String,
    pub category: String,
    pub purpose: String,
    pub when_to_use: String,
    pub when_not_to_use: String,
    pub parameters: Vec<ApiParameter>,
    pub returns: String,
    pub side_effects: Vec<String>,
    pub frame_semantics: String,
    pub common_errors: Vec<String>,
    pub example: String,
    pub related_apis: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiSearchReport {
    pub query: String,
    pub matches: Vec<ApiDescriptor>,
    pub suggested_next_actions: Vec<ApiSearchAction>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiSearchAction {
    pub action: String,
    pub ready: bool,
    pub executable: Option<String>,
    pub argv: Option<Vec<String>>,
    pub reason: String,
    pub diagnostic: Option<Diagnostic>,
}

/// The canonical Luau type contract for the engine API.
///
/// `project init` inlines this into a new entry script and `game api typings`
/// writes it into an existing project. A test asserts it covers every API in
/// the index below, so a new capability cannot ship without its type.
pub fn typings() -> &'static str {
    include_str!("engine.d.luau")
}

pub fn search(query: &str) -> Vec<ApiDescriptor> {
    let normalized = query.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return descriptors();
    }
    if let Some(exact) = descriptors()
        .into_iter()
        .find(|api| api.name.eq_ignore_ascii_case(&normalized))
    {
        return vec![exact];
    }
    // Intent aliases are scoped to a capability family: searching for "fire"
    // should discover particle authoring, not every API containing "Fire a ...".
    // All meaningful terms must match so natural-language filler does not turn
    // a multi-word request into an unrelated OR search.
    let words: Vec<&str> = normalized
        .split(|c: char| !(c.is_alphanumeric() || c == '_' || c == '.'))
        .filter(|word| !word.is_empty())
        .collect();
    if words.is_empty() {
        return Vec::new();
    }
    let terms: Vec<&str> = words
        .iter()
        .copied()
        .filter(|word| !is_search_filler(word))
        .collect();
    let terms = if terms.is_empty() { &words } else { &terms };
    if let Some(matches) = ui_authoring_search(terms) {
        return matches;
    }
    let components_intent = is_ui_components_query(terms);
    let mut ranked: Vec<_> = descriptors()
        .into_iter()
        .filter_map(|descriptor| {
            if descriptor.name.eq_ignore_ascii_case(&normalized) {
                return Some((1000, descriptor));
            }
            let score = terms.iter().try_fold(0, |total, term| {
                search_term_score(&descriptor, term, components_intent).map(|score| total + score)
            })?;
            Some((score, descriptor))
        })
        .collect();
    ranked.sort_by(|(a, _), (b, _)| b.cmp(a));
    ranked
        .into_iter()
        .map(|(_, descriptor)| descriptor)
        .collect()
}

/// Resolve common authoring questions to callable entrypoints, not imaginary
/// callbacks or the transport schema. Every term must belong to this intent;
/// adding an unknown word cannot turn a query into a broad OR search.
fn ui_authoring_search(terms: &[&str]) -> Option<Vec<ApiDescriptor>> {
    let has = |aliases: &[&str]| terms.iter().any(|term| aliases.contains(term));
    // Ordinary artwork discovery starts with logical resources/instances. GPU
    // acceleration is a host decision; expert projected buffers stay explicit.
    let artwork = ["artwork", "image", "images", "imagebatch", "image_batch", "圖片", "图片", "圖像", "图像", "大量圖片", "大量图片"];
    let artwork_context = ["2d", "gpu", "ui", "retained", "batch", "batches", "batching", "resource", "resources", "camera", "pan", "panning", "transform", "affine", "clip", "crop", "opacity", "pixel", "snap", "pixel_snap", "many", "大量", "相機", "相机", "平移"];
    if let Some(tokens)=fully_segment_ui_terms(terms,&[&artwork[..],&artwork_context[..]].concat()) {
        let image_intent=tokens.iter().any(|term|artwork.contains(term))
            && tokens.iter().any(|term|["gpu","retained","batch","batches","batching","imagebatch","image_batch","many","大量","大量圖片","大量图片"].contains(term));
        let pan_intent=tokens.iter().any(|term|["camera","相機","相机"].contains(term))
            && tokens.iter().any(|term|["pan","panning","平移"].contains(term));
        if image_intent || pan_intent {
            return Some(["ui.imageBatch.define","ui.components.imageBatch","ui.setRoot","ui.imageBatch.remove"].into_iter().filter_map(describe).collect());
        }
    }
    // Explicit responsive composition uses the shared opt-in model. Keep this
    // vocabulary separate from virtual collections and typography: "virtual
    // grid" and "font layout" must retain their established capability routes.
    let responsive = ["responsive", "adaptive", "breakpoint", "breakpoints", "layout", "layouts", "createresponsivelayout", "row", "rows", "column", "columns", "grid", "自適應", "自适应", "響應式", "响应式", "斷點", "断点", "排版", "佈局", "布局", "橫排", "横排", "直排", "網格", "网格"];
    let responsive_context = ["ui", "official", "shared", "reusable", "package", "kit", "create", "build", "component", "components", "control", "controls", "composition", "arrange", "arrangement", "container", "slot", "slots", "padding", "gap", "grow", "fixed", "size", "bounds", "region", "regions", "stage", "scroll", "viewport", "aspect", "portrait", "landscape", "compact", "wide", "resolve", "variant", "variants", "select", "selection", "threshold", "thresholds", "types", "typed", "typings", "官方", "共用", "套件", "建立", "元件", "組件", "组件", "容器", "區域", "区域", "間距", "间距", "內距", "内距", "比例", "螢幕", "屏幕", "直向", "橫向", "横向", "設定", "设置", "如何", "使用", "型別", "类型", "與", "与", "和"];
    if let Some(tokens) = fully_segment_ui_terms(terms, &[&responsive[..], &responsive_context[..]].concat())
        && tokens.iter().any(|term| responsive.contains(term)) {
        return Some(["ui.components.createResponsiveLayout", "ui.components.create", "ui.getViewport", "ui.setRoot"].into_iter().filter_map(describe).collect());
    }
    if has(&["responsive", "adaptive", "breakpoint", "breakpoints", "createresponsivelayout"])
        || terms.iter().any(|term| ["自適應", "自适应", "響應式", "响应式", "斷點", "断点"].iter().any(|alias| term.contains(alias))) {
        return Some(Vec::new());
    }
    // A complete numeric control is the default slider route. The old semantic
    // leaf remains exactly addressable, but does not implement drag/value state.
    let slider = ["slider", "sliders", "createslider", "slidercomponent", "滑桿", "滑杆", "滑塊", "滑块"];
    let slider_context = ["ui", "official", "shared", "reusable", "package", "kit", "create", "build", "component", "components", "control", "controls", "widget", "value", "range", "drag", "dragging", "track", "capture", "pointer", "mouse", "touch", "release", "released", "step", "min", "max", "minimum", "maximum", "snap", "disabled", "vertical", "horizontal", "volume", "settings", "update", "change", "changed", "onchange", "interactive", "draggable", "numeric", "number", "set", "get", "read", "adjust", "handle", "thumb", "可", "互動", "互动", "數字", "数字", "控制", "調整", "调整", "讀取", "读取", "變更", "变更", "官方", "共用", "套件", "建立", "元件", "組件", "组件", "拖曳", "拖動", "拖动", "數值", "数值", "範圍", "范围", "步進", "步进", "放開", "放开", "垂直", "水平", "如何", "使用", "滑鼠", "鼠标", "觸控", "触控", "設定", "设置"];
    if let Some(tokens) = fully_segment_ui_terms(terms, &[&slider[..], &slider_context[..]].concat())
        && tokens.iter().any(|term| slider.contains(term)) {
        return Some(["ui.components.createSlider", "input.getSliderInteraction", "ui.components.slider", "ui.components.create"].into_iter().filter_map(describe).collect());
    }
    let inertia = ["inertia", "momentum", "deceleration", "friction", "慣性", "惯性", "減速", "减速"];
    let inertia_context = ["ui", "scroll", "scrollview", "scroll_view", "view", "virtual", "list", "grid", "scrollable", "content", "configure", "configuration", "set", "settings", "drag", "dragging", "enable", "enabled", "decay", "rate", "speed", "捲動", "滾動", "滚动", "清單", "清单", "列表", "容器", "虛擬", "虚拟", "設定", "设置", "參數", "参数", "速度", "開啟", "开启", "如何", "使用"];
    if let Some(tokens) = fully_segment_ui_terms(terms, &[&inertia[..], &inertia_context[..]].concat())
        && tokens.iter().any(|term| inertia.contains(term)) {
        return Some(["ui.components.scrollView", "ui.components.virtualList", "ui.components.virtualGrid", "ui.scrollView"].into_iter().filter_map(describe).collect());
    }
    let any_press = ["any", "has", "haspressedactions", "pressed", "press", "edge", "edges", "action", "actions", "semantic", "input", "button", "buttons", "discrete", "scan", "scanning", "gate", "任何", "任意", "是否有", "按下", "動作", "动作", "事件", "離散", "离散", "掃描", "扫描"];
    if let Some(tokens)=fully_segment_ui_terms(terms,&any_press)
        && (tokens.contains(&"haspressedactions")
            || (tokens.iter().any(|t|["any","has","任何","任意","是否有"].contains(t))
                && tokens.iter().any(|t|["pressed","press","按下"].contains(t)))) {
        return Some(["input.hasPressedActions","input.wasPressed"].into_iter().filter_map(describe).collect());
    }
    let press = ["click", "clicked", "pressed", "press", "onclick", "buttonclick", "buttonpressed", "按鈕點擊", "按钮点击", "點擊", "点击", "按一下", "按下", "按下瞬間", "按下瞬间", "單次觸發", "单次触发"];
    let release = ["release", "released", "放開", "放开", "釋放", "释放"];
    let hold = ["hold", "held", "holding", "長按", "长按", "按住", "持續按住", "持续按住"];
    let context = ["button", "buttons", "input", "action", "actions", "semantic", "event", "events", "once", "ui", "was", "just", "per", "activation", "down", "reader", "readers", "read", "reads", "reading", "multiple", "two", "both", "repeated", "same", "snapshot", "按鈕", "按钮", "動作", "动作", "讀者", "读者", "讀取", "读取", "多個", "多个", "兩個", "两个", "重複", "重复", "同時", "同时", "如何", "使用"];
    let action_vocabulary = [&press[..], &release[..], &hold[..], &context[..]].concat();
    let action_tokens = fully_segment_ui_terms(terms, &action_vocabulary);
    let action_terms = action_tokens.as_deref().unwrap_or(terms);
    let has_action = |aliases: &[&str]| action_terms.iter().any(|term| aliases.contains(term));
    let action_intent = if has_action(&press) { Some(("input.wasPressed", &press[..])) }
        else if has_action(&release) { Some(("input.wasReleased", &release[..])) }
        else if has_action(&hold) { Some(("input.isDown", &hold[..])) }
        else { None };
    if let Some((name, aliases)) = action_intent {
        if !action_terms.iter().all(|term| aliases.contains(term) || context.contains(term)) {
            return Some(Vec::new());
        }
        return Some([name, "ui.components.button"].into_iter().filter_map(describe).collect());
    }
    // Font configuration is shared node style. "system" is accepted only with
    // an actual font/style term, never as a standalone UI intent.
    let font_terms = ["font", "fonts", "typeface", "typography", "font_family", "font_size", "font_weight", "line_height", "letter_spacing", "text_align", "vertical_align", "weight", "字體", "字体", "字型", "字級", "字号", "字重", "樣式", "样式", "排版", "style", "styles", "styling"];
    let font_context = ["ui", "text", "texts", "label", "labels", "system", "default", "family", "size", "line", "height", "spacing", "alignment", "bold", "normal", "regular", "medium", "light", "semibold", "文字", "系統", "系统", "預設", "预设", "默認", "默认", "大小", "粗細", "粗细", "與", "与", "和", "如何", "調整", "调整", "使用"];
    if let Some(tokens) = fully_segment_ui_terms(terms, &[&font_terms[..], &font_context[..]].concat())
        && tokens.iter().any(|term| font_terms.contains(term)) && !is_ui_components_query(terms) {
        return Some(["ui.setRoot", "ui.inspect"].into_iter().filter_map(describe).collect());
    }
    let constructors: &[(&str, &[&str])] = &[
        ("button", &["button", "buttons", "createbutton", "建立按鈕", "建立按钮", "按鈕元件", "按钮组件", "按鈕", "按钮"]),
        ("slider", &["slider", "sliders", "slidercomponent", "滑桿", "滑杆", "滑塊", "滑块"]),
        ("combobox", &["combobox", "comboboxcomponent", "dropdown", "下拉選單", "下拉选单", "下拉框"]),
        ("scrollView", &["scrollview", "scroll_view", "scrollable", "捲動", "滾動", "滚动", "捲動容器", "滚动容器"]),
        ("virtualList", &["virtuallist", "virtual_list", "虛擬清單", "虚拟清单", "虛擬列表", "虚拟列表"]),
        ("virtualGrid", &["virtualgrid", "virtual_grid", "虛擬網格", "虚拟网格"]),
        ("screen", &["screen", "screens", "螢幕根節點", "屏幕根节点", "畫面", "画面", "界面"]),
        ("panel", &["panel", "panels", "建立面板"]),
        ("image", &["image", "images", "建立圖片", "建立图片"]),
        ("text", &["text", "建立文字"]),
    ];
    let modifiers = ["create", "build", "constructor", "constructors", "component", "components", "control", "controls", "widget", "widgets", "ui", "shared", "reusable", "official", "package", "kit", "建立", "元件", "組件", "组件"];
    for (method, aliases) in constructors {
        let words = match *method {
            "scrollView" => &["scroll", "view", "list", "lists", "content", "可", "清單", "清单", "列表", "容器", "內容", "内容"][..],
            "virtualList" => &["virtual", "list", "虛擬", "虚拟", "清單", "清单", "列表"][..],
            "virtualGrid" => &["virtual", "grid", "虛擬", "虚拟", "網格", "网格"][..],
            "screen" => &["settings", "preferences", "設定", "设定", "設置", "设置", "偏好"][..],
            _ => &[],
        };
        let vocabulary = [*aliases, &modifiers[..], words].concat();
        let Some(tokens) = fully_segment_ui_terms(terms, &vocabulary) else { continue; };
        let phrase_match = match *method {
            "scrollView" => tokens.contains(&"scroll") && tokens.iter().any(|term| ["view", "list", "lists", "content"].contains(term)),
            "virtualList" => (tokens.contains(&"virtual") && tokens.contains(&"list")) || (tokens.iter().any(|term| ["虛擬", "虚拟"].contains(term)) && tokens.iter().any(|term| ["清單", "清单", "列表"].contains(term))),
            "virtualGrid" => (tokens.contains(&"virtual") && tokens.contains(&"grid")) || (tokens.iter().any(|term| ["虛擬", "虚拟"].contains(term)) && tokens.iter().any(|term| ["網格", "网格"].contains(term))),
            _ => false,
        };
        if !tokens.iter().any(|term| aliases.contains(term)) && !phrase_match { continue; }
        // Preserve established typography, panel-background and screen-space
        // searches. Bare control names and explicit constructor questions use
        // the uniform package entrypoint.
        let name = format!("ui.components.{method}");
        if *method == "scrollView" {
            return Some([name.as_str(), "ui.components.virtualList", "ui.components.create", "ui.components.info"].into_iter().filter_map(describe).collect());
        }
        return Some([name.as_str(), "ui.components.create", "ui.components.info"].into_iter().filter_map(describe).collect());
    }
    if has(&["relative", "coordinates", "coordinate", "相對座標", "相对坐标", "元件座標", "组件坐标"])
        && terms.iter().all(|term| ["ui", "component", "components", "children", "child", "relative", "coordinates", "coordinate", "相對座標", "相对坐标", "元件座標", "组件坐标"].contains(term))
    {
        return Some(["ui.components.component", "ui.setRoot"].into_iter().filter_map(describe).collect());
    }
    if has(&["typings", "typed", "types", "型別", "类型", "型別引導", "类型引导"])
        && terms.iter().all(|term| ["ui", "component", "components", "kit", "typings", "typed", "types", "型別", "类型", "型別引導", "类型引导"].contains(term))
    {
        return Some(["ui.components.create", "ui.setRoot"].into_iter().filter_map(describe).collect());
    }
    None
}

/// Segment only against the current capability family's finite vocabulary.
/// English tokens stay whole; Chinese authoring phrases may omit spaces. The
/// dynamic program must consume every byte, so known substrings cannot hide an
/// unknown word or turn a cross-domain query into an OR match.
fn fully_segment_ui_terms<'a>(terms: &[&'a str], vocabulary: &[&str]) -> Option<Vec<&'a str>> {
    let mut tokens = Vec::new();
    for term in terms {
        if vocabulary.contains(term) {
            tokens.push(*term);
            continue;
        }
        if term.is_ascii() {
            return None;
        }
        let mut previous = vec![None; term.len() + 1];
        for start in 0..term.len() {
            if start != 0 && previous[start].is_none() {
                continue;
            }
            for word in vocabulary {
                if term[start..].starts_with(word) {
                    let end = start + word.len();
                    if previous[end].is_none() {
                        previous[end] = Some(start);
                    }
                }
            }
        }
        previous[term.len()]?;
        let mut end = term.len();
        let mut parts = Vec::new();
        while end > 0 {
            let start = previous[end]?;
            parts.push(&term[start..end]);
            end = start;
        }
        tokens.extend(parts.into_iter().rev());
    }
    Some(tokens)
}

fn is_search_filler(word: &str) -> bool {
    matches!(
        word,
        "a" | "an"
            | "and"
            | "api"
            | "can"
            | "change"
            | "adjust"
            | "do"
            | "for"
            | "how"
            | "i"
            | "in"
            | "is"
            | "make"
            | "my"
            | "need"
            | "of"
            | "the"
            | "please"
            | "set"
            | "to"
            | "use"
            | "using"
            | "want"
            | "with"
    )
}

fn is_ui_components_query(terms: &[&str]) -> bool {
    let ui_context = terms.iter().any(|term| matches!(*term, "ui" | "unone"));
    let package_word = terms
        .iter()
        .any(|term| matches!(*term, "package" | "packages" | "kit"));
    (ui_context && package_word)
        || (terms.contains(&"unone") && terms.contains(&"ui"))
        || terms.iter().any(|term| {
            matches!(*term, "theme" | "themes")
                || [
                    "官方ui套件",
                    "官方ui组件",
                    "官方ui元件",
                    "共用元件",
                    "共用组件",
                    "共用ui元件",
                    "共用ui組件",
                    "共用ui组件",
                    "共享ui元件",
                    "共享ui組件",
                    "共享ui组件",
                    "ui元件",
                    "ui組件",
                    "ui组件",
                    "主題樣式",
                    "主题样式",
                ]
                .contains(term)
        })
        || (terms.iter().any(|term| {
            matches!(
                *term,
                "component" | "components" | "controls" | "widgets" | "元件" | "組件" | "组件"
            )
        }) && terms.iter().any(|term| {
            matches!(
                *term,
                "ui" | "shared"
                    | "reusable"
                    | "button"
                    | "buttons"
                    | "card"
                    | "cards"
                    | "styling"
                    | "共用"
                    | "共享"
            )
        }))
        || (terms.len() == 1 && matches!(terms[0], "component" | "components" | "widgets"))
}

fn search_term_score(
    descriptor: &ApiDescriptor,
    term: &str,
    components_intent: bool,
) -> Option<u32> {
    if components_intent {
        let package_term = matches!(
            term,
            "ui" | "unone"
                | "official"
                | "package"
                | "packages"
                | "kit"
                | "theme"
                | "themes"
                | "shared"
                | "reusable"
                | "component"
                | "components"
                | "control"
                | "controls"
                | "widget"
                | "widgets"
                | "button"
                | "buttons"
                | "card"
                | "cards"
                | "style"
                | "styles"
                | "styling"
                | "共用"
                | "共享"
                | "元件"
                | "組件"
                | "组件"
        ) || [
            "官方ui套件",
            "官方ui组件",
            "官方ui元件",
            "共用元件",
            "共用组件",
            "共用ui元件",
            "共用ui組件",
            "共用ui组件",
            "共享ui元件",
            "共享ui組件",
            "共享ui组件",
            "ui元件",
            "ui組件",
            "ui组件",
            "主題樣式",
            "主题样式",
        ]
        .contains(&term);
        if package_term {
            return match descriptor.name.as_str() {
                "ui.components.create" => Some(400),
                "ui.components.info" => Some(300),
                "ui.components.composeStyle" => Some(200),
                "ui.components.id" => Some(150),
                "ui.setRoot" => Some(100),
                _ => None,
            };
        }
        if matches!(
            term,
            "version" | "declared" | "declaration" | "metadata" | "版本"
        ) {
            return match descriptor.name.as_str() {
                "ui.components.info" => Some(600),
                "ui.components.create" => Some(250),
                _ => None,
            };
        }
    }
    let ui_style_intent = matches!(
        term,
        "font"
            | "fonts"
            | "typography"
            | "typeface"
            | "font_family"
            | "font_size"
            | "font_weight"
            | "line_height"
            | "letter_spacing"
            | "text_align"
            | "vertical_align"
            | "border_color"
            | "border_width"
            | "border_radius"
            | "text"
            | "label"
            | "labels"
            | "layout"
            | "style"
            | "styles"
            | "styling"
            | "alignment"
            | "align"
            | "wrap"
            | "wrapping"
            | "color"
            | "colour"
            | "background"
            | "border"
            | "borders"
            | "padding"
            | "spacing"
            | "ellipsis"
            | "overflow"
            | "opacity"
            | "rounded"
            | "radius"
            | "weight"
            | "size"
            | "line"
            | "height"
            | "component"
            | "components"
            | "card"
            | "cards"
            | "panel"
            | "panels"
            | "backgrounds"
            | "background_for"
            | "scope"
            | "scoped"
            | "ancestor"
            | "overlap"
            | "overlaps"
            | "reusable"
            | "shared"
            | "skinning"
            | "control"
            | "controls"
            | "widget"
            | "widgets"
            | "字體"
            | "字体"
            | "字級"
            | "字号"
            | "排版"
            | "樣式"
            | "样式"
            | "文字"
            | "文字換行"
            | "文字换行"
            | "換行"
            | "换行"
            | "對齊"
            | "对齐"
            | "顏色"
            | "颜色"
            | "邊框"
            | "边框"
            | "內距"
            | "内距"
            | "行距"
            | "字距"
            | "共用元件"
            | "卡片背景"
            | "面板背景"
            | "元件背景"
            | "組件背景"
            | "组件背景"
            | "元件重疊"
            | "元件重叠"
            | "組件重疊"
            | "组件重叠"
            | "背景"
            | "重疊"
            | "重叠"
            | "元件"
            | "組件"
            | "组件"
            | "共用组件"
            | "共用"
            | "共享"
            | "共用ui元件"
            | "共用ui組件"
            | "共用ui组件"
            | "共享ui元件"
            | "共享ui組件"
            | "共享ui组件"
            | "ui元件"
            | "ui組件"
            | "ui组件"
    ) || fully_segment_ui_terms(&[term], &[
        "字體",
        "字体",
        "字級",
        "字号",
        "排版",
        "樣式",
        "样式",
        "文字換行",
        "文字换行",
        "對齊",
        "对齐",
        "邊框",
        "边框",
        "內距",
        "内距",
        "共用元件",
        "共用组件",
        "卡片背景",
        "面板背景",
        "元件背景",
        "組件背景",
        "组件背景",
        "元件重疊",
        "元件重叠",
        "組件重疊",
        "组件重叠",
        "大小",
        "與",
        "与",
        "和",
        "如何",
        "處理",
        "处理",
    ])
    .is_some_and(|tokens| tokens.iter().any(|token| !["大小", "與", "与", "和", "如何", "處理", "处理"].contains(token)));
    if ui_style_intent {
        let ui_score = match descriptor.name.as_str() {
            "ui.setRoot" => Some(200),
            "ui.inspect" => Some(100),
            "ui.getViewport" if term == "layout" || term == "排版" => Some(80),
            _ => None,
        };
        if ui_score.is_some() {
            return ui_score;
        }
        // Shared visual terms may also describe world APIs. Keep those normal
        // matches available: e.g. "entity size" must not become UI-only.
        if !matches!(
            term,
            "color"
                | "colour"
                | "background"
                | "opacity"
                | "radius"
                | "weight"
                | "size"
                | "line"
                | "height"
                | "overlap"
                | "overlaps"
        ) {
            return None;
        }
    }
    if matches!(
        term,
        "responsive"
            | "viewport"
            | "aspect"
            | "portrait"
            | "landscape"
            | "螢幕比例"
            | "直向"
            | "橫向"
    ) {
        return match descriptor.name.as_str() {
            "ui.getViewport" => Some(200),
            "ui.setRoot" => Some(100),
            _ => None,
        };
    }
    let visual_intent = matches!(
        term,
        "vfx"
            | "effect"
            | "effects"
            | "particle"
            | "particles"
            | "explosion"
            | "explosions"
            | "thruster"
            | "thrusters"
            | "exhaust"
            | "fire"
            | "flame"
            | "flames"
            | "spark"
            | "sparks"
            | "smoke"
            | "trail"
            | "trails"
            | "aura"
            | "auras"
            | "粒子"
            | "特效"
            | "粒子特效"
            | "爆炸"
            | "尾焰"
            | "火焰"
            | "火花"
            | "煙霧"
            | "烟雾"
            | "軌跡"
            | "轨迹"
            | "光環"
            | "光环"
    );
    if visual_intent {
        return if descriptor.name.starts_with("particle.") {
            // Play is the entry point with authoring and preview guidance.
            Some(if descriptor.name == "particle.play" {
                200
            } else {
                150
            })
        } else if descriptor.name.starts_with("effect.") {
            Some(100)
        } else if descriptor.name.starts_with("shader.")
            && matches!(term, "vfx" | "effect" | "effects")
        {
            Some(50)
        } else {
            None
        };
    }
    if term == "effekseer" {
        return descriptor.name.starts_with("effect.").then_some(200);
    }
    [
        (&descriptor.name, 80),
        (&descriptor.category, 60),
        (&descriptor.purpose, 40),
        (&descriptor.when_to_use, 20),
    ]
    .into_iter()
    .find_map(|(text, score)| text.to_ascii_lowercase().contains(term).then_some(score))
}

/// Search the public engine API and attach the shared no-match guidance.
///
/// An empty query is intentionally a complete index request. A non-empty
/// query with no matches is still a successful search: gameplay verbs may be
/// game-owned composition rather than a missing engine primitive.
pub fn api_search_result(
    project_root: impl AsRef<Path>,
    query: &str,
) -> EngineResult<ApiSearchReport> {
    let matches = search(query);
    let mut result = EngineResult::success(ApiSearchReport {
        query: query.to_string(),
        matches,
        suggested_next_actions: Vec::new(),
    });

    if !query.trim().is_empty()
        && result
            .value
            .as_ref()
            .is_some_and(|report| report.matches.is_empty())
    {
        let mut diagnostic = Diagnostic::warning(
            "API_SEARCH_EMPTY",
            "No matching Engine API found",
            "This search did not match a public Engine API; the gameplay verb may be game-owned composition, so no match does not prove the engine lacks the capability. Inspect the complete API index and systems first, then decide whether a new engine capability is actually needed.",
        );
        diagnostic.facts = serde_json::json!({
            "search_scope": "public_engine_api",
            "query": query,
            "match_count": 0,
        });
        diagnostic.suggested_actions = vec![
            ActionSuggestion {
                action: "search_api_index".to_string(),
                description: "Use the structured executable/argv for action=search_api_index in value.suggested_next_actions to list the complete Engine API index."
                    .to_string(),
                command: None,
            },
            ActionSuggestion {
                action: "list_systems".to_string(),
                description: "Use the structured executable/argv for action=list_systems in value.suggested_next_actions; it is bound to this caller project and remains not ready if the project is unavailable."
                    .to_string(),
                command: None,
            },
        ];
        if let Some(report) = result.value.as_mut() {
            report.suggested_next_actions = suggested_next_actions(project_root.as_ref());
        }
        result.diagnostics.push(diagnostic);
    }

    result
}

fn suggested_next_actions(project_root: &Path) -> Vec<ApiSearchAction> {
    let full_index = ApiSearchAction {
        action: "search_api_index".to_string(),
        ready: true,
        executable: Some("game".to_string()),
        argv: Some(vec![
            "api".to_string(),
            "search".to_string(),
            String::new(),
            "--json".to_string(),
        ]),
        reason:
            "Query the complete public Engine API index; this query does not need project context."
                .to_string(),
        diagnostic: None,
    };

    let systems = match ProjectPaths::discover(project_root) {
        Ok((config, paths)) => match SystemSettings::from_config(&config) {
            Ok(_) => {
                let canonical_project = paths.root.to_string_lossy().into_owned();
                ApiSearchAction {
                    action: "list_systems".to_string(),
                    ready: true,
                    executable: Some("game".to_string()),
                    argv: Some(vec![
                        "--project".to_string(),
                        canonical_project,
                        "--json".to_string(),
                        "systems".to_string(),
                        "list".to_string(),
                    ]),
                    reason: "List the systems actually enabled for this caller project; argv is bound to the canonical project root."
                        .to_string(),
                    diagnostic: None,
                }
            }
            Err(diagnostic) => blocked_systems_action(*diagnostic),
        },
        Err(diagnostic) => blocked_systems_action(*diagnostic),
    };

    vec![full_index, systems]
}

fn blocked_systems_action(diagnostic: Diagnostic) -> ApiSearchAction {
    ApiSearchAction {
        action: "list_systems".to_string(),
        ready: false,
        executable: None,
        argv: None,
        reason: diagnostic.explanation.clone(),
        diagnostic: Some(diagnostic),
    }
}

pub fn describe(name: &str) -> Option<ApiDescriptor> {
    descriptors()
        .into_iter()
        .find(|descriptor| descriptor.name.eq_ignore_ascii_case(name.trim()))
}

fn descriptors() -> Vec<ApiDescriptor> {
    let mut result = vec![
        descriptor(
            "input.getTextInputInteraction", "input",
            "Read the current non-consuming text input and IME event for an official text_input control.",
            "Editable single-line plain text with Chinese IME, paste and keyboard isolation; see docs/ui-text-input.md.",
            "Applications own naming rules, persistence and submit meaning. No callbacks or project DOM.",
            vec![parameter("id","string","Stable published text_input ID")],
            "UiTextInputInteraction?",vec!["Read-only tick snapshot"],
            "Host queues per-ID events in order. Successful tick consumes; failed tick preserves for retry. IME candidate Enter is not submit.",
            vec!["Use matching text-input SDK and official Web host. Native desktop IME is not implemented in this version."],
            "local edit=api.input.getTextInputInteraction(\"nickname\")",vec!["ui.components.textInput"],
        ),
        descriptor(
            "hostTime.sample", "host time",
            "Demand-sample opt-in runtime-origin elapsed host milliseconds, or consume its exact replay sample.",
            "Port rules that explicitly read elapsed host time at individual callsites; tag each read for strict replay.",
            "Not fixed update dt, OS uptime, a media device clock or a background-job clock. Keep game clock domains and u32 policy in Luau.",
            vec![parameter("tag", "string", "1..128 nonblank UTF-8 bytes; exact ordered replay label")],
            "number", vec!["Live reads a monotonic source per call; record also appends bounded tape; replay advances only the matching recorded sample"],
            "Only start/update/onReload. Absent project.host_time is disabled. Timestamps are floor elapsed milliseconds in 0..2^53-1, no wrap; floor is not a resolution guarantee. Faults require full runtime load.",
            vec!["HOST_TIME_DISABLED", "HOST_TIME_REPLAY_MISMATCH", "HOST_TIME_TERMINAL", "HOST_TIME_LIMIT", "HOST_TIME_PHASE"],
            "local now = api.hostTime.sample('scheduler/entry')", vec!["observation.set"],
        ),
        descriptor(
            "application.setEscapeBehavior", "application",
            "Choose whether native Escape quits or publishes a neutral input action.",
            "Let the game handle pause menus and confirmation in Luau.",
            "Does not implement pause, menus, saving or confirmation. Other host close controls keep their host policy.",
            vec![parameter("behavior", "EscapeBehavior", "Exactly 'action' or 'quit'; default 'quit'")],
            "nil", vec!["Change application escape_behavior in the canonical snapshot"],
            "Available from start/update; persists across scene transitions. Action mode routes Escape through the normal key transition queue, including release and focus reset.",
            vec!["APPLICATION_ESCAPE_BEHAVIOR_INVALID"],
            "api.application.setEscapeBehavior('action')", vec!["application.requestQuit", "input.wasPressed"],
        ),
        descriptor(
            "application.requestQuit", "application",
            "Latch a host-neutral application quit request after game-owned confirmation.",
            "Confirm an explicit exit action in game Luau, then let the native host finish presentation and reporting.",
            "Does not ask for confirmation, save game data or claim a headless GPU frame. Browser hosts retain their own close policy.",
            vec![], "nil", vec!["Set canonical application.quit_requested to true; cannot be reset"],
            "Idempotent latch. Native stops further ticks, retries unsuccessful surface presentation, and exits only after the requested snapshot is successfully presented and captured. Headless only records the state.",
            vec![], "api.application.requestQuit()", vec!["application.setEscapeBehavior"],
        ),
        descriptor(
            "instances3d.set",
            "presentation",
            "Replace a packed batch of 3D mesh instances.",
            "Render large populations sharing a mesh; gameplay remains in Lua.",
            "Not entities or rigid bodies; no per-instance callbacks or skeletal animation.",
            vec![
                parameter("id", "string", "Stable batch ID, 1..128 bytes"),
                parameter("asset", "string", "Mesh asset ID"),
                parameter(
                    "transforms",
                    "buffer",
                    "40-byte little-endian f32 records: position.xyz, normalized quaternion.xyzw, nonnegative scale.xyz",
                ),
            ],
            "nil",
            vec!["Replace presentation batch atomically"],
            "Copies the buffer once. Identical bytes keep the previous revision. Pose bytes stay in host packed storage and are excluded from observation digests. JSON/Web memory transports attach them only for presentation.",
            vec![
                "Invalid buffer or transform fails",
                "Maximum 262144 instances and 256 batches per world",
            ],
            "api.instances3d.set(\"crowd\", \"mesh://soldier\", transforms)",
            vec!["instances3d.remove"],
        ),
        descriptor(
            "instances3d.remove",
            "presentation",
            "Remove a 3D instance batch.",
            "Release a game-owned presentation batch.",
            "Does not despawn entities.",
            vec![parameter("id", "string", "Existing batch ID")],
            "nil",
            vec!["Remove presentation batch"],
            "Immediate; missing IDs fail.",
            vec!["Unknown ID fails"],
            "api.instances3d.remove(\"crowd\")",
            vec!["instances3d.set"],
        ),
        descriptor(
            "debug.registerTab",
            "debug",
            "Register a development-only tab with stable ID and label.",
            "Expose game-owned test actions to AI and the human development player.",
            "Never use developer tools for required production gameplay. Guard registration with api.debug.enabled.",
            vec![parameter(
                "tab",
                "DebugTab",
                "Exactly {id,label}; see generated debug-tab schema",
            )],
            "nil",
            vec!["Update development-only metadata; callbacks run only when explicitly invoked"],
            "Registration does not advance simulation. Callback invocation is between ticks and is not a Lua-heap transaction.",
            vec![
                "DEVELOPMENT_ONLY",
                "DEBUG_UNGUARDED",
                "duplicate/unknown ID",
                "invalid callback/value",
            ],
            "if api.debug.enabled then api.debug.registerTab({id=\"qa\",label=\"QA\"}) end",
            vec!["debug.registerTab", "debug.register", "debug.set"],
        ),
        descriptor(
            "debug.register",
            "debug",
            "Register a button/label/checkbox; Lua callback owns the actual game behavior.",
            "Expose game-owned test actions to AI and the human development player.",
            "Never use developer tools for required production gameplay. Guard registration with api.debug.enabled.",
            vec![
                parameter(
                    "control",
                    "DebugControl",
                    "Tagged button/label/checkbox definition; see debug-control schema",
                ),
                parameter(
                    "callback",
                    "function?",
                    "Required for button/checkbox, forbidden for label",
                ),
            ],
            "nil",
            vec!["Update development-only metadata; callbacks run only when explicitly invoked"],
            "Registration does not advance simulation. Callback invocation is between ticks and is not a Lua-heap transaction.",
            vec![
                "DEVELOPMENT_ONLY",
                "DEBUG_UNGUARDED",
                "duplicate/unknown ID",
                "invalid callback/value",
            ],
            "if api.debug.enabled then api.debug.register({id=\"qa.fire\",tab=\"qa\",kind=\"button\",label=\"Fire\"},function() pendingShot=true end) end",
            vec!["debug.registerTab", "debug.register", "debug.set"],
        ),
        descriptor(
            "debug.set",
            "debug",
            "Update a registered label string or checkbox boolean without invoking its callback.",
            "Expose game-owned test actions to AI and the human development player.",
            "Never use developer tools for required production gameplay. Guard registration with api.debug.enabled.",
            vec![
                parameter("id", "string", "Registered label or checkbox ID"),
                parameter(
                    "value",
                    "string | boolean",
                    "Label text or checkbox state; does not invoke callback",
                ),
            ],
            "nil",
            vec!["Update development-only metadata; callbacks run only when explicitly invoked"],
            "Registration does not advance simulation. Callback invocation is between ticks and is not a Lua-heap transaction.",
            vec![
                "DEVELOPMENT_ONLY",
                "DEBUG_UNGUARDED",
                "duplicate/unknown ID",
                "invalid callback/value",
            ],
            "if api.debug.enabled then api.debug.set(\"qa.status\",\"Ready\") end",
            vec!["debug.registerTab", "debug.register", "debug.set"],
        ),
        descriptor(
            "physics3d.sweepSphere",
            "physics3d",
            "Query the earliest continuous sphere contact along a 3D segment against moving sphere targets.",
            "For fast objects that must not tunnel through colliders between frames.",
            "Velocity, integration, gravity, damage, lifetime and collision response belong to Luau; this query does not move entities.",
            vec![parameter(
                "request",
                "table",
                "Exactly {from:Vec3,to:Vec3,radius:number,targets:{id:string,radius:number,previous_position:Vec3}[]}; target current centers come from their Transform3D. At most 1024 unique targets.",
            )],
            "nil or {id:string,fraction:number,point:Vec3,normal:Vec3}; fraction in [0,1]; lexical id breaks equal-time ties.",
            vec!["Read 3D transforms; no mutation"],
            "Sweeps relative linear motion over the supplied endpoints; initial overlap returns fraction zero. Radii are explicit world units, not inferred from meshes.",
            vec![
                "Invalid or unknown request fields",
                "Target missing Transform3D",
                "Disabled physics3d system",
            ],
            "local hit=api.physics3d.sweepSphere({from=p,to=q,radius=0.1,targets={{id=\"target\",radius=0.5,previous_position=old}}})",
            vec!["entity.getTransform3D", "entity.setTransform3D"],
        ),
        descriptor(
            "shader.setMaterial",
            "shader",
            "Assign a declared custom fragment material to a 2D sprite through the official renderer.",
            "For shader effects, shields, hit flashes, glow, distortion, and custom sprite shading without accessing WebGL. Declare scene.shader_materials first; see docs/shader-materials.md and game schema shader.",
            "WebGL sprite materials only; native and WebGPU must report SHADER_BACKEND_UNSUPPORTED. Use particle APIs for trails, sparks and explosions. Custom shader source is trusted author content, not a security sandbox.",
            vec![
                parameter("entityId", "string", "Entity with a 2D sprite."),
                parameter("materialId", "string", "Key in scene.shader_materials."),
            ],
            "nil",
            vec!["Update the entity material selection"],
            "Selection is deterministic snapshot state; the engine renderer owns GPU compilation and resource lifetime.",
            vec![
                "SHADER_MATERIAL_UNKNOWN",
                "SHADER_TARGET_UNSUPPORTED",
                "SHADER_COMPILE_FAILED (host)",
            ],
            "api.shader.setMaterial(\"ship\", \"shield\")",
            vec!["shader.setUniform", "shader.clearMaterial", "particle.play"],
        ),
        descriptor(
            "shader.setUniform",
            "shader",
            "Update a declared float or vector uniform on a shared shader material.",
            "For game-controlled shader parameters; see docs/shader-materials.md. The material definition declares uniform names, types and initial values.",
            "Does not create resources, change shader source, expose a GPU context or alter gameplay collision. A shared material uniform affects all assigned sprites.",
            vec![
                parameter("materialId", "string", "Declared shader material ID."),
                parameter(
                    "name",
                    "string",
                    "Declared uniform name; unone_ and gl_ prefixes are reserved.",
                ),
                parameter(
                    "value",
                    "number | {number}",
                    "Finite f32-compatible scalar or array of 2, 3 or 4 numbers, retaining its declared width.",
                ),
            ],
            "nil",
            vec!["Update shader material uniform state"],
            "Updates are fixed-tick snapshot state. Built-in unone_time and unone_frame derive from simulation time, not wall time.",
            vec![
                "SHADER_MATERIAL_UNKNOWN",
                "SHADER_UNIFORM_UNKNOWN",
                "SHADER_UNIFORM_INVALID",
                "SHADER_UNIFORM_TYPE",
            ],
            "api.shader.setUniform(\"shield\", \"strength\", 0.75)",
            vec!["shader.setMaterial", "shader.clearMaterial"],
        ),
        descriptor(
            "shader.clearMaterial",
            "shader",
            "Restore a sprite's standard engine material.",
            "When a temporary custom sprite shader should end.",
            "Does not remove the material definition or change its shared uniforms.",
            vec![parameter("entityId", "string", "Entity ID.")],
            "nil",
            vec!["Clear the entity material selection"],
            "The official renderer releases unused custom material resources on its next draw.",
            vec!["ENTITY_UNKNOWN"],
            "api.shader.clearMaterial(\"ship\")",
            vec!["shader.setMaterial"],
        ),
        descriptor(
            "particle.play",
            "particle",
            "Play a seeded native declarative JSON particle definition in the official player.",
            "Default for explosions, thrusters, fire, sparks, smoke, trails and auras. Author scene particle_effects; see docs/native-particles.md and docs/particle.schema.json. Preview exact frames and presets in /web/particle-lab/ (Particle Lab).",
            "Use effect.spawn only for external Effekseer assets; do not replace the renderer to implement ordinary particle effects.",
            vec![
                parameter("effect", "string", "Scene particle_effects key."),
                parameter("position", "Vec3", "World-space emission origin."),
                parameter("seed", "number?", "Seed; defaults to zero."),
            ],
            "string: stoppable instance handle.",
            vec!["Create a runtime particle instance"],
            "Births and motion use fixed 60 Hz frame age; active instances retain their definition after an authoring replacement.",
            vec![
                "Unknown effect",
                "Disabled particle system",
                "Particle capacity exceeded",
            ],
            "local handle = api.particle.play(\"spark\", {x=0,y=0,z=0}, 42)",
            vec![
                "particle.move",
                "particle.finish",
                "particle.play_batch",
                "particle.stats",
                "particle.stop",
                "effect.spawn",
            ],
        ),
        descriptor(
            "particle.move",
            "particle",
            "Move an emitter origin while preserving already-emitted particles in world space.",
            "For flame trails, following a moving troop, or drifting aura emitters.",
            "Does not move existing particles; use particle.stop to cancel immediately.",
            vec![
                parameter("handle", "string", "Handle from particle.play."),
                parameter("position", "Vec3", "New world-space emission origin."),
            ],
            "boolean: false when the handle is unknown or belongs to a static batch.",
            vec!["Record one deterministic emission-origin sample"],
            "Samples are keyed to the current fixed simulation frame. Multiple moves in one frame replace that frame's sample.",
            vec!["Invalid or non-finite position", "Disabled particle system"],
            "api.particle.move(handle, troopPosition)",
            vec!["particle.play", "particle.finish"],
        ),
        descriptor(
            "particle.finish",
            "particle",
            "Stop future births and let existing particles finish their authored lifetime.",
            "For the end of a cast/channel or a trail that should taper out.",
            "Use particle.stop for immediate cancellation.",
            vec![parameter("handle", "string", "Handle from particle.play.")],
            "boolean: whether the handle existed.",
            vec!["Truncate the emitter schedule"],
            "Emission ends on the current frame. Existing particles continue analytically until their individual lifetimes expire.",
            vec!["Disabled particle system"],
            "api.particle.finish(handle)",
            vec!["particle.play", "particle.stop"],
        ),
        descriptor(
            "particle.play_batch",
            "particle",
            "Emit one effect at packed positions using one handle.",
            "For projectile trails and many small bursts.",
            "Gameplay selects positions and visual budgets.",
            vec![
                parameter("effect", "string", "Scene particle_effects key."),
                parameter(
                    "positions",
                    "buffer",
                    "Packed f32le xyz positions; 12 bytes each, 1..4096 records; copied.",
                ),
                parameter(
                    "seed",
                    "number?",
                    "Each position uses seed plus its zero-based index, wrapping u64.",
                ),
            ],
            "string: handle stopping every origin in the batch.",
            vec!["Create a bounded particle batch"],
            "Same fixed-frame lifetime as particle.play. Total 4096-particle reservation and 64-handle limits apply. Invalid calls leave the world unchanged.",
            vec![
                "Unknown effect",
                "Invalid positions",
                "Particle capacity exceeded",
            ],
            "local h = api.particle.play_batch(\"trail\", positions, 42)",
            vec!["particle.stats", "particle.stop"],
        ),
        descriptor(
            "particle.stats",
            "particle",
            "Read particle handle and sample budgets.",
            "For AI diagnostics and game-owned effect budgeting.",
            "Does not reserve capacity or change simulation.",
            vec![],
            "table: active_handles, max_handles, reserved_particles, max_particles, live_particles.",
            vec![],
            "Counts include active batches; live count samples the current frame.",
            vec!["Disabled particle system"],
            "local usage = api.particle.stats()",
            vec!["particle.play_batch"],
        ),
        descriptor(
            "particle.stop",
            "particle",
            "Stop a native particle instance.",
            "To cancel a running effect.",
            "Not for Effekseer handles.",
            vec![parameter("handle", "string", "Handle from particle.play.")],
            "boolean: whether the instance existed.",
            vec!["Remove the runtime instance"],
            "Immediate; a second stop returns false.",
            vec!["Disabled particle system"],
            "api.particle.stop(handle)",
            vec!["particle.play"],
        ),
        descriptor(
            "entity.spawn",
            "world",
            "Create an Entity at runtime, bare or assembled with a sprite, mesh, 2D body, transform or animation (runtime spawn, 生成物件).",
            "When enemies, bullets, fish, units or pieces appear during play rather than existing in the scene.",
            "Components use the scene entity field names and defaults (snake_case such as shader_material, body_type). For objects that always exist, prefer the scene source.",
            vec![
                parameter("name", "string", "The Entity display name and base name for its id."),
                parameter("components", "EntityComponents?", "Scene entity fields except id/name: transform, rotation, scale, transform3d, sprite, shader_material, mesh3d, rigidbody, animation, sprite_animation"),
            ],
            "string: the unique Entity id that was created.",
            vec!["Modify Rust-owned world state"],
            "The Entity can be used immediately in the same script update; its id remains valid until despawn or the world is rebuilt. A failed call creates nothing.",
            vec![
                "An empty name uses entity",
                "A duplicate name receives a suffix such as _2 or _3",
                "ENTITY_COMPONENTS_INVALID for unknown fields, a passed id/name or wrong types",
                "Scene validation codes such as SCENE_SPRITE_INVALID or SCENE_PHYSICS_INVALID",
                "SHADER_MATERIAL_REFERENCE_INVALID without a sprite and declared material",
                "UI_PURE_VIEW inside renderItem",
            ],
            "local fish = api.entity.spawn(\"fish\", {transform={x=-8,y=2}, sprite={asset=\"texture://fish/red\", size={x=1.5,y=1}, layer=2}, rigidbody={velocity={x=3,y=0}}})",
            vec!["entity.setSprite", "entity.despawn", "entity.setPosition"],
        ),
        descriptor(
            "entity.despawn",
            "world",
            "Remove an Entity and all of its components.",
            "When an object is defeated, destroyed, or leaves the level.",
            "Do not replace removal with moving the object off-screen: its rigid body still participates in collisions and still consumes a physics integration.",
            vec![parameter("id", "string", "The Entity id to remove.")],
            "(): no additional data on success.",
            vec!["Modify Rust-owned world state"],
            "Takes effect immediately in the same update; contacts for that Entity in the current frame are removed as well.",
            vec!["The Entity does not exist"],
            "api.entity.despawn(\"pig_a\")",
            vec!["entity.spawn", "entity.setSpriteVisible"],
        ),
        descriptor(
            "entity.setSpriteVisible",
            "world",
            "Show or hide an Entity's Sprite while retaining the Entity itself.",
            "When an object must be temporarily hidden while retaining its position, rigid body, or state.",
            "This does not affect collisions: an invisible rigid body still collides. Use entity.despawn for complete removal.",
            vec![
                parameter("id", "string", "The target Entity id."),
                parameter("visible", "boolean", "true to show, false to hide."),
            ],
            "(): no additional data on success.",
            vec!["Modify Rust-owned world state"],
            "The next observation reflects the new value in sprite.visible.",
            vec!["The Entity does not exist", "The Entity has no Sprite"],
            "api.entity.setSpriteVisible(\"pig_a\", false)",
            vec!["entity.despawn"],
        ),
        descriptor(
            "entity.setSprite",
            "world",
            "Replace an Entity's Sprite, for example to swap its asset, size or layer; nil removes it (換圖、更換貼圖).",
            "When a unit, fish, slot symbol or piece changes appearance at runtime.",
            "This replaces the whole sprite, so pass every field you want kept. Use entity.setSpriteVisible to only hide it.",
            vec![
                parameter("id", "string", "The target Entity id."),
                parameter("sprite", "SpriteData?", "asset plus optional size, visible, layer, sheet and frame, as in scene JSON; nil removes the sprite"),
            ],
            "(): no additional data on success.",
            vec!["Modify Rust-owned world state"],
            "The next observation and host frame draw the new sprite.",
            vec![
                "The Entity does not exist",
                "ENTITY_SPRITE_INVALID for unknown fields or wrong types",
                "SCENE_SPRITE_INVALID for a non-positive or non-finite size, an empty or oversized sheet, or a frame outside the sheet",
                "SPRITE_ANIMATION_INVALID when a playing sprite animation uses cells the new sheet lacks",
                "SHADER_MATERIAL_REFERENCE_INVALID when removing a sprite that a shader material uses",
                "UI_PURE_VIEW inside renderItem",
            ],
            "api.entity.setSprite(fish, {asset=\"texture://fish/gold\", size={x=1.5,y=1}, layer=2})",
            vec!["entity.spawn", "entity.setSpriteVisible", "entity.playSpriteAnimation"],
        ),
        descriptor(
            "entity.playSpriteAnimation",
            "world",
            "Play a sprite sheet frame animation (逐格動畫、序列幀) that the engine steps on the fixed tick.",
            "When a sprite with a sheet should walk, swim, flap, swing or blink by cycling its cells.",
            "Not for skeletal (Spine) clips, which use animation.play. The sprite needs sheet = {columns, rows}; cells are numbered from 0 left to right, then top to bottom.",
            vec![
                parameter("id", "string", "The target Entity id."),
                parameter("clip", "SpriteAnimationData", "frames: sheet cells in play order; fps: cells per second (> 0); loop: defaults to true"),
            ],
            "(): no additional data on success.",
            vec!["Modify Rust-owned world state"],
            "A clip played during update first shows its first cell in the next observation. Playing the clip that is already playing, even a finished one, changes nothing; play a different clip or call entity.setSpriteFrame first to restart it. A sprite swap keeps the clip running when its cells exist in the new sheet.",
            vec![
                "The Entity does not exist",
                "SPRITE_ANIMATION_INVALID without a sprite sheet, with no or more than 1024 frames, a frame outside the sheet, a non-positive fps or a wrong field type",
                "OPTION_UNKNOWN_FIELD for a misspelled clip field",
                "UI_PURE_VIEW inside renderItem",
            ],
            "api.entity.playSpriteAnimation(fish, {frames={0,1,2,3}, fps=8})",
            vec!["entity.getSpriteFrame", "entity.setSpriteFrame", "entity.setSprite"],
        ),
        descriptor(
            "entity.setSpriteFrame",
            "world",
            "Draw one cell of an Entity's sprite sheet and stop any sprite animation.",
            "When a piece, card, icon or tile shows a chosen state, or to hold or restart an animation.",
            "To cycle cells over time, use entity.playSpriteAnimation instead of setting a frame every update.",
            vec![
                parameter("id", "string", "The target Entity id."),
                parameter("frame", "number", "Sheet cell from 0, left to right then top to bottom"),
            ],
            "(): no additional data on success.",
            vec!["Modify Rust-owned world state"],
            "The next observation draws the cell; a playing sprite animation stops.",
            vec![
                "The Entity does not exist",
                "SPRITE_FRAME_INVALID without a sprite sheet, for a fractional or negative frame, or one outside the sheet",
                "UI_PURE_VIEW inside renderItem",
            ],
            "api.entity.setSpriteFrame(gem, 5)",
            vec!["entity.playSpriteAnimation", "entity.getSpriteFrame"],
        ),
        descriptor(
            "entity.getSpriteFrame",
            "world",
            "Read the sprite sheet cell an Entity draws now and whether its non-looping sprite animation finished.",
            "When game rules follow an animation, such as dealing damage on a hit cell or returning to idle after a non-looping clip ends.",
            "Both values are fixed-tick state, identical in replays; finished stays false for looping clips and without a clip.",
            vec![parameter("id", "string", "The target Entity id.")],
            "(number, boolean): the cell drawn now and whether a non-looping clip has completed.",
            vec!["Read Rust-owned world state"],
            "Matches what the latest observation shows. A non-looping clip finishes once its last cell has been shown for its full duration, and keeps showing that cell.",
            vec!["The Entity does not exist", "The Entity has no Sprite"],
            "local frame, finished = api.entity.getSpriteFrame(hero)",
            vec!["entity.playSpriteAnimation", "entity.setSpriteFrame"],
        ),
        descriptor(
            "entity.getPosition",
            "world",
            "Read an Entity's current 2D Transform position.",
            "When game rules need to use the current position.",
            "Do not use it in place of scene or prefab source data.",
            vec![parameter("id", "string", "An existing Entity id.")],
            "Vec2: x and y values of type number.",
            vec!["Read Rust-owned world state"],
            "Returns the current value from the start of this update; a read after setPosition reflects the new value on the next read.",
            vec!["A missing Entity id returns LUAU_RUNTIME_ERROR"],
            "local position = api.entity.getPosition(\"player\")",
            vec!["entity.setPosition"],
        ),
        descriptor(
            "entity.setPosition",
            "world",
            "Update an Entity's 2D Transform position.",
            "When Luau game rules need to move an object.",
            "Do not maintain a second Transform in each game; that makes observations and rendering disagree.",
            vec![
                parameter("id", "string", "An existing Entity id."),
                parameter("position", "Vec2", "The new x and y coordinates."),
            ],
            "(): no additional data on success.",
            vec!["Modify Rust-owned world state"],
            "The update takes effect immediately during the current script call; the world frame increments only after the update completes.",
            vec![
                "A missing Entity id returns LUAU_RUNTIME_ERROR",
                "x/y must be numbers",
            ],
            "api.entity.setPosition(\"player\", { x = 1, y = 0 })",
            vec!["entity.getPosition", "entity.spawn"],
        ),
        descriptor(
            "entity.getTransform2D",
            "world",
            "Read an Entity's complete 2D Transform, including position, radian rotation, and visual scale.",
            "When a 2D Entity's position, facing, and size are needed together.",
            "Do not treat visual scale as the RigidBody2D size; the rigid body declares its own collider.",
            vec![parameter("id", "string", "An existing Entity id.")],
            "Transform2D: position is a Vec2, rotation is in radians, and scale is a positive Vec2.",
            vec!["Read Rust-owned 2D world state"],
            "Returns the 2D transform at call time; it does not create a second transform owned by the game.",
            vec!["A missing Entity id returns LUAU_RUNTIME_ERROR"],
            "local transform = api.entity.getTransform2D(\"bird\")",
            vec!["entity.setTransform2D", "entity.getPosition"],
        ),
        descriptor(
            "entity.setTransform2D",
            "world",
            "Update an Entity's complete 2D Transform; rotation and scale affect visuals only.",
            "When Luau needs to update a 2D Entity's position, radian rotation, or visual scale together.",
            "Do not use visual scale to change the collider; RigidBody2D radius, mass, velocity, and contact logic remain independent.",
            vec![
                parameter("id", "string", "An existing Entity id."),
                parameter(
                    "transform",
                    "Transform2D",
                    "A complete position and rotation with scale x/y greater than 0.",
                ),
            ],
            "(): no additional data on success.",
            vec!["Modify Rust-owned 2D visual/world state"],
            "The update takes effect immediately during the current script update; the renderer reads the new visual state from the snapshot, while physics does not read rotation or scale.",
            vec![
                "A missing Entity id returns LUAU_RUNTIME_ERROR",
                "position/rotation must be finite numbers",
                "scale x/y must be greater than 0",
            ],
            "api.entity.setTransform2D(\"bird\", { position = { x = 1, y = 2 }, rotation = 0.5, scale = { x = 1.2, y = 0.8 } })",
            vec!["entity.getTransform2D", "entity.setPosition"],
        ),
        descriptor(
            "entity.getVelocity",
            "physics",
            "Read an Entity's current RigidBody2D velocity.",
            "When game rules need to display, test, or use physical velocity.",
            "For an Entity without a RigidBody2D, declare a physics body in the scene first.",
            vec![parameter(
                "id",
                "string",
                "An Entity id with a RigidBody2D.",
            )],
            "Vec2: the current x and y velocity.",
            vec!["Read Rust-owned physics state"],
            "Returns the velocity after the current physics step; changes made during script update are integrated on the next physics step.",
            vec![
                "A missing Entity id returns LUAU_RUNTIME_ERROR",
                "An Entity without a RigidBody2D returns LUAU_RUNTIME_ERROR",
            ],
            "local velocity = api.entity.getVelocity(\"bird\")",
            vec!["entity.setVelocity", "physics.applyImpulse"],
        ),
        descriptor(
            "entity.getTransform3D",
            "world",
            "Read an Entity's 3D Transform, including position, radian Euler rotation, and scale.",
            "When 3D game rules need to use the current object position or orientation.",
            "For a 2D Entity without a Transform3D, declare a 3D transform in the scene. Do not use it in place of game-owned vehicle, character, or combat state.",
            vec![parameter(
                "id",
                "string",
                "An Entity id with a Transform3D.",
            )],
            "Transform3D: position, rotation, and scale are all Vec3 values.",
            vec!["Read Rust-owned 3D world state"],
            "Returns the 3D transform from the start of this update; it does not create or copy a game-owned transform.",
            vec![
                "A missing Entity id returns LUAU_RUNTIME_ERROR",
                "An Entity without a Transform3D returns LUAU_RUNTIME_ERROR",
            ],
            "local transform = api.entity.getTransform3D(\"car\")",
            vec!["entity.setTransform3D", "camera3d.getTransform"],
        ),
        descriptor(
            "entity.setTransform3D",
            "world",
            "Update an Entity's 3D Transform.",
            "When Luau game rules need to update a 3D object's position, rotation, or scale.",
            "Do not use it as a substitute for 3D physics; the engine currently provides only a transform primitive, while vehicle dynamics and collision rules remain game-owned until multiple games prove that lower-level capability is needed.",
            vec![
                parameter("id", "string", "An Entity id with a Transform3D."),
                parameter(
                    "transform",
                    "Transform3D",
                    "A complete position and rotation with a positive scale.",
                ),
            ],
            "(): no additional data on success.",
            vec!["Modify Rust-owned 3D world state"],
            "The update takes effect immediately during the current script update; the renderer reads it after this frame's simulation snapshot.",
            vec![
                "The Entity id is missing or has no Transform3D",
                "position/rotation must be finite Vec3 values",
                "scale x/y/z must be greater than 0",
            ],
            "api.entity.setTransform3D(\"car\", { position = { x = 0, y = 0, z = 2 }, rotation = { x = 0, y = 0.2, z = 0 }, scale = { x = 1, y = 1, z = 2 } })",
            vec!["entity.getTransform3D", "camera3d.setPosition"],
        ),
        descriptor(
            "entity.setVelocity",
            "physics",
            "Set an Entity's RigidBody2D velocity directly.",
            "When a physical velocity must be reset, constrained, or set for a test.",
            "When continuous force is needed; use applyImpulse or a future force API instead.",
            vec![
                parameter("id", "string", "An Entity id with a RigidBody2D."),
                parameter("velocity", "Vec2", "The new x and y velocity."),
            ],
            "(): no additional data on success.",
            vec!["Modify Rust-owned physics state"],
            "The setting takes effect immediately during the current script update; the following fixed physics step continues updating it using gravity and collisions.",
            vec![
                "The Entity id is missing or has no RigidBody2D",
                "A static body should not be controlled as a dynamic object",
            ],
            "api.entity.setVelocity(\"bird\", { x = 8, y = 5 })",
            vec!["entity.getVelocity", "physics.applyImpulse"],
        ),
        descriptor(
            "physics.applyImpulse",
            "physics",
            "Apply one instantaneous impulse to a dynamic RigidBody2D.",
            "When a launch, collision reaction, or one-time momentum change is needed.",
            "For continuous per-frame acceleration, do not disguise force as impulse; that would make it timestep-dependent.",
            vec![
                parameter("id", "string", "An Entity id with a dynamic RigidBody2D."),
                parameter(
                    "impulse",
                    "Vec2",
                    "The x and y impulse as a mass-independent change in momentum.",
                ),
            ],
            "(): no additional data on success.",
            vec!["Modify Rust-owned physics velocity"],
            "Changes velocity immediately during the current script update; gravity, position integration, and collisions run in the fixed physics step after this update.",
            vec![
                "The Entity does not exist or has no RigidBody2D",
                "A static body cannot receive an impulse",
            ],
            "api.physics.applyImpulse(\"bird\", { x = 12, y = 8 })",
            vec!["entity.getVelocity", "entity.setVelocity"],
        ),
        descriptor(
            "camera.getProjection",
            "camera",
            "Read the single active Camera projection mode.",
            "When camera logic needs to know whether the host is framing an orthographic or perspective view.",
            "Do not create separate 2D and 3D camera state in game code; use one camera transform and switch projection explicitly.",
            vec![],
            "'orthographic' or 'perspective'.",
            vec!["Read Rust-owned camera state"],
            "Returns the projection used by the next renderer draw.",
            vec![],
            "local projection = api.camera.getProjection()",
            vec!["camera.setProjection", "camera.getTransform"],
        ),
        descriptor(
            "camera.setProjection",
            "camera",
            "Switch the single active Camera between orthographic and perspective projection.",
            "When a game changes between a 2D-compatible view and a 3D view without creating a second camera.",
            "Do not keep parallel camera objects; projection is a property of the active Camera.",
            vec![parameter(
                "projection",
                "'orthographic' | 'perspective'",
                "The projection to use.",
            )],
            "(): no additional data on success.",
            vec!["Modify Rust-owned camera state"],
            "The transform is preserved where possible and the next renderer draw uses the selected projection.",
            vec!["projection must be 'orthographic' or 'perspective'"],
            "api.camera.setProjection('perspective')",
            vec!["camera.getProjection", "camera.setTransform"],
        ),
        descriptor(
            "camera.getTransform",
            "camera",
            "Read the single Camera's 3D transform and projection settings.",
            "When camera-follow or editor logic needs one stable camera shape across 2D and 3D scenes.",
            "Do not infer a second camera from legacy `camera3d`; it is only a compatibility projection of this state.",
            vec![],
            "CameraTransform: projection, position, target, fovDegrees, and orthographicSize.",
            vec!["Read Rust-owned camera state"],
            "Returns the canonical camera state for the current update.",
            vec![],
            "local camera = api.camera.getTransform()",
            vec!["camera.setTransform", "camera.setProjection"],
        ),
        descriptor(
            "camera.setTransform",
            "camera",
            "Set the single Camera's transform and optional projection settings.",
            "When a game needs to move or aim a camera while keeping one camera abstraction for both 2D and 3D.",
            "Do not put game-specific follow, shake, or targeting policy in the engine; pass the resulting transform only.",
            vec![parameter(
                "transform",
                "CameraTransformInput",
                "The 3D position, projection, target, and projection-specific values.",
            )],
            "(): no additional data on success.",
            vec!["Modify Rust-owned camera state"],
            "The next renderer draw uses the new camera state; omitted projection keeps the current projection.",
            vec![
                "position coordinates must be finite",
                "perspective requires target",
                "fovDegrees and orthographicSize must be valid when supplied",
            ],
            "api.camera.setTransform({ projection = 'perspective', position = { x = 0, y = 3, z = 8 }, target = { x = 0, y = 0, z = 0 } })",
            vec!["camera.getTransform", "camera.setProjection"],
        ),
        descriptor(
            "camera.getPosition",
            "camera",
            "Compatibility helper: read the active Camera's orthographic x/y position.",
            "When UI or camera-follow logic needs the camera's current position.",
            "Do not treat the camera position as a game character's Transform; characters remain Entities.",
            vec![],
            "Vec2: the camera world position.",
            vec!["Read Rust-owned camera state"],
            "Returns the camera position for the current frame; the renderer uses it on the next draw.",
            vec![],
            "local cameraPosition = api.camera.getPosition()",
            vec!["camera.setPosition", "camera.getZoom"],
        ),
        descriptor(
            "camera.setPosition",
            "camera",
            "Compatibility helper: set the active Camera's orthographic x/y position.",
            "When the camera needs to follow a character or switch the level view.",
            "Do not convert every Entity coordinate to screen coordinates in the game; the renderer uses the camera state.",
            vec![parameter(
                "position",
                "Vec2",
                "The new camera world position.",
            )],
            "(): no additional data on success.",
            vec!["Modify Rust-owned camera state"],
            "The setting takes effect immediately during the current script update; the next renderer draw reflects the new camera.",
            vec!["x/y must be numbers"],
            "api.camera.setPosition({ x = 4, y = 0 })",
            vec!["camera.getPosition", "camera.setZoom"],
        ),
        descriptor(
            "camera.getZoom",
            "camera",
            "Compatibility helper: read the active Camera's orthographic zoom factor.",
            "When the current camera zoom must be displayed or used by camera UI state logic.",
            "Do not use zoom as a substitute for game-world unit conversion; it affects only camera projection.",
            vec![],
            "number: a zoom value greater than 0.",
            vec!["Read Rust-owned camera state"],
            "Returns the current camera zoom; the renderer uses it on the next draw.",
            vec!["The scene zoom must be greater than 0"],
            "local zoom = api.camera.getZoom()",
            vec!["camera.setZoom", "camera.getPosition"],
        ),
        descriptor(
            "camera.setZoom",
            "camera",
            "Compatibility helper: set the active Camera's orthographic zoom factor.",
            "When the visible range must be adjusted for a level or game mode.",
            "Do not pass 0, a negative number, or NaN; invalid values are rejected to avoid an uninterpretable projection.",
            vec![parameter("zoom", "number", "A zoom factor greater than 0.")],
            "(): no additional data on success.",
            vec!["Modify Rust-owned camera state"],
            "The setting takes effect immediately during the current script update; the next renderer draw reflects the new zoom.",
            vec!["zoom must be a finite number greater than 0"],
            "api.camera.setZoom(1.25)",
            vec!["camera.getZoom", "camera.setPosition"],
        ),
        descriptor(
            "animation.play",
            "presentation",
            "Select the skeletal animation clip to play for an Entity.",
            "When a character or object needs skeletal animation; the engine stores only semantic state and the host's Spine runtime performs playback.",
            "Do not use it for game-rule timing; the engine does not evaluate bones, meshes, or blending, and does not report whether playback has finished. For sprite sheet frame animation use entity.playSpriteAnimation.",
            vec![
                parameter("id", "string", "The target Entity id."),
                parameter(
                    "name",
                    "string",
                    "The animation clip name defined by the Spine asset.",
                ),
                parameter(
                    "options",
                    "table?",
                    "Optional asset, loop, and speed; if asset is omitted, use the animation asset declared by the scene.",
                ),
            ],
            "(): no additional data on success.",
            vec!["Modify Rust-owned Entity animation state"],
            "Repeating the same asset/name/loop/speed does not restart playback; started_frame changes only when the clip changes.",
            vec![
                "The Entity does not exist",
                "The animation name is empty",
                "speed is not a finite number greater than 0",
                "No scene-declared asset exists and the call did not provide an asset",
                "system 'spine' is not enabled",
            ],
            "api.animation.play(\"reel-1\", \"spin\", {loop = true, speed = 1.5})",
            vec!["animation.stop", "effect.spawn"],
        ),
        descriptor(
            "animation.stop",
            "presentation",
            "Clear an Entity's skeletal animation state.",
            "When the host should stop playback and remove the Entity's animation.",
            "It does not delete the Entity or restore the default animation declared by the scene.",
            vec![parameter("id", "string", "The target Entity id.")],
            "(): no additional data on success.",
            vec!["Modify Rust-owned Entity animation state"],
            "The Entity's animation field is absent from the next observation.",
            vec!["The Entity does not exist", "system 'spine' is not enabled"],
            "api.animation.stop(\"reel-1\")",
            vec!["animation.play"],
        ),
        descriptor(
            "effect.spawn",
            "presentation",
            "Create an external Effekseer effect instance in world coordinates and return its handle.",
            "For existing Effekseer assets; the engine stores the semantic event while the official player's Effekseer runtime simulates and renders it. For native declarative JSON explosions, fire, sparks and trails, prefer particle.play; see docs/native-particles.md and Particle Lab at /web/particle-lab/.",
            "Do not use it to carry game-rule results. This Effekseer API does not simulate its external particles or determine completion; the separate native particle APIs do simulate deterministic particles.",
            vec![
                parameter("asset", "string", "The effect asset id."),
                parameter(
                    "options",
                    "table?",
                    "Optional x, y, scale, and rotation; defaults are the origin, scale 1, and rotation 0.",
                ),
            ],
            "string: the handle for this effect instance, usable with effect.stop.",
            vec!["Modify Rust-owned effect list"],
            "The handle is assigned by creation order within a run, so identical inputs produce the same handle.",
            vec![
                "asset is empty",
                "scale is not a finite number greater than 0",
                "position or rotation is not finite",
                "More than 256 effects are live at once",
                "system 'effekseer' is not enabled",
            ],
            "local handle = api.effect.spawn(\"effekseer://win\", {x = 0.0, y = 1.0})",
            vec![
                "effect.stop",
                "particle.play",
                "particle.play_batch",
                "animation.play",
            ],
        ),
        descriptor(
            "effect.stop",
            "presentation",
            "Remove an external Effekseer effect instance.",
            "When a looping Effekseer effect must end early or presentation must be cleared during a scene change.",
            "Effekseer instances are not removed automatically; the game decides when to stop them. For native particles use particle.finish or particle.stop, which have authored lifetime semantics.",
            vec![parameter(
                "handle",
                "string",
                "The handle returned by effect.spawn.",
            )],
            "boolean: whether an instance was actually removed.",
            vec!["Modify Rust-owned effect list"],
            "The effects in the next observation no longer include this handle.",
            vec!["system 'effekseer' is not enabled"],
            "api.effect.stop(handle)",
            vec!["effect.spawn", "particle.finish", "particle.stop"],
        ),
        descriptor(
            "audio.play",
            "presentation",
            "Fire a one-shot sound and return its handle.",
            "When something happened that should be heard once: a button press, a reel stopping, a win. The engine records the request as world state; the host decodes and mixes it.",
            "Do not use it for music or anything that should keep playing: a one-shot exists only for the frame it was fired, and the engine never learns when the clip finished. Use audio.loop for that.",
            vec![
                parameter("asset", "string", "The audio asset id."),
                parameter(
                    "options",
                    "table?",
                    "Optional volume (0-1), speed (>0), category, and x/y for a positional sound. Defaults are volume 1, speed 1, no category, not positional.",
                ),
            ],
            "string: the handle for this request, useful for matching it up in a trace.",
            vec!["Modify Rust-owned audio event list"],
            "The event appears in exactly one observation, the one for the frame it was fired, and is gone from the next. Handles are assigned by call order within a run, so identical inputs produce identical handles.",
            vec![
                "asset is empty",
                "volume is not between 0 and 1",
                "speed is not a finite number greater than 0",
                "position is not finite",
                "system 'audio' is not enabled",
            ],
            "api.audio.play(\"sfx://reel-stop\", {category = \"sfx\"})",
            vec!["audio.loop", "audio.stop"],
        ),
        descriptor(
            "audio.loop",
            "presentation",
            "Start a looping sound and return the handle that stops it.",
            "When a sound should keep playing until the game says otherwise: background music, an engine hum, an ambience bed. It stays in the observation, so a reload or a late-joining host knows what should be playing.",
            "Do not use it for one-shots; a loop that nothing stops plays forever, and the engine refuses more than 64 live loops rather than growing without bound.",
            vec![
                parameter("asset", "string", "The audio asset id."),
                parameter(
                    "options",
                    "table?",
                    "Same options as audio.play, plus entity to attach the loop to an entity: the engine then keeps the loop on that entity's position and stops it when the entity is gone. The category is what applies the project's exclusive and fade rules.",
                ),
            ],
            "string: the handle for this loop, required by audio.stop.",
            vec![
                "Modify Rust-owned audio loop list",
                "Stop other loops in an exclusive category",
            ],
            "Starting a loop in an exclusive category begins stopping the ones already in it, honouring their fade_out_frames. A fade is counted in frames by the engine, so it ends on the same frame in every replay.",
            vec![
                "asset is empty",
                "volume is not between 0 and 1",
                "speed is not a finite number greater than 0",
                "More than 64 loops are live at once",
                "system 'audio' is not enabled",
            ],
            "local music = api.audio.loop(\"music://lobby\", {category = \"bgm\"})",
            vec!["audio.stop", "audio.stopAll", "audio.play"],
        ),
        descriptor(
            "audio.stop",
            "presentation",
            "Stop one looping sound.",
            "When a loop should end: leaving a screen, finishing a round, muting an ambience.",
            "It does not stop a one-shot; a one-shot is already over as far as the engine is concerned. It also does not mean the sound is immediately silent: with fade_out_frames the loop stays in the observation, marked fading_out, until the fade ends.",
            vec![parameter(
                "handle",
                "string",
                "The handle returned by audio.loop.",
            )],
            "boolean: whether a loop was actually playing under that handle.",
            vec!["Modify Rust-owned audio loop list"],
            "Without a fade the loop leaves the observation immediately. With one it stays for exactly fade_out_frames more frames, and a second stop on the same handle reports false.",
            vec!["system 'audio' is not enabled"],
            "api.audio.stop(music)",
            vec!["audio.loop", "audio.stopAll"],
        ),
        descriptor(
            "audio.stopAll",
            "presentation",
            "Stop every looping sound.",
            "At a hard boundary where nothing should carry over: a scene change, a restart, a return to the title screen.",
            "Do not use it to stop one track; that loses the ones the game meant to keep. Category fades still apply, so this is not an instant silence.",
            vec![],
            "number: how many loops were playing.",
            vec!["Modify Rust-owned audio loop list"],
            "Each stopped loop honours its own category fade, exactly as if audio.stop had been called on it.",
            vec!["system 'audio' is not enabled"],
            "api.audio.stopAll()",
            vec!["audio.stop", "audio.loop"],
        ),
        descriptor(
            "audio.pause",
            "presentation",
            "Pause one looping sound without losing it.",
            "A pause menu, a cutscene, a lost window focus: the loop should stop making noise but still be there, still where it was in its fade, ready to carry on.",
            "Do not use it to end a sound; a paused loop still counts against the 64 live loops and still needs a stop. It has no meaning for a one-shot, which is already over.",
            vec![parameter(
                "handle",
                "string",
                "The handle returned by audio.loop.",
            )],
            "boolean: whether the loop changed state (false if it was already paused or the handle is unknown).",
            vec!["Modify Rust-owned audio loop list"],
            "A paused loop does not advance through its fade: its phase deadline moves with it, so resuming continues from exactly where it stopped.",
            vec!["system 'audio' is not enabled"],
            "api.audio.pause(music)",
            vec!["audio.resume", "audio.pauseAll", "audio.stop"],
        ),
        descriptor(
            "audio.resume",
            "presentation",
            "Resume one paused loop.",
            "When the pause is over and playback should continue from where it stopped.",
            "It does not restart the loop from the beginning, and it does nothing to a loop that was stopped rather than paused.",
            vec![parameter(
                "handle",
                "string",
                "The handle returned by audio.loop.",
            )],
            "boolean: whether the loop changed state.",
            vec!["Modify Rust-owned audio loop list"],
            "Any fade continues from the frame it was paused on, not from now.",
            vec!["system 'audio' is not enabled"],
            "api.audio.resume(music)",
            vec!["audio.pause", "audio.resumeAll"],
        ),
        descriptor(
            "audio.pauseAll",
            "presentation",
            "Pause every looping sound.",
            "The pause menu. One call, and nothing has to remember which loops were playing.",
            "Do not use it as a scene change; stopped and paused are different, and everything paused here is still live.",
            vec![],
            "number: how many loops changed state.",
            vec!["Modify Rust-owned audio loop list"],
            "Every paused loop holds its place in its fade, so resuming restores the mix exactly.",
            vec!["system 'audio' is not enabled"],
            "api.audio.pauseAll()",
            vec!["audio.resumeAll", "audio.pause"],
        ),
        descriptor(
            "audio.resumeAll",
            "presentation",
            "Resume every paused loop.",
            "Leaving the pause menu.",
            "It does not start anything that was stopped, only what was paused.",
            vec![],
            "number: how many loops changed state.",
            vec!["Modify Rust-owned audio loop list"],
            "Each loop continues from the frame it was paused on.",
            vec!["system 'audio' is not enabled"],
            "api.audio.resumeAll()",
            vec!["audio.pauseAll"],
        ),
        descriptor(
            "audio.setMasterVolume",
            "presentation",
            "Set the master bus level.",
            "The overall volume slider on a settings screen.",
            "It is not a mute switch with a memory: setting 0 forgets the previous level, so a game that wants mute-and-restore remembers the old value itself.",
            vec![parameter("volume", "number", "0 to 1.")],
            "(): no additional data on success.",
            vec!["Modify Rust-owned audio mix"],
            "The mix is published in the observation as soon as it leaves its declared default, so a replay reproduces the same levels and a test can assert them. The host multiplies source volume by category level by master level.",
            vec![
                "volume is not between 0 and 1",
                "system 'audio' is not enabled",
            ],
            "api.audio.setMasterVolume(0.8)",
            vec!["audio.getMasterVolume", "audio.setCategoryVolume"],
        ),
        descriptor(
            "audio.getMasterVolume",
            "presentation",
            "Read the master bus level.",
            "Drawing the settings screen the game just changed.",
            "It does not report what the player actually hears; the operating system and the player's own volume are not the engine's to know.",
            vec![],
            "number: the current master level.",
            vec![],
            "Reads the value the game last set, or 1.0.",
            vec!["system 'audio' is not enabled"],
            "local level = api.audio.getMasterVolume()",
            vec!["audio.setMasterVolume"],
        ),
        descriptor(
            "audio.setCategoryVolume",
            "presentation",
            "Set one category's bus level.",
            "The separate music and effects sliders every settings screen has. The category is the game's own name for a group of sounds; the level applies to every sound in it.",
            "It does not change the volume a sound was started with; that is the source's own level and the two multiply, the same way a mixer group works.",
            vec![
                parameter("category", "string", "The category name."),
                parameter("volume", "number", "0 to 1."),
            ],
            "(): no additional data on success.",
            vec!["Modify Rust-owned audio mix"],
            "Takes effect on the next observation and is published with it. A category the project never declared may still be set; it starts at 1.0.",
            vec![
                "category is empty",
                "volume is not between 0 and 1",
                "system 'audio' is not enabled",
            ],
            "api.audio.setCategoryVolume(\"bgm\", 0.4)",
            vec!["audio.getCategoryVolume", "audio.setMasterVolume"],
        ),
        descriptor(
            "audio.getCategoryVolume",
            "presentation",
            "Read one category's bus level.",
            "Drawing a settings slider at the position the game left it.",
            "It does not tell you whether anything in that category is playing.",
            vec![parameter("category", "string", "The category name.")],
            "number: the current level, or the project's declared default, or 1.0.",
            vec![],
            "Reads the value the game last set for that category.",
            vec!["system 'audio' is not enabled"],
            "local level = api.audio.getCategoryVolume(\"bgm\")",
            vec!["audio.setCategoryVolume"],
        ),
        descriptor(
            "input.getPhysicalBatch","input",
            "Read detached ordered physical events for this tick without consuming them.",
            "Physical keyboard pointer wheel modifiers ordered queue focus capture blur pixel coordinates.",
            "Requires explicit host ordered_physical_v1; game owns scan codes, UI/context and command policy.",
            vec![],"PhysicalInputBatch?",vec!["Read-only tick-scope value; nil outside tick and for omitted legacy input"],
            "Repeated reads are equal detached values. Successful tick commits receipt/epoch/cursor/time; accepted execution fault is terminal, not a World rollback.",
            vec!["Official Web main/worker live only; Native/custom live unsupported; no typed text, IME, presented-view or activegesture restore guarantee"],
            "local batch=api.input.getPhysicalBatch() if batch then for _,event in ipairs(batch.events) do handlePhysical(event) end end",
            vec!["input.wasPressed","input.getScreenPointerPosition"],
        ),
        descriptor(
            "input.isDown",
            "input",
            "Query whether an action is down in the current frame.",
            "For continuous movement, hold or long press (長按/长按). UI button actions use the same semantic names. For one activation per press use input.wasPressed; for release use input.wasReleased. See docs/ui-components.md.",
            "Do not read platform keyboard key codes in game logic; platform input should first be mapped to an action.",
            vec![parameter(
                "action",
                "string",
                "A game-defined semantic action, such as Right.",
            )],
            "boolean: whether the action is down now.",
            vec!["Read the current frame's input snapshot"],
            "The result is stable during the same update; a headless test can inject fixed input using the same action name.",
            vec!["An unknown action name is treated as false"],
            "if api.input.isDown(\"Right\") then ... end",
            vec!["input.wasPressed", "input.wasReleased", "ui.components.button", "entity.setPosition"],
        ),
        descriptor(
            "input.wasPressed",
            "input",
            "Read a non-consuming semantic action press edge: down now and not down in the previous successful tick.",
            "For button click, button pressed, once-per-press activation, 按鈕點擊, 按一下 or 按下瞬間. Use a button's action string; create it through ui.components.button or a themed kit. See docs/ui-components.md.",
            "Not a DOM onClick callback or an OS event queue. Use input.isDown for held movement; UI callbacks do not mutate the game model automatically.",
            vec![parameter("action", "string", "The same semantic action string declared by the control or input mapping.")],
            "boolean: action is down in the current snapshot and was absent from the previous successful tick.",
            vec!["Read-only input snapshot; never consumes the edge"],
            "Stable across repeated reads during one update. Only successful ticks advance the previous snapshot; reads, rendering, scrolling and failed updates do not. The initial previous state is released. A pulse wholly between snapshots is not queued.",
            vec!["Unknown action names return false; a held action does not repeat after its first tick. Do not guess input.isActionJustPressed or onClick."],
            "if api.input.wasPressed(\"ApplySettings\") then applySettings() end",
            vec!["input.wasReleased", "input.isDown", "ui.components.button", "ui.components.combobox"],
        ),
        descriptor(
            "input.hasPressedActions",
            "input",
            "Read whether the current semantic press-edge snapshot contains any action, in O(1).",
            "Gate a large discrete wasPressed action scanner when no action was newly pressed. Search any pressed action, has pressed actions, 是否有按下動作 or 任意按下事件. Keep action dispatch and gameplay in Luau.",
            "Do not skip the whole update, held movement, release handling, pointer/drag, text editing or slider interaction work. Raw physical events alone are not semantic presses.",
            vec![],
            "boolean: at least one action would return true from wasPressed(action) in this same tick snapshot.",
            vec!["Read-only O(1) input snapshot; never consumes an edge or scans action names"],
            "Uses the same pressed set as wasPressed. Stable across repeated reads; only successful ticks advance the prior held snapshot. Failed execution restores the previously published press snapshot, reload preserves it, and a fresh runtime starts false. Existing host/UI/physical mappings and replay feed the same semantic actions; held-only, release-only, raw-physical-only, text-only and slider-only input do not create a press.",
            vec!["Takes no arguments or option table; unexpected arguments are rejected. This is not an any-input-activity or pending-event query."],
            "if api.input.hasPressedActions() then scanDiscreteCommands(api.input) end",
            vec!["input.wasPressed", "input.wasReleased", "input.isDown", "input.getPhysicalBatch", "input.getSliderInteraction", "input.getTextInputInteraction"],
        ),
        descriptor(
            "input.wasReleased",
            "input",
            "Read a non-consuming semantic action release edge: up now and down in the previous successful tick.",
            "For release, released, 放開/放开 or 釋放/释放 transitions of semantic input actions. See docs/ui-components.md.",
            "Not a platform pointer-up callback. For press activation use input.wasPressed; for continuous state use input.isDown.",
            vec![parameter("action", "string", "A semantic control or mapped input action, not a platform key code.")],
            "boolean: action is absent now and was down in the previous successful tick.",
            vec!["Read-only input snapshot; never consumes the edge"],
            "Stable across repeated reads during one update. Only successful ticks advance the previous snapshot. Initially released; omitted actions become released. A pulse wholly between snapshots is not queued.",
            vec!["Unknown actions return false unless they were actually held in the previous successful tick. No callbacks or event consumption."],
            "if api.input.wasReleased(\"Charge\") then releaseCharge() end",
            vec!["input.wasPressed", "input.isDown", "ui.components.button"],
        ),
        descriptor(
            "input.getSliderInteraction",
            "input",
            "Read a non-consuming semantic slider event for this successful simulation tick; prefer the official createSlider control for numeric dragging.",
            "Advanced control implementations and deterministic tests. Official Web/native hosts hit-test the projected/clipped slider, capture its pointer and normalize its track ratio. Ordinary projects call control.update(api.input) instead of writing pointer geometry.",
            "Not a persistent value, callback or screen-pointer sample. Do not poll it during virtual renderItem or invent events from local scroll coordinates.",
            vec![parameter("id", "string", "Stable ID of the slider control published by createSlider().view().")],
            "UiSliderInteraction? = {phase:'start'|'drag'|'end'|'cancel',ratio:number in 0..1}; nil when no event was delivered this tick.",
            vec!["Read-only; multiple reads never consume the event"],
            "The current tick snapshot is stable. Successful ticks consume pending events; a following tick without input has nil, while a failed tick preserves pending events for retry. Hosts retain start/end/cancel order and coalesce adjacent drag samples.",
            vec!["Use matching SDK/Core/player templates with @unone/ui 0.6.0. ui_sliders frames reject unknown phase, non-finite/out-of-range ratio, blank/oversized ID and more than 256 controls."],
            "local event = api.input.getSliderInteraction(\"volume\") -- advanced: ordinary code uses volume.update(api.input)",
            vec!["ui.components.createSlider", "ui.components.slider"],
        ),
        descriptor(
            "input.getPointerPosition",
            "input",
            "Read the pointer position converted to world space by the platform adapter.",
            "When game rules need a drag, aim, click, or touch position.",
            "Do not process screen pixels, device scale, or platform coordinates in Luau; that is the platform adapter's responsibility.",
            vec![],
            "Vec2: the pointer's current world position.",
            vec!["Read the current frame's pointer snapshot"],
            "The result is stable during the same update; a headless test can inject a world-space pointer directly.",
            vec![],
            "local pointer = api.input.getPointerPosition()",
            vec!["input.isPointerDown", "camera.getPosition"],
        ),
        descriptor(
            "input.getScreenPointerPosition",
            "input",
            "Read the pointer position converted by the platform adapter into normalized 0..100 × 0..100 logical UI space.",
            "When the game must hit-test a declarative UI button or map a touch position into its own UI design space.",
            "Do not process screen pixels, device scale, DPI, or safe area in Luau; the host should normalize them into 0..100 cross-platform logical UI coordinates first.",
            vec![],
            "Vec2: the pointer's current normalized 0..100 logical screen/UI position.",
            vec!["Read the current frame's screen-space pointer snapshot"],
            "The result is stable during the same update; a headless test can inject screen_position directly, and world position is the explicit fallback when it is absent.",
            vec![],
            "local pointer = api.input.getScreenPointerPosition()",
            vec!["input.isPointerDown", "input.getPointerPosition"],
        ),
        descriptor(
            "input.isPointerDown",
            "input",
            "Query whether the primary pointer/touch is down in the current frame.",
            "When game rules need to detect the start of a drag, continued aiming, or release timing.",
            "Do not treat it as a platform-specific mouse button or touch id; the platform adapter first aggregates multi-touch input into an explicit game action.",
            vec![],
            "boolean: whether the primary pointer is down.",
            vec!["Read the current frame's pointer snapshot"],
            "The result is stable during the same update; if a sequence provides no pointer frame, treat it as released to avoid sticky input.",
            vec![],
            "if api.input.isPointerDown() then ... end",
            vec!["input.getPointerPosition", "input.isDown"],
        ),
        descriptor(
            "random.nextFloat",
            "random",
            "Get a deterministic [0, 1) floating-point value determined by the project run seed.",
            "When sampling, making probability checks, or using replayable game randomness.",
            "Do not use it for true secure randomness, and do not treat the result as fixed across different seeds.",
            vec![],
            "number: greater than or equal to 0 and less than 1.",
            vec!["Consume seeded runtime random state"],
            "The same runtime, seed, and call order produce the same result; changing the call order changes the subsequent sequence.",
            vec![],
            "local chance = api.random.nextFloat()",
            vec!["random.nextInt"],
        ),
        descriptor(
            "random.nextInt",
            "random",
            "Get a deterministic inclusive integer determined by the project run seed.",
            "When sampling an index, generating a die result, or using replayable integer randomness.",
            "Do not use it for security, money movement, or passwords; min must not exceed max.",
            vec![
                parameter("min", "integer", "The smallest returned value, inclusive."),
                parameter("max", "integer", "The largest returned value, inclusive."),
            ],
            "integer: between min and max, inclusive.",
            vec!["Consume seeded runtime random state"],
            "The result is returned immediately in the current update; the same seed, input, and call order are replayable.",
            vec!["min greater than max returns LUAU_RUNTIME_ERROR"],
            "local slot = api.random.nextInt(1, 3)",
            vec!["random.nextFloat"],
        ),
        descriptor(
            "observation.set",
            "observation",
            "Publish the game's current serializable semantic state for observation by AI, tests, and the host.",
            "When dialogue ViewModels, combat results, random results, or other game state must be readable by headless, Web, or mobile hosts.",
            "Do not treat it as a second copy of gameplay state, and do not publish large unchanged assets or telemetry every frame.",
            vec![
                parameter(
                    "key",
                    "string",
                    "A non-empty stable observation name, such as view_model.",
                ),
                parameter(
                    "value",
                    "ObservationValue",
                    "A serializable string, number, boolean, null, object, or array.",
                ),
            ],
            "(): no additional data on success.",
            vec!["Replace the latest game observation for the specified key"],
            "The value updates immediately within the same update; the next observe, run report, and test assertion see the latest value. Only the last publication for each key is retained.",
            vec![
                "An empty key returns LUAU_RUNTIME_ERROR",
                "A value containing a function, userdata, cyclic table, non-finite number, or non-contiguous array key returns LUAU_RUNTIME_ERROR",
            ],
            "api.observation.set(\"view_model\", { screen = \"dialogue\", node = \"intro\" })",
            vec!["log", "input.isDown"],
        ),
        descriptor(
            "observation.array", "observation",
            "Preserve a generic JSON array, including an empty array, in published observations.",
            "For empty arrays, typed numeric arrays and engine JSON round trips. Engine-produced spatial results already preserve array identity automatically. Read docs/spatial-batches.md#observation-json-arrays, bundled with the SDK.",
            "Plain {} remains a JSON object. This is a serialization hint, not gameplay state or a collection framework.",
            vec![parameter("values", "{T}?", "Optional contiguous serializable array table; omitted creates an empty array. Returns the same supplied table and retains its element types.")],
            "{T}; no-argument call returns {ObservationValue}",
            vec!["Mark only this table's JSON array identity; no element copy or metatable changes"],
            "The mark survives clearing and refilling this table. Serialization revalidates shape; nested plain empty tables remain objects unless separately marked. Invalid input fails before marking.",
            vec!["Mixed or sparse keys, callbacks, nonfinite values, buffers and cyclic values fail explicitly; marking does not bypass observation validation."],
            "api.observation.set(\"empty\", api.observation.array()); local numbers: {number} = {1,2}; api.observation.setArray(\"numbers\", api.observation.array(numbers))",
            vec!["observation.set", "observation.setArray", "spatial.take"],
        ),
        descriptor(
            "observation.setArray", "observation",
            "Publish a typed generic array as JSON, including an empty array, with runtime serialization validation.",
            "For direct publication of typed number/record arrays without casts or element adapters. Read docs/spatial-batches.md#observation-json-arrays in the SDK.",
            "Does not weaken observation.set's recursive value type. Serializability and contiguous keys are runtime constraints on the generic element type.",
            vec![parameter("key", "string", "Nonempty observation key"), parameter("values", "{T}?", "Contiguous serializable array; omitted publishes []")],
            "nil", vec!["Validate, mark array identity and replace only the named observation after success"],
            "The supplied table is not copied by the marker; publication stores a JSON snapshot. Invalid input preserves the previous observation. Numeric element typing remains intact.",
            vec!["Invalid key, holes/mixed keys, functions, nonfinite values, buffers or cycles fail explicitly without publishing a replacement."],
            "local points: {number} = {1,2,3}; api.observation.setArray(\"points\", points); api.observation.setArray(\"empty\")",
            vec!["observation.set", "observation.array", "spatial.take"],
        ),
        descriptor(
            "ui.imageBatch.define", "ui",
            "Define retained ordered image artwork once, then move instances using a cheap affine transform.",
            "For 2D GPU artwork, image batching, camera pan and 大量圖片: retain logical image_batch asset/crop/opacity content and change instance placement independently. The official host chooses eligible GPU runs or an order-preserving Canvas fallback. Read docs/ui-slice-and-budget.md#retained-image-artwork.",
            "This stores logical images, not packed GPU geometry. Keep gameplay, visibility decisions and drawing order in Luau. Resource mutations are forbidden inside pure virtual renderItem callbacks.",
            vec![parameter("id","string","Stable resource id, 1..1024 bytes."),parameter("content","UiImageBatchDefinition","{bounds,quads}; finite local bounds contain ordered image rectangles; source crops use pixels.")],
            "nil",vec!["Copy and validate the complete immutable generation, registry budgets and live UI references before replacement"],
            "Identical content preserves its revision. Existing instances reference the current generation; old snapshots keep the previous immutable content. Publish kind=image_batch with content=id and optional transform={a,b,c,d,tx,ty}; rect is its stage clip/layout viewport. Inline quads remain a logical authoring convenience. Host support is explicit; no new scene or automatic layout.",
            vec!["UI_IMAGE_BATCH_CONTENT for a missing reference; UI_NODE_LIMIT counts every referenced quad per instance; UI_PURE_VIEW rejects renderItem mutations; invalid definitions leave current content unchanged."],
            "api.ui.imageBatch.define(\"art\",{bounds={x=0,y=0,width=10,height=10},quads={{asset=\"texture://tile\",rect={x=0,y=0,width=10,height=10}}}})",
            vec!["ui.imageBatch.remove","ui.setRoot","ui.components.imageBatch"],
        ),
        descriptor(
            "ui.imageBatch.remove", "ui",
            "Release an unused retained image artwork resource.",
            "After replacing the UI tree so no node references that content id.",
            "Removing visible content fails explicitly; this does not remove UI nodes or alter their order.",
            vec![parameter("id","string","The retained image content id.")],
            "boolean: whether a resource was removed.",vec!["Release the live registry reference after checking published UI ownership"],
            "Snapshots may retain immutable generations until released. Recreating the id receives a fresh engine revision. Resources share the runtime world's reset and reload lifetime.",
            vec!["UI_IMAGE_BATCH_IN_USE: replace the UI tree before removal","UI_PURE_VIEW: no resource mutations in renderItem"],
            "local removed = api.ui.imageBatch.remove(\"art\")",
            vec!["ui.imageBatch.define","ui.setRoot"],
        ),
        descriptor(
            "ui.setCursor", "ui",
            "Declare a default, hidden or asset-image cursor for the official Web host.",
            "Luau chooses the sprite and timing; the generic host positions it at the current real mouse/pen and paints after UI. Read docs/ui-cursor.md.",
            "Drawing-buffer pixel units, y-down hotspot. No pointer lock, world picking, source-game cursor policy or native-player implementation is implied.",
            vec![parameter("cursor","UiCursor","{kind=default|hidden} or image asset,width,height,hotspot_x,hotspot_y,filter nearest|linear")],
            "nil",vec!["Validate the full declaration, then atomically replace cursor state"],
            "Absent/default preserves the legacy snapshot shape and native browser cursor. Image assets load through the declared manifest; no input events or hit regions are created.",
            vec!["UI_CURSOR_INVALID rejects unknown fields, missing values, dimensions outside integer1..512, or an out-of-image hotspot before replacing the previous state.","Web only host presentation in this version; native presentation remains unavailable."],
            "api.ui.setCursor({kind=\"image\",asset=\"texture://pointer\",width=17,height=17,hotspot_x=0,hotspot_y=0,filter=\"nearest\"})",
            vec!["ui.setRoot","input.getScreenPointerPosition"],
        ),
        descriptor(
            "ui.setRoot",
            "ui",
            "Publish a declarative UI tree with reusable typography/box styles and explicit scoped card backgrounds. Image/panel background_for metadata declares screen or ancestor-component background intent for overlap diagnostics. Stage rect axes are 0..100 and y points up: y=0 is the bottom. Scroll helpers use local top-left/y-down content; see docs/ui-scroll.md.",
            "For official Web and native player UI: text, styled buttons, image skins and decorative panels composed from the game's ViewModel. Start reusable controls with the official @unone/ui package: ui.components.info then ui.components.create returns a typed kit. See docs/ui-components.md. Sharp text shadow uses UiStyle.text_shadow on nonediting text in the official Web Canvas host; see docs/ui-presentation-input.md for offsets, clipping and explicit unsupported hosts. Nonvisual action capture uses ui.components.inputRegion. Custom Luau factories may also return the existing component tree; component is a node kind, not api.ui.component(). A reusable card function carries background_for={component=id} on its own background leaf, keeping that intent beside its internal leaves instead of repeating their IDs in external overlap policies. Use background_for={screen=true} for a screen background. Start with docs/ui-styling.md and game schema ui; package fonts in presentation.ui.fonts instead of drawing text with game-owned DOM or GPU code.",
            "No implicit layout, CSS, platform widgets, data binding or game rules. For opt-in authored breakpoint/row/column/grid composition, use ui.components.createResponsiveLayout and pass its resolved rectangles to leaves. The game authors semantic grouping, ViewModels, reusable components, content and action meanings. Styles are local to leaves and never inherited from components.",
            vec![parameter(
                "root",
                "UiScreen",
                "A screen root with text, button, slider, combobox, image, panel, component and scroll_view children. Image/panel may declare background_for={screen=true} OR background_for={component=\"ancestor_id\"}: exactly one scope, an actual component ancestor in the same coordinate space, and a background rectangle fitting that scope. Overlap diagnostics exempt only later fully contained descendants of the declared scope; foreground collisions, partial coverage, unrelated siblings and later occluding backgrounds remain findings. Exact-pair v1 overlap policies remain available for deliberate skin layers. Leaf style supports font_family/font_size/font_weight/line_height/letter_spacing/color/text_align/vertical_align/wrap/overflow/padding/background/border_color/border_width/border_radius/opacity; image and panel allow only box fields. Font sizes, padding, letter spacing and borders use vertical design units (1 unit = 1% viewport height); a styled leaf defaults to font_size=2 and never auto-shrinks. Omit style for legacy text fitting. Optional budget.max_nodes overrides the default (query ui.inspect). Image slice uses source-pixel borders and vertical-unit destination borders; slice replaces fit. Stage rects fit 0..100; scroll content uses non-negative local top-left/y-down coordinates.",
            )],
            "(): no additional data on success.",
            vec!["Replace the game-owned UI tree for the current frame"],
            "The latest validated tree is immediately visible in observations and Web/native host snapshots. Validation covers schema, style bounds, coordinates and node budgets; host glyph metrics are presentation and do not change simulation state.",
            vec![
                "root kind must be screen",
                "child kind supports text, button, slider (action + optional value text), combobox (action + optional selected text + expanded boolean, default false), image (stable asset:// or texture:// id + fit + optional alt), panel (decorative box with optional style, no text/action/children), component (name + children), or scroll_view (prefer the scrollView/virtualList/virtualGrid helpers); skinned controls expose semantic/action nodes inside game-authored component skins; a skinned slider may expose stable track, fill, handler and semantic nodes, while a skinned combobox exposes field, value, arrow, popup and option nodes with selection and popup state controlled by the UI author",
                "node ids must be globally unique; all rects finite, dimensions positive; stage rects fit 0..100, local scroll content uses non-negative x/y with no anchors",
                "UI_STYLE_INVALID: RGBA outside 0..1, out-of-range style values, unsupported typography on image/panel, style inheritance on containers, or wrap=word combined with overflow=ellipsis; unknown fields are structural errors that name the unsupported field",
                "UI_BACKGROUND_KIND / UI_BACKGROUND_SCOPE / UI_BACKGROUND_BOUNDS: background_for is only for image/panel leaves; choose exactly screen=true or an actual ancestor component ID, keep the same coordinate space, and fit the background inside its scope. This metadata does not reorder, move, clip, inherit style or excuse collisions between foreground controls/text.",
            ],
            "api.ui.setRoot({kind=\"screen\",id=\"menu\",node=\"settings\",children={{kind=\"text\",id=\"title\",text=\"Settings\",rect={x=10,y=75,width=80,height=12},style={font_size=4,font_weight=700,text_align=\"start\",vertical_align=\"middle\",color={0.9,0.95,1,1}}}}})",
            vec![
                "ui.components.create",
                "ui.components.info",
                "ui.components.createResponsiveLayout",
                "ui.inspect",
                "ui.getViewport",
                "ui.scrollView",
                "observation.set",
                "input.getScreenPointerPosition",
            ],
        ),
        descriptor(
            "ui.components.info",
            "ui",
            "Discover the official @unone/ui package name, version and whether this project declared it.",
            "Before using shared components or checking a UI package version. Available without a runtime_packages declaration; see docs/ui-components.md and ui.components.create.",
            "This reports the bundled package, not an npm registry or installed module. It does not enable a package or prove host visual support.",
            vec![],
            "UiComponentsInfo: {name:string, version:string, kind:string, entry:string, api:string, license:string, declared:boolean}.",
            vec!["Read-only package metadata"],
            "Does not publish UI or advance a frame. Reports the version bundled with this runtime/SDK.",
            vec![],
            "local info = api.ui.components.info(); api.observation.set(\"ui_package\", {name=info.name,version=info.version,declared=info.declared})",
            vec!["ui.components.create", "ui.setRoot"],
        ),
        descriptor(
            "ui.components.createResponsiveLayout",
            "ui",
            "Create the official reusable responsive layout model: select an authored aspect breakpoint and resolve explicit slot/row/column/grid regions without changing UI nodes.",
            "Default for responsive layout, adaptive layout, breakpoints, row/column/grid, 自適應排版 and 響應式斷點. Available on api.ui.components and the themed kit. Declare @unone/ui 0.6.0; use canonical UiResponsiveLayoutOptions<T>, UiResponsiveLayout<T>, UiLayoutNode and UiViewport from game api typings. Read docs/ui-responsive.md for a complete typed lifecycle and coordinate examples.",
            "No implicit component layout, text measurement, wrapping, CSS, inferred breakpoints, node transformation, renderer replacement or application rules. Project Luau chooses semantic groups, thresholds, content and styles; this shared model owns selection and geometry arithmetic.",
            vec![parameter("options", "UiResponsiveLayoutOptions<T>", "space='stage' (default) or 'scroll'; dense nonempty variants={name,minAspect,layout,values:T}. First minAspect=0, then strictly ascending finite thresholds; unique nonblank names. UiLayoutNode is {id,kind='slot'|'row'|'column'|'grid',size?,grow?,padding?,gap?,columns?,children?}. Explicit positive size fixes a row/column child's main-axis extent; otherwise positive grow defaults to 1. No size+grow, root sizing or grid-child sizing. Grid requires columns integer 1..256 and equal cells. Slot rejects container-only fields. IDs are unique within each variant.")],
            "UiResponsiveLayout<T>; resolve({aspect:number},bounds?:UiViewport)->{variant:string,values:T,rect(id)->UiRect,viewport(id)->UiViewport}. Bounds default {left=0,top=0,width=100,height=100}.",
            vec!["Create a pure Luau model with copied options; return defensive geometry/value copies"],
            "Create once, retain it, and resolve in a pure View or virtual renderItem. Resolve selects the highest minAspect <= viewport.aspect, inclusively. Row proceeds left-to-right; column and grid rows proceed top-to-bottom. Container regions are outer bounds; padding affects only children. Lengths use per-axis rectangle units, independently of vertical UiStyle units. Stage rect is y-up and viewport is top-left/y-down; scroll rect and viewport are local top-left/y-down. Stage bounds fit 0..100; scroll bounds may extend beyond 100. No simulation tick, RNG, publication, node cloning or virtual-registry mutation.",
            vec!["Unknown fields, non-finite numbers, unordered/missing fallback thresholds, duplicate names/IDs, invalid node combinations, non-positive cells and overflowing fixed sizes/gaps/padding fail explicitly. No silent clipping or fallback to a different variant. Call result.viewport(id) for scroll helper viewport; result.rect(id) for leaves. Font size is a project-authored values field, not calculated from geometry. Do not duplicate breakpoint tests and rectangle arithmetic per project or add layout props to component constructors."],
            "local layout = api.ui.components.createResponsiveLayout({variants={{name=\"base\",minAspect=0,layout={id=\"root\",kind=\"row\",gap=2,children={{id=\"main\",kind=\"slot\",grow=2},{id=\"aside\",kind=\"slot\"}}},values={fontSize=2}}}}); local resolved = layout.resolve(api.ui.getViewport()); local title = api.ui.components.text({id=\"title\",text=\"Settings\",rect=resolved.rect(\"main\"),style={font_size=resolved.values.fontSize}})",
            vec!["ui.components.create", "ui.getViewport", "ui.components.scrollView", "ui.components.virtualGrid", "ui.setRoot"],
        ),
        descriptor(
            "ui.components.createSlider",
            "ui",
            "Create the official reusable numeric Slider control with host-owned hit testing/capture and package-owned range, step, value and gesture lifecycle.",
            "Default for slider, slider drag, slider value, volume slider, 滑桿拖曳 and 滑桿數值. Available on api.ui.components and the themed kit. Declare @unone/ui 0.6.0 and use canonical UiSliderOptions, UiSliderControl, UiSliderViewProps and UiSliderUpdate from game api typings.",
            "Not a callback, automatic layout or game settings binding. Create once; keep whether/when to apply a setting in the project. Use the low-level slider leaf only when deliberately implementing another control protocol.",
            vec![parameter("options", "UiSliderOptions", "id and finite value required; min=0, max=1 (max>min), optional positive step snaps relative to min, both endpoints reachable; axis='horizontal'|'vertical' (default horizontal), reverse=false.")],
            "UiSliderControl with view(props)->UiSliderNode; update(api.input)->{value,changed,dragging,started,released,cancelled}; getValue(); setValue(value); cancel().",
            vec!["Own one pure Luau UI control model; no hardware setting or implicit publication"],
            "Call update(api.input) once per Game.update, then read getValue from any view/readers. view is UI-pure: rect required in its current coordinate space, trackRect defaults to rect, hitPadding defaults to 0.65 normalized UI units, enabled defaults true, optional text/action/style. Hosts project scroll-local rectangles, clip starts, preserve captured outside release and cancel on removal/disable/geometry change. setValue and cancel block the old drag until a new start.",
            vec!["Do not recreate the model every tick or update it inside view/renderItem. Do not implement contains/pointerWasDown/clamp in each project. view takes explicit rects, not anchor placement. Unknown fields/callbacks fail; value/min/max/step belong in createSlider options, not the low-level slider leaf. Legacy raw slider without drag remains pointer passthrough."],
            "local volume = api.ui.components.createSlider({id=\"volume\",value=72,min=0,max=100,step=1}); -- Game.update: local change=volume.update(api.input); -- View: volume.view({rect={x=10,y=30,width=80,height=8},text=tostring(volume.getValue())})",
            vec!["ui.components.create", "ui.components.slider", "input.getSliderInteraction", "ui.setRoot"],
        ),
        descriptor(
            "ui.components.create",
            "ui",
            "Create the official @unone/ui shared component kit for every canonical UI control, screen/component composition and existing scroll helpers with project-owned theme styles.",
            "For UI package, shared components, card component, 官方UI套件, 共用元件 and 主題樣式 authoring. Declare \"runtime_packages\":{\"@unone/ui\":\"0.6.0\"} in project.unone.json. See docs/ui-components.md and docs/ui-styling.md. Use canonical EngineApi, UiApi and UiComponentKit types from game api typings; do not replace them with ui:any. The returned themed kit and api.ui.components both expose createResponsiveLayout/createSlider/text/button/slider/combobox/panel/image/imageBatch/component/screen/scrollView/virtualList/virtualGrid, id and composeStyle. Prefer createSlider for a complete numeric drag control and createResponsiveLayout for opt-in responsive geometry. Direct module constructors use no theme defaults.",
            "No hardcoded theme, implicit layout, binding, screen manager or business behavior. Themes, content, state, actions and geometry belong to project Luau; opt-in createResponsiveLayout handles shared breakpoint selection and row/column/grid arithmetic from authored definitions. Custom factories remain valid. Constructors return the existing UI tree for ui.setRoot.",
            vec![parameter(
                "theme",
                "UiComponentsTheme?",
                "Optional per-kind UiStyle defaults: text, button, panel, image, slider, combobox only. All leaf props use flattened UiPlacement: explicit rect OR anchor+size, plus canonical leaf fields except kind. component takes id, component name, explicit placement, optional children and surface. surface={kind='panel'|'image', asset?,fit?,slice?,alt?,style?} prepends id..'/surface' with background_for={component=id} and the component's unchanged placement. Children retain their authored coordinates and order. screen takes id/node/children and optional budget; scroll helpers retain their existing options and local top-left/y-down content contract.",
            )],
            "UiComponentKit; createResponsiveLayout<T> -> UiResponsiveLayout<T> (create once, resolve in View); createSlider -> UiSliderControl (create once, update in Game.update, publish view); text -> UiTextNode, button -> UiButtonNode, slider -> UiSliderNode, combobox -> UiComboBoxNode, panel -> UiPanelNode, image -> UiImageNode, imageBatch -> UiImageBatchNode, component -> UiComponentNode, screen -> UiScreen; scrollView/virtualList/virtualGrid -> UiNode; id -> string; composeStyle -> UiStyle.",
            vec!["Construct deeply frozen ordinary UI values; does not publish UI or mutate/freeze borrowed props/theme. Registered virtual handles retain helper-owned live identity."],
            "No simulation step. UI 0.6 snapshots authored data and may reuse privately owned immutable subtrees. Per-leaf overrides win, padding merges by edge and RGBA arrays replace. Use UiRectInput/UiStyleInput for mutable builders and generalized iteration for readonly child arrays. Generated backgrounds still use canonical strict scope/overlap validation at setRoot; reuse never bypasses expanded work/depth budgets.",
            vec![
                "UI_PACKAGE_NOT_DECLARED: add runtime_packages: {\"@unone/ui\":\"0.6.0\"} to project.unone.json; info() remains available for discovery.",
                "Both api.ui.components.button and kit.button exist. api.ui.component and onClick do not exist; publish with ui.setRoot and read semantic action edges with input.wasPressed.",
                "Author exactly rect OR anchor+size on each node; component children do not become local coordinates. Surface ID id..'/surface' must be globally unique.",
                "Keep foreground and partial-overlap checks enabled; a surface does not excuse unrelated or protruding content.",
            ],
            "local ui = api.ui.components.create({button={font_size=2,background={0.1,0.2,0.3,1}}}); local button = ui.button({id=ui.id(\"menu\",\"apply\"),text=\"Apply\",action=\"ApplySettings\",rect={x=60,y=10,width=30,height=8}}); api.ui.setRoot({kind=\"screen\",id=\"settings\",node=\"settings\",children={button}})",
            vec![
                "ui.components.info",
                "ui.components.createResponsiveLayout",
                "ui.components.composeStyle",
                "ui.components.id",
                "ui.setRoot",
                "ui.getViewport",
            ],
        ),
        descriptor(
            "ui.components.composeStyle",
            "ui",
            "Copy and compose UiStyle tables for the official shared component kit; override wins, padding merges by edge and RGBA arrays replace.",
            "Build project-owned theme variants without mutating a base style or a previously constructed leaf. The returned kit exposes the same composeStyle helper; see docs/ui-components.md.",
            "Not style inheritance, a CSS cascade or runtime layout. Canonical style field/value validation remains in ui.setRoot.",
            vec![
                parameter("base", "UiStyle?", "Optional base style to copy."),
                parameter(
                    "override",
                    "UiStyle?",
                    "Optional override; supplied fields replace base fields, except padding merges per edge.",
                ),
            ],
            "Recursively frozen UiStyle; composeStyle(nil,nil) returns a frozen empty style table.",
            vec!["Return a composed immutable style; neither borrowed input is changed/frozen, and privately owned immutable subvalues may be reused"],
            "Pure Luau operation; does not publish UI or advance a frame.",
            vec![
                "UI_PACKAGE_NOT_DECLARED: declare the exact bundled @unone/ui version before calling this helper. Cyclic or unsupported input tables are rejected. A supplied empty style selects canonical explicit typography defaults when published.",
            ],
            "local emphasis = api.ui.components.composeStyle({padding={left=1,right=1},color={1,1,1,1}}, {padding={right=2},color={1,0.8,0.2,1}})",
            vec!["ui.components.create", "ui.setRoot"],
        ),
        descriptor(
            "ui.components.id",
            "ui",
            "Compose stable instance-scoped IDs for shared UI component leaves.",
            "Avoid collisions when instantiating the same project-owned card or button factory several times. The returned kit exposes the same id helper; see docs/ui-components.md.",
            "Not a global ID allocator; the project chooses distinct instance IDs and role names. It does not infer semantic actions or placement.",
            vec![
                parameter("instanceId", "string", "Non-empty component instance ID."),
                parameter(
                    "role",
                    "string",
                    "Non-empty role within this instance; percent and slash are escaped to avoid role-path collisions.",
                ),
            ],
            "string: instanceId..'/'..escapedRole; role escapes '%' as '%25' and '/' as '%2F'.",
            vec!["None"],
            "Pure deterministic string construction; does not publish UI or advance a frame.",
            vec![
                "UI_PACKAGE_NOT_DECLARED: declare the exact bundled @unone/ui version before calling this helper.",
                "Keep generated IDs globally unique, including the reserved id..'/surface' of a component surface.",
            ],
            "local labelId = api.ui.components.id(\"inventory/left-card\", \"title\")",
            vec!["ui.components.create", "ui.setRoot"],
        ),
        descriptor(
            "ui.getViewport",
            "ui",
            "Read the host-reported viewport aspect ratio; feed it to ui.components.createResponsiveLayout for shared authored responsive composition.",
            "Advanced environment observation, or input to layout.resolve(api.ui.getViewport()). Start responsive authoring at ui.components.createResponsiveLayout and docs/ui-responsive.md instead of copying breakpoint conditionals. The host reports the actual stage aspect; headless callers may set it through the runtime viewport boundary.",
            "This environment getter does not itself choose rectangles, reflow content or report device pixels. Project-authored responsive models own layout policy; do not use font raster metrics as simulation input.",
            vec![],
            "{aspect:number}; width divided by height.",
            vec!["Read-only host viewport observation"],
            "Reads the current runtime viewport aspect without advancing a frame or mutating the UI tree.",
            vec![],
            "local resolved = responsiveLayout.resolve(api.ui.getViewport()); api.observation.set(\"ui_variant\", resolved.variant)",
            vec!["ui.components.createResponsiveLayout", "ui.setRoot", "ui.inspect"],
        ),
        descriptor(
            "ui.inspect",
            "ui",
            "Read the actual UI contract, effective node budget, logical/leaf counts, upper bound on render regions and top-level subtree counts.",
            "Before building a large screen or diagnosing UI_NODE_LIMIT; query instead of guessing host limits.",
            "Not GPU timing or texture-memory measurement; render regions are not draw calls. Host diagnostics measure rendering cost.",
            vec![],
            "{contract: UiContract, usage: UiUsage?}; usage is nil before setRoot.",
            vec!["Read-only inspection"],
            "Reports the latest successfully published tree; a failed setRoot preserves it.",
            vec![],
            "local report = api.ui.inspect(); api.observation.set(\"ui_budget\", report)",
            vec!["ui.setRoot"],
        ),
        descriptor(
            "ui.scrollView",
            "ui",
            "Create a reusable scroll_view node with measured local content and clipped rendering/input.",
            "Use for authored finite content. See docs/ui-scroll.md for coordinates, lifecycle and Web host integration.",
            "Not automatic responsive layout or a gameplay loop. Native/legacy DOM hosts currently reject this capability explicitly.",
            vec![parameter(
                "options",
                "UiScrollOptions",
                "id, viewport, content; optional axis, enabled, resetKey, wheelRect, inertia=false and deceleration=8 (finite (0,100], exponential velocity decay in s^-1). Content rects are local top-left/y-down; only viewport is in its containing space.",
            )],
            "UiNode; insert into ui.setRoot children.",
            vec!["Construct UI node only"],
            "Host scroll and optional release inertia do not advance gameplay. New input, pause, geometry/config changes, reset, disable, unmount and bounds stop motion. No elastic overscroll.",
            vec!["Do not put stage-space rects in content or hand-author contentHeight/maxScroll."],
            "local view = api.ui.scrollView({id='help',viewport={left=10,top=10,width=80,height=80},content={}})",
            vec!["ui.virtualList", "ui.virtualGrid", "ui.setRoot"],
        ),
        descriptor(
            "ui.virtualList",
            "ui",
            "Build only the visible fixed-height rows of a Lua data source.",
            "Long vertical lists; docs/ui-scroll.md defines stable keys and UI-pure renderItem callbacks.",
            "Not variable-height rows; use scrollView for small irregular content.",
            vec![parameter(
                "options",
                "UiVirtualOptions",
                "id, viewport, items, key field/function, rowHeight, renderItem; optional gapY, enabled, resetKey, wheelRect, inertia=false and deceleration=8 s^-1 (finite (0,100]).",
            )],
            "scroll_view UiNode with virtual_items metadata and bounded materialized children.",
            vec!["Register Lua view callback"],
            "Host requests invoke renderItem, never Game.update. Callback must not mutate gameplay or consume RNG.",
            vec![
                "Keys must be unique strings, not positional array indices; return non-empty arrays of local rect nodes.",
            ],
            "local view = api.ui.virtualList({id='rows',viewport={left=10,top=10,width=80,height=80},items=items,key='id',rowHeight=8,renderItem=renderRow})",
            vec!["ui.virtualGrid", "ui.scrollView"],
        ),
        descriptor(
            "ui.virtualGrid",
            "ui",
            "Build a visible fixed-cell vertical grid using the same scroll core as virtualList.",
            "Large icon/item libraries with explicitly authored column count and cell size.",
            "Not masonry, automatic breakpoints or a responsive layout solver.",
            vec![parameter(
                "options",
                "UiVirtualGridOptions",
                "virtualList options plus columns, columnWidth and optional gapX; columns must fit viewport width.",
            )],
            "scroll_view UiNode with virtual_items metadata.",
            vec!["Register Lua view callback"],
            "UI-only visible-window materialization; no simulation step.",
            vec![
                "rowHeight means cell height, excluding gapY; return cell-local nodes without their row/column translation.",
            ],
            "local view = api.ui.virtualGrid({id='icons',viewport={left=10,top=10,width=80,height=80},items=items,key='id',columns=8,columnWidth=9,rowHeight=16,gapX=1,renderItem=renderIcon})",
            vec!["ui.virtualList", "ui.scrollView"],
        ),
        descriptor(
            "save.set",
            "save",
            "Publish the game's current serializable save payload for the host to persist.",
            "When the game schema must be saved at an explicit checkpoint.",
            "Do not write every frame, and do not use an observation or platform file path as a save API.",
            vec![parameter(
                "value",
                "SaveValue",
                "A game-defined serializable save payload; the engine does not interpret its schema.",
            )],
            "(): no additional data on success.",
            vec!["Replace the save payload currently pending host persistence"],
            "After the call, the host can read the latest payload through the runtime/platform adapter; the payload survives a script reload.",
            vec![
                "A value containing a function, userdata, cyclic table, non-finite number, or non-contiguous array key returns LUAU_RUNTIME_ERROR",
            ],
            "api.save.set({ version = 1, node = \"kind\" })",
            vec!["save.get"],
        ),
        descriptor(
            "save.get",
            "save",
            "Read the save payload injected by the host or most recently saved by the game.",
            "When the game schema must be restored after game startup.",
            "Do not treat the save payload as per-frame gameplay state; after loading, the game decides its version and migration.",
            vec![],
            "SaveValue or nil: returns nil when no payload is present.",
            vec!["Read the current save payload"],
            "Readable immediately within the same runtime; the host can inject a JSON payload before the first tick. The engine does not perform schema migration for the game.",
            vec!["The adapter reports a diagnostic when the host payload is not valid JSON"],
            "local payload = api.save.get()",
            vec!["save.set"],
        ),
        descriptor(
            "log",
            "diagnostics",
            "Write a semantic script trace for observation by AI, tests, and development records.",
            "When important game events must be recorded or a script branch must be verified.",
            "Do not emit large amounts of output every frame; high-frequency data belongs in observation state.",
            vec![parameter(
                "message",
                "string",
                "An event description understandable to people and AI.",
            )],
            "(): no additional data on success.",
            vec!["Add one script_log trace event"],
            "The event uses the world frame at call time; the run report retains only the semantic trace and does not create per-frame noise.",
            vec!["Excessive logging increases observation output size"],
            "api.log(\"player_started\")",
            vec!["entity.getPosition", "input.isDown"],
        ),
        descriptor(
            "camera3d.getTransform",
            "camera",
            "Deprecated compatibility alias for camera.getTransform in perspective mode.",
            "When game-owned camera-follow logic needs the current 3D camera position or target.",
            "For a 2D scene without a Camera3D; do not treat the camera transform as vehicle or Entity gameplay state.",
            vec![],
            "Camera3DTransform: position, target, and fovDegrees.",
            vec!["Read Rust-owned camera state"],
            "Returns the Camera3D for the current update; the host renderer uses it on the next draw.",
            vec!["The current scene has no Camera3D"],
            "local camera = api.camera3d.getTransform()",
            vec!["camera3d.setPosition", "camera3d.setTarget"],
        ),
        descriptor(
            "camera3d.setPosition",
            "camera",
            "Deprecated compatibility alias for camera.setTransform position in perspective mode.",
            "When the game must implement a car-follow, replay, or scene-camera strategy.",
            "Do not hard-code racing-game or other game-specific camera-follow rules in the engine.",
            vec![parameter(
                "position",
                "Vec3",
                "The new Camera3D world position.",
            )],
            "(): no additional data on success.",
            vec!["Modify Rust-owned Camera3D state"],
            "The update takes effect immediately during the current script update; the renderer uses it on the next draw.",
            vec![
                "The current scene has no Camera3D",
                "x/y/z must be finite numbers",
            ],
            "api.camera3d.setPosition({ x = 0, y = 3, z = 8 })",
            vec!["camera3d.getTransform", "camera3d.setTarget"],
        ),
        descriptor(
            "camera3d.setTarget",
            "camera",
            "Deprecated compatibility alias for camera.setTransform target in perspective mode.",
            "When the game must control a 3D camera aimed at a vehicle, track, or other gameplay target.",
            "Do not add game-specific tracking, smoothing, or camera-shake strategies to the engine.",
            vec![parameter(
                "target",
                "Vec3",
                "The new Camera3D world target.",
            )],
            "(): no additional data on success.",
            vec!["Modify Rust-owned Camera3D state"],
            "The update takes effect immediately during the current script update; the renderer uses it on the next draw.",
            vec![
                "The current scene has no Camera3D",
                "x/y/z must be finite numbers",
            ],
            "api.camera3d.setTarget({ x = 0, y = 0, z = 0 })",
            vec!["camera3d.getTransform", "camera3d.setPosition"],
        ),
    ];
    result.extend(ui_component_descriptors());
    result.extend(heightfield_descriptors());
    result.extend(projected_descriptors());
    result.extend(spatial_descriptors());
    result.extend(physics3d_descriptors());
    for (name, purpose, parameters, returns, example) in [
        (
            "jobs.register",
            "Register a game-owned isolated Luau function source during start/onReload.",
            vec![
                parameter(
                    "id",
                    "string",
                    "1..64 ASCII alphanumeric/underscore/hyphen bytes",
                ),
                parameter(
                    "source",
                    "string",
                    "1..16384 bytes; return function(input: buffer): buffer; fresh sandbox VM per execution",
                ),
            ],
            "nil",
            "api.jobs.register('copy', 'return function(input) return input end')",
        ),
        (
            "jobs.submit",
            "Copy one batch input and stage work for next-tick delivery.",
            vec![
                parameter("operation", "string", "Previously registered operation ID"),
                parameter(
                    "input",
                    "buffer",
                    "At most 262144 bytes; caller retains its buffer",
                ),
            ],
            "string job handle",
            "job = api.jobs.submit('copy', input)",
        ),
        (
            "jobs.schedule",
            "Schedule isolated computation with fresh-input and result callbacks in the gameplay VM.",
            vec![
                parameter(
                    "operation",
                    "string",
                    "Operation from project.job_scripts (recommended) or jobs.register",
                ),
                parameter(
                    "options",
                    "table",
                    "every_ticks: integer 1..1000000000; optional times: integer 1..1000000000",
                ),
                parameter(
                    "prepare",
                    "function",
                    "prepare(api, occurrence) returns fresh buffer before update",
                ),
                parameter(
                    "apply",
                    "function",
                    "apply(api, output, occurrence) runs no earlier than the next tick",
                ),
            ],
            "string schedule handle",
            "schedule = api.jobs.schedule('search', {every_ticks=6}, prepareInput, applyTargets)",
        ),
        (
            "jobs.take",
            "Consume one result during a later update, after the job barrier.",
            vec![parameter(
                "handle",
                "string",
                "One-shot handle from jobs.submit",
            )],
            "buffer",
            "local output = api.jobs.take(job) -- next update, never the submission update",
        ),
        (
            "jobs.cancel",
            "Invalidate a not-yet-consumed job and discard its eventual result.",
            vec![parameter(
                "handle",
                "string",
                "Live job handle; late background result is ignored",
            )],
            "nil",
            "api.jobs.cancel(job)",
        ),
        (
            "jobs.reset",
            "Invalidate all job handles for a gameplay reset; keep registered operations.",
            vec![],
            "nil",
            "api.jobs.reset() -- alongside the game's own round reset",
        ),
    ] {
        result.push(descriptor(name,"jobs",purpose,"Independent coarse buffer batches; game rules remain in Luau.",
            "Not shared mutable world or arbitrary WASM modules. Prepare/apply closures stay in the gameplay VM.",parameters,returns,
            vec!["Updates bounded job state; job source/input/delivered output hashes participate in replay snapshots."],
            "Enable systems.jobs. Submit only during update; dispatch after success; join before next update. Native chooses up to two threads; the Web player supports inline or a bounded Worker pool with identical next-tick visibility. Budget/cancellation is cooperative at VM safe points.",
            vec!["Disabled/missing capability, unknown operation, invalid or stale handle, early take, input/output/queue/memory/budget limits fail explicitly."],example,
            vec!["jobs.register","jobs.submit","jobs.schedule","jobs.take","jobs.cancel","jobs.reset"]));
    }
    result
}

fn spatial_descriptors() -> Vec<ApiDescriptor> {
    [
        ("pack", "Encode generic sphere records into a validated USB1 Luau buffer.", vec![parameter("bodies", "SpatialBody[]", "Unique numeric IDs, xyz f32 positions, radius, opaque category bits and optional previous_position")], "buffer", "local packed = api.spatial.pack({{id=1,position={0,0,0},radius=1}})"),
        ("create", "Create a generic spatial batch independent of scene entities.", vec![parameter("bodies", "SpatialBody[] | buffer", "Table convenience form or USB1 packed buffer; at most 65536 records")], "number", "local index = api.spatial.create({{id=1,position={0,0,0},radius=1}})"),
        ("update", "Atomically replace a spatial batch and advance its snapshot version.", vec![parameter("index", "number", "Live index handle"), parameter("bodies", "SpatialBody[] | buffer", "Validated replacement records")], "number: version", "local version = api.spatial.update(index, packed)"),
        ("destroy", "Release a spatial index; already submitted queries retain their frozen snapshot.", vec![parameter("index", "number", "Live index handle")], "nil", "api.spatial.destroy(index)"),
        ("submit", "Submit batched nearest, sphere overlap or continuous moving-sphere sweep queries.", vec![parameter("index", "number", "Live index handle"), parameter("queries", "SpatialQuery[]", "0..1024 queries; mask and exclude_id are generic geometric filters. Annotate a stored query as SpatialNearestQuery, SpatialOverlapQuery or SpatialSweepQuery before table.insert to preserve its literal kind")], "number: ticket", "local query: SpatialNearestQuery = {kind=\"nearest\",point={0,0,0},max_distance=10}; local queries: {SpatialQuery} = {}; table.insert(queries, query); ticket = api.spatial.submit(index, queries)"),
        ("take", "Consume a completed batch at a fixed later simulation tick.", vec![parameter("ticket", "number", "Unconsumed ticket from an earlier successful update")], "SpatialBatchResult", "local result = api.spatial.take(ticket)"),
        ("cancel", "Cancel a batch ticket and ignore its late host completion.", vec![parameter("ticket", "number", "Live ticket")], "nil", "api.spatial.cancel(ticket)"),
        ("info", "Report the selected spatial executor, typed capacities and current usage.", vec![], "SpatialInfo", "local info: SpatialInfo = api.spatial.info(); local capacity: number = info.limits.queries_per_batch; api.observation.set(\"spatial_info\", info)"),
        ("lastDiagnostic", "Read the latest structured spatial error with field path, actual/expected values, machine-readable code/recovery.retry and human-readable recovery.action guidance (結構化診斷、錯誤修復).", vec![], "EngineDiagnostic?", "local ok = pcall(function() api.spatial.take(ticket) end); if not ok then local diagnostic = api.spatial.lastDiagnostic(); if diagnostic then api.observation.set(\"spatial_error\", diagnostic) end end"),
        ("profile", "Locate spatial batch cost with measured CPU/GPU host-wall phase timings, work counts and transfer bytes (效能定位、批次查詢耗時).", vec![], "SpatialProfile", "local profile = api.spatial.profile(); api.observation.set(\"spatial_batches\", profile.totals.completed_batches) -- timings are wall-clock: publishing the whole profile makes observation digests nondeterministic"),
    ].into_iter().map(|(name, purpose, parameters, returns, example)| descriptor(
        &format!("spatial.{name}"), "spatial", purpose,
        "Reusable batch collision and spatial queries (空間查詢、批次碰撞查詢) on CPU or host-owned GPU compute; gameplay policy remains in Luau. Read docs/spatial-batches.md and examples/spatial-diagnostics/README.md (bundled in the portable SDK) for the complete query, result, diagnostic, lifecycle, limits and host contracts; game api typings provides canonical SpatialBody, SpatialQuery, SpatialBatchResult, SpatialInfo and EngineDiagnostic types.",
        "No AI, movement integration, damage, scene mutation or renderer replacement. V1 uses bounded complete scans, not an accelerated grid.",
        parameters, returns, if name == "profile" || name == "info" || name == "lastDiagnostic" { vec!["Read-only detached diagnostics; no handle, ticket, geometry or execution-policy mutation. Successful calls and diagnostic reads retain the latest failure; successful reload resets it"] } else { vec!["Updates bounded spatial handles and frozen batch snapshots; rejection records a structured diagnostic without changing the original thrown error text"] },
        "Submit/take/cancel only in update; results become visible starting the next tick. Equal-distance/time ties use ascending numeric ID. Overlap returns at most 64 contacts and explicitly errors on overflow. GPU f32 results have a documented tolerance; no bitwise cross-device promise.",
        vec!["Invalid/non-finite records, duplicate IDs, stale handles, early take, pending host completion, capacity and contact overflow fail explicitly."], example,
        vec!["spatial.create", "spatial.pack", "spatial.submit", "spatial.take", "spatial.info", "spatial.lastDiagnostic", "spatial.profile"]
    )).collect()
}

fn parameter(name: &str, type_name: &str, meaning: &str) -> ApiParameter {
    ApiParameter {
        name: name.to_string(),
        type_name: type_name.to_string(),
        meaning: meaning.to_string(),
    }
}

fn ui_component_descriptors() -> Vec<ApiDescriptor> {
    let mut result = Vec::new();
    for (method, props, returns, purpose, example) in [
        ("inputRegion", "UiComponentInputRegionProps", "UiInputRegionNode", "Construct a nonvisual action/capture leaf. Same rect boundaries and held/reset lifetime as button; no style, glyphs, assets or automatic keyboard navigation. Game actions and focus policies remain project-owned.", "local owner=api.ui.components.inputRegion({id=\"owner\",action=\"PointerOwner\",rect={x=10,y=20,width=30,height=8}})"),
        ("textInput", "UiComponentTextInputProps", "UiTextInputNode", "Construct a reusable single-line plain text editing control with official host IME and paste handling.", "local field=api.ui.components.textInput({id=\"nickname\",text=\"\",focused=true,max_length=12,rect={x=30,y=45,width=40,height=8}})"),
        ("text", "UiComponentTextProps", "UiTextNode", "Construct a typed text leaf; project text, explicit placement and optional typography style.", "local title = api.ui.components.text({id=\"title\",text=\"Settings\",rect={x=10,y=75,width=80,height=12},style={font_size=4}})"),
        ("button", "UiComponentButtonProps", "UiButtonNode", "Create a typed semantic action button; use input.wasPressed(action) for one activation per press.", "local button = api.ui.components.button({id=\"apply\",text=\"Apply\",action=\"ApplySettings\",rect={x=60,y=10,width=30,height=8}})"),
        ("slider", "UiComponentSliderProps", "UiSliderNode", "Construct a low-level semantic slider leaf. For a complete numeric/drag control, prefer ui.components.createSlider; this compatibility leaf alone does not own value or capture.", "local slider = api.ui.components.slider({id=\"volume\",text=\"Volume\",action=\"AdjustVolume\",rect={x=10,y=30,width=80,height=8}})"),
        ("combobox", "UiComponentComboBoxProps", "UiComboBoxNode", "Create a typed combobox/dropdown control with a semantic action and project-owned expanded state.", "local choice = api.ui.components.combobox({id=\"quality\",text=\"High\",action=\"ChooseQuality\",expanded=false,rect={x=10,y=45,width=40,height=8}})"),
        ("panel", "UiComponentPanelProps", "UiPanelNode", "Construct a decorative panel leaf with box styles and optional explicit background scope.", "local panel = api.ui.components.panel({id=\"paper\",rect={x=10,y=10,width=80,height=80},background_for={screen=true},style={background={0.03,0.05,0.08,1}}})"),
        ("image", "UiComponentImageProps", "UiImageNode", "Construct a typed image leaf with optional fit, nine-slice, box style and background scope.", "local image = api.ui.components.image({id=\"portrait\",asset=\"portrait\",rect={x=10,y=20,width=25,height=30},fit=\"contain\"})"),
        ("imageBatch", "UiComponentImageBatchProps", "UiImageBatchNode", "Construct ordered noninteractive artwork from inline quads or retained content. Optional pixel_snap=false by default; true rounds transformed edges to physical framebuffer pixels with ties away from zero, keeps clip/UV unchanged, and skips collapsed quads. Snapped retained transforms require b=c=0; signed or zero a/d are valid. Native explicitly rejects pixel_snap=true until supported. Every quad counts toward the UI node budget; text/controls retain authored order.", "local art = api.ui.components.imageBatch({id=\"terrain\",rect={x=0,y=0,width=100,height=100},pixel_snap=true,quads={{asset=\"texture://tiles\",rect={x=10,y=20,width=5,height=5},source={x=0,y=0,width=32,height=32},opacity=1}}})"),
        ("component", "UiComponentProps", "UiComponentNode", "Compose a reusable component wrapper and optional scoped surface without changing child coordinates.", "local card = api.ui.components.component({id=\"card\",component=\"project.card\",rect={x=10,y=10,width=80,height=80},surface={kind=\"panel\"},children={}})"),
        ("screen", "UiComponentScreenProps", "UiScreen", "Construct a typed screen root; publish it explicitly with ui.setRoot.", "api.ui.setRoot(api.ui.components.screen({id=\"settings\",node=\"settings\",children={}}))"),
    ] {
        result.push(descriptor(
            &format!("ui.components.{method}"), "ui", purpose,
            "Official @unone/ui control entrypoint; declare runtime_packages={\"@unone/ui\":\"0.6.0\"}. The same method exists on the UiComponentKit returned by create(theme?). See docs/ui-components.md; use game api typings for canonical EngineApi, UiApi and UiComponentKit.",
            "No callbacks, implicit layout, inherited container styles or project behavior. For explicit authored responsive geometry use ui.components.createResponsiveLayout, then pass its rect results to leaves. api.ui.component does not exist. Constructors return canonical data; ui.setRoot publishes it.",
            vec![parameter("props", props, "Canonical typed props without kind. Leaf/component placement is flattened rect OR anchor+size. screen uses id/node/children/budget, without placement. Component children retain stage coordinates (0..100, y-up); scroll content uses its documented local top-left/y-down contract. action is a semantic string, never an onClick function.")],
            returns, vec!["Snapshot borrowed authored props/theme; ordinary node/style/rect/color/children outputs are recursively frozen. Reuse private immutable subtrees without retaining mutable caller data; no UI publication."],
            "The module uses no theme defaults; a created kit snapshots its per-kind defaults. No simulation step. component/screen preserve exact registered virtual handles with helper-owned live state and readonly public types; those branches never receive pure-subtree grants. Each reused occurrence still charges expanded copy work/depth. Styles, bounds and UI budgets remain validated at setRoot.",
            vec!["UI_PACKAGE_NOT_DECLARED requires exact bundled UI 0.6. Unknown props such as onClick or nested placement are rejected. Replace ordinary constructor results rather than mutate them; use UiRectInput/UiStyleInput and mutable {UiNode} arrays while authoring. Read output children with generalized iteration. Runtime freeze enforces ownership even where analyzer builtins such as table.clear have gaps. Use input.wasPressed for one activation per press; input.isDown deliberately remains true while held."],
            example,
            vec!["ui.components.create", "ui.components.info", "ui.components.createResponsiveLayout", "ui.setRoot", "input.wasPressed", "input.isDown"],
        ));
    }
    for (method, options, purpose, example) in [
        ("scrollView", "UiScrollOptions", "Construct an authored finite scroll view through the official package's uniform entrypoint.", "local view = api.ui.components.scrollView({id=\"help\",viewport={left=10,top=10,width=80,height=80},content={}})"),
        ("virtualList", "UiVirtualOptions", "Construct a visible fixed-height virtual list through the official package's uniform entrypoint.", "local view = api.ui.components.virtualList({id=\"rows\",viewport={left=10,top=10,width=80,height=80},items=items,key=\"id\",rowHeight=8,renderItem=renderRow})"),
        ("virtualGrid", "UiVirtualGridOptions", "Construct a visible fixed-cell virtual grid through the official package's uniform entrypoint.", "local view = api.ui.components.virtualGrid({id=\"icons\",viewport={left=10,top=10,width=80,height=80},items=items,key=\"id\",columns=8,columnWidth=9,rowHeight=16,gapX=1,renderItem=renderIcon})"),
    ] {
        result.push(descriptor(
            &format!("ui.components.{method}"), "ui", purpose,
            "Declare @unone/ui 0.6.0; the module and themed kit delegate to the same existing scroll helper. Read docs/ui-scroll.md and docs/ui-components.md for coordinates, lifecycle and current Web-only host support. Legacy api.ui.scrollView/virtualList/virtualGrid remain compatible.",
            "No theme style for scroll containers, automatic responsive layout, native scroll support or gameplay callback. Virtual renderItem is UI-pure and never advances Game.update or consumes RNG.",
            vec![parameter("options", options, "Viewport belongs to its containing space; content uses local top-left/y-down coordinates. Optional inertia=false and deceleration=8 (finite (0,100], exponential velocity decay in s^-1) configure Web host-only release motion; no elastic overscroll. Stable item keys and explicit fixed row/cell sizes are required for virtualization.")],
            "UiScrollNode (also a UiNode); preserve registered virtualList/virtualGrid handles when composing a screen/component.",
            vec!["Construct scroll node; virtual helpers register UI-only materialization callbacks"],
            "Same lifecycle as the corresponding legacy helper; a wrapper does not duplicate a registration or run a simulation tick. Inertia is opt-in, uses host time and stops on new interaction, wheel, pause, geometry/config change, reset, disable, unmount or bounds.",
            vec!["Do not clone registered virtual handles, author contentHeight/maxScroll, use stage coordinates in content or mutate gameplay in renderItem. Unsupported hosts report their capability boundary explicitly."],
            example, vec!["ui.components.create", "ui.scrollView", "ui.virtualList", "ui.virtualGrid", "ui.setRoot"],
        ));
    }
    result
}

fn projected_descriptors() -> Vec<ApiDescriptor> {
    [
        ("setFrame", "Atomically publish a complete ordered encoded-RGB reference Frame.",
         vec![parameter("frame","ProjectedFrame","Explicit rgb8_encoded_rebuild_v1 retains constant triangle RGBA; rgb8_encoded_gouraud_v1 allows affine per-vertex RGB/alpha interpolation. Initial encoded rgb8/depth; ordered draws with independent alpha source/test, RGB ADD blend, depth compare/write, min/mag/U/V. 40B/u32 transport; W1,normalizedZ/RGBA. Matching official WebGL2 checked AAfalse worldhidden profile required; Native/WebGPU/custom unsupported. Original GPU precision/backdrop not implied.")],
         "nil", "api.projected.setFrame({profile='rgb8_encoded_rebuild_v1',initial={rgb8={0,0,0},depth=1},draws={}})"),
        ("set", "Atomically publish preprojected indexed geometry.",
         vec![parameter("id","string","1..128 UTF8 bytes"),parameter("geometry","ProjectedGeometry","texture;40B f32LE clip4/uv2/RGBA4 vertices;u32LE triangle indices;optional signed integer order,depth_test=true,depth_write=true,scissor={x,y,width,height} physical top-left pixels; color_mode=linear|encoded(defaultlinear),filter=nearest|linear(defaultnearest),sampling_space=linear|encoded(defaultlinear),address_mode=clamp|repeat(defaultclamp),alpha_cutoff=0..1(default0.05),alpha_compare=greater_equal(default)|greater; compares sampled alpha times vertex alpha without quantization. blend=opaque(default)|source_over. V1 source_over requires explicit depth_test=false and depth_write=false and preserves sampled alpha times vertex alpha. Official WebGL host-raster only; Native/checked-raster unsupported. Set alpha_cutoff=0 for full-alpha2D artwork; paint order remains signed order then UTF8 ID; no texture/opacity sorting.")],
         "nil", "api.projected.set('batch',{texture='texture://atlas',vertices=v,indices=i})"),
        ("remove", "Remove one existing projected batch.",vec![parameter("id","string","Existing batch ID")],"nil","api.projected.remove('batch')"),
        ("setWorldVisible", "Show or suppress normal world3D presentation without changing simulation or UI.",vec![parameter("visible","boolean","Default true; scene load resets true")],"nil","api.projected.setWorldVisible(false)"),
        ("getViewport", "Read physical render-target pixel dimensions and revision.",vec![],"{width:number,height:number,aspect:number,revision:number}","local view=api.projected.getViewport()"),
    ].into_iter().map(|(name,summary,args,result,example)|descriptor(
        &format!("projected.{name}"),"presentation",summary,
        "Transport a game-owned projector's output through official renderers; read docs/projected-geometry.md.",
        "No camera/world transform, culling, lighting, fog, picking or projection formula is inferred. Legacy opaque set supports native/Three WebGL; source_over requires official WebGL host raster. setFrame requires the explicit official WebGL2 reference profile; Native/WebGPU/custom reject it.",
        args,result,vec!["Bounded presentation state only"],
        "Same canonical payload preserves revision; updates validate before mutation. Scene load clears presentation. Legacy set retains opaque/cutout defaults and omits default blend from canonical snapshots; explicit source_over is revision-bearing. Canvas sampling/crop/pixel equivalence requires actual GPU evidence. setFrame atomically replaces ordered draws and rebuilds caller-known encoded RGB/depth each redraw, with explicit alpha/test/RGB blend/depth/sampler. New Frame indexed W1/Z0..1 and constant triangle RGBA; no original GPU equivalence. Viewport defaults1280x720 headless and hosts report physical size.",
        vec!["PROJECTED_INVALID","PROJECTED_LIMIT","PROJECTED_MISSING","PROJECTED_BACKEND_UNSUPPORTED","PROJECTED_BLEND_UNSUPPORTED"],example,vec!["camera.setTransform"])).collect()
}

fn heightfield_descriptors() -> Vec<ApiDescriptor> {
    vec![
        descriptor(
            "heightfield.set", "presentation",
            "Create or atomically replace a regular updateable heightfield mesh.",
            "Present game-owned height samples as terrain or another regular surface.",
            "The game owns editing/spell rules and sample values. No collision, navigation, wrapping or water is created. Requires a host implementing heightfields; initially native presentation.",
            vec![parameter("id", "string", "1..128 UTF-8 bytes"), parameter("definition", "HeightfieldDefinition", "Exactly {width,depth,heights,cell_size,origin:Vec3,texture}; row-major X-fast local heights, dimensions 2..512")],
            "nil", vec!["Replace validated presentation geometry"],
            "Identical content preserves revision. Effective edits allocate a deterministic world-monotonic revision. Full samples and revision participate in canonical observations. Empty worlds retain their previous JSON shape.",
            vec!["HEIGHTFIELD_INVALID", "HEIGHTFIELD_LIMIT: 16 fields / 1048576 samples per world; 262144 samples per field", "Unsupported render hosts must reject heightfields explicitly"],
            "api.heightfield.set('ground',{width=2,depth=2,heights={0,0,1,1},cell_size=1,origin={x=0,y=0,z=0},texture='texture://ground'})",
            vec!["heightfield.update", "heightfield.remove"],
        ),
        descriptor(
            "heightfield.update", "presentation",
            "Atomically replace a rectangular region of existing height samples.",
            "Publish samples after the game computes a terrain brush or simulation edit.",
            "Coordinates are zero-based sample indices. The engine does not choose edit strength, radius, topology or gameplay effects.",
            vec![parameter("id", "string", "Existing field ID"), parameter("patch", "HeightfieldPatch", "Exactly {x,z,width,depth,heights}; nonempty in-bounds rectangle with width*depth row-major samples")],
            "nil", vec!["Replace sample rectangle"],
            "All fields and samples validate before mutation. No-op patches preserve revision; hosts cache geometry by ID/revision. Dimensions/origin/cell_size/texture change only through set.",
            vec!["HEIGHTFIELD_MISSING", "HEIGHTFIELD_PATCH_INVALID", "HEIGHTFIELD_INVALID"],
            "api.heightfield.update('ground',{x=0,z=0,width=1,depth=1,heights={2}})",
            vec!["heightfield.set", "heightfield.remove"],
        ),
        descriptor(
            "heightfield.remove", "presentation",
            "Remove an existing heightfield presentation surface.",
            "Release a game-owned terrain surface at a lifecycle boundary.",
            "Does not remove entities, colliders or game-owned sample arrays.",
            vec![parameter("id", "string", "Existing field ID")], "nil", vec!["Remove presentation surface"],
            "Missing IDs fail. Recreating a removed ID receives a fresh revision. Applying a new scene clears runtime-created heightfields.",
            vec!["HEIGHTFIELD_MISSING"], "api.heightfield.remove('ground')", vec!["heightfield.set"],
        ),
    ]
}

fn physics3d_descriptors() -> Vec<ApiDescriptor> {
    [
        ("getBody","id:string","Read immutable authored collider and body settings. Current velocity/pose comes from snapshot; definition_digest avoids repeating large mesh arrays every frame."),
        ("addBody","id:string, body:Body3D (game schema body3d)","Attach a sphere, box, capsule, convex or static trimesh rigid body to an existing Transform3D; shape dimensions are explicit world units."),
        ("removeBody","id:string","Remove a body, its collider and attached joints; leave the entity at its current pose."),
        ("setGravity","value:Vec3","Set scene gravity and wake dynamic bodies."),
        ("setVelocity","id:string, value:Vec3","Set dynamic linear velocity in world units per second."),
        ("setAngularVelocity","id:string, value:Vec3","Set dynamic angular velocity in world radians per second."),
        ("applyImpulse","id:string, value:Vec3","Apply an instantaneous world linear impulse and wake the dynamic body."),
        ("applyTorqueImpulse","id:string, value:Vec3","Apply an instantaneous world angular impulse and wake the dynamic body."),
        ("addForce","id:string, value:Vec3","Add a persistent world force; call clearForces to stop it."),
        ("addTorque","id:string, value:Vec3","Add persistent world torque; call clearForces to stop it."),
        ("clearForces","id:string","Clear persistent force and torque and wake the body."),
        ("teleport","id:string, pose:Pose3D","Set position and XYZ Euler rotation immediately, retain velocity and synchronize Transform3D; no sweep along the teleport path."),
        ("moveKinematic","id:string, pose:Pose3D","Set a kinematic body's next fixed-step pose; the solver derives velocity and pushes dynamic bodies."),
        ("raycast","request:Ray3D (game schema ray3d)","Query the closest collider along from/to using a spatial index; returns nil or id, fraction, point and normal."),
        ("castShape","request:Cast3D (game schema cast3d)","Sweep a convex shape at fixed orientation against indexed colliders; returns nil or id, fraction, world point and outward normal."),
        ("overlap","request:Overlap3D (game schema overlap3d)","Return sorted collider entity IDs intersecting a convex shape. Sensors excluded unless requested."),
        ("snapshot","none","Read 3D gravity, body poses/quaternions/velocities/sleep states, joint definitions and contact lifecycle without advancing time."),
        ("contacts","none","Read last completed step's sorted enter/stay/exit contact and sensor pairs; normal points from a toward b, exit has zero normal/impulse."),
        ("addJoint","id:string, joint:Joint3D (game schema joint3d)","Connect distinct bodies with fixed, spherical or limited revolute joints using local anchors; contacts disabled by default."),
        ("removeJoint","id:string","Remove a joint by ID and wake its connected bodies."),
    ].into_iter().map(|(name,args,purpose)|descriptor(
        &format!("physics3d.{name}"),"physics3d",purpose,
        "For opt-in 3D rigid-body games and AI physics inspection.",
        "Enable systems.physics3d. Gameplay rules, damage and effect selection remain in Lua. Physics owns registered transforms; use teleport/moveKinematic instead of setTransform3D.",
        if args=="none" {vec![]}else{vec![parameter("arguments","typed",args)]},
        match name {"getBody"=>"Body3D","snapshot"=>"Physics3D snapshot or nil","contacts"=>"Collision3D[]","raycast"|"castShape"=>"QueryHit3D or nil","overlap"=>"string[]",_=>"nil"},
        vec![if matches!(name,"getBody"|"snapshot"|"contacts"|"raycast"|"castShape"|"overlap") {"Read physics state; no implicit step"}else{"Change solver configuration/state; no implicit step"}],
        "Fixed 60 Hz, single-threaded Rapier enhanced-determinism. Snapshot is an observation, not a complete resumable solver save. Contacts are read on the following Game.update.",
        vec!["SYSTEM_DISABLED","PHYSICS3D_BODY_MISSING","invalid/unknown fields","PHYSICS3D_OWNERSHIP"],
        "local state = api.physics3d.snapshot()",
        vec!["physics3d.snapshot","physics3d.contacts","physics3d.raycast"]
    )).collect()
}

#[allow(clippy::too_many_arguments)]
fn descriptor(
    name: &str,
    category: &str,
    purpose: &str,
    when_to_use: &str,
    when_not_to_use: &str,
    parameters: Vec<ApiParameter>,
    returns: &str,
    side_effects: Vec<&str>,
    frame_semantics: &str,
    common_errors: Vec<&str>,
    example: &str,
    related_apis: Vec<&str>,
) -> ApiDescriptor {
    ApiDescriptor {
        name: name.to_string(),
        category: category.to_string(),
        purpose: purpose.to_string(),
        when_to_use: when_to_use.to_string(),
        when_not_to_use: when_not_to_use.to_string(),
        parameters,
        returns: returns.to_string(),
        side_effects: side_effects.into_iter().map(str::to_string).collect(),
        frame_semantics: frame_semantics.to_string(),
        common_errors: common_errors.into_iter().map(str::to_string).collect(),
        example: example.to_string(),
        related_apis: related_apis.into_iter().map(str::to_string).collect(),
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{api_search_result, describe, descriptors, search, typings};

    #[test]
    fn generic_batch_collision_search_discovers_spatial_contract_and_bundled_guide() {
        for query in ["batch collision", "GPU collision", "空間查詢", "批次碰撞查詢"] {
            let found = search(query);
            assert!(!found.is_empty(), "{query}");
            assert!(found.iter().all(|api| api.name.starts_with("spatial.")), "{query}");
            assert!(found.iter().all(|api| api.when_to_use.contains("docs/spatial-batches.md")), "{query}");
            assert!(search(&format!("{query} unfindable")).is_empty(), "{query}");
        }
        assert_eq!(search("spatial.take")[0].name, "spatial.take");
    }

    #[test]
    fn typography_and_box_intents_discover_official_ui_authoring() {
        for query in [
            "font",
            "font size",
            "font weight",
            "typography",
            "text alignment",
            "text wrapping",
            "border padding",
            "background color",
            "how do I change font size",
            "字體",
            "字級 排版 樣式",
            "文字換行",
            "顏色 邊框 內距",
            "字體大小與排版",
            "font_size",
            "font_family",
            "font_weight",
            "line_height",
            "text_align",
            "vertical_align",
            "letter_spacing",
            "border_color",
            "border_width",
            "border_radius",
            "overflow",
        ] {
            let found = search(query);
            assert_eq!(
                found.first().map(|api| api.name.as_str()),
                Some("ui.setRoot"),
                "{query}"
            );
            assert!(
                found.iter().all(|api| api.name.starts_with("ui.")),
                "{query}"
            );
            assert!(found[0].when_to_use.contains("docs/ui-styling.md"));
            assert!(found[0].related_apis.contains(&"ui.getViewport".to_owned()));
        }
        for query in ["viewport", "portrait", "螢幕比例"] {
            assert_eq!(search(query)[0].name, "ui.getViewport", "{query}");
        }
        assert_eq!(search("ui.setRoot").len(), 1);
        assert_eq!(search("ui.getViewport").len(), 1);
        assert!(
            search("ECS元件").is_empty(),
            "UI alias matching must not capture unrelated component queries"
        );
        assert!(
            search("entity size")
                .iter()
                .any(|api| api.name == "entity.getTransform2D")
        );
    }

    #[test]
    fn scoped_background_intents_discover_composition_without_hiding_world_queries() {
        for query in [
            "card background",
            "component overlap",
            "reusable card backgrounds",
            "background_for",
            "ancestor background scope",
            "卡片背景",
            "元件重疊",
            "如何處理元件重疊",
            "组件重叠",
        ] {
            let matches = search(query);
            assert_eq!(
                matches.first().map(|api| api.name.as_str()),
                Some("ui.setRoot"),
                "{query}"
            );
            assert!(
                matches.iter().all(|api| api.name.starts_with("ui.")),
                "{query}"
            );
            let api = &matches[0];
            assert!(api.when_to_use.contains("background_for={component=id}"));
            assert!(
                api.parameters[0]
                    .meaning
                    .contains("later fully contained descendants")
            );
            assert!(api.parameters[0].meaning.contains("Exact-pair v1"));
            assert!(
                api.common_errors
                    .iter()
                    .any(|error| error.contains("actual ancestor component ID"))
            );
        }
        assert_eq!(search("ui.setRoot").len(), 1);
        assert!(
            search("physics3d overlap")
                .iter()
                .any(|api| api.name.starts_with("physics3d."))
        );
        assert!(search("ECS元件").is_empty());
    }

    #[test]
    fn shared_component_queries_discover_the_real_versioned_package_entrypoints() {
        for query in [
            "UI package",
            "official UI package",
            "@unone/ui package",
            "@unone/ui",
            "shared components",
            "reusable components",
            "shared UI controls",
            "component styling",
            "card component",
            "UI components",
            "components",
            "官方UI套件",
            "共用元件",
            "共用 UI 元件",
            "共用UI元件",
            "共用UI組件",
            "UI元件",
            "共享UI组件",
            "主題樣式",
        ] {
            let found = search(query);
            assert_eq!(
                found.first().map(|api| api.name.as_str()),
                Some("ui.components.create"),
                "{query}"
            );
            assert!(
                found.iter().any(|api| api.name == "ui.components.info"),
                "{query}"
            );
            assert!(
                found.iter().all(|api| api.name.starts_with("ui.")),
                "{query}"
            );
            assert!(found[0].when_to_use.contains("docs/ui-components.md"));
        }
        assert_eq!(search("UI package version")[0].name, "ui.components.info");
        for name in [
            "ui.components.info",
            "ui.components.create",
            "ui.components.composeStyle",
            "ui.components.id",
        ] {
            let found = search(name);
            assert_eq!(found.len(), 1, "{name}");
            assert_eq!(found[0].name, name);
        }
        assert!(describe("ui.components.button").is_some());
        assert!(describe("ui.component").is_none());
        assert!(search("UI package unfindable").is_empty());
        assert!(search("ECS元件").is_empty());
        assert!(
            search("entity size")
                .iter()
                .any(|api| api.name == "entity.getTransform2D")
        );
        assert!(
            search("physics3d overlap")
                .iter()
                .any(|api| api.name.starts_with("physics3d."))
        );

        let create = describe("ui.components.create").unwrap();
        assert_eq!(create.parameters[0].type_name, "UiComponentsTheme?");
        assert!(create.returns.contains("UiComponentKit"));
        assert!(create.returns.contains("UiComponentNode"));
        assert!(
            create.parameters[0]
                .meaning
                .contains("flattened UiPlacement")
        );
        assert!(
            create.parameters[0]
                .meaning
                .contains("background_for={component=id}")
        );
        assert!(
            create
                .frame_semantics
                .contains("padding merges by edge and RGBA arrays replace")
        );
        assert!(
            create
                .when_not_to_use
                .contains("Themes, content, state, actions and geometry belong to project Luau")
        );
        assert!(
            create
                .common_errors
                .iter()
                .any(|error| error.contains("UI_PACKAGE_NOT_DECLARED"))
        );
        let info = describe("ui.components.info").unwrap();
        assert!(
            info.when_to_use
                .contains("Available without a runtime_packages declaration")
        );
        assert!(info.returns.contains("declared:boolean"));
    }

    #[test]
    fn aggregate_press_intent_is_scoped_and_describes_the_existing_snapshot() {
        for query in ["input.hasPressedActions","hasPressedActions","any pressed action","has pressed actions","any semantic press edge","是否有按下動作","任意按下事件"] {
            assert_eq!(search(query).first().map(|api|api.name.as_str()),Some("input.hasPressedActions"),"{query}");
        }
        for query in ["any pressed action unfindable","any held action","any text activity"] {
            assert!(!search(query).iter().any(|api|api.name=="input.hasPressedActions"),"{query}");
        }
        let api=describe("input.hasPressedActions").unwrap();
        assert!(api.parameters.is_empty());assert!(api.purpose.contains("O(1)"));
        assert!(api.frame_semantics.contains("same pressed set as wasPressed"));
        assert!(api.when_not_to_use.contains("whole update"));
        assert!(typings().contains("hasPressedActions: () -> boolean"));
        assert!(describe("input.hasPressedAction").is_none());
    }

    #[test]
    fn ui_authoring_intents_rank_callable_controls_and_non_consuming_edges() {
        for (queries, expected) in [
            (&["button click", "button pressed", "buttonclick", "按鈕點擊", "按钮点击", "按一下", "按下瞬間", "按下瞬间"][..], "input.wasPressed"),
            (&["release", "button released", "放開", "放开"][..], "input.wasReleased"),
            (&["hold", "button held", "長按", "长按"][..], "input.isDown"),
            (&["create button", "button component", "建立按鈕", "建立按钮"][..], "ui.components.button"),
            (&["slider component", "slider drag", "slider value", "create interactive slider", "draggable numeric slider", "可拖曳滑桿", "滑桿", "滑杆", "滑桿拖曳", "如何使用滑桿數值"][..], "ui.components.createSlider"),
            (&["combobox", "dropdown", "下拉選單", "下拉选单"][..], "ui.components.combobox"),
            (&["scrollview", "scroll view", "捲動容器", "滚动容器", "scroll inertia", "scrollview deceleration", "慣性捲動", "捲動減速設定"][..], "ui.components.scrollView"),
            (&["virtual list", "虛擬清單", "虚拟列表"][..], "ui.components.virtualList"),
            (&["virtual grid", "虛擬網格", "虚拟网格"][..], "ui.components.virtualGrid"),
            (&["UI types", "UI 型別", "UI 类型引导"][..], "ui.components.create"),
            (&["component relative coordinates", "元件座標", "相对坐标"][..], "ui.components.component"),
        ] {
            for query in queries {
                let found = search(query);
                assert_eq!(found.first().map(|api| api.name.as_str()), Some(expected), "{query}");
                assert!(found.iter().all(|api| api.name.starts_with("ui.") || api.name.starts_with("input.")), "{query}");
            }
        }
        for query in ["button click unfindable", "particle hold", "entity release", "UI package unfindable", "ECS元件"] {
            assert!(search(query).is_empty(), "{query}");
        }
        for method in ["text", "button", "slider", "createSlider", "createResponsiveLayout", "combobox", "panel", "image", "component", "screen", "scrollView", "virtualList", "virtualGrid"] {
            let name = format!("ui.components.{method}");
            let found = search(&name);
            assert_eq!(found.len(), 1, "{name}");
            assert_eq!(found[0].name, name);
            assert!(found[0].example.contains(&format!("api.ui.components.{method}(")), "{name}");
        }
        let pressed = describe("input.wasPressed").unwrap();
        assert!(pressed.frame_semantics.contains("Only successful ticks"));
        assert!(pressed.side_effects.iter().any(|text| text.contains("never consumes")));
        assert!(describe("input.isActionJustPressed").is_none());
        assert!(describe("ui.component").is_none());
    }

    #[test]
    fn responsive_intents_discover_the_shared_model_without_cross_family_matches() {
        for query in ["responsive", "responsive layout", "adaptive UI layout", "breakpoints", "row", "column", "grid", "row column grid layout", "create shared responsive layout", "responsive layout types", "scroll responsive layout", "自適應", "自適應排版", "自适应布局", "響應式斷點", "响应式断点", "如何使用自適應排版", "橫排", "直排", "網格"] {
            let found = search(query);
            assert_eq!(found.first().map(|api| api.name.as_str()), Some("ui.components.createResponsiveLayout"), "{query}");
            assert!(found.iter().all(|api| api.name.starts_with("ui.")), "{query}");
            assert!(found[0].when_to_use.contains("docs/ui-responsive.md"));
            assert!(found[0].when_to_use.contains("UiResponsiveLayoutOptions<T>"));
            assert!(found[0].returns.contains("UiResponsiveLayout<T>"));
            assert!(search(&format!("{query} unfindable")).is_empty(), "{query}");
        }
        for query in ["particle responsive", "entity row", "virtual responsive layout", "自適應未知排版", "responsive click", "responsive wrap"] {
            assert!(search(query).is_empty(), "{query}");
        }
        assert_eq!(search("virtual grid")[0].name, "ui.components.virtualGrid");
        assert_eq!(search("font size")[0].name, "ui.setRoot");
        assert_eq!(search("viewport")[0].name, "ui.getViewport");
        let exact = search("ui.components.createResponsiveLayout");
        assert_eq!(exact.len(), 1);
        assert_eq!(exact[0].parameters[0].type_name, "UiResponsiveLayoutOptions<T>");
        assert!(exact[0].frame_semantics.contains("highest minAspect <= viewport.aspect"));
        assert!(describe("ui.components.create").unwrap().returns.contains("UiResponsiveLayout<T>"));
    }

    #[test]
    fn composed_ui_queries_consume_known_words_within_one_capability_family() {
        for (queries, expected) in [
            (&["按住按鈕", "按住 按鈕", "如何使用按住按鈕", "hold down button", "held semantic button"][..], "input.isDown"),
            (&["兩個讀者按下瞬間", "多個讀者重複讀取按下瞬間", "multiple readers press", "two readers read button press", "both readers same snapshot pressed"][..], "input.wasPressed"),
            (&["可捲動清單", "建立可捲動清單", "可滚动列表", "scrollable list", "create shared scrollable list", "scroll list"][..], "ui.components.scrollView"),
            (&["文字字重", "文字 字重", "系統字體字重", "system font", "default system font family", "text font weight"][..], "ui.setRoot"),
            (&["settings screen", "preferences screen", "設定畫面", "設置界面", "建立偏好設定畫面"][..], "ui.components.screen"),
        ] {
            for query in queries {
                let matches = search(query);
                assert_eq!(matches.first().map(|api| api.name.as_str()), Some(expected), "{query}");
                assert!(matches.iter().all(|api| api.name.starts_with("ui.") || api.name.starts_with("input.")), "{query}");
                if expected == "ui.components.scrollView" {
                    assert!(matches.iter().any(|api| api.name == "ui.components.virtualList"), "{query}");
                    assert!(matches[0].when_to_use.contains("docs/ui-scroll.md"), "{query}");
                } else if expected == "ui.setRoot" {
                    assert!(matches[0].when_to_use.contains("docs/ui-styling.md"), "{query}");
                }
                assert!(search(&format!("{query} unfindable")).is_empty(), "{query}");
            }
        }
        for query in [
            "按住按鈕未知", "未知按住按鈕", "兩個讀者未知按下瞬間",
            "可捲動未知清單", "文字字重未知", "系統未知字體",
            "字體未知", "未知元件重疊", "共用UI元件未知",
            "settings screen unfindable", "設定畫面未知",
            "particle hold", "entity release", "particle scrollable list",
            "entity system font", "button click unfindable", "UI package unfindable",
            "調整音量", "選擇品質",
        ] {
            assert!(search(query).is_empty(), "{query}");
        }
        assert_ne!(search("system").first().map(|api| api.name.as_str()), Some("ui.setRoot"));
        assert!(!search("settings").iter().any(|api| api.name == "ui.components.screen"));
        for name in ["input.isDown", "input.wasPressed", "ui.components.scrollView", "ui.components.virtualList", "ui.setRoot"] {
            let matches = search(name);
            assert_eq!(matches.len(), 1, "{name}");
            assert_eq!(matches[0].name, name);
        }
    }

    #[test]
    fn visual_intents_discover_native_particles_before_external_effects() {
        for query in [
            "vfx",
            "explosion",
            "thruster",
            "fire",
            "sparks",
            "smoke",
            "粒子特效",
            "爆炸",
            "尾焰",
            "how do I make thruster fire?",
        ] {
            let matches = search(query);
            assert_eq!(
                matches.first().map(|api| api.name.as_str()),
                Some("particle.play"),
                "{query}"
            );
            assert_eq!(
                matches
                    .iter()
                    .filter(|api| api.name.starts_with("particle."))
                    .count(),
                6,
                "{query}"
            );
            assert!(
                matches.iter().all(|api| api.name.starts_with("particle.")
                    || api.name.starts_with("effect.")
                    || (query == "vfx" && api.name.starts_with("shader."))),
                "unrelated visual search results for {query}"
            );
            let native_last = matches
                .iter()
                .rposition(|api| api.name.starts_with("particle."))
                .unwrap();
            let external_first = matches
                .iter()
                .position(|api| api.name.starts_with("effect."))
                .unwrap();
            assert!(native_last < external_first, "{query}");
        }
    }

    #[test]
    fn exact_api_and_explicit_effekseer_queries_keep_their_intent() {
        assert_eq!(
            search(" PARTICLE.PLAY ")
                .iter()
                .map(|api| api.name.as_str())
                .collect::<Vec<_>>(),
            vec!["particle.play"]
        );
        assert_eq!(
            search("effect.spawn")
                .iter()
                .map(|api| api.name.as_str())
                .collect::<Vec<_>>(),
            vec!["effect.spawn"]
        );
        let external = search("Effekseer explosion");
        assert!(!external.is_empty());
        assert!(external.iter().all(|api| api.name.starts_with("effect.")));
        // An unrelated word must not broaden the query to every position API.
        assert!(search("unfindable position").is_empty());
        assert!(search("???").is_empty());
    }

    #[test]
    fn generic_effect_words_preserve_explicit_shader_intent() {
        for query in ["shader effects", "custom shader effects", "shader vfx"] {
            let matches = search(query);
            assert!(!matches.is_empty(), "{query}");
            assert_eq!(matches[0].name, "shader.setMaterial", "{query}");
            assert!(
                matches.iter().all(|api| api.name.starts_with("shader.")),
                "{query}"
            );
        }
        // Specific exhaust/impact queries still guide ordinary effect authoring
        // to native particles before the external Effekseer integration.
        assert!(
            search("thruster fire")
                .iter()
                .all(|api| !api.name.starts_with("shader."))
        );
    }

    #[test]
    fn native_and_external_effect_descriptions_explain_authoring_and_ownership() {
        let native = describe("particle.play").unwrap();
        assert!(native.purpose.contains("declarative JSON"));
        assert!(native.when_to_use.contains("docs/native-particles.md"));
        assert!(native.when_to_use.contains("docs/particle.schema.json"));
        assert!(native.when_to_use.contains("/web/particle-lab/"));
        assert!(native.related_apis.contains(&"effect.spawn".to_string()));

        let external = describe("effect.spawn").unwrap();
        assert!(external.purpose.contains("external Effekseer"));
        assert!(external.related_apis.contains(&"particle.play".to_string()));
        assert!(
            external
                .when_not_to_use
                .contains("separate native particle APIs do simulate")
        );
        assert!(
            !external
                .when_not_to_use
                .contains("engine neither simulates particles")
        );
    }

    #[test]
    fn retained_artwork_discovery_exposes_the_resource_lifecycle_and_cheap_instance_contract() {
        let define=describe("ui.imageBatch.define").unwrap();
        assert!(define.purpose.contains("retained"));
        assert!(define.frame_semantics.contains("Identical content preserves"));
        assert!(define.when_to_use.contains("retained-image-artwork"));
        assert_eq!(search("ui.imageBatch.define")[0].name,"ui.imageBatch.define");
        assert!(describe("ui.imageBatch.remove").unwrap().common_errors.iter().any(|error|error.contains("UI_IMAGE_BATCH_IN_USE")));
        for query in ["2D GPU artwork","image batching","image batch pixel snap","retained images","many images","camera pan","大量圖片","大量 图片","相機平移"] {
            let matches=search(query);
            assert_eq!(matches.first().map(|entry|entry.name.as_str()),Some("ui.imageBatch.define"),"{query}");
            assert!(matches.iter().any(|entry|entry.name=="ui.components.imageBatch"),"{query}");
            assert!(matches.iter().all(|entry|!entry.name.starts_with("projected.")),"{query}");
            assert!(search(&format!("{query} unfindable")).is_empty(),"{query}");
        }
        assert_eq!(search("projected.set")[0].name,"projected.set");
        assert_eq!(search("ui.components.image")[0].name,"ui.components.image");
        assert_eq!(search("ui image")[0].name,"ui.components.image");
    }

    #[test]
    fn empty_query_is_the_complete_index_without_empty_warning() {
        let result = api_search_result(Path::new("missing-project"), "");
        let report = result.value.expect("search should return a report");

        assert!(result.ok);
        assert!(result.diagnostics.is_empty());
        assert_eq!(report.query, "");
        assert_eq!(report.matches.len(), search("").len());
        assert!(!report.matches.is_empty());
        assert!(report.suggested_next_actions.is_empty());
    }

    #[test]
    fn no_match_keeps_success_and_has_fixed_discovery_guidance() {
        let result = api_search_result(Path::new("missing-project"), "attack");
        let report = result
            .value
            .as_ref()
            .expect("search should return a report");
        let diagnostic = result
            .diagnostics
            .first()
            .expect("no-match search should explain the next step");

        assert!(result.ok);
        assert_eq!(report.query, "attack");
        assert!(report.matches.is_empty());
        assert_eq!(diagnostic.code, "API_SEARCH_EMPTY");
        assert!(matches!(
            diagnostic.severity,
            crate::diagnostics::DiagnosticSeverity::Warning
        ));
        assert_eq!(
            diagnostic.facts,
            serde_json::json!({
                "search_scope": "public_engine_api",
                "query": "attack",
                "match_count": 0,
            })
        );
        assert!(diagnostic.explanation.contains("game-owned composition"));
        assert_eq!(diagnostic.suggested_actions.len(), 2);
        assert_eq!(
            diagnostic
                .suggested_actions
                .iter()
                .map(|action| action.action.as_str())
                .collect::<Vec<_>>(),
            vec!["search_api_index", "list_systems"]
        );
        assert!(
            diagnostic
                .suggested_actions
                .iter()
                .all(|action| action.command.is_none())
        );

        assert_eq!(report.suggested_next_actions.len(), 2);
        let full_index = &report.suggested_next_actions[0];
        assert_eq!(full_index.action, "search_api_index");
        assert!(full_index.ready);
        assert_eq!(full_index.executable.as_deref(), Some("game"));
        assert_eq!(
            full_index
                .argv
                .as_ref()
                .expect("full index should have argv"),
            &vec![
                "api".to_string(),
                "search".to_string(),
                String::new(),
                "--json".to_string(),
            ]
        );

        let systems = &report.suggested_next_actions[1];
        assert_eq!(systems.action, "list_systems");
        assert!(!systems.ready);
        assert!(systems.executable.is_none());
        assert!(systems.argv.is_none());
        assert!(!systems.reason.is_empty());
        assert!(systems.diagnostic.is_some());
    }

    #[test]
    fn matching_query_keeps_existing_search_results_without_diagnostic() {
        let result = api_search_result(Path::new("missing-project"), "position");

        assert!(result.ok);
        assert!(
            !result
                .value
                .as_ref()
                .expect("search should return a report")
                .matches
                .is_empty()
        );
        assert!(result.diagnostics.is_empty());
        assert!(
            result
                .value
                .as_ref()
                .expect("search should return a report")
                .suggested_next_actions
                .is_empty()
        );
    }

    /// Top-level fields of every `export type Name = {` table in the typings.
    fn luau_type_fields(types: &str) -> std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>> {
        let mut out = std::collections::BTreeMap::<String, std::collections::BTreeMap<String, String>>::new();
        let mut bases = Vec::<(String, String)>::new();
        let mut current: Option<String> = None;
        for line in types.lines() {
            if let Some(rest) = line.strip_prefix("export type ") {
                // `Name = {` or an intersection `Name = Base & {`.
                current = rest.split_once(" = ").and_then(|(name, body)| {
                    let base = body.strip_suffix('{')?.trim().strip_suffix('&').map(str::trim);
                    if base.is_none() && !body.trim().eq("{") {
                        return None;
                    }
                    let name = name.split('<').next().unwrap().trim().to_string();
                    if let Some(base) = base {
                        bases.push((name.clone(), base.to_string()));
                    }
                    out.entry(name.clone()).or_default();
                    Some(name)
                });
                continue;
            }
            if line.starts_with('}') {
                current = None;
                continue;
            }
            let (Some(name), Some(field)) = (&current, line.strip_prefix("    ")) else { continue };
            if field.starts_with(' ') || field.starts_with("--") {
                continue;
            }
            if let Some((key, ty)) = field.split_once(':')
                && !key.is_empty()
                && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            {
                out.get_mut(name).unwrap().insert(key.to_string(), ty.trim().trim_end_matches(',').to_string());
            }
        }
        for (name, base) in bases {
            let inherited = out.get(&base).cloned().unwrap_or_default();
            let own = out.get_mut(&name).unwrap();
            for (key, ty) in inherited {
                own.entry(key).or_insert(ty);
            }
        }
        out
    }

    /// Resolve `a.b.c` through EngineApi's typed fields to the member's type.
    fn resolve_typed_path<'a>(
        fields: &'a std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>>,
        path: &str,
    ) -> Option<&'a String> {
        let mut owner = fields.get("EngineApi")?;
        let mut segments = path.split('.').peekable();
        while let Some(segment) = segments.next() {
            let ty = owner.get(segment)?;
            if segments.peek().is_none() {
                return Some(ty);
            }
            let name: String = ty.trim_start_matches('(').chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
            owner = fields.get(&name)?;
        }
        None
    }

    /// Every documented API must resolve to a field of its own namespace type,
    /// or `check --types` silently stops covering it. A bare member-name match
    /// anywhere in the file (e.g. `set:` in another namespace) is not enough.
    #[test]
    fn the_type_contract_covers_every_documented_api() {
        let fields = luau_type_fields(typings());
        let missing: Vec<_> = descriptors()
            .into_iter()
            .map(|descriptor| descriptor.name)
            .filter(|name| resolve_typed_path(&fields, name).is_none())
            .collect();
        assert!(missing.is_empty(), "APIs with no Luau type in their namespace: {missing:?}");
    }

    /// The live Luau API, the catalog and the typings must name the same
    /// functions, so `api describe` and `check --types` never drift from what
    /// a game can actually call.
    #[test]
    fn live_api_functions_match_typings_and_catalog() {
        let source = r#"
local Game = {}
function Game.start(api)
    local found = {}
    local seen = {}
    local function walk(prefix, value)
        if seen[value] then return end
        seen[value] = true
        local keys = {}
        for key in value do table.insert(keys, key) end
        table.sort(keys)
        for _, key in keys do
            local child = value[key]
            local path = if prefix == "" then key else prefix .. "." .. key
            if type(child) == "function" then table.insert(found, path)
            elseif type(child) == "table" then walk(path, child) end
        end
    end
    walk("", api)
    api.observation.set("surface", found)
end
function Game.update(api) end
return Game
"#;
        let runtime = crate::EngineRuntime::load_source("surface", "main.luau", source, None).unwrap();
        let live: std::collections::BTreeSet<String> = runtime.semantic_observations()["surface"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap().to_string())
            // Engine-internal helpers that games must not call.
            .filter(|path| !path.split('.').any(|segment| segment.starts_with('_')))
            .collect();
        let fields = luau_type_fields(typings());
        let untyped: Vec<_> = live.iter().filter(|path| resolve_typed_path(&fields, path).is_none()).collect();
        assert!(untyped.is_empty(), "callable APIs missing from engine.d.luau: {untyped:?}");
        let catalog: std::collections::BTreeSet<String> = descriptors().into_iter().map(|descriptor| descriptor.name).collect();
        let phantom: Vec<_> = catalog.iter().filter(|name| !live.contains(*name)).collect();
        assert!(phantom.is_empty(), "catalog entries that are not callable at runtime: {phantom:?}");
    }
}
