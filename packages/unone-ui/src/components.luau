--!strict
-- Official, pure Luau constructors over the existing UI transport.
-- The runtime supplies package metadata and the project's exact declaration.
local metadata: any, declared: boolean, isManagedNode: (any) -> boolean, helpers: any = ...
type Fields = {[string]: boolean}
local placement: Fields = {rect=true,anchor=true,pivot=true,offset=true,size=true}
local styleFields: Fields = {
    font_family=true,font_size=true,font_weight=true,line_height=true,letter_spacing=true,
    color=true,text_align=true,vertical_align=true,wrap=true,overflow=true,padding=true,
    background=true,border_color=true,border_width=true,border_radius=true,opacity=true,
}
local insetFields: Fields = {left=true,top=true,right=true,bottom=true}
local themeFields: Fields = {text=true,button=true,slider=true,combobox=true,panel=true,image=true}
local surfaceFields: {[string]: Fields} = {
    panel={kind=true,style=true},
    image={kind=true,asset=true,fit=true,slice=true,alt=true,style=true},
}
local leafFields: {[string]: Fields} = {
    text={id=true,text=true,style=true},
    button={id=true,text=true,action=true,style=true},
    slider={id=true,text=true,action=true,style=true},
    combobox={id=true,text=true,action=true,expanded=true,style=true},
    panel={id=true,style=true,background_for=true},
    image={id=true,asset=true,fit=true,slice=true,alt=true,style=true,background_for=true},
}
local componentFields: Fields = {id=true,component=true,children=true,surface=true}
local screenFields: Fields = {id=true,node=true,children=true,budget=true}
local sliderOptions: Fields = {id=true,value=true,min=true,max=true,step=true,axis=true,reverse=true}
local sliderViewFields: Fields = {rect=true,text=true,style=true,trackRect=true,hitPadding=true,enabled=true,action=true}
local rectFields: Fields = {x=true,y=true,width=true,height=true}
local scrollFields: Fields = {id=true,viewport=true,content=true,axis=true,enabled=true,inertia=true,deceleration=true,resetKey=true,wheelRect=true}
local virtualFields: Fields = {
    id=true,viewport=true,items=true,key=true,renderItem=true,rowHeight=true,gapY=true,
    enabled=true,inertia=true,deceleration=true,resetKey=true,wheelRect=true,
}
local virtualGridFields = table.clone(virtualFields)
virtualGridFields.columns = true
virtualGridFields.columnWidth = true
virtualGridFields.gapX = true
for _, fields in pairs(leafFields) do
    for key in pairs(placement) do fields[key] = true end
end
for key in pairs(placement) do componentFields[key] = true end

local function available()
    assert(declared, "UI_PACKAGE_NOT_DECLARED: declare runtime_packages={['"..metadata.name.."']='"..metadata.version.."'} in project.unone.json (JSON: \"runtime_packages\":{\""..metadata.name.."\":\""..metadata.version.."\"})")
end

local function fields(value: any, allowed: Fields, path: string)
    assert(type(value)=="table", "UI_COMPONENT_PROPS: "..path.." must be a table")
    for key in pairs(value) do
        if type(key)~="string" or not allowed[key] then
            local hint = ""
            if (path=="slider" and (key=="value" or key=="min" or key=="max" or key=="step"))
                or (string.sub(path,1,12)=="createSlider" and (key=="onChange" or key=="onClick" or key=="onPress")) then
                hint = "; use createSlider({id=...,value=...,min=...,max=...,step=...}), publish control.view({rect=...}), and call control.update(api.input) once in Game.update; no callbacks"
            elseif key=="onClick" or key=="onPress" or key=="onChange" or key=="onclick" then
                hint = "; declare action='Meaning' and read api.input.wasPressed(action) once per press or api.input.isDown(action) while held; no UI callbacks or automatic value binding"
            elseif key=="placement" then
                hint = "; flatten placement fields into the props: rect or anchor+size, with optional pivot/offset"
            elseif path=="virtualList" and (key=="columns" or key=="columnWidth" or key=="gapX") then
                hint = "; use virtualGrid for columns, columnWidth and gapX"
            elseif key=="layout" or key=="relative" or key=="flex" or key=="gap" or key=="grid" then
                hint = "; author rect or anchor+size explicitly; components keep children in stage coordinates and do not provide automatic layout; only scroll content uses local coordinates"
            elseif key=="kind" then
                hint = "; the named constructor supplies kind"
            elseif key=="fontSize" then
                hint = "; use style={font_size=...} (vertical units)"
            end
            error("UI_COMPONENT_PROP: unknown "..path.." field "..tostring(key)..hint)
        end
    end
