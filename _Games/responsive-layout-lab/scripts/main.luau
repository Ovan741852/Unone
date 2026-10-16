--!strict
-- Engine type contract, inlined by `project init`.
-- Refresh after upgrades with `game api typings --update-script scripts/main.luau`.
-- BEGIN UNONE API TYPES
-- Unone public Luau contract.
--
-- This file is the engine's own copy and the single source of truth. A test
-- asserts every API in the engine's semantic index appears here, so the two
-- cannot drift. Write it into a project with:
--     game api typings --output <path>
-- project init inlines it into the entry script, because the engine runtime
-- has no module require: a single-file game must carry its own types for
-- `game check --types` to mean anything.
-- Official SDK-bundled Luau packages use typed API namespaces such as
-- api.ui.components; declare their exact runtime_packages versions in the project.
-- Refresh an existing marked type block without replacing game code with:
--     game --project <root> api typings --update-script <project-relative-script>
--
-- Game-owned models, ViewModels, Views and save schemas belong in the game.

export type Vec2 = { x: number, y: number }
export type Vec3 = { x: number, y: number, z: number }
export type Transform2D = { position: Vec2, rotation: number, scale: Vec2 }
export type Transform3D = { position: Vec3, rotation: Vec3, scale: Vec3 }
export type Camera3DTransform = { position: Vec3, target: Vec3, fovDegrees: number }

export type ObservationValue =
    nil
    | boolean
    | number
    | string
    | {[string]: ObservationValue}
    | {ObservationValue}

export type EntityApi = {
    spawn: (name: string) -> string,
    despawn: (id: string) -> (),
    setSpriteVisible: (id: string, visible: boolean) -> (),
    getPosition: (id: string) -> Vec2,
    setPosition: (id: string, position: Vec2) -> (),
    getVelocity: (id: string) -> Vec2,
    setVelocity: (id: string, velocity: Vec2) -> (),
    getTransform2D: (id: string) -> Transform2D,
    setTransform2D: (id: string, transform: Transform2D) -> (),
    getTransform3D: (id: string) -> Transform3D,
    setTransform3D: (id: string, transform: Transform3D) -> (),
}

export type Instances3DApi = {
    -- Packed little-endian f32 records: position.xyz, quaternion.xyzw, scale.xyz (40 bytes).
    -- Replaces a complete batch atomically; max 262144 instances / 256 batches per world.
    set: (id: string, asset: string, transforms: buffer) -> (),
    remove: (id: string) -> (),
}

export type InputApi = {
    -- Current-tick host-projected UI event. Prefer createSlider().update(input).
    getSliderInteraction: (id: string) -> UiSliderInteraction?,
    isDown: (action: string) -> boolean,
    -- Non-consuming edges for the current simulation tick. Read in update;
    -- multiple reads return the same result. Held actions press only once.
    wasPressed: (action: string) -> boolean,
    wasReleased: (action: string) -> boolean,
    getPointerPosition: () -> Vec2,
    getScreenPointerPosition: () -> Vec2,
    isPointerDown: () -> boolean,
}

export type RandomApi = {
    nextFloat: () -> number,
    nextInt: (min: number, max: number) -> number,
}

