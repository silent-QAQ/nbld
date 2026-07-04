import "./styles.css";
import { ApiClient } from "./api";
import { loadAssets, type AssetMaps } from "./assets";
import type {
  ChunkCoord,
  ChunkSnapshot,
  ChunkTile,
  ChunkWindowResponse,
  Position,
  WorldPlayer,
  WSServerMessage,
} from "./protocol";

const CHUNK_SIZE = 80;
const CHUNK_TEXTURE_SCALE = 4;
const PLAYER_SPEED_TILES_PER_SECOND = 2;
const MIN_TILE_SCALE = 2;
const MAX_TILE_SCALE = 32;
const CHUNK_REFRESH_INTERVAL_MS = 500;
const MOVE_SEND_INTERVAL_MS = 90;
const RENDER_CHUNK_RADIUS = 1;
const TARGET_VISIBLE_TILES_X = 120;
const TARGET_VISIBLE_TILES_Y = 60;

type ChunkRender = {
  snapshot: ChunkSnapshot;
  canvas: HTMLCanvasElement;
  terrainCounts: Map<string, number>;
};

type AppState = {
  api?: ApiClient;
  ws?: WebSocket;
  token: string;
  playerId: string;
  worldId: string;
  mapId: string;
  player: Position;
  camera: Position;
  tileScale: number;
  userZoomed: boolean;
  chunks: Map<string, ChunkRender>;
  players: Map<string, WorldPlayer>;
  pressed: Set<string>;
  assets?: AssetMaps;
  status: string;
  socketStatus: string;
  lastError: string;
  lastChunkKey: string;
  lastChunkRefreshAt: number;
  lastMoveSendAt: number;
  currentTile?: ChunkTile;
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("missing #app");

app.innerHTML = `
  <div class="shell">
    <canvas class="world-canvas"></canvas>
    <section class="login-panel">
      <h1>NBLD H5 客户端</h1>
      <p>已废弃 Unity / 团结引擎客户端。此页面直接连接服务端，加载区块、渲染地图、控制玩家和相机。</p>
      <label for="baseUrl">服务端地址</label>
      <input id="baseUrl" spellcheck="false" />
      <button id="loginButton">游客进入世界</button>
      <div class="error" id="loginError"></div>
    </section>
    <section class="hud hidden"></section>
    <section class="debug-panel hidden"></section>
    <section class="help-panel hidden">WASD / 方向键移动，鼠标滚轮缩放，H 隐藏/显示调试信息</section>
  </div>
`;

const canvas = app.querySelector<HTMLCanvasElement>(".world-canvas")!;
const ctx = canvas.getContext("2d", { alpha: false })!;
const loginPanel = app.querySelector<HTMLElement>(".login-panel")!;
const loginError = app.querySelector<HTMLElement>("#loginError")!;
const loginButton = app.querySelector<HTMLButtonElement>("#loginButton")!;
const baseUrlInput = app.querySelector<HTMLInputElement>("#baseUrl")!;
const hud = app.querySelector<HTMLElement>(".hud")!;
const debugPanel = app.querySelector<HTMLElement>(".debug-panel")!;
const helpPanel = app.querySelector<HTMLElement>(".help-panel")!;

const state: AppState = {
  token: "",
  playerId: "",
  worldId: "",
  mapId: "map_0_0",
  player: { x: 0, y: 0 },
  camera: { x: 0, y: 0 },
  tileScale: 8,
  userZoomed: false,
  chunks: new Map(),
  players: new Map(),
  pressed: new Set(),
  status: "未连接",
  socketStatus: "未连接",
  lastError: "",
  lastChunkKey: "",
  lastChunkRefreshAt: 0,
  lastMoveSendAt: 0,
};

baseUrlInput.value = localStorage.getItem("nbld_http_base_url") ?? window.location.origin;

loginButton.addEventListener("click", () => {
  void start();
});

baseUrlInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void start();
  }
});

window.addEventListener("resize", resizeCanvas);
window.addEventListener("keydown", (event) => {
  if (event.code === "KeyH") {
    hud.classList.toggle("hidden");
    debugPanel.classList.toggle("hidden");
    return;
  }
  if (isMovementKey(event.code)) {
    event.preventDefault();
    state.pressed.add(event.code);
  }
});
window.addEventListener("keyup", (event) => {
  state.pressed.delete(event.code);
});
canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    state.tileScale = clamp(state.tileScale * factor, MIN_TILE_SCALE, MAX_TILE_SCALE);
    state.userZoomed = true;
  },
  { passive: false },
);

