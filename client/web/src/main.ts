import "./styles.css";
import { ApiClient } from "./api";
import { loadAssets, type AssetMaps } from "./assets";
import type {
  CharacterSummary,
  ChunkCoord,
  ChunkSnapshot,
  ChunkTile,
  ChunkWindowResponse,
  LoginResponse,
  Position,
  RegisterResponse,
  WorldPlayer,
  WSServerMessage,
} from "./protocol";

const CHUNK_SIZE = 80;
const CHUNK_TEXTURE_SCALE = 4;
const PLAYER_WALK_SPEED_TILES_PER_SECOND = 4;
const PLAYER_SPRINT_SPEED_TILES_PER_SECOND = 6;
const MIN_TILE_SCALE = 2;
const MAX_TILE_SCALE = 32;
const CHUNK_REFRESH_INTERVAL_MS = 500;
const MOVE_SEND_INTERVAL_MS = 90;
const RENDER_CHUNK_RADIUS = 1;
const TARGET_VISIBLE_TILES_X = 40;
const TARGET_VISIBLE_TILES_Y = 22.5;
const PLAYER_RENDER_WIDTH_PX = 28;
const PLAYER_RENDER_HEIGHT_PX = 58;
const PLAYER_COLLISION_SIZE_TILES = 1;
const COLLISION_EPSILON = 0.0001;

const BLOCKING_BLOCKS = new Set<string>([
  "mountain_rock",
  "cliff_rock",
  "glacier_rock",
  "rock",
]);

const BLOCKING_DECORATIONS = new Set<string>([
  "basalt_rock",
  "dead_tree",
  "desert_rock",
  "flat_stone",
  "granite_boulder",
  "large_stone",
  "mossy_rock",
  "sandstone_rock",
  "sharp_rock",
  "slate_rock",
  "small_stone",
  "tree_conifer",
  "tree_deciduous",
  "tree_jungle",
  "weathered_stone",
]);

type ChunkRender = {
  snapshot: ChunkSnapshot;
  canvas: HTMLCanvasElement;
  terrainCounts: Map<string, number>;
};

