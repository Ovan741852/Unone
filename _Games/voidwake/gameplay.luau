--!strict
-- VOIDWAKE: all simulation, combat, collision, progression and random selection
-- execute inside Unone's fixed-step Luau runtime. Official engine presentation
-- consumes real scene sprites, declarative particles, shaders, UI and audio.
-- Coordinates: +x right, +y down; angle 0 points north.
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

export type HeightfieldDefinition = {
    width: number, depth: number, heights: {number}, cell_size: number,
    origin: Vec3, texture: string,
}
export type HeightfieldPatch = {x: number, z: number, width: number, depth: number, heights: {number}}
export type HeightfieldApi = {
    -- Native presentation geometry; no collision or game-owned editing rules.
    -- Row-major X-fast samples; update rectangles use zero-based sample indices.
    set: (id: string, definition: HeightfieldDefinition) -> (),
    update: (id: string, patch: HeightfieldPatch) -> (),
    remove: (id: string) -> (),
}

export type Instances3DApi = {
    -- Packed little-endian f32 records: position.xyz, quaternion.xyzw, scale.xyz (40 bytes).
    -- Replaces a complete batch atomically; max 262144 instances / 256 batches per world.
    set: (id: string, asset: string, transforms: buffer) -> (),
    remove: (id: string) -> (),
}

export type ProjectedGeometry = {
    --40B f32LE vertex: clip.xyzw (0..w depth), uv, RGBA; u32LE triangle indices.
    --Official mesh UV convention(v0 bottom); engine owns transport and GPU resources.
    texture: string, vertices: buffer, indices: buffer,
    order: number?, depth_test: boolean?, depth_write: boolean?,
    scissor: {x: number,y: number,width: number,height: number}?,
    color_mode: ("linear" | "encoded")?, filter: ("nearest" | "linear")?,
    sampling_space: ("linear" | "encoded")?, address_mode: ("clamp" | "repeat")?, alpha_cutoff: number?, alpha_compare: ("greater_equal" | "greater")?,
    --source_over requires depth_test=false and depth_write=false; WebGL host-raster only.
    --Use alpha_cutoff=0 for full-alpha artwork; opaque defaults/snapshots are unchanged.
    blend: ("opaque" | "source_over")?,
}
export type ProjectedCompare = "never" | "less" | "equal" | "less_equal" | "greater" | "not_equal" | "greater_equal" | "always"
export type ProjectedFrameMaterial = {
    rgb: "texture_times_vertex", texture_alpha: "sampled" | "one",
    alpha: "texture" | "vertex" | "texture_times_vertex",
    alpha_test: {enabled: boolean, compare: ProjectedCompare, reference: number},
    blend: {enabled: boolean, operation: "add", source: "source_alpha", destination: "one" | "one_minus_source_alpha"},
    depth: {test: boolean, write: boolean, compare: ProjectedCompare},
    sampler: {min: "nearest" | "linear", mag: "nearest" | "linear", address_u: "clamp" | "repeat", address_v: "clamp" | "repeat"},
}
export type ProjectedFrameDraw = {
    id: string, texture: string, vertices: buffer, indices: buffer,
    clip_policy: "clip" | "inside", material: ProjectedFrameMaterial,
    scissor: {x: number,y: number,width: number,height: number}?,
}
export type ProjectedFrame = {
    profile: "rgb8_encoded_rebuild_v1" | "rgb8_encoded_gouraud_v1", initial: {rgb8: {number},depth: number}, draws: {ProjectedFrameDraw},
}
export type ProjectedApi = {
    -- Atomic ordered encoded-RGB reference frame. Requires explicit official Web profile.
    -- Caller supplies known initial RGB/depth and every predecessor draw; no previous-RAF accumulation.
    setFrame: (frame: ProjectedFrame) -> (),
    set: (id: string, geometry: ProjectedGeometry) -> (),
    remove: (id: string) -> (),
    setWorldVisible: (visible: boolean) -> (),
    getViewport: () -> {width: number, height: number, aspect: number, revision: number},
}

export type EscapeBehavior = "action" | "quit"
export type ApplicationApi = {
    -- Defaults to quit. Action mode publishes neutral Escape input for game policy.
    setEscapeBehavior: (behavior: EscapeBehavior) -> (),
    -- Monotonic host intent; native exits after successfully presenting this state.
    -- The game owns confirmation. Headless records the latch without GPU evidence.
    requestQuit: () -> (),
}

export type PhysicalModifiers = {shift:boolean,control:boolean,alt:boolean,meta:boolean,alt_graph:boolean?,caps_lock:boolean?,num_lock:boolean?}
export type PhysicalViewport = {revision:number,width:number,height:number,rect_left:number,rect_top:number,css_width:number,css_height:number,device_pixel_ratio:number}
export type PhysicalPoint = {x:number,y:number,inside:boolean,viewport:PhysicalViewport}
export type PhysicalCommon = {sequence:number,received_us:number,origin:"browser"|"host_synthetic"|"fixture",route:"control"|"game"|"engine_ui"|"host_ui"}
export type PhysicalInputEvent = PhysicalCommon & (
    {kind:"key",code:string,location:number,state:"down"|"up",["repeat"]:boolean,is_composing:boolean,modifiers:PhysicalModifiers}
    | {kind:"pointer",pointer_id:number,pointer_type:"mouse"|"pen"|"touch",phase:"down"|"up"|"move"|"cancel",button:number,buttons:number,point:PhysicalPoint?,modifiers:PhysicalModifiers}
    | {kind:"wheel",delta_x:number,delta_y:number,delta_z:number,unit:"pixel"|"line"|"page",point:PhysicalPoint,modifiers:PhysicalModifiers}
    | {kind:"capture",pointer_id:number,captured:boolean,source:"got"|"lost"}
    | {kind:"focus",focused:boolean,scope:"game"|"window"}
    | {kind:"reset",scope:"all"|"pointer",pointer_id:number?,reason:string}
    | {kind:"viewport",viewport:PhysicalViewport})