end

local function dense(value: any, path: string): number
    assert(type(value)=="table", "UI_COMPONENT_CHILDREN: "..path.." must be a dense array")
    local count, maximum = 0, 0
    for key in pairs(value) do
        assert(type(key)=="number" and key>=1 and key%1==0 and key<=16384,
            "UI_COMPONENT_CHILDREN: "..path.." must use consecutive integer keys starting at 1")
        count += 1
        maximum = math.max(maximum,key)
    end
    assert(count==maximum, "UI_COMPONENT_CHILDREN: "..path.." contains a hole")
    return count
end

-- Clone portable author data with explicit cycle/depth/work bounds. Registered
-- virtual nodes retain their engine-owned identity so scroll requests reach the
-- exact node published in the tree. Their live contents belong to the helper.
local function copy(value: any): any
    local active: {[any]: boolean} = {}
    local remaining = 131072
    local function visit(item: any, depth: number): any
        remaining -= 1
        assert(remaining>=0 and depth<=64, "UI_COMPONENT_COPY: data exceeds copy limits")
        local kind = type(item)
        if kind~="table" then
            assert(kind=="nil" or kind=="string" or kind=="number" or kind=="boolean",
                "UI_COMPONENT_COPY: only portable UI data can be copied")
            return item
        end
        if isManagedNode(item) then return item end
        assert(not active[item], "UI_COMPONENT_COPY: cyclic UI data")
        active[item] = true
        local result: any = {}
        for key, child in pairs(item) do
            assert(type(key)=="string" or type(key)=="number", "UI_COMPONENT_COPY: invalid table key")
            if key=="children" then dense(child,"children") end
            result[key] = visit(child,depth+1)
        end
        active[item] = nil
        return result
    end
    return visit(value,0)
end

local function style(value: any, path: string)
    if value==nil then return end
    fields(value,styleFields,path)
    if value.padding~=nil then fields(value.padding,insetFields,path..".padding") end
end

local function compose(base: any?, override: any?): any
    style(base,"base style")
    style(override,"override style")
    local result = if base==nil then {} else copy(base)
    if override~=nil then
        local replacement = copy(override)
        for key, value in pairs(replacement) do
            if key=="padding" and result.padding~=nil then
                for edge, length in pairs(value) do result.padding[edge] = length end
            else
                result[key] = value
            end
        end
    end
    return result
end

local function identifier(instanceId: string, role: string): string
    assert(type(instanceId)=="string" and string.find(instanceId,"%S")~=nil,
        "UI_COMPONENT_ID: a non-empty stable instance ID is required")
    assert(type(role)=="string" and string.find(role,"%S")~=nil,
        "UI_COMPONENT_ID: a non-empty stable role is required")
    -- Escape role delimiters so id('a','b/c') differs from id(id('a','b'),'c').
    local escaped = string.gsub(string.gsub(role,"%%","%%25"),"/","%%2F")
    return instanceId.."/"..escaped
end

local function finite(value: any, label: string): number
    assert(type(value)=="number" and value==value and math.abs(value)<math.huge,
        "UI_SLIDER_NUMBER: "..label.." must be finite")
    return value
end

local function sliderRect(value: any, label: string): any
    fields(value,rectFields,label)
    local result = {}
    for _, key in ipairs({"x","y","width","height"}) do
        result[key] = finite(value[key],label.."."..key)
    end
    assert(result.width>0 and result.height>0,"UI_SLIDER_RECT: "..label.." must have positive width and height")
    assert(math.abs(result.x+result.width)<math.huge and math.abs(result.y+result.height)<math.huge,
        "UI_SLIDER_RECT: "..label.." bounds must be finite")
    return result
end