export type PhysicsApi = {
    applyImpulse: (id: string, impulse: Vec2) -> (),
}
export type SphereSweepTarget = { id: string, radius: number, previous_position: Vec3 }
export type SphereSweepHit = { id: string, fraction: number, point: Vec3, normal: Vec3 }
export type Physics3DApi = {
    getBody: (id: string) -> Body3D,
    addBody: (id: string, body: Body3D) -> (),
    removeBody: (id: string) -> (),
    setGravity: (value: Vec3) -> (),
    setVelocity: (id: string, value: Vec3) -> (),
    setAngularVelocity: (id: string, value: Vec3) -> (),
    applyImpulse: (id: string, value: Vec3) -> (),
    applyTorqueImpulse: (id: string, value: Vec3) -> (),
    addForce: (id: string, value: Vec3) -> (),
    addTorque: (id: string, value: Vec3) -> (),
    clearForces: (id: string) -> (),
    teleport: (id: string, pose: Pose3D) -> (),
    moveKinematic: (id: string, pose: Pose3D) -> (),
    raycast: (request: {from: Vec3, to: Vec3, filter: QueryFilter3D?}) -> SphereSweepHit?,
    castShape: (request: {pose: Pose3D, to: Vec3, shape: Shape3D, filter: QueryFilter3D?}) -> SphereSweepHit?,
    overlap: (request: {pose: Pose3D, shape: Shape3D, filter: QueryFilter3D?}) -> {string},
    snapshot: () -> any,
    contacts: () -> {{a: string,b: string,sensor: boolean,normal: Vec3,impulse: number,phase: string}},
    addJoint: (id: string, joint: {body_a:string,body_b:string,anchor_a:Vec3,anchor_b:Vec3,joint:JointKind3D,contacts_enabled:boolean?}) -> (),
    removeJoint: (id: string) -> (),
    sweepSphere: (request: { from: Vec3, to: Vec3, radius: number, targets: {SphereSweepTarget} }) -> SphereSweepHit?,
}
export type Pose3D = {position:Vec3,rotation:Vec3?}
export type Shape3D = {kind:"sphere",radius:number} | {kind:"box",half_extents:Vec3} | {kind:"capsule",half_height:number,radius:number} | {kind:"convex",vertices:{Vec3}} | {kind:"trimesh",vertices:{Vec3},indices:{{number}}}
export type Body3D = {body_type:"dynamic"|"static"|"kinematic",shape:Shape3D,mass:number?,velocity:Vec3?,angular_velocity:Vec3?,friction:number?,restitution:number?,linear_damping:number?,angular_damping:number?,gravity_scale:number?,sensor:boolean?,ccd:boolean?,lock_rotation:boolean?,can_sleep:boolean?,membership:number?,filter:number?}
export type QueryFilter3D = {membership:number?,filter:number?,exclude:string?,include_sensors:boolean?}
export type JointKind3D = {kind:"fixed"}|{kind:"spherical"}|{kind:"revolute",axis:Vec3,limits:{number}?}

export type CameraApi = {
    -- Canonical Unity-like camera: one 3D transform plus a projection mode.
    -- `orthographic` is the 2D-compatible projection; `perspective` is the
    -- regular 3D projection. The old 2D calls below remain compatibility
    -- helpers and should not be used to model a second camera.
    getProjection: () -> ("orthographic" | "perspective"),
    setProjection: (projection: "orthographic" | "perspective") -> (),
    getTransform: () -> CameraTransform,
    setTransform: (transform: CameraTransformInput) -> (),
    getPosition: () -> Vec2,
    setPosition: (position: Vec2) -> (),
    getZoom: () -> number,
    setZoom: (zoom: number) -> (),
}

export type CameraTransform = {
    projection: "orthographic" | "perspective",
    position: Vec3,
    target: Vec3,
    fovDegrees: number?,
    orthographicSize: number?,
}

export type CameraTransformInput = {
    projection: ("orthographic" | "perspective")?,
    position: Vec3,
    target: Vec3?,
    fovDegrees: number?,
    orthographicSize: number?,
}

export type Camera3DApi = {
    getTransform: () -> Camera3DTransform,
    setPosition: (position: Vec3) -> (),
    setTarget: (target: Vec3) -> (),
}

export type ObservationApi = {
    set: (key: string, value: ObservationValue) -> (),
}

-- The UI design space is 0..100 on both axes and **y points UP**: y = 0 is the
-- bottom of the screen, y = 100 the top, and a rect grows upward from its y.
-- Most UI systems are y-down, so this is the single easiest thing to get wrong
-- when you cannot see the screen.
--
-- A UI node declares its placement exactly one of two ways.
--
-- `rect` is absolute in the 0..100 design space; use it when the layout is not
-- edge relative, such as a ring laid out with trigonometry.
--
-- `anchor` + `size` (+ optional `offset` and `pivot`) is edge relative. Its
-- numbers are vertical units on both axes -- percent of the viewport height --
-- so a box keeps its shape and its distance from the edge on any screen shape.
-- The engine resolves it against the viewport the host reports.
export type UiAnchor =
    "top_left" | "top" | "top_right"
    | "left" | "center" | "right"
    | "bottom_left" | "bottom" | "bottom_right"

