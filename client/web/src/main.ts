import "./styles.css";
import { ApiClient } from "./api";
import { loadAssets, type AssetMaps } from "./assets";
import type {
  CharacterAppearance,
  CharacterBodyAppearance,
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
const TILE_TEXTURE_SIZE_PX = 32;
const PLAYER_WALK_SPEED_TILES_PER_SECOND = 4;
const PLAYER_SPRINT_SPEED_TILES_PER_SECOND = 6;
const IDLE_CHUNK_REFRESH_INTERVAL_MS = 5000;
const MOVE_SEND_INTERVAL_MS = 90;
const TARGET_VISIBLE_TILES_X = 40;
const TARGET_VISIBLE_TILES_Y = 22.5;
const RENDER_TILE_WINDOW_X = 120;
const RENDER_TILE_WINDOW_Y = 120;
const CHUNK_PREFETCH_MARGIN_TILES = 20;
const AVATAR_EDITOR_WIDTH = 30;
const AVATAR_EDITOR_HEIGHT = 60;
const AVATAR_EDITOR_MAX_CELL_SIZE = 10;
const AVATAR_EDITOR_MIN_CELL_SIZE = 5;
const PIXEL_SYMBOLS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const EMPTY_PIXEL_SYMBOL = "0";
const LEGACY_FILLED_PIXEL_SYMBOL = "1";
const SWATCH_SYMBOL_OFFSET = 2;
const MAX_PIXEL_SWATCHES = PIXEL_SYMBOLS.length - SWATCH_SYMBOL_OFFSET;
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

type Facing = "front" | "back" | "left" | "right";
type LayerEditorMode = "hair" | "skeleton";
type PaintMode = "fill" | "erase" | "bucket";
type BodyControlPage = "overall" | "body" | "arms" | "legs";
type GameViewport = { x: number; y: number; width: number; height: number };

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
  playerVisual: Position;
  camera: Position;
  facing: Facing;
  tileScale: number;
  chunks: Map<string, ChunkRender>;
  players: Map<string, WorldPlayer>;
  pressed: Set<string>;
  assets?: AssetMaps;
  status: string;
  socketStatus: string;
  lastError: string;
  lastChunkKey: string;
  lastChunkWindowKey: string;
  lastChunkRefreshAt: number;
  lastMoveSendAt: number;
  chunkRefreshInFlight: boolean;
  currentTile?: ChunkTile;
  availableCharacters: CharacterSummary[];
  selectedCharacterId: string;
  selectedHairLayer: keyof CharacterAppearance["hair"];
  selectedSkeletonLayer: keyof CharacterAppearance["skeleton"];
  selectedLayerMode: LayerEditorMode;
  appearanceFacing: Facing;
  showHairLayer: boolean;
  appearanceDraft: CharacterAppearance | null;
  paintMode: PaintMode;
  paintColor: string;
  recentPaintColors: string[];
  bodyControlPage: BodyControlPage;
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("missing #app");

app.innerHTML = `
  <div class="shell">
    <canvas class="world-canvas"></canvas>
    <section class="modal login-panel" id="loginModal">
      <div class="auth-page">
        <h1>NBLD H5 客户端</h1>
        <p>使用邮箱和密码登录进入游戏。</p>
        <label for="baseUrl">服务端地址</label>
        <input id="baseUrl" spellcheck="false" />
        <label for="loginEmailInput">邮箱</label>
        <input id="loginEmailInput" autocomplete="email" inputmode="email" spellcheck="false" />
        <label for="loginPasswordInput">密码</label>
        <input id="loginPasswordInput" autocomplete="current-password" type="password" />
        <div class="login-actions">
          <button id="loginButton">邮箱登录</button>
          <button id="openRegisterButton" class="secondary">前往注册</button>
        </div>
      </div>
    </section>
    <section class="modal login-panel hidden" id="registerModal">
      <div class="auth-page">
        <h1>注册账号</h1>
        <p>创建账号后返回选角。</p>
        <label for="registerEmailInput">邮箱</label>
        <input id="registerEmailInput" autocomplete="email" inputmode="email" spellcheck="false" />
        <label for="registerUsernameInput">用户名</label>
        <input id="registerUsernameInput" autocomplete="username" spellcheck="false" />
        <label for="registerPasswordInput">密码</label>
        <input id="registerPasswordInput" autocomplete="new-password" type="password" />
        <label for="registerConfirmPasswordInput">再次输入密码</label>
        <input id="registerConfirmPasswordInput" autocomplete="new-password" type="password" />
        <div class="login-actions">
          <button id="registerButton">注册账号</button>
          <button id="backToLoginButton" class="secondary">返回登录</button>
        </div>
      </div>
    </section>
    <section class="modal login-panel hidden" id="characterModal">
      <div class="character-panel" id="characterPanel">
        <div class="character-header">
          <strong id="accountSummary">未登录</strong>
          <button id="logoutButton" class="secondary">退出登录</button>
        </div>
        <p class="section-hint">选择角色进入世界，或创建新角色。</p>
        <div class="character-list" id="characterList"></div>
        <label for="characterNameInput">新角色名</label>
        <input id="characterNameInput" spellcheck="false" />
        <button id="createCharacterButton" class="secondary">创建角色</button>
      </div>
    </section>
    <section class="modal login-panel hidden" id="appearanceModal">
      <div class="appearance-editor" id="appearanceEditor">
        <h3>角色外观编辑</h3>
        <div class="appearance-layout">
          <div class="appearance-left">
            <div class="appearance-preview" id="appearancePreview"></div>
            <div class="appearance-grid" id="appearanceGrid"></div>
          </div>
          <div class="appearance-center">
            <div class="pixel-editor-grid" id="hairGrid"></div>
          </div>
          <div class="appearance-right">
            <div class="hair-toolbar" id="hairToolbar"></div>
            <div class="appearance-palette" id="appearancePalette"></div>
            <div class="pixel-tools" id="pixelTools"></div>
            <input class="hidden" id="appearanceFileInput" type="file" accept="application/json,image/png,image/*" />
          </div>
        </div>
        <div class="login-actions">
          <button id="saveAppearanceButton" type="button">保存外观</button>
          <button id="closeAppearanceButton" type="button" class="secondary">关闭</button>
        </div>
      </div>
    </section>
    <div class="error toast-error" id="loginError"></div>
    <section class="hud hidden"></section>
    <section class="debug-panel hidden"></section>
    <section class="help-panel hidden">WASD / 方向键移动，Shift 疾跑，鼠标滚轮缩放，H 隐藏/显示调试信息</section>
  </div>
`;

const canvas = app.querySelector<HTMLCanvasElement>(".world-canvas")!;
const ctx = canvas.getContext("2d", { alpha: false })!;
const loginModal = app.querySelector<HTMLElement>("#loginModal")!;
const registerModal = app.querySelector<HTMLElement>("#registerModal")!;
const characterModal = app.querySelector<HTMLElement>("#characterModal")!;
const appearanceModal = app.querySelector<HTMLElement>("#appearanceModal")!;
const loginError = app.querySelector<HTMLElement>("#loginError")!;
const loginButton = app.querySelector<HTMLButtonElement>("#loginButton")!;
const openRegisterButton = app.querySelector<HTMLButtonElement>("#openRegisterButton")!;
const registerButton = app.querySelector<HTMLButtonElement>("#registerButton")!;
const backToLoginButton = app.querySelector<HTMLButtonElement>("#backToLoginButton")!;
const createCharacterButton = app.querySelector<HTMLButtonElement>("#createCharacterButton")!;
const baseUrlInput = app.querySelector<HTMLInputElement>("#baseUrl")!;
const loginEmailInput = app.querySelector<HTMLInputElement>("#loginEmailInput")!;
const loginPasswordInput = app.querySelector<HTMLInputElement>("#loginPasswordInput")!;
const registerEmailInput = app.querySelector<HTMLInputElement>("#registerEmailInput")!;
const registerUsernameInput = app.querySelector<HTMLInputElement>("#registerUsernameInput")!;
const registerPasswordInput = app.querySelector<HTMLInputElement>("#registerPasswordInput")!;
const registerConfirmPasswordInput = app.querySelector<HTMLInputElement>("#registerConfirmPasswordInput")!;
const characterNameInput = app.querySelector<HTMLInputElement>("#characterNameInput")!;
const characterPanel = app.querySelector<HTMLElement>("#characterPanel")!;
const characterList = app.querySelector<HTMLElement>("#characterList")!;
const appearanceEditor = app.querySelector<HTMLElement>("#appearanceEditor")!;
const appearancePreview = app.querySelector<HTMLElement>("#appearancePreview")!;
const appearanceGrid = app.querySelector<HTMLElement>("#appearanceGrid")!;
const appearancePalette = app.querySelector<HTMLElement>("#appearancePalette")!;
const hairToolbar = app.querySelector<HTMLElement>("#hairToolbar")!;
const hairGrid = app.querySelector<HTMLElement>("#hairGrid")!;
const pixelTools = app.querySelector<HTMLElement>("#pixelTools")!;
const appearanceFileInput = app.querySelector<HTMLInputElement>("#appearanceFileInput")!;
const saveAppearanceButton = app.querySelector<HTMLButtonElement>("#saveAppearanceButton")!;
const closeAppearanceButton = app.querySelector<HTMLButtonElement>("#closeAppearanceButton")!;
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
  playerVisual: { x: 0, y: 0 },
  camera: { x: 0, y: 0 },
  facing: "front",
  tileScale: 1,
  chunks: new Map(),
  players: new Map(),
  pressed: new Set(),
  status: "未连接",
  socketStatus: "未连接",
  lastError: "",
  lastChunkKey: "",
  lastChunkWindowKey: "",
  lastChunkRefreshAt: 0,
  lastMoveSendAt: 0,
  chunkRefreshInFlight: false,
  availableCharacters: [],
  selectedCharacterId: "",
  selectedHairLayer: "front",
  selectedSkeletonLayer: "frontTorso",
  selectedLayerMode: "hair",
  appearanceFacing: "front",
  showHairLayer: true,
  appearanceDraft: null,
  paintMode: "fill",
  paintColor: "#ff4040",
  bodyControlPage: "overall",
  recentPaintColors: [
    "#ff4040", "#b42222", "#f2c199", "#d89b72", "#2d1a13",
    "#140b08", "#cfd8e3", "#7e8794", "#ffffff", "#000000",
    "#d9b35f", "#8fb6ff", "#5cc84a", "#2f6e35", "#9b6b3d",
    "#7a7f6a", "#67d1ff", "#ff77aa", "#8d6bff", "#f5e663",
  ],
};