resizeCanvas();
requestAnimationFrame(loop);

async function start(): Promise<void> {
  loginError.textContent = "";
  loginButton.disabled = true;
  loginButton.textContent = "连接中...";

  try {
    const baseUrl = normalizeBaseUrl(baseUrlInput.value);
    localStorage.setItem("nbld_http_base_url", baseUrl);
    const api = new ApiClient(baseUrl);
    state.api = api;
    state.assets ??= await loadAssets();

    const deviceId = getDeviceId();
    const login = await api.guestLogin(deviceId);
    const entered = await api.enterWorld(login.token);

    state.token = login.token;
    state.playerId = entered.playerId;
    state.worldId = entered.worldId;
    state.mapId = entered.mapId || "map_0_0";
    state.player = { ...entered.position };
    state.camera = { ...entered.position };
    state.players.clear();
    state.chunks.clear();
    state.currentTile = undefined;
    state.lastChunkKey = "";
    state.status = "已连接";
    state.lastError = "";

    await refreshChunks(true);
    connectWebSocket(api);

    loginPanel.classList.add("hidden");
    hud.classList.remove("hidden");
    debugPanel.classList.remove("hidden");
    helpPanel.classList.remove("hidden");
  } catch (error) {
    state.status = "连接失败";
    state.lastError = errorToString(error);
    loginError.textContent = state.lastError;
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "游客进入世界";
  }
}

function connectWebSocket(api: ApiClient): void {
  if (state.ws) {
    state.ws.close();
    state.ws = undefined;
  }

  const ws = new WebSocket(api.wsUrl());
  state.ws = ws;
  state.socketStatus = "连接中";

  ws.addEventListener("open", () => {
    state.socketStatus = "已连接";
    ws.send(JSON.stringify({ type: "auth", token: state.token }));
  });

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data as string) as WSServerMessage;
    handleServerMessage(message);
  });

  ws.addEventListener("close", () => {
    state.socketStatus = "已断开";
  });

  ws.addEventListener("error", () => {
    state.socketStatus = "错误";
  });
}

function handleServerMessage(message: WSServerMessage): void {
  if (message.type === "auth_ok") {
    state.socketStatus = "认证完成";
    if (message.players) {
      state.players.clear();
      for (const player of message.players) state.players.set(player.playerId, player);
    }
    return;
  }

  if (message.type === "player_moved" && message.playerId && message.position) {
    const player: WorldPlayer = {
      playerId: message.playerId,
      characterId: message.characterId,
      characterName: message.characterName,
      mapId: message.mapId,
      position: message.position,
    };
    state.players.set(player.playerId, player);
    if (message.playerId === state.playerId) {
      state.mapId = message.mapId || state.mapId;
      state.player = { ...message.position };
    }
    return;
  }

  if (message.type === "map_transition" && message.playerId === state.playerId && message.position) {
    state.mapId = message.mapId || state.mapId;
    state.player = { ...message.position };
    state.camera = { ...message.position };
    state.chunks.clear();
    state.lastChunkKey = "";
    void refreshChunks(true);
    return;
  }

  if (message.type === "error") {
    state.lastError = message.error || "websocket error";
  }
}

let lastFrameAt = performance.now();

function loop(now: number): void {
  const deltaSeconds = Math.min(0.05, (now - lastFrameAt) / 1000);
  lastFrameAt = now;

  updatePlayer(deltaSeconds, now);
  updateCamera(deltaSeconds);
  updateHud();
  draw();

  requestAnimationFrame(loop);
}

