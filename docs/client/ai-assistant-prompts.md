# 团结 AI 助手执行提示词

以下提示词用于当前项目的最小客户端原型接入。

## 1. 连接状态叠层

```text
请在当前场景中创建一个空对象，命名为 DebugOverlay。
给它添加 ConnectionStatusOverlay 组件。
将场景中的 Bootstrap 对象拖到该组件的 Bootstrap 引用字段。
如果找不到脚本，请先检查 Assets/Scripts/World/ConnectionStatusOverlay.cs 是否已成功导入并编译通过。
```

## 2. 主摄像机跟随

```text
请检查当前场景中的 Main Camera。
如果 Main Camera 上没有 FollowCamera 组件，请添加该组件。
将 FollowCamera 的目标设置为场景中的 Player 对象。
如果 WorldBootstrap 已存在并配置了 World Camera，也请确认该字段指向 Main Camera。
```

## 3. 启动前检查

```text
请检查当前场景是否满足最小运行条件：
1. Bootstrap 对象存在并挂载 WorldBootstrap
2. Player 对象存在
3. WorldBootstrap 的 Player Transform 已绑定 Player
4. Http Base Url 已填写
5. Main Camera 存在且可用
6. 若场景中有 DebugOverlay，则其 Bootstrap 引用已绑定
请只输出检查结果和缺失项，不要修改其他资源。
```

## 4. 世界边界与背景检查

```text
请检查当前场景中的 Bootstrap 对象和 WorldBootstrap 组件。

目标：
1. 确认 WorldBootstrap 已存在以下字段：
   - Spawn Point
   - World Bounds
   - Build Simple World Visuals
2. 如果 World Bounds 未设置，使用默认值
3. 不要手动创建地面和网格对象，先进入 Play 模式观察 WorldBootstrap 是否会自动生成背景、地面和网格占位
4. 只汇报：
   - 这些字段是否存在
   - 自动背景是否生成
   - 玩家移动时是否会被边界限制
```

## 5. 区块渲染接入

```text
请检查当前项目是否已存在 ChunkWorldRenderer 脚本。

如果已存在：
1. 在当前场景中创建一个空对象，命名为 ChunkWorld
2. 给 ChunkWorld 添加 ChunkWorldRenderer 组件
3. 选中 Bootstrap 对象
4. 将 ChunkWorld 绑定到 WorldBootstrap 组件的 Chunk World Renderer 字段
5. 不要删除现有 Player、Main Camera、DebugOverlay

最后只汇报：
- ChunkWorldRenderer 是否可用
- 场景绑定是否完成
- 进入 Play 后是否应能看到区块占位
```

## 6. 调试命令框接入

```text
请检查当前项目是否已存在 DebugCommandConsole 脚本。

如果已存在：
1. 在当前场景中创建一个空对象，命名为 DebugConsole
2. 给 DebugConsole 添加 DebugCommandConsole 组件
3. 将场景中的 Bootstrap 对象绑定到该组件的 Bootstrap 字段
4. 不要删除现有 DebugOverlay

最后只汇报：
- DebugCommandConsole 是否可用
- 场景绑定是否完成
- 进入 Play 后是否可以使用 /tp 和 /chunklight
```