type AppState = {
  api?: ApiClient;
  ws?: WebSocket;
  accountId: string;
  accountEmail: string;
  accountUsername: string;
  token: string;
  playerId: string;
  characterId: string;
  characterName: string;
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
  availableCharacters: CharacterSummary[];
  selectedCharacterId: string;
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("missing #app");

app.innerHTML = `
  <div class="shell">
    <canvas class="world-canvas"></canvas>
    <section class="login-panel">
      <h1>NBLD H5 客户端</h1>
      <p>使用邮箱注册/登录，然后选择角色进入世界。</p>
      <label for="baseUrl">服务端地址</label>
      <input id="baseUrl" spellcheck="false" />
      <label for="emailInput">邮箱</label>
      <input id="emailInput" spellcheck="false" />
      <label for="usernameInput">用户名（注册时使用）</label>
      <input id="usernameInput" spellcheck="false" />
      <label for="passwordInput">密码</label>
      <input id="passwordInput" type="password" />
      <label for="confirmPasswordInput">再次输入密码（注册时使用）</label>
      <input id="confirmPasswordInput" type="password" />
      <div class="login-actions">
        <button id="loginButton">邮箱登录</button>
        <button id="registerButton" class="secondary">注册账号</button>
      </div>
      <div class="character-panel hidden" id="characterPanel">
        <div class="character-header">
          <strong id="accountSummary">未登录</strong>
          <button id="logoutButton" class="secondary">退出登录 / 返回登录页</button>
        </div>
        <label for="characterNameInput">新角色名</label>
        <input id="characterNameInput" spellcheck="false" />
        <button id="createCharacterButton" class="secondary">创建角色</button>
        <div class="character-list" id="characterList"></div>
      </div>
      <div class="error" id="loginError"></div>
    </section>
    <section class="hud hidden"></section>
    <section class="debug-panel hidden"></section>
    <section class="help-panel hidden">WASD / 方向键移动，Shift 疾跑，鼠标滚轮缩放，H 隐藏/显示调试信息</section>
  </div>
`;

const canvas = app.querySelector<HTMLCanvasElement>(".world-canvas")!;
const ctx = canvas.getContext("2d", { alpha: false })!;
const loginPanel = app.querySelector<HTMLElement>(".login-panel")!;
const loginError = app.querySelector<HTMLElement>("#loginError")!;
const loginButton = app.querySelector<HTMLButtonElement>("#loginButton")!;
const registerButton = app.querySelector<HTMLButtonElement>("#registerButton")!;
const baseUrlInput = app.querySelector<HTMLInputElement>("#baseUrl")!;
const emailInput = app.querySelector<HTMLInputElement>("#emailInput")!;
const usernameInput = app.querySelector<HTMLInputElement>("#usernameInput")!;
const passwordInput = app.querySelector<HTMLInputElement>("#passwordInput")!;
const confirmPasswordInput = app.querySelector<HTMLInputElement>("#confirmPasswordInput")!;
const characterNameInput = app.querySelector<HTMLInputElement>("#characterNameInput")!;
const characterPanel = app.querySelector<HTMLElement>("#characterPanel")!;
const characterList = app.querySelector<HTMLElement>("#characterList")!;
const accountSummary = app.querySelector<HTMLElement>("#accountSummary")!;
const logoutButton = app.querySelector<HTMLButtonElement>("#logoutButton")!;
const hud = app.querySelector<HTMLElement>(".hud")!;
const debugPanel = app.querySelector<HTMLElement>(".debug-panel")!;
const helpPanel = app.querySelector<HTMLElement>(".help-panel")!;

const state: AppState = {
  accountId: "",
  accountEmail: "",
  accountUsername: "",
  token: "",
  playerId: "",
  characterId: "",
  characterName: "",
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
  availableCharacters: [],
  selectedCharacterId: "",
};

baseUrlInput.value = localStorage.getItem("nbld_http_base_url") ?? window.location.origin;

loginButton.addEventListener("click", () => {
  void loginWithEmail();
});

registerButton.addEventListener("click", () => {
  void registerWithEmail();
});

app.querySelector<HTMLButtonElement>("#createCharacterButton")!.addEventListener("click", () => {
  void createCharacterAndRefresh();
});

logoutButton.addEventListener("click", () => {
  logoutToLogin();
});

baseUrlInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void loginWithEmail();
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
restoreSessionFromStorage();
requestAnimationFrame(loop);

async function loginWithEmail(): Promise<void> {
  loginError.textContent = "";
  setLoginBusy(true, "登录中...");

  try {
    const api = await prepareApi();
    const login = await api.login(emailInput.value.trim(), passwordInput.value);
    applyLogin(login);
    await loadCharacters();
  } catch (error) {
    state.status = "连接失败";
    state.lastError = errorToString(error);
    loginError.textContent = state.lastError;
  } finally {
    setLoginBusy(false);
  }
}

async function registerWithEmail(): Promise<void> {
  loginError.textContent = "";
  setLoginBusy(true, "注册中...");

  try {
    const api = await prepareApi();
    const register = await api.register(
      emailInput.value.trim(),
      usernameInput.value.trim(),
      passwordInput.value,
      confirmPasswordInput.value,
    );
    applyRegister(register);
    const login = await api.login(emailInput.value.trim(), passwordInput.value);
    applyLogin(login);
    await loadCharacters();
  } catch (error) {
    state.lastError = errorToString(error);
    loginError.textContent = state.lastError;
  } finally {
    setLoginBusy(false);
  }
}

async function prepareApi(): Promise<ApiClient> {
  const baseUrl = normalizeBaseUrl(baseUrlInput.value);
  localStorage.setItem("nbld_http_base_url", baseUrl);
  const api = new ApiClient(baseUrl);
  state.api = api;
  state.assets ??= await loadAssets();
  return api;
}

function applyRegister(register: RegisterResponse): void {
  state.accountId = register.accountId;
  state.accountEmail = register.email;
  state.accountUsername = register.username;
  persistSession();
}

function applyLogin(login: LoginResponse): void {
  state.token = login.token;
  state.accountId = login.accountId;
  state.accountEmail = login.email;
  state.accountUsername = login.username;
  persistSession();
}

async function loadCharacters(): Promise<void> {
  if (!state.api || !state.token) return;
  state.status = "加载角色中";
  const roster = await state.api.characters(state.token);
  state.availableCharacters = roster.active ?? [];
  renderCharacterList(state.availableCharacters);
  characterPanel.classList.remove("hidden");
  accountSummary.textContent = `${state.accountUsername || state.accountEmail} (${state.accountId})`;

  if (state.selectedCharacterId) {
    const selected = state.availableCharacters.find((character) => character.id === state.selectedCharacterId);
    if (selected) {
      state.status = "请选择角色进入世界";
      return;
    }
    state.selectedCharacterId = "";
  }

  state.status = state.availableCharacters.length > 0 ? "请选择角色进入世界" : "请创建角色";
}

function renderCharacterList(characters: CharacterSummary[]): void {
  characterList.innerHTML = "";
  for (const character of characters) {
    const wrapper = document.createElement("div");
    wrapper.className = "character-entry";

    const meta = document.createElement("div");
    meta.className = "character-meta";
    meta.innerHTML = `
      <strong>${escapeHtml(character.name)}</strong>
      <span>${escapeHtml(character.id)}</span>
      <span>版本 ${character.version}</span>
    `;

    const actions = document.createElement("div");
    actions.className = "character-actions";

    const enterButton = document.createElement("button");
    enterButton.textContent = "进入世界";
    enterButton.addEventListener("click", () => {
      void enterWorldWithCharacter(character);
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "secondary";
    deleteButton.textContent = "删除角色";
    deleteButton.addEventListener("click", async () => {
      if (!state.api || !state.token) return;
      setLoginBusy(true, "删除角色中...");
      loginError.textContent = "";
      try {
        await state.api.deleteCharacter(state.token, character.id);
        if (state.selectedCharacterId === character.id) {
          state.selectedCharacterId = "";
        }
        persistSession();
        await loadCharacters();
      } catch (error) {
        loginError.textContent = errorToString(error);
      } finally {
        setLoginBusy(false);
      }
    });

    actions.append(enterButton, deleteButton);
    wrapper.append(meta, actions);
    characterList.appendChild(wrapper);
  }
}

async function createCharacterAndRefresh(): Promise<void> {
  if (!state.api || !state.token) return;
  setLoginBusy(true, "创建角色中...");
  loginError.textContent = "";

  try {
    await state.api.createCharacter(
      state.token,
      characterNameInput.value.trim() || state.accountUsername || "Hero",
    );
    await loadCharacters();
  } catch (error) {
    loginError.textContent = errorToString(error);
  } finally {
    setLoginBusy(false);
  }
}

async function enterWorldWithCharacter(character: CharacterSummary): Promise<void> {
  if (!state.api || !state.token) return;

  setLoginBusy(true, "进入世界中...");
  loginError.textContent = "";

  try {
    const entered = await state.api.enterWorld(state.token, character.id);
    state.selectedCharacterId = character.id;
    state.characterId = entered.characterId || character.id;
    state.characterName = entered.characterName || character.name;
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
    persistSession();

    await refreshChunks(true);
    connectWebSocket(state.api);

    loginPanel.classList.add("hidden");
    hud.classList.remove("hidden");
    debugPanel.classList.remove("hidden");
    helpPanel.classList.remove("hidden");
  } catch (error) {
    state.status = "进入世界失败";
    state.lastError = errorToString(error);
    loginError.textContent = state.lastError;
  } finally {
    setLoginBusy(false);
  }
}

function setLoginBusy(busy: boolean, loginLabel = "邮箱登录"): void {
  loginButton.disabled = busy;
  registerButton.disabled = busy;
  logoutButton.disabled = busy;
  loginButton.textContent = busy ? loginLabel : "邮箱登录";
}

function persistSession(): void {
  localStorage.setItem("nbld_http_base_url", baseUrlInput.value.trim());
  localStorage.setItem("nbld_session", JSON.stringify({
    accountId: state.accountId,
    accountEmail: state.accountEmail,
    accountUsername: state.accountUsername,
    token: state.token,
    selectedCharacterId: state.selectedCharacterId,
    characterName: state.characterName,
  }));
}

function restoreSessionFromStorage(): void {
  const raw = localStorage.getItem("nbld_session");
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw) as Partial<AppState>;
    state.accountId = parsed.accountId ?? "";
    state.accountEmail = parsed.accountEmail ?? "";
    state.accountUsername = parsed.accountUsername ?? "";
    state.token = parsed.token ?? "";
    state.selectedCharacterId = parsed.selectedCharacterId ?? "";
    state.characterName = parsed.characterName ?? "";

    if (state.token) {
      emailInput.value = state.accountEmail;
      usernameInput.value = state.accountUsername;
      characterPanel.classList.remove("hidden");
      accountSummary.textContent = `${state.accountUsername || state.accountEmail} (${state.accountId})`;
      void prepareApi().then(() => loadCharacters()).catch((error) => {
        loginError.textContent = errorToString(error);
        logoutToLogin();
      });
    }
  } catch {
    localStorage.removeItem("nbld_session");
  }
}

function logoutToLogin(): void {
  if (state.ws) {
    state.ws.close();
    state.ws = undefined;
  }

  state.accountId = "";
  state.accountEmail = "";
  state.accountUsername = "";
  state.token = "";
  state.playerId = "";
  state.characterId = "";
  state.characterName = "";
  state.worldId = "";
  state.mapId = "map_0_0";
  state.players.clear();
  state.chunks.clear();
  state.availableCharacters = [];
  state.selectedCharacterId = "";
  state.status = "未连接";
  state.socketStatus = "未连接";
  state.lastError = "";
  state.currentTile = undefined;
  state.lastChunkKey = "";

  localStorage.removeItem("nbld_session");
  loginPanel.classList.remove("hidden");
  characterPanel.classList.add("hidden");
  hud.classList.add("hidden");
  debugPanel.classList.add("hidden");
  helpPanel.classList.add("hidden");
  loginError.textContent = "";
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
    const speed = state.pressed.has("ShiftLeft") || state.pressed.has("ShiftRight")
      ? PLAYER_SPRINT_SPEED_TILES_PER_SECOND
      : PLAYER_WALK_SPEED_TILES_PER_SECOND;
    const deltaX = (dx / length) * speed * deltaSeconds;
    const deltaY = (dy / length) * speed * deltaSeconds;
    state.player = movePlayerWithCollision(state.player, deltaX, deltaY);

    if (now - state.lastMoveSendAt > MOVE_SEND_INTERVAL_MS) {
      sendMove();
      state.lastMoveSendAt = now;
    }
  }

  const occupied = positionToOccupiedTile(state.player);
  const chunkKey = `${state.mapId}:${worldToChunk(occupied.x)}:${worldToChunk(occupied.y)}`;
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
  const width = (PLAYER_RENDER_WIDTH_PX / 32) * state.tileScale;
  const height = (PLAYER_RENDER_HEIGHT_PX / 32) * state.tileScale;
  ctx.fillStyle = "#ff4040";
  ctx.fillRect(screen.x - width / 2, screen.y - height, width, height);
  ctx.strokeStyle = "#ffe7d8";
  ctx.lineWidth = 2;
  ctx.strokeRect(screen.x - width / 2, screen.y - height, width, height);
}

