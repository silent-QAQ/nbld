# 物品/背包/装备/合成系统 + 属性系统优化 实施计划

## 现状（已探查）

- **属性系统** (`attribute_system.go`)：18 属性、8 层来源（Base/LevelGrowth/Talent/Equipment/PassiveGem/Buff/System/Manual）→ Derived → Combat 派生管线已完整，但 **Equipment 层永远为 0**（装备不产生属性）；每次重算 `HealthCurrent = HealthMax`（换装会满血复活）。
- **物品**：只有 `ItemStack{itemId, quantity}`，**无物品定义注册表**（无名称/品质/堆叠上限/装备槽位/属性）。
- **背包 UI** (`main.ts`)：9 格快捷栏 + 54 格背包已渲染，**纯展示无交互**。
- **装备** (`CharacterEquipment`)：10 个槽位字段 + VisibleArmor 同步已存在；只有裸替换端点，**无校验、无属性贡献、无穿脱操作**。
- **合成**：完全不存在。
- 持久化为 JSONB（`characters.inventory/equipment/stats`），无需新迁移。
- 测试模式：`httptest` + `performJSONRequest[T]` 泛型助手（`server_test.go`）。

## 设计决策

1. **物品注册表放服务端 Go 代码**（`item_registry.go`），客户端通过 `GET /api/v1/items` 拉取一次 —— 单一数据源，避免两端重复定义。
2. **背包定长 63 槽**（0-8 快捷栏，9-62 背包），空槽 = 空 ItemStack。与现有客户端 `items[index]` 按下标寻址的模式一致。
3. **服务端权威的语义化操作端点**（move/equip/unequip/craft），替代客户端整包上传（旧裸端点保留作调试用）。
4. **合成格是客户端虚拟容器**：3x3 格内容随 craft 请求发送，服务端校验背包持有 → 扣料 → 发放产物。不落服务端容器状态（断线不丢物品，实现简单）。配方注册表在服务端，`GET /api/v1/recipes` 供客户端本地预览匹配，craft 时服务端重新校验。
5. **属性优化核心**：装备穿脱 → 重算 `Sources.Equipment` = 所有已装备物品属性之和 → `NormalizeCharacterStats` → **按比例保留** 当前血/蓝/耐力（不满血复活），并同步在线会话的资源上限。
6. 玩家目前无获取物品途径 → **建角时发新手材料包**，另加 debug 发放端点便于测试。
7. 无贴图素材 → 物品图标用品质色块 + 简名（后续可换精灵图）。

## 服务端改动

### 1. `item_registry.go`（新）
- `ItemDefinition{ID, Name(中文), Type(material/consumable/equipment), Rarity, StackLimit, EquipSlot, Stats AttributeValues, Description}`
- 起步内容 ~20 件：原木/木板/木棍/石头/铁矿/铁锭/皮革；木剑/石剑/铁剑（mainHand，物攻）；皮甲 4 件+铁甲 4 件（对应槽位，物防/法防）；小回血药（consumable）。
- 校验助手：`itemDef(id)`, `isEquippable(id, slot)`, `stackLimit(id)`。
- `GET /api/v1/items` 返回全部定义。

### 2. `recipe_registry.go`（新）
- `Recipe{ID, Shaped bool, Pattern [9]string(shaped) / Inputs map[string]int(shapeless), Output ItemStack}`
- shaped 匹配支持平移（图案在 3x3 内任意位置）+ 行列紧凑化；shapeless 按数量集合匹配。
- 起步配方：原木→4木板（无序）、木板x2→4木棍、剑（2材料+1棍 竖排）、各甲片图案、铁锭（3x3 铁矿→中间产物简化为 无序 2矿→1锭）。
- `GET /api/v1/recipes` 返回全部。

### 3. 背包操作（`server.go` + `inventory_ops.go` 新）
- 归一化：加载/变更时把 `Inventory.Items` 规范为定长 63、合并非法堆叠（超上限拆分）。
- `POST /api/v1/inventory/move {token, characterId, from, to}`：同物品合并（尊重堆叠上限）、异物品交换、空槽移动。
- 建角新手包：在 `createCharacter` 写入起步材料（原木x16、石头x8、铁矿x4、皮革x8、小回血药x3 之类）。
- `POST /api/v1/debug/give {token, characterId, itemId, quantity}`（仅测试）。