baseUrlInput.value = normalizeBaseUrl(localStorage.getItem("nbld_http_base_url") ?? defaultApiBaseUrl());

loginButton.addEventListener("click", () => {
  void loginWithEmail();
});

openRegisterButton.addEventListener("click", () => {
  registerEmailInput.value = registerEmailInput.value || loginEmailInput.value.trim();
  loginModal.classList.add("hidden");
  registerModal.classList.remove("hidden");
  registerEmailInput.focus();
});

registerButton.addEventListener("click", () => {
  void registerWithEmail();
});

backToLoginButton.addEventListener("click", () => {
  loginEmailInput.value = loginEmailInput.value || registerEmailInput.value.trim();
  registerModal.classList.add("hidden");
  loginModal.classList.remove("hidden");
  loginEmailInput.focus();
});

app.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest("button") : null;
  if (!button) return;
  button.classList.remove("clicked");
  void button.offsetWidth;
  button.classList.add("clicked");
  window.setTimeout(() => button.classList.remove("clicked"), 220);
});

createCharacterButton.addEventListener("click", () => {
  void openCreateCharacterWithAppearance();
});

logoutButton.addEventListener("click", () => {
  logoutToLogin();
});

saveAppearanceButton.addEventListener("click", () => {
  void saveSelectedCharacterAppearance();
});

closeAppearanceButton.addEventListener("click", (event) => {
  event.stopPropagation();
  appearanceModal.classList.add("hidden");
});

appearanceFileInput.addEventListener("change", () => {
  const file = appearanceFileInput.files?.[0];
  if (!file) return;
  void importAppearanceFile(file);
});

baseUrlInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void loginWithEmail();
  }
});

window.addEventListener("resize", resizeCanvas);
window.addEventListener("resize", () => {
  if (!appearanceModal.classList.contains("hidden") && state.appearanceDraft) {
    renderPixelEditorGrid(getActiveLayerRows());
  }
});
window.addEventListener("keydown", (event) => {
  if (isTypingTarget(event.target)) return;
  if (event.code === "KeyH") {
    hud.classList.toggle("hidden");
    debugPanel.classList.toggle("hidden");
    return;
  }
  if (state.characterId && isMovementKey(event.code)) {
    event.preventDefault();
    state.pressed.add(event.code);
  }
});
window.addEventListener("keyup", (event) => {
  if (isTypingTarget(event.target)) return;
  state.pressed.delete(event.code);
});
resizeCanvas();
restoreSessionFromStorage();
requestAnimationFrame(loop);