function updatePlayer(deltaSeconds: number, now: number): void {
  if (!state.token) return;

  let dx = 0;
  let dy = 0;
  if (state.pressed.has("KeyA") || state.pressed.has("ArrowLeft")) dx -= 1;
  if (state.pressed.has("KeyD") || state.pressed.has("ArrowRight")) dx += 1;
  if (state.pressed.has("KeyW") || state.pressed.has("ArrowUp")) dy += 1;
  if (state.pressed.has("KeyS") || state.pressed.has("ArrowDown")) dy -= 1;

  if (dx !== 0 || dy !== 0) {
    const length = Math.hypot(dx, dy);
    state.player.x += (dx / length) * PLAYER_SPEED_TILES_PER_SECOND * deltaSeconds;
    state.player.y += (dy / length) * PLAYER_SPEED_TILES_PER_SECOND * deltaSeconds;

    if (now - state.lastMoveSendAt > MOVE_SEND_INTERVAL_MS) {
      sendMove();
      state.lastMoveSendAt = now;
    }
  }

  const chunkKey = `${state.mapId}:${worldToChunk(state.player.x)}:${worldToChunk(state.player.y)}`;
  if (chunkKey !== state.lastChunkKey || now - state.lastChunkRefreshAt > CHUNK_REFRESH_INTERVAL_MS) {
    state.lastChunkKey = chunkKey;
    state.lastChunkRefreshAt = now;
    void refreshChunks(false);
  }

  state.currentTile = findTileAt(state.player.x, state.player.y);
}

function sendMove(): void {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: "move", position: state.player }));
    return;
  }

  if (state.api) {
    void state.api.move(state.token, state.player.x, state.player.y).catch((error) => {
      state.lastError = errorToString(error);
    });
  }
}

async function refreshChunks(force: boolean): Promise<void> {
  if (!state.api || !state.token) return;
  if (!force && state.status === "加载区块中") return;

  const previousStatus = state.status;
  state.status = "加载区块中";
  try {
    const windowData = await state.api.chunks(state.token);
    applyChunkWindow(windowData);
    state.status = "已连接";
  } catch (error) {
    state.status = previousStatus;
    state.lastError = errorToString(error);
  }
}

function applyChunkWindow(windowData: ChunkWindowResponse): void {
  state.mapId = windowData.mapId || state.mapId;
  for (const coord of windowData.unloadedChunks) {
    state.chunks.delete(coordKey(coord));
  }
  for (const chunk of windowData.chunks) {
    state.chunks.set(coordKey(chunk.coord), renderChunk(chunk));
  }
  state.currentTile = findTileAt(state.player.x, state.player.y);
}

function renderChunk(snapshot: ChunkSnapshot): ChunkRender {
  const offscreen = document.createElement("canvas");
  offscreen.width = CHUNK_SIZE * CHUNK_TEXTURE_SCALE;
  offscreen.height = CHUNK_SIZE * CHUNK_TEXTURE_SCALE;
  const chunkCtx = offscreen.getContext("2d", { alpha: false })!;
  chunkCtx.imageSmoothingEnabled = false;

  const terrainCounts = new Map<string, number>();
  const decorations: ChunkTile[] = [];

  for (const tile of snapshot.tiles) {
    terrainCounts.set(tile.terrain, (terrainCounts.get(tile.terrain) ?? 0) + 1);
    const tileImage = state.assets?.tiles.get(tile.block || "") ?? state.assets?.tiles.get(fallbackBlock(tile.terrain));
    if (tileImage) {
      chunkCtx.drawImage(
        tileImage,
        tile.x * CHUNK_TEXTURE_SCALE,
        (CHUNK_SIZE - 1 - tile.y) * CHUNK_TEXTURE_SCALE,
        CHUNK_TEXTURE_SCALE,
        CHUNK_TEXTURE_SCALE,
      );
    } else {
      chunkCtx.fillStyle = fallbackColor(tile.terrain);
      chunkCtx.fillRect(tile.x * CHUNK_TEXTURE_SCALE, (CHUNK_SIZE - 1 - tile.y) * CHUNK_TEXTURE_SCALE, CHUNK_TEXTURE_SCALE, CHUNK_TEXTURE_SCALE);
    }
    if (tile.decoration) decorations.push(tile);
  }

  for (const tile of decorations) {
    const image = state.assets?.decorations.get(tile.decoration || "");
    if (!image) continue;
    const widthTiles = Math.max(1, image.width / 32);
    const heightTiles = Math.max(1, image.height / 32);
    const width = widthTiles * CHUNK_TEXTURE_SCALE;
    const height = heightTiles * CHUNK_TEXTURE_SCALE;
    const x = (tile.x + 0.5) * CHUNK_TEXTURE_SCALE - width / 2;
    const y = (CHUNK_SIZE - tile.y - 0.15) * CHUNK_TEXTURE_SCALE - height;
    chunkCtx.drawImage(image, x, y, width, height);
  }

  return { snapshot, canvas: offscreen, terrainCounts };
}

