# 装饰方块破坏 + 建造放置系统实施计划

## 需求确认

1. **破坏**：手持工具，鼠标左键破坏"人物朝向直线4格+自身格=5格"内的装饰方块；破坏速度受工具影响；破坏后按装饰掉落表获得物品
2. **放置**：手持建造方块（快捷栏选中），鼠标左键在人物 9x9 范围（切比雪夫距离≤4）放置
3. **物品系统丰富**：新增工具/材料/建造方块物品；**每个物品都有重量字段**（暂不影响移速，仅数据+展示）
4. **工具耐久**：本期实现（用户已确认）
5. **存储方案**：复用区块 DeltaTiles（用户已确认），地形层不可破坏，只动 `Decoration` 字段

## 核心设计

- **手持 = 快捷栏选中槽**（不动装备系统）：选中工具→左键挖掘；选中建造方块→左键放置；空手/其他→按空手挖掘（tier 0）
- **耐久**：`ItemStack` 加可选 `durability` 字段；`nil = 满耐久`（合成/发放无需改动），工具 stackLimit=1 天然不参与堆叠合并；归零消失
- **挖掘节奏**：客户端按住左键显示进度条，进度满发 `harvest` 请求；服务端按"装饰硬度×工具系数"重算时长，并用 `lastHarvestAt` 节流校验（≥70% 时长）防刷
- **同步**：破坏/放置成功 → 修改区块 tile.Decoration → 写 DeltaTiles → 立即持久化 → WS 广播 `tile_update` 给附近玩家；客户端更新本地 chunk 并重渲染

---

## 服务端改动（Go）

### 1. `server/internal/app/item_registry.go` — 物品系统扩展
- `ItemDefinition` 新字段：`Weight float64`（千克，所有物品必填）、`ToolType string`（axe/pickaxe/sickle）、`ToolTier int`（1木/2石/3铁）、`MaxDurability int`、`PlacesDecoration string`（放置后的装饰ID）
- 新类型常量：`ItemTypeTool = "tool"`、`ItemTypeBlock = "block"`
- 全部 18 个现有物品补 `Weight`
- 新增 8 个工具：木/石/铁斧（tool_wood_axe…）、木/石/铁镐、石/铁镰刀（耐久 60/132/251）
- 新增 8 个采集材料：`item_fiber` 纤维、`item_flower` 花瓣、`item_mushroom` 蘑菇(consumable)、`item_berry` 浆果(consumable)、`item_cactus_flesh` 仙人掌肉、`item_granite` 花岗岩、`item_sandstone` 砂岩、`item_snow_grass`（雪地植物纤维，可并入 fiber 视情况）
- 新增 7 个建造方块物品（type=block，带 PlacesDecoration/Weight）：`block_wood_fence`、`block_stone_fence`、`block_wood_wall`、`block_stone_wall`、`block_wood_floor`、`block_stone_floor`、`block_torch`

### 2. `server/internal/app/account_store.go` — ItemStack 耐久
- `ItemStack` 加 `Durability *int \`json:"durability,omitempty"\``
- `inventory_ops.go`：normalize/合并逻辑保持（工具 stackLimit=1 不会触发合并）；确认 `moveInventoryItem` 交换路径不丢 durability（结构体整体拷贝，天然保留）

