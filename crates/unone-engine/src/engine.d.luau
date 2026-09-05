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
    getPosition: (id: string) -> Vec2,
    setPosition: (id: string, position: Vec2) -> (),
    getVelocity: (id: string) -> Vec2,
    setVelocity: (id: string, velocity: Vec2) -> (),
    getTransform3D: (id: string) -> Transform3D,
    setTransform3D: (id: string, transform: Transform3D) -> (),
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

export type EngineApi = {
    entity: EntityApi,
    input: InputApi,
    random: RandomApi,
    physics: PhysicsApi,
    camera: CameraApi,
    camera3d: Camera3DApi,
    observation: ObservationApi,
    ui: UiApi,
    save: SaveApi,
    animation: AnimationApi,
    effect: EffectApi,
    log: (message: string) -> (),
}

export type Game = {
    start: (api: EngineApi) -> (),
    update: (api: EngineApi, dt: number) -> (),
}