function updateCamera(deltaSeconds: number): void {
  const stiffness = 1 - Math.pow(0.001, deltaSeconds);
  state.camera.x += (state.player.x - state.camera.x) * stiffness;
  state.camera.y += (state.player.y - state.camera.y) * stiffness;
}

function draw(): void {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#0c1117";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const renderWindow = getRenderWindow();
  for (const chunk of state.chunks.values()) {
    if (!isChunkInRenderWindow(chunk.snapshot.coord, renderWindow.centerChunkX, renderWindow.centerChunkY)) continue;

    const chunkMinX = chunk.snapshot.coord.chunkX * CHUNK_SIZE;
    const chunkMaxY = (chunk.snapshot.coord.chunkY + 1) * CHUNK_SIZE;

    const screen = worldToScreen(chunkMinX, chunkMaxY);
    const size = CHUNK_SIZE * state.tileScale;
    ctx.drawImage(chunk.canvas, screen.x, screen.y, size, size);
    drawChunkGrid(screen.x, screen.y, size);
  }

  for (const player of state.players.values()) {
    if (player.playerId !== state.playerId && player.mapId === state.mapId) {
      drawRemotePlayer(player);
    }
  }
  drawLocalPlayer();
}

function drawChunkGrid(x: number, y: number, size: number): void {
  if (state.tileScale < 5) return;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.22)";
  ctx.lineWidth = Math.max(1, window.devicePixelRatio);
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(size), Math.round(size));
}

function drawLocalPlayer(): void {
  const screen = worldToScreen(state.player.x, state.player.y);
  const width = Math.max(8, state.tileScale * 0.5);
  const height = Math.max(12, state.tileScale * 0.75);
  ctx.fillStyle = "#ff4040";
  ctx.fillRect(screen.x - width / 2, screen.y - height, width, height);
  ctx.strokeStyle = "#ffe7d8";
  ctx.lineWidth = 2;
  ctx.strokeRect(screen.x - width / 2, screen.y - height, width, height);
}

