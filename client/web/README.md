# NBLD H5 客户端

Unity / 团结引擎客户端已停止作为主线开发，本目录是新的 H5 客户端。

## 本地启动

```bash
cd client/web
npm install
NBLD_API_TARGET=http://127.0.0.1:6363 npm run dev
```

浏览器打开 Vite 输出的地址，默认服务端地址填当前网页源站。使用 Vite 开发服务器时，`/api` 与 `/ws` 会代理到 `NBLD_API_TARGET`。

## 当前能力

- 邮箱注册、邮箱登录。
- 正式角色列表读取、角色选择、建角、删角。
- 登录态本地持久化与退出登录。
- 进入世界并建立 WebSocket 鉴权。
- WebSocket 鉴权和玩家移动同步。
- 根据服务端区块窗口加载 80x80 基础方块。
- Canvas 渲染基础方块、装饰层、玩家和远端玩家。
- 跟随相机、滚轮缩放、WASD / 方向键移动。
- HUD 显示状态、坐标、区块、当前地形和方块。
