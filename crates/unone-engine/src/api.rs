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
            "input.getPointerPosition",
            "input",
            "讀取平台 adapter 已轉換成 world space 的 pointer position。",
            "需要拖曳、瞄準、點擊位置或觸控位置的遊戲規則時。",
            "不要在 Luau 自行處理螢幕像素、device scale 或平台座標；那是 platform adapter 的責任。",
            vec![],
            "Vec2：目前 pointer 的 world position。",
            vec!["讀取目前 frame 的 pointer snapshot"],
            "同一個 update 期間結果穩定；headless test 可直接注入 world-space pointer。",
            vec![],
            "local pointer = api.input.getPointerPosition()",
            vec!["input.isPointerDown", "camera.getPosition"],
        ),
        descriptor(
            "input.isPointerDown",
            "input",
            "查詢目前 frame 的主要 pointer／觸控是否按下。",
            "需要判斷拖曳開始、持續瞄準或放開時機的遊戲規則時。",
            "不要把它當成特定平台的滑鼠按鍵或觸控 id；多點觸控先由 platform adapter 聚合成明確的遊戲 action。",
            vec![],
            "boolean：主要 pointer 是否按下。",
            vec!["讀取目前 frame 的 pointer snapshot"],
            "同一個 update 期間結果穩定；sequence 未提供 pointer frame 時視為放開，避免 sticky input。",
            vec![],
            "if api.input.isPointerDown() then ... end",
            vec!["input.getPointerPosition", "input.isDown"],
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
            "observation.set",
            "observation",
            "發布遊戲端目前的可序列化語意狀態，供 AI、測試與 host 觀察。",
            "需要讓對話 ViewModel、戰鬥結果、隨機結果或其他遊戲狀態可被 headless/Web/mobile 讀取時。",
            "不要把它當成第二份 gameplay state，也不要每個 frame 發布未變動的大型資產或 telemetry。",
            vec![
                parameter(
                    "key",
                    "string",
                    "非空的穩定 observation 名稱，例如 view_model。",
                ),
                parameter(
                    "value",
                    "ObservationValue",
                    "可序列化的 string、number、boolean、null、object 或 array。",
                ),
            ],
            "()：成功時沒有額外資料。",
            vec!["替換指定 key 的最新遊戲端 observation"],
            "同一個 update 內立即可更新；下一次 observe、run report 與 test assertion 會看到最新值。只保留每個 key 的最後一次發布。",
            vec![
                "key 為空會回傳 LUAU_RUNTIME_ERROR",
                "value 含 function、userdata、循環表、非有限數字或不連續 array key 會回傳 LUAU_RUNTIME_ERROR",
            ],
            "api.observation.set(\"view_model\", { screen = \"dialogue\", node = \"intro\" })",
            vec!["log", "input.isDown"],
        ),
        descriptor(
            "save.set",
            "save",
            "發布遊戲端目前的可序列化存檔 payload，供 host 保存。",
            "需要在明確的 checkpoint 保存遊戲端 schema 時。",
            "不要每個 frame 寫入，也不要把 observation 或平台檔案路徑當成 save API。",
            vec![parameter(
                "value",
                "SaveValue",
                "遊戲端定義、可序列化的 save payload；引擎不解讀其 schema。",
            )],
            "()：成功時沒有額外資料。",
            vec!["替換目前待由 host 保存的 save payload"],
            "呼叫後 host 可透過 runtime／platform adapter 讀取最新 payload；payload 跨 script reload 保留。",
            vec![
                "value 含 function、userdata、循環表、非有限數字或不連續 array key 會回傳 LUAU_RUNTIME_ERROR",
            ],
            "api.save.set({ version = 1, node = \"kind\" })",
            vec!["save.get"],
        ),
        descriptor(
            "save.get",
            "save",
            "讀取 host 已注入或遊戲端最近保存的 save payload。",
            "需要在遊戲啟動後恢復遊戲端 schema 時。",
            "不要把 save payload 當成每 frame 的 gameplay state；載入後由遊戲端決定版本與 migration。",
            vec![],
            "SaveValue 或 nil：目前沒有 payload 時回傳 nil。",
            vec!["讀取目前 save payload"],
            "同一 runtime 內立即可讀；host 可在第一次 tick 前注入 JSON payload。引擎不替遊戲執行 schema migration。",
            vec!["host payload 不是有效 JSON 時由 adapter 回報 diagnostic"],
            "local payload = api.save.get()",
            vec!["save.set"],
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
