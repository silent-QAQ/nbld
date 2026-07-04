# 云服务器 NAT / 端口转发接入

当前仓库默认支持“服务监听地址”和“客户端访问地址”分离配置，适合以下情况：

- 云服务器实际监听内网端口
- 外网通过 NAT、端口映射、反向代理或域名访问
- 本地团结引擎连接云端 Go 服务

## 核心区分

- `NBLD_GATEWAY_ADDR`
  - Go 服务实际监听地址
  - 例如：`:6363`、`0.0.0.0:9000`、`127.0.0.1:6363`
- `NBLD_CHECK_BASE_URL`
  - 当前机器执行自检脚本时访问服务的 URL
  - 例如：`http://127.0.0.1:6363`
- 团结引擎 `Http Base Url`
  - 你的本地电脑上团结引擎访问云服务的外部地址
  - 例如：`http://你的域名`、`https://game.example.com`、`http://公网IP:18080`

这三个值不需要相同。

## 常见场景

### 场景 1：云服务器本机监听 6363，NAT 把公网 18080 转到内网 6363

云服务器上：

```bash
NBLD_GATEWAY_ADDR=:6363 \
NBLD_CHECK_BASE_URL=http://127.0.0.1:6363 \
bash scripts/dev_stack.sh --hold
```

本地团结引擎：

- `Http Base Url` 填 `http://公网IP:18080`
- `Ws Url Override` 留空

这样脚本会自动把 WebSocket 地址推导成：

- `ws://公网IP:18080/ws/world`

### 场景 2：云服务器只允许反向代理访问，Go 仅监听本机回环

云服务器上：

```bash
NBLD_GATEWAY_ADDR=127.0.0.1:6363 \
NBLD_CHECK_BASE_URL=http://127.0.0.1:6363 \
bash scripts/dev_stack.sh --hold
```

然后由 Nginx/Caddy 把外部域名转发到：

- `http://127.0.0.1:6363`
- `/ws/world` 需开启 WebSocket 转发

本地团结引擎：

- `Http Base Url` 填 `https://你的域名`
- `Ws Url Override` 留空

脚本会自动生成：

- `wss://你的域名/ws/world`

## 反向代理要求

如果你不是直接暴露 Go 端口，而是经由 Nginx / Caddy / 云厂商网关，必须确认：

- HTTP 路由转发到 `/api/*`、`/healthz`
- WebSocket 路由转发到 `/ws/world`
- 允许 `Upgrade` 和 `Connection: upgrade`
- 若外部是 HTTPS，WebSocket 应走 `wss://`

## 本地排查顺序

先在云服务器上执行：

```bash
NBLD_CHECK_BASE_URL=http://127.0.0.1:6363 bash scripts/check_server.sh
```

如果云服务器本机自检通过，再从你本地电脑检查外部入口：

```bash
curl http://你的外部地址/healthz
```

如果这里失败，问题通常不在 Go 服务，而在：

- NAT 端口未放通
- 安全组 / 防火墙未放通
- 反向代理未配置 `/ws/world`
- 映射的是错误端口

## 工程统一约束

- 客户端统一使用团结引擎
- 不要再用标准 Unity 打开同一客户端工程
- 多人协作时统一团结引擎版本
