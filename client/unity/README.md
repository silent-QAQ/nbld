# 团结引擎客户端目录说明

当前仓库尚未在本机生成完整团结引擎工程，但已补充可直接导入的最小脚本骨架。

说明：

- 目录名 `client/unity` 仅为历史命名保留
- 当前项目客户端统一使用 `团结引擎 + C#`
- 不再与标准 Unity 混用同一工程

当前目录状态：

- `Assets/Scripts/Protocol`：协议模型
- `Assets/Scripts/Network`：HTTP 登录与 WebSocket 世界连接
- `Assets/Scripts/World`：最小世界启动脚本
- `Assets/Scripts/README.md`：接入说明

当前环境缺少 `团结引擎` 与 `dotnet`，因此无法在本机完成真正的客户端工程创建、编译与运行验证。