export type UiApi = {
    components: UiComponentsApi,
    setRoot: (root: UiScreen) -> (),
    -- Current host width/height ratio, also used by anchored placement.
    -- Read-only environment data; pass to components.createResponsiveLayout().resolve.
    getViewport: () -> {aspect: number},
    -- Helpers return a real scroll_view node. Content is local top-left/y-down;
    -- viewport uses explicit left/top; never pass a stage x/y rect here.
    scrollView: (options: UiScrollOptions) -> UiScrollNode,
    virtualList: <T>(options: UiVirtualOptions<T>) -> UiScrollNode,
    virtualGrid: <T>(options: UiVirtualGridOptions<T>) -> UiScrollNode,
    -- Actual host ceilings and the last valid tree's node/subtree usage.
    inspect: () -> ObservationValue,
}
export type UiRect = {x: number, y: number, width: number, height: number}
-- Every style length uses vertical units (1 = 1% of viewport height).
-- Styles belong to one leaf, with no implicit inheritance. An explicit
-- font_size does not change when its box changes and never silently shrinks.
export type UiColor = {number} -- exactly four RGBA values, each in 0..1
export type UiInsets = {left: number?, top: number?, right: number?, bottom: number?}
export type UiStyle = {
    font_family: string?, font_size: number?, font_weight: number?,
    line_height: number?, letter_spacing: number?, color: UiColor?,
    text_align: ("start" | "center" | "end")?,
    vertical_align: ("top" | "middle" | "bottom")?,
    wrap: ("none" | "word")?, overflow: ("clip" | "ellipsis")?,
    padding: UiInsets?, background: UiColor?, border_color: UiColor?,
    border_width: number?, border_radius: number?, opacity: number?,
}
export type UiPlacement = {
    rect: UiRect?, anchor: UiAnchor?, pivot: UiAnchor?,
    offset: {x: number?, y: number?}?, size: {width: number, height: number}?,
}
export type UiTextNode = UiPlacement & {
    kind: "text", id: string, text: string?, style: UiStyle?,
}
export type UiButtonNode = UiPlacement & {
    kind: "button", id: string, text: string?, action: string, style: UiStyle?,
}
export type UiSliderNode = UiPlacement & {
    kind: "slider", id: string, text: string?, action: string, style: UiStyle?,
    drag: UiSliderDrag?,
}
export type UiSliderInteraction = {phase: "start" | "drag" | "end" | "cancel", ratio: number}
export type UiSliderDrag = {
    axis: "horizontal" | "vertical", reverse: boolean, enabled: boolean,
    track_rect: UiRect, hit_rect: UiRect,
}
export type UiSliderOptions = {
    id: string, value: number, min: number?, max: number?, step: number?,
    axis: ("horizontal" | "vertical")?, reverse: boolean?,
    onChange: never?, onClick: never?,
}
-- Explicit rects in the node's current stage/scroll space; no duplicate pointer
-- mapping in projects. Hosts project, clip and capture these together.
export type UiSliderViewProps = {
    rect: UiRect, trackRect: UiRect?, hitPadding: number?, enabled: boolean?,
    text: string?, action: string?, style: UiStyle?,
    onChange: never?, value: never?,
}
export type UiSliderUpdate = {
    value: number, changed: boolean, dragging: boolean,
    started: boolean, released: boolean, cancelled: boolean,
}
export type UiSliderControl = {
    view: (props: UiSliderViewProps) -> UiSliderNode,
    update: (input: InputApi) -> UiSliderUpdate,
    getValue: () -> number,
    setValue: (value: number) -> (),
    cancel: () -> (),
}
export type UiComboBoxNode = UiPlacement & {
    kind: "combobox", id: string, text: string?, action: string,
    expanded: boolean?, style: UiStyle?,
}
-- Image and panel styles accept box fields; typography requires a text leaf.
-- A decorative surface may explicitly belong to its screen or an ancestor
-- component in the same coordinate space. This never changes placement/order.
export type UiBackgroundScope = {screen: true} | {component: string}
export type UiImageNode = UiPlacement & {
    kind: "image", id: string, asset: string, fit: ("contain" | "cover" | "stretch")?,
    alt: string?, slice: UiSlice?, style: UiStyle?, background_for: UiBackgroundScope?,
}
export type UiPanelNode = UiPlacement & {
    kind: "panel", id: string, style: UiStyle?, background_for: UiBackgroundScope?,
}
export type UiComponentNode = UiPlacement & {
    -- Grouping does not transform children: their coordinates remain in the
    -- current stage/scroll space, with no relative-placement or style inheritance.
    kind: "component", id: string, component: string, children: {UiNode}?,
}
export type UiScrollNode = UiPlacement & {
    kind: "scroll_view", id: string, viewport: UiViewport?,
    scroll: {axis: string?, enabled: boolean?, inertia: boolean?, deceleration: number?, reset_key: string?, wheel_rect: UiRect?, virtual_items: any?},
    children: {UiNode}?,
}
export type UiNode = UiTextNode | UiButtonNode | UiSliderNode | UiComboBoxNode
    | UiImageNode | UiPanelNode | UiComponentNode | UiScrollNode