function drawRemotePlayer(player: WorldPlayer): void {
  const screen = worldToScreen(player.position.x, player.position.y);
  const width = (PLAYER_RENDER_WIDTH_PX / 32) * state.tileScale;
  const height = (PLAYER_RENDER_HEIGHT_PX / 32) * state.tileScale;
  ctx.fillStyle = "#67d1ff";
  ctx.fillRect(screen.x - width / 2, screen.y - height, width, height);
  ctx.strokeStyle = "#e6f7ff";
  ctx.lineWidth = 2;
  ctx.strokeRect(screen.x - width / 2, screen.y - height, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.font = "12px Microsoft YaHei, sans-serif";
  ctx.fillText(player.characterName || player.playerId, screen.x + width / 2 + 4, screen.y - height + 12);
}

function updateHud(): void {
  if (!state.token) return;
  const occupied = positionToOccupiedTile(state.player);
  const chunkX = worldToChunk(occupied.x);
  const chunkY = worldToChunk(occupied.y);
  const tile = state.currentTile;
  const visibleTilesX = Math.round(canvas.width / state.tileScale);
  const visibleTilesY = Math.round(canvas.height / state.tileScale);
  const speed = state.pressed.has("ShiftLeft") || state.pressed.has("ShiftRight")
    ? PLAYER_SPRINT_SPEED_TILES_PER_SECOND
    : PLAYER_WALK_SPEED_TILES_PER_SECOND;
  hud.innerHTML = `
    <div><b>状态</b> ${state.status}　<b>Socket</b> ${state.socketStatus}</div>
    <div><b>账号</b> ${escapeHtml(state.accountUsername || state.accountEmail || "-")}　<b>角色</b> ${escapeHtml(state.characterName || "-")}</div>
    <div><b>玩家</b> ${escapeHtml(state.playerId)}　<b>地图</b> ${escapeHtml(state.mapId)}</div>
    <div><b>实体中心</b> X:${state.player.x.toFixed(2)} Y:${state.player.y.toFixed(2)}　<b>占地</b> 1x${PLAYER_COLLISION_SIZE_TILES} 格　<b>速度</b> ${speed.toFixed(1)} m/s　<b>区块</b> ${chunkX}, ${chunkY}</div>
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
  const occupied = positionToOccupiedTile({ x: worldX, y: worldY });
  const chunkX = worldToChunk(occupied.x);
  const chunkY = worldToChunk(occupied.y);
  const chunk = state.chunks.get(`${state.mapId}:${chunkX}:${chunkY}`);
  if (!chunk) return undefined;
  const localX = modFloor(occupied.x, CHUNK_SIZE);
  const localY = modFloor(occupied.y, CHUNK_SIZE);
  return chunk.snapshot.tiles[localY * CHUNK_SIZE + localX];
}

function getRenderWindow(): { centerChunkX: number; centerChunkY: number } {
  const occupied = positionToOccupiedTile(state.player);
  return {
    centerChunkX: worldToChunk(occupied.x),
    centerChunkY: worldToChunk(occupied.y),
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

function movePlayerWithCollision(position: Position, deltaX: number, deltaY: number): Position {
  let next = position;
  if (deltaX !== 0) {
    next = { ...next, x: resolveAxisCollision(next, deltaX, "x") };
  }
  if (deltaY !== 0) {
    next = { ...next, y: resolveAxisCollision(next, deltaY, "y") };
  }
  return next;
}

function resolveAxisCollision(position: Position, delta: number, axis: "x" | "y"): number {
  const proposed = { ...position, [axis]: position[axis] + delta };
  if (!collidesAtPosition(proposed)) {
    return proposed[axis];
  }

  const bounds = getCollisionBounds(proposed);
  const minTileX = Math.floor(bounds.minX + COLLISION_EPSILON);
  const maxTileX = Math.floor(bounds.maxX - COLLISION_EPSILON);
  const minTileY = Math.floor(bounds.minY + COLLISION_EPSILON);
  const maxTileY = Math.floor(bounds.maxY - COLLISION_EPSILON);
  const half = PLAYER_COLLISION_SIZE_TILES / 2;

  if (axis === "x") {
    if (delta > 0) {
      let clamped = proposed.x;
      for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
        for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
          if (isTileBlocked(tileX, tileY)) {
            clamped = Math.min(clamped, tileX - half);
          }
        }
      }
      return clamped;
    }

    let clamped = proposed.x;
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
        if (isTileBlocked(tileX, tileY)) {
          clamped = Math.max(clamped, tileX + 1 + half);
        }
      }
    }
    return clamped;
  }

  if (delta > 0) {
    let clamped = proposed.y;
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
        if (isTileBlocked(tileX, tileY)) {
          clamped = Math.min(clamped, tileY - half);
        }
      }
    }
    return clamped;
  }

  let clamped = proposed.y;
  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      if (isTileBlocked(tileX, tileY)) {
        clamped = Math.max(clamped, tileY + 1 + half);
      }
    }
  }
  return clamped;
}

function collidesAtPosition(position: Position): boolean {
  const bounds = getCollisionBounds(position);
  const minTileX = Math.floor(bounds.minX + COLLISION_EPSILON);
  const maxTileX = Math.floor(bounds.maxX - COLLISION_EPSILON);
  const minTileY = Math.floor(bounds.minY + COLLISION_EPSILON);
  const maxTileY = Math.floor(bounds.maxY - COLLISION_EPSILON);

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      if (isTileBlocked(tileX, tileY)) {
        return true;
      }
    }
  }
  return false;
}

function getCollisionBounds(position: Position): { minX: number; maxX: number; minY: number; maxY: number } {
  const half = PLAYER_COLLISION_SIZE_TILES / 2;
  return {
    minX: position.x - half,
    maxX: position.x + half,
    minY: position.y - half,
    maxY: position.y + half,
  };
}

function positionToOccupiedTile(position: Position): { x: number; y: number } {
  return {
    x: Math.floor(position.x),
    y: Math.floor(position.y),
  };
}

function isTileBlocked(tileX: number, tileY: number): boolean {
  const chunkX = worldToChunk(tileX);
  const chunkY = worldToChunk(tileY);
  const chunk = state.chunks.get(`${state.mapId}:${chunkX}:${chunkY}`);
  if (!chunk) {
    return false;
  }

  const localX = modFloor(tileX, CHUNK_SIZE);
  const localY = modFloor(tileY, CHUNK_SIZE);
  const tile = chunk.snapshot.tiles[localY * CHUNK_SIZE + localX];
  if (!tile) {
    return false;
  }

  if (BLOCKING_BLOCKS.has(tile.block || "")) {
    return true;
  }
  if (BLOCKING_DECORATIONS.has(tile.decoration || "")) {
    return true;
  }
  return false;
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
