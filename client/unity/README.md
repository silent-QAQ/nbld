# 历史团结引擎客户端目录说明

当前目录仅保留历史团结引擎原型脚本和美术资源，用作迁移 H5 客户端时的参考素材，不再作为当前开发主线。

说明：

- 目录名 `client/unity` 仅为历史命名保留
- 当前项目客户端统一使用 `H5 + TypeScript`
- 本目录下的内容不再继续扩展

当前目录状态：

- `Assets/Scripts/Protocol`：协议模型
- `Assets/Scripts/Network`：HTTP 登录与 WebSocket 世界连接
- `Assets/Scripts/World`：最小世界启动脚本
- `Assets/Scripts/README.md`：接入说明

后续工作重点：

- 在 `client/web` 初始化 H5 客户端工程
- 复用现有协议定义与网络链路
- 参考本目录中的原型脚本迁移输入、相机、区块渲染与调试逻辑