export type UiScreen = {kind: "screen", id: string, node: string, children: {UiNode}, budget: UiBudget?}
-- @unone/ui: pure constructors and explicitly selected declarative layout.
-- create snapshots these defaults; leaf overrides win, padding merges per edge.
export type UiComponentsTheme = {
    text: UiStyle?, button: UiStyle?, panel: UiStyle?, image: UiStyle?,
    slider: UiStyle?, combobox: UiStyle?,
}
export type UiComponentTextProps = UiPlacement & {
    id: string, text: string?, style: UiStyle?,
}
export type UiComponentButtonProps = UiPlacement & {
    id: string, text: string?, action: string, style: UiStyle?,
}
-- Common invented value/binding props are absent; state belongs to the project.
-- Unknown fields and placement combinations still require runtime validation.
export type UiComponentSliderProps = UiPlacement & {
    value: never?, min: never?, max: never?, step: never?, onChange: never?,
    id: string, text: string?, action: string, style: UiStyle?,
}
export type UiComponentComboBoxProps = UiPlacement & {
    value: never?, options: never?, selected: never?, onChange: never?,
    id: string, text: string?, action: string, expanded: boolean?, style: UiStyle?,
}
export type UiComponentPanelProps = UiPlacement & {
    id: string, style: UiStyle?, background_for: UiBackgroundScope?,
}
export type UiComponentImageProps = UiPlacement & {
    id: string, asset: string, fit: ("contain" | "cover" | "stretch")?,
    alt: string?, slice: UiSlice?, style: UiStyle?, background_for: UiBackgroundScope?,
}
export type UiComponentSurface = {
    kind: "panel", style: UiStyle?,
} | {
    kind: "image", asset: string, fit: ("contain" | "cover" | "stretch")?,
    alt: string?, slice: UiSlice?, style: UiStyle?,
}
export type UiComponentProps = UiPlacement & {
    id: string, component: string, children: {UiNode}?, surface: UiComponentSurface?,
}
export type UiComponentScreenProps = {
    id: string, node: string, children: {UiNode}, budget: UiBudget?,
}
-- Layout lengths use normalized stage units per axis, like rect/viewport.
-- They are NOT font/anchor vertical units. No intrinsic text measurement.
-- A recursive record preserves contextual literal inference in strict Luau.
-- The factory validates kind-dependent fields (grid columns, slot children,
-- root sizing) and reports UI_LAYOUT_* errors before publishing anything.
export type UiLayoutNode = {
    id: string, kind: "slot" | "row" | "column" | "grid",
    size: number?, grow: number?, children: {UiLayoutNode}?,
    gap: number?, padding: UiInsets?, columns: number?,
    rect: never?, style: never?, flex: never?, wrap: never?, direction: never?,
}
export type UiResponsiveVariant<T> = {
    name: string, minAspect: number, layout: UiLayoutNode, values: T,
}
export type UiResponsiveLayoutOptions<T> = {
    space: ("stage" | "scroll")?, variants: {UiResponsiveVariant<T>},
    onResize: never?, breakpoints: never?,
}
export type UiResponsiveLayoutResult<T> = {
    variant: string, values: T,
    -- Fresh canonical copies; stage rect is y-up, scroll rect is y-down.
    rect: (id: string) -> UiRect,
    -- Top-left/y-down in either space; suitable for ScrollView viewport.
    viewport: (id: string) -> UiViewport,
}
export type UiResponsiveLayout<T> = {
    -- Pure: highest minAspect <= viewport.aspect, fallback first (minAspect=0).
    -- Stage bounds stay inside 0..100; scroll bounds may extend beyond 100.
    resolve: (viewport: {aspect: number}, bounds: UiViewport?) -> UiResponsiveLayoutResult<T>,
}
export type UiComponentKit = {
    -- Create once with authored groups/thresholds; resolve each View for reflow.
    createResponsiveLayout: <T>(options: UiResponsiveLayoutOptions<T>) -> UiResponsiveLayout<T>,
    -- Preferred complete numeric slider: reusable state plus semantic host capture.
    createSlider: (options: UiSliderOptions) -> UiSliderControl,
    text: (props: UiComponentTextProps) -> UiTextNode,
    button: (props: UiComponentButtonProps) -> UiButtonNode,
    slider: (props: UiComponentSliderProps) -> UiSliderNode,
    combobox: (props: UiComponentComboBoxProps) -> UiComboBoxNode,
    panel: (props: UiComponentPanelProps) -> UiPanelNode,
    image: (props: UiComponentImageProps) -> UiImageNode,
    component: (props: UiComponentProps) -> UiComponentNode,
    screen: (props: UiComponentScreenProps) -> UiScreen,
    -- Same engine-owned live helpers as UiApi. Scroll content is local
    -- top-left/y-down; the viewport uses left/top/width/height.
    scrollView: (options: UiScrollOptions) -> UiScrollNode,
    virtualList: <T>(options: UiVirtualOptions<T>) -> UiScrollNode,
    virtualGrid: <T>(options: UiVirtualGridOptions<T>) -> UiScrollNode,
    id: (instanceId: string, role: string) -> string,
    composeStyle: (base: UiStyle?, override: UiStyle?) -> UiStyle,
}
export type UiComponentsInfo = {
    name: string, version: string, kind: string, entry: string,
    api: string, license: string, declared: boolean,
}
-- Direct constructors use default styles. create(theme) supplies the same
-- constructor methods with explicitly authored per-kind style defaults.
export type UiComponentsApi = UiComponentKit & {
    info: () -> UiComponentsInfo,
    create: (theme: UiComponentsTheme?) -> UiComponentKit,
    composeStyle: (base: UiStyle?, override: UiStyle?) -> UiStyle,
    id: (instanceId: string, role: string) -> string,
}
export type UiViewport = {left: number, top: number, width: number, height: number}
export type UiScrollOptions = {
    id: string, viewport: UiViewport, content: {UiNode}?,
    axis: ("vertical" | "horizontal" | "both")?, enabled: boolean?,
    resetKey: string?, wheelRect: UiViewport?,
    inertia: boolean?, deceleration: number?,
}
-- Give T your project row type to check keys and render callbacks.
-- Bare options keep the legacy any default for existing projects.
export type UiVirtualOptions<T = any> = {
    id: string, viewport: UiViewport, items: {T}, key: string | ((T, number) -> string),
    rowHeight: number, gapY: number?,
    renderItem: (T, number, string) -> {UiNode},
    enabled: boolean?, resetKey: string?, wheelRect: UiViewport?,
    inertia: boolean?, deceleration: number?,
}
export type UiVirtualGridOptions<T = any> = UiVirtualOptions<T> & {
    columns: number, columnWidth: number, gapX: number?,
}

