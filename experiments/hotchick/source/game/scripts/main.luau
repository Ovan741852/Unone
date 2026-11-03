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

-- All selection, virtual betting, random outcomes and movement live in Luau.
-- These probabilities/payouts are provisional demo values, not approved math/RTP.
type Target = {
    id: string, tier: string, characterId: string, x: number, y: number, diameter: number,
    lane: number, speed: number, direction: number, phase: number,
    state: string, winUntil: number, hitUntil: number,
}
type Attack = {
    id: number, roundId: number, weapon: string, targetIds: {string}, hitTargetIds: {string}, bet: number,
    cost: number, age: number, duration: number, pendingShots: number,
}
type Shot = {
    id: number, attackId: number, roundId: number, weapon: string, bet: number, cost: number, targetId: string,
    targetIds: {string}, from: Vec2, to: Vec2, age: number, duration: number,
    x: number, y: number, vx: number, vy: number, rotation: number,
    trajectory: string, collisionCount: number, arcHeight: number,
}
type Floating = {
    id: number, x: number, y: number, amount: number, text: string,
    tier: string, age: number, duration: number,
}
type Clip = {
    clipId: string, characterId: string, styleId: string, prizeTier: string, label: string,
    videoAsset: string, posterAsset: string, replayAsset: string, duration: number, aspectRatio: number, available: boolean,
}
type StyleDefinition = {
    id: string, title: string, labelPrefix: string, tiers: {[string]: boolean},
    minBaseBet: number, weights: {[string]: number},
}
type ChanceBand = {minBaseBet: number, chance: number}
type CharacterDefinition = {
    name: string, portraitAsset: string, fieldPrefix: string, christmasEnabled: boolean,
    profileTitle: string, profileText: string,
    durations: {[string]: number}, aspectRatios: {[string]: number}, styles: {StyleDefinition}, specialChance: number,
}
type Reveal = {
    serial: number, tier: string, assetKey: string, amount: number,
    symbolTier: string, rewardTier: string, preview: boolean, expiresAt: number,
    stage: string, stageStartedAt: number, stageDuration: number,
    videoDuration: number, videoStarted: boolean, videoStartedAt: number, skippedSeenVideo: boolean,
    rewardWaiting: boolean, rewardCompleted: boolean, fxId: number, slot: number, origin: Vec2,
    clip: Clip, baseBet: number, christmasEligible: boolean, styleEligible: boolean, eligibleStyleIds: {string},
    styleRollApplied: boolean, styleRoll: number,
}
type RewardJob = {
    id: number, symbolTier: string, rewardTier: string, amount: number,
    preview: boolean, origin: Vec2, readyAt: number, revealSerial: number, clip: Clip, baseBet: number,
}
type RewardFx = {
    id: number, symbolTier: string, rewardTier: string, amount: number,
    count: number, preview: boolean, origin: Vec2, age: number,
    duration: number, arrivedCount: number, collectedAmount: number, handle: string,
    clip: Clip, baseBet: number,
}

type CardDefinition = {id: string, name: string, characterId: string, rarity: string, effect: string, imageAsset: string}
type CardDraw = {serial: number, cardId: string, isNew: boolean, count: number}
type CardBatch = {serial: number, size: number, items: {CardDraw}}
type CardSystem = {
    reset: () -> (),
    setSeed: (seed: number) -> (),
    spend: (cost: number) -> (),
    draw: (open: boolean, blocked: boolean) -> (),
    drawAll: (open: boolean, blocked: boolean) -> (),
    observe: (spentTotal: number, open: boolean, blocked: boolean) -> ObservationValue,
}

