--!strict
-- Official, pure Luau constructors over the existing UI transport.
-- The runtime supplies package metadata and the project's exact declaration.
local metadata: any, declared: boolean, isManagedNode: (any) -> boolean = ...
type Fields = {[string]: boolean}
local placement: Fields = {rect=true,anchor=true,pivot=true,offset=true,size=true}
local styleFields: Fields = {
    font_family=true,font_size=true,font_weight=true,line_height=true,letter_spacing=true,
    color=true,text_align=true,vertical_align=true,wrap=true,overflow=true,padding=true,
    background=true,border_color=true,border_width=true,border_radius=true,opacity=true,
}
local insetFields: Fields = {left=true,top=true,right=true,bottom=true}
local themeFields: Fields = {text=true,button=true,panel=true,image=true}
local surfaceFields: {[string]: Fields} = {
    panel={kind=true,style=true},
    image={kind=true,asset=true,fit=true,slice=true,alt=true,style=true},
}
local leafFields: {[string]: Fields} = {
    text={id=true,text=true,style=true},
    button={id=true,text=true,action=true,style=true},
    panel={id=true,style=true,background_for=true},
    image={id=true,asset=true,fit=true,slice=true,alt=true,style=true,background_for=true},
}
local componentFields: Fields = {id=true,component=true,children=true,surface=true}
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
        assert(type(key)=="string" and allowed[key], "UI_COMPONENT_PROP: unknown "..path.." field "..tostring(key))
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

local function create(theme: any?): any
    available()
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
    kit.id = function(instanceId: string, role: string): string available(); return identifier(instanceId,role) end
    kit.composeStyle = function(base: any?, override: any?): any available(); return compose(base,override) end
    return kit
end

return {
    info=function(): any
        local result = copy(metadata)
        result.declared = declared
        return result
    end,
    create=create,
    composeStyle=function(base: any?, override: any?): any available(); return compose(base,override) end,
    id=function(instanceId: string, role: string): string available(); return identifier(instanceId,role) end,
}
