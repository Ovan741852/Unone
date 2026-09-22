local function publish(api)
    api.ui.setRoot({
        kind = "screen",
        id = "frame_atelier",
        node = "workbench",
        children = {
            {kind = "text", id = "project_title", text = "森林領主 · YesSir", rect = {x = 4, y = 92, width = 30, height = 5}},
            {kind = "button", id = "add_frame", text = "新增 frame", action = "AddFrame", rect = {x = 89, y = 91, width = 8, height = 5}},
            {kind = "text", id = "selected_frame", text = "F01 · 角色與裝備區", rect = {x = 35, y = 92, width = 30, height = 5}},
            {kind = "button", id = "ask_gemma", text = "Gemma 3 補全", action = "AskAssistant", rect = {x = 70, y = 6, width = 13, height = 5}},
            {kind = "button", id = "export_gdd", text = "匯出 GDD", action = "ExportGdd", rect = {x = 85, y = 6, width = 11, height = 5}},
        },
    })
end

return {
    start = function(api)
        publish(api)
        api.observation.set("screen", "frame_atelier")
        api.observation.set("selected_frame", "F01")
        api.observation.set("ui_host", "Unone UI + editor host")
    end,
    update = function(api, dt)
        -- Frame editing and text input stay in the host, as required by the
        -- current Unone UI contract. The semantic screen remains observable.
    end,
}