async function loginWithEmail(): Promise<void> {
  loginError.textContent = "";
  setLoginBusy(true, "登录中...");

  try {
    const api = await prepareApi();
    const login = await api.login(loginEmailInput.value.trim(), loginPasswordInput.value);
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
      registerEmailInput.value.trim(),
      registerUsernameInput.value.trim(),
      registerPasswordInput.value,
      registerConfirmPasswordInput.value,
    );
    applyRegister(register);
    const login = await api.login(registerEmailInput.value.trim(), registerPasswordInput.value);
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
  baseUrlInput.value = baseUrl;
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
  loginModal.classList.add("hidden");
  registerModal.classList.add("hidden");
  characterModal.classList.remove("hidden");
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

    const preview = document.createElement("canvas");
    preview.width = 96;
    preview.height = 128;
    preview.className = "character-card-canvas";
    const previewCtx = preview.getContext("2d", { alpha: true })!;
    previewCtx.imageSmoothingEnabled = false;
    renderAvatarSkeleton(previewCtx, { x: 48, y: 104 }, character, "front", true, {
      leftArm: 0,
      rightArm: 0,
      leftLeg: 0,
      rightLeg: 0,
    });

    const meta = document.createElement("div");
    meta.className = "character-meta";
    meta.innerHTML = `
      <strong>${escapeHtml(character.name)}</strong>
      <span>${escapeHtml(character.id)}</span>
      <span>版本 ${character.version}</span>
    `;

    const actions = document.createElement("div");
    actions.className = "character-actions";

    const editButton = document.createElement("button");
    editButton.className = "secondary";
    editButton.textContent = "编辑外观";
    editButton.addEventListener("click", (event) => {
      event.stopPropagation();
      renderAppearanceEditor(character);
    });

    const enterButton = document.createElement("button");
    enterButton.textContent = "进入世界";
    enterButton.addEventListener("click", (event) => {
      event.stopPropagation();
      void enterWorldWithCharacter(character);
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "secondary";
    deleteButton.textContent = "删除角色";
    deleteButton.addEventListener("click", async (event) => {
      event.stopPropagation();
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

    const openAppearance = () => {
      renderAppearanceEditor(character);
    };
    preview.addEventListener("click", openAppearance);
    meta.addEventListener("click", openAppearance);

    actions.append(enterButton, editButton, deleteButton);
    wrapper.append(preview, meta, actions);
    characterList.appendChild(wrapper);
  }
}

function renderAppearanceEditor(character: CharacterSummary): void {
  appearanceEditor.classList.remove("hidden");
  appearanceModal.classList.remove("hidden");
  state.selectedCharacterId = character.id;
  state.appearanceDraft = normalizeAppearance(character.appearance);
  renderAppearancePreview(state.appearanceDraft);
  renderAppearanceControls(state.appearanceDraft.body);
  renderPaletteControls(state.appearanceDraft.palette);
  renderLayerControls();
  renderPixelTools();
}

async function openCreateCharacterWithAppearance(): Promise<void> {
  const draftCharacter: CharacterSummary = {
    id: "draft",
    name: characterNameInput.value.trim() || state.accountUsername || "Hero",
    version: 0,
    stats: {} as never,
    inventory: { items: [] },
    warehouse: { items: [] },
    position: { worldId: "", mapId: "", x: 0, y: 0 },
    equipment: { visibleArmor: {} },
    appearance: defaultAppearance(),
    createdAt: "",
    updatedAt: "",
  };
  renderAppearanceEditor(draftCharacter);
}

function renderAppearancePreview(appearance: CharacterAppearance): void {
  state.appearanceDraft = normalizeAppearance(appearance);
  const views: Array<[Facing, string]> = [
    ["front", "正面"],
    ["back", "背面"],
    ["left", "左侧"],
    ["right", "右侧"],
  ];
  appearancePreview.innerHTML = `
    ${views.map(([facing, label]) => `<button type="button" class="secondary hair-layer-btn ${state.appearanceFacing === facing ? "active" : ""}" data-facing="${facing}" aria-pressed="${state.appearanceFacing === facing}">${label}</button>`).join("")}
    <button type="button" class="secondary hair-layer-btn ${state.showHairLayer ? "active" : ""}" data-toggle-hair aria-pressed="${state.showHairLayer}">${state.showHairLayer ? "隐藏发层" : "显示发层"}</button>
  `;

  for (const button of appearancePreview.querySelectorAll<HTMLButtonElement>("[data-facing]")) {
    button.addEventListener("click", () => {
      state.appearanceFacing = button.dataset.facing as Facing;
      syncSelectedLayersToFacing();
      renderAppearanceEditor({
        ...currentAppearanceCharacter(),
        appearance: state.appearanceDraft ?? defaultAppearance(),
      });
    });
  }

  appearancePreview.querySelector<HTMLButtonElement>("[data-toggle-hair]")?.addEventListener("click", () => {
    state.showHairLayer = !state.showHairLayer;
    state.selectedLayerMode = state.showHairLayer ? "hair" : "skeleton";
    renderAppearancePreview(state.appearanceDraft ?? defaultAppearance());
    renderPaletteControls((state.appearanceDraft ?? defaultAppearance()).palette);
    renderLayerControls();
  });
}

function renderDirectionCard(label: string, body: CharacterBodyAppearance, facing: Facing): string {
  const scale = 0.72;
  const shoulder = facing === "left" || facing === "right" ? body.sideWidth : body.frontShoulderWidth;
  const chest = facing === "left" || facing === "right" ? body.chestDepth : body.chestWidth;
  const waist = facing === "left" || facing === "right" ? body.waistDepth : body.waistWidth;
  const hip = facing === "left" || facing === "right" ? body.hipDepth : body.hipWidth;
  const scaled = (value: number) => Math.max(4, Math.round(value * scale));
  return `
    <div class="appearance-card" data-facing="${facing}">
      <strong>${label}</strong>
      <div class="silhouette">
        <div class="segment head" style="width:${Math.max(8, scaled(shoulder * 0.55))}px;height:${Math.max(8, scaled(body.height * 0.22))}px"></div>
        <div class="segment shoulders" style="width:${scaled(shoulder)}px"></div>
        <div class="segment chest" style="width:${scaled(chest)}px"></div>
        <div class="segment waist" style="width:${scaled(waist)}px"></div>
        <div class="segment hip" style="width:${scaled(hip)}px"></div>
        <div class="segment legs" style="width:${Math.max(7, scaled(hip * 0.7))}px;height:${Math.max(10, scaled(body.height * 0.35))}px"></div>
      </div>
    </div>
  `;
}

function activeBodyLayerKey(): keyof CharacterAppearance["skeleton"] {
  switch (state.appearanceFacing) {
    case "back":
      return "backTorso";
    case "left":
      return "leftTorso";
    case "right":
      return "rightTorso";
    case "front":
    default:
      return "frontTorso";
  }
}

function activeHairLayerKey(): keyof CharacterAppearance["hair"] {
  switch (state.appearanceFacing) {
    case "back":
      return "back";
    case "left":
      return "left";
    case "right":
      return "right";
    case "front":
    default:
      return "front";
  }
}

function syncSelectedLayersToFacing(): void {
  state.selectedSkeletonLayer = activeBodyLayerKey();
  state.selectedHairLayer = activeHairLayerKey();
}

function getActiveLayerRows(): string[] {
  if (!state.appearanceDraft) return [];
  syncSelectedLayersToFacing();
  if (isEditingHairLayer()) return state.appearanceDraft.hair[state.selectedHairLayer] ?? [];

  const masked = maskBodyRows(state.appearanceDraft.skeleton[state.selectedSkeletonLayer] ?? []);
  state.appearanceDraft.skeleton[state.selectedSkeletonLayer] = masked;
  return masked;
}

function setActiveLayerRows(rows: string[]): void {
  if (!state.appearanceDraft) return;
  syncSelectedLayersToFacing();
  const normalized = isEditingHairLayer() ? normalizeHairRows(rows) : maskBodyRows(normalizeHairRows(rows));
  if (isEditingHairLayer()) {
    state.appearanceDraft.hair[state.selectedHairLayer] = normalized;
  } else {
    state.appearanceDraft.skeleton[state.selectedSkeletonLayer] = normalized;
  }
}

function applyPaintColorToPalette(color: string): void {
  if (!state.appearanceDraft) return;
  const normalized = normalizeHexColor(color, state.paintColor);
  state.appearanceDraft.palette.pixelSwatches = ensurePixelSwatchColor(
    state.appearanceDraft.palette.pixelSwatches,
    normalized,
  );
  if (isEditingHairLayer()) {
    state.appearanceDraft.palette.hairPrimary = normalized;
  } else {
    state.appearanceDraft.palette.clothPrimary = normalized;
  }
}

function pushRecentPaintColor(color: string): void {
  const normalized = normalizeHexColor(color, state.paintColor);
  state.recentPaintColors = [
    normalized,
    ...state.recentPaintColors.filter((item) => item.toLowerCase() !== normalized.toLowerCase()),
  ].slice(0, 20);
}

function isEditingHairLayer(): boolean {
  return state.showHairLayer;
}

function bodyPaintMask(): boolean[][] {
  return buildAvatarOutlineMatrix((state.appearanceDraft ?? defaultAppearance()).body, state.appearanceFacing);
}

function maskBodyRows(rows: string[]): string[] {
  return maskRowsWithMatrix(rows, bodyPaintMask());
}

function maskRowsWithMatrix(rows: string[], mask: boolean[][]): string[] {
  return trimTrailingEmptyRows(
    rowsToMatrix(rows, AVATAR_EDITOR_WIDTH, AVATAR_EDITOR_HEIGHT)
      .map((row, y) => row.map((cell, x) => (cell !== EMPTY_PIXEL_SYMBOL && mask[y][x] ? cell : EMPTY_PIXEL_SYMBOL)).join("").replace(/0+$/g, "")),
  );
}

function trimTrailingEmptyRows(rows: string[]): string[] {
  let end = rows.length;
  while (end > 0 && rows[end - 1].length === 0) end -= 1;
  return rows.slice(0, end);
}

function ensurePixelSwatchColor(swatches: string[] | undefined, color: string): string[] {
  const normalized = normalizeHexColor(color, "#ffffff");
  const next = [...(swatches ?? [])];
  const existing = next.findIndex((entry) => entry.toLowerCase() === normalized.toLowerCase());
  if (existing >= 0) return next;
  if (next.length < MAX_PIXEL_SWATCHES) {
    next.push(normalized);
    return next;
  }
  next[next.length - 1] = normalized;
  return next;
}

function pixelSymbolToColor(symbol: string, swatches: string[]): string {
  if (symbol === EMPTY_PIXEL_SYMBOL) return "transparent";
  if (symbol === LEGACY_FILLED_PIXEL_SYMBOL) return swatches[0] ?? "#ff4040";
  const index = PIXEL_SYMBOLS.indexOf(symbol) - SWATCH_SYMBOL_OFFSET;
  if (index < 0) return swatches[0] ?? "#ff4040";
  return swatches[index] ?? swatches[0] ?? "#ff4040";
}

function getCurrentPaintSymbol(): string {
  const appearance = state.appearanceDraft ?? defaultAppearance();
  appearance.palette.pixelSwatches = ensurePixelSwatchColor(appearance.palette.pixelSwatches, state.paintColor);
  const index = appearance.palette.pixelSwatches.findIndex((color) => color.toLowerCase() === state.paintColor.toLowerCase());
  const symbol = PIXEL_SYMBOLS[index + SWATCH_SYMBOL_OFFSET] ?? PIXEL_SYMBOLS[SWATCH_SYMBOL_OFFSET];
  return symbol;
}

function sanitizeAppearanceBodyLayers(appearance: CharacterAppearance): CharacterAppearance {
  return {
    ...appearance,
    skeleton: {
      frontTorso: maskRowsWithMatrix(appearance.skeleton.frontTorso ?? [], buildAvatarOutlineMatrix(appearance.body, "front")),
      backTorso: maskRowsWithMatrix(appearance.skeleton.backTorso ?? [], buildAvatarOutlineMatrix(appearance.body, "back")),
      leftTorso: maskRowsWithMatrix(appearance.skeleton.leftTorso ?? [], buildAvatarOutlineMatrix(appearance.body, "left")),
      rightTorso: maskRowsWithMatrix(appearance.skeleton.rightTorso ?? [], buildAvatarOutlineMatrix(appearance.body, "right")),
    },
  };
}

function renderAppearanceControls(body: CharacterBodyAppearance): void {
  const pages: Array<[BodyControlPage, string]> = [
    ["overall", "整体"],
    ["body", "身体"],
    ["arms", "手臂"],
    ["legs", "腿"],
  ];
  const fields = bodyControlFields(state.bodyControlPage);

  appearanceGrid.innerHTML = `
    <div class="body-page-tabs">
      ${pages.map(([page, label]) => `<button type="button" class="secondary hair-layer-btn ${state.bodyControlPage === page ? "active" : ""}" data-body-page="${page}" aria-pressed="${state.bodyControlPage === page}">${label}</button>`).join("")}
    </div>
    ${fields.map(([key, label, min, max]) => `
    <label class="appearance-field">
      <span>${label}</span>
      <input type="range" data-appearance-key="${key}" data-min="${min}" data-max="${max}" min="${min}" max="${max}" value="${body[key]}">
      <output>${body[key]}</output>
    </label>
    `).join("")}
  `;

  for (const button of appearanceGrid.querySelectorAll<HTMLButtonElement>("[data-body-page]")) {
    button.addEventListener("click", () => {
      state.bodyControlPage = button.dataset.bodyPage as BodyControlPage;
      renderAppearanceControls((state.appearanceDraft ?? defaultAppearance()).body);
    });
  }

  for (const input of appearanceGrid.querySelectorAll<HTMLInputElement>("input[data-appearance-key]")) {
    input.addEventListener("input", () => {
      if (!state.appearanceDraft) return;
      state.appearanceDraft = readAppearanceFromEditor();
      const output = input.parentElement?.querySelector("output");
      if (output) output.textContent = input.value;
      renderPixelEditorGrid(getActiveLayerRows());
    });
  }
}

function bodyControlFields(page: BodyControlPage): Array<[keyof CharacterBodyAppearance, string, number, number]> {
  switch (page) {
    case "overall":
      return [
        ["height", "身高", 42, 58],
        ["headWidth", "头宽", 8, 18],
        ["headSideWidth", "头侧宽", 7, 14],
      ];
    case "body":
      return [
        ["torsoHeight", "躯干长", 14, 26],
        ["chestWidth", "胸围", 14, 28],
        ["waistWidth", "腰围", 10, 26],
        ["hipWidth", "臀围", 12, 27],
        ["frontShoulderWidth", "肩宽", 22, 28],
        ["sideWidth", "肩侧宽", 10, 16],
        ["chestDepth", "侧胸围", 7, 16],
        ["waistDepth", "侧腰围", 6, 15],
        ["hipDepth", "侧臀围", 7, 16],
      ];
    case "arms":
      return [
        ["upperArmLength", "上臂长", 6, 18],
        ["upperArmWidth", "上臂宽", 2, 8],
        ["forearmLength", "小臂长", 5, 17],
        ["forearmWidth", "小臂宽", 2, 7],
        ["upperArmSideWidth", "上臂侧宽", 2, 8],
        ["forearmSideWidth", "小臂侧宽", 2, 7],
      ];
    case "legs":
      return [
        ["thighLength", "大腿长", 7, 20],
        ["thighWidth", "大腿宽", 3, 9],
        ["calfLength", "小腿长", 6, 19],
        ["calfWidth", "小腿宽", 2, 8],
        ["thighSideWidth", "大腿侧宽", 3, 9],
        ["calfSideWidth", "小腿侧宽", 2, 8],
      ];
  }
}

function renderPaletteControls(palette: CharacterAppearance["palette"]): void {
  state.paintColor = normalizeHexColor(state.paintColor, palette.pixelSwatches[0] ?? palette.clothPrimary);
  appearancePalette.innerHTML = `
    <label class="appearance-field">
      <span>当前颜料</span>
      <input type="color" id="paintColorInput" value="${state.paintColor}">
    </label>
  `;

  appearancePalette.querySelector<HTMLInputElement>("#paintColorInput")?.addEventListener("input", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    state.paintColor = input.value;
    applyPaintColorToPalette(input.value);
    pushRecentPaintColor(input.value);
    renderPaletteControls((state.appearanceDraft ?? defaultAppearance()).palette);
    renderPixelTools();
  });
}

function renderLayerControls(): void {
  if (!state.appearanceDraft) return;
  state.appearanceDraft = normalizeAppearance(state.appearanceDraft);
  const hairStyle = state.appearanceDraft.style.hairStyle;
  syncSelectedLayersToFacing();
  state.selectedLayerMode = isEditingHairLayer() ? "hair" : "skeleton";

  hairToolbar.innerHTML = `
    <label class="appearance-field">
      <span>发型名</span>
      <input type="text" id="hairStyleInput" value="${hairStyle}">
    </label>
  `;

  for (const input of hairToolbar.querySelectorAll<HTMLInputElement>("#hairStyleInput")) {
    input.addEventListener("input", () => {
      if (!state.appearanceDraft) return;
      state.appearanceDraft.style.hairStyle = input.value.trim() || "custom";
    });
  }

  renderPixelEditorGrid(getActiveLayerRows());
}

function renderPixelTools(): void {
  pixelTools.innerHTML = `
    <button type="button" class="secondary ${state.paintMode === "fill" ? "active" : ""}" data-paint-mode="fill" aria-pressed="${state.paintMode === "fill"}">画笔</button>
    <button type="button" class="secondary ${state.paintMode === "erase" ? "active" : ""}" data-paint-mode="erase" aria-pressed="${state.paintMode === "erase"}">橡皮</button>
    <button type="button" class="secondary ${state.paintMode === "bucket" ? "active" : ""}" data-paint-mode="bucket" aria-pressed="${state.paintMode === "bucket"}">涂料桶</button>
    <button type="button" class="secondary" data-tool="clear">清空</button>
    <button type="button" class="secondary" data-tool="export-json">导出JSON</button>
    <button type="button" class="secondary" data-tool="import">导入</button>
    <button type="button" class="secondary" data-tool="export-png">导出PNG</button>
    <div class="recent-colors">
      ${state.recentPaintColors.slice(0, 20).map((color) => `<button type="button" class="color-swatch" data-color="${color}" style="background:${color}" aria-label="${color}"></button>`).join("")}
    </div>
  `;

  for (const button of pixelTools.querySelectorAll<HTMLButtonElement>("[data-paint-mode]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      state.paintMode = button.dataset.paintMode as PaintMode;
      renderPixelTools();
    });
  }

  for (const button of pixelTools.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      applyPixelTool(button.dataset.tool ?? "");
    });
  }

  for (const button of pixelTools.querySelectorAll<HTMLButtonElement>("[data-color]")) {
    button.addEventListener("click", () => {
      const color = button.dataset.color ?? state.paintColor;
      state.paintColor = color;
      applyPaintColorToPalette(color);
      renderPaletteControls((state.appearanceDraft ?? defaultAppearance()).palette);
      renderPixelTools();
    });
  }
}