-- One source texture and one node. Border pixels / pixels_per_unit become
-- vertical design units; optional source is a y-down pixel crop, not UI rect.
export type UiSlice = {
    left: number, top: number, right: number, bottom: number,
    pixels_per_unit: number,
    source: {x: number, y: number, width: number, height: number}?,
}
export type UiBudget = {max_nodes: number}

export type SaveApi = {
    set: (value: ObservationValue) -> (),
    get: () -> ObservationValue,
}

export type AnimationOptions = {
    asset: string?,
    loop: boolean?,
    speed: number?,
}

-- Semantic skeletal animation state. The engine stores the selection; the
-- host runs the Spine runtime. Requires system "spine".
export type AnimationApi = {
    play: (id: string, name: string, options: AnimationOptions?) -> (),
    stop: (id: string) -> (),
}

export type EffectOptions = {
    x: number?,
    y: number?,
    scale: number?,
    rotation: number?,
}

-- Semantic effect events. The engine stores live instances; the host runs the
-- Effekseer runtime. Requires system "effekseer".
export type EffectApi = {
    spawn: (asset: string, options: EffectOptions?) -> string,
    stop: (handle: string) -> boolean,
}

export type AudioOptions = {
    volume: number?,
    speed: number?,
    category: string?,
    x: number?,
    y: number?,
    -- Attach the sound to an entity; the engine keeps it on that entity and
    -- stops it when the entity is gone.
    entity: string?,
}