function drawRemotePlayer(player: WorldPlayer): void {
  const screen = worldToScreen(player.position.x, player.position.y);
  const radius = Math.max(4, state.tileScale * 0.28);
  ctx.fillStyle = "#67d1ff";
  ctx.beginPath();
  ctx.arc(screen.x, screen.y - radius, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "12px Microsoft YaHei, sans-serif";
  ctx.fillText(player.characterName || player.playerId, screen.x + radius + 4, screen.y - radius - 4);
}

function updateHud(): void {
  if (!state.token) return;
  const chunkX = worldToChunk(state.player.x);
  const chunkY = worldToChunk(state.player.y);
  const tile = state.currentTile;
  const visibleTilesX = Math.round(canvas.width / state.tileScale);
  const visibleTilesY = Math.round(canvas.height / state.tileScale);
  hud.innerHTML = `
    <div><b>状态</b> ${state.status}　<b>Socket</b> ${state.socketStatus}</div>
    <div><b>玩家</b> ${escapeHtml(state.playerId)}　<b>地图</b> ${escapeHtml(state.mapId)}</div>
    <div><b>坐标</b> X:${state.player.x.toFixed(2)} Y:${state.player.y.toFixed(2)}　<b>区块</b> ${chunkX}, ${chunkY}</div>
    <div><b>地形</b> ${escapeHtml(tile?.terrain ?? "未加载")}　<b>方块</b> ${escapeHtml(tile?.block ?? "未加载")}　<b>装饰</b> ${escapeHtml(tile?.decoration ?? "-")}</div>
  `;

  const dominant = dominantTerrain();
  debugPanel.innerHTML = `
    <div><b>已加载区块</b> ${state.chunks.size}　<b>缩放</b> ${state.tileScale.toFixed(1)}px/格</div>
    <div><b>实际渲染</b> 3x3 区块　<b>当前可见</b> 约 ${visibleTilesX} x ${visibleTilesY} 格</div>
    <div><b>主要地形</b> ${escapeHtml(dominant || "-")}</div>
    <div><b>最后错误</b> ${escapeHtml(state.lastError || "无")}</div>
  `;
}

function dominantTerrain(): string {
  const counts = new Map<string, number>();
  for (const chunk of state.chunks.values()) {
    for (const [terrain, count] of chunk.terrainCounts) counts.set(terrain, (counts.get(terrain) ?? 0) + count);
  }
  let best = "";
  let bestCount = 0;
  for (const [terrain, count] of counts) {
    if (count > bestCount) {
      best = terrain;
      bestCount = count;
    }
  }
  return best ? `${best} (${bestCount})` : "";
}

function findTileAt(worldX: number, worldY: number): ChunkTile | undefined {
  const chunkX = worldToChunk(worldX);
  const chunkY = worldToChunk(worldY);
  const chunk = state.chunks.get(`${state.mapId}:${chunkX}:${chunkY}`);
  if (!chunk) return undefined;
  const localX = modFloor(worldX, CHUNK_SIZE);
  const localY = modFloor(worldY, CHUNK_SIZE);
  return chunk.snapshot.tiles[localY * CHUNK_SIZE + localX];
}

function getRenderWindow(): { centerChunkX: number; centerChunkY: number } {
  return {
    centerChunkX: worldToChunk(state.player.x),
    centerChunkY: worldToChunk(state.player.y),
  };
}

function isChunkInRenderWindow(coord: ChunkCoord, centerChunkX: number, centerChunkY: number): boolean {
  return (
    coord.mapId === state.mapId &&
    Math.abs(coord.chunkX - centerChunkX) <= RENDER_CHUNK_RADIUS &&
    Math.abs(coord.chunkY - centerChunkY) <= RENDER_CHUNK_RADIUS
  );
}

function worldToScreen(x: number, y: number): Position {
  return {
    x: canvas.width / 2 + (x - state.camera.x) * state.tileScale,
    y: canvas.height / 2 - (y - state.camera.y) * state.tileScale,
  };
}

function resizeCanvas(): void {
  canvas.width = Math.max(1, Math.floor(window.innerWidth));
  canvas.height = Math.max(1, Math.floor(window.innerHeight));
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;

  if (!state.userZoomed) {
    const scaleX = canvas.width / TARGET_VISIBLE_TILES_X;
    const scaleY = canvas.height / TARGET_VISIBLE_TILES_Y;
    state.tileScale = clamp(Math.min(scaleX, scaleY), MIN_TILE_SCALE, MAX_TILE_SCALE);
  }
}

function coordKey(coord: ChunkCoord): string {
  return `${coord.mapId}:${coord.chunkX}:${coord.chunkY}`;
}

function worldToChunk(value: number): number {
  return Math.floor(value / CHUNK_SIZE);
}

function modFloor(value: number, modulo: number): number {
  return ((Math.floor(value) % modulo) + modulo) % modulo;
}

function isMovementKey(code: string): boolean {
  return code === "KeyW" || code === "KeyA" || code === "KeyS" || code === "KeyD" || code === "ArrowUp" || code === "ArrowLeft" || code === "ArrowDown" || code === "ArrowRight";
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return window.location.origin;
  return /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function getDeviceId(): string {
	const key = "nbld_web_device_id";
	const existing = localStorage.getItem(key);
	if (existing) return existing;
	const randomUUID = crypto.randomUUID?.bind(crypto);
	const entropy = randomUUID ? randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	const created = `web-${entropy}`;
	localStorage.setItem(key, created);
	return created;
}

function fallbackBlock(terrain: string): string {
  if (terrain.includes("ocean") || terrain.includes("sea")) return "open_ocean_water";
  if (terrain.includes("desert")) return "sand";
  if (terrain.includes("gobi")) return "gravel";
  if (terrain.includes("snow") || terrain.includes("polar")) return "snow";
  if (terrain.includes("forest")) return "forest_floor";
  if (terrain.includes("mountain")) return "mountain_rock";
  return "grass";
}

function fallbackColor(terrain: string): string {
  if (terrain.includes("ocean") || terrain.includes("sea")) return "#3478a8";
  if (terrain.includes("desert")) return "#d9bd70";
  if (terrain.includes("gobi")) return "#9b8665";
  if (terrain.includes("snow") || terrain.includes("polar")) return "#dfe8ec";
  if (terrain.includes("forest")) return "#2f6e35";
  if (terrain.includes("mountain")) return "#77716a";
  return "#79b86a";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#039;";
    }
  });
}
