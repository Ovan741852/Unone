--!strict
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
    -- Read-only environment data; selecting a layout remains game code.
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
    scroll: {axis: string?, enabled: boolean?, reset_key: string?, wheel_rect: UiRect?, virtual_items: any?},
    children: {UiNode}?,
}
export type UiNode = UiTextNode | UiButtonNode | UiSliderNode | UiComboBoxNode
    | UiImageNode | UiPanelNode | UiComponentNode | UiScrollNode
export type UiScreen = {kind: "screen", id: string, node: string, children: {UiNode}, budget: UiBudget?}
-- @unone/ui: pure constructors. All positions/order remain explicitly authored.
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
export type UiComponentSliderProps = UiPlacement & {
    id: string, text: string?, action: string, style: UiStyle?,
}
export type UiComponentComboBoxProps = UiPlacement & {
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
export type UiComponentKit = {
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
}
-- Give T your project row type to check keys and render callbacks.
-- Bare options keep the legacy any default for existing projects.
export type UiVirtualOptions<T = any> = {
    id: string, viewport: UiViewport, items: {T}, key: string | ((T, number) -> string),
    rowHeight: number, gapY: number?,
    renderItem: (T, number, string) -> {UiNode},
    enabled: boolean?, resetKey: string?, wheelRect: UiViewport?,
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

-- Authored UI example: composition, theme and application state stay in Luau.
local Game = {}
type Settings = {sound: boolean, mode: number, level: number}
local defaults: Settings = {sound=true, mode=2, level=65}
local draft: Settings = {sound=true, mode=2, level=65}
local applied: Settings = {sound=true, mode=2, level=65}
local applyCount = 0
local status = "觀測設定已就緒 READY · 長時間觀測前，請確認環境與設備，讓每一個微小的調整成為今晚更好的開始。請將螢幕亮度維持在舒適範圍，讓雙眼適應黑暗，從容等待下一道星光。"
local previousAspect = 0
local draggingLevel = false
local sliderRect: UiRect = {x=69,y=27,width=15,height=5}
local WHITE: UiColor = {0.93,0.95,0.91,1}
local MUTED: UiColor = {0.49,0.61,0.67,1}
local MINT: UiColor = {0.62,0.88,0.77,1}
local INK: UiColor = {0.028,0.052,0.076,1}
local LINE: UiColor = {0.26,0.39,0.44,0.65}
local READING = "Observatory Reading"
local DISPLAY = "Observatory Display"
local DATA = "Observatory Data, Observatory Reading"
local modeNames = {"月面漫遊 / MOON", "深空巡航 / DEEP SKY", "流星守候 / METEOR"}

local function rect(x: number,y: number,w: number,h: number): UiRect
    return {x=x,y=y,width=w,height=h}
end
local function textStyle(size: number, color: UiColor, family: string?, weight: number?): UiStyle
    return {font_family=family or READING,font_size=size,font_weight=weight or 400,
        text_align="start",vertical_align="middle",color=color,wrap="none",overflow="clip"}
end
local function changed(): boolean
    return draft.sound ~= applied.sound or draft.mode ~= applied.mode or draft.level ~= applied.level
end
local function publish(api: EngineApi)
    local ui: UiComponentKit = api.ui.components.create({button={
        font_family=READING,font_weight=700,line_height=1.25,
        text_align="center",vertical_align="middle",wrap="none",overflow="clip",
        padding={left=0.5,right=0.5,top=0.2,bottom=0.2},
        border_width=0.10,border_radius=0.65,
    }})
    local function label(id: string, text: string, r: UiRect, size: number, color: UiColor, family: string?, weight: number?): UiNode
        return ui.text({id=id,text=text,rect=r,style=textStyle(size,color,family,weight)})
    end
    local function panel(id: string,r: UiRect,fill: UiColor,radius: number,border: UiColor?,opacity: number?,backgroundFor: UiBackgroundScope?): UiNode
        return ui.panel({id=id,rect=r,background_for=backgroundFor,style={background=fill,border_radius=radius,
            border_width=if border then 0.10 else 0,border_color=border,opacity=opacity or 1}})
    end
    local function actionButton(id: string,text: string,action: string,r: UiRect,selected: boolean,small: boolean?): UiNode
        local style: UiStyle = {font_size=if small then 1.35 else 1.75,
            color=if selected then INK else WHITE,
            background=if selected then MINT else {0.06,0.105,0.135,0.88},
            border_color=if selected then MINT else LINE}
        return ui.component({id=id,component="observatory.action_button",rect=r,children={
            ui.button({id=id.."_action",text=text,action=action,rect=r,style=style}),
        }})
    end
    local function settingCard(id: string,index: string,title: string,description: string,r: UiRect,compact: boolean,controls: {UiNode}): UiNode
        local p = if compact then 4 else 3
        local descriptionStyle = textStyle(if compact then 1.35 else 1.5,MUTED,DISPLAY)
        descriptionStyle.wrap="word"
        descriptionStyle.line_height=1.2
        local descriptionNode = ui.text({id=id.."_description",text=description,
            rect=rect(r.x+p,r.y+1.8,if compact then 29 else 21.5,3.3),style=descriptionStyle})
        local children: {UiNode} = {
            label(id.."_index",index,rect(r.x+p,r.y+r.height-3.0,30,1.8),1.0,MUTED,DATA),
            label(id.."_title",title,rect(r.x+p,r.y+r.height-7.3,if compact then 29 else 21,3.7),if compact then 1.85 else 2.2,WHITE,READING,700),
            descriptionNode,
        }
        for _,control in controls do table.insert(children,control) end
        return ui.component({id=id,component="observatory.setting_card",rect=r,
            surface={kind="panel",style={background={0.055,0.091,0.121,0.94},border_radius=0.95,
                border_width=0.10,border_color=LINE,opacity=1}},children=children})
    end
    local function levelControl(compact: boolean): {UiNode}
        local minus = if compact then rect(42,22.5,8,5) else rect(64,26,5,5)
        local plus = if compact then rect(80,22.5,8,5) else rect(85,26,5,5)
        sliderRect = if compact then rect(51,22.5,27,5) else rect(70,26,14,5)
        local track = rect(sliderRect.x+1,sliderRect.y+2.15,sliderRect.width-2,0.7)
        local fillWidth = math.max(0.15,track.width*draft.level/100)
        local thumbX = track.x+(track.width-0.8)*draft.level/100
        return {
            label("level_value",tostring(draft.level).."%",if compact then rect(75,27.2,13,3.4) else rect(81,33.1,9,3.5),2.8,MINT,DATA),
            actionButton("level_minus","−","LevelDown",minus,false),
            panel("level_track",track,{0.18,0.28,0.33,1},0.4),
            panel("level_fill",rect(track.x,track.y,fillWidth,track.height),MINT,0.4),
            panel("level_thumb",rect(thumbX,sliderRect.y+1.5,0.8,2),WHITE,0.4),
            ui.slider({id="level_slider",action="SetLevel",text="",rect=sliderRect,
                style={background={0,0,0,0},color={0,0,0,0},border_width=0}}),
            actionButton("level_plus","+","LevelUp",plus,false),
        }
    end
    local aspect = api.ui.getViewport().aspect
    local compact = aspect < 1.1
    previousAspect = aspect
    local nodes: {UiNode} = {
        panel("night_background",rect(0,0,100,100),INK,0,nil,nil,{screen=true}),
        label("brand","ASTER / 星序觀測站",rect(6,if compact then 94 else 92,70,3),2.1,WHITE,READING,700),
        panel("header_rule",rect(6,if compact then 92 else 88,88,0.1),LINE,0),
    }
    if compact then
        table.insert(nodes,label("display_title","MAKE ROOM\nFOR THE NIGHT.",rect(6,80,88,11.5),5.0,WHITE,DISPLAY,700))
        table.insert(nodes,label("chinese_title","把夜空，留給自己。",rect(6,75,88,4),2.4,MINT,READING,700))
    else
        table.insert(nodes,label("station_id","STATION / 07",rect(77,92,17,3),1.4,MUTED,DATA))
        table.insert(nodes,label("display_title","MAKE ROOM\nFOR THE NIGHT.",rect(6,62,29,23),if aspect < 1.35 then 5.8 else 7.1,WHITE,DISPLAY,700))
        table.insert(nodes,label("chinese_title","把夜空，留給自己。",rect(6,56,29,5),2.65,MINT,READING,700))
        table.insert(nodes,label("section_label","OBSERVATION / 觀測設定",rect(38,84.7,56,3),1.4,MUTED,DATA))
    end
    local paragraphStyle = textStyle(if compact then 1.4 else 1.65,MUTED)
    paragraphStyle.wrap="word"
    paragraphStyle.vertical_align="top"
    paragraphStyle.line_height=1.5
    local introNode = ui.text({id="intro_paragraph",text="調整聲音、觀測模式與顯示亮度，準備一段屬於你的安靜時光。\nA few small adjustments, for a better night under the stars.",
        rect=if compact then rect(6,65,88,8.5) else rect(6,39,27,14),style=paragraphStyle})
    table.insert(nodes,introNode)
    if not compact then
        local preset = ui.component({id="preset_card",component="observatory.preset",rect=rect(6,22,27,14),
            surface={kind="panel",style={background={0.08,0.14,0.17,0.65},border_radius=0.8,
                border_width=0.10,border_color=LINE,opacity=0.88}},children={
            label("preset_label","TONIGHT'S PRESET",rect(8,32,23,2.2),1.1,MUTED,DATA),
            label("preset_mode",modeNames[draft.mode],rect(8,27.2,23,3.5),1.8,WHITE,READING,700),
            label("preset_values",(if draft.sound then "SOUND ON" else "SOUND OFF").."  /  LEVEL "..tostring(draft.level),rect(8,23.8,23,2),1.2,MINT,DATA),
        }})
        table.insert(nodes,preset)
    end
    local soundRect=if compact then rect(6,50,88,13) else rect(38,65,56,18)
    table.insert(nodes,settingCard("sound_card","01 / SOUND","環境聲音","Quiet focus. Clear signals.",soundRect,compact,{
        actionButton("sound_toggle",if draft.sound then "開啟  ON" else "關閉  OFF","ToggleSound",if compact then rect(65,53.5,23,6.5) else rect(76,70.5,14,7),draft.sound),
    }))
    local modeRect=if compact then rect(6,34,88,14) else rect(38,43,56,18)
    local modes: {UiNode} = {}
    local shortNames={"月面\nMOON","深空\nDEEP","流星\nMETEOR"}
    local actions={"ModeMoon","ModeDeep","ModeMeteor"}
    for i=1,3 do
        local r=if compact then rect(39+(i-1)*16.7,36,15.4,7) else rect(63+(i-1)*9.2,48,8.4,7)
        table.insert(modes,actionButton("mode_"..tostring(i),shortNames[i],actions[i],r,draft.mode==i,true))
    end
    table.insert(nodes,settingCard("mode_card","02 / OBSERVATION","觀測模式","Choose tonight's horizon.",modeRect,compact,modes))
    table.insert(nodes,settingCard("level_card","03 / DISPLAY","顯示亮度","A softer light for dark skies.",if compact then rect(6,18,88,14) else rect(38,21,56,18),compact,levelControl(compact)))
    table.insert(nodes,actionButton("reset","重設 / RESET","Reset",if compact then rect(6,8,34,7) else rect(38,9,23,8),false))
    table.insert(nodes,actionButton("apply",if changed() then "套用變更 / APPLY" else "套用 / APPLY","Apply",if compact then rect(43,8,51,7) else rect(64,9,30,8),true))
    if not compact then
        table.insert(nodes,label("draft_badge",if changed() then "UNAPPLIED CHANGES" else "ALL SETTINGS IN SYNC",rect(6,12,28,3),1.3,if changed() then MINT else MUTED,DATA))
        table.insert(nodes,label("applied_counter","APPLIED / "..tostring(applyCount),rect(6,9,27,2),1.1,MUTED,DATA))
    end
    local statusStyle = textStyle(if compact then 1.2 else 1.3,MUTED)
    statusStyle.overflow="ellipsis"
    statusStyle.padding={left=0.7,right=0.7}
    statusStyle.background={0.08,0.13,0.16,0.65}
    statusStyle.border_radius=0.3
    local statusNode = ui.text({id="status_line",text=status,rect=rect(6,3,if compact then 88 else 58,3.2),style=statusStyle})
    table.insert(nodes,statusNode)
    api.ui.setRoot(ui.screen({id="observatory_settings",node="settings",children=nodes}))
    api.observation.set("draft",{sound=draft.sound,mode=draft.mode,level=draft.level})
    api.observation.set("applied",{sound=applied.sound,mode=applied.mode,level=applied.level})
    api.observation.set("apply_count",applyCount)
    api.observation.set("dirty",changed())
    api.observation.set("status",status)
    api.observation.set("compact_ui",compact)
end

function Game.start(api: EngineApi)
    publish(api)
end
function Game.update(api: EngineApi,_dt: number)
    local redraw = api.ui.getViewport().aspect ~= previousAspect
    if api.input.wasPressed("ToggleSound") then
        draft.sound=not draft.sound
        status=if draft.sound then "環境聲音已開啟 SOUND ON · 套用以保留這次調整。" else "環境聲音已關閉 SOUND OFF · 套用以保留這次調整。"
        redraw=true
    end
    local actions={"ModeMoon","ModeDeep","ModeMeteor"}
    for i,action in actions do
        if api.input.wasPressed(action) then
            draft.mode=i
            status="已選擇 SELECTED · "..modeNames[i].." · 套用以保留這次調整。"
            redraw=true
        end
    end
    if api.input.wasPressed("LevelDown") then draft.level=math.max(0,draft.level-5); redraw=true; status="亮度已降低 LEVEL DOWN · 套用以保留這次調整。" end
    if api.input.wasPressed("LevelUp") then draft.level=math.min(100,draft.level+5); redraw=true; status="亮度已提高 LEVEL UP · 套用以保留這次調整。" end
    local pointer=api.input.getScreenPointerPosition()
    local pointerDown=api.input.isPointerDown()
    local inside=pointer.x>=sliderRect.x and pointer.x<=sliderRect.x+sliderRect.width and pointer.y>=sliderRect.y and pointer.y<=sliderRect.y+sliderRect.height
    if pointerDown and (inside or draggingLevel) then
        draggingLevel=true
        local value=math.floor(math.clamp((pointer.x-sliderRect.x-1)/(sliderRect.width-2),0,1)*100+0.5)
        if draft.level~=value then draft.level=value; redraw=true; status="亮度預覽 LEVEL PREVIEW · 套用以保留這次調整。" end
    elseif not pointerDown then draggingLevel=false end
    if api.input.wasPressed("Reset") then
        draft={sound=defaults.sound,mode=defaults.mode,level=defaults.level}
        status="預設值已還原 DEFAULTS RESTORED · 你可以繼續調整，或套用目前設定。"
        redraw=true
    end
    if api.input.wasPressed("Apply") then
        applied={sound=draft.sound,mode=draft.mode,level=draft.level}
        applyCount+=1
        status="設定已套用 APPLIED #"..tostring(applyCount).." · "..modeNames[draft.mode].." · LEVEL "..tostring(draft.level).." · 今晚，慢慢看。"
        redraw=true
    end
    if redraw then publish(api) end
end
return Game