function readAppearanceFromEditor(): CharacterAppearance {
  const base = normalizeAppearance(state.appearanceDraft ?? defaultAppearance());

  for (const input of appearanceGrid.querySelectorAll<HTMLInputElement>("input[data-appearance-key]")) {
    const key = input.dataset.appearanceKey as keyof CharacterBodyAppearance;
    const min = Number(input.dataset.min ?? 0);
    const max = Number(input.dataset.max ?? 999);
    const value = clamp(Number(input.value || base.body[key]), min, max);
    base.body[key] = Math.round(value);
    input.value = String(base.body[key]);
  }

  const hairStyleInput = hairToolbar.querySelector<HTMLInputElement>("#hairStyleInput");
  if (hairStyleInput) base.style.hairStyle = hairStyleInput.value.trim() || "custom";

  return normalizeAppearance(base);
}

function normalizeHairRows(rows: string[]): string[] {
  return rows
    .map((row) => row.replace(new RegExp(`[^${PIXEL_SYMBOLS}]`, "g"), ""))
    .slice(0, AVATAR_EDITOR_HEIGHT)
    .map((row) => row.slice(0, AVATAR_EDITOR_WIDTH));
}

function getAvatarEditorCellSize(): number {
  const modalBounds = appearanceModal.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
  const maxCanvasHeight = Math.max(
    AVATAR_EDITOR_HEIGHT * AVATAR_EDITOR_MIN_CELL_SIZE,
    Math.min(viewportHeight - 180, modalBounds.height - 72, AVATAR_EDITOR_HEIGHT * AVATAR_EDITOR_MAX_CELL_SIZE),
  );
  return clamp(
    Math.floor(maxCanvasHeight / AVATAR_EDITOR_HEIGHT),
    AVATAR_EDITOR_MIN_CELL_SIZE,
    AVATAR_EDITOR_MAX_CELL_SIZE,
  );
}

function paintPixelMatrixCell(matrix: string[][], x: number, y: number, mask: boolean[][]): boolean {
  if (x < 0 || x >= AVATAR_EDITOR_WIDTH || y < 0 || y >= AVATAR_EDITOR_HEIGHT) return false;
  if (!isEditingHairLayer() && !mask[y]?.[x]) return false;
  if (state.paintMode === "bucket") {
    floodFillMatrix(matrix, x, y, getCurrentPaintSymbol(), isEditingHairLayer() ? undefined : mask);
    return true;
  }
  const nextValue = state.paintMode === "erase" ? EMPTY_PIXEL_SYMBOL : getCurrentPaintSymbol();
  if (matrix[y][x] === nextValue) return false;
  matrix[y][x] = nextValue;
  return true;
}

function buildEditorDisplayMatrix(): { outline: boolean[][]; body: string[][]; hair: string[][] } {
  const outline = buildAvatarOutlineMatrix((state.appearanceDraft ?? defaultAppearance()).body, state.appearanceFacing);
  const bodyRows = maskBodyRows(state.appearanceDraft?.skeleton[activeBodyLayerKey()] ?? []);
  if (state.appearanceDraft) state.appearanceDraft.skeleton[activeBodyLayerKey()] = bodyRows;
  const hairRows = state.appearanceDraft?.hair[activeHairLayerKey()] ?? [];
  return {
    outline,
    body: rowsToMatrix(bodyRows, AVATAR_EDITOR_WIDTH, AVATAR_EDITOR_HEIGHT),
    hair: rowsToMatrix(hairRows, AVATAR_EDITOR_WIDTH, AVATAR_EDITOR_HEIGHT),
  };
}

function renderPixelEditorGrid(rows: string[]): void {
  const normalized = normalizeHairRows(rows);
  const matrix = Array.from({ length: AVATAR_EDITOR_HEIGHT }, (_, y) => {
    const row = normalized[y] ?? "";
    return Array.from({ length: AVATAR_EDITOR_WIDTH }, (_, x) => row[x] ?? EMPTY_PIXEL_SYMBOL);
  });
  const cellSize = getAvatarEditorCellSize();
  const mask = bodyPaintMask();
  hairGrid.innerHTML = "";
  hairGrid.style.setProperty("--cell-size", `${cellSize}px`);
  hairGrid.style.setProperty("--grid-width", String(AVATAR_EDITOR_WIDTH));
  hairGrid.style.setProperty("--grid-height", String(AVATAR_EDITOR_HEIGHT));

  const repaintGrid = () => {
    const nextDisplay = buildEditorDisplayMatrix();
    for (const cell of hairGrid.querySelectorAll<HTMLElement>(".pixel-cell")) {
      const x = Number(cell.dataset.x);
      const y = Number(cell.dataset.y);
      const outlineFilled = nextDisplay.outline[y]?.[x] ?? false;
      const bodySymbol = nextDisplay.body[y]?.[x] ?? EMPTY_PIXEL_SYMBOL;
      const hairSymbol = nextDisplay.hair[y]?.[x] ?? EMPTY_PIXEL_SYMBOL;
      const bodyFilled = bodySymbol !== EMPTY_PIXEL_SYMBOL;
      const hairFilled = hairSymbol !== EMPTY_PIXEL_SYMBOL;
      cell.classList.toggle("outline", outlineFilled);
      cell.classList.toggle("body-filled", bodyFilled);
      cell.classList.toggle("hair-filled", hairFilled && state.showHairLayer);
      cell.classList.toggle("blocked", !isEditingHairLayer() && !outlineFilled);
      cell.style.setProperty("--body-color", pixelSymbolToColor(bodySymbol, state.appearanceDraft?.palette.pixelSwatches ?? []));
      cell.style.setProperty("--hair-color", pixelSymbolToColor(hairSymbol, state.appearanceDraft?.palette.pixelSwatches ?? []));
    }
  };

  const paintAt = (x: number, y: number) => {
    const changed = paintPixelMatrixCell(matrix, x, y, mask);
    if (!changed) return;
    updateDraftHairFromMatrix(matrix);
    repaintGrid();
  };

  const fragment = document.createDocumentFragment();
  for (let y = 0; y < AVATAR_EDITOR_HEIGHT; y += 1) {
    for (let x = 0; x < AVATAR_EDITOR_WIDTH; x += 1) {
      const cell = document.createElement("div");
      cell.className = "pixel-cell";
      cell.dataset.x = String(x);
      cell.dataset.y = String(y);
      cell.setAttribute("draggable", "false");
      cell.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        paintAt(x, y);
      });
      cell.addEventListener("pointerenter", (event) => {
        if ((event.buttons & 1) !== 1) return;
        paintAt(x, y);
      });
      fragment.appendChild(cell);
    }
  }
  hairGrid.appendChild(fragment);

  repaintGrid();
}

function updateDraftHairFromMatrix(matrix: string[][]): void {
  if (!state.appearanceDraft) return;
  const outline = buildAvatarOutlineMatrix(state.appearanceDraft.body, state.appearanceFacing);
  const rows = trimTrailingEmptyRows(
    matrix.map((row, y) => row.map((cell, x) => (cell !== EMPTY_PIXEL_SYMBOL && (isEditingHairLayer() || outline[y][x]) ? cell : EMPTY_PIXEL_SYMBOL)).join("").replace(/0+$/g, "")),
  );
  setActiveLayerRows(rows);
}

function applyPixelTool(tool: string): void {
  if (!state.appearanceDraft) return;
  const matrix = rowsToMatrix(getActiveLayerRows(), AVATAR_EDITOR_WIDTH, AVATAR_EDITOR_HEIGHT);

  switch (tool) {
    case "clear":
      for (const row of matrix) row.fill(EMPTY_PIXEL_SYMBOL);
      break;
    case "export-json":
      void copyTextToClipboard(JSON.stringify(normalizeAppearance(state.appearanceDraft), null, 2));
      return;
    case "export-png":
      exportActiveLayerPng();
      return;
    case "import":
      appearanceFileInput.value = "";
      appearanceFileInput.click();
      return;
    default:
      return;
  }

  updateDraftHairFromMatrix(matrix);
  renderPixelEditorGrid(getActiveLayerRows());
}