-- Semantic audio requests. The engine owns which sound starts, which one a
-- category switch stops, and the exact frame a fade ends; the host decodes and
-- mixes. Requires system "audio".
export type AudioApi = {
    play: (asset: string, options: AudioOptions?) -> string,
    loop: (asset: string, options: AudioOptions?) -> string,
    stop: (handle: string) -> boolean,
    stopAll: () -> number,
    pause: (handle: string) -> boolean,
    resume: (handle: string) -> boolean,
    pauseAll: () -> number,
    resumeAll: () -> number,
    setMasterVolume: (volume: number) -> (),
    getMasterVolume: () -> number,
    setCategoryVolume: (category: string, volume: number) -> (),
    getCategoryVolume: (category: string) -> number,
}

export type ParticleApi = {
    -- Packed f32le xyz positions, copied at submission. One stoppable batch handle.
    play_batch: (effect: string, positions: buffer, seed: number?) -> string,
    -- Update where new births appear. Existing particles remain in world space.
    move: (handle: string, position: Vec3) -> boolean,
    -- End an emitter now and allow its existing particles to fade naturally.
    finish: (handle: string) -> boolean,
    -- Other particle fields are authored in scene particle_effects and validated against particle.schema.json.
    stats: () -> {active_handles: number, max_handles: number, reserved_particles: number, max_particles: number, live_particles: number},
    play: (effect: string, position: Vec3, seed: number?) -> string,
    stop: (handle: string) -> boolean,
}

export type DebugTab = {id: string, label: string}
export type DebugControl =
    {kind: "button", id: string, tab: string, label: string}
    | {kind: "label", id: string, tab: string, text: string}
    | {kind: "checkbox", id: string, tab: string, label: string, checked: boolean}
export type DebugApi = {
    enabled: boolean,
    registerTab: (tab: DebugTab) -> (),
    register: (control: DebugControl, callback: ((value: boolean?) -> ())?) -> (),
    set: (id: string, value: string | boolean) -> (),
}
export type JobsApi = {
    schedule: (operation: string, options: {every_ticks: number, times: number?}, prepare: (api: any, occurrence: number) -> buffer, apply: (api: any, output: buffer, occurrence: number) -> ()) -> string,
    register: (id: string, source: string) -> (),
    submit: (operation: string, input: buffer) -> string,
    take: (handle: string) -> buffer,
    cancel: (handle: string) -> (),
    reset: () -> (),
}
export type ShaderUniform = number | {number}
export type ShaderApi = {
    setMaterial: (entityId: string, materialId: string) -> (),
    clearMaterial: (entityId: string) -> (),
    setUniform: (materialId: string, name: string, value: ShaderUniform) -> (),
}

export type EngineApi = {
    shader: ShaderApi,
    jobs: JobsApi,
    instances3d: Instances3DApi,
    debug: DebugApi,
    particle: ParticleApi,
    entity: EntityApi,
    input: InputApi,
    random: RandomApi,
    physics: PhysicsApi,
    physics3d: Physics3DApi,
    camera: CameraApi,
    -- Deprecated compatibility namespace; new code uses camera.*.
    camera3d: Camera3DApi,
    observation: ObservationApi,
    ui: UiApi,
    save: SaveApi,
    animation: AnimationApi,
    effect: EffectApi,
    audio: AudioApi,
    log: (message: string) -> (),
}

