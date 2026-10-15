-- Unone public Luau contract.
--
-- This file is the engine's own copy and the single source of truth. A test
-- asserts every API in the engine's semantic index appears here, so the two
-- cannot drift. Write it into a project with:
--     game api typings --output <path>
-- project init inlines it into the entry script, because the engine runtime
-- has no module require: a single-file game must carry its own types for
-- `game check --types` to mean anything.
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
    setRoot: (root: ObservationValue) -> (),
    -- Helpers return a real scroll_view node. Content is local top-left/y-down;
    -- viewport uses explicit left/top; never pass a stage x/y rect here.
    scrollView: (options: UiScrollOptions) -> any,
    virtualList: (options: UiVirtualOptions) -> any,
    virtualGrid: (options: UiVirtualGridOptions) -> any,
    -- Actual host ceilings and the last valid tree's node/subtree usage.
    inspect: () -> ObservationValue,
}
export type UiRect = {x: number, y: number, width: number, height: number}
export type UiViewport = {left: number, top: number, width: number, height: number}
export type UiScrollOptions = {
    id: string, viewport: UiViewport, content: {any}?,
    axis: ("vertical" | "horizontal" | "both")?, enabled: boolean?,
    resetKey: string?, wheelRect: UiViewport?,
}
export type UiVirtualOptions = {
    id: string, viewport: UiViewport, items: {any}, key: string | ((any, number) -> string),
    rowHeight: number, gapY: number?,
    renderItem: (any, number, string) -> {any},
    enabled: boolean?, resetKey: string?, wheelRect: UiViewport?,
}
export type UiVirtualGridOptions = UiVirtualOptions & {
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