function rowsToMatrix(rows: string[], width: number, height: number): string[][] {
  const normalized = normalizeHairRows(rows);
  return Array.from({ length: height }, (_, y) => {
    const row = normalized[y] ?? "";
    return Array.from({ length: width }, (_, x) => row[x] ?? EMPTY_PIXEL_SYMBOL);
  });
}

function floodFillMatrix(matrix: string[][], startX: number, startY: number, value: string, mask?: boolean[][]): void {
  if (mask && !mask[startY]?.[startX]) return;
  const target = matrix[startY]?.[startX];
  if (target === undefined || target === value) return;
  const stack: Array<[number, number]> = [[startX, startY]];
  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    if (mask && !mask[y]?.[x]) continue;
    if (matrix[y]?.[x] !== target) continue;
    matrix[y][x] = value;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
}

function buildAvatarOutlineMatrix(body: CharacterBodyAppearance, facing: Facing): boolean[][] {
  const matrix = Array.from({ length: AVATAR_EDITOR_HEIGHT }, () => Array.from({ length: AVATAR_EDITOR_WIDTH }, () => false));
  const side = facing === "left" || facing === "right";
  const centerX = Math.floor(AVATAR_EDITOR_WIDTH / 2);
  const totalHeight = clamp(body.height, 42, 58);
  const top = AVATAR_EDITOR_HEIGHT - totalHeight;
  const headH = clamp(Math.round(9 * body.headScale / 100), 7, 13);
  const headW = side ? body.headSideWidth : body.headWidth;
  const torsoH = clamp(body.torsoHeight, 14, 26);
  const legH = Math.max(8, totalHeight - headH - torsoH);
  const shoulderW = side ? clamp(body.sideWidth, 10, 16) : clamp(body.frontShoulderWidth, 22, 28);
  const chestW = side ? body.chestDepth : body.chestWidth;
  const waistW = side ? body.waistDepth : body.waistWidth;
  const hipW = side ? body.hipDepth : body.hipWidth;
  const armW = clamp(side ? body.upperArmSideWidth : body.upperArmWidth, 2, 8);
  const forearmW = clamp(side ? body.forearmSideWidth : body.forearmWidth, 2, 8);
  const armH = clamp(body.upperArmLength + body.forearmLength, 11, 24);
  const legW = clamp(side ? body.thighSideWidth : body.thighWidth, 2, 9);
  const calfW = clamp(side ? body.calfSideWidth : body.calfWidth, 2, 8);

  fillOutlineRect(matrix, centerX - Math.floor(headW / 2), top, headW, headH);
  const torsoTop = top + headH;
  const torsoX = (width: number, section: "chest" | "waist" | "hip" | "shoulder") => {
    if (!side) return centerX - Math.floor(width / 2);
    const frontSign = facing === "left" ? 1 : -1;
    const anchor = centerX - Math.floor(shoulderW / 2);
    if (section === "shoulder") return anchor;
    if (section === "hip") {
      return frontSign > 0 ? centerX + Math.floor(shoulderW / 2) - width : centerX - Math.floor(shoulderW / 2);
    }
    return frontSign > 0 ? centerX - Math.floor(shoulderW / 2) : centerX + Math.floor(shoulderW / 2) - width;
  };
  fillOutlineRect(matrix, torsoX(shoulderW, "shoulder"), torsoTop, shoulderW, Math.max(2, Math.round(torsoH * 0.2)));
  fillOutlineRect(matrix, torsoX(chestW, "chest"), torsoTop + Math.round(torsoH * 0.2), chestW, Math.max(3, Math.round(torsoH * 0.35)));
  fillOutlineRect(matrix, torsoX(waistW, "waist"), torsoTop + Math.round(torsoH * 0.55), waistW, Math.max(2, Math.round(torsoH * 0.2)));
  fillOutlineRect(matrix, torsoX(hipW, "hip"), torsoTop + Math.round(torsoH * 0.75), hipW, Math.max(3, Math.round(torsoH * 0.25)));

  const limbTop = torsoTop + 3;
  if (side) {
    const frontSign = facing === "left" ? 1 : -1;
    const armGap = 3;
    const armX = frontSign > 0
      ? centerX + Math.floor(shoulderW / 2) + armGap
      : centerX - Math.floor(shoulderW / 2) - armGap - armW;
    const forearmX = frontSign > 0
      ? centerX + Math.floor(shoulderW / 2) + armGap
      : centerX - Math.floor(shoulderW / 2) - armGap - forearmW;
    fillOutlineRect(matrix, armX, limbTop, armW, body.upperArmLength);
    fillOutlineRect(matrix, forearmX, limbTop + body.upperArmLength, forearmW, body.forearmLength);
    fillOutlineRect(matrix, centerX - Math.floor(legW / 2), torsoTop + torsoH, legW, body.thighLength);
    fillOutlineRect(matrix, centerX - Math.floor(calfW / 2), torsoTop + torsoH + body.thighLength, calfW, body.calfLength);
  } else {
    fillOutlineRect(matrix, centerX - Math.floor(shoulderW / 2) - armW, limbTop, armW, body.upperArmLength);
    fillOutlineRect(matrix, centerX - Math.floor(shoulderW / 2) - forearmW, limbTop + body.upperArmLength, forearmW, body.forearmLength);
    fillOutlineRect(matrix, centerX + Math.floor(shoulderW / 2), limbTop, armW, body.upperArmLength);
    fillOutlineRect(matrix, centerX + Math.floor(shoulderW / 2), limbTop + body.upperArmLength, forearmW, body.forearmLength);
    fillOutlineRect(matrix, centerX - legW - 1, torsoTop + torsoH, legW, body.thighLength);
    fillOutlineRect(matrix, centerX - calfW - 1, torsoTop + torsoH + body.thighLength, calfW, body.calfLength);
    fillOutlineRect(matrix, centerX + 1, torsoTop + torsoH, legW, body.thighLength);
    fillOutlineRect(matrix, centerX + 1, torsoTop + torsoH + body.thighLength, calfW, body.calfLength);
  }
  return matrix;
}

function fillOutlineRect(matrix: boolean[][], x: number, y: number, width: number, height: number): void {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      if (yy >= 0 && yy < AVATAR_EDITOR_HEIGHT && xx >= 0 && xx < AVATAR_EDITOR_WIDTH) {
        matrix[yy][xx] = true;
      }
    }
  }
}

async function importAppearanceFile(file: File): Promise<void> {
  if (!state.appearanceDraft) return;
  try {
    if (file.type.includes("json") || file.name.toLowerCase().endsWith(".json")) {
      const raw = await file.text();
      state.appearanceDraft = normalizeAppearance(JSON.parse(raw) as Partial<CharacterAppearance>);
      renderAppearanceEditor({
        ...currentAppearanceCharacter(),
        appearance: state.appearanceDraft,
      });
      return;
    }

    const bitmap = await createImageBitmap(file);
    const source = document.createElement("canvas");
    source.width = AVATAR_EDITOR_WIDTH;
    source.height = AVATAR_EDITOR_HEIGHT;
    const sourceCtx = source.getContext("2d", { willReadFrequently: true })!;
    sourceCtx.imageSmoothingEnabled = false;
    sourceCtx.clearRect(0, 0, source.width, source.height);
    sourceCtx.drawImage(bitmap, 0, 0, AVATAR_EDITOR_WIDTH, AVATAR_EDITOR_HEIGHT);
    const pixels = sourceCtx.getImageData(0, 0, AVATAR_EDITOR_WIDTH, AVATAR_EDITOR_HEIGHT).data;
    const rows = trimTrailingEmptyRows(Array.from({ length: AVATAR_EDITOR_HEIGHT }, (_, y) => {
      let row = "";
      for (let x = 0; x < AVATAR_EDITOR_WIDTH; x += 1) {
        const offset = (y * AVATAR_EDITOR_WIDTH + x) * 4;
        const alpha = pixels[offset + 3];
        const bright = pixels[offset] + pixels[offset + 1] + pixels[offset + 2];
        row += alpha > 32 && bright > 48 ? getCurrentPaintSymbol() : EMPTY_PIXEL_SYMBOL;
      }
      return row.replace(/0+$/g, "");
    }));
    setActiveLayerRows(rows);
    renderPixelEditorGrid(getActiveLayerRows());
  } catch (error) {
    loginError.textContent = errorToString(error);
  }
}

function exportActiveLayerPng(): void {
  const matrix = rowsToMatrix(getActiveLayerRows(), AVATAR_EDITOR_WIDTH, AVATAR_EDITOR_HEIGHT);
  const output = document.createElement("canvas");
  output.width = AVATAR_EDITOR_WIDTH;
  output.height = AVATAR_EDITOR_HEIGHT;
  const outputCtx = output.getContext("2d")!;
  outputCtx.clearRect(0, 0, output.width, output.height);
  outputCtx.fillStyle = isEditingHairLayer()
    ? (state.appearanceDraft?.palette.hairPrimary ?? state.paintColor)
    : (state.appearanceDraft?.palette.clothPrimary ?? state.paintColor);
  matrix.forEach((row, y) => {
    row.forEach((symbol, x) => {
      if (symbol === EMPTY_PIXEL_SYMBOL) return;
      outputCtx.fillStyle = pixelSymbolToColor(symbol, state.appearanceDraft?.palette.pixelSwatches ?? []);
      outputCtx.fillRect(x, y, 1, 1);
    });
  });
  const link = document.createElement("a");
  link.download = `${state.appearanceFacing}-${isEditingHairLayer() ? "hair" : "body"}.png`;
  link.href = output.toDataURL("image/png");
  link.click();
}

async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text);
    loginError.textContent = "外观 JSON 已复制到剪贴板";
    return;
  } catch {
    window.prompt("复制外观 JSON", text);
    loginError.textContent = "浏览器不允许直接复制，请从弹窗复制外观 JSON";
  }
}

