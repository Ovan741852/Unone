use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ApiParameter {
    pub name: String,
    pub type_name: String,
    pub meaning: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiDescriptor {
    pub name: String,
    pub category: String,
    pub purpose: String,
    pub when_to_use: String,
    pub when_not_to_use: String,
    pub parameters: Vec<ApiParameter>,
    pub returns: String,
    pub side_effects: Vec<String>,
    pub frame_semantics: String,
    pub common_errors: Vec<String>,
    pub example: String,
    pub related_apis: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiSearchReport {
    pub query: String,
    pub matches: Vec<ApiDescriptor>,
}

pub fn search(query: &str) -> Vec<ApiDescriptor> {
    let normalized = query.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return descriptors();
    }
    let terms: Vec<&str> = normalized.split_whitespace().collect();
    descriptors()
        .into_iter()
        .filter(|descriptor| {
            let searchable = format!(
                "{} {} {} {}",
                descriptor.name, descriptor.category, descriptor.purpose, descriptor.when_to_use
            )
            .to_ascii_lowercase();
            terms.iter().any(|term| searchable.contains(term))
        })
        .collect()
}

pub fn describe(name: &str) -> Option<ApiDescriptor> {
    descriptors()
        .into_iter()
        .find(|descriptor| descriptor.name.eq_ignore_ascii_case(name.trim()))
}

fn descriptors() -> Vec<ApiDescriptor> {
    vec![
        descriptor(
            "entity.spawn",
            "world",
            "建立一個沒有 Sprite 的新 Entity。",
            "需要在 runtime 動態建立遊戲物件時。",
            "場景固定存在的物件；請優先放進 scene source。",
            vec![parameter(
                "name",
                "string",
                "Entity 顯示名稱與 id 的基礎名稱。",
            )],
            "string：實際建立的唯一 Entity id。",
            vec!["修改 Rust-owned world state"],
            "呼叫後立即可在同一個 script update 中使用；Entity id 會保持到 world 被重建。",
            vec!["名稱為空時使用 entity", "同名時會加上 _2、_3 等尾碼"],
            "local id = api.entity.spawn(\"enemy\")",
            vec!["entity.getPosition", "entity.setPosition"],
        ),
        descriptor(
            "entity.getPosition",
            "world",
            "讀取 Entity 的目前 2D Transform position。",
            "需要依據目前位置計算遊戲規則時。",
            "不要用它取代場景或 prefab 的 source data。",
            vec![parameter("id", "string", "已存在的 Entity id。")],
            "Vec2：包含 number 型別的 x 與 y。",
            vec!["讀取 Rust-owned world state"],
            "回傳本次 update 開始時的目前值；setPosition 後下一次讀取才反映新值。",
            vec!["Entity id 不存在會回傳 LUAU_RUNTIME_ERROR"],
            "local position = api.entity.getPosition(\"player\")",
            vec!["entity.setPosition"],
        ),
        descriptor(
            "entity.setPosition",
            "world",
            "更新 Entity 的 2D Transform position。",
            "需要由 Luau 遊戲規則移動物件時。",
            "不要在每個遊戲各自維護另一份 Transform；這會造成觀測與畫面不一致。",
            vec![
                parameter("id", "string", "已存在的 Entity id。"),
                parameter("position", "Vec2", "新的 x 與 y 座標。"),
            ],
            "()：成功時沒有額外資料。",
            vec!["修改 Rust-owned world state"],
            "更新在目前 script call 中立即生效；world frame 在 update 完成後才遞增。",
            vec![
                "Entity id 不存在會回傳 LUAU_RUNTIME_ERROR",
                "x/y 必須是 number",
            ],
            "api.entity.setPosition(\"player\", { x = 1, y = 0 })",
            vec!["entity.getPosition", "entity.spawn"],
        ),
        descriptor(
            "entity.getVelocity",
            "physics",
            "讀取 Entity 的 RigidBody2D 目前速度。",
            "需要顯示、測試或依據物理速度做遊戲規則時。",
            "沒有 RigidBody2D 的 Entity；請先在 scene 宣告 physics body。",
            vec![parameter("id", "string", "具有 RigidBody2D 的 Entity id。")],
            "Vec2：目前速度的 x 與 y。",
            vec!["讀取 Rust-owned physics state"],
            "回傳目前 physics step 完成後的速度；script update 中修改後，下一個 physics step 才會整合。",
            vec![
                "Entity id 不存在會回傳 LUAU_RUNTIME_ERROR",
                "Entity 沒有 RigidBody2D 會回傳 LUAU_RUNTIME_ERROR",
            ],
            "local velocity = api.entity.getVelocity(\"bird\")",
            vec!["entity.setVelocity", "physics.applyImpulse"],
        ),
        descriptor(
            "entity.setVelocity",
            "physics",
            "直接設定 Entity 的 RigidBody2D 速度。",
            "需要重置、限制或測試固定物理速度時。",
            "需要力的連續作用；此時用 applyImpulse 或未來的 force API。",
            vec![
                parameter("id", "string", "具有 RigidBody2D 的 Entity id。"),
                parameter("velocity", "Vec2", "新的 x 與 y 速度。"),
            ],
            "()：成功時沒有額外資料。",
            vec!["修改 Rust-owned physics state"],
            "設定在目前 script update 中立即生效，接著的固定 physics step 會依 gravity 與碰撞繼續更新。",
            vec![
                "Entity id 不存在或沒有 RigidBody2D",
                "static body 不應被當作動態物件控制",
            ],
            "api.entity.setVelocity(\"bird\", { x = 8, y = 5 })",
            vec!["entity.getVelocity", "physics.applyImpulse"],
        ),
        descriptor(
            "physics.applyImpulse",
            "physics",
            "對動態 RigidBody2D 施加一次瞬時 impulse。",
            "需要彈射、碰撞反作用或一次性改變動量時。",
            "每 frame 持續推進；請不要用 impulse 偽裝 force，避免 timestep 依賴。",
            vec![
                parameter("id", "string", "具有 dynamic RigidBody2D 的 Entity id。"),
                parameter(
                    "impulse",
                    "Vec2",
                    "以 mass-independent 動量變化表示的 x 與 y impulse。",
                ),
            ],
            "()：成功時沒有額外資料。",
            vec!["修改 Rust-owned physics velocity"],
            "在目前 script update 立即改變 velocity；gravity、位置整合與碰撞在本次 update 後的固定 physics step 執行。",
            vec![
                "Entity 不存在或沒有 RigidBody2D",
                "static body 不能施加 impulse",
            ],
            "api.physics.applyImpulse(\"bird\", { x = 12, y = 8 })",
            vec!["entity.getVelocity", "entity.setVelocity"],
        ),
        descriptor(
            "camera.getPosition",
            "camera",
            "讀取 active Camera2D 的 world position。",
            "需要依據鏡頭目前位置做 UI 或 camera-follow 判斷時。",
            "不要把 camera position 當成遊戲角色的 Transform；角色仍屬於 Entity。",
            vec![],
            "Vec2：鏡頭 world position。",
            vec!["讀取 Rust-owned camera state"],
            "回傳目前 frame 的 camera position；renderer 在下一次 draw 使用它。",
            vec![],
            "local cameraPosition = api.camera.getPosition()",
            vec!["camera.setPosition", "camera.getZoom"],
        ),
        descriptor(
            "camera.setPosition",
            "camera",
            "設定 active Camera2D 的 world position。",
            "需要讓鏡頭跟隨角色或切換關卡視野時。",
            "不要在遊戲端自行把每個 Entity 座標轉成螢幕座標；renderer 會使用 camera state。",
            vec![parameter("position", "Vec2", "新的鏡頭 world position。")],
            "()：成功時沒有額外資料。",
            vec!["修改 Rust-owned camera state"],
            "設定在目前 script update 中立即生效，下一次 renderer draw 反映新的 camera。",
            vec!["x/y 必須是 number"],
            "api.camera.setPosition({ x = 4, y = 0 })",
            vec!["camera.getPosition", "camera.setZoom"],
        ),
        descriptor(
            "camera.getZoom",
            "camera",
            "讀取 active Camera2D 的縮放倍率。",
            "需要顯示目前鏡頭縮放或做 camera UI 狀態判斷時。",
            "不要用 zoom 代替遊戲世界的單位換算；它只影響 camera projection。",
            vec![],
            "number：大於 0 的 zoom。",
            vec!["讀取 Rust-owned camera state"],
            "回傳目前 camera zoom；renderer 在下一次 draw 使用它。",
            vec!["scene 的 zoom 必須大於 0"],
            "local zoom = api.camera.getZoom()",
            vec!["camera.setZoom", "camera.getPosition"],
        ),
        descriptor(
            "camera.setZoom",
            "camera",
            "設定 active Camera2D 的縮放倍率。",
            "需要依關卡或玩法調整可視範圍時。",
            "不要傳入 0、負數或 NaN；無效值會被拒絕，避免 projection 產生不可解釋結果。",
            vec![parameter("zoom", "number", "大於 0 的縮放倍率。")],
            "()：成功時沒有額外資料。",
            vec!["修改 Rust-owned camera state"],
            "設定在目前 script update 中立即生效，下一次 renderer draw 反映新的 zoom。",
            vec!["zoom 必須是大於 0 的有限數字"],
            "api.camera.setZoom(1.25)",
            vec!["camera.getZoom", "camera.setPosition"],
        ),
        descriptor(
            "input.isDown",
            "input",
            "查詢某個 action 在目前 frame 是否按下。",
            "需要把玩家或測試輸入轉成遊戲規則時。",
            "不要在遊戲邏輯中讀平台鍵盤 key code；平台輸入應先映射成 action。",
            vec![parameter(
                "action",
                "string",
                "遊戲定義的語意 action，例如 Right。",
            )],
            "boolean：目前 action 的按下狀態。",
            vec!["讀取目前 frame 的輸入 snapshot"],
            "同一個 update 期間結果穩定；headless test 可用同名 action 注入固定輸入。",
            vec!["action 名稱不存在時視為 false"],
            "if api.input.isDown(\"Right\") then ... end",
            vec!["entity.setPosition"],
        ),
        descriptor(
            "random.nextFloat",
            "random",
            "取得由 project run seed 決定的 deterministic [0, 1) 浮點數。",
            "需要抽樣、機率判斷或可重播的遊戲隨機性時。",
            "不要用它取得真實安全隨機數，也不要把結果當成跨不同 seed 的固定值。",
            vec![],
            "number：大於等於 0 且小於 1。",
            vec!["消耗 seeded runtime random state"],
            "同一 runtime、seed 與呼叫順序會得到相同結果；改變呼叫順序會改變後續序列。",
            vec![],
            "local chance = api.random.nextFloat()",
            vec!["random.nextInt"],
        ),
        descriptor(
            "random.nextInt",
            "random",
            "取得由 project run seed 決定的 deterministic inclusive 整數。",
            "需要抽樣 index、骰子結果或可重播的整數隨機性時。",
            "不要用於安全性、金流或密碼；min 必須不大於 max。",
            vec![
                parameter("min", "integer", "可返回的最小值，包含。"),
                parameter("max", "integer", "可返回的最大值，包含。"),
            ],
            "integer：介於 min 與 max 之間，包含兩端。",
            vec!["消耗 seeded runtime random state"],
            "結果在目前 update 中立即返回；相同 seed、輸入與呼叫順序可重播。",
            vec!["min 大於 max 會回傳 LUAU_RUNTIME_ERROR"],
            "local slot = api.random.nextInt(1, 3)",
            vec!["random.nextFloat"],
        ),
        descriptor(
            "log",
            "diagnostics",
            "寫入語意化 script trace，供 AI、測試與開發紀錄觀察。",
            "需要記錄重要遊戲事件或驗證腳本分支時。",
            "不要在每個 frame 大量輸出；高頻資料應放入 observation state。",
            vec![parameter(
                "message",
                "string",
                "可供人與 AI 理解的事件描述。",
            )],
            "()：成功時沒有額外資料。",
            vec!["新增一筆 script_log trace event"],
            "事件使用呼叫當下的 world frame；run report 只保留語意 trace，不產生逐 frame 噪音。",
            vec!["過量 log 會增加觀測輸出大小"],
            "api.log(\"player_started\")",
            vec!["entity.getPosition", "input.isDown"],
        ),
    ]
}

fn parameter(name: &str, type_name: &str, meaning: &str) -> ApiParameter {
    ApiParameter {
        name: name.to_string(),
        type_name: type_name.to_string(),
        meaning: meaning.to_string(),
    }
}

#[allow(clippy::too_many_arguments)]
fn descriptor(
    name: &str,
    category: &str,
    purpose: &str,
    when_to_use: &str,
    when_not_to_use: &str,
    parameters: Vec<ApiParameter>,
    returns: &str,
    side_effects: Vec<&str>,
    frame_semantics: &str,
    common_errors: Vec<&str>,
    example: &str,
    related_apis: Vec<&str>,
) -> ApiDescriptor {
    ApiDescriptor {
        name: name.to_string(),
        category: category.to_string(),
        purpose: purpose.to_string(),
        when_to_use: when_to_use.to_string(),
        when_not_to_use: when_not_to_use.to_string(),
        parameters,
        returns: returns.to_string(),
        side_effects: side_effects.into_iter().map(str::to_string).collect(),
        frame_semantics: frame_semantics.to_string(),
        common_errors: common_errors.into_iter().map(str::to_string).collect(),
        example: example.to_string(),
        related_apis: related_apis.into_iter().map(str::to_string).collect(),
    }
}
