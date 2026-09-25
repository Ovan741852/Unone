-- 雲水鎮：可觀察的武俠 NPC sandbox。
--
-- 所有規則、角色差異、目的、建築物工作站與互動都在 Luau。
-- EXTENSIONS 是業務層的尋路／事件外掛接縫。
-- 人物意圖只接受 NanoJev，無規則 AI fallback；Unone core 不持有本遊戲規則。

local Game = {}

local NPC_DEFS = {
    {id="npc_1", name="沈長安", avatar="🌿", role="藥農", style="青囊掌", personality="耐心、觀察力強", background="祖父帶他走遍山路採藥", preferences="藥草、安靜的清晨", bio="熟悉山路與藥草，總想把採來的藥分給鎮民。", home="clinic", x=-2, z=5, martial=34, morale=68, resentment=4},
    {id="npc_2", name="蘇晚晴", avatar="🎐", role="說書人", style="流雲步", personality="外向、好奇", background="跟著商隊在各地聽故事長大", preferences="新消息、熱茶、掌聲", bio="靠故事與消息維生，最怕茶棚突然安靜。", home="market", x=-3, z=0, martial=28, morale=82, resentment=2},
    {id="npc_3", name="鐵山", avatar="🔨", role="鐵匠", style="玄鐵拳", personality="務實、固執", background="父親留下老鐵鋪與一筆未完的帳", preferences="好鐵、準時、把事情做完", bio="欠白衡一筆舊帳，仍每天把鎮上的刀劍磨亮。", home="forge", x=5, z=2, martial=71, morale=56, resentment=38},
    {id="npc_4", name="白衡", avatar="🛡", role="鏢師", style="破陣刀", personality="戒備、重承諾", background="少年時被鏢局收養，靠護送還人情", preferences="守信、好馬、清楚的路線", bio="把護送商隊看得比自己的傷更重要，與鐵山有宿怨。", home="gate", x=4, z=-4, martial=77, morale=49, resentment=67},
    {id="npc_5", name="柳如煙", avatar="🩺", role="醫女", style="回春指", personality="溫柔、果斷", background="母親是接生婆，從小在醫館幫忙", preferences="乾淨的藥櫃、平安的病人", bio="不喜歡衝突，但會為了救人走進最危險的地方。", home="clinic", x=0, z=6, martial=46, morale=73, resentment=8},
    {id="npc_6", name="顧行舟", avatar="🗡", role="遊俠", style="聽風劍", personality="自由、警覺", background="沒有戶籍，靠替村鎮解決荒野麻煩", preferences="風聲、好酒、值得一戰的對手", bio="不屬於任何門派，靠巡查荒野與處理怪物換酒錢。", home="gate", x=6, z=-4, martial=63, morale=61, resentment=22},
    {id="npc_7", name="周小滿", avatar="🍵", role="茶商", style="太息功", personality="精明、愛熱鬧", background="家裡三代都在茶馬古道做買賣", preferences="好茶、流言、熱鬧飯局", bio="把每一次吃飯都當成交換情報的機會。", home="market", x=1, z=-6, martial=19, morale=76, resentment=1},
    {id="npc_8", name="燕回", avatar="🐦", role="鏢局學徒", style="燕返", personality="好勝、直率", background="離家拜師，只想靠自己闖出名號", preferences="新招、快馬、被人看見", bio="想在正式出鏢前練成自己的第一套身法。", home="training", x=1, z=-6, martial=52, morale=58, resentment=18},
    {id="npc_9", name="麥秋", avatar="🍞", role="麵包師", style="烘火功", personality="爽朗、愛照顧人", background="從北方糧倉學會發酵與烘焙", preferences="剛出爐的麵包、早起、孩子", bio="天未亮就開始揉麵，覺得香味能讓鎮子少一點爭吵。", home="inn", x=2, z=0, martial=22, morale=74, resentment=0},
    {id="npc_10", name="江逐浪", avatar="🎣", role="漁夫", style="潮生訣", personality="沉默、耐性好", background="在河船上出生，認得每一處暗流", preferences="河風、獨處、晴天", bio="每天把第一網魚送給客棧，剩下的才拿到市集。", home="dock", x=-6, z=-6, martial=31, morale=65, resentment=6},
    {id="npc_11", name="林墨", avatar="🪵", role="木匠", style="榫卯勁", personality="專注、慢熱", background="父母都是修橋的工匠", preferences="木紋、精準、沒人打擾", bio="鎮上每扇門都經過他的手，卻很少有人知道他也會拳。", home="forge", x=5, z=2, martial=37, morale=63, resentment=3},
    {id="npc_12", name="何素衣", avatar="🧵", role="裁縫", style="穿針指", personality="細膩、挑剔", background="跟姑母學會辨認百種布料", preferences="柔軟布料、鮮明顏色、整潔", bio="替鏢師補衣，也替孩子們把過大的舊衣改成新衣。", home="market", x=-5, z=-1, martial=26, morale=71, resentment=2},
    {id="npc_13", name="程子安", avatar="📚", role="私塾先生", style="正心訣", personality="溫和、守規矩", background="曾在京城讀書，因家變回到小鎮", preferences="書本、安靜、孩子的問題", bio="把武俠故事寫進課本，讓孩子知道讀書也能改變命運。", home="school", x=-7, z=-2, martial=29, morale=69, resentment=5},
    {id="npc_14", name="葉青蘿", avatar="🌸", role="花匠", style="回春步", personality="浪漫、敏感", background="跟著母親照料一片荒地，種成花圃", preferences="花香、雨天、漂亮的庭院", bio="相信花開的地方就有人願意停下來說話。", home="herb_field", x=-7, z=5, martial=24, morale=78, resentment=1},
    {id="npc_15", name="沈月棠", avatar="⛵", role="渡船娘", style="水袖功", personality="豪爽、機靈", background="父親失蹤後接手河上的小渡船", preferences="潮汐、遠客、好天氣", bio="熟悉河上的每條水路，總能比鏢局更早收到外地消息。", home="dock", x=-6, z=-6, martial=43, morale=72, resentment=12},
    {id="npc_16", name="許觀海", avatar="🗺", role="地圖師", style="遠山劍", personality="理性、愛冒險", background="曾為軍隊測繪，厭倦戰場後歸隱", preferences="新路線、晴朗視野、精準", bio="正在畫一張能讓商隊避開怪物巢穴的鎮外地圖。", home="archive", x=3, z=6, martial=48, morale=66, resentment=9},
    {id="npc_17", name="韓小乙", avatar="📨", role="驛卒", style="追風腿", personality="勤快、嘴甜", background="全家都在驛站送信，從沒錯過一封急件", preferences="快馬、短路、別人的秘密", bio="知道每個人的信從哪裡來，卻很少把秘密說出去。", home="gate", x=6, z=-4, martial=35, morale=75, resentment=1},
    {id="npc_18", name="袁大福", avatar="🍺", role="釀酒師", style="醉八仙", personality="樂觀、健談", background="祖傳酒麴曾救過一場饑荒", preferences="新酒、下酒菜、朋友", bio="相信每個難題都該先喝一杯，再決定要不要拔刀。", home="inn", x=0, z=0, martial=39, morale=80, resentment=0},
    {id="npc_19", name="余小石", avatar="🏺", role="陶匠", style="拈花指", personality="安靜、好奇", background="從河灘泥土裡摸索出自己的窯火", preferences="泥土、圓形、慢工", bio="做碗時比任何人都專心，碗碎時卻會笑著重來。", home="market", x=-5, z=-1, martial=27, morale=67, resentment=4},
    {id="npc_20", name="田不器", avatar="🧱", role="石匠", style="搬山功", personality="可靠、寡言", background="跟著修城牆的師傅走過十座城", preferences="石頭、穩固、實用", bio="鎮門、橋墩與演武場的石階都由他維修。", home="forge", x=5, z=2, martial=56, morale=60, resentment=7},
    {id="npc_21", name="司徒樂", avatar="🎶", role="琴師", style="清音劍", personality="優雅、怕寂寞", background="出身樂坊，因一曲江湖聞名", preferences="琴弦、夜風、懂音律的人", bio="她的琴聲能讓最緊繃的鏢師放下手邊的刀。", home="inn", x=0, z=0, martial=33, morale=77, resentment=2},
    {id="npc_22", name="唐知秋", avatar="🕯", role="香燭匠", style="靜心掌", personality="虔誠、敏銳", background="在寺院長大，學會調製安神香", preferences="香氣、黃昏、安靜的祈願", bio="認得每種香火代表的心願，也能聞出不尋常的風。", home="temple", x=-7, z=-6, martial=41, morale=70, resentment=3},
    {id="npc_23", name="陸青鹽", avatar="🧂", role="鹽商", style="海潮掌", personality="精明、耐心", background="在海邊鹽田長大，後來走商入鎮", preferences="公平價格、乾燥天氣、遠行", bio="掌握鎮上最穩定的鹽路，和周小滿常為茶價爭論。", home="market", x=-5, z=-1, martial=23, morale=64, resentment=10},
    {id="npc_24", name="胡大川", avatar="🏹", role="獵戶", style="逐鹿箭", personality="寡言、警覺", background="山村獵戶世家，熟悉獸徑與陷阱", preferences="足跡、森林、好弓", bio="負責把野味送進客棧，也會追蹤靠近鎮子的怪物。", home="monster_den", x=7, z=5, martial=59, morale=62, resentment=16},
    {id="npc_25", name="白芷", avatar="🧺", role="接生婆", style="柔水功", personality="慈祥、堅定", background="三十年來替鎮上接生，認得每家人的脈象", preferences="平安、溫水、準備充分", bio="她不會武館裡的招式，卻敢獨自走進任何危急的家門。", home="clinic", x=0, z=6, martial=38, morale=79, resentment=0},
    {id="npc_26", name="趙鐵衣", avatar="🔥", role="更夫", style="夜巡刀", personality="沉著、負責", background="曾是邊軍斥候，受傷後留在鎮上", preferences="夜色、準時、沒有意外", bio="每晚敲更巡街，最先知道哪盞燈不該亮著。", home="gate", x=6, z=-4, martial=68, morale=55, resentment=28},
    {id="npc_27", name="董小紙", avatar="📜", role="造紙師", style="輕羽功", personality="細心、內向", background="家人在溪邊經營小紙坊，靠水與竹子過活", preferences="清水、白紙、低聲交談", bio="替私塾與帳房供應紙張，偶爾把廢紙折成小鳥。", home="dock", x=-6, z=-6, martial=21, morale=68, resentment=1},
    {id="npc_28", name="柳金玉", avatar="💎", role="珠寶匠", style="點星指", personality="愛美、謹慎", background="曾在王城珠寶行當學徒，帶著工具回鄉", preferences="寶石、燈光、精巧的承諾", bio="能從一堆石頭裡挑出最有故事的一顆。", home="market", x=-5, z=-1, martial=32, morale=73, resentment=6},
    {id="npc_29", name="顏蜂兒", avatar="🐝", role="養蜂人", style="蜂鳴掌", personality="活潑、膽大", background="和蜂群一起在山花間長大", preferences="花粉、甜味、晴朗午後", bio="蜂蜜供醫館與客棧使用，她也會用蜂群替鎮子示警。", home="herb_field", x=-7, z=5, martial=36, morale=81, resentment=0},
    {id="npc_30", name="容與", avatar="🧭", role="導遊", style="行雲步", personality="機敏、健談", background="曾跟商隊走遍三國，回鎮後帶人看山", preferences="日出、陌生客、好路線", bio="能把一條普通的山路說得像一場江湖冒險。", home="gate", x=6, z=-4, martial=45, morale=76, resentment=2},
    {id="npc_31", name="侯三娘", avatar="🐎", role="馬伕", style="鐵蹄功", personality="爽快、愛動物", background="從馬場長大，能聽懂馬的脾氣", preferences="好馬、刷毛、整齊的馬廄", bio="鏢局所有的馬都先經過她的手，連白衡也要聽她的。", home="stable", x=7, z=-6, martial=47, morale=72, resentment=5},
    {id="npc_32", name="花小滿", avatar="🥬", role="菜販", style="回風掌", personality="勤奮、愛聊天", background="家裡的菜園養活了半條街的人", preferences="新鮮蔬菜、早市、實在價格", bio="每天第一個到市集，總能用一把青菜換到最新消息。", home="market", x=-5, z=-1, martial=25, morale=75, resentment=1},
    {id="npc_33", name="施無咎", avatar="🪦", role="司葬人", style="慈悲指", personality="安靜、體貼", background="從小替寺院照看墓園，熟悉每個無名碑", preferences="清風、整潔、有人記得", bio="讓離去的人有一個安穩的位置，也常陪孤單的人坐一會。", home="temple", x=-7, z=-6, martial=42, morale=58, resentment=12},
    {id="npc_34", name="宋明理", avatar="🧾", role="帳房先生", style="算盤勁", personality="精準、怕亂", background="商號倒閉後帶著帳本來鎮上重新開始", preferences="整齊帳目、安靜、準時結算", bio="他能算出每家欠多少糧，也希望算出自己還能相信誰。", home="archive", x=3, z=6, martial=18, morale=57, resentment=21},
    {id="npc_35", name="望月", avatar="🔮", role="占卜師", style="觀星訣", personality="神秘、溫柔", background="跟流浪道士學會看星，也學會不說盡答案", preferences="星空、問題、安靜的火光", bio="她說命運不是答案，而是鎮民每天一起走出來的路。", home="temple", x=-7, z=-6, martial=51, morale=74, resentment=7},
    {id="npc_36", name="楊烈", avatar="🍶", role="酒商", style="火雲掌", personality="豪邁、愛面子", background="在父親的酒窖裡學會辨味，後來獨自跑商", preferences="烈酒、豪客、漂亮的輸贏", bio="總說自己不怕任何人，卻最怕客棧沒有他的座位。", home="inn", x=0, z=0, martial=44, morale=70, resentment=14},
    {id="npc_37", name="阿沅", avatar="🍳", role="小廚師", style="鍋鏟功", personality="好勝、嘴硬", background="從客棧雜役一路學到掌勺", preferences="辣椒、誇獎、新菜色", bio="想讓全鎮吃到一頓會記一輩子的飯。", home="inn", x=0, z=0, martial=29, morale=78, resentment=3},
    {id="npc_38", name="鐘九", avatar="🛎", role="守鐘人", style="鐘聲功", personality="規律、寡言", background="是寺院收養的孩子，靠鐘聲記住四季", preferences="黎明、鐘聲、守時的人", bio="每天第一個醒來，也最晚確認鎮上的燈全部熄滅。", home="temple", x=-7, z=-6, martial=35, morale=63, resentment=4},
    {id="npc_39", name="陳星河", avatar="🐉", role="武館教頭", style="龍形拳", personality="嚴格、護短", background="曾在大門派修行，回來教鎮民自保", preferences="弟子進步、公平比武、熱身", bio="他希望每個孩子學會的第一件事是保護自己，而不是逞強。", home="training", x=0, z=-6, martial=82, morale=67, resentment=18},
    {id="npc_40", name="夏知微", avatar="🧪", role="香藥師", style="迷香步", personality="冷靜、愛研究", background="跟醫師父親研究草藥與香料多年", preferences="稀有香材、實驗、安靜", bio="能調出治病的香，也能調出讓怪物暫時迷路的煙。", home="clinic", x=0, z=6, martial=54, morale=64, resentment=11},
    {id="npc_41", name="葉孤城", avatar="🏯", role="城主", style="天門劍", personality="克制、重秩序", background="繼承兩座城的舊盟約與沉重稅冊", preferences="城防、清楚帳目、安定", bio="必須在民生、城防與江湖聲望之間做出取捨。", home="manor", martial=78, morale=66, resentment=14},
    {id="npc_42", name="蘇映雪", avatar="🪶", role="副城主", style="霜河掌", personality="理性、護民", background="曾替流民整理糧冊，因公正被推舉入府", preferences="公平、糧倉、誠實", bio="不相信漂亮口號，只相信每一筆糧食真的送到誰手上。", home="manor", martial=61, morale=71, resentment=8},
    {id="npc_43", name="霍沉舟", avatar="🛡", role="城門守衛", style="鎮關刀", personality="警戒、寡言", background="在邊境哨站長大，熟悉每一種逃兵藉口", preferences="守時、城牆、可靠同伴", bio="每天檢查進出城的人，也擔心真正的危險會從內部開始。", home="gate_b", martial=73, morale=59, resentment=20},
    {id="npc_44", name="顧青蘿", avatar="🛡", role="城牆守衛", style="回風槍", personality="勇敢、敏感", background="父親死於怪潮，她把守城當成家訓", preferences="高處、弓弩、明確命令", bio="能看見遠處的煙，也看得見隊友沒有說出口的恐懼。", home="gate_b", martial=69, morale=63, resentment=31},
    {id="npc_45", name="秦不語", avatar="📜", role="斬妖公會會長", style="斷潮劍", personality="務實、老練", background="曾帶隊深入荒原，退休後建立斬妖公會", preferences="有效率的獵人、證據、賞金", bio="把怪物威脅拆成工作單，要求每份報告都寫清楚傷亡。", home="guild", martial=86, morale=61, resentment=24},
    {id="npc_46", name="洛小棠", avatar="📋", role="公會接待", style="紙上步", personality="外向、細心", background="從驛站學會登記、核對與安撫旅人", preferences="整齊名冊、熱茶、準時回報", bio="比起拔劍，她更擅長讓一群互不信任的人簽下同一份契約。", home="guild", martial=32, morale=79, resentment=3},
    {id="npc_47", name="萬里商", avatar="🐫", role="行商", style="流沙步", personality="精明、冒險", background="跟著駝隊穿越三條商路後來到青石鎮", preferences="差價、遠路、稀有貨", bio="總知道哪裡缺鹽、哪裡缺藥，也知道哪條路最近有狼。", home="caravan_gate", martial=48, morale=74, resentment=12},
    {id="npc_48", name="趙紅袖", avatar="🎒", role="行商護衛", style="護貨刀", personality="爽快、重承諾", background="曾護送一車孤兒穿過山火", preferences="好馬、清楚報酬、同伴", bio="保護貨物也保護隊伍，最討厭臨時改變約定。", home="caravan_gate", martial=75, morale=68, resentment=16},
    {id="npc_49", name="林見鹿", avatar="🗺", role="荒原斥候", style="聽風步", personality="安靜、謹慎", background="幼年迷路在荒原，靠記地形活下來", preferences="足跡、風向、獨處", bio="先看怪物留下的痕跡，再決定今天是否值得出城。", home="monster_outskirts", martial=67, morale=57, resentment=18},
    {id="npc_50", name="白鳴", avatar="⚔", role="斬妖師", style="流雲御劍", personality="好勝、正直", background="在公會底層接了七年最危險的委託", preferences="強敵、功勳、被信任", bio="想成為名震兩城的劍客，卻還沒學會每次都要活著回來。", home="monster_outskirts", martial=88, morale=72, resentment=9},
    {id="npc_51", name="唐晚舟", avatar="🩹", role="斬妖醫師", style="回春指", personality="溫柔、堅韌", background="在怪物襲擊後重建過三間臨時醫棚", preferences="乾淨繃帶、活著的病人、安靜", bio="她不問獵人為何冒險，只問誰需要先止血。", home="clinic_b", martial=55, morale=70, resentment=5},
    {id="npc_52", name="方鐵心", avatar="🔧", role="守城工匠", style="鐵壁功", personality="可靠、固執", background="跟著石匠修過北方十二座城門", preferences="厚石、鉚釘、耐用", bio="城牆裂一寸，他就睡不著一晚。", home="training_b", martial=64, morale=62, resentment=11},
    {id="npc_53", name="沈秋水", avatar="🌾", role="青石農夫", style="禾下掌", personality="耐心、節儉", background="帶著種子從旱地遷徙到青石鎮", preferences="雨水、好土、穩定價格", bio="知道一座城真正的防線不是牆，而是糧倉。", home="home_21", martial=27, morale=75, resentment=2},
    {id="npc_54", name="余小蘭", avatar="🍲", role="客舍掌櫃", style="暖鍋功", personality="爽朗、觀察力強", background="從逃難旅人手裡學會經營一間小客舍", preferences="好食材、旅人消息、整潔", bio="能從客人的筷子聲判斷城外出了什麼事。", home="inn_b", martial=36, morale=78, resentment=1},
    {id="npc_55", name="祁連", avatar="🐎", role="商隊馬夫", style="逐日腿", personality="活潑、愛動物", background="在荒漠馬場長大，跟每匹馬都有名字", preferences="快馬、長路、晴天", bio="希望有一天能帶一支商隊安全走完兩城之間的路。", home="caravan_gate", martial=51, morale=81, resentment=4},
    {id="npc_56", name="陸九歌", avatar="🎶", role="行旅樂師", style="回音劍", personality="浪漫、敏感", background="跟著商隊用琴聲換食宿", preferences="新故事、夜風、觀眾", bio="她把兩座城的衝突寫成歌，也可能因此得罪某位城主。", home="market_b", martial=39, morale=76, resentment=6},
    {id="npc_57", name="韓鐵衣", avatar="🛡", role="青石巡城使", style="巡夜刀", personality="紀律、護短", background="曾是流浪武者，因救城有功留下", preferences="巡邏、守規矩、老朋友", bio="不喜歡政治，但知道沒有巡邏的城牆只是裝飾。", home="gate_b", martial=80, morale=64, resentment=27},
    {id="npc_58", name="柳初晴", avatar="🌿", role="靈草採集師", style="青木訣", personality="好奇、謹慎", background="在荒原邊採集能治傷的靈草", preferences="稀有植物、安靜、可靠嚮導", bio="常要決定是冒險採藥，還是先把位置告訴公會。", home="clinic_b", martial=44, morale=69, resentment=7},
    {id="npc_59", name="莫問天", avatar="📦", role="倉庫管事", style="鎖倉勁", personality="精準、怕浪費", background="曾管理一支軍隊的糧秣，後來厭倦戰爭", preferences="封條、清單、足量存糧", bio="他能看出一個商人的誠信，先從少掉的那袋米開始。", home="manor", martial=42, morale=53, resentment=19},
    {id="npc_60", name="蘇小滿", avatar="🧺", role="青石商販", style="碎步掌", personality="健談、機敏", background="跟母親在兩城間擺攤長大", preferences="熱鬧、便宜貨、可靠消息", bio="知道哪個攤主漲價，也知道哪個守衛最近心情不好。", home="market_b", martial=24, morale=77, resentment=0},
    {id="npc_61", name="魏長風", avatar="🗡", role="公會老獵人", style="裂風刀", personality="沉默、堅毅", background="失去三名隊友後仍留在荒原邊", preferences="準備、老弓、清楚退路", bio="會接斬妖委託，但更在意新人能否學會撤退。", home="guild", martial=83, morale=48, resentment=42},
    {id="npc_62", name="段紅玉", avatar="🧪", role="煉丹師", style="丹火訣", personality="專注、挑剔", background="在醫館與道觀之間學會煉製療傷丹", preferences="純火、好藥材、實驗", bio="她的丹藥能讓獵人多撐一輪，失敗時也會燒掉半間廚房。", home="clinic_b", martial=58, morale=67, resentment=13},
    {id="npc_63", name="程遠山", avatar="🏹", role="城外弓手", style="落日箭", personality="警覺、獨立", background="曾替商隊護送過一千里荒路", preferences="高地、好弓、少說話", bio="不喜歡近身戰，卻能在怪物接近城門前先射中它。", home="monster_outskirts", martial=77, morale=60, resentment=23},
    {id="npc_64", name="花朝露", avatar="🌸", role="城主侍從", style="燕返", personality="細膩、忠誠", background="在城主府長大，熟悉每一條秘密通道", preferences="花園、密信、可靠承諾", bio="常在命令與良心之間替別人送信。", home="manor", martial=45, morale=65, resentment=17},
    {id="npc_65", name="鐵無雙", avatar="⚒", role="法寶鍛造師", style="玄鐵拳", personality="務實、寡言", background="從敗軍兵器中重新鍛出自己的爐火", preferences="稀有礦、準確尺寸、安靜", bio="相信一件好法寶能救命，但不相信它能替人做選擇。", home="training_b", martial=72, morale=56, resentment=29},
    {id="npc_66", name="小七", avatar="🪶", role="信使", style="追風腿", personality="勤快、樂觀", background="在兩城之間送信送到學會看雲辨路", preferences="快路、甜食、好消息", bio="城牆內外的消息都會經過他，除非路上遇到怪物。", home="caravan_gate", martial=38, morale=82, resentment=1},
    {id="npc_67", name="周寒山", avatar="⛏", role="礦工", style="沉山功", personality="耐勞、少言", background="在青石外圍礦坑挖出第一批城牆鐵料", preferences="礦脈、厚靴、固定工錢", bio="知道地底比地面更黑，也知道哪裡會塌。", home="home_35", martial=49, morale=58, resentment=15},
    {id="npc_68", name="葉知秋", avatar="📚", role="雙城學者", style="觀星訣", personality="求知、慢熱", background="整理兩座城的怪物與人口紀錄", preferences="舊卷、星圖、安靜", bio="想找出怪物潮與兩城關係變化之間的規律。", home="guild", martial=34, morale=68, resentment=4},
    {id="npc_69", name="白小刀", avatar="🗡", role="賞金獵人", style="逐影步", personality="冒險、現實", background="靠追捕逃犯與怪物賺錢，從不白做事", preferences="高賞金、清楚目標、獨行", bio="他會接公會工作，但也會衡量活著回來值不值得。", home="monster_outskirts", martial=71, morale=55, resentment=21},
    {id="npc_70", name="秦月河", avatar="🩺", role="戰地護理", style="柔水功", personality="慈悲、果斷", background="在城門下照顧過一整夜的傷兵", preferences="繃帶、乾淨水、少流血", bio="她希望公會的第一份工作永遠是救援，而不是報仇。", home="clinic_b", martial=52, morale=73, resentment=10},
    {id="npc_71", name="韓秋實", avatar="🌾", role="糧商", style="厚土掌", personality="精明、保守", background="從饑荒裡活下來，靠囤糧建立商隊", preferences="存糧、契約、穩定利潤", bio="善於讓兩座城都有飯吃，也可能因為價格與城主爭吵。", home="market_b", martial=31, morale=62, resentment=18},
    {id="npc_72", name="羅青鸞", avatar="🦅", role="城牆瞭望", style="凌空步", personality="敏銳、孤傲", background="曾在山巔放哨三年，幾乎不錯過天上的異象", preferences="高處、遠望、清風", bio="第一個看見怪物潮，也最不喜歡別人質疑她的眼睛。", home="gate_b", martial=63, morale=61, resentment=33},
    {id="npc_73", name="謝無塵", avatar="🎓", role="公會學徒", style="基礎劍", personality="努力、緊張", background="為了替家人還債加入公會", preferences="明確指示、師父、平安", bio="想接第一份斬妖工作，卻還沒決定自己敢不敢殺怪。", home="guild", martial=41, morale=64, resentment=7},
    {id="npc_74", name="顏如玉", avatar="💰", role="錢莊掌櫃", style="金線指", personality="謹慎、善談", background="在亂世裡替商人保管過三代家產", preferences="信用、利息、準時還款", bio="不拔劍，但能讓一場冒險因缺錢而提前結束。", home="market_b", martial=29, morale=69, resentment=12},
    {id="npc_75", name="石敢當", avatar="🧱", role="城牆石匠", style="搬山功", personality="可靠、豪爽", background="家族世代修築關城，手上全是石灰疤", preferences="結實城磚、熱酒、同伴", bio="願意替任何人修牆，前提是別把城門打壞。", home="training_b", martial=60, morale=71, resentment=6},
    {id="npc_76", name="柳含煙", avatar="🌙", role="夜巡守衛", style="月影刀", personality="冷靜、敏感", background="曾在夜襲中救出整條街的孩子", preferences="月色、安靜、守望", bio="夜裡的城比白天誠實，腳步聲會告訴她誰在說謊。", home="gate_b", martial=74, morale=58, resentment=25},
    {id="npc_77", name="楚天闊", avatar="🛒", role="遠方行商", style="萬里步", personality="開朗、投機", background="帶著一車異國貨物來到雙城", preferences="新市場、稀奇貨、快成交", bio="想把兩座城變成自己的長期商路，而不是一次性賭局。", home="caravan_gate", martial=43, morale=80, resentment=2},
    {id="npc_78", name="沈照影", avatar="🕯", role="墓園守人", style="靜心掌", personality="安靜、記性好", background="替荒原死者立過許多無名碑", preferences="整潔、名字、黃昏", bio="她記得每一個沒有回城的人，偶爾也會替活人傳話。", home="home_38", martial=40, morale=54, resentment=20},
    {id="npc_79", name="段飛星", avatar="⚡", role="飛劍教習", style="流星劍", personality="自信、好勝", background="年輕時曾在宗門比武中成名", preferences="快劍、弟子、漂亮勝利", bio="相信雙城的下一代應該先學會控制劍，再學會追求名聲。", home="training_b", martial=90, morale=74, resentment=16},
    {id="npc_80", name="許青禾", avatar="🌱", role="青石藥農", style="青木長生訣", personality="溫和、堅定", background="和家人一起在城外種出第一片藥田", preferences="藥草、雨聲、平安回家", bio="希望斬妖師每次出城都能帶著藥回來，而不是只帶回故事。", home="clinic_b", martial=46, morale=77, resentment=3}
}