async function saveSelectedCharacterAppearance(): Promise<void> {
  if (!state.api || !state.token || !state.selectedCharacterId) return;
  const character = state.availableCharacters.find((item) => item.id === state.selectedCharacterId);

  setLoginBusy(true, "保存外观中...");
  loginError.textContent = "";
  try {
    const appearance = normalizeAppearance(readAppearanceFromEditor());
    state.appearanceDraft = appearance;
    if (!character || character.id === "draft") {
      const name = characterNameInput.value.trim() || state.accountUsername || "Hero";
      const created = await state.api.createCharacter(state.token, name);
      const updated = await state.api.updateCharacterAppearance(state.token, created.character.id, appearance);
      state.selectedCharacterId = updated.character.id;
      await loadCharacters();
      appearanceModal.classList.add("hidden");
    } else {
      const updated = await state.api.updateCharacterAppearance(state.token, state.selectedCharacterId, appearance);
      const index = state.availableCharacters.findIndex((item) => item.id === updated.character.id);
      if (index >= 0) {
        state.availableCharacters[index] = {
          ...updated.character,
          appearance,
        };
      }
      renderCharacterList(state.availableCharacters);
      renderAppearanceEditor({
        ...updated.character,
        appearance,
      });
    }
  } catch (error) {
    loginError.textContent = errorToString(error);
  } finally {
    setLoginBusy(false);
  }
}

function defaultAppearanceBody(): CharacterBodyAppearance {
  return {
    height: 50,
    headWidth: 13,
    headSideWidth: 10,
    frontShoulderWidth: 24,
    sideWidth: 12,
    chestWidth: 20,
    waistWidth: 16,
    hipWidth: 20,
    torsoHeight: 20,
    upperArmWidth: 4,
    upperArmSideWidth: 4,
    upperArmLength: 11,
    forearmWidth: 4,
    forearmSideWidth: 4,
    forearmLength: 10,
    thighWidth: 5,
    thighSideWidth: 4,
    thighLength: 12,
    calfWidth: 4,
    calfSideWidth: 3,
    calfLength: 11,
    chestDepth: 10,
    waistDepth: 9,
    hipDepth: 10,
    headScale: 100,
  };
}

function defaultAppearance(): CharacterAppearance {
  return {
    body: defaultAppearanceBody(),
    style: {
      hairStyle: "short",
    },
    hair: {
      front: [],
      back: [],
      left: [],
      right: [],
      frontFg: [],
      backFg: [],
      leftFg: [],
      rightFg: [],
    },
    skeleton: {
      frontTorso: [],
      backTorso: [],
      leftTorso: [],
      rightTorso: [],
    },
    palette: {
      skinPrimary: "#f2c199",
      skinShadow: "#d89b72",
      hairPrimary: "#2d1a13",
      hairShadow: "#140b08",
      clothPrimary: "#ff4040",
      clothShadow: "#b42222",
      metalPrimary: "#cfd8e3",
      metalShadow: "#7e8794",
      pixelSwatches: [
        "#ff4040", "#b42222", "#f2c199", "#d89b72", "#2d1a13",
        "#140b08", "#cfd8e3", "#7e8794", "#ffffff", "#000000",
        "#d9b35f", "#8fb6ff", "#5cc84a", "#2f6e35", "#9b6b3d",
        "#7a7f6a", "#67d1ff", "#ff77aa", "#8d6bff", "#f5e663",
      ],
    },
  };
}

function normalizeAppearance(input: Partial<CharacterAppearance> | CharacterAppearance): CharacterAppearance {
  const fallback = defaultAppearance();
  const body = { ...fallback.body, ...(input.body ?? {}) };
  body.headWidth ||= fallback.body.headWidth;
  body.headSideWidth ||= fallback.body.headSideWidth;
  body.upperArmSideWidth ||= body.upperArmWidth || fallback.body.upperArmSideWidth;
  body.forearmSideWidth ||= body.forearmWidth || fallback.body.forearmSideWidth;
  body.thighSideWidth ||= body.thighWidth || fallback.body.thighSideWidth;
  body.calfSideWidth ||= body.calfWidth || fallback.body.calfSideWidth;
  const palette = { ...fallback.palette, ...(input.palette ?? {}) };
  const hair = { ...fallback.hair, ...(input.hair ?? {}) };
  const skeleton = { ...fallback.skeleton, ...(input.skeleton ?? {}) };
  const style = { ...fallback.style, ...(input.style ?? {}) };

  const normalized: CharacterAppearance = {
    body: {
      height: clamp(Math.round(body.height), 42, 58),
      headWidth: clamp(Math.round(body.headWidth), 8, 18),
      headSideWidth: clamp(Math.round(body.headSideWidth), 7, 14),
      frontShoulderWidth: clamp(Math.round(body.frontShoulderWidth), 22, 28),
      sideWidth: clamp(Math.round(body.sideWidth), 10, 16),
      chestWidth: clamp(Math.round(body.chestWidth), 14, 28),
      waistWidth: clamp(Math.round(body.waistWidth), 10, 26),
      hipWidth: clamp(Math.round(body.hipWidth), 12, 27),
      torsoHeight: clamp(Math.round(body.torsoHeight), 14, 26),
      upperArmWidth: clamp(Math.round(body.upperArmWidth), 2, 8),
      upperArmSideWidth: clamp(Math.round(body.upperArmSideWidth), 2, 8),
      upperArmLength: clamp(Math.round(body.upperArmLength), 6, 18),
      forearmWidth: clamp(Math.round(body.forearmWidth), 2, 7),
      forearmSideWidth: clamp(Math.round(body.forearmSideWidth), 2, 7),
      forearmLength: clamp(Math.round(body.forearmLength), 5, 17),
      thighWidth: clamp(Math.round(body.thighWidth), 3, 9),
      thighSideWidth: clamp(Math.round(body.thighSideWidth), 3, 9),
      thighLength: clamp(Math.round(body.thighLength), 7, 20),
      calfWidth: clamp(Math.round(body.calfWidth), 2, 8),
      calfSideWidth: clamp(Math.round(body.calfSideWidth), 2, 8),
      calfLength: clamp(Math.round(body.calfLength), 6, 19),
      chestDepth: clamp(Math.round(body.chestDepth), 7, 16),
      waistDepth: clamp(Math.round(body.waistDepth), 6, 15),
      hipDepth: clamp(Math.round(body.hipDepth), 7, 16),
      headScale: clamp(Math.round(body.headScale), 70, 140),
    },
    style: {
      hairStyle: String(style.hairStyle || "custom").slice(0, 32),
    },
    hair: {
      front: normalizeHairRows(hair.front ?? []),
      back: normalizeHairRows(hair.back ?? []),
      left: normalizeHairRows(hair.left ?? []),
      right: normalizeHairRows(hair.right ?? []),
      frontFg: [],
      backFg: [],
      leftFg: [],
      rightFg: [],
    },
    skeleton: {
      frontTorso: normalizeHairRows(skeleton.frontTorso ?? []),
      backTorso: normalizeHairRows(skeleton.backTorso ?? []),
      leftTorso: normalizeHairRows(skeleton.leftTorso ?? []),
      rightTorso: normalizeHairRows(skeleton.rightTorso ?? []),
    },
    palette: {
      skinPrimary: normalizeHexColor(palette.skinPrimary, fallback.palette.skinPrimary),
      skinShadow: normalizeHexColor(palette.skinShadow, fallback.palette.skinShadow),
      hairPrimary: normalizeHexColor(palette.hairPrimary, fallback.palette.hairPrimary),
      hairShadow: normalizeHexColor(palette.hairShadow, fallback.palette.hairShadow),
      clothPrimary: normalizeHexColor(palette.clothPrimary, fallback.palette.clothPrimary),
      clothShadow: normalizeHexColor(palette.clothShadow, fallback.palette.clothShadow),
      metalPrimary: normalizeHexColor(palette.metalPrimary, fallback.palette.metalPrimary),
      metalShadow: normalizeHexColor(palette.metalShadow, fallback.palette.metalShadow),
      pixelSwatches: (palette.pixelSwatches ?? fallback.palette.pixelSwatches)
        .filter((color): color is string => typeof color === "string")
        .map((color) => normalizeHexColor(color, fallback.palette.clothPrimary))
        .slice(0, 32),
    },
  };

  return sanitizeAppearanceBodyLayers(normalized);
}

function normalizeHexColor(value: string | undefined, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value ?? "") ? value! : fallback;
}