### 4. 装备（`server.go`）
- `POST /api/v1/equipment/equip {token, characterId, inventorySlot}`：读物品定义 → 校验可装备 → 与目标槽现有装备互换（旧装备回背包原槽）→ 重算 Equipment 属性层 → Normalize → 保留资源比例 → 同步在线会话资源上限。
- `POST /api/v1/equipment/unequip {token, characterId, equipSlot}`：卸下 → 放入首个空背包槽（满则拒绝）→ 同上重算。
- `recomputeEquipmentStats(character)`：汇总所有已装备 itemId 的 Stats 写入 `Sources.Equipment`（health 条目按现有规则自动忽略并告警）。

### 5. 合成（`server.go`）
- `POST /api/v1/craft {token, characterId, grid [9]string}`：匹配配方 → 校验背包含全部输入 → 扣除 → 产物入包（找空槽/可堆叠槽，满则拒绝）→ 返回更新后角色。

### 6. 属性系统优化（`attribute_system.go` 小改）
- 新增 `applyResourcePreservation(old, new CharacterCombatStats)`：按比例映射 Current（如 80/100 血 → 换装上限 120 → 96/120）。
- 装备/合成路径统一走 `NormalizeCharacterStats`，确保 PowerScore、告警等一致。

### 7. 测试（`server_test.go` 追加 + `recipe_registry_test.go` 新）
- 装备穿/脱：属性变化、背包互换、非法物品拒绝、资源比例保留。
- 合成：shaped 平移匹配、shapeless、材料不足拒绝、背包满拒绝。
- 背包 move：合并/交换/堆叠上限。

## 客户端改动（`main.ts` + `protocol.ts` + `api.ts`）

### 8. 协议与数据
- 新类型：`ItemDefinition`, `Recipe`；`api.ts` 增加 `items()`, `recipes()`, `moveItem()`, `equipItem()`, `unequipItem()`, `craft()`。
- 登录进世界后拉取物品/配方注册表存入 state（Map 索引）。

### 9. 背包交互（Minecraft 式光标持物）
- 点击槽位拾起整堆 → 再点击放下/交换/合并；持物时光标旁渲染物品。
- 物品格显示：品质色边框 + 中文名简写 + 数量角标；悬浮 tooltip 显示完整名称/品质/属性/描述。
- 装备面板槽位可交互：光标持可装备物品点击对应槽 → equip；点击已装备槽（空手）→ unequip。
- 对装备类物品右键/双击 = 快捷装备（调 equip）。

### 10. 合成 UI（背包界面内 3x3 工作台）
- 背包模态内新增「合成」区：3x3 输入格 + 产物格。
- 放入格子的物品从背包"预留"（本地状态，不发服务器）；本地用配方表实时匹配显示产物预览。
- 点击产物：发送 `craft(grid)` → 成功后清格、刷新背包；失败显示原因。
- 关闭界面时格内预留物品自动"归还"（纯本地，无需服务器操作）。

### 11. HUD/属性展示
- 属性面板显示装备加成（Derived 中 Equipment 层的贡献），换装后即时刷新。

## 实施顺序

1. 服务端注册表（物品+配方）+ GET 端点 + 单测
2. 背包归一化 + move 端点 + 新手包 + 单测
3. 装备 equip/unequip + 属性重算 + 资源保留 + 单测
4. craft 端点 + 单测
5. 客户端协议/api + 注册表拉取
6. 背包交互 UI（光标持物 + tooltip）
7. 装备面板交互
8. 合成 UI
9. 端到端手工验证（重启服务端 `restart_server.sh`，浏览器实测流程：建角→领新手包→合成木剑→装备→看属性/战力变化）

## 验证方式

- `go build ./... && go test ./...`（服务端）
- `npx tsc --noEmit`（客户端）
- REST 冒烟：注册→建角→查背包（含新手包）→move→craft→equip→stats 断言 PowerScore/物攻上升
- 浏览器手工走查合成+装备全流程
