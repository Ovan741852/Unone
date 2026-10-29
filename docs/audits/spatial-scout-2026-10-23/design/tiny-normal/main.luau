local index, ticket
return {
    start = function(api)
        index = api.spatial.create({{id=1,position={3e-23,0,0},radius=0}})
    end,
    update = function(api)
        if ticket then
            local result = api.spatial.take(ticket)
            api.observation.set("normal", result.results[1].hits[1].normal)
        end
        ticket = api.spatial.submit(index, {{kind="nearest",point={0,0,0},max_distance=1}})
    end,
}