local function createCardSystem(): CardSystem
    local CARD_THRESHOLD = 1000
    local CARD_CAPACITY = 10
    local CARD_RNG_SEED = 104729
    local CARD_RNG_MODULUS = 2147483647
    local CARD_RNG_MULTIPLIER = 48271
    local CARD_RANDOM_RANGE = CARD_RNG_MODULUS-1
    local rarityOdds = {N=0.70,R=0.25,SR=0.05}
    local effects: {[string]: string} = {N="normal",R="foil",SR="diamond"}
    local function card(id: string,name: string,characterId: string,rarity: string): CardDefinition
        return {id=id,name=name,characterId=characterId,rarity=rarity,effect=effects[rarity],imageAsset="cards/"..id..".webp"}
    end
    local definitions: {CardDefinition} = {
        card("eunbi-n-01","恩妃・心動瞬間","eunbi","N"),
        card("eunbi-n-02","恩妃・夏日心意","eunbi","N"),
        card("eunbi-r-01","恩妃・流光邀約","eunbi","R"),
        card("eunbi-r-02","恩妃・閃耀心意","eunbi","R"),
        card("eunbi-sr-01","恩妃・璀璨珍藏","eunbi","SR"),
        card("yeseul-n-01","藝瑟・初見心動","yeseul","N"),
        card("yeseul-r-01","藝瑟・流光時刻","yeseul","R"),
        card("yeseul-sr-01","藝瑟・璀璨心意","yeseul","SR"),
        card("jiayi-n-01","嘉儀・初見心動","jiayi","N"),
        card("jiayi-r-01","嘉儀・流光時刻","jiayi","R"),
        card("jiayi-sr-01","嘉儀・星耀珍藏","jiayi","SR"),
        card("jiayi-sr-02","嘉儀・鑽彩心意","jiayi","SR"),
        card("mugi-n-01","むぎ・暖心瞬間","mugi","N"),
        card("mugi-n-02","むぎ・微光相遇","mugi","N"),
    }
    local pools: {[string]: {CardDefinition}} = {N={},R={},SR={}}
    for _, definition in definitions do table.insert(pools[definition.rarity],definition) end
    local counts: {[string]: number} = {}
    local used,earned,progress,creditedSpend,ignoredSpend = 0,0,0,0,0
    local serial,randomState = 0,CARD_RNG_SEED
    local lastDraw: CardDraw? = nil
    local batchSerial = 0
    local lastBatch: CardBatch? = nil
    local seedReady = false
    local function ready(): boolean
        return #pools.N > 0 and #pools.R > 0 and #pools.SR > 0
    end
    local function nextRaw(): number
        -- Products remain below 2^53, so this integer stream is deterministic
        -- without consuming Unone's outcome/style RNG or reading wall time.
        randomState = (randomState*CARD_RNG_MULTIPLIER)%CARD_RNG_MODULUS
        return randomState-1
    end
    local function uniformIndex(size: number): number
        local limit = CARD_RANDOM_RANGE-CARD_RANDOM_RANGE%size
        local value = nextRaw()
        while value >= limit do value = nextRaw() end
        return value%size+1
    end
    local function drawCards(open: boolean,blocked: boolean,all: boolean)
        local available = earned-used
        if not open or blocked or available <= 0 or not ready() then return end
        -- Snapshot the current packs once. Every item uses the same ordered
        -- RNG/count path as a single draw, in one authoritative operation.
        local size = if all then available else 1
        local items: {CardDraw} = {}
        for _ = 1, size do
            local roll = nextRaw()/CARD_RANDOM_RANGE
            local rarity = if roll < rarityOdds.N then "N" elseif roll < rarityOdds.N+rarityOdds.R then "R" else "SR"
            local pool = pools[rarity]
            local selected = pool[uniformIndex(#pool)]
            local previous = counts[selected.id] or 0
            counts[selected.id]=previous+1;used+=1;serial+=1
            local result: CardDraw = {serial=serial,cardId=selected.id,isNew=previous == 0,count=previous+1}
            table.insert(items,result)
            lastDraw=result
        end
        batchSerial+=1
        lastBatch={serial=batchSerial,size=size,items=items}
    end
    return {
        reset=function()
            counts={};used=0;earned=0;progress=0;creditedSpend=0;ignoredSpend=0
            serial=0;randomState=CARD_RNG_SEED;lastDraw=nil;batchSerial=0;lastBatch=nil;seedReady=false
        end,
        setSeed=function(seed: number)
            if seedReady or used > 0 or seed < 1 or seed >= CARD_RNG_MODULUS or seed%1 ~= 0 then return end
            -- The browser supplies per-session entropy through canonical input.
            -- Keep this stream separate from all outcome/style randomness.
            randomState=seed
            seedReady=true
        end,
        spend=function(cost: number)
            if cost <= 0 then return end
            local room = math.max(0,(CARD_CAPACITY-(earned-used))*CARD_THRESHOLD-progress)
            local accepted = math.min(cost,room)
            creditedSpend+=accepted;ignoredSpend+=cost-accepted
            local total = progress+accepted
            earned+=math.floor(total/CARD_THRESHOLD)
            progress=total%CARD_THRESHOLD
        end,
        draw=function(open: boolean,blocked: boolean)
            drawCards(open,blocked,false)
        end,
        drawAll=function(open: boolean,blocked: boolean)
            drawCards(open,blocked,true)
        end,
        observe=function(spentTotal: number,open: boolean,blocked: boolean): ObservationValue
            local catalog: {ObservationValue} = {}
            for _, definition in definitions do
                catalog[#catalog+1]={id=definition.id,name=definition.name,characterId=definition.characterId,
                    rarity=definition.rarity,effect=definition.effect,imageAsset=definition.imageAsset,count=counts[definition.id] or 0}
            end
            return {threshold=CARD_THRESHOLD,capacity=CARD_CAPACITY,isFull=earned-used>=CARD_CAPACITY,
                spentTotal=spentTotal,progress=progress,creditedSpend=creditedSpend,ignoredSpend=ignoredSpend,
                drawsAvailable=earned-used,drawsEarned=earned,drawsUsed=used,rarityOdds=rarityOdds,
                catalog=catalog,lastDraw=lastDraw,lastBatch=lastBatch,seedReady=seedReady,
                ready=ready(),canDraw=open and not blocked and used < earned and ready()}
        end,
    }
end

local Game = {}
local SMALL_DIAMETER = 0.90
local FLOWER_RADIUS = SMALL_DIAMETER * 1.5
-- The rocket search range remains an unconfirmed, adjustable demo choice.
local ROCKET_RADIUS = SMALL_DIAMETER * 3
local CANNON: Vec2 = {x=0, y=-4.35}
local BETS = {1, 5, 10, 20, 50}
local COSTS: {[string]: number} = {like=1, flower=6, rocket=15}
local ROUND_INTERVALS: {[string]: number} = {like=0.12, flower=0.12/0.45, rocket=0.2}
local ODDS: {[string]: number} = {small=0.40, medium=0.16, large=0.10}
local MIN_MULTIPLIER: {[string]: number} = {small=2, medium=8, large=25}
local MAX_MULTIPLIER: {[string]: number} = {small=6, medium=18, large=60}
local DIAMETERS: {[string]: number} = {small=SMALL_DIAMETER, medium=1.22, large=1.62}
local HEART_COUNTS: {[string]: number} = {small=4, medium=16, large=32}
local CHRISTMAS_MIN_BET = 50
local CHRISTMAS_CHANCE = 0.5
local CLASSIC_STYLE: StyleDefinition = {
    id="classic",title="經典風格",labelPrefix="",tiers={small=true,medium=true,large=true},minBaseBet=0,weights={},
}
local CHRISTMAS_STYLE: StyleDefinition = {
    id="christmas",title="聖誕風格",labelPrefix="聖誕",tiers={medium=true,large=true},
    minBaseBet=CHRISTMAS_MIN_BET,weights={medium=1,large=1},
}
local HALLOWEEN_STYLE: StyleDefinition = {
    id="halloween",title="萬聖風格",labelPrefix="萬聖",tiers={medium=true,large=true},minBaseBet=20,weights={medium=1,large=1},
}
local SUMMER_STYLE: StyleDefinition = {
    id="summer",title="夏日風格",labelPrefix="夏日",tiers={large=true},minBaseBet=50,weights={large=1},
}
local EUNBI_SUMMER_STYLE: StyleDefinition = {
    id="summer",title="夏日風格",labelPrefix="夏日",tiers={medium=true,large=true},minBaseBet=50,weights={medium=1,large=1},
}
local DEFAULT_CHARACTER_ID = "eunbi"
local CHARACTER_ORDER = {"eunbi","yeseul","jiayi","mugi","original"}
local SPAWN_CHARACTER_ORDER = {"eunbi","yeseul","original","mugi","jiayi"}
local CHARACTERS: {[string]: CharacterDefinition} = {
    eunbi={name="恩妃",portraitAsset="eunbi/field-small-poster.webp",fieldPrefix="eunbi",christmasEnabled=false,
        profileTitle="夏日心動",profileText="在海王的故事裡，她把燦爛夏日化成一份專屬心意。集齊她的卡片，收藏相遇的每個瞬間。",
        durations={small=5.041667,medium=5.041667,large=8.041667},aspectRatios={small=1,medium=270/480,large=16/9},
        styles={CLASSIC_STYLE,EUNBI_SUMMER_STYLE},specialChance=0.5},
    yeseul={name="藝瑟",portraitAsset="yeseul/field-small-poster.webp",fieldPrefix="yeseul",christmasEnabled=false,
        profileTitle="百變心意",profileText="經典、萬聖與夏日，都是這段遊戲故事裡不同的心動篇章。與她相遇，留下你最喜歡的片刻。",
        durations={small=4.041667,medium=4.041667,large=8.041667},aspectRatios={small=1,medium=270/480,large=16/9},
        styles={CLASSIC_STYLE,HALLOWEEN_STYLE,SUMMER_STYLE},specialChance=0.5},
    jiayi={name="嘉儀",portraitAsset="jiayi/field-medium-poster.webp",fieldPrefix="jiayi",christmasEnabled=true,
        profileTitle="紫色邀約",profileText="在這場海王派對中，她以不同風格登場。由你收下每一份心意，慢慢完成專屬收藏。",
        durations={small=5.041667,medium=5.041667,large=8.041667},aspectRatios={small=1,medium=270/480,large=16/9},styles={CLASSIC_STYLE,CHRISTMAS_STYLE},specialChance=CHRISTMAS_CHANCE},
    mugi={name="むぎ",portraitAsset="mugi/field-medium-poster.webp",fieldPrefix="mugi",christmasEnabled=true,
        profileTitle="暖心相遇",profileText="在海王的故事裡，經典與聖誕風格為相遇添上兩種色彩。把一次次心動，收進她的收藏頁。",
        durations={small=4.041667,medium=5.041667,large=8.041667},aspectRatios={small=1,medium=270/480,large=16/9},styles={CLASSIC_STYLE,CHRISTMAS_STYLE},specialChance=CHRISTMAS_CHANCE},
    original={name="恩智",portraitAsset="portrait-medium.webp",fieldPrefix="",christmasEnabled=false,
        profileTitle="初見心動",profileText="故事從這次相遇開始。重溫她已解鎖的演出，留下屬於這段遊戲旅程的回憶。",
        durations={small=0,medium=5.041667,large=8.041667},aspectRatios={small=1,medium=1,large=16/9},styles={CLASSIC_STYLE},specialChance=0},
}
local LEGACY_ASSETS: {[string]: {videoAsset: string,posterAsset: string,replayAsset: string,label: string}} = {
    medium={videoAsset="medium-reveal-h264-480.mp4",posterAsset="portrait-medium.webp",replayAsset="medium-reveal-h264.mp4",label="中型女孩演出"},
    large={videoAsset="large-reveal-h264.mp4",posterAsset="portrait-large.webp",replayAsset="large-reveal-h264.mp4",label="大獎滿版演出"},
}
local CLIP_ORDER: {string} = {}
local CLIPS: {[string]: Clip} = {}
local CHRISTMAS_CHARACTER_IDS: {ObservationValue} = {}
local SPECIAL_STYLE_CHARACTER_IDS: {ObservationValue} = {}
for _, characterId in CHARACTER_ORDER do
    local character = CHARACTERS[characterId]
    if character.christmasEnabled then table.insert(CHRISTMAS_CHARACTER_IDS,characterId) end
    if character.specialChance > 0 then table.insert(SPECIAL_STYLE_CHARACTER_IDS,characterId) end
    for _, style in character.styles do
        local styleId = style.id
        for _, tier in {"small","medium","large"} do
            local clipId = characterId.."-"..styleId.."-"..tier
            local available = character.durations[tier] > 0 and style.tiers[tier] == true
            local videoAsset,posterAsset,replayAsset = "","",""
            local sizeLabel = if tier == "small" then "小型" elseif tier == "medium" then "中型" else "大型"
            local label = if styleId ~= "classic" then style.labelPrefix..sizeLabel.."演出" elseif tier == "small" then "小型笑容" elseif tier == "medium" then "中型專屬演出" else "大型滿版演出"
            if available then
                if character.fieldPrefix ~= "" then
                    local prefix = character.fieldPrefix.."/"
                    if tier == "small" then
                        videoAsset=prefix.."field-small.mp4"; posterAsset=prefix.."field-small-poster.webp"; replayAsset=videoAsset
                    else
                        local stem = prefix..styleId.."-"..tier
                        videoAsset=stem..(if tier == "medium" then "-480.mp4" else ".mp4")
                        posterAsset=stem.."-poster.webp"; replayAsset=stem..".mp4"
                    end
                else
                    local legacy = LEGACY_ASSETS[tier]
                    videoAsset=legacy.videoAsset; posterAsset=legacy.posterAsset; replayAsset=legacy.replayAsset; label=legacy.label
                end
            end
            CLIPS[clipId]={clipId=clipId,characterId=characterId,styleId=styleId,prizeTier=tier,label=label,
                videoAsset=videoAsset,posterAsset=posterAsset,replayAsset=replayAsset,
                duration=if available then character.durations[tier] else 0,aspectRatio=character.aspectRatios[tier],available=available}
            table.insert(CLIP_ORDER,clipId)
        end
    end
end
local WALLET: Vec2 = {x=-7.2, y=-4.3}
local FX_DURATION = 1.6
local MAX_FX_GROUPS = 6
-- Performance limits for this prototype, not finalized game rules.
local MAX_MEDIUM_VIDEOS = 6
local MAX_MEDIUM_PREVIEWS = 6
local MEDIUM_ANCHORS: {Vec2} = {
    {x=-2,y=-2.15},{x=2,y=-2.15},{x=-4,y=-2.15},
    {x=4,y=-2.15},{x=-6,y=-2.15},{x=6,y=-2.15},
}
-- DT2's 3D units need an explicit conversion for this 10-unit-high 2D table.
local DT2_SPEED_SCALE = 0.06
local NORMAL_SPEED = 170*DT2_SPEED_SCALE
local TRACK_SPEED = 150*DT2_SPEED_SCALE
local FLOWER_SPEED = 200*DT2_SPEED_SCALE
local ROCKET_SPEED = 500*DT2_SPEED_SCALE
local SHOT_RADIUS = 0.10
local WALL_X = 8.888888889-SHOT_RADIUS
local WALL_Y = 5-SHOT_RADIUS
local SHOT_LIFETIME = 35

local targets: {Target} = {}
local attacks: {Attack} = {}
local shots: {Shot} = {}
local floating: {Floating} = {}
local revealQueue: {Reveal} = {}
local reveal: Reveal? = nil
local mediumReveals: {Reveal} = {}
local mediumQueue: {Reveal} = {}
local rewardQueue: {RewardJob} = {}
local rewardFx: {RewardFx} = {}
local fxSequence = 0
local walletPulse = 0
local walletArrivalsSerial = 0
local walletLastIncrement = 0
local walletLastIncrementSerial = 0
local walletLastIncrementAt = 0
local walletIncrementThisTick = 0
local time = 0
local balance = 10000
local displayBalance = 10000
local pendingWin = 0
local collectedWin = 0
local betIndex = 3
local weapon = "like"
local auto = false
local lock = false
local galleryOpen = false
local viewportBlocked = false
local viewportNeedsFreshInput = false
local lockedTargetId = ""
local lastTargetTier = ""
local lastTargetPosition: Vec2 = {x=0,y=0}
local aimPoint: Vec2 = {x=0,y=3.6}
local aimDirection: Vec2 = {x=0,y=1}
local pointerWasDown = false
local previousPointer: Vec2 = {x=0,y=0}
local gestureHasTarget = false
local cooldown = 0
local cooldownDuration = ROUND_INTERVALS.like
local cadenceContinuous = false
local sequence = 0
local revealSerial = 0
local unlockedMedium = false
local unlockedLarge = false
local spent = 0
local cardSystem = createCardSystem()
local won = 0
local rounds = 0
local captures = 0
local lastCost = 0
local lastWin = 0
local lastRound: {[string]: ObservationValue} = {}
local lastRoundAttackId = 0
local spawnCharacterSequence = 0
local unlockedClips: {[string]: boolean} = {}
local galleryCache: ObservationValue = nil
local largePlayback: {
    skipSeen: boolean, watched: {[string]: boolean}, replayClipId: string, replayStartedAt: number,
} = {skipSeen=false,watched={},replayClipId="",replayStartedAt=0}
local cardViewer: {
    open: boolean, reducedMotion: boolean, effects: {{handle: string, expiresAt: number}},
    nextAt: number, sequence: number,
} = {open=false,reducedMotion=false,effects={},nextAt=0,sequence=0}
local styleRolls = 0
local christmasWins = 0
local specialWins = 0
local message = "虛擬點數試玩｜點女孩射擊，或開啟 AUTO"

local function randomRange(api: EngineApi, low: number, high: number): number
    return low + api.random.nextFloat() * (high - low)
end

local function nextSequence(): number
    sequence += 1
    return sequence
end

local function clipFor(characterId: string,styleId: string,tier: string): Clip
    return CLIPS[characterId.."-"..styleId.."-"..tier]
end

local function clipAspectRatio(clip: Clip): number
    return clip.aspectRatio
end

local function styleFor(characterId: string,styleId: string): StyleDefinition
    for _, style in CHARACTERS[characterId].styles do
        if style.id == styleId then return style end
    end
    return CLASSIC_STYLE
end

local function styleWeight(character: CharacterDefinition,style: StyleDefinition,tier: string): number
    if style.id == "classic" or not style.tiers[tier] or character.durations[tier] <= 0 then return 0 end
    return style.weights[tier] or 0
end

local function eligibleWeight(character: CharacterDefinition,tier: string,baseBet: number): number
    local total = 0
    for _, style in character.styles do
        if baseBet >= style.minBaseBet then total += styleWeight(character,style,tier) end
    end
    return total
end

local function styleChanceAt(character: CharacterDefinition,style: StyleDefinition,tier: string,baseBet: number): number
    if not style.tiers[tier] or character.durations[tier] <= 0 then return 0 end
    local total = eligibleWeight(character,tier,baseBet)
    if style.id == "classic" then return if total > 0 then 1-character.specialChance else 1 end
    if baseBet < style.minBaseBet or total <= 0 then return 0 end
    return character.specialChance*styleWeight(character,style,tier)/total
end

local function eligibleStyleIds(character: CharacterDefinition,tier: string,baseBet: number): {string}
    local result: {string} = {}
    for _, style in character.styles do
        if style.id ~= "classic" and styleChanceAt(character,style,tier,baseBet) > 0 then table.insert(result,style.id) end
    end
    return result
end

local function chanceBands(character: CharacterDefinition,style: StyleDefinition,tier: string): {ChanceBand}
    local thresholds: {number} = {}
    local seen: {[number]: boolean} = {}
    if style.tiers[tier] and character.durations[tier] > 0 then
        for _, candidate in character.styles do
            if candidate.id == "classic" or styleWeight(character,candidate,tier) > 0 then
                local threshold = candidate.minBaseBet
                if threshold >= style.minBaseBet and not seen[threshold] then
                    seen[threshold] = true
                    table.insert(thresholds,threshold)
                end
            end
        end
    end
    table.sort(thresholds)
    local result: {ChanceBand} = {}
    for _, threshold in thresholds do
        local chance = styleChanceAt(character,style,tier,threshold)
        if chance > 0 then result[#result+1]={minBaseBet=threshold,chance=chance} end
    end
    return result
end

local function chooseAwardClip(api: EngineApi,target: Target,baseBet: number): (Clip,boolean,number)
    local character = CHARACTERS[target.characterId]
    local eligible = eligibleWeight(character,target.tier,baseBet) > 0 and character.specialChance > 0
    local styleId = "classic"
    local roll = -1
    if eligible then
        styleRolls += 1
        roll = api.random.nextFloat()
        local cumulative = 0
        for _, style in character.styles do
            if style.id ~= "classic" then
                cumulative += styleChanceAt(character,style,target.tier,baseBet)
                if roll < cumulative then
                    styleId = style.id
                    specialWins += 1
                    if styleId == "christmas" then christmasWins += 1 end
                    break
                end
            end
        end
    end
    return clipFor(target.characterId,styleId,target.tier),eligible,roll
end

local function unlockClip(clip: Clip)
    if clip.available and not unlockedClips[clip.clipId] then
        unlockedClips[clip.clipId] = true
        galleryCache = nil
    end
end

local function markLargeClipWatched(clip: Clip)
    if clip.available and clip.prizeTier == "large" and unlockedClips[clip.clipId] == true
        and not largePlayback.watched[clip.clipId] then
        largePlayback.watched[clip.clipId] = true
        galleryCache = nil
    end
end

local function updateGalleryLargePlayback(api: EngineApi)
    if not galleryOpen or api.input.wasPressed("GalleryLargeCancelled") then
        largePlayback.replayClipId = ""
        largePlayback.replayStartedAt = 0
    end
    if not galleryOpen then return end
    -- A replay can only report completion for the exact unlocked large clip
    -- that actually started. Switching away or closing cancels that interval.
    for _, clipId in CLIP_ORDER do
        local clip = CLIPS[clipId]
        if clip.available and clip.prizeTier == "large" and unlockedClips[clipId] == true
            and api.input.wasPressed("GalleryLargeStarted:"..clipId) then
            largePlayback.replayClipId = clipId
            largePlayback.replayStartedAt = time
        end
    end
    for _, clipId in CLIP_ORDER do
        local completed = api.input.wasPressed("GalleryLargeCompleted:"..clipId)
        if (completed or api.input.wasPressed("GalleryLargeEnded:"..clipId)) and largePlayback.replayClipId == clipId then
            local clip = CLIPS[clipId]
            -- Completed is a verified media-clock event (full played coverage,
            -- no seek/error). A busy browser can advance media faster than its
            -- fixed simulation clock, so do not reject that evidence on dt.
            if completed or time-largePlayback.replayStartedAt >= clip.duration-0.15 then markLargeClipWatched(clip) end
            largePlayback.replayClipId = ""
            largePlayback.replayStartedAt = 0
        end
    end
end

local function stopCardViewerParticles(api: EngineApi)
    for _, effect in cardViewer.effects do api.particle.stop(effect.handle) end
    cardViewer.effects = {}
    cardViewer.nextAt = time
end

local function syncCardShaderUniforms(api: EngineApi)
    for _, materialId in {"card_foil","card_diamond"} do
        api.shader.setUniform(materialId,"strength",1)
        api.shader.setUniform(materialId,"motion",if cardViewer.reducedMotion then 0 else 1)
    end
end

local function updateCardViewerParticles(api: EngineApi)
    if not cardViewer.open or cardViewer.reducedMotion or viewportBlocked then
        if #cardViewer.effects > 0 then stopCardViewerParticles(api) end
        return
    end
    for index = #cardViewer.effects, 1, -1 do
        local effect = cardViewer.effects[index]
        if time >= effect.expiresAt then
            api.particle.stop(effect.handle)
            table.remove(cardViewer.effects,index)
        end
    end
    if time >= cardViewer.nextAt then
        cardViewer.sequence += 1
        -- The official emitter has 18 slow particles, a five-second life, and
        -- at most two overlapping waves. Its fixed seed never uses award RNG.
        local handle = api.particle.play("card_ambience",{x=0,y=0,z=0},8100+cardViewer.sequence)
        table.insert(cardViewer.effects,{handle=handle,expiresAt=time+5.2})
        cardViewer.nextAt = time+3
    end
end

local function unlockHint(clip: Clip): string
    if not clip.available then return "目前尚未提供這支影片。" end
    local character = CHARACTERS[clip.characterId]
    local size = if clip.prizeTier == "small" then "小型" elseif clip.prizeTier == "medium" then "中型" else "大型"
    if clip.styleId ~= "classic" then
        local style = styleFor(clip.characterId,clip.styleId)
        local gate = if style.minBaseBet > 0 then "以底注至少"..tostring(style.minBaseBet) else ""
        local bands = chanceBands(character,style,clip.prizeTier)
        local parts: {string} = {}
        for index, band in bands do
            local nextBand = bands[index+1]
            local threshold = band.minBaseBet
            local chance = math.floor(band.chance*10000+0.5)/100
            local range = if nextBand ~= nil then tostring(threshold).."～"..tostring(nextBand.minBaseBet-1) else tostring(threshold).."以上"
            parts[#parts+1] = "底注"..range.."時"..tostring(chance).."%"
        end
        return gate.."捕獲"..character.name.."的"..size.."symbol並中獎；"..table.concat(parts,"，").."機會開出"..style.labelPrefix.."演出。整輪投入倍數不等於底注；須實際贏到此片才解鎖。"
    end
    local hasSpecial = false
    for _, style in character.styles do
        if styleWeight(character,style,clip.prizeTier) > 0 then hasSpecial = true; break end
    end
    if hasSpecial then
        return "捕獲"..character.name.."的"..size.."symbol並中獎，開出這支經典演出後解鎖；其他風格不會同時解鎖此片。"
    end
    return "捕獲"..character.name.."的"..size.."symbol並中獎後解鎖這支影片；預覽不會解鎖。"
end

local function buildGallery(): ObservationValue
    local characters: {ObservationValue} = {}
    for _, characterId in CHARACTER_ORDER do
        local character = CHARACTERS[characterId]
        local styles: {ObservationValue} = {}
        for _, style in character.styles do
            local styleId = style.id
            local items: {ObservationValue} = {}
            for _, clipId in CLIP_ORDER do
                local clip = CLIPS[clipId]
                if clip.available and clip.characterId == characterId and clip.styleId == styleId then
                    local tier = clip.prizeTier
                    items[#items+1] = {
                        clipId=clip.clipId,prizeTier=tier,label=clip.label,posterAsset=clip.posterAsset,
                        replayAsset=clip.replayAsset,videoAsset=clip.videoAsset,duration=clip.duration,
                        aspectRatio=clipAspectRatio(clip),available=true,
                        unlocked=unlockedClips[clip.clipId] == true,unlockHint=unlockHint(clip),
                        watched=largePlayback.watched[clip.clipId] == true,
                        minBaseBet=style.minBaseBet,styleChance=styleChanceAt(character,style,tier,style.minBaseBet),
                        chanceBands=chanceBands(character,style,tier),
                    }
                end
            end
            if #items > 0 then
                styles[#styles+1] = {id=styleId,title=style.title,minBaseBet=style.minBaseBet,specialChanceTotal=character.specialChance,items=items}
            end
        end
        characters[#characters+1] = {
            id=characterId,name=character.name,portraitAsset=character.portraitAsset,
            profileTitle=character.profileTitle,profileText=character.profileText,
            styles=styles,
        }
    end
    return {defaultCharacterId=DEFAULT_CHARACTER_ID,characters=characters}
end

local function findTarget(id: string): Target?
    for _, target in targets do
        if target.id == id then
            return target
        end
    end
    return nil
end

local function available(target: Target): boolean
    return target.state == "swimming" and target.x > -8.1 and target.x < 7.1
end

local function createTarget(api: EngineApi, tier: string, initial: boolean): Target
    spawnCharacterSequence += 1
    local characterId = SPAWN_CHARACTER_ORDER[(spawnCharacterSequence-1)%#SPAWN_CHARACTER_ORDER+1]
    local direction = if api.random.nextInt(0, 1) == 0 then -1 else 1
    local x = if initial then randomRange(api, -7.9, 7.0) else -direction * 9.4
    local lane = randomRange(api, -2.65, 2.85)
    local target: Target = {
        id=api.entity.spawn("girl-" .. tier .. "-" .. tostring(nextSequence())),
        tier=tier,characterId=characterId, x=x, y=lane, lane=lane, diameter=DIAMETERS[tier],
        speed=randomRange(api, 0.30, 0.65), direction=direction,
        phase=randomRange(api, 0, math.pi * 2),
        state="swimming", winUntil=0, hitUntil=0,
    }
    api.entity.setPosition(target.id, {x=target.x, y=target.y})
    return target
end

local function targetAt(position: Vec2): Target?
    local closest: Target? = nil
    local best = math.huge
    local bestOdds = -1
    for _, target in targets do
        if available(target) then
            local dx = target.x - position.x
            local dy = target.y - position.y
            local distance = dx * dx + dy * dy
            local odds = MAX_MULTIPLIER[target.tier]
            if distance <= (target.diameter * 0.56) ^ 2 and (odds > bestOdds or (odds == bestOdds and distance < best)) then
                closest = target
                best = distance
                bestOdds = odds
            end
        end
    end
    return closest
end

local function bestTarget(): Target?
    local sameTier: Target? = nil
    local sameDistance = math.huge
    local best: Target? = nil
    local bestOdds = -1
    local bestDistance = math.huge
    for _, target in targets do
        if available(target) then
            local distance = (target.x-lastTargetPosition.x)^2+(target.y-lastTargetPosition.y)^2
            local odds = MAX_MULTIPLIER[target.tier]
            if target.tier == lastTargetTier and distance < sameDistance then
                sameTier = target
                sameDistance = distance
            end
            if odds > bestOdds or (odds == bestOdds and distance < bestDistance) then
                best = target
                bestOdds = odds
                bestDistance = distance
            end
        end
    end
    return sameTier or best
end

local function currentLock(): Target?
    local target = findTarget(lockedTargetId)
    if target ~= nil and available(target) then
        lastTargetTier = target.tier
        lastTargetPosition = {x=target.x,y=target.y}
        return target
    end
    lockedTargetId = ""
    return nil
end

local function selectPrimary(target: Target)
    lockedTargetId = target.id
    lastTargetTier = target.tier
    lastTargetPosition = {x=target.x,y=target.y}
end

local function setAim(position: Vec2)
    local dx = position.x-CANNON.x
    local dy = math.max(0,position.y-CANNON.y)
    local length = math.sqrt(dx*dx+dy*dy)
    if length < 0.00001 then return end
    aimPoint = {x=position.x,y=math.max(position.y,CANNON.y)}
    aimDirection = {x=dx/length,y=dy/length}
end

local beginReward: (Reveal?) -> ()

local function startNextReveal()
    if reveal ~= nil then return end
    if #revealQueue > 0 then
        -- Stop new betting once a large is queued. Existing medium clips and
        -- their collection finish first; unstarted medium clips wait safely.
        if #mediumReveals > 0 or #rewardFx > 0 or #rewardQueue > 0 then return end
        local nextReveal = table.remove(revealQueue, 1)
        if nextReveal == nil then return end
        reveal = nextReveal
        if largePlayback.skipSeen and not nextReveal.preview and largePlayback.watched[nextReveal.clip.clipId] == true then
            nextReveal.skippedSeenVideo = true
            beginReward(nextReveal)
            return
        end
        nextReveal.stage = "intro"
        nextReveal.stageDuration = 1.2
        nextReveal.stageStartedAt = time
        nextReveal.expiresAt = time + nextReveal.stageDuration
        return
    end
    local occupied: {[number]: boolean} = {}
    for _, current in mediumReveals do
        if current.stage == "video" then occupied[current.slot] = true end
    end
    for slot = 1, MAX_MEDIUM_VIDEOS do
        if #mediumQueue == 0 then break end
        if not occupied[slot] then
            local current = table.remove(mediumQueue,1)
            if current ~= nil then
                current.slot = slot
                current.origin = {x=MEDIUM_ANCHORS[slot].x,y=MEDIUM_ANCHORS[slot].y}
                current.stage = "video"
                current.stageStartedAt = time
                current.stageDuration = 5.8
                current.expiresAt = time+5.8
                table.insert(mediumReveals,current)
            end
        end
    end
end

local function findRevealOwner(serial: number): Reveal?
    if reveal ~= nil and reveal.serial == serial then return reveal end
    for _, current in mediumReveals do
        if current.serial == serial then return current end
    end
    return nil
end

local function mediumPreviewCount(): number
    local count = 0
    for _, current in mediumReveals do if current.preview then count += 1 end end
    for _, current in mediumQueue do if current.preview then count += 1 end end
    return count
end

local function rewardLevel(tier: string, multiplier: number): string
    -- Per-symbol-range thirds are provisional visual levels, not official awards.
    local low = MIN_MULTIPLIER[tier]
    local high = MAX_MULTIPLIER[tier]
    local fraction = (multiplier-low) / math.max(1, high-low)
    if fraction < 1/3 then return "small" end
    if fraction < 2/3 then return "medium" end
    return "large"
end

local function queueReward(symbolTier: string, rewardTier: string, amount: number, preview: boolean, origin: Vec2, delay: number, owner: number, clip: Clip?, baseBet: number?): number
    fxSequence += 1
    local job: RewardJob = {
        id=fxSequence, symbolTier=symbolTier, rewardTier=rewardTier, amount=amount,
        preview=preview, origin={x=origin.x,y=origin.y}, readyAt=time+delay, revealSerial=owner,
        clip=clip or clipFor(DEFAULT_CHARACTER_ID,"classic",symbolTier),baseBet=baseBet or 0,
    }
    -- FIFO prevents ongoing independent medium wins from starving older money.
    table.insert(rewardQueue,job)
    return job.id
end

local function smallPreviewBusy(): boolean
    for _, job in rewardQueue do
        if job.preview and job.symbolTier == "small" then return true end
    end
    for _, fx in rewardFx do
        if fx.preview and fx.symbolTier == "small" then return true end
    end
    return false
end

beginReward = function(owner: Reveal?)
    local current = owner or reveal
    if current == nil or current.stage == "reward" then return end
    current.stage = "reward"
    current.stageStartedAt = time
    current.stageDuration = FX_DURATION
    current.expiresAt = time + FX_DURATION
    current.rewardWaiting = true
    current.rewardCompleted = false
    current.fxId = queueReward(current.symbolTier, current.rewardTier, current.amount, current.preview, current.origin, 0, current.serial,current.clip,current.baseBet)
end

local function enqueueReveal(tier: string, rewardTier: string, amount: number, preview: boolean, clip: Clip?, baseBet: number?, eligible: boolean?, roll: number?): boolean
    if tier == "medium" and preview and mediumPreviewCount() >= MAX_MEDIUM_PREVIEWS then return false end
    revealSerial += 1
    local selectedClip = clip or clipFor(DEFAULT_CHARACTER_ID,"classic",tier)
    local current: Reveal = {
        serial=revealSerial, tier=tier,
        symbolTier=tier, rewardTier=rewardTier,
        assetKey=if tier == "large" then "largeReveal" else "mediumReveal",
        amount=amount, preview=preview, expiresAt=0,
        stage="queued", stageStartedAt=0, stageDuration=0,
        videoDuration=selectedClip.duration,
        videoStarted=false,videoStartedAt=0,skippedSeenVideo=false,
        rewardWaiting=false, rewardCompleted=false, fxId=0,
        slot=0,origin={x=0,y=0.45},
        clip=selectedClip,baseBet=baseBet or 0,christmasEligible=eligible == true and CHARACTERS[selectedClip.characterId].christmasEnabled,
        styleEligible=eligible == true,
        eligibleStyleIds=eligibleStyleIds(CHARACTERS[selectedClip.characterId],tier,baseBet or 0),
        styleRollApplied=eligible == true,styleRoll=if roll ~= nil then roll else -1,
    }
    if tier == "medium" then table.insert(mediumQueue,current)
    else table.insert(revealQueue,current) end
    startNextReveal()
    return true
end

local function advanceMediumReveals(api: EngineApi)
    for index = #mediumReveals, 1, -1 do
        local current = mediumReveals[index]
        local suffix = ":"..tostring(current.serial)
        if current.stage == "video" then
            if api.input.wasPressed("MediumVideoStarted"..suffix) and not current.videoStarted then
                current.videoStarted = true
                current.videoStartedAt = time
                current.expiresAt = time+5.8
            end
            local videoBase = if current.videoStarted then current.videoStartedAt else current.stageStartedAt
            local ended = api.input.wasPressed("MediumRevealDone"..suffix) and time-videoBase >= current.videoDuration-0.15
            if ended or api.input.wasPressed("CloseMediumReveal"..suffix) or time >= current.expiresAt then
                beginReward(current)
            end
        elseif current.stage == "reward" and not current.rewardWaiting and current.rewardCompleted and time >= current.expiresAt then
            -- A medium completes independently, never waiting on unrelated
            -- active clips, future clips, or a global pending-money balance.
            table.remove(mediumReveals,index)
        end
    end
end

local function advanceReveal(videoDone: boolean, skip: boolean, mediaCompleted: boolean)
    local current = reveal
    if current == nil then return end
    if current.stage == "intro" then
        if skip then
            beginReward()
        elseif time >= current.expiresAt then
            current.stage = "video"
            current.stageStartedAt = time
            current.stageDuration = 9
            current.expiresAt = time + 9
        end
    elseif current.stage == "video" then
        -- The close action explicitly skips the movie, but still runs the reward.
        -- Ignore early ended events from a previous media element.
        local videoBase = if current.videoStarted then current.videoStartedAt else current.stageStartedAt
        local ended = mediaCompleted or (videoDone and time-videoBase >= current.videoDuration-0.15)
        if ended and not skip and current.videoStarted and not current.preview and (mediaCompleted or time < current.expiresAt) then
            markLargeClipWatched(current.clip)
        end
        if skip or ended or time >= current.expiresAt then beginReward() end
    elseif current.stage == "reward" and not current.rewardWaiting and current.rewardCompleted
        and time >= current.expiresAt and #rewardFx == 0 and #rewardQueue == 0 then
        reveal = nil
        startNextReveal()
    end
end

local function flightTiming(index: number, count: number): (number, number)
    local flyAt = 0.52 + (index-1)/math.max(1,count-1) * 0.22
    local duration = 0.62 + (index % 4) * 0.02
    return flyAt, duration
end

local function updateRewardFx(api: EngineApi, dt: number)
    walletPulse = math.max(0, walletPulse-dt*3.5)
    walletIncrementThisTick = 0
    for index = #rewardFx, 1, -1 do
        local fx = rewardFx[index]
        fx.age += dt
        local arrived = 0
        for particle = 1, fx.count do
            local flyAt, duration = flightTiming(particle, fx.count)
            if fx.age >= flyAt+duration then arrived += 1 end
        end
        if arrived > fx.arrivedCount then
            walletArrivalsSerial += arrived-fx.arrivedCount
            fx.arrivedCount = arrived
            walletPulse = 1
        end
        -- Resolve confirmed the award exactly once. Arrival only moves confirmed
        -- pending points into the displayed, spendable wallet in integer batches.
        local collectible = if arrived >= fx.count then fx.amount else math.floor(fx.amount*arrived/fx.count)
        local increment = collectible-fx.collectedAmount
        if increment > 0 then
            fx.collectedAmount = collectible
            pendingWin -= increment
            displayBalance += increment
            collectedWin += increment
            walletIncrementThisTick += increment
        end
        if fx.age >= fx.duration and fx.arrivedCount == fx.count and fx.collectedAmount == fx.amount then
            local current = reveal
            if current ~= nil and current.fxId == fx.id then current.rewardCompleted = true end
            for _, medium in mediumReveals do
                if medium.fxId == fx.id then medium.rewardCompleted = true end
            end
            table.remove(rewardFx, index)
        end
    end
    if walletIncrementThisTick > 0 then
        walletLastIncrement = walletIncrementThisTick
        walletLastIncrementAt = time
        walletLastIncrementSerial += 1
    end
    local fullScreenMovie = reveal ~= nil and reveal.tier == "large" and reveal.stage ~= "reward"
    if fullScreenMovie then return end
    local index = 1
    while index <= #rewardQueue and #rewardFx < MAX_FX_GROUPS do
        local job = rewardQueue[index]
        if time < job.readyAt then
            index += 1
        else
            table.remove(rewardQueue, index)
            local handle = api.particle.play("love_burst_" .. job.rewardTier, {x=job.origin.x,y=job.origin.y,z=0}, job.id)
            table.insert(rewardFx, {
                id=job.id, symbolTier=job.symbolTier, rewardTier=job.rewardTier,
                amount=job.amount, count=HEART_COUNTS[job.rewardTier], preview=job.preview,
                origin=job.origin, age=0, duration=FX_DURATION, arrivedCount=0, collectedAmount=0, handle=handle,
                clip=job.clip,baseBet=job.baseBet,
            })
            local current = findRevealOwner(job.revealSerial)
            if current ~= nil and current.serial == job.revealSerial and current.fxId == job.id then
                current.rewardWaiting = false
                current.stageStartedAt = time
                current.expiresAt = time + FX_DURATION
            end
        end
    end
end

local function observeHearts(): {ObservationValue}
    local hearts: {ObservationValue} = {}
    for _, fx in rewardFx do
        local radius = if fx.rewardTier == "large" then 2.0 elseif fx.rewardTier == "medium" then 1.45 else 0.95
        for index = 1, fx.count do
            -- Pure visual formulas never consume the game's outcome random stream.
            local variation = (index*0.618033989 + fx.id*0.173) % 1
            local angle = index*2.39996323 + fx.id*0.37
            local reach = radius*(0.5+variation*0.5)
            local endX = fx.origin.x + math.cos(angle)*reach
            local endY = fx.origin.y + math.sin(angle)*reach*0.7 + 0.25
            local flyAt, duration = flightTiming(index, fx.count)
            local progress = math.clamp((fx.age-flyAt)/duration,0,1)
            if progress < 1 then
                local x = endX
                local y = endY
                local phase = "burst"
                local scale = (0.6+variation*0.65)*math.clamp(fx.age/0.13,0,1)
                local opacity = math.clamp(fx.age/0.07,0,1)
                if fx.age < flyAt then
                    local t = math.clamp(fx.age/0.52,0,1)
                    local ease = 1-(1-t)^3
                    x = fx.origin.x+(endX-fx.origin.x)*ease
                    y = fx.origin.y+(endY-fx.origin.y)*ease+math.sin(t*math.pi)*0.18
                else
                    phase = "collect"
                    local t = progress*progress*(3-2*progress)
                    local controlX = (endX+WALLET.x)/2+math.cos(angle)*0.6
                    local controlY = math.max(endY,WALLET.y)+1.0+variation*0.9
                    x = (1-t)^2*endX+2*(1-t)*t*controlX+t*t*WALLET.x
                    y = (1-t)^2*endY+2*(1-t)*t*controlY+t*t*WALLET.y
                    scale *= 0.78-0.2*t
                    opacity = math.clamp((1-progress)/0.08,0,1)
                end
                hearts[#hearts+1] = {
                    id=tostring(fx.id)..":"..tostring(index), x=x,y=y,
                    scale=scale, opacity=opacity, rotation=angle*180/math.pi+fx.age*90,
                    phase=phase, tier=fx.rewardTier, preview=fx.preview,
                    characterId=fx.clip.characterId,styleId=fx.clip.styleId,clipId=fx.clip.clipId,
                }
            end
        end
    end
    return hearts
end

local function addFloating(target: Target, amount: number)
    table.insert(floating, {
        id=nextSequence(), x=target.x, y=target.y, amount=amount,
        text=if amount > 0 then "+" .. tostring(amount) else "HIT",
        tier=target.tier, age=0, duration=if amount > 0 then 1.35 else 0.48,
    })
end

local function selectTargets(api: EngineApi, primary: Target, firedWeapon: string): ({string}, number, number)
    local selected = {primary.id}
    local radius = if firedWeapon == "flower" then FLOWER_RADIUS else ROCKET_RADIUS
    local quota = if firedWeapon == "flower" then api.random.nextInt(2, 5) else 4
    if firedWeapon == "like" then return selected, 0, 0 end
    local candidates: {Target} = {}
    for _, target in targets do
        local dx = target.x - primary.x
        local dy = target.y - primary.y
        if target.id ~= primary.id and available(target) and dx * dx + dy * dy <= radius * radius then
            table.insert(candidates, target)
        end
    end
    -- Remove each random choice: no duplicated target and no out-of-circle filler.
    for _ = 1, math.min(quota, #candidates) do
        local candidate = table.remove(candidates, api.random.nextInt(1, #candidates))
        if candidate ~= nil then table.insert(selected, candidate.id) end
    end
    return selected, quota, radius
end

local function recordSelection(attack: Attack, primary: Target?, selected: {string}, quota: number, radius: number)
    if attack.id ~= lastRoundAttackId then return end
    local ids: {ObservationValue} = {}
    local selection: {ObservationValue} = {}
    for _, id in selected do
        table.insert(ids,id)
        local target = findTarget(id)
        if target ~= nil then selection[#selection+1] = {id=id,x=target.x,y=target.y} end
    end
    lastRound.targetIds = ids
    lastRound.selection = selection
    lastRound.secondaryQuota = quota
    lastRound.searchRadius = radius
    if primary ~= nil then
        lastRound.primaryId = primary.id
        lastRound.primaryX = primary.x
        lastRound.primaryY = primary.y
    end
end

local function shoot(api: EngineApi, primary: Target?)
    if viewportBlocked or viewportNeedsFreshInput or cooldown > 0 or reveal ~= nil or #revealQueue > 0 or galleryOpen then return end
    local firedWeapon = weapon
    local tracking = firedWeapon == "like" and lock
    if (tracking or firedWeapon ~= "like") and (primary == nil or not available(primary)) then return end
    local bet = BETS[betIndex]
    local cost = bet * COSTS[firedWeapon]
    if displayBalance < cost then
        -- Funds can be temporarily pending in collecting hearts. Keep the
        -- player's AUTO intent and resume only after the wallet can pay again.
        message = "虛擬點數不足；等待收心，或降低底注"
        return
    end
    local selected: {string} = {}
    local quota = 0
    local radius = 0
    if primary ~= nil then
        selected = {primary.id}
        if firedWeapon == "rocket" then selected,quota,radius = selectTargets(api,primary,firedWeapon) end
    end
    balance -= cost
    displayBalance -= cost
    spent += cost
    cardSystem.spend(cost)
    rounds += 1
    lastCost = cost
    lastWin = 0
    -- Carry only the current continuous firing run's sub-frame remainder.
    -- The previous shot's remaining cooldown survives weapon changes, while
    -- idle/blocked runs restart from their first real shot without catch-up.
    cooldownDuration = ROUND_INTERVALS[firedWeapon]
    cooldown = math.max(0,cooldownDuration+(if cadenceContinuous then math.min(0,cooldown) else 0))
    local attackId = nextSequence()
    local projectileTargets: {string} = if firedWeapon == "rocket" then selected else {if primary ~= nil then primary.id else ""}
    local attack: Attack = {
        id=attackId, roundId=rounds, weapon=firedWeapon, targetIds=selected, hitTargetIds={},
        bet=bet, cost=cost, age=0, duration=0, pendingShots=#projectileTargets,
    }
    table.insert(attacks,attack)
    for index, targetId in projectileTargets do
        local target = findTarget(targetId)
        local destination: Vec2 = if target ~= nil then {x=target.x,y=target.y} else {x=aimPoint.x,y=aimPoint.y}
        local distance = math.sqrt((destination.x-CANNON.x)^2+(destination.y-CANNON.y)^2)
        local trajectory = if firedWeapon == "flower" then "arc" elseif firedWeapon == "rocket" then "snapshot" elseif tracking then "track" else "straight"
        local duration = if trajectory == "straight" then SHOT_LIFETIME
            elseif trajectory == "track" then math.clamp(distance/TRACK_SPEED,0.1,2)
            elseif trajectory == "arc" then math.max(distance/FLOWER_SPEED,0.1)
            else math.max(distance/ROCKET_SPEED,0.05)
        local dx = if trajectory == "straight" then aimDirection.x else (destination.x-CANNON.x)/math.max(distance,0.0001)
        local dy = if trajectory == "straight" then aimDirection.y else (destination.y-CANNON.y)/math.max(distance,0.0001)
        local arcHeight = math.clamp(distance*0.23,0.55,1.8)
        local speed = if trajectory == "straight" then NORMAL_SPEED else distance/duration
        local initialVX = dx*speed
        local initialVY = dy*speed+(if trajectory == "arc" then 4*arcHeight/duration else 0)
        attack.duration = math.max(attack.duration,duration)
        table.insert(shots, {
            id=nextSequence(), attackId=attackId, roundId=rounds, weapon=firedWeapon, bet=bet, cost=cost,
            targetId=targetId, targetIds=selected, from={x=CANNON.x,y=CANNON.y}, to=destination,
            x=CANNON.x,y=CANNON.y,vx=initialVX,vy=initialVY,
            rotation=math.atan2(initialVY,initialVX), trajectory=trajectory, collisionCount=0,
            arcHeight=arcHeight, age=0,duration=duration,
        })
    end
    lastRoundAttackId = attackId
    lastRound = {
        serial=rounds, attackId=attackId, weapon=firedWeapon, bet=bet, cost=cost,
        firedAt=time,
        targetIds={}, selection={}, status="flying", primaryId="", primaryX=aimPoint.x,primaryY=aimPoint.y,
        secondaryQuota=quota,searchRadius=radius,
    }
    recordSelection(attack,primary,selected,quota,radius)
    message = "本輪 " .. tostring(cost) .. " 點｜" .. (if firedWeapon == "like" and not tracking then "方向射擊" else tostring(#selected).." 個目標")
end

local function resolveAttack(api: EngineApi, attack: Attack)
    local roundWin = 0
    for _, targetId in attack.hitTargetIds do
        local target = findTarget(targetId)
        if target ~= nil and target.state == "swimming" then
            target.hitUntil = time + 0.22
            if api.random.nextFloat() < ODDS[target.tier] then
                local multiplier = api.random.nextInt(MIN_MULTIPLIER[target.tier], MAX_MULTIPLIER[target.tier])
                local award = attack.bet * multiplier * (if attack.weapon == "rocket" then 3 else 1)
                local selectedClip,eligible,roll = chooseAwardClip(api,target,attack.bet)
                -- Confirm once now; the displayed/spendable wallet receives
                -- these pending points only as this award's hearts arrive.
                balance += award
                pendingWin += award
                won += award
                roundWin += award
                captures += 1
                unlockClip(selectedClip)
                target.state = "caught"
                target.winUntil = time + 0.65
                addFloating(target, award)
                if lockedTargetId == target.id then lockedTargetId = "" end
                if target.tier == "medium" then
                    unlockedMedium = true
                    enqueueReveal("medium", rewardLevel(target.tier, multiplier), award, false,selectedClip,attack.bet,eligible,roll)
                elseif target.tier == "large" then
                    unlockedLarge = true
                    enqueueReveal("large", rewardLevel(target.tier, multiplier), award, false,selectedClip,attack.bet,eligible,roll)
                else
                    queueReward("small", rewardLevel(target.tier, multiplier), award, false, {x=target.x,y=target.y}, 0.65, 0,selectedClip,attack.bet)
                end
            else
                addFloating(target, 0)
            end
        end
    end
    lastWin = roundWin
    if roundWin > 0 then message = "本輪獲得 " .. tostring(roundWin) .. " 虛擬點數" end
end

local function findAttack(id: number): Attack?
    for _, attack in attacks do if attack.id == id then return attack end end
    return nil
end

local function finishShot(shot: Shot, hitIds: {string})
    local attack = findAttack(shot.attackId)
    if attack == nil then return end
    for _, id in hitIds do
        if table.find(attack.hitTargetIds,id) == nil then table.insert(attack.hitTargetIds,id) end
    end
    attack.pendingShots -= 1
end

local function circleIntersection(x: number,y: number,dx: number,dy: number,target: Target): number?
    local ox = x-target.x
    local oy = y-target.y
    local radius = target.diameter*0.5+SHOT_RADIUS
    local c = ox*ox+oy*oy-radius*radius
    if c <= 0 then return 0 end
    local a = dx*dx+dy*dy
    if a < 0.000000001 then return nil end
    local b = 2*(ox*dx+oy*dy)
    local discriminant = b*b-4*a*c
    if discriminant < 0 then return nil end
    local t = (-b-math.sqrt(discriminant))/(2*a)
    if t >= 0 and t <= 1 then return t end
    return nil
end

local function updateStraight(shot: Shot,dt: number): boolean
    local remaining = dt
    local elapsed = 0
    for _ = 1, 8 do
        if remaining <= 0.00000001 then break end
        local dx = shot.vx*remaining
        local dy = shot.vy*remaining
        local wallTX = math.huge
        local wallTY = math.huge
        if dx > 0 then wallTX = (WALL_X-shot.x)/dx
        elseif dx < 0 then wallTX = (-WALL_X-shot.x)/dx end
        if dy > 0 then wallTY = (WALL_Y-shot.y)/dy
        elseif dy < 0 then wallTY = (-WALL_Y-shot.y)/dy end
        local wallT = math.min(wallTX,wallTY)
        local hit: Target? = nil
        local hitT = math.huge
        for _, target in targets do
            if target.state == "swimming" and math.abs(target.x) < WALL_X+target.diameter*0.5 then
                local t = circleIntersection(shot.x,shot.y,dx,dy,target)
                if t ~= nil and t < hitT then hit=target; hitT=t end
            end
        end
        if hit ~= nil and hitT <= wallT then
            shot.x += dx*hitT
            shot.y += dy*hitT
            local attack = findAttack(shot.attackId)
            if attack ~= nil then recordSelection(attack,hit,{hit.id},0,0) end
            finishShot(shot,{hit.id})
            return true
        elseif wallT >= 0 and wallT <= 1 then
            shot.x += dx*wallT
            shot.y += dy*wallT
            elapsed += remaining*wallT
            remaining *= 1-wallT
            shot.collisionCount += 1
            if shot.collisionCount >= 3 and shot.age-dt+elapsed >= 0.5 then
                finishShot(shot,{})
                return true
            end
            if math.abs(wallTX-wallT) < 0.000001 then shot.vx = -shot.vx end
            if math.abs(wallTY-wallT) < 0.000001 then shot.vy = -shot.vy end
            shot.rotation = math.atan2(shot.vy,shot.vx)
            shot.x = math.clamp(shot.x,-WALL_X+0.00001,WALL_X-0.00001)
            shot.y = math.clamp(shot.y,-WALL_Y+0.00001,WALL_Y-0.00001)
        else
            shot.x += dx
            shot.y += dy
            break
        end
    end
    return false
end

local function updateShot(api: EngineApi,shot: Shot,dt: number): boolean
    shot.age += dt
    if shot.age >= SHOT_LIFETIME then finishShot(shot,{}); return true end
    if shot.trajectory == "straight" then return updateStraight(shot,dt) end
    local target = findTarget(shot.targetId)
    if target == nil or target.state ~= "swimming" then finishShot(shot,{}); return true end
    if shot.trajectory ~= "snapshot" then shot.to = {x=target.x,y=target.y} end
    local progress = math.clamp(shot.age/shot.duration,0,1)
    local previousX = shot.x
    local previousY = shot.y
    shot.x = shot.from.x+(shot.to.x-shot.from.x)*progress
    shot.y = shot.from.y+(shot.to.y-shot.from.y)*progress
    if shot.trajectory == "arc" then shot.y += 4*progress*(1-progress)*shot.arcHeight end
    shot.vx = (shot.x-previousX)/math.max(dt,0.000001)
    shot.vy = (shot.y-previousY)/math.max(dt,0.000001)
    shot.rotation = math.atan2(shot.vy,shot.vx)
    if progress >= 1 then
        local hits = {target.id}
        local attack = findAttack(shot.attackId)
        if shot.trajectory == "arc" and attack ~= nil then
            local quota: number
            local radius: number
            hits,quota,radius = selectTargets(api,target,attack.weapon)
            recordSelection(attack,target,hits,quota,radius)
        end
        finishShot(shot,hits)
        return true
    end
    return false
end

local function reset(api: EngineApi)
    stopCardViewerParticles(api)
    cardViewer.open = false
    cardViewer.sequence = 0
    syncCardShaderUniforms(api)
    cardSystem.reset()
    for _, target in targets do api.entity.despawn(target.id) end
    for _, fx in rewardFx do api.particle.stop(fx.handle) end
    targets = {}
    attacks = {}
    shots = {}
    floating = {}
    revealQueue = {}
    reveal = nil
    mediumReveals = {}
    mediumQueue = {}
    rewardQueue = {}
    rewardFx = {}
    walletPulse = 0
    walletArrivalsSerial = 0
    walletLastIncrement = 0
    walletLastIncrementSerial = 0
    walletLastIncrementAt = time
    walletIncrementThisTick = 0
    balance = 10000
    displayBalance = 10000
    pendingWin = 0
    collectedWin = 0
    betIndex = 3
    weapon = "like"
    auto = false
    lock = false
    galleryOpen = false
    lockedTargetId = ""
    lastTargetTier = ""
    lastTargetPosition = {x=0,y=0}
    aimPoint = {x=0,y=3.6}
    aimDirection = {x=0,y=1}
    -- Reset may clear the game while the device is still portrait. It cannot
    -- turn an existing held pointer into a new post-rotation press.
    if viewportBlocked or viewportNeedsFreshInput then
        pointerWasDown = api.input.isPointerDown()
        previousPointer = api.input.getPointerPosition()
    else
        pointerWasDown = false
        previousPointer = {x=0,y=0}
    end
    gestureHasTarget = false
    cooldown = 0
    cooldownDuration = ROUND_INTERVALS.like
    cadenceContinuous = false
    spent = 0
    won = 0
    rounds = 0
    captures = 0
    lastCost = 0
    lastWin = 0
    lastRound = {}
    lastRoundAttackId = 0
    unlockedMedium = false
    unlockedLarge = false
    spawnCharacterSequence = 0
    unlockedClips = {}
    largePlayback.skipSeen = false
    largePlayback.watched = {}
    largePlayback.replayClipId = ""
    largePlayback.replayStartedAt = 0
    galleryCache = nil
    styleRolls = 0
    christmasWins = 0
    specialWins = 0
    message = "虛擬點數試玩｜點女孩射擊，或開啟 AUTO"
    for _ = 1, 18 do table.insert(targets, createTarget(api, "small", true)) end
    for _ = 1, 6 do table.insert(targets, createTarget(api, "medium", true)) end
    for _ = 1, 3 do table.insert(targets, createTarget(api, "large", true)) end
end

local function observeReveal(current: Reveal): ObservationValue
    return {
        serial=current.serial,tier=current.tier,assetKey=current.assetKey,
        symbolTier=current.symbolTier,rewardTier=current.rewardTier,
        amount=current.amount,preview=current.preview,stage=current.stage,
        stageStartedAt=current.stageStartedAt,stageDuration=current.stageDuration,
        stageProgress=if current.rewardWaiting then 0 else math.clamp((time-current.stageStartedAt)/current.stageDuration,0,1),
        videoDuration=current.videoDuration,videoStarted=current.videoStarted,videoStartedAt=current.videoStartedAt,
        skippedSeenVideo=current.skippedSeenVideo,
        expiresAt=current.expiresAt,fxId=current.fxId,rewardWaiting=current.rewardWaiting,
        rewardCompleted=current.rewardCompleted,slot=current.slot,origin={x=current.origin.x,y=current.origin.y},
        characterId=current.clip.characterId,styleId=current.clip.styleId,clipId=current.clip.clipId,
        videoAsset=current.clip.videoAsset,posterAsset=current.clip.posterAsset,replayAsset=current.clip.replayAsset,
        duration=current.clip.duration,aspectRatio=clipAspectRatio(current.clip),baseBet=current.baseBet,
        christmasEligible=current.christmasEligible,styleEligible=current.styleEligible,eligibleStyleIds=current.eligibleStyleIds,
        styleRollApplied=current.styleRollApplied,styleRoll=current.styleRoll,
    }
end

local function publish(api: EngineApi)
    if galleryCache == nil then galleryCache = buildGallery() end
    local watchedLargeClipIds: {ObservationValue} = {}
    for _, clipId in CLIP_ORDER do
        if largePlayback.watched[clipId] == true then table.insert(watchedLargeClipIds,clipId) end
    end
    -- Compact audit observation is useful to QA without serializing the board.
    api.observation.set("wallet", {
        balance=balance, bet=BETS[betIndex], weapon=weapon,
        rounds=rounds, spent=spent, won=won,
    })
    local visibleTargets: {ObservationValue} = {}
    for _, target in targets do
        local character = CHARACTERS[target.characterId]
        local fieldPrefix = character.fieldPrefix
        local scale = if target.state == "caught" then math.max(0.02, (target.winUntil - time) / 0.65) else 1
        visibleTargets[#visibleTargets+1] = {
            id=target.id, tier=target.tier, x=target.x, y=target.y, diameter=target.diameter,
            characterId=target.characterId,
            assetKey=(if fieldPrefix ~= "" then target.characterId.."-" else "")..target.tier.."Symbol",
            spriteAsset=if fieldPrefix ~= "" then fieldPrefix.."/field-"..target.tier..".webp" else "",
            spriteMetaAsset=if fieldPrefix ~= "" then fieldPrefix.."/field-sprites.json" else "spritesheet-128.json",
            posterAsset=if fieldPrefix ~= "" then fieldPrefix.."/field-"..target.tier.."-poster.webp" else (if target.tier == "large" then "portrait-large.webp" else "portrait-medium.webp"),
            state=target.state, phase=time + target.phase,
            scale=scale, winUntil=target.winUntil,
            hitFlash=math.clamp((target.hitUntil - time) / 0.22, 0, 1),
        }
    end
    local visibleShots: {ObservationValue} = {}
    for _, shot in shots do
        local ids: {ObservationValue} = {}
        for _, id in shot.targetIds do table.insert(ids, id) end
        visibleShots[#visibleShots+1] = {
            id=shot.id, weapon=shot.weapon, targetId=shot.targetId, targetIds=ids,
            roundId=shot.roundId,bet=shot.bet,cost=shot.cost,
            x=shot.x,y=shot.y,vx=shot.vx,vy=shot.vy,rotation=shot.rotation,
            trajectory=shot.trajectory,collisionCount=shot.collisionCount,
            from={x=shot.from.x,y=shot.from.y}, to={x=shot.to.x,y=shot.to.y},
            age=shot.age, duration=shot.duration, progress=math.clamp(shot.age/shot.duration, 0, 1),
        }
    end
    local visibleFloating: {ObservationValue} = {}
    for _, entry in floating do
        visibleFloating[#visibleFloating+1] = {
            id=entry.id, x=entry.x, y=entry.y, amount=entry.amount, text=entry.text,
            tier=entry.tier, age=entry.age, duration=entry.duration,
        }
    end
    local visibleReveal: ObservationValue = nil
    if reveal ~= nil then
        visibleReveal = observeReveal(reveal)
    end
    local visibleMedium: {ObservationValue} = {}
    local mediumVideoCount = 0
    for _, current in mediumReveals do
        visibleMedium[#visibleMedium+1] = observeReveal(current)
        if current.stage == "video" then mediumVideoCount += 1 end
    end
    local visibleFx: {ObservationValue} = {}
    for _, fx in rewardFx do
        visibleFx[#visibleFx+1] = {
            id=fx.id, symbolTier=fx.symbolTier, rewardTier=fx.rewardTier,
            count=fx.count, age=fx.age, duration=fx.duration, preview=fx.preview,
            amount=fx.amount, origin={x=fx.origin.x,y=fx.origin.y},
            arrivedCount=fx.arrivedCount, collectedAmount=fx.collectedAmount,
            phase="reward", progress=math.clamp(fx.age/fx.duration,0,1),
            characterId=fx.clip.characterId,styleId=fx.clip.styleId,clipId=fx.clip.clipId,baseBet=fx.baseBet,
            videoAsset=fx.clip.videoAsset,posterAsset=fx.clip.posterAsset,replayAsset=fx.clip.replayAsset,clipDuration=fx.clip.duration,
        }
    end
    api.observation.set("game", {
        phase=if reveal ~= nil then "reveal" else "playing", time=time,
        balance=balance, displayBalance=displayBalance, pendingWin=pendingWin, collectedWin=collectedWin,
        bet=BETS[betIndex], weapon=weapon, auto=auto, lock=lock,
        lockedTargetId=lockedTargetId, galleryOpen=galleryOpen,
        cardViewerOpen=cardViewer.open,cardViewerReducedMotion=cardViewer.reducedMotion,
        cardViewerParticleHandles=#cardViewer.effects,
        viewportBlocked=viewportBlocked,viewportNeedsFreshInput=viewportNeedsFreshInput,
        aim={x=aimPoint.x,y=aimPoint.y,dirX=aimDirection.x,dirY=aimDirection.y,angle=math.atan2(aimDirection.y,aimDirection.x)},
        canShoot=not viewportBlocked and not viewportNeedsFreshInput and cooldown <= 0 and reveal == nil and #revealQueue == 0 and not galleryOpen and displayBalance >= BETS[betIndex]*COSTS[weapon],
        cooldown=math.max(0,cooldown),cooldownDuration=cooldownDuration,
        cooldownProgress=math.clamp(cooldown/cooldownDuration,0,1),
        roundInterval=ROUND_INTERVALS[weapon],roundsPerSecond=1/ROUND_INTERVALS[weapon],
        targets=visibleTargets, shots=visibleShots, floating=visibleFloating,
        reveal=visibleReveal, revealQueueCount=#revealQueue,
        mediumReveals=visibleMedium,mediumQueueCount=#mediumQueue,mediumVideoCount=mediumVideoCount,
        mediumPreviewOutstanding=mediumPreviewCount(),largeQueueCount=#revealQueue,
        fxHearts=observeHearts(), rewardFx=visibleFx, rewardFxPendingCount=#rewardQueue,
        walletPulse=walletPulse, walletArrivalsSerial=walletArrivalsSerial,
        walletLastIncrement=walletLastIncrement, walletLastIncrementSerial=walletLastIncrementSerial,
        walletLastIncrementAge=time-walletLastIncrementAt, walletIncrementThisTick=walletIncrementThisTick,
        unlocked={medium=unlockedMedium, large=unlockedLarge}, message=message,
        gallery=galleryCache,cards=cardSystem.observe(spent,galleryOpen,viewportBlocked),
        preferences={skipSeenLargeVideos=largePlayback.skipSeen},watchedLargeClipIds=watchedLargeClipIds,
        variantStats={styleRolls=styleRolls,christmasWins=christmasWins,specialWins=specialWins},
        stats={shots=rounds, spent=spent, won=won, captures=captures, lastCost=lastCost, lastWin=lastWin},
        lastRound=lastRound,
        demoConfig={
            virtualOnly=true, initialBalance=10000, notApprovedMath=true, rtp="未設定；試玩機率與獎額不代表正式RTP",
            characterMapping="恩妃、藝瑟、恩智、むぎ與嘉儀混合；獨立五角色spawn roundrobin不消耗開獎RNG",
            christmasCharacterIds=CHRISTMAS_CHARACTER_IDS,christmasMinBaseBet=CHRISTMAS_MIN_BET,christmasChance=CHRISTMAS_CHANCE,
            christmasEligibility="支援聖誕的角色中/大型symbol中獎，該輪底注attack.bet至少50才抽；不看整輪×6/15成本，未合格不抽style RNG",
            specialStyleCharacterIds=SPECIAL_STYLE_CHARACTER_IDS,specialStyleChance=0.5,
            specialStylePolicy="角色成功捕獲後，依發射時底注篩選該獎項可用風格；合格特殊風格合計50%，在合格風格間等權抽選，其餘經典；不合格不抽style RNG",
            specialStyleThresholds={christmas=CHRISTMAS_MIN_BET,halloween=HALLOWEEN_STYLE.minBaseBet,summer=SUMMER_STYLE.minBaseBet},
            galleryUnlock="只收藏實際贏到的clipId，不跨角色/風格；preview與replay不解鎖、不派彩，重設試玩清空本session收藏",
            standardSmallDiameter=SMALL_DIAMETER, flowerRadius=FLOWER_RADIUS,
            flowerSecondaryMin=2, flowerSecondaryMax=5, rocketRadius=ROCKET_RADIUS,
            rocketSearchRangeConfirmed=false, rocketMaxTargets=5,
            likeCost=1, flowerCost=6, rocketCost=15,
            roundInterval=ROUND_INTERVALS[weapon],roundIntervals={like=ROUND_INTERVALS.like,flower=ROUND_INTERVALS.flower,rocket=ROUND_INTERVALS.rocket},
            smallWinChance=ODDS.small, mediumWinChance=ODDS.medium, largeWinChance=ODDS.large,
            smallPayout={min=2,max=6}, mediumPayout={min=8,max=18}, largePayout={min=25,max=60},
            rocketPayoutScale=3, selectionAt="花抵達主目標當下抽圈內副目標；火箭發射時抽不同目標並飛往快照位置",
            shootingReference="DT2：普通方向射擊/按住拖曳/AUTO沿最後方向，Lock追蹤，第三次碰牆回收與35秒TTL",
            dt2SpeedScale=DT2_SPEED_SCALE,normalSpeed=NORMAL_SPEED,trackSpeed=TRACK_SPEED,flowerSpeed=FLOWER_SPEED,rocketSpeed=ROCKET_SPEED,
            normalCollider="試玩簡化：連續線段對圓形symbol最早交點，半徑=視覺diameter/2+子彈.1；並非DT2原魚hitbox",
            shotRadius=SHOT_RADIUS,wallX=WALL_X,wallY=WALL_Y,maxWallContacts=3,wallGraceSeconds=0.5,shotLifetime=SHOT_LIFETIME,
            rewardLevels="僅試玩視覺分級：按各symbol倍率範圍低中高三等分；非正式獎級或RTP",
            rewardHearts={small=HEART_COUNTS.small,medium=HEART_COUNTS.medium,large=HEART_COUNTS.large}, rewardFxDuration=FX_DURATION,
            maxRewardFxGroups=MAX_FX_GROUPS, walletTarget={x=WALLET.x,y=WALLET.y},
            maxMediumVideos=MAX_MEDIUM_VIDEOS,maxMediumPreviewOutstanding=MAX_MEDIUM_PREVIEWS,
            mediumConcurrency="試玩效能配置：最多6支影片同播；自然中獎超量FIFO不丟獎，中階video/reward均不阻擋射擊",
            largeTransition="大階排隊即暫停新投注，等已啟動中階和收心完成；未啟動中階保留稍後播放",
            heartTrajectory="Luau確定性爆開後保持愛心形狀飛入左下點數區；不消耗開獎RNG",
            walletCollection="resolve只確認獎金；愛心抵達按比例整數搬移pending→display，最後精確收齊後才結束",
            spendableWallet="displayBalance；未抵達的pendingWin不能下注", largeIntroDuration=1.2,
            autoAndLock="DT2：Lock開啟AUTO/關閉停止AUTO；Lock已有目標時可持續；失效先同tier最近舊點，再最高獎額目標",
            galleryBehavior="開啟回顧會停止AUTO並暫停投注；關閉後手動重開AUTO",
            revealBehavior="僅大階排隊/全螢幕與回顧暫停投注；中階各自影片及收心不擋射擊；派彩不依影片播放或關閉結果",
            previewBehavior="小中大演出預覽及愛心FX均不扣點、不派彩、不解鎖回顧",
        },
    })
end

function Game.start(api: EngineApi)
    time = 0
    reset(api)
    local ui = api.ui.components.create({text={font_size=1.25, color={0.75,0.89,1,1}}})
    api.ui.setRoot(ui.screen({
        id="demo-status", node="game", children={
            ui.panel({id="presentation-anchor", rect={x=0,y=0,width=1,height=1}, style={opacity=0}}),
        },
    }))
    local packageInfo = api.ui.components.info()
    api.observation.set("uiPackage", {name=packageInfo.name, version=packageInfo.version, declared=packageInfo.declared})
    publish(api)
end

function Game.update(api: EngineApi, dt: number)
    time += dt
    cooldown = math.max(-dt, cooldown - dt)
    if api.input.wasPressed("ViewportPortrait") then
        viewportBlocked = true
        viewportNeedsFreshInput = true
        auto = false
        lock = false
        gestureHasTarget = false
        cadenceContinuous = false
        cooldown = math.max(0,cooldown)
    elseif api.input.wasPressed("ViewportLandscape") and viewportBlocked then
        viewportBlocked = false
        viewportNeedsFreshInput = true
        auto = false
        lock = false
        gestureHasTarget = false
        cadenceContinuous = false
        cooldown = math.max(0,cooldown)
    end
    if api.input.wasPressed("DemoReset") then reset(api) end
    if api.input.wasPressed("WeaponLike") then weapon = "like" end
    if api.input.wasPressed("WeaponFlower") then weapon = "flower" end
    if api.input.wasPressed("WeaponRocket") then weapon = "rocket" end
    if api.input.wasPressed("BetDown") then betIndex = math.max(1, betIndex-1) end
    if api.input.wasPressed("BetUp") then betIndex = math.min(#BETS, betIndex+1) end
    if api.input.wasPressed("ToggleLock") and not viewportBlocked and not galleryOpen then
        lock = not lock
        auto = lock
        if lock then viewportNeedsFreshInput = false end
        if not lock and weapon == "like" then lockedTargetId = "" end
    end
    if api.input.wasPressed("ToggleAuto") and not galleryOpen and not viewportBlocked then
        auto = not auto
        if auto then viewportNeedsFreshInput = false end
    end
    if api.input.wasPressed("GalleryOpen") then
        galleryOpen = true
        auto = false
        lock = false
        message = "回顧開啟中：AUTO已停止，投注暫停"
    end
    if api.input.wasPressed("GalleryClose") then galleryOpen = false end
    if api.input.wasPressed("CardSeedReady") then
        local seed = 0
        for bit = 0, 30 do
            if api.input.isDown("CardSeedBit"..tostring(bit)) then seed += 2^bit end
        end
        cardSystem.setSeed(seed)
    end
    if api.input.wasPressed("CardDrawAll") then cardSystem.drawAll(galleryOpen,viewportBlocked)
    elseif api.input.wasPressed("CardDraw") then cardSystem.draw(galleryOpen,viewportBlocked) end
    if not galleryOpen or api.input.wasPressed("CardViewerClose") then cardViewer.open = false
    elseif api.input.wasPressed("CardViewerOpen") and not viewportBlocked then cardViewer.open = true end
    if api.input.wasPressed("CardViewerReducedMotion") then
        cardViewer.reducedMotion = true
        syncCardShaderUniforms(api)
    elseif api.input.wasPressed("CardViewerFullMotion") then
        cardViewer.reducedMotion = false
        syncCardShaderUniforms(api)
    end
    if api.input.wasPressed("ToggleSkipSeenLargeVideos") then largePlayback.skipSeen = not largePlayback.skipSeen end
    updateGalleryLargePlayback(api)
    local currentVideo = reveal
    if api.input.wasPressed("RevealVideoStarted") and currentVideo ~= nil and currentVideo.stage == "video" and not currentVideo.videoStarted then
        currentVideo.videoStarted = true
        currentVideo.videoStartedAt = time
        currentVideo.expiresAt = time + (if currentVideo.tier == "large" then 9 else 5.8)
    end
    local largeMediaCompleted = currentVideo ~= nil and currentVideo.stage == "video" and currentVideo.videoStarted
        and api.input.wasPressed("LargeVideoCompleted:"..tostring(currentVideo.serial)..":"..currentVideo.clip.clipId)
    advanceReveal(api.input.wasPressed("RevealDone"), api.input.wasPressed("CloseReveal"),largeMediaCompleted)
    advanceMediumReveals(api)
    if reveal == nil and #revealQueue == 0 and not galleryOpen then
        local requestedClip: Clip? = nil
        for _, clipId in CLIP_ORDER do
            local clip = CLIPS[clipId]
            local publicPreview = clip.styleId == "classic" or unlockedClips[clip.clipId] == true
            if clip.available and publicPreview and api.input.wasPressed("PreviewClip:"..clipId) then requestedClip=clip; break end
        end
        if requestedClip ~= nil then
            local accepted = false
            if requestedClip.prizeTier == "small" then
                if not smallPreviewBusy() then
                    queueReward("small","small",0,true,{x=0,y=-0.7},0,0,requestedClip,0)
                    accepted = true
                end
            else
                accepted = enqueueReveal(requestedClip.prizeTier,requestedClip.prizeTier,0,true,requestedClip,0,false,-1)
            end
            if accepted then auto=false; lock=false end
        elseif api.input.wasPressed("PreviewMedium") then
            if enqueueReveal("medium", "medium", 0, true) then
                auto = false
                lock = false
            end
        elseif api.input.wasPressed("PreviewLarge") then
            auto = false
            lock = false
            enqueueReveal("large", "large", 0, true)
        elseif api.input.wasPressed("PreviewSmall") and not smallPreviewBusy() then
            auto = false
            lock = false
            queueReward("small", "small", 0, true, {x=0,y=-0.7}, 0, 0)
        end
    end

    for index = #targets, 1, -1 do
        local target = targets[index]
        if target.state == "caught" and time >= target.winUntil then
            api.entity.despawn(target.id)
            targets[index] = createTarget(api, target.tier, false)
        elseif target.state == "swimming" then
            target.x += target.speed * target.direction * dt
            target.y = target.lane + math.sin(time * 0.55 + target.phase) * 0.30
            if math.abs(target.x) > 10 then
                if lockedTargetId == target.id then lockedTargetId = "" end
                api.entity.despawn(target.id)
                targets[index] = createTarget(api, target.tier, false)
            else
                api.entity.setPosition(target.id, {x=target.x,y=target.y})
            end
        end
    end
    for index = #shots, 1, -1 do
        local shot = shots[index]
        if updateShot(api,shot,dt) then table.remove(shots,index) end
    end
    for index = #attacks, 1, -1 do
        local attack = attacks[index]
        attack.age += dt
        if attack.pendingShots <= 0 then
            resolveAttack(api, attack)
            if attack.id == lastRoundAttackId then
                lastRound.status = if #attack.hitTargetIds > 0 then "hit" else "miss"
                lastRound.resolvedAt = time
                local hitIds: {ObservationValue} = {}
                for _, id in attack.hitTargetIds do table.insert(hitIds,id) end
                lastRound.hitTargetIds = hitIds
            end
            table.remove(attacks, index)
        end
    end
    for index = #floating, 1, -1 do
        floating[index].age += dt
        if floating[index].age >= floating[index].duration then table.remove(floating, index) end
    end
    updateRewardFx(api, dt)
    startNextReveal()

    local pointerDown = api.input.isPointerDown()
    local pointer = api.input.getPointerPosition()
    local pointerPressed = pointerDown and not pointerWasDown
    local pointerMoved = pointerDown and pointerWasDown and ((pointer.x-previousPointer.x)^2+(pointer.y-previousPointer.y)^2 > 0.0000000001)
    local needsTarget = lock or weapon ~= "like"
    local firePressed = api.input.wasPressed("Fire")
    if not viewportBlocked and (pointerPressed or firePressed) then viewportNeedsFreshInput = false end
    if pointerPressed then gestureHasTarget = false end
    if not pointerDown then gestureHasTarget = false end
    if viewportBlocked or viewportNeedsFreshInput then gestureHasTarget = false end
    if not viewportBlocked and not viewportNeedsFreshInput and (pointerPressed or pointerMoved) then
        if needsTarget then
            local pointerTarget = targetAt(pointer)
            if pointerTarget ~= nil then
                selectPrimary(pointerTarget)
                gestureHasTarget = true
            end
        else
            setAim(pointer)
        end
    end
    local primary: Target? = if needsTarget then currentLock() else nil
    if needsTarget and primary == nil and (auto or lock) then
        primary = bestTarget()
        if primary ~= nil then selectPrimary(primary) end
    end
    if primary ~= nil then setAim({x=primary.x,y=primary.y}) end
    local fireAction = api.input.isDown("Fire") or firePressed
    local manualFire = pointerDown and (not needsTarget or gestureHasTarget)
    -- Lock selects/tracks aim and enabling it sets AUTO intent. Turning AUTO
    -- off must still stop firing while retaining the selected aim target.
    local fireWanted = manualFire or fireAction or auto
    local fireEligible = fireWanted and (not needsTarget or primary ~= nil)
        and not viewportBlocked and not viewportNeedsFreshInput and reveal == nil and #revealQueue == 0 and not galleryOpen
        and displayBalance >= BETS[betIndex]*COSTS[weapon]
    if fireWanted then
        if not needsTarget then lockedTargetId = "" end
        shoot(api, primary)
    end
    cadenceContinuous = fireEligible
    if not cadenceContinuous then cooldown = math.max(0,cooldown) end
    pointerWasDown = pointerDown
    previousPointer = {x=pointer.x,y=pointer.y}
    updateCardViewerParticles(api)
    publish(api)
end

return Game
