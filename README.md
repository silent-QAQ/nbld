# NBLD MMO Prototype

这是一个按 AI 驱动流程推进的 2D 像素风开放世界 MMO 原型仓库。

当前阶段：`阶段 B - 最小客户端与最小服务端联通`

## 技术栈

- 客户端：`H5 + TypeScript`
- 服务端：`Go`
- 性能热点：`Rust`（后期按 profiling 引入）
- 协议目录：`shared/proto`

## 当前已落地内容

- 统一目录结构
- Go 服务端最小骨架
- 本地启动脚本
- 协议占位定义
- 开发规范与任务状态文档
- 最小世界状态链路
- SSE/WS 实时同步雏形
- 团结引擎原型脚本骨架（已废弃，不再作为当前路线）
- 服务端区块窗口加载与地图分页存档骨架
- Rust 区块地图生成器原型

## 目录结构

- `client/unity`：历史客户端原型目录，保留作参考，不再继续开发
- `client/web`：H5 客户端目录
- `server`：Go 服务端代码
- `shared/proto`：客户端与服务端共享协议草案
- `docs`：项目文档、规范、任务追踪
- `scripts`：本地启动和联调脚本
- `tools`：后续自动化工具与辅助脚本

## 策划工具

- [技能编辑器](tools/skill_editor.html)：静态 HTML 工具，用于可视化编写技能行并预览效果表、条件表、修正表导出结果。

## 快速开始

1. 启动最小服务端：

```bash
bash scripts/dev_server.sh
```

或直接启动并自检：

```bash
bash scripts/dev_stack.sh
```

持续重试直到成功：

```bash
bash scripts/auto_resume.sh
```

仅启动服务并保持前台运行：

```bash
bash scripts/dev_stack.sh --hold
```

指定监听地址和本机自检地址：

```bash
NBLD_GATEWAY_ADDR=:6363 \
NBLD_CHECK_BASE_URL=http://127.0.0.1:6363 \
bash scripts/dev_stack.sh --hold
```

2. 健康检查：

```bash
curl http://127.0.0.1:6363/healthz
```

3. 模拟登录：

```bash
curl -X POST http://127.0.0.1:6363/api/v1/session/guest \
  -H 'Content-Type: application/json' \
  -d '{"deviceId":"local-dev"}'
```

4. 运行服务端测试：

```bash
cd server && go test ./...
```

5. 启用 PostgreSQL 账号与角色存储：

```bash
NBLD_DATABASE_URL='postgres://postgres:postgres@127.0.0.1:5432/nbld?sslmode=disable' \
bash scripts/dev_stack.sh --hold
```

未设置 `NBLD_DATABASE_URL` 时，服务端会退回内存账号存储，适合本地接口联调；设置后会自动建表并使用 PostgreSQL 持久化账号、角色、坐标与删除角色回收数据。

6. 启用 Redis 在线角色热数据层：

```bash
NBLD_DATABASE_URL='postgres://postgres:postgres@127.0.0.1:5432/nbld?sslmode=disable' \
NBLD_REDIS_URL='redis://127.0.0.1:6379/0' \
bash scripts/dev_stack.sh --hold
```

推荐结构为 `PostgreSQL + Redis`：
- `PostgreSQL` 保存账号、角色真源、删角保留数据
- `Redis` 保存在线角色热数据
- 玩家进世界时角色会加载到 Redis
- 在线移动等高频写先落 Redis，并由后台定时刷回 PostgreSQL
- 服务关闭时会执行一次刷盘
- 玩家离开世界时可调用 `POST /api/v1/world/leave` 立即刷盘并清理会话
- 角色属性、背包、仓库、装备更新接口也走同一条热态通道

7. 构建 Rust 区块生成器：

```bash
. "$HOME/.cargo/env"
cd rust/chunkgen && cargo build --release
```

8. 启用 Rust 区块生成器启动服务端：

```bash
NBLD_RUST_CHUNKGEN_BIN=/nbld/rust/chunkgen/target/release/chunkgen \
bash scripts/dev_stack.sh --hold
```

9. 若云服务器通过 NAT、反向代理或域名暴露服务，先看：

```bash
docs/deployment/cloud-nat.md
```

10. 客户端当前统一使用 H5，协作约束见：

```bash
docs/client/web-workflow.md
```

## 当前阶段目标

- 继续完善 H5 客户端表现与交互
- 客户端登录、移动、区块渲染与实时同步持续迭代
- H5 客户端继续接入现有 WebSocket / HTTP 世界链路
- 将地图层、实体层、交互层进一步拆分
