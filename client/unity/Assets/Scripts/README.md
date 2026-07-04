# 团结引擎脚本接入说明

当前目录提供可直接放入团结引擎工程的最小脚本骨架：

- `Protocol/SessionModels.cs`
- `Network/HttpSessionClient.cs`
- `Network/WorldWebSocketClient.cs`
- `World/FollowCamera.cs`
- `World/ConnectionStatusOverlay.cs`
- `World/SimpleWorldVisuals.cs`
- `World/ChunkWorldRenderer.cs`
- `World/DebugCommandConsole.cs`
- `World/WorldBootstrap.cs`

## 接入步骤

1. 在团结引擎中创建一个空场景
2. 创建玩家对象并绑定 `Transform`
3. 新建空对象，挂载 `WorldBootstrap`
4. 在 Inspector 中填写：
   - `Http Base Url`：本地团结引擎实际要访问的服务地址，例如 `http://127.0.0.1:6363` 或 `https://你的域名`
   - `Ws Url Override`：通常留空，脚本会根据 `Http Base Url` 自动拼出 `/ws/world`
   - `Player Transform`：玩家对象
   - `World Camera`：主摄像机，可留空，运行时会优先尝试 `Main Camera`
   - `Chunk World Renderer`：区块世界渲染器对象，可选；若已配置会优先渲染服务端区块窗口
   - `Spawn Point`：本地出生点偏移，默认 `(0, 0)`
   - `Clamp Player To Bounds`：默认关闭；只有局部调试时才建议开启
   - `World Bounds`：仅在启用边界限制时生效
   - `Move Tiles Per Second`：默认 `2`
   - `Player Size In Tiles`：默认 `0.5`
5. 先运行 `bash scripts/dev_stack.sh`
6. 回到 Play 模式验证登录、进世界与移动同步
7. 若需要基础调试 UI，可在任意对象上挂 `ConnectionStatusOverlay` 并把 `Bootstrap` 拖进去；它会显示连接状态、Socket 状态和当前玩家坐标
8. 若需要调试指令，可在任意对象上挂 `DebugCommandConsole` 并把 `Bootstrap` 拖进去

## 已知边界

- 当前仓库未在本机创建团结引擎工程
- 当前脚本未实现其他玩家实体生成
- 当前脚本依赖团结引擎对 `ClientWebSocket` 的平台支持情况
- 若走 HTTPS 域名，WebSocket 会自动切换到 `wss://`
- `WorldBootstrap` 会在运行时自动给主摄像机补上 `FollowCamera`
- 若远端 WebSocket 被中断，客户端会停止继续发送移动并把错误显示到调试叠层
- `WorldBootstrap` 会在运行时自动补一个最小地面、背景和网格占位
- 玩家位置会被限制在 `World Bounds` 定义的矩形范围内
- 若配置了 `ChunkWorldRenderer`，客户端会轮询 `/api/v1/world/chunks` 并渲染附近区块占位
- 当前 `ChunkWorldRenderer` 已切到对象池复用，不再每次刷新整块销毁重建
- 默认镜头会抬高并带轻微俯视倾斜，视野约覆盖 `120x90` 格调试范围
- 调试命令：
  - `/tp x y`：传送到指定坐标
  - `/chunklight`：切换区块边界高亮