### 3. 新文件 `server/internal/app/decoration_registry.go` — 装饰注册表
覆盖 map_palettes.go + assets.ts 中全部 ~50 个装饰 + 7 个新建造装饰，每条定义：
```go
type DecorationDefinition struct {
    ID           string   // 装饰ID，与 tile.Decoration 一致
    Name         string   // 中文名
    Kind         string   // plant | rock | wood | building
    Hardness     float64  // 基础破坏秒数（空手/对口工具前）
    RequiredTool string   // "" = 徒手可破坏；axe/pickaxe/sickle
    MinTier      int      // 需要的最低工具等级
    Blocking     bool     // 是否阻挡移动（供客户端碰撞&放置校验）
    Drops        []DecorationDrop // {ItemID, Min, Max}
}
```
分类基线：
- 花/草/蘑菇类：徒手 0.3-0.5s，掉 fiber/flower/mushroom/berry
- 灌木/树苗：徒手 1.2s（镰刀减速系数适用），掉 stick+fiber
- 树（deciduous/conifer/jungle/dead/palm/acacia/stump/fallen_log）：需 axe tier≥1，2.5-4s，掉 wood_log×2-4
- 软岩（small_stone/pebble/flat/mossy/weathered/sandstone/desert）：pickaxe tier≥1（small_stone/pebble 徒手可捡 0.5s），掉 stone×1-3（sandstone→item_sandstone）
- 硬岩（granite_boulder/slate/basalt/sharp/large_stone/glacier_rock）：pickaxe tier≥2，3-5s，掉 stone×2-4（granite→item_granite）
- 建造装饰（deco_wood_fence 等7个）：对应工具可拆，掉回自身物品×1
- 工具速度系数：对口工具 tier1 ×0.6 / tier2 ×0.35 / tier3 ×0.2；镰刀对植物类同理
- `validateDecorationDefinitions()` 测试校验掉落物品都已注册

### 4. `server/internal/app/recipe_registry.go` — 新配方（15个）
- 工具（MC 风格图案）：斧=材料×3+棍×2、镐=材料×3+棍×2、镰=材料×2+棍×1（木/石/铁 各档）
- 建造：木栅栏（板×4+棍×1→×8）、石栅栏（石×4+棍×1→×8）、木围墙（板×3竖排→×2）、石围墙（石×3竖排→×2）、木地板（板×4 2x2→×4）、石地板（石×4 2x2→×4）、火把（棍×1+木板×1→×4，暂无煤炭）

### 5. `server/internal/app/world_chunks.go` — 区块修改方法
```go
func (m *worldChunkManager) setTileDecoration(mapID string, globalX, globalY int, decoration string) (protocol.ChunkTile, error)
```
- 加锁 → ensureChunkLoaded → 定位 tile（局部坐标换算）→ 改 `Decoration` → 更新/追加 DeltaTiles 条目（整 tile 快照）→ `Dirty=true` → 立即 `persistence.save`
- 返回更新后的 tile 供响应/广播

### 6. 新文件 `server/internal/app/world_interact.go` — 交互端点
- `POST /api/v1/world/harvest` `{token, characterId, x, y, slot}`：
  1. 会话校验（需在世界中）+ 欧氏距离 ≤ 4.5 格（朝向直线由客户端 UI 约束，服务端注释说明）
  2. 读取目标 tile：`Decoration` 非空且在注册表
  3. 工具校验：slot 物品的 ToolType/Tier 满足要求（RequiredTool="" 时任意）
  4. 节流：`sessionState.LastHarvestAt`，间隔 ≥ 计算时长×0.7
  5. 原子更新角色（updateCharacterFromRequest）：掉落 addItemToInventory（满则整体失败）+ 工具耐久-1（nil→Max-1，0→删除）
  6. setTileDecoration(…, "") → 广播 `tile_update`
  7. 响应 `{character, items[], tile}`
- `POST /api/v1/world/place` `{token, characterId, x, y, slot}`：
  1. 会话校验 + 切比雪夫距离 ≤ 4（9x9）
  2. 目标 tile：Decoration 为空、block 非水/非阻挡、feature≠river
  3. Blocking 方块不可放在任何同图玩家占用格
  4. slot 物品为 block 类型 → 扣1个 → setTileDecoration(…, PlacesDecoration) → 广播
- `GET /api/v1/decorations`：下发装饰注册表（含 blocking/硬度/工具要求，客户端本地进度计算用）
- `sessionState` 加 `LastHarvestAt time.Time`