local function makeKit(theme: any?): any
    if theme~=nil then
        fields(theme,themeFields,"theme")
        for key, value in pairs(theme) do style(value,"theme."..tostring(key)) end
    end
    local defaults = if theme==nil then {} else copy(theme)
    local kit: any = {}
    local function leaf(kind: string, props: any): any
        available()
        fields(props,leafFields[kind],kind)
        style(props.style,kind..".style")
        local node = copy(props)
        node.kind = kind
        if defaults[kind]~=nil or props.style~=nil then
            node.style = compose(defaults[kind],props.style)
        end
        return node
    end
    kit.text = function(props: any): any return leaf("text",props) end
    kit.button = function(props: any): any return leaf("button",props) end
    kit.slider = function(props: any): any return leaf("slider",props) end
    -- The official control owns numeric/gesture state, while the host owns
    -- hit testing in the fully projected/clipped stage or scroll space.
    -- view remains pure so virtual materialization never advances interaction.
    kit.createSlider = function(options: any): any
        available()
        fields(options,sliderOptions,"createSlider")
        identifier(options.id,"control")
        assert(#options.id<=1024,"UI_SLIDER_ID: id must be at most 1024 UTF-8 bytes")
        local id = options.id
        local minimum = if options.min==nil then 0 else finite(options.min,"min")
        local maximum = if options.max==nil then 1 else finite(options.max,"max")
        assert(maximum>minimum and maximum-minimum<math.huge,
            "UI_SLIDER_RANGE: max must exceed min with a finite range")
        local step = if options.step==nil then nil else finite(options.step,"step")
        assert(step==nil or step>0,"UI_SLIDER_STEP: step must be positive")
        local axis = if options.axis==nil then "horizontal" else options.axis
        assert(axis=="horizontal" or axis=="vertical","UI_SLIDER_AXIS: axis must be horizontal or vertical")
        assert(options.reverse==nil or type(options.reverse)=="boolean","UI_SLIDER_REVERSE: reverse must be boolean")
        local reverse = options.reverse==true
        local function normalize(candidate: any): number
            local number = math.clamp(finite(candidate,"value"),minimum,maximum)
            local stepSize = step
            -- A non-divisible step still permits both exact endpoints.
            if number==minimum or number==maximum or stepSize==nil then return number end
            local steps = (number-minimum)/stepSize
            -- Beyond integer precision a step is smaller than the representable
            -- value interval; preserving the value also avoids overflow.
            if steps<4503599627370496 then
                number = math.clamp(minimum+math.floor(steps+0.5)*stepSize,minimum,maximum)
            end
            return number
        end
        local value = normalize(options.value)
        local dragging, blocked = false, false
        local control: any = {}
        control.getValue = function(): number return value end
        control.setValue = function(candidate: number)
            value = normalize(candidate)
            dragging = false
            blocked = true
        end
        control.cancel = function()
            dragging = false
            blocked = true
        end
        control.view = function(props: any): any
            available()
            fields(props,sliderViewFields,"createSlider.view")
            local rect = sliderRect(props.rect,"createSlider.view.rect")
            local track = if props.trackRect==nil then copy(rect) else sliderRect(props.trackRect,"createSlider.view.trackRect")
            local padding = if props.hitPadding==nil then 0.65 else finite(props.hitPadding,"hitPadding")
            assert(padding>=0,"UI_SLIDER_PADDING: hitPadding must be non-negative")
            assert(props.enabled==nil or type(props.enabled)=="boolean","UI_SLIDER_ENABLED: enabled must be boolean")
            local action = if props.action==nil then id else props.action
            assert(type(action)=="string" and string.find(action,"%S")~=nil,"UI_SLIDER_ACTION: action must be a non-empty string")
            local x, y = math.min(rect.x,track.x-padding), math.min(rect.y,track.y-padding)
            local hitRect = {x=x,y=y,
                width=math.max(rect.x+rect.width,track.x+track.width+padding)-x,
                height=math.max(rect.y+rect.height,track.y+track.height+padding)-y}
            finite(hitRect.x,"hit_rect.x");finite(hitRect.y,"hit_rect.y")
            finite(hitRect.width,"hit_rect.width");finite(hitRect.height,"hit_rect.height")
            local node = leaf("slider",{id=id,text=props.text,action=action,rect=rect,style=props.style})
            node.drag = {axis=axis,reverse=reverse,track_rect=track,hit_rect=hitRect,enabled=props.enabled~=false}
            return node
        end
        control.update = function(input: any): any
            assert(type(input)=="table",
                "UI_SLIDER_INPUT: pass api.input to control.update once in Game.update")
            local getInteraction: (string) -> any = input.getSliderInteraction
            assert(type(getInteraction)=="function",
                "UI_SLIDER_INPUT: pass api.input to control.update once in Game.update")
            local before = value
            local started, released, cancelled = false, false, false
            local interaction = getInteraction(id)
            if interaction~=nil then
                assert(type(interaction)=="table","UI_SLIDER_INTERACTION: interaction must be a table")
                local phase = interaction.phase
                assert(phase=="start" or phase=="drag" or phase=="end" or phase=="cancel",
                    "UI_SLIDER_INTERACTION: unsupported interaction phase")
                if phase=="start" then
                    blocked = false
                    dragging = true
                    started = true
                end
                if phase=="cancel" then
                    cancelled = dragging and not blocked
                    dragging = false
                    blocked = true
                elseif not blocked and dragging then
                    local ratio = finite(interaction.ratio,"interaction.ratio")
                    assert(ratio>=0 and ratio<=1,"UI_SLIDER_INTERACTION: ratio must be in 0..1")
                    -- The host already applied axis/reverse in projected space.
                    value = normalize(if ratio==1 then maximum else minimum+(maximum-minimum)*ratio)
                    if phase=="end" then dragging = false; released = true end
                end
            end
            return {value=value,changed=value~=before,dragging=dragging,
                started=started,released=released,cancelled=cancelled}
        end
        return control
    end
    kit.combobox = function(props: any): any return leaf("combobox",props) end
    kit.panel = function(props: any): any return leaf("panel",props) end
    kit.image = function(props: any): any return leaf("image",props) end
    kit.component = function(props: any): any
        available()
        fields(props,componentFields,"component")
        if props.children~=nil then dense(props.children,"component.children") end
        local node = copy(props)
        node.kind = "component"
        node.surface = nil
        local children: any = node.children or {}
        if props.surface~=nil then
            local surface = props.surface
            assert(type(surface)=="table" and (surface.kind=="panel" or surface.kind=="image"),
                "UI_COMPONENT_SURFACE: surface.kind must be panel or image")
            fields(surface,surfaceFields[surface.kind],"surface")
            local surfaceProps: any = copy(surface)
            surfaceProps.kind = nil
            surfaceProps.id = identifier(props.id,"surface")
            surfaceProps.background_for = {component=props.id}
            for key in pairs(placement) do surfaceProps[key] = copy(props[key]) end
            table.insert(children,1,leaf(surface.kind,surfaceProps))
        end
        node.children = if #children>0 then children else nil
        return node
    end
    kit.screen = function(props: any): any
        available()
        fields(props,screenFields,"screen")
        dense(props.children,"screen.children")
        local node = copy(props)
        node.kind = "screen"
        return node
    end
    -- Forward the original helper options, including renderItem/key functions.
    -- These helpers own registration, materialization and live node identity;
    -- portable-data copying here would break their established lifecycle.
    kit.scrollView = function(options: any): any
        available()
        fields(options,scrollFields,"scrollView")
        return helpers.scrollView(options)
    end
    kit.virtualList = function(options: any): any
        available()
        fields(options,virtualFields,"virtualList")
        return helpers.virtualList(options)
    end
    kit.virtualGrid = function(options: any): any
        available()
        fields(options,virtualGridFields,"virtualGrid")
        return helpers.virtualGrid(options)
    end
    kit.id = function(instanceId: string, role: string): string available(); return identifier(instanceId,role) end
    kit.composeStyle = function(base: any?, override: any?): any available(); return compose(base,override) end
    return kit
end

-- The module is a real unthemed kit, so discovery names are callable directly.
-- Building this kit does not bypass declaration guards on its methods.
local components = makeKit(nil)
components.info = function(): any
    local result = copy(metadata)
    result.declared = declared
    return result
end
components.create = function(theme: any?): any
    available()
    return makeKit(theme)
end
return components