-- Authored identity is stable data, not action-scoring logic. Both inspector and model use it.
local Persona = {}
Persona.axes = {
    {id="sociability",name="外向",low="獨處",high="社交"},
    {id="empathy",name="共情",low="自身優先",high="體諒他人"},
    {id="discipline",name="自律",low="隨性",high="有條理"},
    {id="risk",name="冒險",low="謹慎",high="敢冒險"},
    {id="sensitivity",name="敏感",low="沉穩",high="容易受觸動"},
    {id="possessiveness",name="佔有",low="尊重空間",high="渴望獨佔"}
}
Persona.defs = {
    {values="救人 > 安穩 > 財富",red_line="不拿假藥換錢",love_style="先相處再承諾，用照顧代替甜言",love_boundary="願意專一，不替伴侶決定人生",tension="想幫所有人，卻怕家中斷糧",traits={28,88,82,35,48,22}},
    {values="真相 > 新鮮感 > 名聲",red_line="不拿朋友的傷痛換掌聲",love_style="被有故事的人吸引，需要對話與新鮮感",love_boundary="接受慢慢確認關係，不接受控制交友",tension="想守住秘密，又捨不得一段好故事",traits={93,64,39,75,61,28}},
    {values="手藝 > 還清人情 > 舒適",red_line="不賣會害人的劣刃",love_style="以共同過日子為先，承諾少但看得重",love_boundary="願意長久相守，討厭拿舊錯羞辱人",tension="想還債，卻不肯低頭向白衡認錯",traits={25,48,91,38,54,56}},
    {values="守約 > 名譽 > 性命",red_line="不背棄託付自己的人",love_style="很慢才信任，認定後希望彼此專一",love_boundary="不能容忍欺騙，會要求把曖昧說清楚",tension="自稱公正，遇到舊仇卻容易偏心",traits={30,45,90,66,64,76}},
    {values="生命 > 公平 > 利益",red_line="不因貧窮拒絕急救",love_style="欣賞善良又獨立的人，感情要互相照顧",love_boundary="願意成家，但不為伴侶放棄行醫",tension="懂得勸人休息，卻總透支自己",traits={57,96,83,62,53,18}},
    {values="自由 > 義氣 > 規矩",red_line="不替強者欺負弱者",love_style="容易心動，長期承諾前會猶豫",love_boundary="不願被婚姻綁住行程，也不假裝已承諾",tension="渴望有人等他，又怕失去遠行自由",traits={53,57,32,94,42,15}},
    {values="人脈 > 利潤 > 體面",red_line="不砸掉長久合作的信用",love_style="重視聊得來，也希望能一起經營生活",love_boundary="願意共同理財，但不能私動對方錢袋",tension="把交情當生意時，常忘了對方會受傷",traits={91,51,68,57,39,45}},
    {values="成名 > 自立 > 安穩",red_line="不靠出賣師友上位",love_style="直接示好，渴望被欣賞與鼓勵",love_boundary="認定後想專一，但不能接受當眾貶低",tension="想證明成熟，受冷落卻容易衝動",traits={78,48,55,92,85,67}},
    {values="家人 > 分享 > 賺錢",red_line="不讓飢餓的人受羞辱",love_style="喜歡踏實陪伴，以日常分擔確認感情",love_boundary="想有穩定的家，不接受把照顧當義務",tension="總說沒關係，其實也想被人照顧",traits={83,91,78,31,52,34}},
    {values="自在 > 守信 > 熱鬧",red_line="不偷走別人的生計",love_style="慢熱而專一，喜歡能一起安靜的人",love_boundary="親密不必時刻相伴，仍需獨處",tension="不善表達需要，容易讓關心他的人誤會",traits={12,62,74,47,38,25}},
    {values="把事做好 > 可靠 > 認同",red_line="不把危險的活交給別人承擔",love_style="用修繕與陪伴示愛，不擅長主動表白",love_boundary="希望長久互信，不願被逼著即刻表態",tension="盼人懂他，卻習慣把話藏在心裡",traits={16,69,96,23,56,31}},
    {values="尊嚴 > 品質 > 討好",red_line="不為迎合別人羞辱自己",love_style="欣賞用心的細節，對敷衍十分敏感",love_boundary="願意專一，但感情不能只靠昂貴禮物",tension="想被溫柔對待，說出口的話卻常挑剔",traits={46,63,88,33,83,58}},
    {values="公正 > 教養 > 情面",red_line="不為熟人更改是非",love_style="重視共同信念，先建立尊重再談婚事",love_boundary="偏好穩定承諾，不接受以愛要求徇私",tension="相信規矩護人，也怕規矩誤了急難",traits={43,79,92,22,44,32}},
    {values="真心 > 美感 > 安全",red_line="不拿感情做交換",love_style="憧憬浪漫，需要細膩回應與情感交流",love_boundary="希望彼此專一，冷處理會讓她退縮",tension="渴望靠近，又把一點沉默當作拒絕",traits={51,84,54,44,94,63}},
    {values="自主 > 家人 > 富足",red_line="不把同行的人丟在險處",love_style="喜歡坦率的夥伴，願與對方一起冒險",love_boundary="可以成家，不能替她安排人生",tension="看似不怕離別，其實很怕人不告而別",traits={85,67,62,83,66,39}},
    {values="求知 > 避免傷亡 > 服從",red_line="不為戰功畫出害人的捷徑",love_style="先成為知己，需要能討論分歧的人",love_boundary="重視誠實協商，不用查行蹤證明愛",tension="想探盡未知，卻總想先算清風險",traits={38,66,89,72,37,12}},
    {values="守信 > 機會 > 安逸",red_line="不拆信換取利益",love_style="喜歡輕快的互動，常用玩笑試探好感",love_boundary="願意確認關係，但不能逼他洩露秘密",tension="嘴上什麼都能聊，真正心事反而難說",traits={90,60,73,69,49,36}},
    {values="朋友 > 和氣 > 錢財",red_line="不趁人失意佔便宜",love_style="重視熱鬧中的陪伴，盼能坦白分享煩惱",love_boundary="願意成家，也尊重彼此原有朋友",tension="習慣用笑話化解，偶爾逃避真正衝突",traits={95,80,46,53,31,24}},
    {values="創作 > 好奇 > 效率",red_line="不偷別人的心血冒名",love_style="慢慢熟悉才動心，喜歡一起做小事",love_boundary="不急婚嫁，期待能保留各自的興趣",tension="不怕作品失敗，卻怕自己的心意被笑",traits={24,73,67,58,65,17}},
    {values="責任 > 安全 > 名氣",red_line="不為省工留下隱患",love_style="看重能共度難關的人，願意長久照應",love_boundary="承諾要做得到，不接受反覆失約",tension="習慣替人扛事，不會承認自己也疲倦",traits={18,72,95,29,33,41}},
    {values="被理解 > 創作 > 財富",red_line="不以親密換取施捨",love_style="渴望知音與頻繁陪伴，容易被共鳴打動",love_boundary="想要明確承諾，不願當誰的秘密",tension="怕寂寞而靠近，卻怕對方只愛她的名聲",traits={67,78,61,49,90,72}},
    {values="心安 > 慈悲 > 欲望",red_line="不利用恐懼騙取香火錢",love_style="緩慢建立信任，把陪伴視為長久修行",love_boundary="尊重彼此信念，不用犧牲證明愛",tension="勸人放下執念，自己的遺憾卻難放下",traits={29,86,84,25,70,21}},
    {values="公平 > 盈利 > 排場",red_line="不在災時囤積救命物資",love_style="欣賞說到做到的人，婚前想談清錢與責任",love_boundary="願意共擔風險，不替隱瞞的債務買單",tension="重公平，也會把情分算得太清楚",traits={62,56,87,42,34,44}},
    {values="生存 > 家人 > 規矩",red_line="不留下受傷的同伴",love_style="信任靠行動累積，親近後保護欲強",love_boundary="重視專一，仍需尊重對方不受保護的選擇",tension="想護住在乎的人，有時卻把關心變成戒備",traits={15,59,80,86,62,74}},
    {values="平安 > 尊重 > 習俗",red_line="不讓弱者替他人的決定受苦",love_style="把相伴看得比熱烈重要，重視平等照應",love_boundary="成家不能以一人忍讓維持",tension="替所有人作主慣了，偶爾忘記先問意願",traits={68,97,93,54,43,26}},
    {values="盡責 > 安全 > 舒適",red_line="不因私情放任傷人者",love_style="感情含蓄，盼對方理解他的不規律作息",love_boundary="承諾專一，也希望彼此能說實話",tension="想卸下戒心，過去的戰事卻總提醒他防備",traits={21,64,94,65,71,59}},
    {values="安寧 > 用心 > 出名",red_line="不替人偽造害人的書信",love_style="從熟悉的陪伴開始，喜歡耐心傾聽的人",love_boundary="不接受催促表態或當眾逼問感情",tension="怕打擾別人，連拒絕也說得太輕",traits={10,82,89,18,81,20}},
    {values="真誠 > 美好生活 > 炫耀",red_line="不以假貨騙取承諾",love_style="重視儀式與用心，會觀察承諾是否兌現",love_boundary="想要專一，禮物不能抵銷欺瞞",tension="說看重真心，又會在意別人怎麼看這段感情",traits={48,58,85,30,73,62}},
    {values="探索 > 快樂 > 安穩",red_line="不把無辜者當冒險的代價",love_style="主動而熱烈，喜歡能一起嘗試的人",love_boundary="喜歡不等於佔有，不接受禁止交友",tension="總想往前衝，常忘了同伴的害怕",traits={96,65,41,97,57,13}},
    {values="見識 > 自由 > 歸屬",red_line="不把客人帶入明知的危險",love_style="欣賞開放與幽默，對異地相伴也有期待",love_boundary="不輕許婚事，但說好的安排會認真守",tension="認識很多人，卻不確定誰願意真正留下",traits={92,68,58,81,50,19}},
    {values="照顧弱小 > 直率 > 體面",red_line="不容忍虐待依靠自己的人或動物",love_style="喜歡敢直說的夥伴，愛要落在行動上",love_boundary="可以爭執，不能用威脅要求服從",tension="想護短，卻也知道自己人可能做錯事",traits={84,88,79,68,46,37}},
    {values="勤勞 > 鄰里 > 排場",red_line="不缺斤短兩騙熟客",love_style="偏好踏實過日子，希望能分擔家務生計",love_boundary="願意一起存錢，不接受只索取不付出",tension="喜歡替人張羅，有時管得超過了界線",traits={87,76,86,34,47,49}},
    {values="尊嚴 > 陪伴 > 名利",red_line="不利用死亡勒索家屬",love_style="珍惜有限的相處，不強留想離開的人",love_boundary="可以相伴不婚，必須尊重對方選擇",tension="懂得安慰離別，輪到自己卻不敢靠近",traits={19,94,76,27,82,9}},
    {values="安全感 > 誠實 > 利潤",red_line="不替人做假帳害同伴",love_style="先建立可靠的生活，再考慮長期承諾",love_boundary="錢與債要透明，但不能以理財控制伴侶",tension="想重新信任人，卻忍不住反覆核對",traits={23,44,98,12,88,69}},
    {values="選擇自由 > 慈悲 > 確定答案",red_line="不借命運之名替人做決定",love_style="相信相遇也尊重分離，喜歡能問真問題的人",love_boundary="承諾出於自願，不用預言綁住對方",tension="常看懂旁人，卻不願說破自己的期待",traits={45,90,51,56,77,8}},
    {values="體面 > 義氣 > 節省",red_line="不出賣曾救過自己的朋友",love_style="示愛大方，希望被公開重視",love_boundary="期待專一，當眾被比較時容易受傷",tension="寧願花錢撐場面，也不肯承認怕被冷落",traits={94,42,28,87,89,88}},
    {values="被肯定 > 手藝 > 安逸",red_line="不在別人的飯菜裡動手腳",love_style="用做菜表達喜歡，嘴硬卻在意回應",love_boundary="想要互相欣賞，不接受用比較來激將",tension="想坦率示好，一緊張就把話說成挑釁",traits={65,61,73,64,86,65}},
    {values="守時 > 心安 > 變化",red_line="不因私事誤了全鎮的時辰",love_style="慢熱，喜歡穩定的小約定",love_boundary="願意長期陪伴，但需要提前商量變動",tension="規律帶來安心，突如其來的好意也會讓他不安",traits={13,70,99,10,68,33}},
    {values="保護弟子 > 公平 > 聲望",red_line="不以武力欺凌沒有還手之力的人",love_style="欣賞有主見的人，照顧常比表達多",love_boundary="看重長久承諾，不能把伴侶當弟子管教",tension="要求公正，遇到弟子受委屈卻容易護短",traits={54,75,96,73,58,52}},
    {values="求知 > 不傷人 > 名聲",red_line="不拿不知情的人試藥",love_style="先從共同興趣靠近，喜歡尊重專注的人",love_boundary="不急婚嫁，需要研究與獨處的時間",tension="相信證據，有時低估感受也需要被聽見",traits={22,55,91,67,35,11}}
}
function Persona.create(index)
    local def=Persona.defs[((index-1)%#Persona.defs)+1]
    local traits={}
    for i,axis in ipairs(Persona.axes) do
        table.insert(traits,{id=axis.id,name=axis.name,low=axis.low,high=axis.high,value=def.traits[i]})
    end
    return {profile_id=index,values=def.values,red_line=def.red_line,love_style=def.love_style,love_boundary=def.love_boundary,tension=def.tension,traits=traits}
end
function Persona.describe(identity)
    local traits={}
    for _,t in ipairs(identity.traits) do table.insert(traits,t.id.."="..t.value) end
    return "Values (priority): "..identity.values..". Moral boundary: "..identity.red_line
        ..". Love: "..identity.love_style..". Relationship boundary: "..identity.love_boundary
        ..". Inner conflict: "..identity.tension..". Stable traits 0-100 (higher=more): "..table.concat(traits,",")..". "
end

function Persona.trait(npc, id)
    for _,trait in ipairs(npc.identity and npc.identity.traits or {}) do
        if trait.id==id then return math.max(0,math.min(100,trait.value)) end
    end
    return 50
end

-- NanoJev receives an English-only semantic projection; authored Chinese lore remains UI-only.
local MODEL_ROLE={
    ["藥農"]="herbalist",["說書人"]="storyteller",["鐵匠"]="blacksmith",["鏢師"]="escort_guard",
    ["醫女"]="healer",["遊俠"]="wandering_swordsman",["茶商"]="tea_merchant",["鏢局學徒"]="escort_apprentice",
    ["麵包師"]="baker",["漁夫"]="fisher",["木匠"]="carpenter",["裁縫"]="tailor",
    ["私塾先生"]="school_teacher",["花匠"]="gardener",["渡船娘"]="ferryperson",["地圖師"]="cartographer",
    ["驛卒"]="courier",["釀酒師"]="brewer",["陶匠"]="potter",["石匠"]="stonemason",
    ["琴師"]="musician",["香燭匠"]="candle_maker",["鹽商"]="salt_merchant",["獵戶"]="hunter",
    ["接生婆"]="midwife",["更夫"]="night_watch",["造紙師"]="papermaker",["珠寶匠"]="jeweler",
    ["養蜂人"]="beekeeper",["導遊"]="guide",["馬伕"]="stable_hand",["菜販"]="vegetable_vendor",
    ["司葬人"]="undertaker",["帳房先生"]="accountant",["占卜師"]="fortune_teller",["酒商"]="wine_merchant",
    ["小廚師"]="cook",["守鐘人"]="bell_keeper",["武館教頭"]="martial_arts_instructor",["香藥師"]="incense_apothecary",
    ["城主"]="city_lord",["副城主"]="deputy_lord",["城門守衛"]="gate_guard",["城牆守衛"]="wall_guard",
    ["斬妖公會會長"]="guild_master",["公會接待"]="guild_receptionist",["行商"]="caravan_trader",["行商護衛"]="caravan_guard",
    ["荒原斥候"]="wilderness_scout",["斬妖師"]="monster_hunter",["斬妖醫師"]="battlefield_healer",["守城工匠"]="fortification_worker",
    ["青石農夫"]="farmer",["客舍掌櫃"]="innkeeper",["商隊馬夫"]="caravan_hand",["行旅樂師"]="traveling_musician",
    ["青石巡城使"]="city_patrol",["靈草採集師"]="herb_gatherer",["倉庫管事"]="warehouse_keeper",["青石商販"]="merchant",
    ["公會老獵人"]="veteran_hunter",["煉丹師"]="alchemist",["城外弓手"]="ranger",["城主侍從"]="court_attendant",
    ["法寶鍛造師"]="artifact_smith",["信使"]="messenger",["礦工"]="miner",["雙城學者"]="chronicler",
    ["賞金獵人"]="bounty_hunter",["戰地護理"]="field_medic",["糧商"]="grain_merchant",["城牆瞭望"]="lookout",
    ["公會學徒"]="guild_apprentice",["錢莊掌櫃"]="moneylender",["城牆石匠"]="wall_mason",["夜巡守衛"]="night_guard",
    ["遠方行商"]="long_distance_trader",["墓園守人"]="cemetery_keeper",["飛劍教習"]="flying_sword_teacher",["青石藥農"]="herbalist"
}
local MODEL_PHASE={["清晨"]="dawn",["白晝"]="day",["黃昏"]="dusk",["夜晚"]="night"}
local function modelRole(npc) return MODEL_ROLE[npc.role] or "resident" end
local function modelPersona(npc)
    local identity=npc.identity
    local empathy=Persona.trait(npc,"empathy")
    local discipline=Persona.trait(npc,"discipline")
    local risk=Persona.trait(npc,"risk")
    local sensitivity=Persona.trait(npc,"sensitivity")
    local possessiveness=Persona.trait(npc,"possessiveness")
    local sociability=Persona.trait(npc,"sociability")
    local moral=empathy>=75 and "protective and harm-averse" or risk>=75 and empathy<50 and "self-directed and opportunistic" or discipline>=75 and "duty-bound and consistent" or "pragmatic and situational"
    local love=possessiveness>=70 and "exclusive and reassurance-seeking" or sociability>=70 and "social and expressive" or sociability<30 and "private and slow to trust" or "steady and selective"
    local conflict=sensitivity>=75 and risk>=65 and "reactive under pressure" or sensitivity>=75 and "emotionally sensitive" or discipline>=80 and "controlled and persistent" or "adaptive under pressure"
    return string.format("Character profile=%02d; moral tendency=%s; relationship tendency=%s; conflict style=%s; stable traits 0-100: sociability=%d,empathy=%d,discipline=%d,risk=%d,sensitivity=%d,possessiveness=%d.",
        identity.profile_id or 0,moral,love,conflict,sociability,empathy,discipline,risk,sensitivity,possessiveness)
end

-- Bounded authored game reactions, not model reasons or intention selectors.
function Persona.react(npc, event, changes)
    if not npc.alive then return end
    local events={social="交流",cooperate="合作",paid_work="領到工錢",robbed="遭竊",hit="受擊",attacked="遭到攻擊",retaliated="反擊",combat_finished="交鋒結束",friend_killed="友人被殺",hunt="狩獵受傷",partner_flirt="目擊伴侶示好"}
    local stats={loneliness="孤獨",morale="士氣",fear="恐懼",jealousy="嫉妒"}
    local reaction={event=event,effects={},text="遊戲規則反應："..events[event],code=event}
    for _,change in ipairs(changes) do
        local trait,stat,base,inverse=change[1],change[2],change[3],change[4]
        local value=Persona.trait(npc,trait)
        local factor=inverse and (1.5-value/100) or (.5+value/100)
        local before=npc[stat]
        npc[stat]=math.max(0,math.min(100,before+base*factor))
        local delta=npc[stat]-before
        table.insert(reaction.effects,{trait=trait,value=value,stat=stat,delta=delta})
        local name=trait
        for _,axis in ipairs(Persona.axes) do if axis.id==trait then name=axis.name; break end end
        reaction.text..=string.format("；%s %.0f → %s %+.2f",name,value,stats[stat],delta)
        reaction.code..=string.format(" %s=%g:%s%+.2f",trait,value,stat,delta)
    end
    npc.lastPersonalityReaction=reaction
end

local TOWNS = {
    {id="yunshui",name="雲水鎮",center={x=-34,z=0},wall="雲水城牆"},
    {id="qingshi",name="青石鎮",center={x=34,z=0},wall="青石城牆"}
}
local MONSTER_DEFS = {
    {id="monster_0",name="荒原狼",x=-4,z=-46,hp=42,damage=5,reward=18,threat=7},
    {id="monster_1",name="赤眼猿",x=4,z=-42,hp=50,damage=6,reward=22,threat=8},
    {id="monster_2",name="黑甲蛛",x=-8,z=45,hp=58,damage=7,reward=26,threat=9},
    {id="monster_3",name="裂岩獸",x=8,z=45,hp=76,damage=9,reward=34,threat=12},
    {id="monster_4",name="山魈",x=-66,z=44,hp=48,damage=6,reward=20,threat=8},
    {id="monster_5",name="夜行狐妖",x=66,z=-44,hp=64,damage=8,reward=30,threat=10},
    {id="monster_6",name="鐵背熊",x=-4,z=50,hp=92,damage=11,reward=42,threat=15},
    {id="monster_7",name="風刃狼王",x=4,z=-50,hp=110,damage=13,reward=58,threat=20}
}
local RARE_TREASURE_DEFS = {
    {name="九霄劍胚",kind="法寶胚胎",description="可讓持有者的飛劍威力大幅提升",x=-76,z=0,power=24},
    {name="太古龍血玉",kind="稀世靈材",description="能提升修為，也可能引來貪婪與衝突",x=76,z=0,power=18},
    {name="星隕神鐵",kind="煉器材料",description="煉製法寶的罕見材料，價值遠超日用品",x=0,z=-60,power=20},
    {name="青冥古卷",kind="失傳功法",description="記載失傳的御劍心法，適合求知與修仙者",x=0,z=60,power=16}
}
local BUILDINGS = {
    {id="market_gate",zone="market",name="雲水市集",icon="🏮",purpose="交易、說書、接委託",x=-42,z=-12,access={x=-21,z=-6},model="stall-red",scale=2.8,clearanceX=2.8,clearanceZ=2.4},
    {id="gate",zone="gate",name="雲水北境關口",icon="🛡",purpose="護送、出入、接鏢",x=-34,z=-29,access={x=-17,z=-12},model="house-3",scale=0.9,clearanceX=3.3,clearanceZ=3.3},
    {id="forge",zone="forge",name="玄鐵鋪",icon="🔨",purpose="鍛造、修理、工作",x=-8,z=-12,access={x=-4,z=-6},model="house-1",scale=1,clearanceX=3.3,clearanceZ=3.3},
    {id="clinic",zone="clinic",name="回春醫館",icon="🩺",purpose="治療、採藥、行醫",x=-60,z=8,access={x=-30,z=4},model="house-0",scale=1,clearanceX=3.3,clearanceZ=3.3},
    {id="training_yard",zone="training",name="雲水演武場",icon="⚔",purpose="練武、比武、提升武學",x=-20,z=14,access={x=-10,z=7},model="banner-red",scale=2,clearanceX=0,clearanceZ=0},
    {id="inn",zone="inn",name="聽雨客棧",icon="🍜",purpose="吃飯、休息、交談",x=0,z=-20,access={x=0,z=-10},model="house-2",scale=1.25,clearanceX=4.1,clearanceZ=4.1},
    {id="herb_field",zone="herb_field",name="青篁藥田",icon="🌿",purpose="採集藥草與食材",x=-55,z=25,access={x=-28,z=13},model="cart",scale=2,clearanceX=1.4,clearanceZ=1.6},
    {id="monster_den",zone="monster_den",name="黑風窟",icon="👹",purpose="怪物出沒、巡查、狩獵",x=-2,z=26,access={x=-1,z=13},model="rock-large",scale=3,clearanceX=3,clearanceZ=3},
    {id="school",zone="school",name="松風私塾",icon="📚",purpose="教學、讀書、培養下一代",x=-42,z=13,access={x=-21,z=7},model="house-1",scale=1,clearanceX=3.3,clearanceZ=3.3},
    {id="temple",zone="temple",name="照夜寺",icon="🕯",purpose="祈願、守鐘、安置亡者",x=-66,z=-29,access={x=-33,z=-15},model="house-3",scale=1.15,clearanceX=3.7,clearanceZ=3.7},
    {id="stable",zone="stable",name="青鬃馬廄",icon="🐎",purpose="養馬、出行、鏢隊整備",x=-9,z=-27,access={x=-5,z=-14},model="house-1",scale=1,clearanceX=3.3,clearanceZ=3.3},
    {id="archive",zone="archive",name="鎮史庫",icon="📜",purpose="地圖、帳冊、信件與記錄",x=-42,z=-27,access={x=-21,z=-14},model="house-2",scale=0.85,clearanceX=2.9,clearanceZ=2.9},
    {id="dock",zone="dock",name="渡口紙坊",icon="⛵",purpose="渡河、漁撈、造紙與水運",x=-68,z=23,access={x=-34,z=12},model="house-1",scale=0.8,clearanceX=2.7,clearanceZ=2.7},
    {id="manor",zone="manor",name="青石城主府",icon="🏯",purpose="城主議事、稅收、城鎮治理",x=20,z=-28,access={x=10,z=-14},model="house-3",scale=1.15,clearanceX=3.7,clearanceZ=3.7},
    {id="guild",zone="guild",name="斬妖公會",icon="⚔",purpose="發布斬妖委託、登記功勳、領取賞金",x=20,z=15,access={x=10,z=7},model="house-2",scale=1.1,clearanceX=3.5,clearanceZ=3.5},
    {id="wall_gate_b",zone="gate_b",name="青石南城門",icon="🛡",purpose="守衛、出入、巡查城牆",x=34,z=-29,access={x=17,z=-12},model="house-3",scale=0.9,clearanceX=3.3,clearanceZ=3.3},
    {id="market_b",zone="market_b",name="青石商街",icon="🧺",purpose="行商、交易、交換貨物",x=42,z=-13,access={x=21,z=-6},model="stall-green",scale=2.8,clearanceX=2.8,clearanceZ=2.4},
    {id="caravan_gate",zone="caravan_gate",name="遠行商隊驛站",icon="🐎",purpose="行商集結、護送、補給",x=63,z=17,access={x=32,z=9},model="house-1",scale=0.9,clearanceX=3.1,clearanceZ=3.1},
    {id="training_b",zone="training_b",name="青石校武台",icon="⚡",purpose="守衛訓練、飛劍比試",x=14,z=-14,access={x=7,z=-7},model="banner-green",scale=2,clearanceX=0,clearanceZ=0},
    {id="clinic_b",zone="clinic_b",name="青石藥廬",icon="🩺",purpose="治療斬妖傷勢、煉丹",x=60,z=10,access={x=30,z=6},model="house-0",scale=1,clearanceX=3.3,clearanceZ=3.3},
    {id="inn_b",zone="inn_b",name="落霞客舍",icon="🍜",purpose="吃飯、休息、旅人住宿",x=4,z=-20,access={x=2,z=-10},model="house-2",scale=1.25,clearanceX=4.1,clearanceZ=4.1},
    {id="monster_outskirts",zone="monster_outskirts",name="荒原斬妖哨",icon="👹",purpose="城外怪物、斬妖任務出發點",x=12,z=30,access={x=6,z=15},model="rock-large",scale=3,clearanceX=3,clearanceZ=3}
}
local HOMES = {
    {id="home_1",name="雲水民居 1",x=-54,z=-21,clearanceX=2.7,clearanceZ=2.7,access={x=-27,z=-8}},
    {id="home_2",name="雲水民居 2",x=-44,z=-21,clearanceX=2.7,clearanceZ=2.7,access={x=-22,z=-8}},
    {id="home_3",name="雲水民居 3",x=-34,z=-21,clearanceX=2.7,clearanceZ=2.7,access={x=-17,z=-8}},
    {id="home_4",name="雲水民居 4",x=-24,z=-21,clearanceX=2.7,clearanceZ=2.7,access={x=-12,z=-8}},
    {id="home_5",name="雲水民居 5",x=-14,z=-21,clearanceX=2.7,clearanceZ=2.7,access={x=-7,z=-8}},
    {id="home_6",name="雲水民居 6",x=-54,z=-7,clearanceX=2.7,clearanceZ=2.7,access={x=-27,z=-1}},
    {id="home_7",name="雲水民居 7",x=-44,z=-7,clearanceX=2.7,clearanceZ=2.7,access={x=-22,z=-1}},
    {id="home_8",name="雲水民居 8",x=-34,z=-7,clearanceX=2.7,clearanceZ=2.7,access={x=-17,z=-1}},
    {id="home_9",name="雲水民居 9",x=-24,z=-7,clearanceX=2.7,clearanceZ=2.7,access={x=-12,z=-1}},
    {id="home_10",name="雲水民居 10",x=-14,z=-7,clearanceX=2.7,clearanceZ=2.7,access={x=-7,z=-1}},
    {id="home_11",name="雲水民居 11",x=-54,z=7,clearanceX=2.7,clearanceZ=2.7,access={x=-27,z=2}},
    {id="home_12",name="雲水民居 12",x=-44,z=7,clearanceX=2.7,clearanceZ=2.7,access={x=-22,z=2}},
    {id="home_13",name="雲水民居 13",x=-34,z=7,clearanceX=2.7,clearanceZ=2.7,access={x=-17,z=2}},
    {id="home_14",name="雲水民居 14",x=-24,z=7,clearanceX=2.7,clearanceZ=2.7,access={x=-12,z=2}},
    {id="home_15",name="雲水民居 15",x=-14,z=7,clearanceX=2.7,clearanceZ=2.7,access={x=-7,z=2}},
    {id="home_16",name="雲水民居 16",x=-54,z=21,clearanceX=2.7,clearanceZ=2.7,access={x=-27,z=9}},
    {id="home_17",name="雲水民居 17",x=-44,z=21,clearanceX=2.7,clearanceZ=2.7,access={x=-22,z=9}},
    {id="home_18",name="雲水民居 18",x=-34,z=21,clearanceX=2.7,clearanceZ=2.7,access={x=-17,z=9}},
    {id="home_19",name="雲水民居 19",x=-24,z=21,clearanceX=2.7,clearanceZ=2.7,access={x=-12,z=9}},
    {id="home_20",name="雲水民居 20",x=-14,z=21,clearanceX=2.7,clearanceZ=2.7,access={x=-7,z=9}},
    {id="home_21",name="青石民居 1",x=14,z=-21,clearanceX=2.7,clearanceZ=2.7,access={x=7,z=-8}},
    {id="home_22",name="青石民居 2",x=24,z=-21,clearanceX=2.7,clearanceZ=2.7,access={x=12,z=-8}},
    {id="home_23",name="青石民居 3",x=34,z=-21,clearanceX=2.7,clearanceZ=2.7,access={x=17,z=-8}},
    {id="home_24",name="青石民居 4",x=44,z=-21,clearanceX=2.7,clearanceZ=2.7,access={x=22,z=-8}},
    {id="home_25",name="青石民居 5",x=54,z=-21,clearanceX=2.7,clearanceZ=2.7,access={x=27,z=-8}},
    {id="home_26",name="青石民居 6",x=14,z=-7,clearanceX=2.7,clearanceZ=2.7,access={x=7,z=-1}},
    {id="home_27",name="青石民居 7",x=24,z=-7,clearanceX=2.7,clearanceZ=2.7,access={x=12,z=-1}},
    {id="home_28",name="青石民居 8",x=34,z=-7,clearanceX=2.7,clearanceZ=2.7,access={x=17,z=-1}},
    {id="home_29",name="青石民居 9",x=44,z=-7,clearanceX=2.7,clearanceZ=2.7,access={x=22,z=-1}},
    {id="home_30",name="青石民居 10",x=54,z=-7,clearanceX=2.7,clearanceZ=2.7,access={x=27,z=-1}},
    {id="home_31",name="青石民居 11",x=14,z=7,clearanceX=2.7,clearanceZ=2.7,access={x=7,z=2}},
    {id="home_32",name="青石民居 12",x=24,z=7,clearanceX=2.7,clearanceZ=2.7,access={x=12,z=2}},
    {id="home_33",name="青石民居 13",x=34,z=7,clearanceX=2.7,clearanceZ=2.7,access={x=17,z=2}},
    {id="home_34",name="青石民居 14",x=44,z=7,clearanceX=2.7,clearanceZ=2.7,access={x=22,z=2}},
    {id="home_35",name="青石民居 15",x=54,z=7,clearanceX=2.7,clearanceZ=2.7,access={x=27,z=2}},
    {id="home_36",name="青石民居 16",x=14,z=21,clearanceX=2.7,clearanceZ=2.7,access={x=7,z=9}},
    {id="home_37",name="青石民居 17",x=24,z=21,clearanceX=2.7,clearanceZ=2.7,access={x=12,z=9}},
    {id="home_38",name="青石民居 18",x=34,z=21,clearanceX=2.7,clearanceZ=2.7,access={x=17,z=9}},
    {id="home_39",name="青石民居 19",x=44,z=21,clearanceX=2.7,clearanceZ=2.7,access={x=22,z=9}},
    {id="home_40",name="青石民居 20",x=54,z=21,clearanceX=2.7,clearanceZ=2.7,access={x=27,z=9}}
}
local OBSTACLES = {
    {x=-4,z=-46,radius=1.35},
    {x=4,z=-42,radius=1.35},
    {x=-8,z=45,radius=1.35},
    {x=8,z=45,radius=1.35},
    {x=-66,z=44,radius=1.35},
    {x=66,z=-44,radius=1.35},
    {x=-4,z=50,radius=1.35},
    {x=4,z=-50,radius=1.35},
    {x=-38,z=0,radius=1.35},
    {x=38,z=0,radius=1.35},
    {x=0,z=0,radius=1.35},
    {x=-34,z=42,radius=1.35},
    {x=34,z=-42,radius=1.35}
}

local GRID_STEP = 2
local MOVEMENT_REPLAN_YIELD_FRAMES = 18
local MOVEMENT_REPLAN_HARD_FRAMES = 45
local GRID_MIN_X, GRID_MAX_X = -45, 45
local GRID_MIN_Z, GRID_MAX_Z = -36, 36
local GRID_NEIGHBORS = {{x=1,z=0},{x=-1,z=0},{x=0,z=1},{x=0,z=-1}}

-- Cemetery parcel: 8 columns × 5 rows, with 4-world-unit spacing and walkable aisles.
-- It extends north of the original z=-32 edge and remains separate from 照夜寺.
local CEMETERY = {originX=-26,originZ=-27,columns=10,tombRows=8,columnStride=2,rowStride=2,capacity=80}
local cemeteryAssignments, cemeteryReservations = {}, {}

local function cemeterySlotAt(cell)
    local column,row=cell.x-CEMETERY.originX,cell.z-CEMETERY.originZ
    if column<0 or column>=CEMETERY.columns*CEMETERY.columnStride or row<0 or row>=CEMETERY.tombRows*CEMETERY.rowStride
        or column%CEMETERY.columnStride~=0 or row%CEMETERY.rowStride~=0 then return nil end
    return math.floor(row/CEMETERY.rowStride)*CEMETERY.columns+math.floor(column/CEMETERY.columnStride)+1
end

local function cemeteryCell(slot)
    local zero=slot-1
    return {x=CEMETERY.originX+(zero%CEMETERY.columns)*CEMETERY.columnStride,z=CEMETERY.originZ+math.floor(zero/CEMETERY.columns)*CEMETERY.rowStride}
end

local function cemeteryWorldPosition(slot)
    local cell=cemeteryCell(slot)
    return {x=cell.x*GRID_STEP,y=0.35,z=cell.z*GRID_STEP}
end

local function allocateCemeterySlot(npc)
    local existing=cemeteryAssignments[npc.id]
    if existing then return existing end
    for slot=1,CEMETERY.capacity do
        if not cemeteryReservations[slot] then
            cemeteryReservations[slot]=npc.id
            cemeteryAssignments[npc.id]=slot
            return slot
        end
    end
    error("cemetery capacity exhausted")
end

local function _releaseCemeterySlot(npc)
    local slot=cemeteryAssignments[npc.id]
    if slot then cemeteryAssignments[npc.id]=nil; cemeteryReservations[slot]=nil end
end

local ZONES = {}
for _, building in ipairs(BUILDINGS) do
    local access = building.access or {x=building.x,z=building.z}
    ZONES[building.zone]={x=access.x*GRID_STEP,z=access.z*GRID_STEP}
end
for _, home in ipairs(HOMES) do
    ZONES[home.id]={x=home.access.x*GRID_STEP,z=home.access.z*GRID_STEP}
end

local RESIDENTS_PER_PAGE = 8
local DECISION_INTERVAL = 120
local MAX_PENDING_DECISIONS = 16
local SIMULATION_INTERVAL = 30
-- Gameplay balance lives in Luau: one simulated day is one age year so a
-- stream can observe a life arc, while natural death remains a daily hazard.
local AGE_YEARS_PER_GAME_DAY = 1
local NATURAL_DEATH_CHECK_PERCENT = 18
local ATTACK_RAW_DAMAGE_MIN, ATTACK_RAW_DAMAGE_MAX = 3, 8
local ATTACK_CRITICAL_MULTIPLIER = 1.35
local CULTIVATION_TECHNIQUES={"太初吐納經","青木長生訣","玄火煉氣篇","流雲御劍錄","厚土築基法"}
local CULTIVATION_REALM_EN={["凡人"]="mortal",["練氣"]="qi condensation",["築基"]="foundation establishment",["金丹"]="golden core",["元嬰"]="nascent soul"}
local CULTIVATION_TECHNIQUE_EN={
    ["太初吐納經"]="Primordial Breath Circulation",["青木長生訣"]="Azure Wood Longevity Manual",
    ["玄火煉氣篇"]="Mystic Flame Qi Manual",["流雲御劍錄"]="Cloudstream Flying Sword Record",
    ["厚土築基法"]="Earth Foundation Method"
}
local CULTIVATION_REALM_LIFESPAN_BONUS={["凡人"]=0,["練氣"]=15,["築基"]=35,["金丹"]=70,["元嬰"]=140}

local function cultivationRealm(value)
    if value>=90 then return "元嬰" end
    if value>=70 then return "金丹" end
    if value>=45 then return "築基" end
    if value>=20 then return "練氣" end
    return "凡人"
end

local ACTION_LABEL = {
    work="工作", rest="休息", eat="吃飯", train="練武", social="交談",
    help="請人治療",treat="提供治療",duel="邀請決鬥", gather="採集", hunt="狩獵", travel="趕路", shop="採買", dead="已故",
    wait="等待",cooperate="合作",flirt="示好",steal="偷竊",rob="搶劫",attack="飛劍攻擊",propose="求婚",
    cultivate="修煉內功",seek_manual="尋找功法",alchemy="煉丹",forge_artifact="打造法寶",apprentice="拜師",have_child="成家生子",hunt_monster="斬妖委託",find_work="找工作",seek_treasure="爭奪珍寶",
    accept="接受邀請",refuse="拒絕",yield="交出錢財",resist="反抗",leave="離開威脅",
    finish_kill="殺死",finish_loot="掠奪",finish_knockout="打暈",finish_spare="放過",
    eat_packed="吃乾糧",use_medicine="用藥",use_supplies="使用日用品",use_pill="服用丹藥",buy_food="備乾糧",buy_herbs="備藥"
}
local ACTION_ICON = {
    work="⚒", rest="💤", eat="🍜", train="⚔", social="💬",
    help="🩺",treat="🩺",duel="⚡", gather="🌿", hunt="👹", travel="➜", shop="🧺", dead="🪦",
    accept="🤝",refuse="·",yield="◈",resist="⚔",leave="➜",rob="◈",
    finish_kill="☠",finish_loot="◈",finish_knockout="💫",finish_spare="🕊",
    wait="⌛",cooperate="🤝",flirt="♡",steal="◈",attack="🗡",propose="♡",
    cultivate="☯",seek_manual="📜",alchemy="⚗",forge_artifact="🔮",apprentice="🎓",have_child="🍼",hunt_monster="👹",find_work="📋",seek_treasure="💎",
    eat_packed="🍙",use_medicine="🩹",use_supplies="◇",use_pill="💊",buy_food="🍙",buy_herbs="🌿"
}
local PAIR_ACTION={help="treatment",treat="treatment",duel="duel",propose="proposal",apprentice="mentorship",have_child="family",steal="theft",rob="robbery",social="social",cooperate="cooperate",flirt="flirt"}
local PAIR_RESPONSE={accept=true,refuse=true,yield=true,resist=true,leave=true}
local INTERACTION_ACTION={social=true,cooperate=true,flirt=true,steal=true,rob=true,attack=true,propose=true,apprentice=true,have_child=true,help=true,treat=true,duel=true,accept=true,refuse=true,yield=true,resist=true,leave=true}
local PORTABLE_ACTION={eat_packed=true,use_medicine=true,use_supplies=true,use_pill=true}
local EMOTION_LABEL = {
    joyful="欣喜", calm="平靜", tense="緊繃", afraid="惶恐", exhausted="疲憊",
    hungry="飢餓",lonely="寂寞",jealous="吃醋",sleeping="熟睡",resting="放鬆",dead="已故"
}

-- 業務層可在此注入自己的尋路、決策與事件邏輯；預設不需要 Rust 或 jobs。
local EXTENSIONS = {pathfind=nil, onEvent=nil}
local frame, worldMinutes, decisionCount, eventCount = 0, 0, 0, 0
local events, npcs, relationshipGraph = {}, {}, {}
local chronicle: any = {}
local CHRONICLE_LIMIT, PERSONAL_CHRONICLE_LIMIT = 240, 28
local storyStats = {cooperations=0, schemes=0, deaths=0, jealousy=0}
local Family = {births=0, children={}, nextId=0}
local addEvent
local paused, speed, selectedNpc = false, 1, 1
local debugRegistered = false
local residentPage, simulationTickCount = 1, 0
local pointerHeld = false
local resources = {food=24, herbs=18, monsterThreat=42}
-- Gameplay-owned execution/evidence; the viewer never rolls hits or damage.
local Combat = {clock=0,sequence=0,events={},bouts={},nextId=0,dirty=false,hits=0,misses=0,finished=0}
local MonsterCombat = {clock=0,sequence=0,sessions={},hits=0,misses=0,finished=0}
local monsters, monsterById = {}, {}
local function isStunned(npc)
    return npc and (npc.stunnedUntil or 0)>Combat.clock
end
function MonsterCombat.snapshot()
    local result,alive={},0
    for _,monster in ipairs(monsters) do
        if monster.alive then alive=(alive or 0)+1 end
        table.insert(result,{id=monster.id,name=monster.name,position={x=monster.x,y=0.9,z=monster.z},hp=math.max(0,math.floor(monster.hp)),max_hp=monster.max_hp,alive=monster.alive,respawn_in=monster.alive and 0 or math.max(0,math.floor((monster.respawnAt or worldMinutes)-worldMinutes))})
    end
    local active={}
    for _,session in ipairs(MonsterCombat.sessions) do
        if not session.done then table.insert(active,{id=session.id,npc_id=session.npc.id,npc_name=session.npc.name,monster_id=session.monster.id,monster_name=session.monster.name,phase=session.phase,rounds=session.rounds,hp=math.floor(session.monster.hp),max_hp=session.monster.max_hp}) end
    end
    return {count=#result,alive=alive or 0,entities=result,active=active,hits=MonsterCombat.hits,misses=MonsterCombat.misses,finished=MonsterCombat.finished}
end
local vfxStats = {system="unone_particle",available=false,attempts=0,played=0,last_error=""}
local Treasure = {active=nil,next_check=360,spawned=0,claimed=0,contests=0}
local Brain={requests={},requested=0,epoch=0,applied=0,started=0,cursor=1}
local Pair={clock=0,sequence=0,epoch=0,sessions={}}
function Combat.find(id)
    if not id then return nil end
    for _,bout in ipairs(Combat.bouts) do if bout.id==id and not bout.done then return bout end end
    return nil
end
function Pair.occupied(npc)
    local p=npc.pair
    return p and p.phase=="performing" and p.accepted and (p.kind~="theft" and p.kind~="robbery" or p.response=="yield")
end

local function clamp(value, low, high)
    if value < low then return low end
    if value > high then return high end
    return value
end

local function refreshCultivation(npc)
    npc.cultivation=clamp(npc.cultivation or 0,0,100)
    npc.qi=clamp(npc.qi or 0,0,100)
    npc.realm=cultivationRealm(npc.cultivation)
    npc.lifespan=(npc.baseLifespan or npc.lifespan or 80)+(CULTIVATION_REALM_LIFESPAN_BONUS[npc.realm] or 0)
end

-- Town economy is gameplay, entirely in Luau. Every coin has a counterparty;
-- dead residents retain an estate account, included in the money supply.
local Condition={}
function Condition.factor(npc)
    if npc.alive==false then return 0 end
    return clamp(1-.35*clamp(npc.fatigue or 0,0,100)/100-.35*clamp(npc.injury or 0,0,100)/100-.15*clamp(npc.hunger or 0,0,100)/100,.25,1)
end
function Condition.effort(npc)
    -- Terminal legacy injuries do not infer death, but cannot produce work or strikes.
    if (npc.injury or 0)>=100 then return 0 end
    return Condition.factor(npc)
end
function Condition.summary(npc)
    if npc.alive==false then return "已故，停止執行" end
    if (npc.injury or 0)>=100 then return "傷勢達上限，無法勞動、修練或出招；存歿仍以生命紀錄為準" end
    return string.format("體況效率 %.0f%%：疲勞、傷勢與飢餓共同影響移動、勞動、修練及出招傷害（遊戲規則）",Condition.factor(npc)*100)
end
local function needLevel(value)
    if value>=95 then return "critical" end
    if value>=80 then return "urgent" end
    if value>=60 then return "high" end
    if value>=30 then return "elevated" end
    if value>0 then return "low" end
    return "none"
end

function Condition.needsPriority(npc)
    local injury=clamp(npc.injury or 0,0,100)
    local hunger=clamp(npc.hunger or 0,0,100)
    local fatigue=clamp(npc.fatigue or 0,0,100)
    local loneliness=clamp(npc.loneliness or 0,0,100)
    local fear=clamp(npc.fear or 0,0,100)
    local morale=clamp(npc.morale or 0,0,100)
    local survival=math.max(injury,hunger,fatigue)
    local function level(value) return needLevel(value) end
    local groups={
        {id="survival",label="生存",severity=survival,level=level(survival),tie=1},
        {id="fear",label="恐懼",severity=fear,level=level(fear),tie=2},
        {id="social",label="社交",severity=loneliness,level=level(loneliness),tie=3}
    }
    local bucket=function(value) return value>=95 and 5 or value>=80 and 4 or value>=60 and 3 or value>=30 and 2 or value>0 and 1 or 0 end
    table.sort(groups,function(a,b)
        local ab,bb=bucket(a.severity),bucket(b.severity)
        if ab==bb then return a.tie<b.tie end
        return ab>bb
    end)
    local components={
        {id="injury",label="傷勢",value=injury,group="survival",group_tie=1},
        {id="hunger",label="飢餓",value=hunger,group="survival",group_tie=2},
        {id="fatigue",label="疲勞",value=fatigue,group="survival",group_tie=3},
        {id="fear",label="恐懼",value=fear,group="fear",group_tie=4},
        {id="loneliness",label="孤獨",value=loneliness,group="social",group_tie=5}
    }
    local groupOrder={survival=1,fear=2,social=3}
    table.sort(components,function(a,b)
        local ab,bb=bucket(a.value),bucket(b.value)
        if groupOrder[a.group]~=groupOrder[b.group] then return groupOrder[a.group]<groupOrder[b.group] end
        if ab~=bb then return ab>bb end
        if a.value~=b.value then return a.value>b.value end
        return a.group_tie<b.group_tie
    end)
    local order,ranks,items,compactRanks={},{},{},{}
    for index,group in ipairs(groups) do table.insert(order,group.id) end
    for index,item in ipairs(components) do
        table.insert(ranks,string.format("%d.%s %d/100 [%s]",index,item.label,math.floor(item.value),level(item.value)))
        table.insert(items,{id=item.id,label=item.label,value=math.floor(item.value),level=level(item.value),group=item.group,rank=index})
        table.insert(compactRanks,string.format("%s=%d/100 %s",item.id,math.floor(item.value),level(item.value)))
    end
    local survivalText=string.format("生存壓力：傷勢%d/100、飢餓%d/100、疲勞%d/100（最高嚴重度%d）",injury,hunger,fatigue,survival)
    local socialText=string.format("社交壓力：孤獨%d/100",loneliness)
    local fearText=string.format("恐懼另列：%d/100",fear)
    local primary=groups[1].severity>0 and groups[1].id or "none"
    local moraleLevel=morale>=75 and "positive" or morale<=38 and "low" or "steady"
    return {primary_pressure=primary,survival_pressure=survivalText,social_pressure=socialText,fear_pressure=fearText,
        morale_signal=string.format("士氣%d/100；高士氣是正向訊號，不是危機",morale),
        morale={value=morale,level=moraleLevel,is_crisis=false,signal="positive_or_steady"},
        survival_severity=survival,social_severity=loneliness,fear_severity=fear,
        priority_order=order,priority_ranking=ranks,priority_items=items,
        compact_model_summary="Priority: "..table.concat(compactRanks," > ").."; morale="..morale..(morale>=75 and " positive" or morale<=38 and " low" or " steady").."; survival first; critical needs favor rest/eat/treat; reference only, not mandatory",
        summary=table.concat(ranks,"；").."。"..survivalText.."；"..socialText.."；"..fearText.."；"..string.format("士氣%d/100（%s；不列為危機）",morale,morale>=75 and "正向" or morale<=38 and "偏低" or "穩定")..
            "。這是決策參考，不是強制行動；NanoJev 仍由人格、價值觀與情境自行選擇。"}
end
local Economy = {goods={"ingredients","food","herbs","wares"}, firms={}, ledger={}}
Economy.defs = {
    ingredients={name="食材",base=2,target=110}, food={name="飯食",base=6,target=80},
    herbs={name="藥材",base=5,target=65}, wares={name="日用品",base=9,target=50}
}
-- firm, workplace, output (or service), wage; one entry for every profession.
Economy.jobs = {
    {"farm","herb_field","herbs",3},{"inn","inn","service",2},{"workshop","forge","wares",4},
    {"treasury","gate","service",3},{"clinic","clinic","service",3},{"farm","monster_den","ingredients",3},
    {"market","market","service",2},{"treasury","training","service",1},{"inn","inn","food",4},
    {"farm","dock","ingredients",3},{"workshop","forge","wares",4},{"workshop","market","wares",4},
    {"treasury","school","service",3},{"farm","herb_field","ingredients",3},{"treasury","dock","service",2},
    {"treasury","archive","service",3},{"treasury","gate","service",2},{"inn","inn","food",4},
    {"workshop","market","wares",4},{"workshop","forge","wares",4},{"inn","inn","service",2},
    {"workshop","temple","wares",4},{"market","market","service",2},{"farm","monster_den","ingredients",3},
    {"clinic","clinic","service",3},{"treasury","gate","service",3},{"workshop","dock","wares",4},
    {"workshop","market","wares",4},{"farm","herb_field","ingredients",3},{"treasury","gate","service",2},
    {"treasury","stable","service",2},{"farm","market","ingredients",3},{"treasury","temple","service",2},
    {"treasury","archive","service",3},{"inn","inn","service",2},{"inn","inn","service",2},
    {"inn","inn","food",4},{"treasury","temple","service",2},{"treasury","training","service",3},
    {"farm","herb_field","herbs",3},
    {"treasury","manor","service",8},{"treasury","manor","service",5},{"treasury","gate_b","service",3},{"treasury","gate_b","service",3},
    {"guild","guild","service",6},{"guild","guild","service",3},{"market","market_b","service",3},{"market","market_b","service",3},
    {"guild","monster_outskirts","service",5},{"guild","monster_outskirts","service",7},{"clinic","clinic_b","service",4},{"workshop","training_b","wares",4},
    {"farm","herb_field","ingredients",3},{"inn","inn_b","food",4},{"market","caravan_gate","service",4},{"market","market_b","service",3},
    {"treasury","gate_b","service",4},{"farm","monster_outskirts","herbs",4},{"treasury","manor","service",3},{"market","market_b","service",3},
    {"guild","monster_outskirts","service",6},{"clinic","clinic_b","service",5},{"guild","monster_outskirts","service",5},{"treasury","manor","service",3},
    {"workshop","training_b","wares",5},{"treasury","caravan_gate","service",3},{"farm","monster_outskirts","ingredients",3},{"guild","guild","service",3},
    {"guild","monster_outskirts","service",7},{"clinic","clinic_b","service",4},{"market","market_b","ingredients",3},{"treasury","gate_b","service",3},
    {"guild","guild","service",3},{"market","market_b","service",3},{"treasury","training_b","service",3},{"treasury","gate_b","service",3},
    {"market","caravan_gate","service",4},{"treasury","temple","service",2},{"treasury","training_b","service",4},{"farm","herb_field","herbs",3}
}

function Economy.stock(good)
    local count=0
    for _, firm in ipairs(Economy.firms) do count += firm.inventory[good] or 0 end
    return count
end

function Economy.carried(good)
    local count=0
    for _,npc in ipairs(npcs) do count+=(npc.inventory and npc.inventory[good]) or 0 end
    return count
end

function Economy.price(good)
    local def=Economy.defs[good]
    return math.max(1,math.floor(def.base*clamp(1.6-0.6*Economy.stock(good)/def.target,0.6,1.8)+0.5))
end

function Economy.transfer(from, to, amount, kind, reason)
    amount=math.floor(amount)
    if amount<=0 or from==to or from.wealth<amount then return false end
    from.wealth -= amount; to.wealth += amount
    Economy.transactions += 1
    local entry={id=Economy.transactions,frame=frame,day=math.floor(worldMinutes/1440)+1,
        from=from.name,to=to.name,from_id=from.id,to_id=to.id,amount=amount,kind=kind,reason=reason}
    table.insert(Economy.ledger,1,entry)
    while #Economy.ledger>24 do table.remove(Economy.ledger) end
    for _, account in ipairs({from,to}) do
        if account.finance then
            local f=account.finance
            if account==from then f.spent+=amount; f.today_spent+=amount
            else f.income+=amount; f.today_income+=amount end
            table.insert(f.receipts,1,entry)
            while #f.receipts>5 do table.remove(f.receipts) end
        end
    end
    Economy.totals[kind]=(Economy.totals[kind] or 0)+amount
    return true
end

function Economy.reset()
    Economy.firms={
        {id="farm",name="農漁藥行",wealth=420,inventory={ingredients=90,herbs=45}},
        {id="inn",name="聽雨客棧",wealth=500,inventory={ingredients=20,food=80}},
        {id="clinic",name="回春醫館",wealth=360,inventory={herbs=20}},
        {id="workshop",name="百工坊",wealth=500,inventory={wares=30}},
        {id="market",name="雲水市集",wealth=450,inventory={wares=20}},
        {id="guild",name="斬妖公會",wealth=900,inventory={}},
        {id="treasury",name="鎮公庫",wealth=1800,inventory={}}
    }
    Economy.accounts={}; Economy.initial_money=0; Economy.ledger={}; Economy.transactions=0
    Economy.day=1; Economy.totals={}; Economy.production={}; Economy.consumption={}; Economy.initial_stock={}
    for _, firm in ipairs(Economy.firms) do
        Economy.accounts[firm.id]=firm; Economy.initial_money+=firm.wealth
    end
    for i,npc in ipairs(npcs) do
        local job=Economy.jobs[i]
        npc.job={firm=job[1],zone=job[2],output=job[3],wage=job[4],slot=i,contract_status="active",contract_started_day=1,unpaid_shifts=0}
        -- Initial belongings are part of world creation, counted in the stock baseline.
        npc.inventory={food=1,herbs=(job[1]=="clinic" or job[3]=="herbs") and 1 or 0,wares=0,pills=0,manuals=0,artifacts=0}
        npc.itemActionDone=false; npc.lastItemEvent="出門帶了一份乾糧"
        npc.finance={income=0,spent=0,today_income=0,today_spent=0,receipts={},initial_balance=npc.wealth,
            work_ticks=0,shifts=0,job_changes=0,failed_purchases=0,need_wares=45+(i*7)%45,status="準備上工"}
        Economy.initial_money+=npc.wealth
    end
    for _, good in ipairs(Economy.goods) do
        Economy.production[good]=0; Economy.consumption[good]=0
        Economy.initial_stock[good]=Economy.stock(good)+Economy.carried(good)
    end
    resources.food=Economy.stock("food"); resources.herbs=Economy.stock("herbs")
end

function Economy.consume(firm, good, quantity)
    firm.inventory[good]-=quantity
    Economy.consumption[good]+=quantity
end

function Economy.restock(buyerId,sellerId,good,target)
    local buyer,seller=Economy.accounts[buyerId],Economy.accounts[sellerId]
    local price=math.max(1,math.floor(Economy.price(good)*0.65))
    local quantity=math.floor(math.min(target-(buyer.inventory[good] or 0),seller.inventory[good] or 0,math.floor(buyer.wealth/price)))
    if quantity<=0 then return end
    if Economy.transfer(buyer,seller,quantity*price,"wholesale","補貨："..Economy.defs[good].name.." ×"..quantity) then
        seller.inventory[good]-=quantity; buyer.inventory[good]=(buyer.inventory[good] or 0)+quantity
    end
end

function Economy.jobSearchNeeded(npc)
    return not npc.job or npc.job.contract_status~="active"
end

function Economy.findJob(npc)
    if not Economy.jobSearchNeeded(npc) then return false end
    for slot,job in ipairs(Economy.jobs) do
        local firm=Economy.accounts[job[1]]; local occupied=false
        if firm and firm.wealth>=job[4]*4 then
            for _,other in ipairs(npcs) do
                if other.alive and other~=npc and other.job and other.job.contract_status=="active" and other.job.slot==slot then occupied=true; break end
            end
            if not occupied then
                npc.job={firm=job[1],zone=job[2],output=job[3],wage=job[4],slot=slot,contract_status="active",contract_started_day=Economy.day,unpaid_shifts=0}
                npc.finance.job_changes=(npc.finance.job_changes or 0)+1
                npc.finance.status=firm.name.."已簽訂工作契約"
                return true
            end
        end
    end
    npc.finance.status="暫時找不到能支付工錢的工作"
    return false
end

function Economy.tick()
    local day=math.floor(worldMinutes/1440)+1
    if day~=Economy.day then
        Economy.day=day
        for _, npc in ipairs(npcs) do npc.finance.today_income=0; npc.finance.today_spent=0 end
    end
    -- ponytail: wholesale is abstract account-to-account delivery; physical carts can replace it later.
    if simulationTickCount%8==0 then
        Economy.restock("inn","farm","ingredients",24)
        Economy.restock("clinic","farm","herbs",24)
        Economy.restock("market","workshop","wares",24)
    end
    resources.food=Economy.stock("food"); resources.herbs=Economy.stock("herbs")
end

function Economy.buy(npc,firmId,good,carry)
    local firm=Economy.accounts[firmId]
    local price=Economy.price(good)
    if (firm.inventory[good] or 0)<1 then
        npc.finance.status=firm.name.."缺貨："..Economy.defs[good].name
        npc.finance.failed_purchases+=1; return false
    end
    if npc.wealth<price then
        -- Means-tested relief is paid out of existing public funds, never minted.
        if good=="food" and npc.hunger>=75 then
            Economy.transfer(Economy.accounts.treasury,npc,price-npc.wealth,"relief","急難救濟：已無力購買一餐")
        end
        if npc.wealth<price then
            npc.finance.status="買不起"..Economy.defs[good].name.."（要 "..price.." 文，只有 "..npc.wealth.." 文）"
            npc.finance.failed_purchases+=1; return false
        end
    end
    Economy.transfer(npc,firm,price,"purchase",Economy.defs[good].name.." ×1，單價 "..price.." 文")
    if carry then
        firm.inventory[good]-=1; npc.inventory[good]=(npc.inventory[good] or 0)+1
        npc.lastItemEvent="買入"..Economy.defs[good].name.." ×1，放入行囊"
    else Economy.consume(firm,good,1) end
    local tax=math.max(1,math.floor(price*0.2))
    Economy.transfer(firm,Economy.accounts.treasury,tax,"tax","交易稅："..Economy.defs[good].name)
    npc.finance.status="在"..firm.name.."花 "..price.." 文買了"..Economy.defs[good].name
    return true
end

function Economy.useItem(npc,good)
    if not npc.alive or (npc.inventory[good] or 0)<1 then return false end
    npc.inventory[good]-=1; Economy.consumption[good]+=1
    npc.lastItemEvent="使用"..Economy.defs[good].name.." ×1"
    return true
end

function Economy.work(npc,effort)
    if not npc.alive or npc.reservedX or Pair.occupied(npc) or (npc.task and npc.task.complete) then return end
    local job,f=npc.job,npc.finance
    if not job or job.contract_status~="active" then f.status="沒有有效工作契約，等待找工作"; return end
    local atWork=npc.location==job.zone and (npc.action=="work" or npc.action=="gather" or npc.action=="hunt"
        or (job.output=="service" and (npc.action=="social" or npc.action=="travel" or npc.action=="train" or (npc.action=="help" and npc.injury<1))))
    if not atWork then return end
    f.work_ticks+=effort or Condition.effort(npc)
    if f.work_ticks<8-1e-9 then return end
    f.work_ticks=math.max(0,f.work_ticks-8)
    local firm=Economy.accounts[job.firm]
    if firm.wealth<job.wage then
        job.unpaid_shifts=(job.unpaid_shifts or 0)+1
        f.status=firm.name.."資金不足，暫停派工"
        if job.unpaid_shifts>=3 then job.contract_status="suspended"; f.status=firm.name.."連續三班無法支付，契約暫停" end
        return
    end
    if job.output~="service" then
        if Economy.stock(job.output)>=Economy.defs[job.output].target*2 then f.status="庫存積壓，等待銷路"; return end
        if job.output=="food" then
            if (firm.inventory.ingredients or 0)<1 then f.status="客棧缺食材，等農漁藥行補貨"; return end
            Economy.consume(firm,"ingredients",1)
        end
        local quantity=job.output=="food" and 6 or job.output=="ingredients" and 6 or job.output=="herbs" and 3 or 1
        firm.inventory[job.output]=(firm.inventory[job.output] or 0)+quantity
        Economy.production[job.output]+=quantity
    end
    if not Economy.transfer(firm,npc,job.wage,"wage",npc.role.."完成一班"..(job.output=="service" and "服務" or "生產")) then return end
    job.unpaid_shifts=0; f.shifts+=1; f.status=firm.name.."支付工錢 "..job.wage.." 文"
    return true
end

function Economy.snapshot()
    local coins,poor,residentCash,estate=0,0,0,0
    for _, npc in ipairs(npcs) do
        coins+=npc.wealth
        if npc.alive then residentCash+=npc.wealth; if npc.wealth<Economy.price("food")*3 then poor+=1 end
        else estate+=npc.wealth end
    end
    local businesses={}
    for _, firm in ipairs(Economy.firms) do
        coins+=firm.wealth
        local employees=0
        for _, npc in ipairs(npcs) do if npc.alive and npc.job.firm==firm.id then employees+=1 end end
        table.insert(businesses,{id=firm.id,name=firm.name,balance=firm.wealth,inventory=firm.inventory,employees=employees})
    end
    local goods={}
    for _, good in ipairs(Economy.goods) do
        table.insert(goods,{id=good,name=Economy.defs[good].name,price=Economy.price(good),base_price=Economy.defs[good].base,
            stock=Economy.stock(good),carried=Economy.carried(good),initial_stock=Economy.initial_stock[good],produced=Economy.production[good],consumed=Economy.consumption[good]})
    end
    return {day=Economy.day,currency="文",initial_money=Economy.initial_money,total_money=coins,money_delta=coins-Economy.initial_money,
        resident_cash=residentCash,estate_cash=estate,treasury=Economy.accounts.treasury.wealth,poor_residents=poor,
        transactions=Economy.transactions,totals=Economy.totals,goods=goods,businesses=businesses,ledger=Economy.ledger}
end

-- Resident life is Luau gameplay. Descriptive state never chooses an intention.
local Life={}
local REST_INJURY_RECOVERY_PER_MINUTE = 0.025
Life.tools={"採藥鋤","醒木","鍛鐵鎚","鏢刀","藥箱","行路劍","茶秤","練功木刀","擀麵杖","釣竿",
    "木工刨","針線包","書卷","花剪","船篙","地圖冊","驛信袋","酒麴袋","陶輪工具","石鑿",
    "古琴","製香模","鹽秤","獵弓","接生藥箱","巡夜梆子","紙簾","雕金刀","蜂煙壺","導覽圖",
    "馬刷","菜籃","祭儀冊","算盤","卜籤","酒壺","菜刀","鐘槌","練武木劍","藥研"}

function Life.clock(minutes)
    local hour=(minutes%1440)/60
    local phase=hour>=5 and hour<7 and "清晨" or hour>=7 and hour<17 and "白晝" or hour>=17 and hour<19 and "黃昏" or "夜晚"
    local daylight=math.sqrt(math.max(0,math.sin((hour-6)*math.pi/12)))
    return {day=math.floor(minutes/1440)+1,hour=hour,minute=math.floor(minutes)%60,phase=phase,
        is_night=hour<6 or hour>=19,daylight=daylight,twilight=clamp(1-math.abs(daylight-.35)/.35,0,1),cycle_fraction=(minutes%1440)/1440}
end

function Life.ageStage(npc)
    if npc.age >= npc.lifespan then return "end_of_life" end
    if npc.age >= 65 then return "elder" end
    if npc.age >= 50 then return "mature" end
    return "adult"
end

function Life.resting(npc)
    return npc.alive and not Pair.occupied(npc) and npc.action=="rest" and npc.location==npc.residence and not npc.reservedX
        and (not npc.routeCells or (npc.routeIndex or 1)>#npc.routeCells)
end

function Life.tick(npc,minutes,clock,wasResting)
    if not npc.alive then return end
    local resting=Life.resting(npc)
    if wasResting~=nil then resting=wasResting end
    npc.hunger=clamp(npc.hunger+minutes*(resting and 0.055 or 0.0875),0,100)
    npc.loneliness=clamp(npc.loneliness+minutes*0.1*(.5+Persona.trait(npc,"sociability")/100),0,100)
    npc.finance.need_wares=clamp(npc.finance.need_wares+minutes*0.0375,0,100)
    if resting then
        local recovery=clock.is_night and 0.75 or 0.5
        npc.fatigue=clamp(npc.fatigue-minutes*recovery,0,100)
        npc.injury=clamp(npc.injury-minutes*REST_INJURY_RECOVERY_PER_MINUTE,0,100)
        npc.fear=clamp(npc.fear-minutes*0.1,0,100)
        npc.restMinutes=(npc.restMinutes or 0)+minutes
        if clock.is_night then npc.sleepMinutes=(npc.sleepMinutes or 0)+minutes end
    else
        local exertion={work=.11,gather=.13,hunt=.22,train=.18,duel=.25,attack=.18}
        local moving=npc.reservedX~=nil or (npc.routeCells and (npc.routeIndex or 1)<=#npc.routeCells)
        npc.fatigue=clamp(npc.fatigue+minutes*((clock.is_night and .065 or .045)+(moving and .04 or exertion[npc.action] or 0)),0,100)
    end
end

function Life.mood(npc)
    if not npc.alive then return "dead","生命已結束；錢袋與行囊保留為遺產" end
    if Life.resting(npc) then
        return Life.clock(worldMinutes).is_night and "sleeping" or "resting","已回到住處，疲勞正在恢復"
    end
    if npc.fatigue>=78 then return "exhausted","疲勞 "..math.floor(npc.fatigue).."/100，尚未得到足夠休息" end
    if npc.fear>=60 then return "afraid","恐懼升高，對周圍感到不安" end
    if npc.jealousy>=55 then return "jealous","感情關係引發嫉妒" end
    if npc.hunger>=70 then return "hungry","飢餓 "..math.floor(npc.hunger).."/100，身體缺乏補給" end
    if npc.loneliness>=65 then return "lonely","孤獨感偏高，近期缺少交流" end
    if npc.morale>=75 then return "joyful","士氣充足，對目前處境感到振奮" end
    if npc.morale<=38 or npc.resentment>=65 then return "tense","士氣低落或累積怨恨，心緒不寧" end
    return "calm","目前沒有特別強烈的情緒壓力"
end

function Life.inventory(npc)
    local items={{id="tool",name=npc.tool,quantity=1,kind="職業工具",description="隨身職業裝備；目前不提供額外戰力加成"}}
    for _,good in ipairs({"food","herbs","wares"}) do
        local quantity=npc.inventory[good] or 0
        if quantity>0 then table.insert(items,{id=good,name=good=="food" and "乾糧" or Economy.defs[good].name,quantity=quantity,
            kind="消耗品",description=good=="food" and "吃一份減少 36 飢餓" or good=="herbs" and "用一份減少 12 傷勢" or "用一份減少 45 日用品需求"}) end
    end
    if (npc.inventory.pills or 0)>0 then table.insert(items,{id="pills",name="丹藥",quantity=npc.inventory.pills,kind="修仙消耗品",description="服用後提升修為與靈氣"}) end
    if (npc.inventory.manuals or 0)>0 then table.insert(items,{id="manuals",name="功法秘笈",quantity=npc.inventory.manuals,kind="修仙典籍",description="記載可供修煉的內功與御劍法門"}) end
    if (npc.inventory.artifacts or 0)>0 then table.insert(items,{id="artifacts",name="法寶",quantity=npc.inventory.artifacts,kind="修仙裝備",description="提升飛劍戰鬥威力的本命法寶"}) end
    return items
end

function Life.itemAction(npc)
    if npc.itemActionDone then return end
    local a=npc.action
    if a=="eat_packed" then
        if npc.hunger>0 and Economy.useItem(npc,"food") then npc.hunger=clamp(npc.hunger-36,0,100)
        else npc.lastItemEvent="未吃乾糧：已飽足或行囊沒有乾糧" end
    elseif a=="use_medicine" then
        if npc.injury>0 and Economy.useItem(npc,"herbs") then npc.injury=clamp(npc.injury-12,0,100)
        else npc.lastItemEvent="未用藥：沒有傷勢或行囊沒有藥材" end
    elseif a=="use_supplies" then
        if npc.finance.need_wares>0 and Economy.useItem(npc,"wares") then
            npc.finance.need_wares=clamp(npc.finance.need_wares-45,0,100); npc.morale=clamp(npc.morale+4,0,100)
        else npc.lastItemEvent="未使用：暫無需求或行囊沒有日用品" end
    elseif a=="buy_food" or a=="buy_herbs" or a=="shop" then
        local good=a=="buy_food" and "food" or a=="buy_herbs" and "herbs" or "wares"
        local cap=good=="food" and 3 or 2
        if npc.inventory[good]<cap then
            local firm=good=="food" and "inn" or good=="herbs" and "clinic" or "market"
            if not Economy.buy(npc,firm,good,true) then npc.lastItemEvent=npc.finance.status end
        else npc.lastItemEvent="行囊已有足夠的"..Economy.defs[good].name end
    elseif a=="use_pill" then
        if (npc.inventory.pills or 0)>0 then
            npc.inventory.pills-=1
            npc.cultivation=clamp(npc.cultivation+6,0,100)
            npc.qi=clamp(npc.qi+18,0,100)
            refreshCultivation(npc)
            npc.morale=clamp(npc.morale+2,0,100)
            npc.lastItemEvent="服用丹藥，修為與靈氣上升"
        else npc.lastItemEvent="未服丹：行囊沒有可用的丹藥" end
    else return end
    npc.itemActionDone=true -- One item per approved model intention, not every simulation tick.
end

local function residentPageCount()
    return math.max(1, math.ceil(#npcs / RESIDENTS_PER_PAGE))
end

local function setResidentPage(page)
    local nextPage = clamp(page, 1, residentPageCount())
    local changed = nextPage ~= residentPage
    residentPage = nextPage
    local firstNpc = (residentPage - 1) * RESIDENTS_PER_PAGE + 1
    if npcs[firstNpc] and (selectedNpc < firstNpc or selectedNpc >= firstNpc + RESIDENTS_PER_PAGE) then
        selectedNpc = firstNpc
        changed = true
    end
    return changed
end

local function clockText()
    local hour = math.floor(worldMinutes / 60) % 24
    local minute = math.floor(worldMinutes) % 60
    return string.format("第 %d 日 · %02d:%02d", math.floor(worldMinutes/1440)+1, hour, minute)
end

local function buildingForZone(zone)
    for _, building in ipairs(BUILDINGS) do
        if building.zone == zone then return building end
    end
    for _, home in ipairs(HOMES) do
        if home.id == zone then return {name=home.name,icon="⌂",purpose="居住、休息",zone=zone} end
    end
    return {name=zone, icon="·", purpose="未知場域", zone=zone}
end

local function emotionFor(npc)
    return Life.mood(npc)
end

local function targetZone(npc)
    if npc.action=="leave" then return npc.residence end
    if npc.pair and npc==npc.pair.a and not npc.pair.done then return npc.pair.b.location end
    if npc.action=="wait" or INTERACTION_ACTION[npc.action] or PORTABLE_ACTION[npc.action] then return npc.interactionZone or npc.location or npc.residence end
    if npc.action=="buy_food" then return "inn" end
    if npc.action=="buy_herbs" then return "clinic" end
    if npc.action == "rest" then return npc.residence or npc.home end
    if npc.action == "work" then return npc.job.zone end
    if npc.action == "shop" then return "market" end
    if npc.action == "gather" then return "herb_field" end
    if npc.action == "hunt" then return "monster_den" end
    if npc.action == "hunt_monster" then return "monster_outskirts" end
    if npc.action == "find_work" then return "guild" end
    if npc.action == "seek_treasure" and Treasure.active then return Treasure.active.id end
    if npc.action == "train" or npc.action == "duel" or npc.action == "cultivate" then return "training" end
    if npc.action == "seek_manual" then return "archive" end
    if npc.action == "alchemy" then return "clinic" end
    if npc.action == "forge_artifact" then return "forge" end
    if npc.action == "help" then return "clinic" end
    if npc.action == "social" or npc.action == "eat" then return "inn" end
    if npc.action == "travel" then return npc.patrolZone or "market" end
    return npc.home
end

local function motiveFor(npc)
    if not npc.alive then return "死亡："..(npc.deathCause or "原因不明") end
    return npc.thinking and npc.thinking.motive or "等待 NanoJev 模型決策，未使用規則 AI 代替"
end

local function thinkingModeFor(npc)
    return npc.alive and (npc.thinking and "NanoJev／人物決策" or "等待 NanoJev") or "死亡／餘波"
end

local function intentFor(npc)
    if not npc.alive then
        if npc.cemeterySlot then return {icon="🪦", text="已故，安葬於雲水墓園", target="雲水墓園", reason=motiveFor(npc)} end
        return {icon="🪦", text="已故，等待安葬", target="照夜寺", reason=motiveFor(npc)}
    end
    local building = buildingForZone(targetZone(npc))
    local text = "等待下一個念頭"
    if npc.action == "work" then text = "在"..building.name.."完成職責" end
    if npc.action == "gather" then text = "採集藥草，帶回醫館" end
    if npc.action == "hunt" then text = "巡查"..building.name.."的怪物" end
    if npc.action == "hunt_monster" then text = "接受公會委託，前往城外斬妖" end
    if npc.action == "train" then text = "提升"..npc.style.."的熟練度" end
    if npc.action == "duel" then text = "邀請指定對手，等待同意切磋" end
    if npc.action == "apprentice" then text = "向指定的人請求拜師，等待對方明確同意" end
    if npc.action == "help" then text = "請指定的人提供治療" end
    if npc.action == "eat" then text = "補充體力，聽聽鎮上消息" end
    if npc.action == "shop" then text = "花 "..Economy.price("wares").." 文添購日用品" end
    if npc.action == "social" then text = "找人聊天，降低孤獨" end
    if npc.action == "rest" then text = "回家休息，恢復體力" end
    if npc.action == "rest" and Life.resting(npc) then text=Life.clock(worldMinutes).is_night and "在家睡覺，恢復體力" or "在家歇息，恢復體力" end
    if npc.action == "eat_packed" then text="吃行囊裡的乾糧" end
    if npc.action == "use_medicine" then text="使用隨身藥材療傷" end
    if npc.action == "use_supplies" then text="使用行囊裡的日用品" end
    if npc.action == "buy_food" then text="到客棧買一份乾糧帶走" end
    if npc.action == "buy_herbs" then text="到醫館買一份藥材備用" end
    if npc.action == "cultivate" then text="在演武靈台運轉內功，積累靈氣" end
    if npc.action == "seek_manual" then text="到藏經閣尋找適合自己的功法" end
    if npc.action == "alchemy" then text="到回春丹房煉製丹藥" end
    if npc.action == "forge_artifact" then text="到玄鐵鋪打造本命法寶" end
    if npc.action == "seek_treasure" and Treasure.active then text="前往"..Treasure.active.name.."現世之處，與其他人爭奪稀世珍寶" end
    if npc.action == "use_pill" then text="服用丹藥，煉化藥力" end
    if npc.action == "travel" then text = "巡走街道，前往"..building.name end
    if npc.action == "wait" then text = npc.thinking and "NanoJev 決定暫時等待" or "等待 NanoJev 模型回覆" end
    if INTERACTION_ACTION[npc.action] then text=ACTION_LABEL[npc.action].." · "..(npc.interactionTargetName~="" and npc.interactionTargetName or "尚未指定對象") end
    return {icon=ACTION_ICON[npc.action] or "·", text=text, target=building.name, reason=motiveFor(npc)}
end

local function headLabelFor(npc)
    local intent=intentFor(npc)
    return npc.name.." · "..intent.icon.." "..(npc.alive and (ACTION_LABEL[npc.action] or npc.action) or "已故")
end

local function relationKey(idA, idB)
    if idA < idB then return idA.."|"..idB end
    return idB.."|"..idA
end

local function getRelationship(a, b)
    if a.id == b.id then return nil end
    local key = relationKey(a.id, b.id)
    if not relationshipGraph[key] then
        relationshipGraph[key] = {a_id=a.id, b_id=b.id, affinity=12, trust=20, resentment=0, romance=0, encounters=0, cooperation=0, jealousy=0, scheme_count=0, married=false}
    end
    return relationshipGraph[key]
end

local function seedRelationship(idA, idB, affinity, trust, resentment, romance)
    relationshipGraph[relationKey(idA, idB)] = {
        a_id=idA, b_id=idB, affinity=affinity, trust=trust, resentment=resentment,
        romance=romance, encounters=0, cooperation=0, jealousy=0, scheme_count=0, married=false
    }
end

local function findNpc(id)
    for _, npc in ipairs(npcs) do if npc.id == id then return npc end end
    return nil
end

function Family.canHaveChild(a,b)
    return a and b and a.alive and b.alive and a.partnerId==b.id and b.partnerId==a.id
        and a.sex~=b.sex and a.age>=18 and b.age>=18 and a.age<70 and b.age<70
        and (a.childrenCount or 0)<3 and (b.childrenCount or 0)<3
        and worldMinutes-(a.lastBirthMinute or -math.huge)>=7200
        and worldMinutes-(b.lastBirthMinute or -math.huge)>=7200
end

function Family.snapshot()
    local children={}
    for i=math.max(1,#Family.children-24),#Family.children do
        local child=Family.children[i]
        if child then table.insert(children,child) end
    end
    return {version="family-v1",births=Family.births,children_count=#Family.children,children=children}
end

function Family.birth(api,a,b)
    if not Family.canHaveChild(a,b) then return false end
    Family.nextId+=1; Family.births+=1
    local mother=a.sex=="female" and a or b
    local father=mother==a and b or a
    local names={"沈星河","蘇小雨","鐵木生","白知秋","柳青禾","顧平安","周念慈","燕雲舟"}
    local child={id="child_"..Family.nextId,name=names[((Family.nextId-1)%#names)+1]..Family.nextId,sex=Family.nextId%2==0 and "female" or "male",
        age=0,birth_day=Life.clock(worldMinutes).day,mother_id=mother.id,mother_name=mother.name,father_id=father.id,father_name=father.name,
        lifespan=70+(Family.nextId%21),realm="凡人",status="襁褓"}
    table.insert(Family.children,child)
    for _,parent in ipairs({a,b}) do
        parent.childrenCount=(parent.childrenCount or 0)+1
        parent.lastBirthMinute=worldMinutes
        parent.morale=clamp(parent.morale+8,0,100)
        parent.loneliness=clamp(parent.loneliness-18,0,100)
        parent.lastItemEvent="家中添了一名孩子："..child.name
    end
    local relation=getRelationship(a,b)
    relation.encounters+=1; relation.affinity=clamp(relation.affinity+6,0,100); relation.trust=clamp(relation.trust+4,0,100)
    addEvent(api,a.name.."與"..b.name.."迎來孩子「"..child.name.."」",{kind="birth",actor=a,target=b,reason="NanoJev 雙方同意成家生子；孩子先以家族紀錄存活，之後可成為新世代 NPC"})
    return true
end

function Combat.opponent(npc)
    local ref=npc.combat
    if not ref then return nil end
    return findNpc(ref.actor_id==npc.id and ref.target_id or ref.actor_id)
end

local function relationshipStage(relation)
    if relation.married then return "夫妻" end
    if relation.resentment >= 70 then return "仇敵" end
    if relation.resentment >= 40 then return "敵對" end
    if relation.romance >= 70 and relation.affinity >= 70 and relation.trust >= 60 then return "相戀" end
    if relation.affinity >= 55 and relation.trust >= 45 then return "朋友" end
    if relation.encounters > 0 then return "熟識" end
    return "陌生"
end

local function relationshipImportance(relation)
    return math.abs(relation.resentment) + relation.affinity + relation.romance + relation.encounters * 2
end

local function relationshipViews()
    local views, stats = {}, {["陌生"]=0,["熟識"]=0,["朋友"]=0,["敵對"]=0,["仇敵"]=0,["相戀"]=0,["夫妻"]=0,["喪偶"]=0}
    local activeCount=0
    for _, relation in pairs(relationshipGraph) do
        activeCount += 1
        local a, b = findNpc(relation.a_id), findNpc(relation.b_id)
        if a and b then
            local status = relationshipStage(relation)
            stats[status] = (stats[status] or 0) + 1
            table.insert(views, {
                from=a.name, to=b.name, from_id=a.id, to_id=b.id, status=status,
                affinity=math.floor(relation.affinity), trust=math.floor(relation.trust),
                resentment=math.floor(relation.resentment), romance=math.floor(relation.romance),
                encounters=relation.encounters, cooperation=relation.cooperation, jealousy=relation.jealousy,
                schemes=relation.scheme_count,
                importance=relationshipImportance(relation)
            })
        end
    end
    table.sort(views, function(left, right)
        if left.importance == right.importance then return left.from_id..left.to_id < right.from_id..right.to_id end
        return left.importance > right.importance
    end)
    while #views > 12 do table.remove(views) end
    for _, view in ipairs(views) do view.importance=nil end
    stats.marriages=stats["夫妻"] or 0
    stats.active_relationships=activeCount
    return views, stats
end

local function relationshipSummary(npc)
    local close = {}
    for _, relation in pairs(relationshipGraph) do
        if relation.a_id == npc.id or relation.b_id == npc.id then
            local otherId = relation.a_id == npc.id and relation.b_id or relation.a_id
            local other = findNpc(otherId)
            if other then table.insert(close, {score=relationshipImportance(relation), text=other.name.."·"..relationshipStage(relation)}) end
        end
    end
    table.sort(close, function(left, right) return left.score > right.score end)
    local parts = {}
    for i=1,math.min(3,#close) do table.insert(parts, close[i].text) end
    return #parts > 0 and table.concat(parts,"、") or "暫無深交"
end

local function seedRelationships()
    relationshipGraph={}
    -- 初始社會脈絡：一段宿怨、兩段友情，以及一段有機會發展成婚姻的熟識。
    seedRelationship("npc_3", "npc_4", 8, 12, 78, 0)
    seedRelationship("npc_2", "npc_7", 68, 62, 2, 12)
    seedRelationship("npc_5", "npc_25", 70, 65, 0, 56)
    seedRelationship("npc_8", "npc_39", 62, 72, 3, 0)
    seedRelationship("npc_9", "npc_18", 58, 56, 0, 8)
    seedRelationship("npc_21", "npc_22", 10, 18, 66, 0)
    seedRelationship("npc_40", "npc_41", 14, 20, 58, 0)
    seedRelationship("npc_61", "npc_62", 18, 22, 52, 0)
end

local function addChronicleEntry(entry: any)
    local actor,target=entry.actor,entry.target
    table.insert(chronicle, 1, entry)
    while #chronicle > CHRONICLE_LIMIT do table.remove(chronicle) end
    local function attach(npc, perspective)
        if not npc then return end
        npc.chronicle=npc.chronicle or {}
        local personal={}
        for key,value in pairs(entry) do if key~="actor" and key~="target" then personal[key]=value end end
        personal.perspective=perspective
        table.insert(npc.chronicle,1,personal)
        while #npc.chronicle > PERSONAL_CHRONICLE_LIMIT do table.remove(npc.chronicle) end
    end
    attach(actor, "actor")
    if target and target~=actor then attach(target, "target") end
    entry.actor=nil; entry.target=nil
end

function addEvent(api: any, message: string, meta: any)
    eventCount += 1
    local event={id=eventCount, text=message, kind=meta and meta.kind or "event",
        actor_id=meta and meta.actor and meta.actor.id or "", target_id=meta and meta.target and meta.target.id or ""}
    table.insert(events, 1, event)
    while #events > 7 do table.remove(events) end
    if meta then
        local clock=Life.clock(worldMinutes)
        addChronicleEntry({id=eventCount,frame=frame,day=clock.day,time=string.format("%02d:%02d",math.floor(clock.hour),clock.minute),
            kind=meta.kind or "event",text=message,reason=meta.reason or "",actor=meta.actor,actor_id=meta.actor and meta.actor.id or "",
            actor_name=meta.actor and meta.actor.name or "",target=meta.target,target_id=meta.target and meta.target.id or "",
            target_name=meta.target and meta.target.name or ""})
    end
    if type(EXTENSIONS.onEvent) == "function" then EXTENSIONS.onEvent(message, eventCount) end
    api.log(message)
end

function Treasure.reset()
    if Treasure.active then ZONES[Treasure.active.id]=nil end
    Treasure.active=nil; Treasure.next_check=360; Treasure.spawned=0; Treasure.claimed=0; Treasure.contests=0
end

function Treasure.snapshot()
    local active=Treasure.active
    local seekers={}
    if active then
        for _,npc in ipairs(npcs) do
            if npc.alive and npc.action=="seek_treasure" then table.insert(seekers,{id=npc.id,name=npc.name}) end
        end
    end
    local owner=active and active.claimed_by~="" and findNpc(active.claimed_by) or nil
    return {version="rare-treasure-v1",spawned=Treasure.spawned,claimed=Treasure.claimed,contests=Treasure.contests,
        next_spawn_in=math.max(0,math.floor((Treasure.next_check-worldMinutes)+.5)),
        active=active and {id=active.id,name=active.name,kind=active.kind,description=active.description,
            position={x=active.x,y=1.2,z=active.z},power=active.power,claimed_by=active.claimed_by,
            claimed_name=owner and owner.name or active.claimed_name or "",remaining_minutes=math.max(0,math.floor((active.expires-worldMinutes)+.5)),
            seekers=seekers} or nil}
end

function Treasure.context(npc)
    local active=Treasure.active
    if not active then return "No rare treasure is currently known; ordinary work, cultivation and relationships remain available." end
    local owner=active.claimed_by~="" and findNpc(active.claimed_by) or nil
    local seekers=0
    for _,other in ipairs(npcs) do if other.alive and other.action=="seek_treasure" then seekers+=1 end end
    if owner then
        return string.format("Rare treasure %s (%s) was claimed by %s and is still at the outskirts; remaining=%d game minutes; nearby rivals may choose negotiation, theft, robbery or attack, but no conflict is automatic. ",
            active.name,active.kind,owner.name,math.max(0,math.floor(active.expires-worldMinutes))).."This resident's distance to the relic is "..math.floor(math.sqrt((npc.x-active.x)^2+(npc.z-active.z)^2)).." world units."
    end
    return string.format("Rare treasure %s (%s) has appeared at world position (%d,%d); value=exceptional; remaining=%d game minutes; current seekers=%d. NanoJev may choose to pursue it, ignore it, cooperate, or accept the risks of competing for it. ",
        active.name,active.kind,active.x,active.z,math.max(0,math.floor(active.expires-worldMinutes)),seekers).."Description: "..active.description.."."
end

function Treasure.claim(api,npc)
    local active=Treasure.active
    if not active or npc.location~=active.id then return false end
    if active.claimed_by~="" then
        Treasure.contests+=1
        addEvent(api,npc.name.."抵達時稀世珍寶已被"..(active.claimed_name or "他人").."奪走",{kind="treasure_contest",actor=npc,reason="NanoJev 選擇爭奪稀世珍寶，但抵達時已失去先機"})
        return false
    end
    active.claimed_by=npc.id; active.claimed_name=npc.name; Treasure.claimed+=1
    npc.inventory.artifacts=(npc.inventory.artifacts or 0)+1
    npc.artifact_power=clamp((npc.artifact_power or 0)+active.power,0,100)
    npc.morale=clamp(npc.morale+8,0,100); npc.lastItemEvent="奪得稀世珍寶："..active.name
    addEvent(api,npc.name.."搶到稀世珍寶「"..active.name.."」，飛劍威力 +"..active.power,{kind="treasure_claim",actor=npc,reason="NanoJev 選擇前往爭奪；抵達後依先機取得寶物"})
    return true
end

function Treasure.tick(api)
    local active=Treasure.active
    if active and worldMinutes>=active.expires then
        addEvent(api,active.name.."的靈光散去，稀世珍寶事件結束",{kind="treasure_expire",reason=active.claimed_by~="" and "持有者未能在期限前穩住局勢" or "無人及時取得寶物"})
        ZONES[active.id]=nil
        for _,npc in ipairs(npcs) do
            if npc.alive and npc.action=="seek_treasure" then
                npc.routeCells=nil; npc.routeTarget=nil; npc.goalCell=nil; npc.interactionDone=true
                npc.interactionResult="稀世珍寶事件已結束，未能取得"
                if npc.task then npc.task.complete=true; Brain.timing(npc) end
            end
        end
        Treasure.active=nil; Treasure.next_check=worldMinutes+360
        active=nil
    end
    if Treasure.active or worldMinutes<Treasure.next_check then return end
    Treasure.next_check=worldMinutes+360
    -- First appearance is guaranteed after the opening half-day; later ones are rare.
    if Treasure.spawned>0 and api.random.nextFloat()>.24 then return end
    local def=RARE_TREASURE_DEFS[math.floor(api.random.nextFloat()*#RARE_TREASURE_DEFS)+1]
    Treasure.spawned+=1
    Treasure.active={id="rare_treasure_"..Treasure.spawned,name=def.name,kind=def.kind,description=def.description,
        x=def.x,z=def.z,power=def.power,claimed_by="",claimed_name="",expires=worldMinutes+1440}
    ZONES[Treasure.active.id]={x=def.x,z=def.z}
    for i,npc in ipairs(npcs) do
        if npc.alive then
            -- A world event is a new consideration, not an emergency that
            -- cancels every in-flight decision. Let each resident finish its
            -- current action and evaluate it at the next staggered decision.
            if not Brain.requests[npc.id] then
                npc.nextDecisionFrame=math.min(npc.nextDecisionFrame or frame,frame+((i-1)%DECISION_INTERVAL))
            end
            npc.planStatus="稀世珍寶現世；下一個決策點由 NanoJev 判斷是否爭奪"
        end
    end
    addEvent(api,"稀世珍寶現世：「"..def.name.."」；消息傳遍兩座城鎮",{kind="treasure_spawn",reason="低頻世界事件出現；是否前往由每個人的 NanoJev 決策、性格、財力與風險判斷"})
end

-- Choice inputs are authored by the game, not by the Python model host.
-- No heuristic weights, poverty override, or fallback chooses the next action.
local TIMED_ACTION={eat=true,eat_packed=true,use_medicine=true,use_supplies=true,use_pill=true,buy_food=true,buy_herbs=true,shop=true,seek_manual=true,alchemy=true,forge_artifact=true,find_work=true,seek_treasure=true}
local PRODUCTIVE_ACTION={work=true,train=true,cultivate=true,gather=true,hunt=true,hunt_monster=true}
function Brain.sampleMinutes(npc,action,low,high)
    -- Stable start-local variation: publishing/ticking never draws again or changes combat RNG.
    local hash=(frame+Brain.started*97)%65521
    for i=1,#(npc.id..action) do hash=(hash*31+string.byte(npc.id..action,i))%65521 end
    local state=action=="rest" and (npc.fatigue or 0) or action=="eat" and (npc.hunger or 0) or Persona.trait(npc,"discipline")
    local fraction=.7*(hash/65521)+.3*clamp(state,0,100)/100
    return math.floor(low+(high-low)*fraction+.5)
end
function Brain.ready(npc)
    return npc.alive and not Pair.occupied(npc) and not npc.reservedX and npc.location==targetZone(npc)
        and (not npc.routeCells or (npc.routeIndex or 1)>#npc.routeCells)
end
function Brain.executionMinutes(npc)
    if not Brain.ready(npc) then return 0 end
    return math.max(0,worldMinutes-math.max(npc.lastTaskMinute or worldMinutes,npc.executionSince or worldMinutes))
end
function Brain.timing(npc)
    local t=npc.task; if not t then return end
    t.elapsed_minutes=t.minutes or 0
    if t.timing_kind=="combat" then t.duration_minutes=nil; t.remaining_minutes=nil; t.progress=nil; return end
    if PRODUCTIVE_ACTION[npc.action] then
        t.remaining_minutes=math.max(0,8-(t.effort or 0))*(t.effort_minutes or 4)/math.max(.001,Condition.effort(npc))
        t.progress=clamp((t.effort or 0)/8,0,1)
    else
        t.remaining_minutes=math.max(0,(t.duration_minutes or 0)-t.elapsed_minutes)
        t.progress=(t.duration_minutes or 0)>0 and clamp(t.elapsed_minutes/t.duration_minutes,0,1) or 0
    end
    if t.complete then t.remaining_minutes=0; if not t.failed then t.progress=1 end end
end
-- Execution units are world rules, never intention selectors. Plan timing is a model choice.
function Brain.unitDescription(npc)
    local a=npc.action
    if PAIR_ACTION[a] or PAIR_RESPONSE[a] then return "Named pair: approach, 90s real response window, shared timed performance; settle once. Silence is not consent." end
    if a=="attack" then return "Maintain the chosen confrontation; strike until the opponent dies, escapes, yields, or NanoJev changes the intention. The opponent may counterattack only after choosing it." end
    if a=="hunt_monster" then return "Accept one guild monster contract; travel to the outskirts and exchange flying-sword strikes with one monster until it dies, flees, or you retreat." end
    if a=="find_work" then return "Spend time at the job board and accept one available employer contract." end
    if a=="seek_treasure" then return "Travel to the rare treasure site, search for the relic, and accept the risk that another resident reaches it first." end
    if a=="cultivate" then return "Train internal energy at the cultivation platform; spend timed effort to increase qi and cultivation." end
    if a=="seek_manual" then return "Search the archive for a compatible cultivation manual; success depends on time, curiosity and existing manuals." end
    if a=="alchemy" then return "Refine one pill in the dan room; consumes one carried herb and yields one pill if materials are available." end
    if a=="forge_artifact" then return "Forge one spiritual artifact at the forge; consumes one carried supply and improves flying-sword power." end
    if a=="apprentice" then return "Ask the named resident for mentorship; explicit acceptance and a shared timed session establish a master-disciple bond." end
    if a=="use_pill" then return "Take one carried pill here; it raises qi and cultivation once the timed unit completes." end
    if a=="rest" then return "Timed rest at home; after completion stay resting until next intention." end
    if a=="travel" then return "Reach one waypoint, dwell, stop; travel time excluded from dwell." end
    if a=="wait" then return "Finite timed wait here." end
    if INTERACTION_ACTION[a] then return "One interaction attempt with the selected person." end
    if TIMED_ACTION[a] then return "Timed at destination; consume/pay once at end, no reward if interrupted." end
    return "8 effort at destination, about 4min/effort; condition/pace changes time, not shift wages."
end
function Brain.failUnit(npc,reason)
    if npc.reservedX then return end -- Preserve the in-flight grid reservation until the safe boundary.
    npc.task=npc.task or {ticks=0,effort=0,minutes=0}
    npc.task.complete=true; npc.task.failed=true
    Brain.timing(npc)
    npc.interactionDone=true; npc.interactionResult="執行失敗："..reason
    npc.planStatus="本段因體況失敗，未算完成生產；保留 NanoJev 的預定行動與時機"
end
function Brain.startPlan(api,npc,plan)
    local person=plan.target~="none" and findNpc(plan.target)
    if isStunned(npc) and not npc.combat then
        npc.nextPlan=nil; npc.planStatus="短暫昏迷中，等待恢復後再執行 NanoJev 的選擇"; Brain.requests[npc.id]=nil; return
    end
    if PAIR_RESPONSE[plan.action] and not Pair.validResponse(npc,plan.action,plan.target,plan.pair_id,plan.pair_basis) then
        npc.nextPlan=nil; npc.planStatus="回應失效：原互動已結束或對象不符；等待 NanoJev"; return
    end
    if INTERACTION_ACTION[plan.action] and plan.target~="none" and (not person or not person.alive) then
        npc.planStatus="預定對象已不存在；取消預定，等待 NanoJev 重想"
        npc.nextPlan=nil; return
    end
    local sameIntent=npc.action==plan.action and npc.interactionTargetId==(person and person.id or nil)
    if npc.monsterCombat then
        if plan.action=="hunt_monster" then
            npc.nextPlan=nil; npc.planStatus="同一斬妖委託持續執行，不重啟戰鬥"; Brain.requests[npc.id]=nil; return
        end
        MonsterCombat.finish(api,MonsterCombat.find(npc.monsterCombat.id),"NanoJev 選擇離開斬妖戰鬥，保留傷勢與後果",false)
    end
    if sameIntent and plan.timing~="interrupt_now" and npc.routeCells and (npc.routeIndex or 1)<=#npc.routeCells then
        npc.nextPlan=nil; npc.planStatus="同一意圖持續前往，不重啟路程"
        Brain.requests[npc.id]=nil; return
    end
    if npc.combat then
        local bout=Combat.find(npc.combat.id)
        local opponent=Combat.opponent(npc)
        if not bout or not opponent then npc.combat=nil; npc.combatIntent=nil; return end
        if bout.phase=="aftermath" then
            local winner=npc==bout.winner
            local choice=plan.action
            npc.nextPlan=nil; Brain.requests[npc.id]=nil
            if winner and (choice=="finish_kill" or choice=="finish_loot" or choice=="finish_knockout" or choice=="finish_spare") then
                Combat.resolveAftermath(api,bout,choice)
                return
            elseif not winner and choice=="leave" then
                Combat.resolveAftermath(api,bout,"escape")
                return
            elseif not winner and choice=="resist" then
                Combat.resumeAftermath(api,bout)
                return
            end
            npc.combatIntent="hold"; npc.planStatus=winner and "勝者暫不處置，等待下一個 NanoJev 決策" or "敗者選擇停手，等待勝者處置"
            npc.thinking={source="NanoJev",mode="NanoJev／人物決策",chosen=choice,chosen_score=0,candidates={},
                motive="NanoJev 在交鋒後選擇暫停；處置尚未改變，等待下一輪情境決策。",request_id=plan.request_id,updated_frame=frame,request_frame=plan.created_frame}
            return
        end
        if plan.action=="attack" and plan.target==opponent.id and bout.mode=="attack" then
            npc.combatIntent="counterattack"
            npc.interactionTargetId=opponent.id; npc.interactionTargetName=opponent.name
            npc.nextPlan=nil; npc.planStatus="NanoJev 選擇反擊；交鋒持續，等待下一個安全決策點"
            npc.interactionDone=false
            Brain.requests[npc.id]=nil
            npc.thinking={source="NanoJev",mode="NanoJev／人物決策",chosen="attack",chosen_score=0,candidates={},
                motive="NanoJev 選擇在交鋒中反擊；考量對手、傷勢、恐懼、性格與關係。",request_id=plan.request_id,updated_frame=frame,request_frame=plan.created_frame}
            return
        elseif plan.action=="wait" and plan.target=="none" then
            npc.combatIntent="hold"
            npc.nextPlan=nil; npc.planStatus="NanoJev 選擇暫避；沒有反擊，交鋒仍由雙方狀態決定"
            Brain.requests[npc.id]=nil
            npc.thinking={source="NanoJev",mode="NanoJev／人物決策",chosen="wait",chosen_score=0,candidates={},
                motive="NanoJev 選擇在交鋒中觀望或尋找脫身時機。",request_id=plan.request_id,updated_frame=frame,request_frame=plan.created_frame}
            return
        end
        -- Leave, rob, spare-by-leaving, or another explicit model choice ends
        -- this bout before the normal action is applied below.
        Combat.finish(api,bout,"交鋒中止：NanoJev 改變行動")
    end
    if npc.pair and not PAIR_RESPONSE[plan.action] and (npc.pair.a==npc or npc.pair.accepted) then Pair.finish(api,npc.pair,"cancelled","已採用的新行動中止互動") end
    Life.tick(npc,math.max(0,worldMinutes-(npc.lastNeedsMinute or worldMinutes)),Life.clock(worldMinutes)); npc.lastNeedsMinute=worldMinutes
    npc.action=plan.action
    npc.interactionTargetId=person and person.id or nil
    npc.interactionTargetName=person and person.name or ""
    npc.interactionDone=false; npc.interactionResult=""; npc.itemActionDone=false
    npc.interactionZone=npc.location; npc.routeCells=nil
    npc.task={ticks=0,effort=0,minutes=0,complete=false,started_frame=frame}; npc.lastTaskMinute=worldMinutes
    local a=plan.action
    local low,high=10,30
    if a=="rest" then low,high=20,90; if Life.clock(worldMinutes).is_night then low,high=240,480 end
    elseif a=="eat" then low,high=12,30
    elseif a=="eat_packed" then low,high=8,18
    elseif a=="use_medicine" or a=="use_supplies" then low,high=6,15
    elseif a=="use_pill" then low,high=6,15
    elseif a=="seek_manual" then low,high=18,42
    elseif a=="alchemy" then low,high=16,34
    elseif a=="forge_artifact" then low,high=22,48
    elseif a=="shop" or a=="buy_food" or a=="buy_herbs" then low,high=5,15
    elseif a=="find_work" then low,high=16,30
    elseif a=="seek_treasure" then low,high=12,28
    elseif a=="travel" then
        low,high=2,6
        local stops={"market","gate","inn","school"}
        npc.patrolIndex=((npc.patrolIndex or 0)%#stops)+1; npc.patrolZone=stops[npc.patrolIndex]
    end
    npc.task.duration_minutes=Brain.sampleMinutes(npc,a,low,high)
    npc.task.timing_kind=a=="travel" and "waypoint_dwell" or "execution"
    if PRODUCTIVE_ACTION[a] then
        npc.task.effort_minutes=Brain.sampleMinutes(npc,a,36,44)/10
        npc.task.duration_minutes=8*npc.task.effort_minutes/math.max(.001,Condition.effort(npc)); npc.task.duration_estimated=true; npc.task.timing_kind="effort"
    elseif PAIR_ACTION[a] or PAIR_RESPONSE[a] or a=="attack" then
        npc.task.duration_minutes=nil; npc.task.timing_kind="shared_or_response"
    end
    npc.executionSince=Brain.ready(npc) and worldMinutes or nil
    Brain.timing(npc)
    npc.thinking={source="NanoJev",mode="NanoJev／人物決策",chosen=plan.action,chosen_score=0,candidates={},
        motive="NanoJev 選擇「"..ACTION_LABEL[plan.action].."」；輸入包含價值觀、感情觀、人格、內在矛盾、目前進度、需求、錢袋與關係。這是決策紀錄，不是模型生成的文字推理。",
        request_id=plan.request_id,updated_frame=frame,request_frame=plan.created_frame}
    npc.planStatus=plan.timing=="interrupt_now" and "NanoJev 決定改變當前行動" or "上一段完成，接續 NanoJev 的預定行動"
    npc.nextPlan=nil
    -- Requests based on the previous current action are now stale.
    Brain.requests[npc.id]=nil; Brain.started+=1
    addEvent(api,"開始："..npc.name.." → "..ACTION_LABEL[plan.action]..(person and (" · "..person.name) or ""),{kind="action",actor=npc,target=person,reason=npc.thinking.motive})
    if PAIR_ACTION[plan.action] then Pair.begin(api,npc,person,plan.action,plan.request_id)
    elseif PAIR_RESPONSE[plan.action] then Pair.respond(api,npc,plan) end
end
function Brain.advancePlans(api)
    for _,npc in ipairs(npcs) do
        local plan=npc.nextPlan
        -- Never discard a grid reservation halfway through a step.
        if npc.alive and plan and not npc.reservedX and (plan.timing=="interrupt_now" or not npc.task or npc.task.complete) then
            Brain.startPlan(api,npc,plan)
        end
    end
end
function Brain.progress(npc,minutes,effort)
    if not npc.alive then return end
    if isStunned(npc) then return end
    if npc.combat then return end -- Combat.tick owns both participants.
    if npc.monsterCombat then return end -- MonsterCombat.tick owns the contract.
    local task=npc.task
    local a=npc.action
    local productive=PRODUCTIVE_ACTION[a]
    if PAIR_ACTION[a] or PAIR_RESPONSE[a] then
        if a=="leave" and not npc.pair and not npc.reservedX then
            if npc.location==npc.residence then npc.interactionDone=true; npc.interactionResult="已抵達住處，離開單位完成"
            elseif npc.leaveDeadline and Pair.clock>=npc.leaveDeadline then npc.interactionDone=true; task.failed=true; npc.interactionResult="離開單位逾時：尚未抵達住處" end
        end
        if task and not task.complete then task.complete=npc.interactionDone==true; Brain.timing(npc) end
        return
    end
    if task and not task.complete and not npc.reservedX and (productive or a=="attack" or a=="duel") and Condition.effort(npc)<=0 then
        Brain.failUnit(npc,"傷勢達上限，無法勞動、修練或出招"); return
    end
    if task and npc.action=="duel" then
        if not npc.combat then task.ticks+=1; task.minutes+=minutes end
        if task.ticks>=60 and not npc.combat then npc.interactionDone=true; npc.interactionResult="等候切磋對手逾時；交回 NanoJev 規劃" end
        task.complete=npc.interactionDone==true; return
    end
    if task and npc.action=="attack" then task.complete=npc.interactionDone==true; return end
    if not task or task.complete or not Brain.ready(npc) or minutes<=0 then return end
    task.ticks+=1
    if productive then task.effort=math.min(8,(task.effort or 0)+(effort or minutes/(task.effort_minutes or 4)*Condition.effort(npc))) end
    task.minutes+=minutes
    if INTERACTION_ACTION[a] then task.complete=npc.interactionDone==true
    elseif PORTABLE_ACTION[a] or a=="buy_food" or a=="buy_herbs" or a=="shop" or a=="eat" or a=="help" then task.complete=npc.itemActionDone==true
    elseif productive then task.complete=(task.effort or 0)>=8-1e-9
    else task.complete=task.minutes>=(task.duration_minutes or math.huge)-1e-9 end
    Brain.timing(npc)
end

-- Small bounded two-person execution sessions. No participant action or timing is chosen here.
function Pair.known(npc)
    local p=npc.pair
    return p and not p.done and (p.a==npc or p.kind~="theft" or p.noticed) and p or nil
end
function Pair.basis(npc)
    local p=Pair.known(npc)
    return p and (p.id..":"..p.phase) or ""
end
function Pair.near(p)
    return not p.a.reservedX and not p.b.reservedX and (p.a.x-p.b.x)^2+(p.a.z-p.b.z)^2<=9
end
function Pair.view(npc,model)
    local p=model and Pair.known(npc) or npc.pair
    if model and not Pair.known(npc) then return nil end
    if not p or p.done then return nil end
    local other=p.a==npc and p.b or p.a
    local role=p.patient==npc and "patient" or p.provider==npc and "provider" or p.a==npc and "initiator" or "recipient"
    local labels={treatment={patient="被治療",provider="提供治療"},proposal={initiator="求婚",recipient="收到求婚"},mentorship={initiator="請求拜師",recipient="收到拜師請求"},
        family={initiator="商量生子",recipient="收到成家邀請"},
        duel={initiator="邀請切磋",recipient="受邀切磋"},theft={initiator="偷竊嘗試",recipient="偷竊對象"},robbery={initiator="搶劫嘗試",recipient="遭到威脅"},
        social={initiator="邀請交談",recipient="受邀交談"},cooperate={initiator="提出合作",recipient="受邀合作"},flirt={initiator="示好",recipient="收到示好"}}
    local phases={approach="接近中",awaiting_response="等待明確回應",performing="執行中"}
    local head=labels[p.kind][role].." · "..other.name.." · "..phases[p.phase]
    local consent=p.kind=="duel" and (p.accepted and "mutual" or "pending") or p.kind=="theft" and (p.noticed and "detected_no_consent" or "hidden_no_consent") or p.kind=="robbery" and "threat_no_consent" or "mutual_request"
    return {id=p.id,kind=p.kind,role=role,phase=p.phase,consent=consent,counterpart_id=other.id,counterpart_name=other.name,
        initiator_request_id=p.initiator_request_id,response_request_id=p.response_request_id or "",noticed=p.noticed==true,
        head_label=head,summary=head..(p.kind=="theft" and not p.noticed and (npc==p.a and "（對方未察覺，非同意）" or "（本人尚未察覺，非同意）") or ""),
        deadline_seconds=math.max(0,p.deadline-Pair.clock),source=p.source or "",
        duration_minutes=p.duration_minutes,elapsed_minutes=p.elapsed_minutes,
        remaining_minutes=p.duration_minutes and math.max(0,p.duration_minutes-p.elapsed_minutes) or nil,
        timing_kind=p.bout and "combat" or p.phase=="performing" and "shared_execution" or "response"}
end
function Pair.refresh(p)
    for _,n in ipairs({p.a,p.b}) do if Pair.known(n) then Brain.requests[n.id]=nil end end
end
function Pair.finish(api:any,p:any,phase:string,summary:string,amount:number?)
    if not p or p.done then return end
    p.done=true
    for _,n in ipairs({p.a,p.b}) do
        local known=n==p.a or p.kind~="theft" or p.noticed
        local other=n==p.a and p.b or p.a
        n.lastInteraction={id=p.id,kind=p.kind,phase=phase,counterpart_id=other.id,counterpart_name=other.name,
            summary=summary,amount=amount or 0,initiator_request_id=p.initiator_request_id,response_request_id=p.response_request_id or ""}
        if known then Brain.requests[n.id]=nil; n.lastKnownInteraction={kind=p.kind,phase=phase,other_id=other.id,amount=amount or 0} end
        if n==p.a or (p.response_request_id and n.thinking and n.thinking.request_id==p.response_request_id) then
            n.interactionDone=true; n.interactionResult=summary
            if n.task then n.task.complete=true; n.task.failed=phase~="settled"; Brain.timing(n) end
        end
        if n.nextPlan and n.nextPlan.pair_id==p.id then n.nextPlan=nil; n.planStatus="原互動已結束，過期回應取消" end
        if n.pair==p then n.pair=nil; if n==p.a or p.accepted or p.response_request_id then n.routeCells=nil end end -- Keep in-flight reservations; leave unaware ordinary routes alone.
    end
    if p.bout and not p.bout.done then Combat.finish(api,p.bout,summary) end
    Pair.sessions[p.id]=nil
    addEvent(api,summary,{kind=p.kind,actor=p.a,target=p.b,reason=summary})
end
function Pair.validResponse(npc,action,target,id,basis)
    local p=Pair.known(npc)
    if not p or p.b~=npc or p.id~=id or p.phase~="awaiting_response" or Pair.basis(npc)~=basis or target~=p.a.id then return false end
    if action=="refuse" then return p.kind~="robbery" and p.kind~="theft" end
    if p.kind=="robbery" then return action=="yield" or action=="resist" or action=="leave" end
    if p.kind=="theft" then return action=="resist" or action=="leave" end
    return action=="accept"
end
function Pair.atClinic(npc)
    return (npc.x-ZONES.clinic.x)^2+(npc.z-ZONES.clinic.z)^2<=36
end
function Pair.begin(api,a,b,action,requestId)
    local function fail(reason)
        a.interactionDone=true; a.interactionResult="互動未開始："..reason
        if a.task then a.task.complete=true; a.task.failed=true end
        return nil
    end
    if not b or a==b or not a.alive or not b.alive then return fail("需要另一位存活對象") end
    if a.pair or b.pair or a.combat or b.combat then return fail("其中一方已有互動或交鋒") end
    local kind=PAIR_ACTION[action]
    local provider=kind=="treatment" and (action=="help" and b or a) or nil
    local patient=provider and (provider==a and b or a) or nil
    if patient and (patient.injury<=0 or Condition.effort(provider)<=0 or (provider.job.firm~="clinic" and provider.inventory.herbs<1)) then return fail("沒有傷勢或提供者沒有可用治療來源／體況") end
    if kind=="proposal" and (a.partnerId or b.partnerId) then return fail("其中一方已有伴侶") end
    if kind=="family" and (not Family.canHaveChild(a,b)) then return fail("夫妻條件、年齡、性別或生育間隔不符") end
    if kind=="duel" and (a.injury>=75 or b.injury>=75) then return fail("傷勢不適合非致命切磋") end
    if (kind=="theft" or kind=="robbery") and Condition.effort(a)<=0 then return fail("體況無法執行") end
    Pair.sequence+=1
    local p={id="pair_"..Pair.epoch.."_"..Pair.sequence,a=a,b=b,action=action,kind=kind,phase="approach",deadline=Pair.clock+90,
        initiator_request_id=requestId,provider=provider,patient=patient,noticed=kind~="theft"}
    local ranges={treatment={16,36},proposal={12,28},mentorship={20,40},family={30,60},social={12,32},cooperate={20,40},flirt={12,30},theft={8,18},robbery={6,15},duel={32,64}}
    local range=ranges[kind]; p.duration_minutes=kind~="duel" and Brain.sampleMinutes(a,action,range[1],range[2]) or nil; p.elapsed_minutes=0
    if provider then p.source=provider.job.firm=="clinic" and Pair.atClinic(provider) and "clinic" or "carried_herb" end
    a.pair=p; b.pair=p; a.routeCells=nil; Pair.sessions[p.id]=p
    a.proposedTo=nil; b.proposedTo=nil; Pair.refresh(p)
    return p
end
function Pair.respond(api,npc,plan)
    if not Pair.validResponse(npc,plan.action,plan.target,plan.pair_id,plan.pair_basis) then return end
    local p=npc.pair
    p.response_request_id=plan.request_id; p.response=plan.action
    if plan.action=="refuse" then Pair.finish(api,p,"cancelled",npc.name.."明確拒絕了"..p.a.name.."的互動"); return end
    if plan.action=="leave" then
        npc.interactionDone=false; npc.task.complete=false; npc.task.failed=false; npc.leaveDeadline=p.deadline
        npc.interactionResult="已選擇往住處離開；尚未實際脫離威脅"; return
    end
    if plan.action=="resist" then
        p.accepted=false; p.phase="performing"; p.deadline=Pair.clock+30
        local started=Combat.begin(api,npc,p.a,"attack",p)
        if not started then Pair.finish(api,p,"cancelled","反抗未能開始：體況或交鋒狀態不符") end
    else p.accepted=true; p.phase="approach"; p.deadline=Pair.clock+90 end
    Pair.refresh(p)
end
function Pair.seize(api,p,voluntary)
    if not Pair.near(p) or not p.a.alive or not p.b.alive then Pair.finish(api,p,"cancelled","對象已離開，未取得錢財"); return end
    local success=voluntary or api.random.nextFloat()<clamp(.45+.25*(Condition.effort(p.a)-Condition.factor(p.b)),.1,.8)
    local amount=success and math.min(18,p.b.wealth) or 0
    if amount>0 and Economy.transfer(p.b,p.a,amount,p.kind=="theft" and "theft" or "robbery",p.kind=="theft" and "實際偷竊" or "實際搶劫") then
        storyStats.schemes+=1
        if p.noticed then
            local r=getRelationship(p.a,p.b); r.trust=clamp(r.trust-15,0,100); r.resentment=clamp(r.resentment+20,0,100)
            p.b.suspicion=clamp(p.b.suspicion+22,0,100); Persona.react(p.b,"robbed",{{"sensitivity","morale",-4}})
        end
    else amount=0 end
    Pair.finish(api,p,amount>0 and "settled" or "failed",p.a.name..(voluntary and "收到對方明確交出的" or p.kind=="theft" and "偷竊結果：取得" or "強取結果（非同意）：取得")..amount.." 文",amount)
end
function Pair.tick(api:any,dt:number)
    if paused then return end
    Pair.clock+=dt -- Model response latency does not accelerate with simulation speed.
    local pending:any={}; for _,p in pairs(Pair.sessions) do table.insert(pending,p) end
    table.sort(pending,function(a,b) return a.id<b.id end)
    for _,p in ipairs(pending) do
        if p.done then continue end
        if not p.a.alive or not p.b.alive then Pair.finish(api,p,"cancelled","互動中止：有人死亡，未結算"); continue end
        if not p.bout and (not p.a.thinking or p.a.thinking.request_id~=p.initiator_request_id or ((p.accepted or p.response=="resist") and p.response_request_id and (not p.b.thinking or p.b.thinking.request_id~=p.response_request_id))) then
            Pair.finish(api,p,"cancelled","互動中止：參與者已採用不同決策"); continue
        end
        if p.phase=="awaiting_response" and (p.kind=="theft" or p.kind=="robbery") and (p.a.x-p.b.x)^2+(p.a.z-p.b.z)^2>9 then
            Pair.finish(api,p,"cancelled","對象已實際離開威脅範圍，未取得錢財"); continue
        end
        if Pair.clock>=p.deadline and not p.bout then
            if p.phase=="awaiting_response" and (p.kind=="robbery" or p.kind=="theft") then Pair.seize(api,p,false)
            else Pair.finish(api,p,"cancelled","互動逾時：未完成；沒有把沉默當同意") end
            continue
        end
        if p.phase=="approach" and Pair.near(p) then
            if p.accepted then
                p.phase="performing"; p.deadline=Pair.clock+90
                for _,n in ipairs({p.a,p.b}) do if n.task then n.task.duration_minutes=p.duration_minutes; n.task.minutes=0; n.task.timing_kind="shared_execution"; Brain.timing(n) end end
                if p.kind=="duel" and not Combat.begin(api,p.a,p.b,"duel",p) then Pair.finish(api,p,"cancelled","切磋未開始：狀態不符") end
            elseif p.kind=="theft" then
                p.noticed=api.random.nextFloat()<.4
                if p.noticed and not p.detectedReaction then
                    p.detectedReaction=true
                    local relation=getRelationship(p.a,p.b)
                    relation.trust=clamp(relation.trust-10,0,100); relation.resentment=clamp(relation.resentment+14,0,100)
                    p.b.suspicion=clamp((p.b.suspicion or 0)+22,0,100)
                    Persona.react(p.b,"robbed",{{"sensitivity","morale",-4}})
                    addEvent(api,p.b.name.."當場發現"..p.a.name.."偷竊；信任下降，是否反擊由受害者自行決定",{kind="theft_detected",actor=p.a,target=p.b,reason="偷竊被發現但不自動視為同意或自動開戰"})
                end
                p.phase=p.noticed and "awaiting_response" or "performing"; p.deadline=Pair.clock+90
            else p.phase="awaiting_response"; p.deadline=Pair.clock+90 end
            Pair.refresh(p)
        elseif p.phase=="performing" and not p.bout then
            if not Pair.near(p) then Pair.finish(api,p,"cancelled","互動中止：雙方已離開共同位置，未結算"); continue end
            p.elapsed_minutes=math.min(p.duration_minutes,p.elapsed_minutes+dt*8*speed)
            for _,n in ipairs({p.a,p.b}) do
                if n.task and (n==p.a or p.accepted) then
                    n.task.duration_minutes=p.duration_minutes; n.task.minutes=p.elapsed_minutes; n.task.timing_kind="shared_execution"; Brain.timing(n)
                end
            end
            if p.elapsed_minutes<p.duration_minutes then continue end
            if p.kind=="theft" or p.kind=="robbery" then Pair.seize(api,p,p.response=="yield")
            elseif p.kind=="proposal" then
                if p.a.partnerId or p.b.partnerId then Pair.finish(api,p,"failed","求婚未成立：伴侶狀態已改變")
                else local r=getRelationship(p.a,p.b); r.married=true; p.a.partnerId=p.b.id; p.b.partnerId=p.a.id
                    Pair.finish(api,p,"settled",p.a.name.."與"..p.b.name.."分別選擇求婚與接受，完成婚約") end
            elseif p.kind=="family" then
                if Family.birth(api,p.a,p.b) then
                    Pair.finish(api,p,"settled",p.a.name.."與"..p.b.name.."共同迎來新生命")
                else
                    Pair.finish(api,p,"failed","生育未完成：夫妻狀態或生育條件已改變")
                end
            elseif p.kind=="treatment" then
                local provider,patient=p.provider,p.patient
                local paid=false
                if patient.injury>0 then
                    if p.source=="clinic" then
                        if provider.job.firm=="clinic" and Pair.atClinic(provider) and Pair.atClinic(patient) then paid=Economy.buy(patient,"clinic","herbs") end
                    else paid=Economy.useItem(provider,"herbs") end
                end
                if paid then patient.injury=clamp(patient.injury-12,0,100); Pair.finish(api,p,"settled",provider.name.."治療"..patient.name.."，消耗一份藥材，傷勢減少 12")
                else Pair.finish(api,p,"failed","治療未完成：傷勢、位置、錢財或藥材不足；未治癒") end
            elseif p.kind=="mentorship" then
                local student,master=p.a,p.b
                local relation=getRelationship(student,master)
                student.mentorId=master.id; student.mentorSinceDay=Life.clock(worldMinutes).day
                student.technique=master.technique or student.technique
                student.cultivation=clamp((student.cultivation or 0)+5,0,100)
                student.qi=clamp((student.qi or 0)+8,0,100)
                refreshCultivation(student)
                relation.encounters+=1; relation.affinity=clamp(relation.affinity+8,0,100); relation.trust=clamp(relation.trust+10,0,100)
                Persona.react(student,"mentorship",{{"discipline","morale",3},{"curiosity","loneliness",-4}})
                student.lastItemEvent="拜"..master.name.."為師，開始學習"..(student.technique or "基礎吐納")
                master.lastItemEvent="收"..student.name.."為徒，傳授"..(master.technique or "基礎吐納")
                Pair.finish(api,p,"settled",student.name.."拜"..master.name.."為師；開始學習"..(student.technique or "基礎吐納"))
            else
                local a,b=p.a,p.b
                local relation=getRelationship(a,b); local before=relationshipStage(relation)
                relation.encounters+=1; relation.affinity=clamp(relation.affinity+3,0,100); relation.trust=clamp(relation.trust+1,0,100)
                if p.kind=="cooperate" then
                    Persona.react(a,"cooperate",{{"sociability","loneliness",-13},{"empathy","morale",2}})
                    relation.cooperation+=1; storyStats.cooperations+=1; relation.trust=clamp(relation.trust+3,0,100); b.fatigue=clamp(b.fatigue-2,0,100)
                else
                    Persona.react(a,"social",{{"sociability","loneliness",-13}}); a.morale=clamp(a.morale+2,0,100)
                    if p.kind=="flirt" then relation.romance=clamp(relation.romance+8,0,100); Pair.jealousy(api,a,b) end
                end
                local after=relationshipStage(relation)
                if after~=before then addEvent(api,"關係變化："..a.name.."與"..b.name.."："..before.." → "..after.."；雙方已接受並完成互動",{kind="relationship",actor=a,target=b,reason="完成雙人互動後關係階段改變"}) end
                Pair.finish(api,p,"settled",a.name.."與"..b.name.."已同意並完成"..ACTION_LABEL[p.action])
            end
        end
    end
end
local function discipleCount(npc)
    local count=0
    for _,other in ipairs(npcs) do if other.mentorId==npc.id then count+=1 end end
    return count
end
local function buildDecisionRequest(npc)
    local needs=Condition.needsPriority(npc)
    local peers={}
    for _,other in ipairs(npcs) do
        local distance=(npc.x-other.x)^2+(npc.z-other.z)^2
        if other.alive and other.id~=npc.id and distance<=100 then
            table.insert(peers,{npc=other,distance=distance})
        end
    end
    table.sort(peers,function(a,b) if a.distance==b.distance then return a.npc.id<b.npc.id end; return a.distance<b.distance end)
    -- A known counterpart or one public clinic employee stays addressable; no hidden thief is promoted.
    local known=Pair.known(npc)
    local combatOpponent=Combat.opponent(npc)
    local revengeTarget=nil
    if npc.grudges then
        for _,other in ipairs(npcs) do
            if other.alive and npc.grudges[other.id] then revengeTarget=other; break end
        end
    end
    local required=combatOpponent or (known and (known.a==npc and known.b or known.a)) or revengeTarget
    if not required then for _,other in ipairs(npcs) do if other.alive and other.id~=npc.id and other.job.firm=="clinic" then required=other; break end end end
    if required then
        for i=#peers,1,-1 do if peers[i].npc==required then table.remove(peers,i) end end
        table.insert(peers,1,{npc=required,distance=(npc.x-required.x)^2+(npc.z-required.z)^2})
    end
    local descriptions={}
    local targets={none="No specific person."}
    for i=1,math.min(4,#peers) do
        local other=peers[i].npc
        local r=relationshipGraph[relationKey(npc.id,other.id)]
        local description=string.format("%s role=%s; cash=%d, martial=%d, cultivation=%d; affinity=%d, trust=%d, resentment=%d, romance=%d; partner=%s; herbs=%d, clinic=%s, injury=%d, at_clinic=%s",
            other.id,modelRole(other),other.wealth,math.floor(other.martial or 0),math.floor(other.cultivation or 0),
            r and r.affinity or 12,r and r.trust or 20,r and r.resentment or 0,r and r.romance or 0,
            other.partnerId or "none",other.inventory.herbs,tostring(other.job.firm=="clinic"),math.floor(other.injury),tostring(Pair.atClinic(other)))
        targets[other.id]=description; table.insert(descriptions,description)
    end
    local criteria={
        work="Honor your active employment contract: go to the assigned workplace and earn the stated wage. Do not change employer just because the next intention is different.",
        rest="Go home: day rest 20-90 game minutes, night sleep 240-480. Recover fatigue 0.5/min (night 0.75), only at home; stay resting after unit until next intention.",
        eat="Eat at inn for 12-30 game minutes, then pay meal price and reduce hunger 36 once. Fails without stock/money.",
        help="Ask named provider; accept and 16-36 game minutes nearby. Clinic employee at clinic uses clinic herb and your money; otherwise provider spends carried herb. Heal 12 at completion.",
        treat="Offer named patient treatment; accept and 16-36 game minutes together. Clinic charges patient one herb price; field care uses your herb, no fee.",
        train="Practise martial arts. Raises skill and fatigue.",
        cultivate="Train internal energy at the cultivation platform; spend a timed effort unit to increase qi and cultivation.",
        seek_manual="Search the archive for a compatible cultivation manual; success depends on time, curiosity and existing manuals.",
        alchemy="Refine one pill in the dan room; consumes one carried herb and yields one pill if materials are available.",
        forge_artifact="Forge one spiritual artifact at the forge; consumes one carried supply and improves flying-sword power.",
        have_child="Ask your spouse to start a family; explicit acceptance and a 30-60 minute shared session creates one child record. Only married opposite-sex adults with fewer than three children can choose this.",
        duel="Invite a named nearby resident to nonlethal flying-sword sparring; explicit accept, both within 3 units. No arena is required. Health stays at least 25. Martial skill, honor, rivalry or resentment make this a plausible choice. No automatic opponent or acceptance.",
        hunt="Hunt at the den; skill/fatigue rise. Each 4 executed game minutes causes 1 injury; injury 100 kills. Only hunters earn their job wage.",
        travel="Walk the town patrol route.",
        shop="Spend 5-15 game minutes at market, then buy/carry one supply at stated price. Use separately; cap two.",
        buy_food="Spend 5-15 game minutes at inn, then buy/carry one ration at meal price; cap three.",
        buy_herbs="Spend 5-15 game minutes at clinic, then buy/carry one herb at herb price; cap two.",
        wait="Stay here for 10-30 game minutes."
    }
    if Treasure.active and Treasure.active.claimed_by=="" then
        criteria.seek_treasure="Pursue the rare treasure at its public location; spend 12-28 game minutes searching when you arrive. Other residents may compete, cooperate, or reach it first. This is a risky opportunity, not a forced priority."
    end
    if Economy.jobSearchNeeded(npc) then
        criteria.work=nil
        criteria.find_work="Search the job board for one available employer contract; accept a new job only because the previous contract is suspended or missing. Do not switch jobs while an active contract remains."
    else
        criteria.find_work=nil
    end
    if npc.inventory.food>0 then criteria.eat_packed="Eat here for 8-18 game minutes; then consume one ration, hunger -36. No payment." end
    if npc.inventory.herbs>0 then criteria.use_medicine="Treat yourself here for 6-15 game minutes; then consume one herb, injury -12. No payment." end
    if npc.inventory.wares>0 then criteria.use_supplies="Use supplies here for 6-15 game minutes; then consume one, supplies need -45." end
    if npc.inventory.pills>0 then criteria.use_pill="Take one carried pill here for 6-15 game minutes; consume one pill and raise qi and cultivation." end
    if npc.job.output=="herbs" then criteria.gather="Gather herbs at the herb field for your employer's wage." end
    if npc.job.firm=="guild" or npc.role=="斬妖師" or npc.role=="賞金獵人" or npc.martial>=35 then criteria.hunt_monster="Accept one guild monster contract; reach the wild outskirts, fight one monster with a flying sword, collect its bounty, or retreat when injured. Martial residents are encouraged to consider this dangerous work." end
    if #descriptions>0 then
        criteria.social="Invite named person; accept and 12-32 game minutes together reduce loneliness and develop friendship."
        criteria.cooperate="Offer named person cooperation; accept and 20-40 game minutes together build trust and relieve their fatigue by 2."
        criteria.flirt="Offer named person romantic attention; accept and 12-30 game minutes together change relationship. No forced affection."
        criteria.steal="Approach named victim; 8-18 game minute theft attempt, random success up to 18 coins. Detection gives 90s real response window. No victim consent or control; departure cancels."
        criteria.rob="Threaten named victim nearby, allow 90s yield/resist/leave response; no response allows a random attempted seizure up to 18 coins, not consent. No automatic damage."
        criteria.attack="Approach the chosen person and start a real flying-sword conflict at the current meeting place; no duel arena is required. Existing resentment, honor, greed, revenge or a strong martial personality can justify choosing this. The fight first stops when one side is beaten, then the winner must choose kill, loot, knockout, or spare. The other person's retaliation requires their own decision."
        criteria.propose="Propose to named unmarried person; their explicit accept and 12-28 game minutes together before marriage."
        criteria.apprentice="Ask the named resident to become your master; explicit acceptance and a 20-40 minute shared session establish mentorship. Prefer stronger martial skill or cultivation; never assume consent."
    end
    local spouse=findNpc(npc.partnerId)
    if spouse and Family.canHaveChild(npc,spouse) then
        criteria.have_child="Ask your spouse "..spouse.name.." to start a family; both must explicitly agree through NanoJev. This creates one child record and changes both parents' mood and chronicle."
    else
        criteria.have_child=nil
    end
    if npc.combat then
        local bout=Combat.find(npc.combat.id)
        if bout and bout.phase=="aftermath" then
            criteria.attack=nil; criteria.rob=nil
            if npc==bout.winner then
                criteria.finish_kill="Choose to kill the defeated opponent now; this is a final lethal decision with permanent consequences."
                criteria.finish_loot="Choose to loot the defeated opponent; transfer up to 25 coins if they have money, then end the conflict."
                criteria.finish_knockout="Choose to knock out the defeated opponent; leave them alive, cap their injury at 75, and stun them briefly."
                criteria.finish_spare="Choose to spare the defeated opponent; end the conflict without killing, looting, or knocking them out."
            else
                criteria.leave="Escape from the aftermath and end the conflict; no teleport and no guaranteed safety."
                criteria.resist="Resist despite being beaten; resume the conflict and accept the risk of further injury."
                criteria.wait="Stay down and accept the immediate outcome; do not attack or force an escape this turn."
            end
        else
            criteria.attack="Continue this confrontation against the named opponent; counterattack is your own choice and may injure them. The fight can happen anywhere, not only in an arena."
            criteria.wait="Hold position, evade, or look for an opening; do not counterattack this turn."
            criteria.leave="Break away and go home; this ends the current confrontation if physically possible."
            criteria.rob="After overpowering the named opponent, threaten or take coins instead of continuing the attack; the outcome still depends on their response."
        end
    end
    if known and known.b==npc and known.phase=="awaiting_response" then
        if known.kind~="robbery" and known.kind~="theft" then criteria.refuse="Explicitly refuse this exact incoming invitation; target must be its initiator." end
        if known.kind=="robbery" then criteria.yield="Give this named robber up to 18 coins; only when close, once." end
        if known.kind=="robbery" or known.kind=="theft" then
            criteria.resist="Resist the named threat with your own attack; existing combat may injure or kill."
            criteria.leave="Leave the named threat and walk home; no teleport or guaranteed escape."
        else criteria.accept="Accept this exact named invitation; your next unit participates, not paid work. Target must be its initiator." end
    end
    local clock=Life.clock(worldMinutes)
    local state=modelPersona(npc)..string.format(" Time: day %d %02d:%02d; phase=%s; night=%s. Sex=%s; Age=%.1f years; lifespan=%d (base=%d, realm bonus=%d); age_stage=%s; children=%d. Inventory: rations=%d, herbs=%d, supplies=%d; tool_available=true. Sleeping=%s; rest_minutes=%.0f. ",
        clock.day,math.floor(clock.hour),clock.minute,MODEL_PHASE[clock.phase] or "unknown",tostring(clock.is_night),npc.sex,npc.age,npc.lifespan,npc.baseLifespan,(CULTIVATION_REALM_LIFESPAN_BONUS[npc.realm] or 0),Life.ageStage(npc),npc.childrenCount or 0,
        npc.inventory.food,npc.inventory.herbs,npc.inventory.wares,tostring(Life.resting(npc) and clock.is_night),npc.restMinutes or 0)
        ..string.format(" Cultivation: realm=%s; cultivation=%d/100; qi=%d/100; manual=%s; manuals=%d; pills=%d; artifacts=%d; artifact_power=%d. ",
        CULTIVATION_REALM_EN[npc.realm] or "mortal",math.floor(npc.cultivation or 0),math.floor(npc.qi or 0),CULTIVATION_TECHNIQUE_EN[npc.technique] or "basic breathing",
        npc.inventory.manuals or 0,npc.inventory.pills or 0,npc.inventory.artifacts or 0,math.floor(npc.artifact_power or 0))
        ..string.format(" Mentorship: master=%s; disciples=%d. ",
        (findNpc(npc.mentorId) and findNpc(npc.mentorId).id or "none"),
        discipleCount(npc))
        ..string.format("Fear=%.1f; jealousy=%.1f. Last game-rule effect: %s. ",npc.fear,npc.jealousy,npc.lastPersonalityReaction and npc.lastPersonalityReaction.code or "none")
        ..string.format("Condition=%.2f (speed/effort/strike damage multiplier); labor/combat effort=%.2f. ",Condition.factor(npc),Condition.effort(npc))
        ..(known and string.format("Pair=%s/%s/%s; role=%s, other=%s, source=%s, seconds=%.0f; physical min=%.1f/%s. ",known.id,known.kind,known.phase,Pair.view(npc,true).role,(known.a==npc and known.b or known.a).id,known.source or "none",math.max(0,known.deadline-Pair.clock),known.elapsed_minutes,known.duration_minutes and tostring(known.duration_minutes) or "strike-ended") or "Pair=none. ")
        ..(npc.lastKnownInteraction and string.format("Last pair=%s/%s, other=%s, coins=%d. ",npc.lastKnownInteraction.kind,npc.lastKnownInteraction.phase,npc.lastKnownInteraction.other_id,npc.lastKnownInteraction.amount) or "")
        ..string.format("Town resident %s; role=%s; hunger=%d/100; fatigue=%d/100; injury=%d/100; loneliness=%d/100; morale=%d/100; greed=%d/100; resentment=%d/100. Cash=%d coins. Wage=%d per shift, employer cash=%d. Meal price=%d, stock=%d. Treatment price=%d. Supplies price=%d, need=%d/100. Current action=%s, location=%s. Partner=%s. Nearby people: %s.",
        npc.id,modelRole(npc),npc.hunger,npc.fatigue,npc.injury,npc.loneliness,npc.morale,npc.greed,npc.resentment,npc.wealth,npc.job.wage,
        Economy.accounts[npc.job.firm].wealth,Economy.price("food"),Economy.stock("food"),Economy.price("herbs"),Economy.price("wares"),npc.finance.need_wares,
        npc.action,npc.location,npc.partnerId or "none",table.concat(descriptions,"; "))
    local job,firm=npc.job,npc.job and Economy.accounts[npc.job.firm]
    state=state..string.format(" Employment contract: status=%s; employer=%s; workplace=%s; wage=%d; started_day=%d; unpaid_shifts=%d; job_changes=%d. ",
        job and job.contract_status or "unemployed",firm and firm.name or "none",job and job.zone or "none",job and job.wage or 0,
        job and job.contract_started_day or 0,job and job.unpaid_shifts or 0,npc.finance.job_changes or 0)
    state=state.." Need pressure summary (compact, decision reference, not mandatory): "..needs.compact_model_summary
    state=state.." "..Treasure.context(npc).." "
    if npc.monsterCombat then
        local monster=monsterById[npc.monsterCombat.monster_id]
        if monster then state=state..string.format(" Active monster contract: target=%s; target_health=%d/%d; phase=%s; rounds=%d. Choose continue, wait, or leave based on injury, fear, values and bounty; no automatic retreat or kill.",monster.id,math.floor(monster.hp),monster.max_hp,npc.monsterCombat.phase,npc.monsterCombat.rounds) end
    end
    local task=npc.task
    state=state..string.format(" Health=%d/100. Combat=%s. ",math.ceil(100-npc.injury),npc.combat and npc.combat.mode or "none")
    if npc.combat then
        local bout=Combat.find(npc.combat.id); local opponent=Combat.opponent(npc)
        if bout and opponent then
            if bout.phase=="aftermath" then
                local role=npc==bout.winner and "winner" or "defeated loser"
                state=state..string.format("Combat aftermath: weapon=flying_sword; opponent=%s; opponent_health=%d/100; opponent_injury=%d/100; phase=aftermath; role=%s; strikes=%d. The winner must choose kill, loot, knockout, or spare. The defeated resident may resist, escape, or stay down. This is a consequence decision, not an automatic rule. ",
                    opponent.id,math.ceil(100-opponent.injury),math.floor(opponent.injury),role,bout.strikes)
            else
                state=state..string.format("Active combat: weapon=flying_sword; opponent=%s; opponent_health=%d/100; opponent_injury=%d/100; phase=%s; strikes=%d; your_intent=%s; counterattack is never automatic. You may continue, hold, leave, or choose robbery based on values, fear, injury, relationship and consequences. The fight can happen anywhere, not only in an arena. ",
                    opponent.id,math.ceil(100-opponent.injury),math.floor(opponent.injury),bout.phase,bout.strikes,npc.combatIntent or "hold")
            end
        end
    end
    if revengeTarget and npc.grudges[revengeTarget.id] then
        local grudge=npc.grudges[revengeTarget.id]
        state=state..string.format("Revenge memory: %s was killed by %s; pressure=%d/100; reason=%s. This is emotional context, not a forced action. ",
            grudge.victim_name,revengeTarget.name,grudge.pressure or 0,grudge.reason or "unknown")
    end
    state=state..string.format(" Current unit: %s Progress: effort=%.2f/8; minutes elapsed/planned/remaining=%.1f/%s/%s%s; complete=%s, failed=%s, walking=%s. Next=%s.",
        Brain.unitDescription(npc),task and task.effort or 0,task and task.minutes or 0,task and task.duration_minutes and string.format("%.1f",task.duration_minutes) or "pending",task and task.remaining_minutes and string.format("%.1f",task.remaining_minutes) or "pending",task and task.duration_estimated and " (estimate)" or "",tostring(not task or task.complete),tostring(task and task.failed==true),tostring(npc.reservedX~=nil),
        npc.nextPlan and (npc.nextPlan.action.." / "..npc.nextPlan.timing) or "none")
    local function withoutNearbyPeople(text)
        local start=string.find(text," Nearby people:",1,true)
        local finish=start and string.find(text," Employment contract:",start,true)
        if start and finish then return string.sub(text,1,start-1)..string.sub(text,finish) end
        return text
    end
    -- Each NanoJev question receives only the context it needs.  The full
    -- state remains available for inspection, but is no longer duplicated in
    -- every candidate path.
    local actionState=withoutNearbyPeople(state)
    local targetState=modelPersona(npc)..string.format(" Current action=%s; location=%s; partner=%s; injury=%d; fear=%d; resentment=%d; jealousy=%d; combat=%s; pair=%s. Nearby people and relationship facts are supplied in the target candidates; choose only a named person when the action requires one.",
        npc.action,npc.location,npc.partnerId or "none",npc.injury,npc.fear,npc.resentment,npc.jealousy,npc.combat and (npc.combat.mode or "active") or "none",known and known.id or "none")
    local timingState=string.format("Current action=%s; location=%s; current unit=%s; progress=%.2f/8; elapsed=%.1f; planned=%s; remaining=%s; complete=%s; walking=%s; injury=%d; fatigue=%d; hunger=%d; fear=%d; combat=%s; pair=%s; next=%s. Choose only whether to finish the current unit or interrupt safely.",
        npc.action,npc.location,Brain.unitDescription(npc),task and task.effort or 0,task and task.minutes or 0,task and task.duration_minutes and string.format("%.1f",task.duration_minutes) or "pending",task and task.remaining_minutes and string.format("%.1f",task.remaining_minutes) or "pending",tostring(not task or task.complete),tostring(npc.reservedX~=nil),npc.injury,npc.fatigue,npc.hunger,npc.fear,npc.combat and (npc.combat.phase or "active") or "none",known and known.id or "none",npc.nextPlan and (npc.nextPlan.action.." / "..npc.nextPlan.timing) or "none")
    local nonce=tostring(Brain.epoch).."_"..tostring(frame)
    local questions={action={type="choice",instructions="Choose the resident's next intention using their values, love outlook, stable traits, inner conflict, relationships, needs and finances. Traits describe tendencies, not mandatory actions; imperfect or selfish choices are possible. Respect action costs and consequences. The need-pressure summary is descriptive reference, not a forced action or veto.",criteria=criteria}}
    if #descriptions>0 then questions.target={type="choice",instructions="Who does this resident want to interact with, considering their values, love outlook, traits, needs and relationships? Choose none for non-social actions; if the selected action is attack, duel, rob, steal, propose, apprentice, help, treat, flirt, cooperate, social or have_child, you must choose a named target.",criteria=targets} end
    questions.timing={type="choice",instructions="Should this resident finish their current execution unit before the action chosen in the action question, or interrupt now? Consider current progress, urgency, values and needs. This decides timing only, not a different action.",criteria={
        after_current="Plan ahead: continue the current unit, then start the chosen next action. If the unit is already complete, start now.",
        interrupt_now="Interrupt the current unit and start the chosen action as soon as the current grid step is safe. Incomplete work may not earn a wage."
    }}
    return {id=npc.id..":"..nonce,npc_id=npc.id,created_frame=frame,input_prefix="nano_"..npc.id.."_"..nonce.."_",state=state,
        question_states={action=actionState,target=targetState,timing=timingState},questions=questions,targets=targets,
        basis_action_request_id=npc.thinking and npc.thinking.request_id or "",pair_basis=Pair.basis(npc),interaction_pair_id=known and known.id or ""}
end

local function receiveModelDecisions(api)
    if not api.input.isDown("nano_reply") then return end
    for _,npc in ipairs(npcs) do
        local request=Brain.requests[npc.id]
        if npc.alive and request and api.input.isDown(request.input_prefix.."apply") then
            local action,target,timing=nil,nil,nil
            local actionCount,targetCount,timingCount=0,0,0
            for id in pairs(request.questions.action.criteria) do
                if api.input.isDown(request.input_prefix..id) then action=id; actionCount+=1 end
            end
            for id in pairs(request.targets) do
                if api.input.isDown(request.input_prefix.."target_"..id) then target=id; targetCount+=1 end
            end
            for id in pairs(request.questions.timing.criteria) do
                if api.input.isDown(request.input_prefix.."timing_"..id) then timing=id; timingCount+=1 end
            end
            -- Only transport/legality validation here, never replace the model's choice.
            if actionCount==1 and targetCount==1 and timingCount==1 and request.basis_action_request_id==(npc.thinking and npc.thinking.request_id or "")
                and (request.pair_basis or "")==Pair.basis(npc) and (not PAIR_RESPONSE[action] or Pair.validResponse(npc,action,target,request.interaction_pair_id,request.pair_basis)) then
                npc.nextPlan={action=action,target=target,timing=timing,request_id=request.id,created_frame=request.created_frame,accepted_frame=frame,source="NanoJev",
                    pair_id=PAIR_RESPONSE[action] and request.interaction_pair_id or nil,pair_basis=PAIR_RESPONSE[action] and request.pair_basis or nil}
                npc.planningRequestId=request.id; npc.planningUpdatedFrame=frame
                npc.planStatus=timing=="after_current" and "已提前想好，等目前這一段完成" or "決定立刻改變；若在移動則先走完當前格"
                Brain.requests[npc.id]=nil
                -- Start this resident's next 120-frame window only after the
                -- current NanoJev decision was accepted; never build a backlog.
                npc.nextDecisionFrame=frame+DECISION_INTERVAL
                decisionCount+=1; Brain.applied+=1
                addEvent(api,"預定："..npc.name.." → "..ACTION_LABEL[action]..(timing=="after_current" and "（做完這段再去）" or "（立即改變）"))
            elseif actionCount==1 and targetCount==1 and timingCount==1 and PAIR_RESPONSE[action] then
                Brain.requests[npc.id]=nil
                npc.planStatus="回應未採用：互動編號、對象或階段不符；下一輪由 NanoJev 重新規劃"
            end
        end
    end
end

local function snapshotNPC(npc)
    local intent = intentFor(npc)
    local emotion,cause=Life.mood(npc)
    local needs=Condition.needsPriority(npc)
    if npc.lastPersonalityReaction then cause..="；最近"..npc.lastPersonalityReaction.text end
    if npc.alive then cause..="；"..Condition.summary(npc) end
    local resting=Life.resting(npc)
    local mentor=findNpc(npc.mentorId)
    local disciples={}
    for _,other in ipairs(npcs) do if other.mentorId==npc.id then table.insert(disciples,{id=other.id,name=other.name}) end end
    return {
        id=npc.id, name=npc.name, avatar=npc.avatar, role=npc.role,
        personality=npc.personality, identity=npc.identity, background=npc.background, preferences=npc.preferences, bio=npc.bio,
        action=ACTION_LABEL[npc.action],
        action_id=npc.action, intent_icon=intent.icon, intent=intent.text,
        target=intent.target, emotion=EMOTION_LABEL[emotion],emotion_cause=cause,last_personality_reaction=npc.lastPersonalityReaction,
        condition_factor=Condition.factor(npc),condition_effort=Condition.effort(npc),condition_summary=Condition.summary(npc),
        thought_summary=cause.."；目前打算："..intent.text,
        thought_source="狀態摘要＋已採用意圖；非模型生成的內心獨白",
        inventory=Life.inventory(npc),inventory_counts=npc.inventory,item_event=npc.lastItemEvent,
        resting=resting,sleeping=resting and Life.clock(worldMinutes).is_night,
        rest_minutes=math.floor(npc.restMinutes or 0),sleep_minutes=math.floor(npc.sleepMinutes or 0),
        loneliness=math.floor(npc.loneliness),fear=math.floor(npc.fear),jealousy=math.floor(npc.jealousy),
        needs_priority=needs,needs_summary=needs.summary,
        location=npc.location, fatigue=math.floor(npc.fatigue), hunger=math.floor(npc.hunger),
        injury=math.floor(npc.injury), hp=math.ceil(100-npc.injury),max_hp=100,
        age=math.floor(npc.age*100)/100, starting_age=npc.startingAge, lifespan=npc.lifespan,
        age_stage=Life.ageStage(npc), age_progress_game_days=worldMinutes/1440,
        combat=npc.combat and {id=npc.combat.id,mode=(Combat.find(npc.combat.id) and Combat.find(npc.combat.id).mode or npc.combat.mode),
            consent=(Combat.find(npc.combat.id) and Combat.find(npc.combat.id).consent or npc.combat.consent or "unknown"),
            phase=(Combat.find(npc.combat.id) and Combat.find(npc.combat.id).phase or npc.combat.phase),
            strikes=(Combat.find(npc.combat.id) and Combat.find(npc.combat.id).strikes or npc.combat.strikes),
            weapon=(Combat.find(npc.combat.id) and Combat.find(npc.combat.id).weapon or "flying_sword"),
            intent=npc.combatIntent or "hold",opponent_id=Combat.opponent(npc) and Combat.opponent(npc).id or "",
            opponent_name=Combat.opponent(npc) and Combat.opponent(npc).name or "",
            winner_id=(Combat.find(npc.combat.id) and Combat.find(npc.combat.id).winner and Combat.find(npc.combat.id).winner.id) or "",
            loser_id=(Combat.find(npc.combat.id) and Combat.find(npc.combat.id).loser and Combat.find(npc.combat.id).loser.id) or "",
            outcome_pending=(Combat.find(npc.combat.id) and Combat.find(npc.combat.id).phase=="aftermath") or false} or nil,
        stunned_until=npc.stunnedUntil or 0,
        combat_recent=(npc.combatUntil or 0)>Combat.clock,combat_result=npc.combatResult or "",
        monster_combat=npc.monsterCombat and {id=npc.monsterCombat.id,monster_id=npc.monsterCombat.monster_id,monster_name=npc.monsterCombat.monster_name,phase=npc.monsterCombat.phase,rounds=npc.monsterCombat.rounds,monster_hp=monsterById[npc.monsterCombat.monster_id] and math.floor(monsterById[npc.monsterCombat.monster_id].hp) or 0,monster_max_hp=monsterById[npc.monsterCombat.monster_id] and monsterById[npc.monsterCombat.monster_id].max_hp or 0} or nil,
        martial_style=npc.style, martial_level=math.floor(npc.martial),
        sex=npc.sex, cultivation=math.floor(npc.cultivation or 0), qi=math.floor(npc.qi or 0), realm=npc.realm or "凡人", technique=npc.technique or "基礎吐納",
        base_lifespan=npc.baseLifespan, realm_lifespan_bonus=(CULTIVATION_REALM_LIFESPAN_BONUS[npc.realm] or 0), children_count=npc.childrenCount or 0,
        manuals=npc.inventory.manuals or 0, pills=npc.inventory.pills or 0, artifacts=npc.inventory.artifacts or 0, artifact_power=math.floor(npc.artifact_power or 0),
        morale=math.floor(npc.morale), trust=math.floor(npc.trust), next_decision_frame=npc.nextDecisionFrame,
        relationship_summary=relationshipSummary(npc), partner_id=npc.partnerId or "",
        mentor_id=npc.mentorId or "", mentor_name=mentor and mentor.name or "", mentor_since_day=npc.mentorSinceDay or 0, disciples=disciples,
        chronicle=npc.chronicle or {},
        motive=intent.reason, alive=npc.alive, death_cause=npc.deathCause or "",
        death_kind=npc.deathKind or "", death_day=npc.deathDay or 0, memorial=npc.memorial,
        death_actor_id=npc.deathActorId or "",
        cemetery_slot=npc.cemeterySlot or 0,
        cemetery_position=npc.cemeteryPosition and {x=npc.cemeteryPosition.x,y=npc.cemeteryPosition.y,z=npc.cemeteryPosition.z} or nil,
        wealth=math.floor(npc.wealth), suspicion=math.floor(npc.suspicion), greed=math.floor(npc.greed),
        finance={balance=npc.wealth,initial_balance=npc.finance.initial_balance,income=npc.finance.income,spent=npc.finance.spent,
            today_income=npc.finance.today_income,today_spent=npc.finance.today_spent,shifts=npc.finance.shifts,
            job_changes=npc.finance.job_changes,failed_purchases=npc.finance.failed_purchases,status=npc.finance.status,receipts=npc.finance.receipts,
            employer=Economy.accounts[npc.job.firm].name,workplace=npc.job.zone,wage=npc.job.wage,contract_status=npc.job.contract_status,
            contract_started_day=npc.job.contract_started_day,unpaid_shifts=npc.job.unpaid_shifts,need_wares=math.floor(npc.finance.need_wares)},
        thinking_mode=(npc.thinking and npc.thinking.mode or thinkingModeFor(npc)),
        thinking_candidates=(npc.thinking and npc.thinking.candidates or {}),
        thinking_updated_frame=(npc.thinking and npc.thinking.updated_frame or 0),
        decision_source=npc.thinking and npc.thinking.source or "waiting-for-nanojev",
        decision_request_id=npc.thinking and npc.thinking.request_id or "",
        decision_pending=Brain.requests[npc.id]~=nil,interaction_target_id=npc.interactionTargetId or "",
        next_plan=npc.nextPlan and {action=npc.nextPlan.action,action_label=ACTION_LABEL[npc.nextPlan.action],target_id=npc.nextPlan.target,
            target_name=(findNpc(npc.nextPlan.target) and findNpc(npc.nextPlan.target).name or ""),timing=npc.nextPlan.timing,request_id=npc.nextPlan.request_id,source="NanoJev"} or nil,
        plan_status=npc.planStatus or "尚無預定行動",task=npc.task,
        task_completion=Brain.unitDescription(npc),planning_request_id=npc.planningRequestId or "",planning_updated_frame=npc.planningUpdatedFrame or 0,
        interaction_result=npc.interactionResult or "",
        rare_treasure=Treasure.snapshot(),
        interaction=Pair.view(npc,false),last_interaction=npc.lastInteraction,
        head_label=headLabelFor(npc),
        world_position={x=npc.x,y=npc.alive and 2.2 or 0.8,z=npc.z},
        residence=npc.residence, moving=npc.reservedX ~= nil,
        traveling=npc.routeCells~=nil and (npc.routeIndex or 1)<=#npc.routeCells,
        route=npc.routeCells or {}, route_index=npc.routeIndex or 1,
        route_target=npc.routeTarget, grid_cell={x=npc.gridX,z=npc.gridZ}, blocked_frames=npc.blockedFrames or 0,
        yielding_for=npc.yieldingFor or ""
    }
end

local function worldLabelSnapshots()
    local result={}
    for _, npc in ipairs(npcs) do
        table.insert(result, {
            id="head_"..npc.id, npc_id=npc.id, text=headLabelFor(npc), visible=npc.alive,
            position={x=npc.x,y=npc.alive and 2.4 or 0.8,z=npc.z}
        })
    end
    return result
end

local function thinkingDebugText(first, last)
    local lines = {"frame "..frame.." · NanoJev 非同步決策／無規則 fallback · 居民 "..first.."-"..last}
    for i=first,math.min(last,#npcs) do
        local npc = npcs[i]
        local thought = npc.thinking
        local top = thought and thought.candidates and thought.candidates[1]
        local action = npc.alive and (thought and ACTION_LABEL[thought.chosen] or ACTION_LABEL[npc.action]) or ACTION_LABEL.dead
        local mode = npc.alive and (thought and thought.mode or thinkingModeFor(npc)) or "死亡／餘波"
        local reason = npc.interactionResult or (thought and ("已採用 "..(thought.request_id or "")) or "等待模型")
        local target = intentFor(npc).target
        local nextFrame = npc.nextDecisionFrame or 0
        local planned=npc.nextPlan and (ACTION_LABEL[npc.nextPlan.action].." / "..npc.nextPlan.timing) or "尚未排定"
        table.insert(lines, string.format("%02d %s｜%s｜%s→%s｜%s｜預定 %s｜下一次 f%d", i, npc.name, mode, action, target, reason, planned, nextFrame))
        if top and top.id ~= (thought and thought.chosen) then
            table.insert(lines, "   候選: "..ACTION_LABEL[top.id].." "..top.score.." · 已選 "..(thought.chosen_score or 0))
        end
    end
    return table.concat(lines, "\n")
end

local function buildingSnapshots()
    local result = {}
    for _, building in ipairs(BUILDINGS) do
        local count = 0
        for _, npc in ipairs(npcs) do if npc.alive and npc.location == building.zone then count += 1 end end
        table.insert(result, {id=building.id, name=building.name, icon=building.icon, purpose=building.purpose, occupants=count})
    end
    return result
end

local function cemeterySnapshot()
    local slots={}
    for slot=1,CEMETERY.capacity do
        local cell=cemeteryCell(slot)
        local npcId=cemeteryReservations[slot]
        local position=cemeteryWorldPosition(slot)
        local dead=npcId and findNpc(npcId) or nil
        table.insert(slots,{slot=slot,cell={x=cell.x,z=cell.z},position=position,resident_id=npcId or "",
            death_cause=dead and dead.deathCause or "", death_kind=dead and dead.deathKind or "",
            memorial=dead and dead.memorial or nil})
    end
    return {origin={x=CEMETERY.originX,z=CEMETERY.originZ},columns=CEMETERY.columns,tomb_rows=CEMETERY.tombRows,
        column_stride=CEMETERY.columnStride,row_stride=CEMETERY.rowStride,
        capacity=CEMETERY.capacity,grid_step=GRID_STEP,slots=slots}
end

local function publishCemetery(api)
    api.observation.set("cemetery", cemeterySnapshot())
end

local function resolveRouteTarget(npc, target)
    local routeTarget = target
    if type(EXTENSIONS.pathfind) == "function" then
        local extensionResult = EXTENSIONS.pathfind(npc, target, {frame=frame,npcs=npcs,buildings=BUILDINGS})
        if type(extensionResult) == "table" and type(extensionResult.x) == "number" and type(extensionResult.z) == "number" then routeTarget=extensionResult end
    end
    return routeTarget
end

local function gridKey(cell)
    return tostring(cell.x)..":"..tostring(cell.z)
end

local function worldForCell(cell)
    return {x=cell.x*GRID_STEP,z=cell.z*GRID_STEP}
end

local function cellForWorld(x,z)
    return {x=math.floor(x/GRID_STEP+0.5),z=math.floor(z/GRID_STEP+0.5)}
end

local function cellWithinBounds(cell)
    return cell.x >= GRID_MIN_X and cell.x <= GRID_MAX_X and cell.z >= GRID_MIN_Z and cell.z <= GRID_MAX_Z
end

local walkableCache={}
-- The map is static during a world run and walkers may overlap in transit,
-- so identical grid routes are safe to share between residents.
local routeCache={}
local function cellIsWalkable(cell)
    if not cellWithinBounds(cell) then return false end
    if cemeterySlotAt(cell) then return false end
    local key=gridKey(cell)
    if walkableCache[key] ~= nil then return walkableCache[key] end
    local world=worldForCell(cell)
    for _, building in ipairs(BUILDINGS) do
        local access=building.access or {x=building.x,z=building.z}
        if cell.x ~= access.x or cell.z ~= access.z then
            local clearX=building.clearanceX or 1.4
            local clearZ=building.clearanceZ or 1.0
            if math.abs(world.x-building.x) <= clearX and math.abs(world.z-building.z) <= clearZ then walkableCache[key]=false; return false end
        end
    end
    -- Homes are valid resident origins and may be crossed while moving.
    -- Treating their footprints as path obstacles traps residents at spawn.
    -- Destination reservations still keep selected target cells distinct.
    if math.abs(world.x) < 2 and math.abs(world.z) < 2 then walkableCache[key]=false; return false end
    if world.x<=-38 and math.abs(world.z-20)>1 then walkableCache[key]=false; return false end
    for _, obstacle in ipairs(OBSTACLES) do
        if math.abs(world.x-obstacle.x)<=obstacle.radius and math.abs(world.z-obstacle.z)<=obstacle.radius then walkableCache[key]=false; return false end
    end
    walkableCache[key]=true
    return true
end

local function occupiedCellMap()
    local occupied={}
    for _, npc in ipairs(npcs) do
        if npc.alive and npc.gridX and npc.gridZ then
            occupied[gridKey({x=npc.gridX,z=npc.gridZ})]=npc.id
            if npc.reservedX and npc.reservedZ then occupied[gridKey({x=npc.reservedX,z=npc.reservedZ})]=npc.id end
        end
    end
    return occupied
end

local function goalCandidates(base)
    local candidates={}
    for radius=0,8 do
        for dx=-radius,radius do
            local dz=radius-math.abs(dx)
            local first={x=base.x+dx,z=base.z+dz}
            table.insert(candidates,first)
            if dz > 0 then table.insert(candidates,{x=base.x+dx,z=base.z-dz}) end
        end
    end
    return candidates
end

local function chooseGoalCell(npc,target,reservedGoals,occupied)
    local base=cellForWorld(target.x,target.z)
    for _, candidate in ipairs(goalCandidates(base)) do
        local key=gridKey(candidate)
        local owner=occupied[key]
        if cellIsWalkable(candidate) and not reservedGoals[key] and (not owner or owner == npc.id) then
            reservedGoals[key]=npc.id
            return candidate
        end
    end
    return cellForWorld(npc.x,npc.z)
end

local function chooseSpawnCell(base,reserved,occupied)
    for _, candidate in ipairs(goalCandidates(base)) do
        local key=gridKey(candidate)
        if cellIsWalkable(candidate) and not reserved[key] and (not occupied or not occupied[key]) then
            reserved[key]=true
            return candidate
        end
    end
    for x=GRID_MIN_X,GRID_MAX_X do
        for z=GRID_MIN_Z,GRID_MAX_Z do
            local candidate={x=x,z=z}
            local key=gridKey(candidate)
            if cellIsWalkable(candidate) and not reserved[key] and (not occupied or not occupied[key]) then
                reserved[key]=true
                return candidate
            end
        end
    end
    return {x=GRID_MIN_X,z=GRID_MIN_Z}
end

local function findGridPath(startCell,goalCell,npc)
    -- Movement is presentation-only between grid destinations.  Do not turn
    -- other residents into path obstacles: target cells remain reserved and
    -- unique, while agents may pass through one another instead of deadlocking.
    local occupied=nil
    -- A resident may legitimately start inside their own home footprint.  The
    -- source cell is allowed as a path origin; only subsequent cells must be
    -- walkable.  Falling back to the goal here collapsed home-to-town routes
    -- into a one-cell path and made the world look frozen.
    if not cellWithinBounds(startCell) then startCell=goalCell end
    if not cellIsWalkable(goalCell) then goalCell=startCell end
    local startKey, goalKey=gridKey(startCell), gridKey(goalCell)
    local cacheKey=startKey..">"..goalKey
    local cached=routeCache[cacheKey]
    if cached then return cached end
    local queue={{x=startCell.x,z=startCell.z}}
    local queueSize=1
    local previous={[startKey]=""}
    local cells={[startKey]=startCell}
    local costs={[startKey]=0}
    while queueSize > 0 do
        local best,bestScore=1,math.huge
        for i,cell in ipairs(queue) do
            local score=costs[gridKey(cell)]+math.abs(cell.x-goalCell.x)+math.abs(cell.z-goalCell.z)
            if score < bestScore then best,bestScore=i,score end
        end
        -- The queue is scanned for the lowest score below, so preserving
        -- order is unnecessary. Swapping with the tail avoids shifting every
        -- remaining candidate on each expansion.
        local current=queue[best]
        queue[best]=queue[queueSize]
        queue[queueSize]=nil
        queueSize-=1
        local currentKey=gridKey(current)
        if currentKey == goalKey then break end
        for _, delta in ipairs(GRID_NEIGHBORS) do
            local nextCell={x=current.x+delta.x,z=current.z+delta.z}
            local nextKey=gridKey(nextCell)
            local cost=costs[currentKey]+1
            if cellIsWalkable(nextCell) and (not occupied or not occupied[nextKey] or occupied[nextKey]==npc.id) and (costs[nextKey]==nil or cost < costs[nextKey]) then
                costs[nextKey]=cost
                previous[nextKey]=currentKey
                cells[nextKey]=nextCell
                queueSize+=1
                queue[queueSize]=nextCell
            end
        end
    end
    if previous[goalKey] == nil then
        local fallback={startCell}
        routeCache[cacheKey]=fallback
        return fallback
    end
    local reverse={}
    local cursor=goalKey
    while cursor ~= "" do
        table.insert(reverse,cells[cursor])
        cursor=previous[cursor]
    end
    local path={}
    for index=#reverse,1,-1 do table.insert(path,reverse[index]) end
    routeCache[cacheKey]=path
    return path
end

local function planRoutes()
    local occupied=occupiedCellMap()
    local reservedGoals={}
    for _, npc in ipairs(npcs) do
        if npc.alive and npc.goalCell and npc.routeZone==targetZone(npc) then reservedGoals[gridKey(npc.goalCell)]=npc.id end
    end
    for _, npc in ipairs(npcs) do
        local approaching=npc.pair and npc.pair.a==npc and npc.pair.phase~="performing"
        local counterpart=approaching and npc.pair.b or nil
        local targetMoved=counterpart and (npc.pairTargetX~=counterpart.gridX or npc.pairTargetZ~=counterpart.gridZ)
        if npc.alive and (not npc.routeCells or npc.routeZone~=targetZone(npc) or (npc.blockedFrames or 0)>45 or (targetMoved and frame%SIMULATION_INTERVAL==1)) then
            if counterpart then npc.pairTargetX=counterpart.gridX; npc.pairTargetZ=counterpart.gridZ end
            if npc.goalCell then reservedGoals[gridKey(npc.goalCell)]=nil end
            local start={x=npc.reservedX or npc.gridX,z=npc.reservedZ or npc.gridZ}
            local combatBout=npc.combat and Combat.find(npc.combat.id)
            local combatOpponent=Combat.opponent(npc)
            local chasing=combatBout and combatBout.a==npc and combatBout.phase=="approach" and combatOpponent
            if not chasing and not approaching and npc.action~="leave" and (npc.action=="wait" or INTERACTION_ACTION[npc.action] or PORTABLE_ACTION[npc.action]) then
                npc.routeCells={start}; npc.routeIndex=npc.reservedX and 1 or 2
                npc.routeReachable=true; npc.routeZone=targetZone(npc); npc.goalCell=start
                local p=worldForCell(start); npc.routeTarget={x=p.x,z=p.z}; npc.blockedFrames=0
                reservedGoals[gridKey(start)]=npc.id
                continue
            end
            local target=chasing and {x=combatOpponent.x,z=combatOpponent.z} or approaching and {x=npc.pair.b.x,z=npc.pair.b.z} or ZONES[targetZone(npc)] or ZONES[npc.home]
            local routeTarget=resolveRouteTarget(npc,target)
            local goal=chooseGoalCell(npc,routeTarget,reservedGoals,occupied)
            npc.routeCells=findGridPath(start,goal,nil)
            local last=npc.routeCells[#npc.routeCells]
            npc.routeReachable=last.x==goal.x and last.z==goal.z
            npc.blockedFrames=0
            npc.routeZone=targetZone(npc)
            npc.routeIndex=npc.reservedX and 1 or 2
            npc.goalCell=goal
            local goalWorld=worldForCell(goal)
            npc.routeTarget={x=goalWorld.x,z=goalWorld.z}
        end
    end
end

local function moveOneGridStep(npc,dt)
    if not npc.alive then return end
    if isStunned(npc) then return end
    if npc.task and npc.task.complete and not npc.reservedX then return end
    if not npc.routeReachable then npc.blockedFrames=(npc.blockedFrames or 0)+1; return end
    local nextCell=npc.routeCells and npc.routeCells[npc.routeIndex]
    if not nextCell then npc.blockedFrames=0; npc.yieldingFor=nil; return end
    if not npc.reservedX then
        -- Occupancy is enforced only when choosing/reserving a destination.
        -- Walking has no collision blocker, so two routes can cross without
        -- freezing the town in a mutual wait.
        npc.blockedFrames=0
        npc.yieldingFor=nil
        npc.reservedX,npc.reservedZ=nextCell.x,nextCell.z
    end
    local reservedCell={x=npc.reservedX,z=npc.reservedZ}
    local target=worldForCell(reservedCell)
    local dx,dz=target.x-npc.x,target.z-npc.z
    if math.abs(dx)+math.abs(dz)>0.001 then npc.facing=math.atan2(dx,dz) end
    local step=4.5*(dt or 1/60)*speed*Condition.factor(npc)
    if math.abs(dx) <= step and math.abs(dz) <= step then
        npc.x,npc.z=target.x,target.z
        npc.gridX,npc.gridZ=reservedCell.x,reservedCell.z
        npc.reservedX,npc.reservedZ=nil,nil
        npc.routeIndex += 1
    elseif math.abs(dx) >= math.abs(dz) then
        npc.x += (dx > 0 and step or -step)
    else
        npc.z += (dz > 0 and step or -step)
    end
end

local function updateMovement(api,dt)
    local needsPlan=frame % SIMULATION_INTERVAL == 1
    if not needsPlan then
        for _, npc in ipairs(npcs) do
            if npc.alive and not npc.routeCells then needsPlan=true; break end
        end
    end
    if needsPlan then planRoutes() end
    for _, npc in ipairs(npcs) do
        if npc.alive then
            local wasResting=Life.resting(npc)
            if (not npc.combatHolding and not Pair.occupied(npc)) or npc.reservedX then moveOneGridStep(npc,dt) end
            npc.location=(npc.routeReachable and npc.routeCells and npc.routeIndex>#npc.routeCells) and npc.routeZone or "road"
            if wasResting~=Life.resting(npc) then
                Life.tick(npc,math.max(0,worldMinutes-npc.lastNeedsMinute),Life.clock(worldMinutes),wasResting); npc.lastNeedsMinute=worldMinutes
            end
            if not Brain.ready(npc) then npc.executionSince=nil
            elseif not npc.executionSince then npc.executionSince=worldMinutes end
            local transform=api.entity.getTransform3D(npc.id)
            transform.position={x=npc.x,y=0.04,z=npc.z}
            transform.rotation={x=0,y=npc.facing or 0,z=0}
            api.entity.setTransform3D(npc.id,transform)
        end
    end
end

local function publish(api)
    local npcView, eventView = {}, {}
    for _, npc in ipairs(npcs) do table.insert(npcView, snapshotNPC(npc)) end
    local buildingView = buildingSnapshots()
    local worldLabelView = worldLabelSnapshots()
    for _, event in ipairs(events) do table.insert(eventView, event.text) end
    local selected = npcs[selectedNpc]
    local selectedView = selected and snapshotNPC(selected) or nil
    local pageCount = residentPageCount()
    residentPage = clamp(residentPage, 1, pageCount)

    api.observation.set("world_time_minutes", math.floor(worldMinutes))
    api.observation.set("day_cycle",Life.clock(worldMinutes))
    api.observation.set("npc_count", #npcs)
    api.observation.set("building_count", #BUILDINGS)
    api.observation.set("home_count", #HOMES)
    api.observation.set("residential_capacity", #HOMES*2)
    api.observation.set("town_size", {width=180,depth=144,center={x=0,z=0},grid_step=GRID_STEP,towns=TOWNS})
    local blocked,yielding=0,0
    for _,npc in ipairs(npcs) do
        if npc.alive and (npc.blockedFrames or 0)>0 then blocked+=1 end
        if npc.alive and npc.yieldingFor then yielding+=1 end
    end
    api.observation.set("movement_navigation", {mode="grid-reservation-target-only",target_cells_unique=true,walking_collision_blocking=false,grid_step=GRID_STEP,
        yield_after_frames=MOVEMENT_REPLAN_YIELD_FRAMES,hard_replan_after_frames=MOVEMENT_REPLAN_HARD_FRAMES,
        blocked_agents=blocked,yielding_agents=yielding})
    api.observation.set("decision_count", decisionCount)
    api.observation.set("decision_protocol", "lookahead-v2")
    api.observation.set("combat", {version="combat-v1",clock=Combat.clock,sequence=Combat.sequence,events=Combat.events,
        active=#Combat.bouts,hits=Combat.hits,misses=Combat.misses,finished=Combat.finished})
    api.observation.set("monsters", MonsterCombat.snapshot())
    api.observation.set("vfx",vfxStats)
    api.observation.set("plans_started",Brain.started)
    api.observation.set("decision_interval_frames", DECISION_INTERVAL)
    api.observation.set("decision_schedule", "per-npc staggered; 120 frames after accepted decision")
    local pendingDecisionCount=0
    for _ in pairs(Brain.requests) do pendingDecisionCount+=1 end
    api.observation.set("decision_queue", {pending=pendingDecisionCount,limit=MAX_PENDING_DECISIONS,backpressure=pendingDecisionCount>=MAX_PENDING_DECISIONS})
    api.observation.set("event_count", eventCount)
    api.observation.set("chronicle", chronicle)
    api.observation.set("simulation_tick_count", simulationTickCount)
    api.observation.set("selected_npc_id", selected and selected.id or "")
    api.observation.set("resident_page", residentPage)
    api.observation.set("resident_page_count", pageCount)
    api.observation.set("nanoj_decision_backend", "nanojev-external-no-fallback")
    local decisionRequests={}
    for _,npc in ipairs(npcs) do
        if npc.alive and Brain.requests[npc.id] then table.insert(decisionRequests,Brain.requests[npc.id]) end
    end
    table.sort(decisionRequests,function(a,b) if a.created_frame==b.created_frame then return a.id<b.id end; return a.created_frame<b.created_frame end)
    api.observation.set("decision_requests",decisionRequests)
    api.observation.set("decision_requests_count",Brain.requested)
    api.observation.set("world_resources", resources)
    local economyView=Economy.snapshot()
    api.observation.set("economy", economyView)
    local treasureView=Treasure.snapshot()
    api.observation.set("treasure", treasureView)
    local familyView=Family.snapshot()
    api.observation.set("family", familyView)
    local relationshipView, relationshipStats = relationshipViews()
    api.observation.set("relationship_count", relationshipStats.active_relationships)
    api.observation.set("relationships", relationshipView)
    api.observation.set("relationship_stats", relationshipStats)
    api.observation.set("story_stats", storyStats)
    api.observation.set("world_labels", worldLabelView)
    publishCemetery(api)
    api.observation.set("extension_points", {"pathfind", "onEvent", "nanojev-input"})
    api.observation.set("view_model", {
        title="雲水鎮與青石鎮 · 雙城江湖生活切片", towns=TOWNS, town_size={width=180,depth=144,center={x=0,z=0}}, monsters=MonsterCombat.snapshot(), clock=clockText(), day_cycle=Life.clock(worldMinutes),paused=paused, speed=speed,
        npc_count=#npcs, building_count=#BUILDINGS, decision_backend="NanoJev（未回覆時等待，無規則 fallback）",
        decision_interval_frames=DECISION_INTERVAL, decision_schedule="per-npc staggered; 120 frames after accepted decision",
        simulation_tick_count=simulationTickCount, resident_page=residentPage, resident_page_count=pageCount,
        selected_npc_id=selected and selected.id or "", selected_npc_detail=selectedView,
        npc=npcView, buildings=buildingView, world_resources=resources, economy=economyView, treasure=treasureView, family=familyView,
        relationships=relationshipView, relationship_stats=relationshipStats, story_stats=storyStats, chronicle=chronicle, event_log=eventView,
        world_labels=worldLabelView, cemetery=cemeterySnapshot()
    })

    local children = {
        {kind="text", id="title", rect={x=4,y=92,width=92,height=5}, text="雲水鎮與青石鎮 · 80 人雙城江湖"},
        {kind="text", id="clock", rect={x=4,y=87,width=92,height=3}, text=clockText().."   ·   低頻模擬 "..SIMULATION_INTERVAL.."f / 每人決策 "..DECISION_INTERVAL.."f（錯開）"},
        {kind="text", id="legend", rect={x=4,y=82,width=55,height=3}, text="點擊人物查看詳情；💭 是心情／目的，╰─▶ 是前往的場地"}
    }
    local pageLabel = "居民 "..residentPage.." / "..pageCount
    local pageStart = (residentPage - 1) * RESIDENTS_PER_PAGE
    for slot=1,RESIDENTS_PER_PAGE do
        local i = pageStart + slot
        local npc = npcs[i]
        if npc then
            local y = 73 - (slot - 1) * 7.2
            local intent = intentFor(npc)
            local prefix = selectedNpc == i and "▶ " or "  "
            local line = prefix..npc.avatar.." "..npc.name.." · "..npc.role.."\n💭 "..intent.icon.." "..intent.target.." · "..EMOTION_LABEL[emotionFor(npc)]
            table.insert(children, {kind="button", id="inspect_"..npc.id, text=line, action="inspect_"..npc.id, rect={x=4,y=y,width=55,height=6.5}})
        end
    end

    local detailText = "人物詳情"
    if selected then
        local intent = intentFor(selected)
        local relationshipText = "人際："..relationshipSummary(selected)
        if selected.partnerId then
            local partner = findNpc(selected.partnerId)
            relationshipText = relationshipText.."\n伴侶："..(partner and partner.name or "未知")
        end
        detailText = selected.avatar.."  "..selected.name.."\n"..selected.role.." · "..selected.personality.."\n\n"..selected.bio.."\n\n背景："..selected.background.."\n喜好："..selected.preferences.."\n\n武學："..selected.style.." Lv."..math.floor(selected.martial).."\n修仙："..(selected.realm or "凡人").." · "..(selected.technique or "基礎吐納").." · 修為 "..math.floor(selected.cultivation or 0).." · 靈氣 "..math.floor(selected.qi or 0).."\n心情："..EMOTION_LABEL[emotionFor(selected)].." · 士氣 "..math.floor(selected.morale).."\n目的："..intent.icon.." "..intent.text.."\n原因："..intent.reason.."\n拉線：╰─▶ "..intent.target.."\n"..relationshipText
    else
        detailText = detailText.."\n\n請點擊左側人物"
    end
    table.insert(children, {kind="text", id="detail", rect={x=62,y=47,width=34,height=33}, text=detailText})

    local buildingText = "場地與工作站"
    for _, building in ipairs(buildingView) do buildingText=buildingText.."\n"..building.icon.." "..building.name.." · "..building.occupants.."人" end
    table.insert(children, {kind="text", id="buildings", rect={x=62,y=27,width=34,height=17}, text=buildingText})

    local eventText = "最近事件"
    for i=1,math.min(2,#events) do eventText=eventText.."\n"..events[i].text end
    table.insert(children, {kind="text", id="events", rect={x=62,y=15,width=34,height=10}, text=eventText})
    table.insert(children, {kind="button", id="prev_page", text="上一頁", action="page_prev", rect={x=4,y=6,width=10,height=5}})
    table.insert(children, {kind="text", id="page_label", text=pageLabel, rect={x=17,y=6,width=18,height=5}})
    table.insert(children, {kind="button", id="next_page", text="下一頁", action="page_next", rect={x=37,y=6,width=10,height=5}})
    table.insert(children, {kind="button", id="pause", text=paused and "繼續" or "暫停", action="toggle_pause", rect={x=62,y=6,width=9,height=5}})
    table.insert(children, {kind="button", id="faster", text="加速", action="speed_up", rect={x=72,y=6,width=8,height=5}})
    table.insert(children, {kind="button", id="slower", text="減速", action="speed_down", rect={x=81,y=6,width=8,height=5}})
    table.insert(children, {kind="text", id="footer", rect={x=4,y=13,width=55,height=5}, text="80 名居民 · 2 座城鎮 · 城牆／守衛／行商／公會斬妖"})
    api.ui.setRoot({kind="screen", id="jianghu", node="village", children=children})
    if debugRegistered then
        api.debug.set("sandbox.economy", "全鎮 "..economyView.total_money.." 文／核對差額 "..economyView.money_delta.."；交易 "..economyView.transactions.." 筆；低於三餐預算 "..economyView.poor_residents.." 人；詳情見 observations.economy")
        if selected then
            local _,cause=Life.mood(selected)
            api.debug.set("sandbox.life",clockText().." · "..Life.clock(worldMinutes).phase.."\n"..selected.name.."："..cause
                .."\n疲勞 "..math.floor(selected.fatigue).."／飢餓 "..math.floor(selected.hunger).."／錢袋 "..selected.wealth.." 文"
                .."\n行囊："..selected.tool.."；乾糧 "..selected.inventory.food.."／藥材 "..selected.inventory.herbs.."／日用品 "..selected.inventory.wares.."／丹藥 "..(selected.inventory.pills or 0).."／功法 "..(selected.inventory.manuals or 0).."／法寶 "..(selected.inventory.artifacts or 0))
        end
        local selectedThought = selected and selected.thinking
        local selectedText = "尚未產生決策"
        if selectedThought then
            local candidates = {}
            for _, candidate in ipairs(selectedThought.candidates or {}) do
                table.insert(candidates, ACTION_LABEL[candidate.id].."="..candidate.score)
            end
            selectedText = selected.name.." · 模式："..selectedThought.mode.."\n選擇："..ACTION_LABEL[selectedThought.chosen].."\n機率見遊戲人物面板（依 request id 配對）\n紀錄："..selectedThought.motive.."\n目的："..intentFor(selected).text.." → "..intentFor(selected).target.."\n更新 frame："..selectedThought.updated_frame.." · 下一次："..(selected.nextDecisionFrame or 0)
        end
        api.debug.set("sandbox.thinking.selected", selectedText)
        for page=1,4 do
            local first = (page-1)*10+1
            api.debug.set("sandbox.thinking.roster."..page, thinkingDebugText(first, first+9))
        end
    end
end

-- Keep this old block out of the runtime; the page-aware UI above is the only roster view.
--[=[
    for i, npc in ipairs(npcs) do
        local y = 73 - (i - 1) * 7.2
        local intent = intentFor(npc)
        local prefix = selectedNpc == i and "▶ " or "  "
        local line = prefix..npc.avatar.." "..npc.name.." · "..npc.role.."\n💭 "..intent.icon.." "..intent.target.." · "..EMOTION_LABEL[emotionFor(npc)]
        table.insert(children, {kind="button", id="inspect_"..npc.id, text=line, action="inspect_"..npc.id, rect={x=4,y=y,width=55,height=6.5}})
    end

    local detailText = "人物詳情"
    if selected then
        local intent = intentFor(selected)
        detailText = selected.avatar.."  "..selected.name.."\n"..selected.role.." · "..selected.personality.."\n\n"..selected.bio.."\n\n武學："..selected.style.." Lv."..math.floor(selected.martial).."\n心情："..EMOTION_LABEL[emotionFor(selected)].." · 士氣 "..math.floor(selected.morale).."\n目的："..intent.icon.." "..intent.text.."\n拉線：╰─▶ "..intent.target
    else
        detailText = detailText.."\n\n請點擊左側人物"
    end
    table.insert(children, {kind="text", id="detail", rect={x=62,y=47,width=34,height=33}, text=detailText})

    local buildingText = "場地與工作站"
    for _, building in ipairs(buildingView) do buildingText=buildingText.."\n"..building.icon.." "..building.name.." · "..building.occupants.."人" end
    table.insert(children, {kind="text", id="buildings", rect={x=62,y=27,width=34,height=17}, text=buildingText})

    local eventText = "最近事件"
    for i=1,math.min(2,#events) do eventText=eventText.."\n"..events[i].text end
    table.insert(children, {kind="text", id="events", rect={x=62,y=15,width=34,height=10}, text=eventText})
    table.insert(children, {kind="button", id="pause", text=paused and "繼續" or "暫停", action="toggle_pause", rect={x=62,y=6,width=9,height=5}})
    table.insert(children, {kind="button", id="faster", text="加速", action="speed_up", rect={x=72,y=6,width=8,height=5}})
    table.insert(children, {kind="button", id="slower", text="減速", action="speed_down", rect={x=81,y=6,width=8,height=5}})
    table.insert(children, {kind="text", id="footer", rect={x=4,y=13,width=55,height=5}, text="80 名居民 · 22 個場地 · 每人有職業／背景／喜好"})
    api.ui.setRoot({kind="screen", id="jianghu", node="village", children=children})
end
]=]

local function resetWorld(api)
    frame=0; worldMinutes=0; decisionCount=0; eventCount=0; simulationTickCount=0; events={}; npcs={}; chronicle={}; paused=false; speed=1; selectedNpc=1; residentPage=1; pointerHeld=false
    routeCache={}
    resources={food=24, herbs=18, monsterThreat=42}
    Treasure.reset()
    monsters={}; monsterById={}; MonsterCombat.clock=0; MonsterCombat.sequence=0; MonsterCombat.sessions={}; MonsterCombat.hits=0; MonsterCombat.misses=0; MonsterCombat.finished=0
    for _,def in ipairs(MONSTER_DEFS) do
        local monster={id=def.id,name=def.name,x=def.x,z=def.z,hp=def.hp,max_hp=def.hp,damage=def.damage,reward=def.reward,threat=def.threat,alive=true,respawnAt=0,combatUntil=0}
        table.insert(monsters,monster); monsterById[monster.id]=monster
    end
    Combat.clock=0; Combat.sequence=0; Combat.events={}; Combat.bouts={}; Combat.nextId=0
    Combat.hits=0; Combat.misses=0; Combat.finished=0; Combat.dirty=false
    vfxStats.available=false; vfxStats.attempts=0; vfxStats.played=0; vfxStats.last_error=""
    Brain.epoch+=1; Brain.requests={}; Brain.requested=0; Brain.applied=0; Brain.started=0; Brain.cursor=1
    Pair.epoch+=1; Pair.clock=0; Pair.sequence=0; Pair.sessions={}
    storyStats={cooperations=0, schemes=0, deaths=0, jealousy=0}
    Family.births=0; Family.children={}; Family.nextId=0
    local reservedSpawnCells={}
    cemeteryAssignments={}; cemeteryReservations={}
    for index, def in ipairs(NPC_DEFS) do
            local residence=HOMES[math.ceil(index/2)].id
            local homeSpawn=ZONES[residence]
            local spawnCell=chooseSpawnCell(cellForWorld(homeSpawn.x,homeSpawn.z),reservedSpawnCells)
        local spawnWorld=worldForCell(spawnCell)
        table.insert(npcs, {
            id=def.id, name=def.name, avatar=def.avatar, role=def.role, style=def.style,
            personality=def.personality, identity=Persona.create(index), background=def.background, preferences=def.preferences, bio=def.bio, home=def.home, residence=residence,
            x=spawnWorld.x, z=spawnWorld.z, gridX=spawnCell.x, gridZ=spawnCell.z, location=def.home, jobEnergy=48, fatigue=18+(def.martial%10),
            hunger=12, loneliness=18, morale=def.morale, fear=4, injury=0, martial=def.martial,
            cultivation=clamp(def.martial*.45,0,100), qi=25+((index*11)%35), realm="凡人", technique="基礎吐納", artifact_power=0,
            sex=index%2==0 and "female" or "male", childrenCount=0, lastBirthMinute=-math.huge,
            resentment=def.resentment, trust=50, action="wait", nextDecisionFrame=index,
            interactionTargetName="",
            alive=true, deathCause="", deathKind="", deathDay=0, memorial=nil, cemeterySlot=nil, cemeteryPosition=nil, partnerId=nil, jealousy=0, suspicion=0, mentorId=nil, mentorSinceDay=0, chronicle={},
            startingAge=20+((index*17)%41), age=20+((index*17)%41), baseLifespan=70+((index*23)%21), lifespan=70+((index*23)%21),
            lastNaturalDeathCheckDay=0, ageSeed=index*37,
            tool=Life.tools[index] or "隨身短劍",restMinutes=0,sleepMinutes=0,lastNeedsMinute=0,
            wealth=28+((index*17)%65), greed=18+((index*13)%68)
        })
    end
    for _, npc in ipairs(npcs) do
        refreshCultivation(npc)
        npc.location=npc.residence
        local transform=api.entity.getTransform3D(npc.id)
        transform.position={x=npc.x,y=0.04,z=npc.z}
        api.entity.setTransform3D(npc.id,transform)
    end
    Economy.reset()
    planRoutes()
    seedRelationships()
    local familyA,familyB=findNpc("npc_79"),findNpc("npc_80")
    if familyA and familyB then
        local familyRelation=getRelationship(familyA,familyB); familyRelation.married=true
        familyA.partnerId=familyB.id; familyB.partnerId=familyA.id
    end
    api.camera3d.setPosition({x=0,y=128,z=150})
    api.camera3d.setTarget({x=0,y=0,z=0})
    api.log("wuxia sandbox: world reset")
    publish(api)
end

local function decideStaggered(api)
    local pendingDecisionCount=0
    for _ in pairs(Brain.requests) do pendingDecisionCount+=1 end
    local count:number=#npcs
    if count==0 then return end
    local startIndex:number=Brain.cursor or 1
    local nextCursor:number=startIndex
    for offset=0,count-1 do
        local index:number=((startIndex+offset-1)%count)+1
        local npc=npcs[index]
        if npc.alive and frame>=npc.nextDecisionFrame and pendingDecisionCount<MAX_PENDING_DECISIONS then
            if not Brain.requests[npc.id] then
                Brain.requests[npc.id]=buildDecisionRequest(npc)
                Brain.requested+=1
                pendingDecisionCount+=1
                nextCursor=(index%count)+1
            end
        end
    end
    Brain.cursor=nextCursor
end

local function recordDeathGrudge(victim,actor,reason)
    if not actor then return end
    for _,observer in ipairs(npcs) do
        if observer.alive and observer~=victim and observer~=actor then
            local bond=getRelationship(observer,victim)
            local pressure=math.max(bond.affinity,bond.trust,bond.romance,bond.married and 100 or 0)
            if pressure>=40 then
                observer.grudges=observer.grudges or {}
                observer.grudges[actor.id]={victim_id=victim.id,victim_name=victim.name,killer_id=actor.id,killer_name=actor.name,
                    pressure=clamp(math.floor(pressure*.8),0,100),reason=reason,day=Life.clock(worldMinutes).day}
                observer.morale=clamp(observer.morale-8,0,100)
                Persona.react(observer,"friend_killed",{{"empathy","morale",-8},{"risk","fear",3,true}})
            end
        end
    end
end

local function killNpc(api, victim, actor, reason, deathKind)
    if not victim or not victim.alive then return end
    victim.alive=false
    if victim.pair then Pair.finish(api,victim.pair,"cancelled","互動中止："..victim.name.."死亡，未結算") end
    Brain.requests[victim.id]=nil
    victim.nextPlan=nil; victim.planStatus="已故，預定行動取消"
    victim.task=nil; victim.planningRequestId=nil; victim.planningUpdatedFrame=nil
    victim.action="dead"
    victim.deathCause=reason
    victim.deathKind=deathKind or "injury"
    victim.deathDay=Life.clock(worldMinutes).day
    victim.memorial={cause=reason,kind=victim.deathKind,day=victim.deathDay}
    victim.deathActorId=actor and actor.id or nil
    victim.thinking={mode="死亡／餘波", chosen="dead", chosen_score=0, candidates={}, motive="死亡："..reason, updated_frame=frame}
    victim.location="cemetery"
    victim.morale=0
    victim.injury=100
    storyStats.deaths += 1
    local cemeterySlot=allocateCemeterySlot(victim)
    local grave=cemeteryCell(cemeterySlot)
    local graveWorld=cemeteryWorldPosition(cemeterySlot)
    victim.cemeterySlot=cemeterySlot
    victim.cemeteryPosition={x=graveWorld.x,y=graveWorld.y,z=graveWorld.z}
    victim.x=graveWorld.x
    victim.z=graveWorld.z
    victim.gridX,victim.gridZ=grave.x,grave.z
    victim.reservedX,victim.reservedZ=nil,nil
    victim.routeCells=nil
    victim.routeTarget=nil; victim.routeIndex=nil; victim.routeReachable=false; victim.goalCell=nil
    if victim.combat then
        local bout=Combat.find(victim.combat.id)
        if bout then Combat.finish(api,bout,"交鋒結束："..victim.name.."死亡") end
    end
    local transform=api.entity.getTransform3D(victim.id)
    transform.position={x=victim.x,y=0.35,z=victim.z}
    api.entity.setTransform3D(victim.id,transform)
    if victim.partnerId then
        local partner=findNpc(victim.partnerId)
        if partner and partner.alive then
            partner.morale=clamp(partner.morale-24,0,100)
            partner.jealousy=clamp((partner.jealousy or 0)+2,0,100)
        end
    end
    recordDeathGrudge(victim,actor,reason)
    addEvent(api,"死亡："..victim.name.."；"..reason..(actor and ("；施加傷害者："..actor.name) or ""),{kind="death",actor=actor,target=victim,reason=reason})
end

local function ageAndCheckNaturalDeaths(api)
    local day=math.floor(worldMinutes/1440)+1
    for index,npc in ipairs(npcs) do
        if npc.alive then
            npc.age=npc.startingAge+(worldMinutes/1440)*AGE_YEARS_PER_GAME_DAY
            if day>npc.lastNaturalDeathCheckDay then
                npc.lastNaturalDeathCheckDay=day
                if npc.age>=npc.lifespan and ((npc.ageSeed+day*53)%100)<NATURAL_DEATH_CHECK_PERCENT then
                    killNpc(api,npc,nil,"自然死亡：壽終","natural")
                end
            end
        end
    end
end

local function applyDamage(api: any,victim: any,amount: number,actor: any,reason: string,nonlethal: boolean): number
    if not victim.alive or amount<=0 then return 0 end
    local damage=math.min(amount,math.max(0,(nonlethal and 75 or 100)-victim.injury))
    victim.injury+=damage
    if not nonlethal and victim.injury>=100 then killNpc(api,victim,actor,reason) end
    return damage
end

-- Monster contracts are a bounded Luau combat layer. NanoJev chooses whether
-- to accept, continue, or leave; it does not roll hits or mutate health.
local function monsterVFX(api,effect,source,target)
    if not api or not api.particle or not api.particle.play then return end
    local point=target or source
    if not point then return end
    pcall(function() api.particle.play(effect,{x=point.x,y=1.1,z=point.z},(frame*31+MonsterCombat.sequence*17)%2147483647) end)
end
function MonsterCombat.find(id)
    if not id then return nil end
    for _,session in ipairs(MonsterCombat.sessions) do if session.id==id and not session.done then return session end end
    return nil
end
function MonsterCombat.begin(api,npc)
    if npc.monsterCombat or not npc.alive then return false end
    local monster=nil
    for _,candidate in ipairs(monsters) do
        if candidate.alive and (candidate.respawnAt or 0)<=worldMinutes then monster=candidate; break end
    end
    if not monster then
        npc.interactionDone=true; npc.interactionResult="斬妖委託未執行：目前沒有存活的怪物"; return false
    end
    MonsterCombat.sequence+=1
    local session={id="monster_bout_"..MonsterCombat.sequence,npc=npc,monster=monster,phase="engage",rounds=0,nextAt=MonsterCombat.clock+.5,done=false}
    table.insert(MonsterCombat.sessions,session)
    npc.monsterCombat={id=session.id,monster_id=monster.id,monster_name=monster.name,phase=session.phase,rounds=0}
    npc.routeCells=nil; npc.task.timing_kind="monster_combat"; npc.task.minutes=0; npc.task.effort=0; Brain.timing(npc)
    monster.combatUntil=Combat.clock+3
    addEvent(api,npc.name.."接下斬妖委託，鎖定"..monster.name,{kind="monster_hunt",actor=npc,reason="NanoJev 選擇接受公會工作並前往城外"})
    return true
end
function MonsterCombat.finish(api,session,reason,killed)
    if session.done then return end
    session.done=true; MonsterCombat.finished+=1
    local npc,monster=session.npc,session.monster
    if killed then
        monster.alive=false; monster.hp=0; monster.respawnAt=worldMinutes+360; resources.monsterThreat=clamp(resources.monsterThreat-(monster.threat or 5),0,100)
        local guild=Economy.accounts.guild
        if guild then Economy.transfer(guild,npc,monster.reward or 0,"guild_bounty",npc.name.."完成"..monster.name.."斬妖委託") end
    end
    if npc.monsterCombat and npc.monsterCombat.id==session.id then npc.monsterCombat=nil end
    npc.interactionDone=true; npc.interactionResult=reason; npc.combatResult=reason
    if npc.task then npc.task.complete=true; Brain.timing(npc) end
    addEvent(api,reason,{kind="monster_hunt",actor=npc,reason=killed and "怪物死亡並結算公會賞金" or "NanoJev 選擇結束斬妖行動"})
end
function MonsterCombat.tick(api,dt)
    if paused then return end
    MonsterCombat.clock+=dt*speed
    for _,monster in ipairs(monsters) do
        if not monster.alive and worldMinutes>=(monster.respawnAt or math.huge) then monster.alive=true; monster.hp=monster.max_hp; addEvent(api,monster.name.."在荒原重新出沒",{kind="monster_respawn",reason="怪物重生計時完成"}) end
    end
    for _,session in ipairs(MonsterCombat.sessions) do
        if session.done then continue end
        local npc,monster=session.npc,session.monster
        if not npc.alive then MonsterCombat.finish(api,session,"斬妖中止：獵人倒下",false); continue end
        if not monster.alive then MonsterCombat.finish(api,session,npc.name.."完成斬妖："..monster.name.."已被擊敗",true); continue end
        npc.monsterCombat.phase=session.phase; npc.monsterCombat.rounds=session.rounds
        if MonsterCombat.clock<session.nextAt then continue end
        session.phase="clash"; session.rounds+=1; npc.monsterCombat.phase=session.phase; npc.monsterCombat.rounds=session.rounds
        local chance=clamp(62+(npc.martial-monster.damage*4)*.35+(npc.cultivation or 0)*.12-(npc.injury or 0)*.18,28,92)
        local roll=api.random.nextFloat()*100
        local hit=roll<chance
        local damage=hit and math.max(2,math.floor((npc.martial*.06+(npc.cultivation or 0)*.04+(npc.artifact_power or 0)*.2)*Condition.effort(npc))) or 0
        if hit then MonsterCombat.hits+=1; monster.hp=math.max(0,monster.hp-damage); Combat.emit("hit",npc,monster,damage,"monster_hunt",npc.name.." 飛劍命中 "..monster.name); monsterVFX(api,"flying_sword_hit",npc,monster)
        else MonsterCombat.misses+=1; Combat.emit("miss",npc,monster,0,"monster_hunt","MISS"); monsterVFX(api,"flying_sword_miss",npc,monster) end
        npc.fatigue=clamp(npc.fatigue+1.4,0,100)
        if monster.hp<=0 then MonsterCombat.finish(api,session,npc.name.."完成斬妖：擊敗"..monster.name.."，獲得"..monster.reward.."文賞金",true); continue end
        local retaliation=math.max(1,math.floor((monster.damage or 5)*Condition.effort(npc)*(.7+api.random.nextFloat()*.6)))
        local taken=applyDamage(api,npc,retaliation,monster,monster.name.."反擊造成傷勢",false)
        if taken>0 then Combat.emit("hit",monster,npc,taken,"monster_hunt",monster.name.." 反擊") end
        if not npc.alive then MonsterCombat.finish(api,session,"斬妖失敗："..npc.name.."被"..monster.name.."擊倒",false)
        elseif session.rounds>=18 then MonsterCombat.finish(api,session,"斬妖中止："..npc.name.."在"..monster.name.."面前選擇撤退",false)
        else session.nextAt=MonsterCombat.clock+.85 end
    end
    for i=#MonsterCombat.sessions,1,-1 do if MonsterCombat.sessions[i].done then table.remove(MonsterCombat.sessions,i) end end
end

local function maybeJealousy(api, npc, other)
    if not npc.alive or not other.alive or npc.action~="flirt" or not npc.partnerId or npc.partnerId == other.id then return end
    local partner=findNpc(npc.partnerId)
    if not partner or not partner.alive then return end
    if (partner.x-npc.x)^2+(partner.z-npc.z)^2>36 or (partner.x-other.x)^2+(partner.z-other.z)^2>36 then return end
    local marriage=getRelationship(npc,partner)
    marriage.jealousy += 1
    Persona.react(partner,"partner_flirt",{{"possessiveness","jealousy",1}})
    if marriage.jealousy >= 3 and marriage.jealousy % 3 == 0 then
        marriage.resentment=clamp(marriage.resentment+2,0,100)
        storyStats.jealousy += 1
        addEvent(api,partner.name.."看見"..npc.name.."向"..other.name.."示好；遊戲規則增加嫉妒")
    end
end
Pair.jealousy=maybeJealousy

-- Native Unone VFX is presentation only; NanoJev/gameplay still owns hit, damage and outcomes.
local function playCombatVFX(api,effect,actor,target)
    vfxStats.available=api and api.particle and api.particle.play~=nil or false
    if not vfxStats.available then return end
    local source=(effect=="flying_sword_cast" and actor) or target or actor
    if not source then return end
    local position={x=source.x,y=effect=="flying_sword_cast" and 1.55 or 1.1,z=source.z}
    local seed=(frame*31+Combat.sequence*17)%2147483647
    vfxStats.attempts+=1
    local ok,result=pcall(function() return api.particle.play(effect,position,seed) end)
    if ok and result then vfxStats.played+=1; vfxStats.last_error=""
    else vfxStats.last_error=tostring(result or "particle.play returned no handle") end
end

-- A bout is an execution unit, not an AI: only model-approved intentions enter.
function Combat.emit(kind,a,b,damage,mode,text)
    Combat.sequence+=1; Combat.dirty=true
    local weapon=(mode=="attack" or mode=="duel") and "flying_sword" or mode
    local vfx=(kind=="start" or kind=="swing") and "flying_sword_cast" or kind=="hit" and "flying_sword_hit" or kind=="critical" and "flying_sword_critical" or kind=="miss" and "flying_sword_miss" or kind=="finish" and "flying_sword_finish" or ""
    local event={id=Combat.sequence,time=Combat.clock,kind=kind,mode=mode,actor_id=a.id,target_id=b.id,
        actor_name=a.name,target_name=b.name,damage=damage or 0,text=text or "",
        weapon=weapon,vfx=vfx,
        from={x=a.x,z=a.z},to={x=b.x,z=b.z}}
    table.insert(Combat.events,event)
    while #Combat.events>48 do table.remove(Combat.events,1) end
    a.combatUntil=Combat.clock+3; b.combatUntil=Combat.clock+3
end
function Combat.finish(api,bout,reason: string)
    if bout.done then return end
    bout.done=true; Combat.finished+=1
    if bout.mode=="attack" then
        local relation=getRelationship(bout.a,bout.b)
        local unresolved=string.find(reason,"中止",1,true)~=nil
        relation.resentment=clamp(relation.resentment+(unresolved and 8 or 18),0,100)
        relation.trust=clamp(relation.trust-(unresolved and 6 or 14),0,100)
        if bout.a.alive then Persona.react(bout.a,"combat_finished",{{"risk","morale",unresolved and 1 or 3}}) end
        if bout.b.alive then Persona.react(bout.b,"attacked",{{"sensitivity","morale",-4},{"risk","fear",4,true}}) end
    end
    for _,n in ipairs({bout.a,bout.b}) do
        if n.combat and n.combat.id==bout.id then
            n.combat=nil; n.combatIntent=nil; n.combatHolding=false; n.routeCells=nil
            n.interactionDone=true; n.interactionResult=reason; n.combatResult=reason
            if n.task then n.task.complete=true; Brain.timing(n) end
        end
        Brain.requests[n.id]=nil
        n.nextPlan=nil
    end
    Combat.emit("finish",bout.a,bout.b,0,bout.mode,reason)
    playCombatVFX(api,"flying_sword_finish",bout.a,bout.b)
    addEvent(api,reason,{kind="combat",actor=bout.a,target=bout.b,reason=reason})
    if bout.pair and not bout.pair.done then Pair.finish(api,bout.pair,"settled",reason) end
end
function Combat.declareAftermath(api,bout,actor,reason)
    if bout.done or bout.mode~="attack" or bout.phase=="aftermath" or not bout.a.alive or not bout.b.alive then return false end
    local a,b=bout.a,bout.b
    local winner=a.injury<b.injury and a or b
    if a.injury==b.injury then winner=actor or a end
    local loser=winner==a and b or a
    bout.phase="aftermath"; bout.nextAt=math.huge; bout.winner=winner; bout.loser=loser; bout.outcome=nil
    for _,n in ipairs({a,b}) do
        if n.combat and n.combat.id==bout.id then
            n.combat.phase="aftermath"; n.combat.strikes=bout.strikes
            n.combat.winner_id=winner.id; n.combat.loser_id=loser.id; n.combat.outcome_pending=true
            n.combatHolding=true; n.routeCells=nil
        end
        n.combatIntent=n==winner and "awaiting_aftermath_decision" or "downed"
        Brain.requests[n.id]=nil; n.nextPlan=nil
    end
    Combat.emit("aftermath",winner,loser,0,bout.mode,winner.name.."擊敗"..loser.name)
    addEvent(api,winner.name.."擊敗"..loser.name.."；等待勝者決定殺死、掠奪、打暈或放過",{kind="combat_aftermath",actor=winner,target=loser,reason=reason or "交鋒已分出勝負，處置交給 NanoJev"})
    return true
end
function Combat.resumeAftermath(api,bout)
    if bout.done or bout.phase~="aftermath" or not bout.a.alive or not bout.b.alive then return false end
    bout.phase="ready"; bout.nextAt=Combat.clock+.35; bout.outcome=nil
    for _,n in ipairs({bout.a,bout.b}) do
        if n.combat and n.combat.id==bout.id then
            n.combat.phase="ready"; n.combat.outcome_pending=false; n.combatHolding=true; n.routeCells=nil
        end
        n.combatIntent=n==bout.winner and "attack" or "counterattack"
        Brain.requests[n.id]=nil; n.nextPlan=nil
    end
    addEvent(api,bout.loser.name.."選擇反抗，敗後衝突重新開始",{kind="combat_resume",actor=bout.loser,target=bout.winner,reason="NanoJev 選擇承受風險並繼續戰鬥"})
    return true
end
function Combat.resolveAftermath(api,bout,choice)
    if bout.done or bout.phase~="aftermath" or not bout.winner or not bout.loser then return false end
    local winner,loser=bout.winner,bout.loser
    bout.outcome=choice
    local reason
    if choice=="finish_kill" then
        -- Detach a robbery-response pair before the lethal resolution so its
        -- cancellation cannot finalize this bout with the wrong summary.
        if loser.pair and loser.pair.bout==bout then
            loser.pair.done=true; loser.pair.bout=nil; Pair.sessions[loser.pair.id]=nil
            if winner.pair==loser.pair then winner.pair=nil end
            loser.pair=nil
        end
        loser.combat=nil; loser.combatIntent=nil; loser.combatHolding=false; Brain.requests[loser.id]=nil; loser.nextPlan=nil
        reason=winner.name.."選擇殺死"..loser.name
        killNpc(api,loser,winner,reason,"combat")
    elseif choice=="finish_loot" then
        local amount=math.min(25,math.max(0,loser.wealth or 0))
        local transferred=amount>0 and Economy.transfer(loser,winner,amount,"combat_loot",winner.name.."擊敗"..loser.name.."後選擇掠奪") or false
        storyStats.schemes+=transferred and 1 or 0
        reason=winner.name.."選擇掠奪"..loser.name.."，取得"..(transferred and amount or 0).."文"
    elseif choice=="finish_knockout" then
        loser.injury=math.max(loser.injury,75); loser.stunnedUntil=Combat.clock+20
        loser.lastItemEvent="被"..winner.name.."擊暈，短暫失去行動能力"
        reason=winner.name.."選擇打暈"..loser.name.."；對方仍然活著"
    elseif choice=="finish_spare" or choice=="escape" then
        reason=choice=="escape" and loser.name.."選擇逃離交鋒" or winner.name.."選擇放過"..loser.name
    else
        bout.outcome=nil; return false
    end
    Combat.finish(api,bout,"戰鬥處置："..reason)
    return true
end
function Combat.begin(api,a,b,mode,pair)
    if a.combat or b.combat or not a.alive or not b.alive or a==b then return false end
    if Condition.effort(a)<=0 then Brain.failUnit(a,"傷勢達上限，無法出招"); return false end
    if mode=="duel" and (b.combat or not pair or pair.done or pair.kind~="duel" or not pair.accepted or pair.a~=a or pair.b~=b or a.pair~=pair or b.pair~=pair or a.action~="duel" or b.action~="accept" or a.injury>=75 or b.injury>=75) then return false end
    Combat.nextId+=1
    local consent=mode=="duel" and "mutual" or "unconsented_assault"
    local bout={id=Combat.nextId,a=a,b=b,mode=mode,consent=consent,weapon="flying_sword",phase="approach",started=Combat.clock,nextAt=Combat.clock,strikes=0,pair=pair}
    if pair then pair.bout=bout end
    if pair then pair.duration_minutes=nil end
    for _,n in ipairs({a,b}) do
        if n.task then n.task.minutes=0; n.task.timing_kind="combat"; n.task.duration_estimated=nil; Brain.timing(n) end
    end
    local aState:any=a; local bState:any=b
    local combatRef={id=bout.id,mode=mode,consent=consent,phase="approach",strikes=0,actor_id=a.id,target_id=b.id}
    table.insert(Combat.bouts,bout); aState.combat=combatRef; aState.combatIntent="attack"; aState.routeCells=nil
    bState.combat=combatRef; bState.combatIntent=mode=="duel" and "duel" or "hold"; bState.combatHolding=true; bState.routeCells=nil
    if mode=="attack" then
        local relation=getRelationship(a,b)
        relation.resentment=clamp(relation.resentment+8,0,100); relation.trust=clamp(relation.trust-6,0,100)
        Persona.react(b,"attacked",{{"sensitivity","morale",-3},{"risk","fear",5,true}})
    end
    Combat.emit("start",a,b,0,mode,mode=="duel" and (a.name.." 與 "..b.name.." · 飛劍切磋開始") or (a.name.." 以飛劍攻擊 "..b.name))
    playCombatVFX(api,"flying_sword_cast",a,b)
    addEvent(api,a.name.."與"..b.name..(mode=="duel" and "開始切磋；雙方已同意" or "遭到襲擊；未經對方同意"),{kind=mode=="duel" and "duel" or "conflict",actor=a,target=b,reason=mode=="duel" and "雙方 NanoJev 都選擇接受，進入非致命飛劍決鬥" or "攻擊者 NanoJev 直接選擇襲擊；受害者自行決定反擊、閃避或離開"})
    return true
end
function Combat.tick(api,dt)
    if paused then return end
    Combat.clock+=dt*speed
    for _,bout in ipairs(Combat.bouts) do
        if bout.done then continue end
        local a,b=bout.a,bout.b
        if not a.alive or not b.alive then Combat.finish(api,bout,"交鋒結束：有人倒下"); continue end
        if bout.phase=="aftermath" then continue end -- Wait for the winner/loser NanoJev decision.
        if Condition.effort(a)<=0 or (bout.mode=="duel" and Condition.effort(b)<=0) then
            Combat.finish(api,bout,"體況不足，無法繼續交鋒")
            for _,n in ipairs({a,b}) do if Condition.effort(n)<=0 then Brain.failUnit(n,"傷勢達上限，無法出招") end end
            continue
        end
        if Combat.clock-bout.started>45 then Combat.finish(api,bout,"交鋒中止：久攻不下，等待雙方重新決策"); continue end
        local distance=(a.x-b.x)^2+(a.z-b.z)^2
        if bout.phase~="approach" then
            if bout.pair then bout.pair.elapsed_minutes+=dt*8*speed end
            for _,n in ipairs({a,b}) do
                if n.task then n.task.minutes+=dt*8*speed; Brain.timing(n) end
            end
        end
        if bout.phase=="approach" then
            if distance<=9 and not a.reservedX and not b.reservedX then
                bout.phase="ready"; bout.nextAt=Combat.clock+.3; a.combatHolding=true
            elseif frame%30==1 then a.routeCells=nil end
        elseif Combat.clock>=bout.nextAt then
            local actor=a
            if bout.strikes%2==1 and (bout.mode=="duel" or (bout.mode=="attack" and b.combatIntent=="counterattack")) then actor=b end
            local target=actor==a and b or a
            if bout.phase=="ready" then
                if distance>9 then bout.phase="approach"; a.combatHolding=false; a.routeCells=nil; continue end
                actor.facing=math.atan2(target.x-actor.x,target.z-actor.z)
                Combat.emit("swing",actor,target,0,bout.mode,actor.style)
                playCombatVFX(api,"flying_sword_cast",actor,target)
                bout.phase="windup"; bout.nextAt=Combat.clock+.24
            else
                local chance=clamp(78+(actor.martial-target.martial)*.35-actor.fatigue*.13,25,94)
                local roll=api.random.nextFloat()*100
                local hit=distance<=9 and not actor.reservedX and not target.reservedX and roll<chance
                local critical=hit and roll<chance*.14
                local spiritualPower=(actor.cultivation or 0)*.04+(actor.artifact_power or 0)*.18
                local rawDamage=hit and math.max(1,math.floor(clamp(7+(actor.martial-target.martial)*.12+spiritualPower,ATTACK_RAW_DAMAGE_MIN,ATTACK_RAW_DAMAGE_MAX+12)*(critical and ATTACK_CRITICAL_MULTIPLIER or 1)*Condition.effort(actor))) or 0
                local damage=math.min(rawDamage,math.max(0,75-target.injury))
                actor.fatigue=clamp(actor.fatigue+1.2,0,100)
                if damage>0 then Persona.react(target,"hit",{{"sensitivity","morale",-2},{"risk","fear",2,true}}) end
                local relation=getRelationship(actor,target)
                if bout.mode=="attack" then relation.resentment=clamp(relation.resentment+5,0,100); relation.trust=clamp(relation.trust-5,0,100) end
                if hit then Combat.hits+=1 else Combat.misses+=1 end
                Combat.emit(hit and (critical and "critical" or "hit") or "miss",actor,target,damage,bout.mode,hit and (critical and "飛劍重擊" or "飛劍命中") or "MISS")
                playCombatVFX(api,hit and (critical and "flying_sword_critical" or "flying_sword_hit") or "flying_sword_miss",actor,target)
                bout.strikes+=1; bout.phase="ready"; bout.nextAt=Combat.clock+.62
                applyDamage(api,target,rawDamage,actor,"NanoJev 選擇攻擊，交鋒中造成重傷",true)
                if bout.mode=="attack" and (target.injury>=75 or bout.strikes>=24) then
                    Combat.declareAftermath(api,bout,actor,target.injury>=75 and "一方傷勢達到交鋒上限" or "交鋒回合已足，分出當下優勢")
                elseif bout.mode=="duel" and (target.injury>=75 or bout.strikes>=10) then
                    local reason="攻勢結束："..a.name.." → "..b.name
                    if bout.mode=="duel" then
                        local winner=a.injury<b.injury and a or b
                        reason=a.injury==b.injury and "切磋平手 · 點到為止" or (winner.name.." 勝出 · 點到為止")
                        a.martial=clamp(a.martial+.5,0,100); b.martial=clamp(b.martial+.5,0,100)
                        relation.trust=clamp(relation.trust+2,0,100)
                    elseif bout.strikes>=24 then reason="交鋒分出優勢，等待勝者 NanoJev 決定處置" end
                    Combat.finish(api,bout,reason)
                end
            end
        end
    end
    for i=#Combat.bouts,1,-1 do if Combat.bouts[i].done then table.remove(Combat.bouts,i) end end
end

local function processEncounters(api)
    for _,a in ipairs(npcs) do
        if not a.alive or not INTERACTION_ACTION[a.action] or PAIR_ACTION[a.action] or PAIR_RESPONSE[a.action] or a.interactionDone then continue end
        local b=a.interactionTargetId and findNpc(a.interactionTargetId)
        if not b or not b.alive then
            a.interactionDone=true; a.interactionResult="未執行：模型沒有選擇存活的互動對象"; continue
        end
        if Pair.occupied(a) then a.interactionDone=true; a.interactionResult="未執行：本人正在共同互動中"; continue end
        if a.action=="attack" then
            if not a.combat then Combat.begin(api,a,b,"attack") end
            continue
        end
    end
end

local function applyAction(api)
    if paused then return end
    simulationTickCount += 1
    Treasure.tick(api)
    Economy.tick()
    local efforts,elapsed={},{}
    for _, npc in ipairs(npcs) do
        if npc.alive then
            Life.tick(npc,math.max(0,worldMinutes-npc.lastNeedsMinute),Life.clock(worldMinutes))
            npc.lastNeedsMinute=worldMinutes
            local minutes=Brain.executionMinutes(npc)
            local effort=minutes/(npc.task and npc.task.effort_minutes or 4)*Condition.effort(npc)
            if npc.task then effort=npc.task.complete and 0 or math.min(effort,math.max(0,8-(npc.task.effort or 0))) end
            if npc.task and PRODUCTIVE_ACTION[npc.action] and Condition.effort(npc)>0 then minutes=effort*(npc.task.effort_minutes or 4)/Condition.effort(npc)
            elseif npc.task and npc.task.duration_minutes then minutes=math.min(minutes,math.max(0,npc.task.duration_minutes-(npc.task.minutes or 0))) end
            elapsed[npc.id]=minutes
            efforts[npc.id]=effort
        if npc.combat then
            -- Combat.tick owns both participants; no parallel work, eating, or healing.
        elseif npc.monsterCombat then
            -- MonsterCombat.tick owns the contract; no parallel work or healing.
        elseif Pair.occupied(npc) or PAIR_ACTION[npc.action] or PAIR_RESPONSE[npc.action] then
            -- Pair.tick owns this unit; neither participant receives parallel work or healing.
        elseif not Brain.ready(npc) or not npc.task or npc.task.complete or minutes<=0 then
            -- Effects require arrival; fatigue from travel is accounted by Life.tick.
        elseif TIMED_ACTION[npc.action] and npc.task.minutes+minutes<(npc.task.duration_minutes or math.huge)-1e-9 then
            -- Atomic benefits wait for this sampled duration; interruption discards only the unfinished attempt.
        elseif PORTABLE_ACTION[npc.action] or npc.action=="buy_food" or npc.action=="buy_herbs" or npc.action=="shop" then Life.itemAction(npc)
        elseif npc.action == "work" and effort>0 then
            npc.jobEnergy=clamp(npc.jobEnergy+effort,0,100)
        elseif npc.action == "rest" then
            -- Daytime rest / nighttime sleep recovery is time-based in Life.tick.
        elseif npc.action == "eat" then
            if not npc.itemActionDone and npc.hunger>25 and Economy.buy(npc,"inn","food") then
                npc.hunger=clamp(npc.hunger-36,0,100); npc.fatigue=clamp(npc.fatigue-1,0,100); npc.morale=clamp(npc.morale+2,0,100)
            end
            npc.itemActionDone=true
        elseif npc.action == "train" and effort>0 then
            npc.martial=clamp(npc.martial+0.7*effort,0,100); npc.morale=clamp(npc.morale+1,0,100)
        elseif npc.action == "cultivate" and effort>0 then
            npc.qi=clamp(npc.qi+0.8*effort,0,100)
            npc.cultivation=clamp(npc.cultivation+0.22*effort,0,100)
            refreshCultivation(npc)
            npc.morale=clamp(npc.morale+0.3,0,100)
        elseif npc.action == "seek_manual" then
            if not npc.itemActionDone then
                local chance=clamp(.45+Persona.trait(npc,"discipline")*.003+Persona.trait(npc,"risk")*.001+(npc.inventory.manuals or 0)*.08,.35,.9)
                if api.random.nextFloat()<chance then
                    npc.inventory.manuals=math.min(3,(npc.inventory.manuals or 0)+1)
                    local techniqueIndex=((npc.inventory.manuals-1)%#CULTIVATION_TECHNIQUES)+1
                    npc.technique=CULTIVATION_TECHNIQUES[techniqueIndex]
                    npc.cultivation=clamp(npc.cultivation+4,0,100); refreshCultivation(npc)
                    npc.lastItemEvent="在藏經閣找到 "..npc.technique
                    addEvent(api,npc.name.."在藏經閣找到功法："..npc.technique,{kind="cultivation",actor=npc,reason="尋找功法成功"})
                else
                    npc.lastItemEvent="翻遍藏經閣，這次沒有找到合適功法"
                end
                npc.itemActionDone=true
            end
        elseif npc.action == "alchemy" then
            if not npc.itemActionDone then
                if Economy.useItem(npc,"herbs") then
                    npc.inventory.pills=(npc.inventory.pills or 0)+1
                    npc.lastItemEvent="煉成一枚丹藥"
                    addEvent(api,npc.name.."煉成丹藥",{kind="cultivation",actor=npc,reason="煉丹完成"})
                else
                    npc.lastItemEvent="煉丹失敗：沒有藥材"
                end
                npc.itemActionDone=true
            end
        elseif npc.action == "forge_artifact" then
            if not npc.itemActionDone then
                if Economy.useItem(npc,"wares") then
                    npc.inventory.artifacts=(npc.inventory.artifacts or 0)+1
                    npc.artifact_power=clamp((npc.artifact_power or 0)+8,0,40)
                    npc.lastItemEvent="打造出法寶，飛劍威力提升"
                    addEvent(api,npc.name.."打造法寶，飛劍威力提升",{kind="cultivation",actor=npc,reason="法寶打造完成"})
                else
                    npc.lastItemEvent="煉器失敗：沒有日用品材料"
                end
                npc.itemActionDone=true
            end
        elseif npc.action == "find_work" then
            if not npc.itemActionDone then
                local previous=npc.job and Economy.accounts[npc.job.firm] and Economy.accounts[npc.job.firm].name or "無"
                if Economy.findJob(npc) then
                    npc.lastItemEvent="從"..previous.."轉為"..Economy.accounts[npc.job.firm].name.."的工作契約"
                    addEvent(api,npc.name.."找到工作：與"..Economy.accounts[npc.job.firm].name.."簽訂契約",{kind="employment",actor=npc,reason="原工作契約失效後，NanoJev 選擇找工作並接受可支付的職位"})
                else
                    npc.lastItemEvent="找工作未果：目前沒有能支付工錢的職缺"
                end
                npc.itemActionDone=true
            end
        elseif npc.action == "seek_treasure" then
            if not npc.itemActionDone then
                if Treasure.claim(api,npc) then
                    npc.interactionResult="已奪得"..(Treasure.active and Treasure.active.name or "稀世珍寶")
                elseif Treasure.active then
                    npc.interactionResult="抵達時"..Treasure.active.name.."已被他人取得"
                else
                    npc.interactionResult="稀世珍寶事件已結束，未能取得"
                end
                npc.itemActionDone=true
            end
        elseif npc.action == "gather" and effort>0 then
            npc.jobEnergy=clamp(npc.jobEnergy+effort,0,100)
        elseif npc.action == "hunt" and effort>0 then
            local damage=applyDamage(api,npc,minutes/4,nil,"狩獵受傷，傷勢累積致死",false)
            if npc.alive then
                npc.martial=clamp(npc.martial+0.3*effort,0,100); resources.monsterThreat=clamp(resources.monsterThreat-2*effort,0,100)
                if damage>0 then Persona.react(npc,"hunt",{{"risk","fear",.5,true}}) end
            end
        elseif npc.action == "hunt_monster" and effort>0 then
            if not npc.monsterCombat then MonsterCombat.begin(api,npc) end
        elseif npc.action == "duel" then
            -- Waiting for another willing model-selected sparrer never causes injury.
        elseif npc.action == "travel" then
            if npc.task.minutes+minutes>=npc.task.duration_minutes-1e-9 then npc.loneliness=clamp(npc.loneliness-3,0,100) end
        end
            if npc.alive and npc.task and not npc.task.complete and PRODUCTIVE_ACTION[npc.action] and Brain.ready(npc) and Economy.work(npc,effort) then Persona.react(npc,"paid_work",{{"discipline","morale",2}}) end
        end
    end
    ageAndCheckNaturalDeaths(api)
    resources.food=Economy.stock("food"); resources.herbs=Economy.stock("herbs")
    processEncounters(api)
    for _,npc in ipairs(npcs) do
        if npc.alive then
            Brain.progress(npc,elapsed[npc.id] or 0,efforts[npc.id])
            npc.lastTaskMinute=worldMinutes
        end
    end
end

local function registerDebug(api)
    if not api.debug.enabled then return end
    api.debug.registerTab({id="sandbox",label="武俠沙盒"})
    api.debug.register({kind="button",id="sandbox.pause",tab="sandbox",label="暫停 / 繼續"},function() paused=not paused; publish(api) end)
    api.debug.register({kind="button",id="sandbox.faster",tab="sandbox",label="加速模擬"},function() speed=clamp(speed+1,1,4); publish(api) end)
    api.debug.register({kind="button",id="sandbox.reset",tab="sandbox",label="重設雲水鎮"},function() resetWorld(api) end)
    api.debug.register({kind="label",id="sandbox.note",tab="sandbox",text="人物決策：NanoJev 本機 checkpoint；無規則 fallback。Luau 管世界規則與合法性；完整機率見遊戲人物決策面板。"})
    api.debug.register({kind="label",id="sandbox.thinking.selected",tab="sandbox",text="思考監看：等待第一個決策"})
    api.debug.register({kind="label",id="sandbox.economy",tab="sandbox",text="小鎮帳務：等待初始化"})
    api.debug.register({kind="label",id="sandbox.life",tab="sandbox",text="人物生活：等待初始化"})
    for page=1,4 do
        api.debug.register({kind="label",id="sandbox.thinking.roster."..page,tab="sandbox",text="思考監看：等待第一個決策"})
    end
    debugRegistered = true
end

function Game.start(api)
    registerDebug(api)
    resetWorld(api)
end

function Game.update(api,dt)
    frame += 1
    local selectionChanged = false
    for i, npc in ipairs(npcs) do
        if api.input.isDown("inspect_"..npc.id) and selectedNpc ~= i then
            selectedNpc=i
            setResidentPage(math.floor((i - 1) / RESIDENTS_PER_PAGE) + 1)
            selectionChanged=true
        end
    end
    if api.input.isDown("page_prev") then
        selectionChanged=setResidentPage(residentPage - 1) or selectionChanged
    elseif api.input.isDown("page_next") then
        selectionChanged=setResidentPage(residentPage + 1) or selectionChanged
    end
    local pointerDown = api.input.isPointerDown()
    if pointerDown and not pointerHeld then
        local pointer = api.input.getScreenPointerPosition()
        if pointer.x >= 4 and pointer.x <= 14 and pointer.y >= 6 and pointer.y <= 11 then
            selectionChanged=setResidentPage(residentPage - 1) or selectionChanged
        elseif pointer.x >= 37 and pointer.x <= 47 and pointer.y >= 6 and pointer.y <= 11 then
            selectionChanged=setResidentPage(residentPage + 1) or selectionChanged
        end
        local pageStart = (residentPage - 1) * RESIDENTS_PER_PAGE
        for slot=1,RESIDENTS_PER_PAGE do
            local i = pageStart + slot
            local y = 73 - (slot - 1) * 7.2
            if pointer.x >= 4 and pointer.x <= 59 and pointer.y >= y and pointer.y <= y + 6.5 then
                if selectedNpc ~= i then
                    selectedNpc=i
                    selectionChanged=true
                end
                break
            end
        end
    end
    pointerHeld=pointerDown
    if api.input.isDown("toggle_pause") or api.input.isDown("pause") then paused=not paused end
    if api.input.isDown("speed_up") then speed=clamp(speed+1,1,4) end
    if api.input.isDown("speed_down") then speed=clamp(speed-1,1,4) end
    if selectionChanged then publish(api) end
    if paused then publish(api); return end
    receiveModelDecisions(api)
    Brain.advancePlans(api)
    worldMinutes += dt*8*speed
    decideStaggered(api)
    if frame%SIMULATION_INTERVAL==0 then applyAction(api) end
    updateMovement(api,dt)
    Pair.tick(api,dt)
    Combat.tick(api,dt)
    MonsterCombat.tick(api,dt)
    Brain.advancePlans(api)
    if frame==1 or frame%SIMULATION_INTERVAL==0 or (Combat.dirty and frame%6==0) then publish(api); Combat.dirty=false end
end

return Game
