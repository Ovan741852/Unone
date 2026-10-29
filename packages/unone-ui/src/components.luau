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
    text_shadow=true,
}
local insetFields: Fields = {left=true,top=true,right=true,bottom=true}
local themeFields: Fields = {text_input=true,text=true,button=true,slider=true,combobox=true,panel=true,image=true}
local surfaceFields: {[string]: Fields} = {
    panel={kind=true,style=true},
    image={kind=true,asset=true,fit=true,slice=true,alt=true,style=true},
}
local leafFields: {[string]: Fields} = {
    input_region={id=true,action=true},
    text_input={id=true,text=true,placeholder=true,max_length=true,focused=true,enabled=true,style=true},
    text={id=true,text=true,style=true},
    button={id=true,text=true,action=true,style=true},
    slider={id=true,text=true,action=true,style=true},
    combobox={id=true,text=true,action=true,expanded=true,style=true},
    panel={id=true,style=true,background_for=true},
    image={id=true,asset=true,fit=true,slice=true,alt=true,style=true,background_for=true},
    image_batch={id=true,quads=true,background_for=true},
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
-- Quad coordinates are absolute stage coordinates, so batch bounds must be
-- authored in the same space instead of moving independently with an anchor.
leafFields.image_batch = {id=true,rect=true,quads=true,background_for=true}

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
                hint = "; use createResponsiveLayout(...).resolve(api.ui.getViewport()) and pass resolved.rect(id) explicitly; constructors do not lay out children; scroll content uses local coordinates"
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
        local childDepth = depth+1
        for key, child in pairs(item) do
            assert(type(key)=="string" or type(key)=="number", "UI_COMPONENT_COPY: invalid table key")
            if key=="children" then dense(child,"children") end
            local childKind = type(child)
            if childKind=="table" then
                result[key] = visit(child,childDepth)
            else
                -- Scalars need validation and one work unit, not another Lua
                -- call. Allocate only visited entries so sparse source-table
                -- capacity cannot bypass the bounded portable-data copy.
                remaining -= 1
                assert(remaining>=0 and childDepth<=64, "UI_COMPONENT_COPY: data exceeds copy limits")
                assert(childKind=="nil" or childKind=="string" or childKind=="number" or childKind=="boolean",
                    "UI_COMPONENT_COPY: only portable UI data can be copied")
                result[key] = child
            end
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
    if value.text_shadow~=nil then
        fields(value.text_shadow,{offset_x=true,offset_y=true,color=true},path..".text_shadow")
    end
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

-- Explicit, pure geometry plans. The solver never publishes UI, measures text,
-- mutates authored nodes, changes styles, or advances simulation/input state.
local layoutOptionFields: Fields = {space=true,variants=true}
local layoutVariantFields: Fields = {name=true,minAspect=true,layout=true,values=true}
local layoutNodeFields: Fields = {id=true,kind=true,size=true,grow=true,padding=true,gap=true,columns=true,children=true}
local layoutViewportFields: Fields = {aspect=true}
local layoutBoundsFields: Fields = {left=true,top=true,width=true,height=true}
type LayoutAllocatedBounds = {left: number,top: number,right: number,bottom: number,epsilonX: number,epsilonY: number}

local function layoutFields(value: any, allowed: Fields, path: string)
    assert(type(value)=="table", "UI_LAYOUT_PROPS: "..path.." must be a table")
    assert(getmetatable(value)==nil,"UI_LAYOUT_PROPS: "..path.." must be a plain table without metatables")
    for key in pairs(value) do
        assert(type(key)=="string" and allowed[key],
            "UI_LAYOUT_PROP: unknown "..path.." field "..tostring(key).."; use explicit slot/row/column/grid plans, then pass resolved.rect(id) or resolved.viewport(id) to constructors")
    end
end

local function layoutNumber(value: any, label: string): number
    assert(type(value)=="number" and value==value and math.abs(value)<math.huge,
        "UI_LAYOUT_NUMBER: "..label.." must be finite")
    return value
end

local function layoutArray(value: any, path: string): number
    assert(type(value)=="table", "UI_LAYOUT_ARRAY: "..path.." must be a non-empty dense array")
    assert(getmetatable(value)==nil,"UI_LAYOUT_ARRAY: "..path.." must be a plain dense array without metatables")
    local count, maximum = 0, 0
    for key in pairs(value) do
        assert(type(key)=="number" and key>=1 and key%1==0 and key<=4096,
            "UI_LAYOUT_ARRAY: "..path.." must use consecutive integer keys starting at 1 (at most 4096 entries)")
        count += 1
        maximum = math.max(maximum,key)
    end
    assert(count>0 and count==maximum,"UI_LAYOUT_ARRAY: "..path.." must be a non-empty dense array without holes")
    return count
end

local function layoutIdentifier(value: any, label: string): string
    assert(type(value)=="string" and string.find(value,"%S")~=nil,
        "UI_LAYOUT_ID: "..label.." must be a nonblank string")
    return value
end

-- Values are portable author data, copied independently of layout structure.
-- Shared references are permitted; active recursion cycles are not.
local function layoutCopier(): (any) -> any
    local active: {[any]: boolean} = {}
    local remaining = 131072
    local function visit(value: any, depth: number): any
        remaining -= 1
        assert(remaining>=0 and depth<=32,"UI_LAYOUT_COPY: values exceed copy limits (depth 32, work 131072)")
        local kind = type(value)
        if kind~="table" then
            assert(kind=="nil" or kind=="string" or kind=="boolean" or kind=="number",
                "UI_LAYOUT_COPY: values must contain portable data, not functions or engine objects")
            if kind=="number" then layoutNumber(value,"values number") end
            return value
        end
        assert(getmetatable(value)==nil,"UI_LAYOUT_COPY: values must be plain portable tables without metatables")
        assert(not active[value],"UI_LAYOUT_COPY: cyclic values are not portable")
        active[value] = true
        local result: any = {}
        for key, child in pairs(value) do
            assert(type(key)=="string" or (type(key)=="number" and key==key and math.abs(key)<math.huge),
                "UI_LAYOUT_COPY: values keys must be strings or finite numbers")
            remaining -= 1
            assert(remaining>=0,"UI_LAYOUT_COPY: values exceed copy work limit 131072")
            result[key] = visit(child,depth+1)
        end
        active[value] = nil
        return result
    end
    return function(value: any): any return visit(value,0) end
end

local function responsiveLayout(options: any): any
    layoutFields(options,layoutOptionFields,"createResponsiveLayout")
    local space = if options.space==nil then "stage" else options.space
    assert(space=="stage" or space=="scroll","UI_LAYOUT_SPACE: space must be stage or scroll")
    layoutArray(options.variants,"variants")
    local snapshots: {any} = {}
    local names: {[string]: boolean} = {}
    local active: {[any]: boolean} = {}
    local nodeCount, previousAspect = 0, -1
    local cloneValues = layoutCopier()
    local function nodeSnapshot(node: any, ids: {[string]: boolean}, depth: number, parentKind: string?): any
        assert(depth<=32,"UI_LAYOUT_LIMIT: layout depth must not exceed 32")
        nodeCount += 1
        assert(nodeCount<=4096,"UI_LAYOUT_LIMIT: all variants together must not exceed 4096 layout nodes")
        layoutFields(node,layoutNodeFields,"layout node")
        assert(getmetatable(node)==nil,"UI_LAYOUT_PROPS: layout nodes must be plain tables")
        assert(not active[node],"UI_LAYOUT_CYCLE: layout children contain a cycle")
        active[node] = true
        local id = layoutIdentifier(node.id,"node id")
        assert(not ids[id],"UI_LAYOUT_DUPLICATE_ID: node id "..id.." occurs twice in one variant")
        ids[id] = true
        local kind = node.kind
        assert(kind=="slot" or kind=="row" or kind=="column" or kind=="grid",
            "UI_LAYOUT_KIND: "..id.." kind must be slot, row, column or grid")
        assert(node.size==nil or node.grow==nil,"UI_LAYOUT_FLEX: "..id.." cannot specify both size and grow")
        assert(parentKind~=nil or (node.size==nil and node.grow==nil),
            "UI_LAYOUT_FLEX: root size/grow are not used; pass resolve(viewport,bounds) to size the root")
        assert(parentKind~="grid" or (node.size==nil and node.grow==nil),
            "UI_LAYOUT_FLEX: direct grid children use equal cells and cannot specify size/grow")
        local snapshot: any = {id=id,kind=kind}
        if node.size~=nil then
            snapshot.size = layoutNumber(node.size,id..".size")
            assert(snapshot.size>0,"UI_LAYOUT_FLEX: size must be positive")
        elseif node.grow~=nil then
            snapshot.grow = layoutNumber(node.grow,id..".grow")
            assert(snapshot.grow>0,"UI_LAYOUT_FLEX: grow must be positive")
        end
        if kind=="slot" then
            assert(node.children==nil and node.padding==nil and node.gap==nil and node.columns==nil,
                "UI_LAYOUT_SLOT: slots cannot have children, padding, gap or columns; use a container")
        else
            snapshot.padding = {left=0,top=0,right=0,bottom=0}
            if node.padding~=nil then
                layoutFields(node.padding,insetFields,id..".padding")
                for edge in pairs(insetFields) do
                    if node.padding[edge]~=nil then
                        local length = layoutNumber(node.padding[edge],id..".padding."..edge)
                        assert(length>=0,"UI_LAYOUT_PADDING: padding edges must be non-negative")
                        snapshot.padding[edge] = length
                    end
                end
            end
            snapshot.gap = if node.gap==nil then 0 else layoutNumber(node.gap,id..".gap")
            assert(snapshot.gap>=0,"UI_LAYOUT_GAP: gap must be non-negative")
            if kind=="grid" then
                local columns = layoutNumber(node.columns,id..".columns")
                assert(columns>=1 and columns%1==0 and columns<=256,
                    "UI_LAYOUT_COLUMNS: grid columns must be an integer in 1..256 (declared columns remain reserved)")
                snapshot.columns = columns
            else
                assert(node.columns==nil,"UI_LAYOUT_COLUMNS: only grid containers accept columns")
            end
            layoutArray(node.children,id..".children")
            snapshot.children = {}
            for _, child in ipairs(node.children) do
                table.insert(snapshot.children,nodeSnapshot(child,ids,depth+1,kind))
            end
        end
        active[node] = nil
        return snapshot
    end
    for index, variant in ipairs(options.variants) do
        layoutFields(variant,layoutVariantFields,"variants["..index.."]")
        local name = layoutIdentifier(variant.name,"variant name")
        assert(not names[name],"UI_LAYOUT_VARIANT: variant names must be unique")
        names[name] = true
        local minimum = layoutNumber(variant.minAspect,name..".minAspect")
        assert(minimum>=0 and minimum>previousAspect and (index~=1 or minimum==0),
            "UI_LAYOUT_VARIANT: variants must be strictly ascending by minAspect, with the first exactly 0")
        previousAspect = minimum
        assert(variant.values~=nil,"UI_LAYOUT_VALUES: each variant requires values; use values={} when no style/content values are needed")
        table.insert(snapshots,{name=name,minAspect=minimum,
            layout=nodeSnapshot(variant.layout,{},1,nil),values=cloneValues(variant.values)})
    end
    local model: any = {}
    model.resolve = function(viewport: any, bounds: any?): any
        layoutFields(viewport,layoutViewportFields,"resolve viewport")
        local aspect = layoutNumber(viewport.aspect,"viewport.aspect")
        assert(aspect>0,"UI_LAYOUT_VIEWPORT: viewport.aspect must be positive; pass api.ui.getViewport()")
        local area = if bounds==nil then {left=0,top=0,width=100,height=100} else bounds
        layoutFields(area,layoutBoundsFields,"resolve bounds")
        local left, top = layoutNumber(area.left,"bounds.left"), layoutNumber(area.top,"bounds.top")
        local width, height = layoutNumber(area.width,"bounds.width"), layoutNumber(area.height,"bounds.height")
        assert(left>=0 and top>=0 and width>0 and height>0,
            "UI_LAYOUT_BOUNDS: bounds require non-negative left/top and positive width/height")
        local right, bottom = layoutNumber(left+width,"bounds right"), layoutNumber(top+height,"bounds bottom")
        assert(right>left and bottom>top,"UI_LAYOUT_BOUNDS: bounds are too small to represent at this origin")
        assert(space=="scroll" or (right<=100 and bottom<=100),
            "UI_LAYOUT_BOUNDS: stage bounds must stay in 0..100; use space='scroll' for scroll content")
        local chosen = snapshots[1]
        for _, candidate in ipairs(snapshots) do
            if candidate.minAspect<=aspect then chosen = candidate else break end
        end
        local areas: {[string]: any} = {}
        local function solve(node: any, x: number, y: number, w: number, h: number, parent: LayoutAllocatedBounds?)
            layoutNumber(x,node.id..".left");layoutNumber(y,node.id..".top")
            layoutNumber(w,node.id..".width");layoutNumber(h,node.id..".height")
            local edgeRight = layoutNumber(x+w,node.id.." right")
            local edgeBottom = layoutNumber(y+h,node.id.." bottom")
            if parent~=nil then
                -- Only repair accumulated IEEE-754 roundoff against already
                -- allocated edges. Meaningful overflow still fails; this does
                -- not shrink authored sizes or loosen the Core rect validator.
                assert(x>=parent.left-parent.epsilonX and y>=parent.top-parent.epsilonY
                    and edgeRight<=parent.right+parent.epsilonX and edgeBottom<=parent.bottom+parent.epsilonY,
                    "UI_LAYOUT_OVERFLOW: "..node.id.." exceeds its allocated container bounds")
                x = math.clamp(x,parent.left,parent.right)
                y = math.clamp(y,parent.top,parent.bottom)
                edgeRight = math.clamp(edgeRight,parent.left,parent.right)
                edgeBottom = math.clamp(edgeBottom,parent.top,parent.bottom)
                w = edgeRight-x
                h = edgeBottom-y
            end
            assert(x>=0 and y>=0 and w>0 and h>0,
                "UI_LAYOUT_OVERFLOW: "..node.id.." has no positive layout area; reduce fixed sizes, padding or gaps")
            areas[node.id] = {left=x,top=y,width=w,height=h}
            if node.kind=="slot" then return end
            local padding = node.padding
            local innerX, innerY = x+padding.left, y+padding.top
            local innerRight, innerBottom = edgeRight-padding.right, edgeBottom-padding.bottom
            local innerW, innerH = innerRight-innerX, innerBottom-innerY
            layoutNumber(innerX,node.id.." inner left");layoutNumber(innerY,node.id.." inner top")
            layoutNumber(innerW,node.id.." inner width");layoutNumber(innerH,node.id.." inner height")
            assert(innerW>0 and innerH>0,"UI_LAYOUT_OVERFLOW: "..node.id.." padding leaves no positive content area")
            local children: {any} = node.children
            local count = #children
            local roundoff = count*8*2.220446049250313e-16
            local childBounds = {left=innerX,top=innerY,right=innerRight,bottom=innerBottom,
                epsilonX=math.max(math.abs(innerX),math.abs(innerRight))*roundoff,
                epsilonY=math.max(math.abs(innerY),math.abs(innerBottom))*roundoff}
            if node.kind=="grid" then
                local columns, rows = node.columns, math.ceil(count/node.columns)
                local cellW = layoutNumber((innerW-node.gap*(columns-1))/columns,node.id.." grid cell width")
                local cellH = layoutNumber((innerH-node.gap*(rows-1))/rows,node.id.." grid cell height")
                assert(cellW>0 and cellH>0,"UI_LAYOUT_OVERFLOW: "..node.id.." grid gaps leave no positive cells")
                for index, child in ipairs(children) do
                    local column, row = (index-1)%columns, math.floor((index-1)/columns)
                    local childX, childY = innerX+column*(cellW+node.gap), innerY+row*(cellH+node.gap)
                    local childRight = if column==columns-1 then innerRight else childX+cellW
                    local childBottom = if row==rows-1 then innerBottom else childY+cellH
                    solve(child,childX,childY,childRight-childX,childBottom-childY,childBounds)
                end
            else
                local horizontal = node.kind=="row"
                local availableLength = layoutNumber((if horizontal then innerW else innerH)-node.gap*(count-1),node.id.." available length")
                local fixed, weight = 0, 0
                for _, child in ipairs(children) do
                    if child.size~=nil then fixed += child.size else weight += child.grow or 1 end
                end
                layoutNumber(fixed,node.id.." fixed size sum");layoutNumber(weight,node.id.." grow weight sum")
                local remainder = layoutNumber(availableLength-fixed,node.id.." remaining length")
                -- Budget precision depends on this axis's lengths, not its
                -- origin or the cross axis. Tiny valid bounds must not hide
                -- meaningful overflow behind a stage-sized tolerance.
                local budgetTolerance = math.max(math.abs(availableLength),math.abs(fixed))*roundoff
                if remainder<0 and remainder>=-budgetTolerance then remainder=0 end
                assert(remainder>=0 and (weight==0 or remainder>0),
                    "UI_LAYOUT_OVERFLOW: "..node.id.." fixed sizes and gaps exceed the available axis or leave zero area for grow children")
                local origin = if horizontal then innerX else innerY
                local usedFixed, usedWeight = 0, 0
                for index, child in ipairs(children) do
                    -- Allocate cumulative spans, rather than repeatedly adding
                    -- fractional widths. The final grow edge conserves space.
                    local childStart = origin+usedFixed+node.gap*(index-1)
                        +(if weight==0 then 0 else remainder*(usedWeight/weight))
                    if child.size~=nil then usedFixed+=child.size else usedWeight+=child.grow or 1 end
                    local childEnd = origin+usedFixed+node.gap*(index-1)
                        +(if weight==0 then 0 else remainder*(usedWeight/weight))
                    local length = layoutNumber(childEnd-childStart,node.id.." child length")
                    if horizontal then solve(child,childStart,innerY,length,innerH,childBounds)
                    else solve(child,innerX,childStart,innerW,length,childBounds) end
                end
            end
        end
        solve(chosen.layout,left,top,width,height,nil)
        local resolved: any = {variant=chosen.name,values=layoutCopier()(chosen.values)}
        local function find(id: string): any
            layoutIdentifier(id,"resolved region id")
            local region = areas[id]
            assert(region~=nil,"UI_LAYOUT_ID: no region named "..id.." in variant "..chosen.name)
            return region
        end
        resolved.viewport = function(id: string): any
            local region = find(id)
            return {left=region.left,top=region.top,width=region.width,height=region.height}
        end
        resolved.rect = function(id: string): any
            local region = find(id)
            return {x=region.left,y=if space=="stage" then 100-(region.top+region.height) else region.top,
                width=region.width,height=region.height}
        end
        return resolved
    end
    return model
end

local function makeKit(theme: any?): any
    if theme~=nil then
        fields(theme,themeFields,"theme")
        for key, value in pairs(theme) do style(value,"theme."..tostring(key)) end
    end
    local defaults = if theme==nil then {} else copy(theme)
    local kit: any = {}
    kit.createResponsiveLayout = function(options: any): any available();return responsiveLayout(options) end
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
    kit.textInput = function(props: any): any return leaf("text_input",props) end
    kit.inputRegion = function(props: any): any return leaf("input_region",props) end
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
    kit.imageBatch = function(props: any): any
        available()
        fields(props,leafFields.image_batch,"imageBatch")
        dense(props.quads,"imageBatch.quads")
        for _,quad in ipairs(props.quads) do
            fields(quad,{asset=true,rect=true,source=true,opacity=true},"imageBatch.quad")
            fields(quad.rect,rectFields,"imageBatch.quad.rect")
            if quad.source~=nil then fields(quad.source,rectFields,"imageBatch.quad.source") end
        end
        return leaf("image_batch",props)
    end
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