export type Game = {
    start: (api: EngineApi) -> (),
    update: (api: EngineApi, dt: number) -> (),
}
-- END UNONE API TYPES
-- All content, theme choices and breakpoints below belong to this project.
-- The retained package models own responsive selection and rectangle arithmetic.
type Presentation = {
    headingSize: number, bodySize: number, cardTitleSize: number,
    metricSize: number, cardBodySize: number, columns: number,
}
type CardContent = {id: string, title: string, value: string, description: string}

local Game = {}
local kit: UiComponentKit? = nil
local dashboard: UiResponsiveLayout<Presentation>? = nil
local cardLayout: UiResponsiveLayout<{}>? = nil
local refreshCount = 0
local cards: {CardContent} = {
    {id="workspaces",title="Workspaces",value="12",description="Shared projects and notes."},
    {id="inbox",title="Inbox",value="04",description="Items ready for review."},
    {id="reports",title="Reports",value="08",description="Updates from your team."},
    {id="automations",title="Automations",value="06",description="Routines running smoothly."},
}

local function dashboardTree(columns: number, actionWidth: number): UiLayoutNode
    return {id="root",kind="column",gap=1.5,
        padding={left=4,top=4,right=4,bottom=4},children={
            {id="heading",kind="slot",size=7},
            {id="subtitle",kind="slot",size=4},
            {id="toolbar",kind="row",gap=2,size=7,children={
                {id="refresh",kind="slot",size=actionWidth},
                {id="activity",kind="slot"},
            }},
            {id="section",kind="slot",size=4},
            {id="cards",kind="grid",columns=columns,gap=1.8,children={
                {id="workspaces",kind="slot"},
                {id="inbox",kind="slot"},
                {id="reports",kind="slot"},
                {id="automations",kind="slot"},
            }},
            {id="footer",kind="slot",size=4},
        }}
end

local function cardTree(metricHeight: number): UiLayoutNode
    return {id="card",kind="column",gap=0.6,
        padding={left=1.8,top=1.0,right=1.8,bottom=1.0},children={
            {id="title",kind="slot",size=3},
            {id="metric",kind="slot",size=metricHeight},
            {id="description",kind="slot"},
        }}
end

local function summaryCard(ui: UiComponentKit, resolved: UiResponsiveLayoutResult<Presentation>,
        viewport: {aspect: number}, content: CardContent): UiComponentNode
    local inner = assert(cardLayout).resolve(viewport,resolved.viewport(content.id))
    return ui.component({id="card/"..content.id,component="summary_card",
        rect=resolved.rect(content.id),
        surface={kind="panel",style={background={0.055,0.094,0.13,1},
            border_color={0.15,0.23,0.29,1},border_width=0.1,border_radius=1.2}},
        children={
            ui.text({id=content.id.."/title",text=content.title,rect=inner.rect("title"),
                style={font_size=resolved.values.cardTitleSize,font_weight=600,
                    color={0.71,0.81,0.87,1}}}),
            ui.text({id=content.id.."/value",text=content.value,rect=inner.rect("metric"),
                style={font_size=resolved.values.metricSize,font_weight=700,
                    color={0.37,0.9,0.76,1}}}),
            ui.text({id=content.id.."/description",text=content.description,rect=inner.rect("description"),
                style={font_size=resolved.values.cardBodySize,wrap="word",line_height=1.35,
                    vertical_align="top",color={0.59,0.7,0.77,1}}}),
        }})
end