export type PhysicalInputBatch = {profile:"ordered_physical_v1",epoch:number,after_sequence:number,through_sequence:number,events:{PhysicalInputEvent}}
export type InputApi = {
    -- Current successful-tick text editing event; nil when no event for this ID.
    getTextInputInteraction: (id: string) -> UiTextInputInteraction?,
    -- Tick-scope detached ordered ingress; nil outside update or for legacy input.
    getPhysicalBatch: () -> PhysicalInputBatch?,
    -- Current-tick host-projected UI event. Prefer createSlider().update(input).
    getSliderInteraction: (id: string) -> UiSliderInteraction?,
    isDown: (action: string) -> boolean,
    -- Non-consuming edges for the current simulation tick. Read in update;
    -- multiple reads return the same result. Held actions press only once.
    wasPressed: (action: string) -> boolean,
    -- O(1), non-consuming: any semantic wasPressed edge in this same snapshot.
    -- Gate only discrete press scanners; held/release/pointer/text/slider work stays live.
    hasPressedActions: () -> boolean,
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
    array: ((values: nil) -> {ObservationValue}) & (<T>(values: {T}) -> {T}),
    setArray: <T>(key: string, values: {T}?) -> (),
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

export type UiCursor = {kind:"default"}|{kind:"hidden"}|{kind:"image",asset:string,width:number,height:number,hotspot_x:number,hotspot_y:number,filter:"nearest"|"linear"}
export type UiApi = {
    -- Official Web cursor overlay; pixels/hotspot use drawing-buffer units, y-down.
    setCursor: (cursor:UiCursor) -> (),
    -- Stateful immutable artwork definitions; call outside pure View/renderItem.
    imageBatch: UiImageBatchApi,
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
-- Borrowed mutable authored tables are accepted; constructor results expose readonly views.
-- Runtime recursive freezing is authoritative; analyzer builtins such as table.clear have gaps.
export type UiReadArray<T> = {read [number]:T}
-- Optional mutable authoring descriptors. Constructors borrow these values,
-- copy unowned input and never freeze or retain caller-owned tables.
export type UiRectInput = {x:number,y:number,width:number,height:number}
export type UiRect = {read x: number, read y: number, read width: number, read height: number}
-- Every style length uses vertical units (1 = 1% of viewport height).
-- Styles belong to one leaf, with no implicit inheritance. An explicit
-- font_size does not change when its box changes and never silently shrinks.
export type UiColor = UiReadArray<number> -- exactly four RGBA values, each in 0..1
export type UiInsets = {read left: number?, read top: number?, read right: number?, read bottom: number?}
-- Viewport-height units; positive y paints downward. Sharp same-layout glyph copy.
export type UiTextShadow = {read offset_x: number, read offset_y: number, read color: UiColor}
export type UiStyle = {
    read text_shadow: UiTextShadow?,
    read font_family: string?, read font_size: number?, read font_weight: number?,
    read line_height: number?, read letter_spacing: number?, read color: UiColor?,
    read text_align: ("start" | "center" | "end")?,
    read vertical_align: ("top" | "middle" | "bottom")?,
    read wrap: ("none" | "word")?, read overflow: ("clip" | "ellipsis")?,
    read padding: UiInsets?, read background: UiColor?, read border_color: UiColor?,
    read border_width: number?, read border_radius: number?, read opacity: number?,
}
export type UiStyleInput = {
    text_shadow: {offset_x:number,offset_y:number,color:{number}}?,
    font_family:string?,font_size:number?,font_weight:number?,
    line_height:number?,letter_spacing:number?,color:{number}?,
    text_align:("start"|"center"|"end")?,
    vertical_align:("top"|"middle"|"bottom")?,
    wrap:("none"|"word")?,overflow:("clip"|"ellipsis")?,
    padding:{left:number?,top:number?,right:number?,bottom:number?}?,
    background:{number}?,border_color:{number}?,
    border_width:number?,border_radius:number?,opacity:number?,
}
export type UiPlacement = {
    read rect: UiRect?, read anchor: UiAnchor?, read pivot: UiAnchor?,
    read offset: {read x: number?, read y: number?}?, read size: {read width: number, read height: number}?,
}
export type UiTextNode = UiPlacement & {
    read kind: "text", read id: string, read text: string?, read style: UiStyle?,
}
export type UiButtonNode = UiPlacement & {
    read kind: "button", read id: string, read text: string?, read action: string, read style: UiStyle?,
}
-- No paint/style/children; ordinary semantic action and button capture lifetime.
export type UiInputRegionNode = UiPlacement & {
    read kind: "input_region", read id: string, read action: string,
}
export type UiTextInputNode = UiPlacement & {
    read kind: "text_input", read id: string, read text: string?, read placeholder: string?, read max_length: number?,
    read focused: boolean?, read enabled: boolean?, read style: UiStyle?,
}
export type UiTextInputInteraction = {
    phase: "change" | "submit" | "cancel" | "focus" | "blur", text: string, composing: boolean,
}
export type UiSliderNode = UiPlacement & {
    read kind: "slider", read id: string, read text: string?, read action: string, read style: UiStyle?,
    read drag: UiSliderDrag?,
}
export type UiSliderInteraction = {phase: "start" | "drag" | "end" | "cancel", ratio: number}
export type UiSliderDrag = {
    read axis: "horizontal" | "vertical", read reverse: boolean, read enabled: boolean,
    read track_rect: UiRect, read hit_rect: UiRect,
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
    read kind: "combobox", read id: string, read text: string?, read action: string,
    read expanded: boolean?, read style: UiStyle?,
}
-- Image and panel styles accept box fields; typography requires a text leaf.
-- A decorative surface may explicitly belong to its screen or an ancestor
-- component in the same coordinate space. This never changes placement/order.
export type UiBackgroundScope = {read screen: true} | {read component: string}
export type UiImageNode = UiPlacement & {
    read kind: "image", read id: string, read asset: string, read fit: ("contain" | "cover" | "stretch")?,
    read alt: string?, read slice: UiSlice?, read style: UiStyle?, read background_for: UiBackgroundScope?,
}
-- Ordered, noninteractive artwork. Quads use the batch's coordinate space;
-- source is an optional pixel crop, while rect is an absolute design rectangle.
export type UiImageQuad = {
    read asset: string, read rect: UiRect,
    read source: {read x:number,read y:number,read width:number,read height:number}?, read opacity: number?,
}
export type UiImageQuadInput = {
    asset:string,rect:UiRectInput,source:UiRectInput?,opacity:number?,
}
-- x'=a*x+c*y+tx, y'=b*x+d*y+ty. Maps retained local coordinates to stage y-up.
export type UiImageTransform = {read a:number,read b:number,read c:number,read d:number,read tx:number,read ty:number}
export type UiImageBatchDefinition = {read bounds:UiRect,read quads:UiReadArray<UiImageQuad>}
export type UiImageBatchDefinitionInput = {bounds:UiRectInput,quads:{UiImageQuadInput}}
export type UiImageBatchApi = {
    define: (id:string, content:UiImageBatchDefinition) -> (),
    remove: (id:string) -> boolean,
}
export type UiInlineImageBatchNode = {
    read kind: "image_batch", read id: string, read rect: UiRect, read quads: UiReadArray<UiImageQuad>,
    read background_for: UiBackgroundScope?, read pixel_snap:boolean?,
}
export type UiRetainedImageBatchNode = {
    -- rect is the stage clip/layout bound; it never translates the resource.
    read kind:"image_batch", read id:string, read rect:UiRect, read content:string,
    read transform:UiImageTransform?, read background_for:UiBackgroundScope?, read pixel_snap:boolean?,
}
export type UiImageBatchNode = UiInlineImageBatchNode | UiRetainedImageBatchNode
export type UiPanelNode = UiPlacement & {
    read kind: "panel", read id: string, read style: UiStyle?, read background_for: UiBackgroundScope?,
}
export type UiComponentNode = UiPlacement & {
    -- Grouping does not transform read children: their coordinates remain in the
    -- current stage/scroll space, with no relative-placement or style inheritance.
    read kind: "component", read id: string, read component: string, read children: UiReadArray<UiNode>?,
}
-- Engine-managed virtual handles are a readonly public view of helper-owned live state.
-- They are not immutable reusable-subtree grants.
export type UiVirtualItems = {read keys:UiReadArray<string>,read row_height:number,read column_width:number,read columns:number,read gap_x:number,read gap_y:number,read revision:number,read first:number,read last:number}
export type UiScrollNode = UiPlacement & {
    read kind: "scroll_view", read id: string, read viewport: UiViewport?,
    read scroll: {read axis: string?, read enabled: boolean?, read inertia: boolean?, read deceleration: number?, read reset_key: string?, read wheel_rect: UiRect?, read virtual_items: UiVirtualItems?},
    read children: UiReadArray<UiNode>?,
}
export type UiNode = UiInputRegionNode | UiTextInputNode | UiTextNode | UiButtonNode | UiSliderNode | UiComboBoxNode
    | UiImageNode | UiImageBatchNode | UiPanelNode | UiComponentNode | UiScrollNode
export type UiScreen = {read kind: "screen", read id: string, read node: string, read children: UiReadArray<UiNode>, read budget: UiBudget?}
-- @unone/ui: pure constructors and explicitly selected declarative layout.
-- create snapshots these defaults; leaf overrides win, padding merges per edge.
export type UiComponentsTheme = {
    read text_input: UiStyle?,
    read text: UiStyle?, read button: UiStyle?, read panel: UiStyle?, read image: UiStyle?,
    read slider: UiStyle?, read combobox: UiStyle?,
}
export type UiComponentTextProps = UiPlacement & {
    read id: string, read text: string?, read style: UiStyle?,
}
export type UiComponentInputRegionProps = UiPlacement & {
    read id: string, read action: string,
}
export type UiComponentTextInputProps = UiPlacement & {
    read id: string, read text: string?, read placeholder: string?, read max_length: number?,
    read focused: boolean?, read enabled: boolean?, read style: UiStyle?,
}
export type UiComponentButtonProps = UiPlacement & {
    read id: string, read text: string?, read action: string, read style: UiStyle?,
}
-- Common invented value/binding props are absent; state belongs to the project.
-- Unknown fields and placement combinations still require runtime validation.
export type UiComponentSliderProps = UiPlacement & {
    read value: never?, read min: never?, read max: never?, read step: never?, read onChange: never?,
    read id: string, read text: string?, read action: string, read style: UiStyle?,
}
export type UiComponentComboBoxProps = UiPlacement & {
    read value: never?, read options: never?, read selected: never?, read onChange: never?,
    read id: string, read text: string?, read action: string, read expanded: boolean?, read style: UiStyle?,
}
export type UiComponentPanelProps = UiPlacement & {
    read id: string, read style: UiStyle?, read background_for: UiBackgroundScope?,
}
export type UiComponentImageProps = UiPlacement & {
    read id: string, read asset: string, read fit: ("contain" | "cover" | "stretch")?,
    read alt: string?, read slice: UiSlice?, read style: UiStyle?, read background_for: UiBackgroundScope?,
}
-- Constructors borrow inputs and return recursively frozen ordinary nodes.
export type UiInlineImageBatchProps = {
    read id:string, read rect:UiRect, read quads:UiReadArray<UiImageQuad>,
    read background_for:UiBackgroundScope?, read content:never?, read transform:never?,
    -- Optional physical-pixel edge rounding, ties away from zero; clip/UV unchanged.
    read pixel_snap:boolean?,
}
export type UiRetainedImageBatchProps = {
    read id:string, read rect:UiRect, read content:string,
    read transform:UiImageTransform?, read background_for:UiBackgroundScope?, read quads:never?,
    -- true requires b=c=0; negative/zero a/d are allowed, collapsed quads skip.
    read pixel_snap:boolean?,
}
export type UiComponentImageBatchProps = UiInlineImageBatchProps | UiRetainedImageBatchProps
export type UiComponentSurface = {
    read kind: "panel", read style: UiStyle?,
} | {
    read kind: "image", read asset: string, read fit: ("contain" | "cover" | "stretch")?,
    read alt: string?, read slice: UiSlice?, read style: UiStyle?,
}
export type UiComponentProps = UiPlacement & {
    read id: string, read component: string, read children: UiReadArray<UiNode>?, read surface: UiComponentSurface?,
}
export type UiComponentScreenProps = {
    read id: string, read node: string, read children: UiReadArray<UiNode>, read budget: UiBudget?,
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
    inputRegion: (props: UiComponentInputRegionProps) -> UiInputRegionNode,
    textInput: (props: UiComponentTextInputProps) -> UiTextInputNode,
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
    imageBatch: (props: UiComponentImageBatchProps) -> UiImageBatchNode,
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
export type UiViewport = {read left: number, read top: number, read width: number, read height: number}
export type UiScrollOptions = {
    id: string, viewport: UiViewport, content: UiReadArray<UiNode>?,
    axis: ("vertical" | "horizontal" | "both")?, enabled: boolean?,
    resetKey: string?, wheelRect: UiViewport?,
    inertia: boolean?, deceleration: number?,
}
-- Give T your project row type to check keys and render callbacks.
-- Bare options keep the legacy any default for existing projects.
export type UiVirtualOptions<T = any> = {
    id: string, viewport: UiViewport, items: {T}, key: string | ((T, number) -> string),
    rowHeight: number, gapY: number?,
    renderItem: (T, number, string) -> UiReadArray<UiNode>,
    enabled: boolean?, resetKey: string?, wheelRect: UiViewport?,
    inertia: boolean?, deceleration: number?,
}
export type UiVirtualGridOptions<T = any> = UiVirtualOptions<T> & {
    columns: number, columnWidth: number, gapX: number?,
}

-- One source texture and one node. Border pixels / pixels_per_unit become
-- vertical design units; optional source is a y-down pixel crop, not UI rect.
export type UiSlice = {
    read left: number, read top: number, read right: number, read bottom: number,
    read pixels_per_unit: number,
    read source: {read x: number, read y: number, read width: number, read height: number}?,
}
export type UiBudget = {read max_nodes: number}

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

-- Generic geometry only. Coordinates are packed f32 xyz triples, independent of entities.
export type EngineDiagnosticRecovery = {
    action: string,
    retry: "after_correction" | "next_tick" | "after_release" | "new_session" | "none",
    [string]: ObservationValue,
}
export type EngineDiagnosticContext = {
    frame: number, index: number?, ticket: number?,
    [string]: ObservationValue,
}
export type EngineDiagnostic = {
    api_version: number, code: string, operation: string, message: string,
    path: string?, actual: ObservationValue?, expected: ObservationValue?,
    recovery: EngineDiagnosticRecovery, recoverable: boolean, terminal: boolean,
    context: EngineDiagnosticContext,
    [string]: ObservationValue,
}
export type SpatialLimits = {
    indices: number, bodies: number, bodies_per_index: number,
    queries_per_batch: number, hits_per_query: number, coordinate_abs: number,
    submissions_per_tick: number, tickets: number, safe_integer: number,
    [string]: ObservationValue,
}
export type SpatialInfo = {
    api_version: number, backend: string, external: boolean,
    delivery: "next_tick", packed_format: "USB1", operations: {string},
    indices: number, bodies: number, tickets: number, pending: number, fault: string?,
    limits: SpatialLimits,
    [string]: ObservationValue,
}
export type SpatialBody = {
    id: number, position: {number}, radius: number,
    category: number?, previous_position: {number}?,
}
export type SpatialNearestQuery = {
    kind: "nearest", point: {number}, max_distance: number,
    mask: number?, exclude_id: number?,
}
export type SpatialOverlapQuery = {
    kind: "overlap_sphere", center: {number}, radius: number,
    mask: number?, exclude_id: number?,
}
export type SpatialSweepQuery = {
    kind: "sweep_sphere", from: {number}, to: {number}, radius: number,
    mask: number?, exclude_id: number?,
}
export type SpatialQuery = SpatialNearestQuery | SpatialOverlapQuery | SpatialSweepQuery
export type SpatialHit = {
    id: number, distance: number, fraction: number,
    point: {number}, normal: {number},
    [string]: ObservationValue,
}
export type SpatialQueryResult = {hits: {SpatialHit}, [string]: ObservationValue}
export type SpatialBatchResult = {
    version: number, results: {SpatialQueryResult}, [string]: ObservationValue,
}
export type SpatialExecutionPhases = {
    preparation: number?, queue_wait: number?,
    validation: number?, packing: number?, upload: number?, encode_submit: number?,
    readback_wait: number?, decode: number?, cpu_execute: number?, gpu_kernel: number?,
    [string]: ObservationValue,
}
export type SpatialExecutionProfile = {
    clock: string, total_ms: number, phases_ms: SpatialExecutionPhases,
    gpu_kernel_unavailable_reason: string?, upload_bytes: number, readback_bytes: number,
    [string]: ObservationValue,
}
export type SpatialManagerTimings = {
    snapshot: number, validation: number, result_validation: number, result_apply: number,
    [string]: ObservationValue,
}
export type SpatialProfileTotals = {
    submitted_batches: number, completed_batches: number, cancelled_tickets: number, failed_batches: number,
    bodies: number, queries: number, pair_tests_upper_bound: number, returned_hits: number,
    input_body_bytes: number, upload_bytes: number, readback_bytes: number,
    manager_ms: SpatialManagerTimings, executor_ms: number, executor_phases_ms: SpatialExecutionPhases,
    executor_samples: number, executor_wall_samples: number,
    [string]: ObservationValue,
}
export type SpatialProfileBatch = {
    ticket: number, version: number, bodies: number, queries: number,
    pair_tests_upper_bound: number, returned_hits: number, manager_ms: SpatialManagerTimings,
    executor_ms: number?, executor: SpatialExecutionProfile?, executor_unavailable_reason: string?,
    [string]: ObservationValue,
}
export type SpatialBindingSample = {
    operation: string, success: boolean, input_decode_ms: number, output_encode_ms: number,
    index: number?, ticket: number?,
    [string]: ObservationValue,
}
export type SpatialBindingProfile = {
    clock: string, scope: string, calls: number, failed_calls: number,
    input_decode_ms: number, output_encode_ms: number, last: SpatialBindingSample?,
    [string]: ObservationValue,
}
export type SpatialProfile = {
    api_version: number, backend: string, clock: string, scope: string,
    limits: {retained_completed_batches: number, counter_max: number, [string]: ObservationValue},
    totals: SpatialProfileTotals, last: SpatialProfileBatch?, bindings: SpatialBindingProfile,
    [string]: ObservationValue,
}
export type SpatialApi = {
    pack: (bodies: {SpatialBody}) -> buffer,
    create: (bodies: {SpatialBody} | buffer) -> number,
    update: (index: number, bodies: {SpatialBody} | buffer) -> number,
    destroy: (index: number) -> (),
    -- Submit/take/cancel during update; take is legal starting the next tick.
    submit: (index: number, queries: {SpatialQuery}) -> number,
    take: (ticket: number) -> SpatialBatchResult,
    cancel: (ticket: number) -> (),
    info: () -> SpatialInfo,
    -- Latest structured failure; retained across successful calls, reset on successful reload.
    lastDiagnostic: () -> EngineDiagnostic?,
    -- Detached wall-clock diagnostics; excluded from replay unless explicitly published.
    profile: () -> SpatialProfile,
}

-- Opt-in, demand-sampled runtime-origin elapsed milliseconds; never a fixed-dt alias.
export type HostTimeApi = {
    sample: (tag: string) -> number,
}

export type EngineApi = {
    hostTime: HostTimeApi,
    application: ApplicationApi,
    spatial: SpatialApi,
    shader: ShaderApi,
    jobs: JobsApi,
    instances3d: Instances3DApi,
    projected: ProjectedApi,
    heightfield: HeightfieldApi,
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


-- Optional diagnostics adapter read from the returned Game table; see docs/diagnostics-replay.md.
export type GameReplayAdapter = {
    id: string,
    version: string,
    restore: ((capture: ObservationValue, api: EngineApi) -> boolean)?,
    inspect: ((context: { tick: number }, api: EngineApi) -> ObservationValue)?,
    compatible: ((versions: ObservationValue, api: EngineApi) -> boolean)?,
}

export type Game = {
    start: (api: EngineApi) -> (),
    update: (api: EngineApi, dt: number) -> (),
    -- Called on a successful hot reload with the candidate API; may update the world.
    onReload: ((api: EngineApi) -> ())?,
    replay: GameReplayAdapter?,
}
-- END UNONE API TYPES

local Game = {}
local S:any = {}
local nextId = 0
local BOUNDS = {x=1400,y=1000}
local SECTOR_DURATION = 40
local UPGRADES = {
 {id="reactor",name="超臨界反應爐",description="主炮傷害 +25%。將每一束餘燼變成穿甲光。",rarity="RARE"},
 {id="autoloader",name="磁軌自動裝填",description="射擊間隔 -18%。連續火力，直到深空沉默。",rarity="RARE"},
 {id="twin",name="雙聯脈衝炮",description="每次射擊額外增加一發平行彈，最多五發。",rarity="EPIC"},
 {id="shield",name="相位護盾矩陣",description="護盾上限 +30，立即回滿。回充速度 +20%。",rarity="RARE"},
 {id="hull",name="複合裝甲龍骨",description="艦體上限 +35，立即修復 50 點。",rarity="COMMON"},
 {id="thruster",name="離子向量推進",description="航速 +15%，閃避冷卻 -15%。",rarity="COMMON"},
 {id="magnet",name="深空回收磁場",description="拾取吸附距離 +85，修復艦體 25 點。",rarity="COMMON"},
 {id="pulse",name="電磁過載核心",description="脈衝傷害 +60%，範圍 +20%，冷卻 -15%。",rarity="EPIC"},
 {id="pierce",name="鎢芯穿甲彈",description="每發主炮多穿透一個目標，傷害 +10%。",rarity="EPIC"},
}

local function id():number nextId += 1; return nextId end
local function dist2(ax:number,ay:number,bx:number,by:number):number return (ax-bx)^2+(ay-by)^2 end
local function clamp(v:number,a:number,b:number):number return math.max(a,math.min(b,v)) end
local function angleTo(ax:number,ay:number,bx:number,by:number):number return math.atan2(bx-ax,ay-by) end

local function fx(kind:string,x:number,y:number,r:number,life:number)
 table.insert(S.effects,{id=id(),kind=kind,x=x,y=y,radius=r,life=life,maxLife=life,angle=0})
end
-- @AUDIO@
-- @UI@
-- @PRESENTATION@
local function fresh(api:EngineApi,phase:string)
 nextId=0
 S={phase=phase,time=0,sectorTime=0,sectorDuration=SECTOR_DURATION,sector=1,wave=0,kills=0,
  xp=0,xpNext=14,level=1,credits=0,seed=0,choices={},upgrades={},upgradesInstalled=0,
  autoFire=true,burstCooldown=0,dashCooldown=0,bossSpawned=false,sectorDraft=false,
  levelDraft=false,fireCooldown=0,spawnCooldown=2.2,waveCooldown=8,lastDamage=-10,
  fired=0,damageTaken=0,burstCount=0,dashCount=0,previousPhase="playing",
  player={x=0,y=0,vx=0,vy=0,angle=0,radius=18,hp=100,maxHp=100,shield=60,maxShield=60,
   boost=100,boostMax=100,invuln=0,dashTime=0,dashX=0,dashY=-1,hit=0},
  stats={damage=18,fireInterval=.19,projectiles=1,speed=220,pierce=0,magnet=100,
   shieldRegen=9,dashCooldown=2.4,burstDamage=85,burstRadius=330,burstInterval=12},
  enemies={},bullets={},pickups={},effects={},asteroids={},bounds=BOUNDS}
 -- The runtime seed itself is host-owned. This reproducible signature identifies
 -- the content generated from it without introducing a second random generator.
 S.seed=api.random.nextInt(1,2147483646)
 for i=1,19 do
  local x=(api.random.nextFloat()*2-1)*1270
  local y=(api.random.nextFloat()*2-1)*870
  if x*x+y*y<220*220 then x+=440 end
  table.insert(S.asteroids,{id=id(),x=x,y=y,radius=25+api.random.nextFloat()*35,
   angle=api.random.nextFloat()*math.pi*2,spin=(api.random.nextFloat()-.5)*.08})
 end
 abandonPrompt=false
 resetPresentation(api)
 resetAudio(api)
end
-- A published ViewModel is a stable interchange format. Native and WASM may
-- differ at the last bit of an intermediate float; leave simulation untouched
-- and publish sub-microunit precision consistently across those targets.
local function viewValue(value:any):any
 if type(value)=="number" then
  if value==math.floor(value) then return value end
  return math.floor(value*1000000+.5)/1000000
 elseif type(value)=="table" then
  local result:any={}
  for key,child in pairs(value) do result[key]=viewValue(child) end
  return result
 end
 return value
end
local function publish(api:EngineApi)
 api.entity.setPosition("player",{x=S.player.x,y=-S.player.y})
 api.camera.setPosition({x=S.player.x,y=-S.player.y})
 updatePresentation(api)
 updateAudio(api)
 updateUi(api)
 api.observation.set("game",viewValue(S))
 -- Small semantic observations make headless replay assertions independent
 -- from the renderer and from a complete, brittle state-object comparison.
 api.observation.set("phase",S.phase)
 api.observation.set("fired",S.fired)
 api.observation.set("sector",S.sector)
 api.observation.set("level",S.level)
 api.observation.set("kills",S.kills)
 api.observation.set("time",viewValue(S.time))
 api.observation.set("player_x",viewValue(S.player.x))
 api.observation.set("player_y",viewValue(S.player.y))
 api.observation.set("autoFire",S.autoFire)
 api.observation.set("burstCount",S.burstCount)
 api.observation.set("dashCount",S.dashCount)
 api.observation.set("upgradesInstalled",S.upgradesInstalled)
 api.observation.set("choiceCount",#S.choices)
 api.observation.set("movedRight",S.player.x>100)
 api.observation.set("finiteState",S.player.hp>=0 and S.player.hp<=S.player.maxHp and S.player.shield>=0 and S.player.shield<=S.player.maxShield)
end
local function bullet(owner:string,x:number,y:number,angle:number,speed:number,damage:number,radius:number,pierce:number)
 if #S.bullets>=280 then return end
 table.insert(S.bullets,{id=id(),owner=owner,friendly=owner=="player",x=x,y=y,
  previousX=x,previousY=y,angle=angle,vx=math.sin(angle)*speed,vy=-math.cos(angle)*speed,
  damage=damage,radius=radius,life=owner=="player" and 1.5 or 4,pierce=pierce,hits={}})
end
local function spawnEnemy(api:EngineApi,kind:string?)
 if #S.enemies>=28 then return end
 local k=kind or (api.random.nextFloat()<.24 and "shooter" or "chaser")
 if not kind and S.sector>=2 and api.random.nextFloat()<.19 then k="heavy" end
 local a=api.random.nextFloat()*math.pi*2
 local p=S.player
 local d=480+api.random.nextFloat()*180
 local x=clamp(p.x+math.cos(a)*d,-1350,1350)
 local y=clamp(p.y+math.sin(a)*d,-950,950)
 local hp=(k=="boss" and 2200 or k=="heavy" and 115 or k=="shooter" and 46 or 32)+(S.sector-1)*(k=="boss" and 0 or 12)
 table.insert(S.enemies,{id=id(),kind=k,boss=k=="boss",x=x,y=y,angle=angleTo(x,y,p.x,p.y),
  radius=k=="boss" and 82 or k=="heavy" and 32 or 22,hp=hp,maxHp=hp,
  speed=k=="boss" and 45 or k=="heavy" and 64 or k=="shooter" and 92 or 108+S.sector*8,
  cooldown=k=="boss" and 2 or .9+api.random.nextFloat()*2,telegraph=0,pattern=0,hit=0,age=0})
end
local function draft(api:EngineApi,sectorClear:boolean)
 S.phase="upgrade"
 S.sectorDraft=sectorClear
 S.choices={}
 local used:{[number]:boolean}={}
 for _=1,3 do
  local n=api.random.nextInt(1,#UPGRADES)
  while used[n] do n=n%#UPGRADES+1 end
  used[n]=true
  local u=UPGRADES[n]
  table.insert(S.choices,{id=u.id,name=u.name,description=u.description,desc=u.description,rarity=u.rarity})
 end
end
local function install(index:number)
 local chosen=S.choices[index]
 if not chosen then return end
 local k=chosen.id
 local p,st=S.player,S.stats
 if k=="reactor" then st.damage*=1.25
 elseif k=="autoloader" then st.fireInterval=math.max(.055,st.fireInterval*.82)
 elseif k=="twin" then st.projectiles=math.min(5,st.projectiles+1);if st.projectiles==5 then st.damage*=1.1 end
 elseif k=="shield" then p.maxShield+=30;p.shield=p.maxShield;st.shieldRegen*=1.2
 elseif k=="hull" then p.maxHp+=35;p.hp=math.min(p.maxHp,p.hp+50)
 elseif k=="thruster" then st.speed*=1.15;st.dashCooldown*=.85
 elseif k=="magnet" then st.magnet+=85;p.hp=math.min(p.maxHp,p.hp+25)
 elseif k=="pulse" then st.burstDamage*=1.6;st.burstRadius*=1.2;st.burstInterval*=.85
 elseif k=="pierce" then st.pierce+=1;st.damage*=1.1 end
 S.upgrades[k]=(S.upgrades[k] or 0)+1
 S.upgradesInstalled+=1
 S.choices={}
 if S.sectorDraft then
  S.sector+=1;S.sectorTime=0;S.enemies={};S.bullets={};S.wave=0;S.spawnCooldown=2
  p.shield=p.maxShield;p.hp=math.min(p.maxHp,p.hp+15);S.burstCooldown=0
  fx("pulse",p.x,p.y,430,1)
 end
 S.sectorDraft=false
 S.phase="playing"
end
local function damagePlayer(amount:number)
 local p=S.player
 if p.invuln>0 or S.phase~="playing" then return end
 local blocked=math.min(p.shield,amount)
 p.shield-=blocked
 p.hp=math.max(0,p.hp-(amount-blocked))
 p.invuln=.55;p.hit=.3;S.lastDamage=S.time;S.damageTaken+=amount
 fx("hit",p.x,p.y,55,.3)
 if p.hp<=0 then S.phase="gameover";fx("explosion",p.x,p.y,130,1.5) end
end
local function destroyEnemy(api:EngineApi,index:number)
 local e=S.enemies[index]
 fx("explosion",e.x,e.y,e.kind=="boss" and 200 or e.radius*1.7,e.kind=="boss" and 1.5 or .65)
 S.kills+=1
 S.credits+=e.kind=="boss" and 200 or e.kind=="heavy" and 12 or 5
 if e.kind=="boss" then S.phase="victory";S.bullets={};table.remove(S.enemies,index);return end
 table.insert(S.pickups,{id=id(),kind="xp",x=e.x,y=e.y,value=e.kind=="heavy" and 7 or 3,radius=10,life=25})
 if api.random.nextFloat()<.13 then table.insert(S.pickups,{id=id(),kind="repair",x=e.x+16,y=e.y,value=18,radius=12,life=25}) end
 table.remove(S.enemies,index)
end
local function nearestEnemy():any
 local result=nil
 -- Automatic targeting waits until a hostile reaches the combat viewport.
 -- Manual aim still uses the projectile's full ballistic range.
 local best=500^2
 for _,e in ipairs(S.enemies) do
  local d=dist2(S.player.x,S.player.y,e.x,e.y)
  if d<best then best=d;result=e end
 end
 return result
end
-- Swept circle impact: fast projectiles cannot tunnel between fixed ticks.
local function segmentDistance2(ax:number,ay:number,bx:number,by:number,px:number,py:number):number
 local dx,dy=bx-ax,by-ay
 local den=dx*dx+dy*dy
 local t=den>0 and clamp(((px-ax)*dx+(py-ay)*dy)/den,0,1) or 0
 return dist2(ax+dx*t,ay+dy*t,px,py)
end
local function updatePlayer(api:EngineApi,dt:number,dashPressed:boolean,burstPressed:boolean)
 local p,st=S.player,S.stats
 local function down(a:string,b:string):boolean return api.input.isDown(a) or api.input.isDown(b) end
 local dx=(down("KeyD","ArrowRight") and 1 or 0)-(down("KeyA","ArrowLeft") and 1 or 0)
 local dy=(down("KeyS","ArrowDown") and 1 or 0)-(down("KeyW","ArrowUp") and 1 or 0)
 local length=math.sqrt(dx*dx+dy*dy)
 if length>0 then dx/=length;dy/=length end
 S.dashCooldown=math.max(0,S.dashCooldown-dt)
 S.burstCooldown=math.max(0,S.burstCooldown-dt)
 p.invuln=math.max(0,p.invuln-dt);p.hit=math.max(0,p.hit-dt)
 p.boost=math.min(p.boostMax,p.boost+dt*29)
 if dashPressed and S.dashCooldown<=0 and p.boost>=35 then
  p.dashX=length>0 and dx or math.sin(p.angle)
  p.dashY=length>0 and dy or -math.cos(p.angle)
  p.dashTime=.19;p.invuln=.3;p.boost-=35;S.dashCooldown=st.dashCooldown;S.dashCount+=1
  fx("pulse",p.x,p.y,60,.32)
 end
 if p.dashTime>0 then p.dashTime=math.max(0,p.dashTime-dt);p.vx=p.dashX*st.speed*3.6;p.vy=p.dashY*st.speed*3.6
 else p.vx=dx*st.speed;p.vy=dy*st.speed end
 p.x=clamp(p.x+p.vx*dt,-BOUNDS.x+p.radius,BOUNDS.x-p.radius)
 p.y=clamp(p.y+p.vy*dt,-BOUNDS.y+p.radius,BOUNDS.y-p.radius)
 -- Rocks are solid obstacles. Contact separates the ship without arbitrary
 -- collision damage; hostile contact and projectiles remain damaging.
 for _,rock in ipairs(S.asteroids) do
  local rx,ry=p.x-rock.x,p.y-rock.y
  local d=math.sqrt(rx*rx+ry*ry)
  local r=p.radius+rock.radius
  if d<r and d>.001 then p.x=rock.x+rx/d*r;p.y=rock.y+ry/d*r end
 end
 if S.time-S.lastDamage>3 then p.shield=math.min(p.maxShield,p.shield+st.shieldRegen*dt) end
 local pointer=api.input.getPointerPosition()
 pointer={x=pointer.x,y=-pointer.y}
 local target=nearestEnemy()
 if S.autoFire and not api.input.isPointerDown() and target then
  -- A small lead makes moving targets readable while keeping ballistic shots.
  p.angle=angleTo(p.x,p.y,target.x,target.y)
 elseif dist2(p.x,p.y,pointer.x,pointer.y)>16 then p.angle=angleTo(p.x,p.y,pointer.x,pointer.y) end
 S.fireCooldown=math.max(0,S.fireCooldown-dt)
 if (api.input.isPointerDown() or api.input.isDown("Fire") or (S.autoFire and target)) and S.fireCooldown<=0 then
  S.fireCooldown=st.fireInterval
  for n=1,st.projectiles do
   local offset=(n-(st.projectiles+1)/2)*12
   bullet("player",p.x+math.sin(p.angle)*31+math.cos(p.angle)*offset,p.y-math.cos(p.angle)*31+math.sin(p.angle)*offset,p.angle,750,st.damage,5,st.pierce)
  end
  S.fired+=1
 end
 if burstPressed and S.burstCooldown<=0 then
  S.burstCooldown=st.burstInterval;S.burstCount+=1
  fx("burst",p.x,p.y,st.burstRadius,.85)
  for _,e in ipairs(S.enemies) do if dist2(p.x,p.y,e.x,e.y)<(st.burstRadius+e.radius)^2 then e.hp-=st.burstDamage;e.hit=.2 end end
  for i=#S.bullets,1,-1 do local b=S.bullets[i];if not b.friendly and dist2(p.x,p.y,b.x,b.y)<st.burstRadius^2 then table.remove(S.bullets,i) end end
 end
end
local function updateEnemies(api:EngineApi,dt:number)
 local p=S.player
 for _,e in ipairs(S.enemies) do
  if e.hp<=0 then continue end
  local dx,dy=p.x-e.x,p.y-e.y
  local distance=math.max(1,math.sqrt(dx*dx+dy*dy))
  e.angle=angleTo(e.x,e.y,p.x,p.y);e.age+=dt;e.hit=math.max(0,e.hit-dt)
  local desired=e.kind=="boss" and 390 or e.kind=="shooter" and 320 or 0
  if distance>desired then e.x+=dx/distance*e.speed*dt;e.y+=dy/distance*e.speed*dt
  elseif desired>0 and distance<desired-70 then e.x-=dx/distance*e.speed*dt*.6;e.y-=dy/distance*e.speed*dt*.6 end
  if e.kind=="shooter" then
   e.cooldown-=dt
   if e.cooldown<=0 then e.cooldown=math.max(1.25,2.8-S.sector*.25);bullet("enemy",e.x,e.y,e.angle,230,12,7,0) end
  elseif e.kind=="boss" then
   e.cooldown-=dt
   e.telegraph=e.cooldown<.8 and math.max(.01,.8-e.cooldown) or 0
   if e.cooldown<=0 then
    e.pattern+=1;e.cooldown=e.hp<e.maxHp*.5 and 1.9 or 2.7;e.telegraph=0
    if e.pattern%3==0 then
     for n=0,15 do bullet("enemy",e.x,e.y,n*math.pi/8+e.age*.2,180,16,9,0) end
    else for n=-3,3 do bullet("enemy",e.x,e.y,e.angle+n*.14,255,18,9,0) end end
    if e.pattern%4==0 then spawnEnemy(api,"chaser") end
   end
  end
  if distance<e.radius+p.radius then damagePlayer(e.kind=="boss" and 30 or e.kind=="heavy" and 24 or 16)
   e.x-=dx/distance*50;e.y-=dy/distance*50 end
 end
end
local function updateBullets(api:EngineApi,dt:number)
 for i=#S.bullets,1,-1 do
  local b=S.bullets[i]
  b.previousX=b.x;b.previousY=b.y;b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt
  local remove=b.life<=0
  if b.friendly then
   for _,e in ipairs(S.enemies) do
    if not b.hits[tostring(e.id)] and segmentDistance2(b.previousX,b.previousY,b.x,b.y,e.x,e.y)<(e.radius+b.radius)^2 then
     e.hp-=b.damage;e.hit=.16;b.hits[tostring(e.id)]=true;fx("hit",b.x,b.y,24,.15)
     if b.pierce<=0 then remove=true;break else b.pierce-=1 end
    end
   end
  else local p=S.player
   if segmentDistance2(b.previousX,b.previousY,b.x,b.y,p.x,p.y)<(p.radius+b.radius)^2 then damagePlayer(b.damage);remove=true end
  end
  -- Friendly and hostile projectiles share the same geometric asteroid cover.
  if not remove then for _,rock in ipairs(S.asteroids) do
   if segmentDistance2(b.previousX,b.previousY,b.x,b.y,rock.x,rock.y)<(rock.radius+b.radius)^2 then remove=true;fx("hit",b.x,b.y,18,.12);break end
  end end
  if remove then table.remove(S.bullets,i) end
 end
 for i=#S.enemies,1,-1 do if S.enemies[i].hp<=0 then destroyEnemy(api,i) end end
end
local function updatePickups(dt:number)
 local p=S.player
 for i=#S.pickups,1,-1 do
  local v=S.pickups[i]
  local dx,dy=p.x-v.x,p.y-v.y
  local d=math.sqrt(dx*dx+dy*dy)
  v.life-=dt
  if d<S.stats.magnet and d>1 then local travel=math.min(d,dt*(190+550*(1-d/S.stats.magnet)));v.x+=dx/d*travel;v.y+=dy/d*travel end
  if d<27 then
   if v.kind=="repair" then p.hp=math.min(p.maxHp,p.hp+v.value);fx("pulse",p.x,p.y,60,.4)
   else S.xp+=v.value;S.credits+=1 end
   table.remove(S.pickups,i)
  elseif v.life<=0 then table.remove(S.pickups,i) end
 end
end

function Game.start(api:EngineApi)
 fresh(api,"menu")
 publish(api)
end
function Game.update(api:EngineApi,dt:number)
 -- Engine edges are non-consuming and shared by all readers in this tick.
 -- Holding an action across a phase change must not buy another upgrade.
 local pressed:{[string]:boolean}={}
 for _,name in ipairs({"Start","Restart","Menu","Pause","Resume","AutoFire","Burst","KeyQ","Dash","Space","ShiftLeft","ShiftRight","Select1","Select2","Select3","Enter","Escape","KeyF","Digit1","Digit2","Digit3","Sound","Abandon","CancelAbandon"}) do pressed[name]=api.input.wasPressed(name) end
 local start=pressed.Start or pressed.Enter
 local restart=pressed.Restart or (pressed.Enter and (S.phase=="gameover" or S.phase=="victory"))
 local menu=pressed.Menu
 local pause=pressed.Pause or pressed.Escape
 local resume=pressed.Resume
 local auto=pressed.AutoFire or pressed.KeyF
 local burst=pressed.Burst or pressed.KeyQ
 local dash,space,shift,rightShift=pressed.Dash,pressed.Space,pressed.ShiftLeft,pressed.ShiftRight
 local select1,select2,select3=pressed.Select1 or pressed.Digit1,pressed.Select2 or pressed.Digit2,pressed.Select3 or pressed.Digit3
 if pressed.Sound then soundEnabled=not soundEnabled;api.audio.setMasterVolume(soundEnabled and .45 or 0) end
 if pressed.Abandon and S.phase=="paused" then abandonPrompt=true end
 if pressed.CancelAbandon then abandonPrompt=false end
 if menu then fresh(api,"menu");publish(api);return end
 if restart or (start and S.phase=="menu") then
  fresh(api,"playing");spawnEnemy(api,"chaser");spawnEnemy(api,"shooter");spawnEnemy(api,"chaser")
  publish(api);return
 end
 if pause and S.phase=="playing" then S.phase="paused";abandonPrompt=false
 elseif (resume or pause) and S.phase=="paused" then S.phase="playing";abandonPrompt=false end
 if auto and S.phase=="playing" then S.autoFire=not S.autoFire end
 if S.phase=="upgrade" then
  if select1 then install(1) elseif select2 then install(2) elseif select3 then install(3) end
  publish(api);return
 end
 if S.phase~="playing" then publish(api);return end
 dt=math.min(dt,.05)
 S.time+=dt;S.sectorTime+=dt
 updatePlayer(api,dt,dash or space or shift or rightShift,burst)
 updateEnemies(api,dt)
 updateBullets(api,dt)
 if S.phase=="playing" then updatePickups(dt) end
 for i=1,#S.asteroids do local a:any=S.asteroids[i];a.angle+=a.spin*dt end
 for i=#S.effects,1,-1 do local e=S.effects[i];e.life-=dt;if e.life<=0 then table.remove(S.effects,i) end end
 if S.phase=="playing" then
  S.spawnCooldown-=dt;S.waveCooldown-=dt
  if S.waveCooldown<=0 then S.wave+=1;S.waveCooldown=8;for _=1,math.min(4,S.sector+1) do spawnEnemy(api) end end
  if S.spawnCooldown<=0 then S.spawnCooldown=math.max(1.3,3-S.sector*.3);spawnEnemy(api) end
  if S.sector==4 and S.sectorTime>=8 and not S.bossSpawned then S.bossSpawned=true;spawnEnemy(api,"boss") end
  if S.sector<4 and S.sectorTime>=SECTOR_DURATION then draft(api,true)
  elseif S.xp>=S.xpNext then S.xp-=S.xpNext;S.xpNext+=10;S.level+=1;draft(api,false) end
 end
 publish(api)
end
return Game
