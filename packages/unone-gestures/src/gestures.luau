--!strict
-- Reusable recognition only: no camera, picking, application actions or renderer.
-- The host binds this exact source, with its exact package declaration.
local table, math = table, math
local assert, type, pairs, pcall, error = assert, type, pairs, pcall, error
local metadata:any, declared:boolean, guard:()->() = ...
type Contact = {x:number,y:number,startX:number,startY:number,eligible:boolean}
local function finite(n:any):boolean
    return type(n)=="number" and n==n and math.abs(n)<math.huge
end
local function copyViewport(v:any):any
    assert(type(v)=="table" and finite(v.width) and v.width>0 and finite(v.height) and v.height>0
        and finite(v.revision) and v.revision>=1 and v.revision%1==0,"GESTURE_EVENT_INVALID: positive viewport dimensions and revision required")
    return table.freeze(table.clone(v))
end
local function create(options:any):any
    assert(declared,"GESTURE_PACKAGE_NOT_DECLARED: declare runtime_packages={['@unone/gestures']='0.1.0'} in project.unone.json")
    guard()
    options=options or {}
    assert(type(options)=="table","GESTURE_OPTIONS_INVALID: expected options table")
    for key in pairs(options) do
        assert(key=="panThreshold" or key=="minPinchDistance" or key=="accept" or key=="enabled",
            "GESTURE_OPTIONS_INVALID: unknown option "..tostring(key))
    end
    local threshold=if options.panThreshold==nil then 6 else options.panThreshold
    local minimum=if options.minPinchDistance==nil then 2 else options.minPinchDistance
    assert(finite(threshold) and threshold>=0,"GESTURE_OPTIONS_INVALID: panThreshold must be finite and nonnegative")
    assert(finite(minimum) and minimum>0,"GESTURE_OPTIONS_INVALID: minPinchDistance must be finite and positive")
    assert(options.accept==nil or type(options.accept)=="function","GESTURE_OPTIONS_INVALID: accept must be a function")
    assert(options.enabled==nil or type(options.enabled)=="boolean","GESTURE_OPTIONS_INVALID: enabled must be boolean")
    local accept=options.accept
    local enabled=options.enabled~=false
    local contacts:{[number]:Contact}={}
    local count=0
    local blocked=false
    local revision=0
    local mode=""
    local lastX,lastY,distance,angle=0,0,0,0
    local viewport:any=nil
    local busy=false
    local events:{any}={}
    local function emit(kind:string,phase:string,x:number,y:number,scale:number?,rotation:number?,reason:string?)
        assert(finite(x) and finite(y) and finite(x-lastX) and finite(y-lastY)
            and (scale==nil or finite(scale)) and (rotation==nil or finite(rotation)),
            "GESTURE_EVENT_INVALID: gesture arithmetic must remain finite")
        local changing=phase=="change" or (kind=="pan" and phase=="start")
        table.insert(events,table.freeze({kind=kind,phase=phase,x=x,y=y,previousX=lastX,previousY=lastY,
            deltaX=if changing then x-lastX else 0,deltaY=if changing then y-lastY else 0,
            scale=scale or 1,rotation=rotation or 0,viewport=viewport,reason=reason}))
        lastX=x;lastY=y
    end
    local function stop(phase:string,reason:string?)
        if mode~="" then emit(mode,phase,lastX,lastY,nil,nil,reason) end
        mode="";distance=0
    end
    local function invalidate(reason:string)
        stop("cancel",reason)
        for _,p in pairs(contacts) do p.eligible=false end
        blocked=count>0
    end
    local function result(consumed:boolean):any
        return table.freeze({consumed=consumed,captured=blocked or mode~="",contacts=count,events=table.freeze(events)})
    end
    local function clear(reason:string)
        stop("cancel",reason);table.clear(contacts);count=0;blocked=false
    end
    local function remove(id:number,cancelled:boolean,reason:string):boolean
        if not contacts[id] then return blocked end
        local consumed=blocked or mode~=""
        stop(if cancelled then "cancel" else "end",reason)
        contacts[id]=nil;count-=1
        if cancelled then invalidate(reason) end
        if count==0 then blocked=false end
        return consumed
    end
    local function recognize(phase:string):boolean
        if count>=2 then blocked=true end
        if count~=2 then
            if count>2 then stop("cancel","extra_pointer") end
            return blocked or mode~=""
        end
        local first,second=math.huge,math.huge
        for id in pairs(contacts) do
            if id<first then second=first;first=id elseif id<second then second=id end
        end
        local a,b=contacts[first],contacts[second]
        if not a.eligible or not b.eligible then invalidate("ineligible_pointer");return true end
        local x,y=(a.x+b.x)/2,(a.y+b.y)/2
        local dx,dy=b.x-a.x,b.y-a.y
        local magnitude=math.max(math.abs(dx),math.abs(dy))
        local nextDistance=if magnitude==0 then 0 else magnitude*math.sqrt((dx/magnitude)^2+(dy/magnitude)^2)
        assert(finite(nextDistance),"GESTURE_EVENT_INVALID: gesture distance must remain finite")
        local nextAngle=math.atan2(dy,dx)
        if mode~="transform" then
            stop("cancel","multitouch");mode="transform";lastX=x;lastY=y
            emit("transform","start",x,y)
        elseif phase=="move" then
            -- Tiny/overlapping contacts re-baseline instead of amplifying noise.
            local valid=distance>=minimum and nextDistance>=minimum
            local rotation=if valid then (nextAngle-angle+math.pi)%(2*math.pi)-math.pi else 0
            emit("transform","change",x,y,if valid then nextDistance/distance else 1,rotation)
        end
        distance=nextDistance;angle=nextAngle
        return true
    end
    local function process(event:any):any
        assert(type(event)=="table" and type(event.kind)=="string","GESTURE_EVENT_INVALID: canonical physical event required")
        if event.kind=="reset" then
            if event.scope=="all" then clear(event.reason or "reset");return result(true) end
            assert(event.scope=="pointer" and finite(event.pointer_id),"GESTURE_EVENT_INVALID: reset scope/id")
            return result(remove(event.pointer_id,true,event.reason or "reset"))
        elseif event.kind=="focus" then
            if event.focused==false then clear("focus_lost");return result(true) end
            return result(false)
        elseif event.kind=="viewport" then
            local nextViewport=copyViewport(event.viewport)
            if revision~=0 and revision~=nextViewport.revision then invalidate("viewport_changed") end
            viewport=nextViewport;revision=nextViewport.revision
            return result(blocked)
        elseif event.kind=="capture" then
            if event.captured==false then return result(remove(event.pointer_id,true,"capture_lost")) end
            return result(false)
        elseif event.kind~="pointer" or event.pointer_type~="touch" then return result(false) end
        local id,phase=event.pointer_id,event.phase
        assert(finite(id) and id>=1 and id%1==0,"GESTURE_EVENT_INVALID: positive pointer_id required")
        assert(phase=="down" or phase=="move" or phase=="up" or phase=="cancel","GESTURE_EVENT_INVALID: pointer phase")
        if phase=="cancel" then return result(remove(id,true,"pointer_cancel")) end
        local point=event.point
        if phase=="up" then
            -- Releasing a third finger starts a fresh two-finger baseline.
            local consumed=remove(id,false,"released")
            if count==2 then recognize("down") end
            return result(consumed or blocked)
        end
        assert(type(point)=="table" and finite(point.x) and finite(point.y),"GESTURE_EVENT_INVALID: finite point required")
        local nextViewport=copyViewport(point.viewport)
        if revision~=0 and revision~=nextViewport.revision then invalidate("viewport_changed") end
        viewport=nextViewport;revision=nextViewport.revision
        if phase=="down" then
            -- Validate callbacks before publishing the new contact. A failed
            -- predicate cancels the recognizer and cannot leave a half-start.
            local eligible=enabled and event.route=="game" and point.inside==true
            if eligible and accept then
                local ownedPoint=table.freeze({x=point.x,y=point.y,inside=point.inside,viewport=viewport})
                local accepted=accept(ownedPoint)
                assert(type(accepted)=="boolean","GESTURE_ACCEPT_INVALID: accept must return boolean")
                eligible=accepted
            end
            if contacts[id] then invalidate("reused_pointer") else
                assert(count<256,"GESTURE_CONTACT_LIMIT: at most 256 admitted contacts")
                count+=1
            end
            contacts[id]={x=point.x,y=point.y,startX=point.x,startY=point.y,eligible=eligible}
            if count==1 then lastX=point.x;lastY=point.y end
        else
            local contact=contacts[id]
            if not contact then return result(blocked) end
            contact.x=point.x;contact.y=point.y
        end
        if count~=1 then return result(recognize(phase)) end
        local contact=contacts[id]
        if blocked or not contact.eligible then return result(blocked) end
        if phase=="move" then
            local dx,dy=point.x-contact.startX,point.y-contact.startY
            if mode=="pan" then emit("pan","change",point.x,point.y)
            elseif dx*dx+dy*dy>=threshold*threshold then
                mode="pan";lastX=contact.startX;lastY=contact.startY;emit("pan","start",point.x,point.y)
            end
        end
        return result(mode~="")
    end
    local function mutate(callback:()->any):any
        guard();assert(not busy,"GESTURE_REENTRANT: recognizer methods cannot run inside accept")
        busy=true;events={}
        local ok,value=pcall(callback)
        busy=false
        if not ok then
            -- Invalid authored input/predicates fail explicitly and cancel any
            -- old gesture. The caller must start a fresh contact sequence.
            events={};invalidate("error");error(value,0)
        end
        return value
    end
    return table.freeze({
        process=function(event:any):any return mutate(function()return process(event)end) end,
        cancel=function():any return mutate(function()invalidate("programmatic");return result(true)end) end,
        setEnabled=function(value:boolean):any return mutate(function()
            assert(type(value)=="boolean","GESTURE_OPTIONS_INVALID: enabled must be boolean")
            if enabled~=value then enabled=value;invalidate("enabled_changed") end
            return result(blocked)
        end) end,
        status=function():any return table.freeze({enabled=enabled,contacts=count,captured=blocked or mode~=""}) end,
    })
end
local info=table.clone(metadata);info.declared=declared;table.freeze(info)
return table.freeze({info=function()return info end,create=create})