local function publish(api: EngineApi)
    local ui = assert(kit)
    local viewport = api.ui.getViewport()
    local resolved: UiResponsiveLayoutResult<Presentation> = assert(dashboard).resolve(viewport)
    local children: {UiNode} = {
        ui.panel({id="background",rect=resolved.rect("root"),background_for={screen=true},
            style={background={0.025,0.047,0.071,1}}}),
        ui.text({id="heading",text="Command center",rect=resolved.rect("heading"),
            style={font_size=resolved.values.headingSize,font_weight=700,color={0.93,0.97,0.99,1}}}),
        ui.text({id="subtitle",text="A clear view of your day.",rect=resolved.rect("subtitle"),
            style={font_size=resolved.values.bodySize,color={0.55,0.69,0.77,1}}}),
        ui.button({id="refresh_button",text="Refresh",action="RefreshDashboard",rect=resolved.rect("refresh"),
            style={font_size=resolved.values.bodySize}}),
        ui.text({id="activity",text="Refreshed "..tostring(refreshCount).." times",rect=resolved.rect("activity"),
            style={font_size=resolved.values.bodySize,color={0.64,0.77,0.83,1},
                background={0.045,0.076,0.1,1},border_radius=0.8,
                padding={left=1.3,right=1.3}}}),
        ui.text({id="section",text="WORKSPACE OVERVIEW",rect=resolved.rect("section"),
            style={font_size=1.35,font_weight=700,letter_spacing=0.14,color={0.39,0.67,0.72,1}}}),
    }
    for _, content in cards do
        table.insert(children,summaryCard(ui,resolved,viewport,content))
    end
    table.insert(children,ui.text({id="footer",text="Your progress stays with you.",rect=resolved.rect("footer"),
        style={font_size=1.4,color={0.42,0.57,0.65,1}}}))
    api.ui.setRoot(ui.screen({id="dashboard",node="command_center",children=children}))
    api.observation.set("refresh_count",refreshCount)
    api.observation.set("ui_variant",resolved.variant)
    api.observation.set("ui_columns",resolved.values.columns)
    api.observation.set("ui_aspect",viewport.aspect)
    api.observation.set("ui_regions",{
        toolbar=resolved.rect("toolbar"),refresh=resolved.rect("refresh"),
        activity=resolved.rect("activity"),cards=resolved.rect("cards"),
        workspaces=resolved.rect("workspaces"),inbox=resolved.rect("inbox"),
        reports=resolved.rect("reports"),automations=resolved.rect("automations"),
    })
end

function Game.start(api: EngineApi)
    local ui = api.ui.components.create({
        text={font_family="sans-serif",text_align="start",vertical_align="middle",overflow="clip"},
        button={font_family="sans-serif",font_weight=700,text_align="center",vertical_align="middle",
            color={0.025,0.15,0.14,1},background={0.38,0.91,0.77,1},
            border_radius=0.8,padding={left=1,right=1}},
        panel={background={0.055,0.094,0.13,1}},
    })
    kit = ui
    local options: UiResponsiveLayoutOptions<Presentation> = {variants={
        {name="narrow",minAspect=0,layout=dashboardTree(1,38),values={
            headingSize=3.1,bodySize=1.7,cardTitleSize=1.9,metricSize=3.7,cardBodySize=1.6,columns=1}},
        {name="medium",minAspect=0.85,layout=dashboardTree(2,24),values={
            headingSize=3.8,bodySize=1.9,cardTitleSize=2.2,metricSize=5.6,cardBodySize=1.8,columns=2}},
        {name="wide",minAspect=1.45,layout=dashboardTree(4,17),values={
            headingSize=4.2,bodySize=2,cardTitleSize=2.5,metricSize=7.2,cardBodySize=1.95,columns=4}},
    }}
    dashboard = ui.createResponsiveLayout(options)
    local cardOptions: UiResponsiveLayoutOptions<{}> = {variants={
        {name="narrow",minAspect=0,layout=cardTree(4.6),values={}},
        {name="medium",minAspect=0.85,layout=cardTree(7.5),values={}},
        {name="wide",minAspect=1.45,layout=cardTree(9.5),values={}},
    }}
    cardLayout = ui.createResponsiveLayout(cardOptions)
    local packageInfo = api.ui.components.info()
    api.observation.set("ui_package",{name=packageInfo.name,version=packageInfo.version,declared=packageInfo.declared})
    publish(api)
end

function Game.update(api: EngineApi, _dt: number)
    if api.input.wasPressed("RefreshDashboard") then
        refreshCount += 1
    end
    publish(api)
end

return Game