function currentAppearanceCharacter(): CharacterSummary {
  return state.availableCharacters.find((item) => item.id === state.selectedCharacterId) ?? {
    id: state.selectedCharacterId || "draft",
    name: characterNameInput.value.trim() || state.accountUsername || "Hero",
    version: 0,
    stats: {} as never,
    inventory: { items: [] },
    warehouse: { items: [] },
    position: { worldId: "", mapId: "", x: 0, y: 0 },
    equipment: { visibleArmor: {} },
    appearance: state.appearanceDraft ?? defaultAppearance(),
    createdAt: "",
    updatedAt: "",
  };
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
    state.lastChunkWindowKey = "";
    state.status = "已连接";
    state.lastError = "";
    persistSession();

    await refreshChunks(true);
    connectWebSocket(state.api);

    loginModal.classList.add("hidden");
    registerModal.classList.add("hidden");
    characterModal.classList.add("hidden");
    appearanceModal.classList.add("hidden");
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
  const baseUrl = normalizeBaseUrl(baseUrlInput.value);
  baseUrlInput.value = baseUrl;
  localStorage.setItem("nbld_http_base_url", baseUrl);
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
      loginEmailInput.value = state.accountEmail;
      registerEmailInput.value = state.accountEmail;
      registerUsernameInput.value = state.accountUsername;
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
  state.lastChunkWindowKey = "";

  localStorage.removeItem("nbld_session");
  loginEmailInput.value = state.accountEmail;
  loginPasswordInput.value = "";
  registerEmailInput.value = "";
  registerUsernameInput.value = "";
  registerPasswordInput.value = "";
  registerConfirmPasswordInput.value = "";
  loginModal.classList.remove("hidden");
  registerModal.classList.add("hidden");
  characterModal.classList.add("hidden");
  appearanceModal.classList.add("hidden");
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
  if (!state.token || !state.characterId) return;

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
  const movedToNewChunk = chunkKey !== state.lastChunkKey;
  const idleRefreshDue = state.pressed.size === 0 && now - state.lastChunkRefreshAt > IDLE_CHUNK_REFRESH_INTERVAL_MS;
  const nextChunkWindowKey = getPreferredChunkWindowKey(state.player);
  const shouldPrefetchChunkWindow = nextChunkWindowKey !== state.lastChunkWindowKey;
  const renderWindowMissingChunks = hasMissingChunksInRenderWindow();
  if (movedToNewChunk || shouldPrefetchChunkWindow || idleRefreshDue || renderWindowMissingChunks) {
    state.lastChunkKey = chunkKey;
    state.lastChunkWindowKey = nextChunkWindowKey;
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
  if (state.chunkRefreshInFlight) return;
  if (!force && state.status === "加载区块中") return;

  const previousStatus = state.status;
  state.chunkRefreshInFlight = true;
  state.status = "加载区块中";
  try {
    const windowData = await state.api.chunks(state.token, state.player);
    applyChunkWindow(windowData);
    state.status = "已连接";
  } catch (error) {
    state.status = previousStatus;
    state.lastError = errorToString(error);
  } finally {
    state.chunkRefreshInFlight = false;
  }
}

function applyChunkWindow(windowData: ChunkWindowResponse): void {
  state.mapId = windowData.mapId || state.mapId;
  state.lastChunkWindowKey = `${state.mapId}:${windowData.centerChunkX}:${windowData.centerChunkY}`;
  for (const coord of windowData.unloadedChunks) {
    state.chunks.delete(coordKey(coord));
  }
  for (const chunk of windowData.chunks) {
    const key = coordKey(chunk.coord);
    const previous = state.chunks.get(key);
    if (previous && canReuseRenderedChunk(chunk)) {
      previous.snapshot = chunk;
      continue;
    }
    state.chunks.set(key, renderChunk(chunk));
  }
  state.currentTile = findTileAt(state.player.x, state.player.y);
}

function getPreferredChunkWindowKey(position: Position): string {
  const occupied = positionToOccupiedTile(position);
  let chunkX = worldToChunk(occupied.x);
  let chunkY = worldToChunk(occupied.y);
  const localX = modFloor(occupied.x, CHUNK_SIZE);
  const localY = modFloor(occupied.y, CHUNK_SIZE);

  if (localX >= CHUNK_SIZE - CHUNK_PREFETCH_MARGIN_TILES) chunkX += 1;
  if (localX < CHUNK_PREFETCH_MARGIN_TILES) chunkX -= 1;
  if (localY >= CHUNK_SIZE - CHUNK_PREFETCH_MARGIN_TILES) chunkY += 1;
  if (localY < CHUNK_PREFETCH_MARGIN_TILES) chunkY -= 1;

  return `${state.mapId}:${chunkX}:${chunkY}`;
}

function hasMissingChunksInRenderWindow(): boolean {
  if (state.chunks.size === 0) return false;
  const minX = Math.floor(state.camera.x - RENDER_TILE_WINDOW_X / 2);
  const maxX = Math.floor(state.camera.x + RENDER_TILE_WINDOW_X / 2);
  const minY = Math.floor(state.camera.y - RENDER_TILE_WINDOW_Y / 2);
  const maxY = Math.floor(state.camera.y + RENDER_TILE_WINDOW_Y / 2);
  for (let chunkX = worldToChunk(minX); chunkX <= worldToChunk(maxX); chunkX += 1) {
    for (let chunkY = worldToChunk(minY); chunkY <= worldToChunk(maxY); chunkY += 1) {
      if (!state.chunks.has(`${state.mapId}:${chunkX}:${chunkY}`)) {
        return true;
      }
    }
  }
  return false;
}

function canReuseRenderedChunk(snapshot: ChunkSnapshot): boolean {
  return !snapshot.dirty && (!snapshot.deltaTiles || snapshot.deltaTiles.length === 0);
}

function renderChunk(snapshot: ChunkSnapshot): ChunkRender {
  const offscreen = document.createElement("canvas");
  offscreen.width = CHUNK_SIZE * TILE_TEXTURE_SIZE_PX;
  offscreen.height = CHUNK_SIZE * TILE_TEXTURE_SIZE_PX;
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
        tile.x * TILE_TEXTURE_SIZE_PX,
        (CHUNK_SIZE - 1 - tile.y) * TILE_TEXTURE_SIZE_PX,
        TILE_TEXTURE_SIZE_PX,
        TILE_TEXTURE_SIZE_PX,
      );
    } else {
      chunkCtx.fillStyle = fallbackColor(tile.terrain);
      chunkCtx.fillRect(
        tile.x * TILE_TEXTURE_SIZE_PX,
        (CHUNK_SIZE - 1 - tile.y) * TILE_TEXTURE_SIZE_PX,
        TILE_TEXTURE_SIZE_PX,
        TILE_TEXTURE_SIZE_PX,
      );
    }
    if (tile.decoration) decorations.push(tile);
  }

  for (const tile of decorations) {
    const image = state.assets?.decorations.get(tile.decoration || "");
    if (!image) continue;
    const widthTiles = Math.max(1, image.width / TILE_TEXTURE_SIZE_PX);
    const heightTiles = Math.max(1, image.height / TILE_TEXTURE_SIZE_PX);
    const width = widthTiles * TILE_TEXTURE_SIZE_PX;
    const height = heightTiles * TILE_TEXTURE_SIZE_PX;
    const x = (tile.x + 0.5) * TILE_TEXTURE_SIZE_PX - width / 2;
    const y = (CHUNK_SIZE - tile.y - 0.15) * TILE_TEXTURE_SIZE_PX - height;
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

  const viewport = getGameViewport();
  ctx.save();
  ctx.beginPath();
  ctx.rect(viewport.x, viewport.y, viewport.width, viewport.height);
  ctx.clip();

  for (const chunk of state.chunks.values()) {
    if (!isChunkInRenderWindow(chunk.snapshot.coord)) continue;

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
  ctx.restore();
}

function drawChunkGrid(x: number, y: number, size: number): void {
  if (state.tileScale < 5) return;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.22)";
  ctx.lineWidth = Math.max(1, window.devicePixelRatio);
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(size), Math.round(size));
}

function drawLocalPlayer(): void {
  const screen = worldToScreen(state.player.x, state.player.y);
  const character = state.availableCharacters.find((item) => item.id === state.characterId);
  renderAvatarSkeleton(ctx, screen, character, "front", true, getLimbMotionState(true));
}

function drawRemotePlayer(player: WorldPlayer): void {
  const screen = worldToScreen(player.position.x, player.position.y);
  const character = state.availableCharacters.find((item) => item.id === player.characterId)
    ?? (player.characterId
      ? {
          id: player.characterId,
          name: player.characterName || player.playerId,
          version: 0,
          stats: {} as never,
          inventory: { items: [] },
          warehouse: { items: [] },
          position: { worldId: "", mapId: player.mapId || "", x: player.position.x, y: player.position.y },
          equipment: player.equipment ?? { visibleArmor: {} },
          appearance: player.appearance ?? defaultAppearance(),
          createdAt: "",
          updatedAt: "",
        }
      : undefined);
  renderAvatarSkeleton(ctx, screen, character, "front", false, getLimbMotionState(false));
  ctx.fillStyle = "#ffffff";
  ctx.font = "12px Microsoft YaHei, sans-serif";
  ctx.fillText(player.characterName || player.playerId, screen.x + 18, screen.y - 42);
}

function renderAvatarSkeleton(
  target: CanvasRenderingContext2D,
  screen: Position,
  character: CharacterSummary | undefined,
  facing: Facing,
  local: boolean,
  moveState: { leftArm: number; rightArm: number; leftLeg: number; rightLeg: number },
): void {
  const appearance = normalizeAppearance(character?.appearance ?? defaultAppearance());
  const body = appearance.body;
  const palette = appearance.palette ?? (local
    ? { skinPrimary: "#f2c199", skinShadow: "#d89b72", hairPrimary: "#2d1a13", hairShadow: "#140b08", clothPrimary: "#ff4040", clothShadow: "#b42222", metalPrimary: "#ffe7d8", metalShadow: "#7e8794" }
    : { skinPrimary: "#f0c6b0", skinShadow: "#d89b72", hairPrimary: "#23314f", hairShadow: "#10192b", clothPrimary: "#67d1ff", clothShadow: "#2d8dac", metalPrimary: "#e6f7ff", metalShadow: "#8ca3ba" });

  const scale = state.tileScale / 4;
  const side = facing === "left" || facing === "right";
  const shoulder = (side ? body.sideWidth : body.frontShoulderWidth) * 0.18 * scale;
  const chest = (side ? body.chestDepth : body.chestWidth) * 0.16 * scale;
  const waist = (side ? body.waistDepth : body.waistWidth) * 0.16 * scale;
  const hip = (side ? body.hipDepth : body.hipWidth) * 0.16 * scale;
  const torsoHeight = body.torsoHeight * 0.22 * scale;
  const legHeight = (body.thighLength + body.calfLength) * 0.14 * scale;
  const headScale = body.headScale / 100;
  const headWidth = Math.max(10, shoulder * 0.7 * headScale);
  const headHeight = Math.max(12, headWidth * 0.9);

  const topY = screen.y - (headHeight + torsoHeight + legHeight);

  const backHairLayer = facing === "front" ? appearance.hair.back : [];
  const frontHairLayer = facing === "front"
    ? appearance.hair.front
    : facing === "back"
      ? appearance.hair.back
      : facing === "left"
        ? appearance.hair.left
        : appearance.hair.right;
  const skinLayer = facing === "front"
    ? appearance.skeleton.frontTorso
    : facing === "back"
      ? appearance.skeleton.backTorso
      : facing === "left"
        ? appearance.skeleton.leftTorso
        : appearance.skeleton.rightTorso;

  const skinPixel = state.tileScale / TILE_TEXTURE_SIZE_PX;
  const imageTopY = screen.y - AVATAR_EDITOR_HEIGHT * skinPixel;
  drawAvatarImageLayer(target, screen.x, imageTopY, backHairLayer, appearance.palette.pixelSwatches, palette.hairPrimary, palette.hairShadow);

  if (skinLayer.length > 0) {
    drawAvatarImageLayer(target, screen.x, imageTopY, skinLayer, appearance.palette.pixelSwatches, palette.clothPrimary, palette.clothShadow);
  } else {
    drawHeadLayer(target, screen.x, topY, headWidth, headHeight, palette.skinPrimary, palette.skinShadow);
    drawTorsoLayer(target, screen.x, topY + headHeight, shoulder, chest, waist, hip, torsoHeight, palette.clothPrimary, palette.clothShadow, palette.metalPrimary, [], scale);
  }

  const armWidth = Math.max(3, body.upperArmWidth * 0.18 * scale);
  const armLength = Math.max(10, (body.upperArmLength + body.forearmLength) * 0.12 * scale);
  if (skinLayer.length === 0) {
    if (side) {
      drawLimb(target, screen.x + shoulder / 2, topY + headHeight + 4, armLength, armWidth, moveState.rightArm, palette.skinPrimary, palette.skinShadow);
    } else {
      drawLimb(target, screen.x - shoulder / 2, topY + headHeight + 4, armLength, armWidth, moveState.leftArm, palette.skinPrimary, palette.skinShadow);
      drawLimb(target, screen.x + shoulder / 2, topY + headHeight + 4, armLength, armWidth, moveState.rightArm, palette.skinPrimary, palette.skinShadow);
    }
  }

  const legWidth = Math.max(4, body.thighWidth * 0.18 * scale);
  if (skinLayer.length === 0) {
    if (side) {
      drawLimb(target, screen.x, topY + headHeight + torsoHeight, legHeight, legWidth, moveState.rightLeg, palette.clothShadow, palette.metalShadow);
    } else {
      drawLimb(target, screen.x - legWidth, topY + headHeight + torsoHeight, legHeight, legWidth, moveState.leftLeg, palette.clothShadow, palette.metalShadow);
      drawLimb(target, screen.x + legWidth, topY + headHeight + torsoHeight, legHeight, legWidth, moveState.rightLeg, palette.clothShadow, palette.metalShadow);
    }
  }

  if (character?.equipment?.visibleArmor?.helmet) {
    drawPixelRect(target, screen.x - headWidth / 2, topY - 2, headWidth, 4, palette.metalShadow, palette.metalPrimary);
  }
  if (character?.equipment?.visibleArmor?.chest) {
    drawPixelRect(target, screen.x - chest / 2, topY + headHeight + torsoHeight * 0.25, chest, torsoHeight * 0.35, palette.metalShadow, palette.metalPrimary);
  }
  if (character?.equipment?.visibleArmor?.pants) {
    drawPixelRect(target, screen.x - hip / 2, topY + headHeight + torsoHeight * 0.78, hip, torsoHeight * 0.22, palette.metalShadow, palette.metalPrimary);
  }
  if (character?.equipment?.visibleArmor?.shoes) {
    drawPixelRect(target, screen.x - legWidth - 1, topY + headHeight + torsoHeight + legHeight - 4, legWidth * 2 + 2, 4, palette.metalShadow, palette.metalPrimary);
  }

  drawAvatarImageLayer(target, screen.x, imageTopY, frontHairLayer, appearance.palette.pixelSwatches, palette.hairPrimary, palette.hairShadow);
}

