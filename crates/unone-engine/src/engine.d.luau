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
-- Viewport-height units; positive y paints downward. Sharp same-layout glyph copy.
export type UiTextShadow = {offset_x: number, offset_y: number, color: UiColor}
export type UiStyle = {
    text_shadow: UiTextShadow?,
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
-- No paint/style/children; ordinary semantic action and button capture lifetime.
export type UiInputRegionNode = UiPlacement & {
    kind: "input_region", id: string, action: string,
}
export type UiTextInputNode = UiPlacement & {
    kind: "text_input", id: string, text: string?, placeholder: string?, max_length: number?,
    focused: boolean?, enabled: boolean?, style: UiStyle?,
}
export type UiTextInputInteraction = {
    phase: "change" | "submit" | "cancel" | "focus" | "blur", text: string, composing: boolean,
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
-- Ordered, noninteractive artwork. Quads use the batch's coordinate space;
-- source is an optional pixel crop, while rect is an absolute design rectangle.
export type UiImageQuad = {
    asset: string, rect: UiRect,
    source: {x:number,y:number,width:number,height:number}?, opacity: number?,
}
export type UiImageBatchNode = {
    kind: "image_batch", id: string, rect: UiRect, quads: {UiImageQuad},
    background_for: UiBackgroundScope?,
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
export type UiNode = UiInputRegionNode | UiTextInputNode | UiTextNode | UiButtonNode | UiSliderNode | UiComboBoxNode
    | UiImageNode | UiImageBatchNode | UiPanelNode | UiComponentNode | UiScrollNode
export type UiScreen = {kind: "screen", id: string, node: string, children: {UiNode}, budget: UiBudget?}
-- @unone/ui: pure constructors and explicitly selected declarative layout.
-- create snapshots these defaults; leaf overrides win, padding merges per edge.
export type UiComponentsTheme = {
    text_input: UiStyle?,
    text: UiStyle?, button: UiStyle?, panel: UiStyle?, image: UiStyle?,
    slider: UiStyle?, combobox: UiStyle?,
}
export type UiComponentTextProps = UiPlacement & {
    id: string, text: string?, style: UiStyle?,
}
export type UiComponentInputRegionProps = UiPlacement & {
    id: string, action: string,
}
export type UiComponentTextInputProps = UiPlacement & {
    id: string, text: string?, placeholder: string?, max_length: number?,
    focused: boolean?, enabled: boolean?, style: UiStyle?,
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
export type UiComponentImageBatchProps = {
    id: string, rect: UiRect, quads: {UiImageQuad}, background_for: UiBackgroundScope?,
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


export type Game = {
    start: (api: EngineApi) -> (),
    update: (api: EngineApi, dt: number) -> (),
}
