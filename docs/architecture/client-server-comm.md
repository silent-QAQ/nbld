# 客户端与服务端通信职责

本文件定义 H5 客户端与 Go 服务端之间的通信通道职责边界与实时消息协议。实时层协议以 `shared/proto/realtime.json` 为**单一真源**，请勿手工修改生成产物。

## 通道职责

| 通道 | 定位 | 承载内容 |
|---|---|---|
| **HTTP REST** | 请求/响应型操作 | 登录鉴权、角色 CRUD、进入/离开世界、区块窗口拉取、随机种子 |
| **WebSocket** `/ws/world` | 实时双向同步 | 鉴权握手、移动、实体进出/位置同步、地图切换、心跳 |
| ~~SSE~~ | 已移除 | 原 `/api/v1/world/events` 与 WS 功能重复且无客户端消费，已删除 |

原则：

- **服务端权威**。移动位置、地图归属、跨图坐标归一化均由服务端裁定。
- **客户端只做表现与局部预测**。本地预测移动，不因服务端回包硬跳（除跨图外）。
- 移动实时路径统一走 **WebSocket**；HTTP `POST /api/v1/world/move` 仅作无 WS 时的降级兜底。
- 区块拉取是**事件驱动**：仅在玩家越过区块边界或发生跨图时通过 HTTP 拉取，不做定时空转轮询。
- GET 鉴权接口的会话 token 走 `Authorization: Bearer <token>` 头，避免写入代理/访问日志；服务端同时兼容 `?token=` query 作为向后兼容。

## 鉴权

- HTTP：`Authorization: Bearer <token>`（兼容 `?token=`）。
- WebSocket：浏览器无法自定义握手头，连接建立后的**第一条消息**必须是 `auth`，携带 token。

## 实时消息协议

真源：`shared/proto/realtime.json`。生成命令：

```bash
node tools/gen_realtime_proto.mjs
```

产物（不要手改）：

- `server/internal/protocol/realtime_gen.go`：消息类型常量（`MsgClientAuth`、`MsgServerPlayerJoined` 等）
- `client/web/src/protocol.gen.ts`：`WSClientMessage` / `WSServerMessage` 判别联合类型

### 客户端 → 服务端

| type | 说明 | 字段 |
|---|---|---|
| `auth` | 连接后首条，鉴权 | `token` |
| `move` | 上报预测位置（世界瓦片坐标） | `position` |
| `ping` | 应用层心跳 | 无 |

### 服务端 → 客户端

| type | 说明 | 关键字段 |
|---|---|---|
| `auth_ok` | 世界快照：自身信息 + 同图可见玩家列表；跨图后会再次下发 | `players[]`（含外观/装备） |
| `player_joined` | 有玩家进入本图可见范围，**含完整外观与装备** | `appearance`、`equipment` |
| `player_moved` | 其他玩家轻量位置更新，**不含外观**（外观已在 join/snapshot 下发），不回发本人 | `playerId`、`position` |
| `player_left` | 某玩家离开本图可见范围或断开连接 | `playerId` |
| `move_ack` | **仅回发移动者本人**的权威位置确认；`transitioned=true` 时客户端重载区块 | `position`、`transitioned` |
| `pong` | 心跳应答 | 无 |
| `error` | 错误 | `error` |

### 关键设计约束

- **不向移动者本人广播 `player_moved`**：本人保留本地预测，避免回弹。权威修正走仅发本人的 `move_ack`。
- **外观只随 join/snapshot 下发一次**：`player_moved` 保持轻量，客户端更新已有玩家位置时保留其外观缓存。
- **进出场对称**：连接建立向同图广播 `player_joined`，断开广播 `player_left`；跨图时对旧图广播 `player_left`、对新图广播 `player_joined`，消除幽灵玩家。

## Area of Interest（AOI v1）

当前兴趣范围 = **同一 world + 同一 map**。

- 服务端广播过滤：`wsHub.broadcastToMap(worldID, mapID, excludePlayerID, msg)`
- 快照口径一致：`stateStore.listMapPlayers(worldID, mapID, excludePlayerID)`

后续可在 `broadcastToMap` 内叠加基于网格/半径的更细粒度订阅，无需改动调用点。

## 客户端连接韧性

- **断线重连**：指数退避（500ms 起，上限 10s），重连成功后由 `auth_ok` 快照重建可见玩家集合。
- **心跳**：客户端每 15s 发送 `ping`，服务端回 `pong`；WS 协议层 ping/pong 帧亦被处理。
- 用户主动登出时关闭重连（`disconnectWebSocket`）。

## 验证

```bash
cd server && go test ./...
cd client/web && node node_modules/typescript/lib/tsc.js --noEmit -p tsconfig.json
```

> 注：本机 `node_modules` 为跨平台安装，`vite build` 因缺少 `@rollup/rollup-win32-x64-msvc` 原生二进制而失败，属环境问题，与本协议无关；类型检查（tsc）通过即验证 TS 正确性。
