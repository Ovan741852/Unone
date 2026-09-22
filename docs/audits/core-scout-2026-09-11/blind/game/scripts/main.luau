--!strict
-- Engine type contract, inlined by `project init`.
-- Refresh it after an engine upgrade with `game api typings`.
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
    getPosition: () -> Vec2,
    setPosition: (position: Vec2) -> (),
    getZoom: () -> number,
    setZoom: (zoom: number) -> (),
}

export type Camera3DApi = {
    getTransform: () -> Camera3DTransform,
    setPosition: (position: Vec3) -> (),
    setTarget: (target: Vec3) -> (),
}

export type ObservationApi = {
    set: (key: string, value: ObservationValue) -> (),
}

export type UiAnchor =
    "top_left" | "top" | "top_right"
    | "left" | "center" | "right"
    | "bottom_left" | "bottom" | "bottom_right"

export type UiApi = {
    setRoot: (root: ObservationValue) -> (),
}

export type SaveApi = {
    set: (value: ObservationValue) -> (),
    get: () -> ObservationValue,
}

export type AnimationOptions = {
    asset: string?,
    loop: boolean?,
    speed: number?,
}

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
    entity: string?,
}

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
    play_batch: (effect: string, positions: buffer, seed: number?) -> string,
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
export type EngineApi = {
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

-- Game code starts here. Rules, numbers, ViewModels and save schemas are
-- game-owned; the engine only provides the API declared above.
local Game = {}

function Game.start(_api: EngineApi)
end

function Game.update(api: EngineApi, dt: number)
    if api.input.isDown("Right") then
        local position = api.entity.getPosition("example")
        position.x += dt
        api.entity.setPosition("example", position)
    end
end

return Game