### 7. 协议 & 实时消息
- `server/internal/protocol/session.go`：Harvest/Place 请求响应结构；`WSServerMessage` 加 `TileX/TileY/TileDecoration`（omitempty，注意 decoration 为空串也要能表达——用 `*string` 或加 `HasTile bool`，倾向 `Tile *TileUpdate` 子结构）
- `shared/proto/realtime.json`：serverMessages 加 `tile_update`；`tools/gen_realtime_proto.mjs` 补 `int`→Go `int`/TS `number` 映射；重新生成两端
- `server.go` routes() 注册 3 个新路由

### 8. 测试
- `item_systems_test.go` 模式：装饰注册表 validate、配方 validate（新掉落物/配方物品都已注册）、harvest/place handler 的核心路径单测（复用现有内存模式测试基建）
- `go build ./... && go test ./...`

---

## 客户端改动（TypeScript, client/web/src）

### 9. `protocol.ts` / `api.ts`
- `ItemStack.durability?`、`ItemDefinition` 新字段（weight/toolType/toolTier/maxDurability/placesDecoration，type 加 "tool"|"block"）
- `DecorationDefinition` 类型 + `WSServerMessage` 加 tile_update 字段
- api：`decorations()`、`harvest(token, characterId, x, y, slot)`、`place(...)`

### 10. 贴图与资源
- `tools/generate_pixel_textures.py`：DECORATIONS 加 7 个建造装饰外观（deco_wood_fence/deco_stone_fence/deco_wood_wall/deco_stone_wall/deco_wood_floor/deco_stone_floor/deco_torch）；输出目录除 unity 外同步写 `client/web/public/art/decorations/`（tiles 同理），运行脚本生成
- `assets.ts`：DECORATION_IDS 加 7 个新ID

### 11. `main.ts` — 交互实现
- **state**：`decorationDefs: Map<string, DecorationDefinition>`、`digging: {x,y,startedAt,durationMs} | null`、`hoverTile: {x,y} | null`
- **启动**：进入世界后拉取 `/api/v1/decorations`，用返回的 blocking 字段扩充 `BLOCKING_DECORATIONS`
- **screenToWorld**（worldToScreen 逆变换）+ canvas 事件：
  - `mousemove`：更新 hoverTile
  - `mousedown`(左键)：
    - 选中槽是 block 物品 → 目标在9x9内且合法 → 调 place → 成功后本地更新 tile + 重渲染 chunk + 背包刷新
    - 否则 → 目标必须在"朝向直线5格"内（本地按 state.facing 计算合法格集合）且装饰可破坏（工具匹配）→ 启动 digging（时长=硬度×工具系数）
  - `mouseup`/移动/切换槽位 → 取消 digging
- **loop**：digging 进度满 → 调 harvest → 成功后更新 tile、重渲染、背包同步、掉落物提示（状态栏短提示）
- **draw**：hover 格描边（放置模式绿/红合法性）；digging 目标格画进度遮罩（由浅入深裂纹/进度环）
- **WS**：处理 `tile_update` → `updateLocalTile(mapId, x, y, decoration)`：改 chunk.snapshot.tiles + 重新 renderChunk 入队
- **快捷栏/背包槽**：`renderItemSlot` 显示耐久条（durability/maxDurability 百分比小色条）；物品 tooltip 加重量显示
- `npm run build`（或项目现有 lint/build 命令）验证

---

## 实施顺序（任务）

1. 服务端：物品扩展 + ItemStack 耐久 + 装饰注册表 + 配方（含测试）
2. 服务端：setTileDecoration + harvest/place/decorations 端点 + 协议/realtime 生成 + 广播（含测试）
3. 贴图生成 + assets/协议/api 客户端基础
4. 客户端：挖掘/放置交互 + 渲染反馈 + tile_update 同步 + 耐久/重量 UI
5. 全量构建与测试验证（go test、tsc build），按 memory 提示用 restart_server.sh 重启验证

## 不做（明确排除）

- 地形层（Terrain/Block/Feature）破坏
- 重量影响移速（仅存数据+展示）
- 箱子/门等有交互状态的建造物
- 建筑所有权/权限（DeltaTiles 方案无主人记录）
- 工具修复/融合配方