function drawHeadLayer(target: CanvasRenderingContext2D, centerX: number, topY: number, width: number, height: number, fill: string, stroke: string): void {
  drawPixelRect(target, centerX - width / 2, topY, width, height, fill, stroke);
}

function drawHairLayer(target: CanvasRenderingContext2D, centerX: number, topY: number, rows: string[] | undefined, fill: string, stroke: string, scale: number): void {
  if (!rows || rows.length === 0) return;
  const pixel = Math.max(2, Math.round(scale * 0.9));
  const rowWidth = Math.max(...rows.map((row) => row.length), 0);
  const startX = centerX - (rowWidth * pixel) / 2;
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch !== "1") return;
      drawPixelRect(target, startX + x * pixel, topY + y * pixel, pixel, pixel, fill, stroke);
    });
  });
}

function drawAvatarImageLayer(target: CanvasRenderingContext2D, centerX: number, topY: number, rows: string[] | undefined, swatches: string[], fallbackFill: string, stroke: string): void {
  if (!rows || rows.length === 0) return;
  const pixel = state.tileScale / TILE_TEXTURE_SIZE_PX;
  const width = AVATAR_EDITOR_WIDTH * pixel;
  const startX = centerX - width / 2;
  const drawStroke = pixel >= 3;
  rows.slice(0, AVATAR_EDITOR_HEIGHT).forEach((row, y) => {
    [...row.slice(0, AVATAR_EDITOR_WIDTH)].forEach((ch, x) => {
      if (ch === EMPTY_PIXEL_SYMBOL) return;
      const fill = pixelSymbolToColor(ch, swatches) || fallbackFill;
      if (drawStroke) {
        drawPixelRect(target, startX + x * pixel, topY + y * pixel, pixel, pixel, fill, stroke);
        return;
      }
      target.fillStyle = fill;
      target.fillRect(startX + x * pixel, topY + y * pixel, pixel, pixel);
    });
  });
}

function drawTorsoLayer(
  target: CanvasRenderingContext2D,
  centerX: number,
  topY: number,
  shoulder: number,
  chest: number,
  waist: number,
  hip: number,
  torsoHeight: number,
  fill: string,
  shadow: string,
  trim: string,
  layer: string[],
  scale: number,
): void {
  if (layer && layer.length > 0) {
    drawHairLayer(target, centerX, topY, layer, fill, trim, scale);
    return;
  }
  drawPixelRect(target, centerX - shoulder / 2, topY, shoulder, torsoHeight * 0.22, shadow, trim);
  drawPixelRect(target, centerX - chest / 2, topY + torsoHeight * 0.22, chest, torsoHeight * 0.34, fill, trim);
  drawPixelRect(target, centerX - waist / 2, topY + torsoHeight * 0.56, waist, torsoHeight * 0.18, shadow, trim);
  drawPixelRect(target, centerX - hip / 2, topY + torsoHeight * 0.74, hip, torsoHeight * 0.26, fill, trim);
}

function drawPixelRect(target: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, fill: string, stroke: string): void {
  target.fillStyle = fill;
  target.fillRect(x, y, width, height);
  target.strokeStyle = stroke;
  target.lineWidth = 1;
  target.strokeRect(x, y, width, height);
}

function drawLimb(target: CanvasRenderingContext2D, anchorX: number, anchorY: number, length: number, width: number, angleDegrees: number, fill: string, stroke: string): void {
  target.save();
  target.translate(anchorX, anchorY);
  target.rotate((angleDegrees * Math.PI) / 180);
  drawPixelRect(target, -width / 2, 0, width, length, fill, stroke);
  target.restore();
}

function getLimbMotionState(local: boolean): { leftArm: number; rightArm: number; leftLeg: number; rightLeg: number } {
  const moving = local ? state.characterId !== "" && state.pressed.size > 0 : true;
  if (!moving) {
    return { leftArm: 0, rightArm: 0, leftLeg: 0, rightLeg: 0 };
  }

  const phase = Math.sin(performance.now() / 110);
  const swing = Math.abs(phase) > 0.4 ? 90 : 45;
  return {
    leftArm: phase > 0 ? -swing : swing,
    rightArm: phase > 0 ? swing : -swing,
    leftLeg: phase > 0 ? swing : -swing,
    rightLeg: phase > 0 ? -swing : swing,
  };
}

function updateHud(): void {
  if (!state.token || !state.characterId) return;
  const occupied = positionToOccupiedTile(state.player);
  const chunkX = worldToChunk(occupied.x);
  const chunkY = worldToChunk(occupied.y);
  const tile = state.currentTile;
  const visibleTilesX = TARGET_VISIBLE_TILES_X;
  const visibleTilesY = TARGET_VISIBLE_TILES_Y;
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
    <div><b>实际渲染</b> ${RENDER_TILE_WINDOW_X} x ${RENDER_TILE_WINDOW_Y} 格　<b>当前可见</b> ${visibleTilesX} x ${visibleTilesY} 格</div>
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

function isChunkInRenderWindow(coord: ChunkCoord): boolean {
  if (coord.mapId !== state.mapId) return false;
  const minX = state.camera.x - RENDER_TILE_WINDOW_X / 2;
  const maxX = state.camera.x + RENDER_TILE_WINDOW_X / 2;
  const minY = state.camera.y - RENDER_TILE_WINDOW_Y / 2;
  const maxY = state.camera.y + RENDER_TILE_WINDOW_Y / 2;
  const chunkMinX = coord.chunkX * CHUNK_SIZE;
  const chunkMaxX = chunkMinX + CHUNK_SIZE;
  const chunkMinY = coord.chunkY * CHUNK_SIZE;
  const chunkMaxY = chunkMinY + CHUNK_SIZE;
  return chunkMaxX >= minX && chunkMinX <= maxX && chunkMaxY >= minY && chunkMinY <= maxY;
}

function worldToScreen(x: number, y: number): Position {
  const viewport = getGameViewport();
  return {
    x: viewport.x + viewport.width / 2 + (x - state.camera.x) * state.tileScale,
    y: viewport.y + viewport.height / 2 - (y - state.camera.y) * state.tileScale,
  };
}

function resizeCanvas(): void {
  canvas.width = Math.max(1, Math.floor(window.innerWidth));
  canvas.height = Math.max(1, Math.floor(window.innerHeight));
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  state.tileScale = getFittedTileScale();
}

function getFittedTileScale(): number {
  return Math.max(1, Math.floor(Math.min(canvas.width / TARGET_VISIBLE_TILES_X, canvas.height / TARGET_VISIBLE_TILES_Y)));
}

function getGameViewport(): GameViewport {
  const tileScale = Math.max(1, state.tileScale);
  const width = TARGET_VISIBLE_TILES_X * tileScale;
  const height = TARGET_VISIBLE_TILES_Y * tileScale;
  return {
    x: Math.floor((canvas.width - width) / 2),
    y: Math.floor((canvas.height - height) / 2),
    width,
    height,
  };
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

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

function defaultApiBaseUrl(): string {
  const url = new URL(window.location.href);
  if (url.port === "27777") {
    url.port = "16363";
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return defaultApiBaseUrl();
  const normalized = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(normalized);
  if (url.port === "27777" || url.port === "6363") {
    url.port = "16363";
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
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
