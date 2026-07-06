import "./styles.css";
import { ApiClient } from "./api";
import { loadAssets, type AssetMaps } from "./assets";
import type {
  AttributeDefinition,
  AttributeValues,
  CharacterAppearance,
  CharacterBodyAppearance,
  CharacterCombatStats,
  CharacterSummary,
  CharacterStats,
  ChunkCoord,
  ChunkSnapshot,
  ChunkTile,
  ChunkWindowResponse,
  LoginResponse,
  Position,
  RegisterResponse,
  RuntimeResources,
  SlimPlayerState,
  WorldPlayer,
  WSServerMessage,
} from "./protocol";

const CHUNK_SIZE = 80;
const TILE_TEXTURE_SIZE_PX = 32;
const SPRINT_SPEED_MULTIPLIER = 1.4;
const SPRINT_STAMINA_COST_PER_SECOND = 10;
const STAMINA_REGEN_WHILE_RUNNING = 2;
const STAMINA_REGEN_RECENTLY_STOPPED = 4;
const STAMINA_REGEN_RESTED = 8;
const IDLE_CHUNK_REFRESH_INTERVAL_MS = 5000;
const MOVE_SEND_INTERVAL_MS = 120;
const HUD_REFRESH_INTERVAL_MS = 120;
const RESOURCE_SYNC_INTERVAL_MS = 2000;
const TARGET_VISIBLE_TILES_X = 40;
const TARGET_VISIBLE_TILES_Y = 22.5;
const GAME_ASPECT_RATIO = TARGET_VISIBLE_TILES_X / TARGET_VISIBLE_TILES_Y;
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
const AVATAR_LAYER_CACHE_LIMIT = 256;
const PLAYER_COLLISION_SIZE_TILES = 1;
const COLLISION_EPSILON = 0.0001;

const ATTRIBUTE_LABELS: Record<string, string> = {
  health: "生命",
  stamina: "耐力",
  mana: "法力",
  move_speed: "移速",
  physical_attack: "物攻",
  magic_attack: "法攻",
  physical_defense: "物防",
  magic_defense: "法防",
  physical_crit: "物暴",
  magic_crit: "法暴",
  crit_damage_bonus: "爆伤",
  damage_bonus: "增伤",
  extra_damage: "追加",
  crit_resist: "暴抗",
  damage_immunity: "免伤",
  extra_immunity: "追免",
  heal_power: "治疗",
  heal_taken_bonus: "受疗",
};

const CORE_STAT_CODES = [
  "physical_attack",
  "magic_attack",
  "physical_defense",
  "magic_defense",
  "move_speed",
] as const;

const RATIO_STAT_CODES = [
  "physical_crit",
  "magic_crit",
  "crit_damage_bonus",
  "damage_bonus",
  "damage_immunity",
  "extra_immunity",
] as const;

const SOURCE_LABELS: Record<string, string> = {
  base: "基础",
  levelGrowth: "等级",
  talent: "天赋",
  equipment: "装备",
  passiveGem: "魂石",
  buff: "状态",
  system: "系统",
  manual: "手动",
};

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
type PaintMode = "fill" | "erase" | "bucket" | "picker";
type BodyControlPage = "overall" | "body" | "arms" | "legs";
type GameViewport = { x: number; y: number; width: number; height: number };
type LimbPose = -90 | -45 | 0 | 45 | 90 | "disabled";
type LimbDisableMode = "none" | "arms" | "legs" | "all";
type LimbMotionState = { leftArm: LimbPose; rightArm: LimbPose; leftLeg: LimbPose; rightLeg: LimbPose };
type AvatarLayerRect = { x: number; y: number; width: number; height: number };
type AvatarLimbPart = { source: AvatarLayerRect; target: AvatarLayerRect };
type AvatarLimbSegment = {
  poseKey: keyof LimbMotionState;
  depth: "behind" | "front";
  alpha: number;
  anchor: { x: number; y: number };
  parts: AvatarLimbPart[];
};
const IDLE_LIMB_STATE: LimbMotionState = { leftArm: 0, rightArm: 0, leftLeg: 0, rightLeg: 0 };
type SkinExportPackage = {
  format: "nbld.skin";
  version: 1;
  exportedAt: string;
  appearance: CharacterAppearance;
  layers: {
    skeleton: CharacterAppearance["skeleton"];
    hair: CharacterAppearance["hair"];
  };
  textures: {
    skeleton: Record<keyof CharacterAppearance["skeleton"], string>;
    hair: Record<keyof CharacterAppearance["hair"], string>;
  };
};

type ScreenOrientationWithLock = ScreenOrientation & {
  lock?: (orientation: "landscape" | "portrait" | "any") => Promise<void>;
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
  playerVisual: Position;
  camera: Position;
  facing: Facing;
  runtimeResources: RuntimeResources;
  currentStamina: number;
  wantsSprint: boolean;
  sprinting: boolean;
  tileScale: number;
  chunks: Map<string, ChunkRender>;
  pendingChunkRenders: Array<{ key: string; snapshot: ChunkSnapshot }>;
  deferredChunkRenders: Array<{ key: string; snapshot: ChunkSnapshot }>;
  players: Map<string, WorldPlayer>;
  remoteVisuals: Map<string, Position>;
  remoteFacing: Map<string, Facing>;
  pressed: Set<string>;
  assets?: AssetMaps;
  status: string;
  socketStatus: string;
  lastError: string;
  lastChunkKey: string;
  lastChunkWindowKey: string;
  lastChunkRefreshAt: number;
  lastMoveSendAt: number;
  lastHudUpdateAt: number;
  lastResourceSyncAt: number;
  resourceSyncInFlight: boolean;
  lastFrameMs: number;
  lastChunkRefreshMs: number;
  lastChunkRefreshCount: number;
  lastChunkRenderMs: number;
  lastChunkRenderCount: number;
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
  menuOpen: boolean;
  inventoryOpen: boolean;
  inventoryFacing: Facing;
  selectedHotbarIndex: number;
  settingsPage: "audio" | "video" | "keys";
  audioSettings: {
    masterVolume: number;
    musicVolume: number;
    sfxVolume: number;
  };
  videoSettings: {
    chunkRenderBudget: number;
    showDebug: boolean;
    showHelp: boolean;
  };
  keyBindings: Record<"moveUp" | "moveDown" | "moveLeft" | "moveRight" | "sprint", string>;
  awaitingKeyBinding: keyof AppState["keyBindings"] | null;
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
        <div class="appearance-title">
          <h3>角色外观编辑</h3>
          <button type="button" class="secondary appearance-help" aria-label="捏脸教程">
            教程
            <span class="appearance-help-popover">
              皮肤分为4个面，每个面都有自己的发层（头发），有按钮可以隐藏/显示发层。<br>
              发层无任何限制，隐藏发层才能编辑骨骼层（头也算），骨骼层仅允许在骨骼上涂色。<br>
              快绘制属于你的角色吧！！！
            </span>
          </button>
        </div>
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
    <section class="stamina-hud hidden"></section>
    <section class="debug-panel hidden"></section>
    <section class="help-panel hidden">WASD / 方向键移动，Shift 疾跑，B 背包，Esc 菜单，鼠标滚轮缩放，H 隐藏/显示调试信息</section>
    <section class="orientation-overlay hidden" id="orientationOverlay">
      <div>请横屏游玩</div>
    </section>
    <section class="modal pause-menu hidden" id="pauseMenu">
      <div class="pause-layout">
        <aside class="pause-nav" id="pauseNav"></aside>
        <div class="pause-content" id="pauseContent"></div>
      </div>
    </section>
    <section class="modal inventory-modal hidden" id="inventoryModal"></section>
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
const staminaHud = app.querySelector<HTMLElement>(".stamina-hud")!;
const debugPanel = app.querySelector<HTMLElement>(".debug-panel")!;
const helpPanel = app.querySelector<HTMLElement>(".help-panel")!;
const orientationOverlay = app.querySelector<HTMLElement>("#orientationOverlay")!;
const pauseMenu = app.querySelector<HTMLElement>("#pauseMenu")!;
const pauseNav = app.querySelector<HTMLElement>("#pauseNav")!;
const pauseContent = app.querySelector<HTMLElement>("#pauseContent")!;
const inventoryModal = app.querySelector<HTMLElement>("#inventoryModal")!;
const avatarLayerRasterCache = new Map<string, HTMLCanvasElement>();

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
  runtimeResources: {},
  currentStamina: 100,
  wantsSprint: false,
  sprinting: false,
  tileScale: 1,
  chunks: new Map(),
  pendingChunkRenders: [],
  deferredChunkRenders: [],
  players: new Map(),
  remoteVisuals: new Map(),
  remoteFacing: new Map(),
  pressed: new Set(),
  status: "未连接",
  socketStatus: "未连接",
  lastError: "",
  lastChunkKey: "",
  lastChunkWindowKey: "",
  lastChunkRefreshAt: 0,
  lastMoveSendAt: 0,
  lastHudUpdateAt: 0,
  lastResourceSyncAt: 0,
  resourceSyncInFlight: false,
  lastFrameMs: 0,
  lastChunkRefreshMs: 0,
  lastChunkRefreshCount: 0,
  lastChunkRenderMs: 0,
  lastChunkRenderCount: 0,
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
  menuOpen: false,
  inventoryOpen: false,
  inventoryFacing: "front",
  selectedHotbarIndex: 4,
  settingsPage: "audio",
  audioSettings: {
    masterVolume: 100,
    musicVolume: 70,
    sfxVolume: 80,
  },
  videoSettings: {
    chunkRenderBudget: 1,
    showDebug: true,
    showHelp: true,
  },
  keyBindings: {
    moveUp: "KeyW",
    moveDown: "KeyS",
    moveLeft: "KeyA",
    moveRight: "KeyD",
    sprint: "ShiftLeft",
  },
  awaitingKeyBinding: null,
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
window.addEventListener("orientationchange", () => {
  resizeCanvas();
});

window.addEventListener("keydown", (event) => {
  if (state.awaitingKeyBinding) {
    event.preventDefault();
    state.keyBindings[state.awaitingKeyBinding] = event.code;
    state.awaitingKeyBinding = null;
    renderPauseMenu("settings");
    return;
  }
  if (event.code === "Escape" && state.characterId) {
    event.preventDefault();
    if (state.inventoryOpen) {
      toggleInventory(false);
      return;
    }
    togglePauseMenu();
    return;
  }
  if (isTypingTarget(event.target)) return;
  if (event.code === "KeyB" && state.characterId) {
    event.preventDefault();
    toggleInventory();
    return;
  }
  if (state.menuOpen || state.inventoryOpen) return;
  if (event.code === "KeyH") {
    hud.classList.toggle("hidden");
    debugPanel.classList.toggle("hidden");
    return;
  }
  if (state.characterId && isGameplayKey(event.code)) {
    event.preventDefault();
    state.pressed.add(event.code);
  }
});
window.addEventListener("keyup", (event) => {
  state.pressed.delete(event.code);
  if (state.menuOpen || state.inventoryOpen) return;
  if (isTypingTarget(event.target)) return;
});
window.addEventListener("blur", releaseGameplayInput);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    releaseGameplayInput();
  } else {
    void syncRuntimeResources(true);
  }
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
    const combat = getCombatStats(character.stats);
    const wrapper = document.createElement("div");
    wrapper.className = "character-entry";

    const preview = document.createElement("canvas");
    preview.width = 96;
    preview.height = 128;
    preview.className = "character-card-canvas";
    const previewCtx = preview.getContext("2d", { alpha: true })!;
    previewCtx.imageSmoothingEnabled = false;
    renderAvatarSkeleton(previewCtx, { x: 48, y: 104 }, character, "front", true, IDLE_LIMB_STATE);

    const meta = document.createElement("div");
    meta.className = "character-meta";
    meta.innerHTML = `
      <div class="character-title-row">
        <strong>${escapeHtml(character.name)}</strong>
        <span class="power-chip">战力 ${formatInteger(combat.powerScore)}</span>
      </div>
      <span>${escapeHtml(character.id)} · Lv.${character.stats.level ?? 1} · 版本 ${character.version}</span>
      ${renderMiniResourceBars(combat)}
      <div class="character-stat-strip">
        <span>物攻 ${formatInteger(combat.physicalAttack)}</span>
        <span>法攻 ${formatInteger(combat.magicAttack)}</span>
        <span>护甲 ${formatInteger(combat.physicalDefense + combat.magicDefense)}</span>
        <span>移速 ${formatFlat(combat.moveSpeed)}</span>
      </div>
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
      requestLandscapeOrientation();
      void enterWorldWithCharacter(character);
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "secondary";
    deleteButton.textContent = "删除角色";
    deleteButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (!state.api || !state.token) return;
      const firstConfirmed = window.confirm(`确定要删除角色「${character.name}」吗？删除后会进入待清除列表。`);
      if (!firstConfirmed) return;
      const secondConfirmed = window.confirm(`再次确认：将删除角色「${character.name}」。如果待清除角色数量已满，最早删除的角色会被永久清除。`);
      if (!secondConfirmed) return;
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

function getAvatarLayerRaster(rows: string[] | undefined, swatches: string[]): HTMLCanvasElement | null {
  if (!rows || rows.length === 0) return null;
  const cacheKey = `${swatches.join(",")}::${rows.join("|")}`;
  const cached = avatarLayerRasterCache.get(cacheKey);
  if (cached) return cached;

  const raster = document.createElement("canvas");
  raster.width = AVATAR_EDITOR_WIDTH;
  raster.height = AVATAR_EDITOR_HEIGHT;
  const rasterCtx = raster.getContext("2d", { alpha: true })!;
  rasterCtx.imageSmoothingEnabled = false;
  rasterCtx.clearRect(0, 0, raster.width, raster.height);

  rows.slice(0, AVATAR_EDITOR_HEIGHT).forEach((row, y) => {
    [...row.slice(0, AVATAR_EDITOR_WIDTH)].forEach((ch, x) => {
      if (ch === EMPTY_PIXEL_SYMBOL) return;
      rasterCtx.fillStyle = pixelSymbolToColor(ch, swatches);
      rasterCtx.fillRect(x, y, 1, 1);
    });
  });

  avatarLayerRasterCache.set(cacheKey, raster);
  if (avatarLayerRasterCache.size > AVATAR_LAYER_CACHE_LIMIT) {
    const oldest = avatarLayerRasterCache.keys().next().value;
    if (oldest) avatarLayerRasterCache.delete(oldest);
  }
  return raster;
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
    <div class="custom-color-panel">
      <label class="appearance-field">
        <span>自定义颜色</span>
        <input type="color" id="customPaintColorInput" value="${state.paintColor}">
      </label>
      <button type="button" class="secondary" id="applyCustomPaintColor">使用自定义颜色</button>
    </div>
    <div class="recent-color-panel">
      <span>历史使用颜色</span>
      <div class="recent-colors">
        ${state.recentPaintColors.slice(0, 20).map((color) => `<button type="button" class="color-swatch" data-color="${color}" style="background:${color}" aria-label="${color}"></button>`).join("")}
      </div>
    </div>
  `;

  const applyColor = (color: string) => {
    state.paintColor = color;
    applyPaintColorToPalette(color);
    pushRecentPaintColor(color);
    renderPaletteControls((state.appearanceDraft ?? defaultAppearance()).palette);
    renderPixelTools();
    renderPixelEditorGrid(getActiveLayerRows());
  };

  appearancePalette.querySelector<HTMLInputElement>("#paintColorInput")?.addEventListener("input", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    applyColor(input.value);
  });

  appearancePalette.querySelector<HTMLButtonElement>("#applyCustomPaintColor")?.addEventListener("click", () => {
    const input = appearancePalette.querySelector<HTMLInputElement>("#customPaintColorInput");
    applyColor(input?.value ?? state.paintColor);
  });

  for (const button of appearancePalette.querySelectorAll<HTMLButtonElement>("[data-color]")) {
    button.addEventListener("click", () => {
      applyColor(button.dataset.color ?? state.paintColor);
    });
  }
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
    <button type="button" class="secondary ${state.paintMode === "picker" ? "active" : ""}" data-paint-mode="picker" aria-pressed="${state.paintMode === "picker"}">取色器</button>
    <button type="button" class="secondary" data-tool="clear">清空</button>
    <button type="button" class="secondary" data-tool="export-skin">导出皮肤</button>
    <button type="button" class="secondary" data-tool="import">导入</button>
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
  if (state.paintMode === "picker") return false;
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
    if (state.paintMode === "picker") {
      pickColorAt(matrix, x, y);
      return;
    }
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

function pickColorAt(matrix: string[][], x: number, y: number): void {
  if (!state.appearanceDraft) return;
  const symbol = matrix[y]?.[x] ?? EMPTY_PIXEL_SYMBOL;
  if (symbol === EMPTY_PIXEL_SYMBOL) return;
  const color = pixelSymbolToColor(symbol, state.appearanceDraft.palette.pixelSwatches);
  if (color === "transparent") return;
  state.paintColor = normalizeHexColor(color, state.paintColor);
  pushRecentPaintColor(state.paintColor);
  renderPaletteControls(state.appearanceDraft.palette);
  renderPixelTools();
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
    case "export-skin":
      exportSkinPackage();
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
  const parts = getAvatarPartRects(body, facing, "edit");
  for (const rect of parts.static) fillOutlineRect(matrix, rect.x, rect.y, rect.width, rect.height);
  for (const limb of parts.limbs) {
    for (const part of limb.parts) fillOutlineRect(matrix, part.source.x, part.source.y, part.source.width, part.source.height);
  }
  return matrix;
}

function getAvatarPartRects(body: CharacterBodyAppearance, facing: Facing, mode: "edit" | "render"): { static: AvatarLayerRect[]; limbs: AvatarLimbSegment[] } {
  const side = facing === "left" || facing === "right";
  const centerX = Math.floor(AVATAR_EDITOR_WIDTH / 2);
  const totalHeight = clamp(body.height, 42, 58);
  const top = AVATAR_EDITOR_HEIGHT - totalHeight;
  const headH = clamp(Math.round(9 * body.headScale / 100), 7, 13);
  const headW = side ? body.headSideWidth : body.headWidth;
  const torsoH = clamp(body.torsoHeight, 14, 26);
  const shoulderW = side ? clamp(body.sideWidth, 10, 16) : clamp(body.frontShoulderWidth, 22, 28);
  const chestW = side ? body.chestDepth : body.chestWidth;
  const waistW = side ? body.waistDepth : body.waistWidth;
  const hipW = side ? body.hipDepth : body.hipWidth;
  const armW = clamp(side ? body.upperArmSideWidth : body.upperArmWidth, 2, 8);
  const forearmW = clamp(side ? body.forearmSideWidth : body.forearmWidth, 2, 8);
  const legW = clamp(side ? body.thighSideWidth : body.thighWidth, 2, 9);
  const calfW = clamp(side ? body.calfSideWidth : body.calfWidth, 2, 8);
  const thighH = clamp(body.thighLength, 7, 20);
  const calfH = clamp(body.calfLength, 6, 19);
  const upperArmH = clamp(body.upperArmLength, 6, 18);
  const forearmH = clamp(body.forearmLength, 5, 17);
  const staticParts: AvatarLayerRect[] = [
    { x: centerX - Math.floor(headW / 2), y: top, width: headW, height: headH },
  ];
  const limbs: AvatarLimbSegment[] = [];
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
  staticParts.push(
    { x: torsoX(shoulderW, "shoulder"), y: torsoTop, width: shoulderW, height: Math.max(2, Math.round(torsoH * 0.2)) },
    { x: torsoX(chestW, "chest"), y: torsoTop + Math.round(torsoH * 0.2), width: chestW, height: Math.max(3, Math.round(torsoH * 0.35)) },
    { x: torsoX(waistW, "waist"), y: torsoTop + Math.round(torsoH * 0.55), width: waistW, height: Math.max(2, Math.round(torsoH * 0.2)) },
    { x: torsoX(hipW, "hip"), y: torsoTop + Math.round(torsoH * 0.75), width: hipW, height: Math.max(3, Math.round(torsoH * 0.25)) },
  );
  const makeLimb = (
    poseKey: keyof LimbMotionState,
    anchor: { x: number; y: number },
    parts: AvatarLimbPart[],
    depth: AvatarLimbSegment["depth"] = "front",
    alpha = 1,
  ): AvatarLimbSegment => ({ poseKey, anchor, parts, depth, alpha });

  const limbTop = torsoTop + 3;
  if (side) {
    const frontSign = facing === "left" ? 1 : -1;
    const armGap = 3;
    const editArmX = frontSign > 0
      ? centerX + Math.floor(shoulderW / 2) + armGap
      : centerX - Math.floor(shoulderW / 2) - armGap - armW;
    const editForearmX = frontSign > 0
      ? centerX + Math.floor(shoulderW / 2) + armGap
      : centerX - Math.floor(shoulderW / 2) - armGap - forearmW;
    const renderArmX = frontSign > 0
      ? centerX + Math.floor(shoulderW * 0.18)
      : centerX - Math.floor(shoulderW * 0.18) - armW;
    const renderForearmX = frontSign > 0
      ? centerX + Math.floor(shoulderW * 0.18)
      : centerX - Math.floor(shoulderW * 0.18) - forearmW;
    const armX = mode === "edit" ? editArmX : renderArmX;
    const forearmX = mode === "edit" ? editForearmX : renderForearmX;
    const sideArmParts = (targetOffsetX: number): AvatarLimbPart[] => [
      {
        source: { x: editArmX, y: limbTop, width: armW, height: upperArmH },
        target: { x: armX + targetOffsetX, y: limbTop, width: armW, height: upperArmH },
      },
      {
        source: { x: editForearmX, y: limbTop + upperArmH, width: forearmW, height: forearmH },
        target: { x: forearmX + targetOffsetX, y: limbTop + upperArmH, width: forearmW, height: forearmH },
      },
    ];
    const sideLegParts = (targetOffsetX: number): AvatarLimbPart[] => [
      {
        source: { x: centerX - Math.floor(legW / 2), y: torsoTop + torsoH, width: legW, height: thighH },
        target: { x: centerX - Math.floor(legW / 2) + targetOffsetX, y: torsoTop + torsoH, width: legW, height: thighH },
      },
      {
        source: { x: centerX - Math.floor(calfW / 2), y: torsoTop + torsoH + thighH, width: calfW, height: calfH },
        target: { x: centerX - Math.floor(calfW / 2) + targetOffsetX, y: torsoTop + torsoH + thighH, width: calfW, height: calfH },
      },
    ];
    if (mode === "edit") {
      limbs.push(
        makeLimb("rightArm", { x: armX + armW / 2, y: limbTop }, sideArmParts(0)),
        makeLimb("rightLeg", { x: centerX, y: torsoTop + torsoH }, sideLegParts(0)),
      );
    } else {
      const farOffset = facing === "left" ? -1 : 1;
      const nearOffset = facing === "left" ? 1 : -1;
      limbs.push(
        makeLimb("leftArm", { x: armX + farOffset + armW / 2, y: limbTop }, sideArmParts(farOffset), "behind", 0.72),
        makeLimb("leftLeg", { x: centerX + farOffset, y: torsoTop + torsoH }, sideLegParts(farOffset), "behind", 0.72),
        makeLimb("rightLeg", { x: centerX + nearOffset, y: torsoTop + torsoH }, sideLegParts(nearOffset), "front", 1),
        makeLimb("rightArm", { x: armX + nearOffset + armW / 2, y: limbTop }, sideArmParts(nearOffset), "front", 1),
      );
    }
  } else {
    const rightArmX = centerX + Math.floor(shoulderW / 2);
    const rightLegX = centerX + 1;
    limbs.push(
      makeLimb(
        "leftArm",
        { x: centerX - Math.floor(shoulderW / 2) - armW / 2, y: limbTop },
        [
          {
            source: { x: centerX - Math.floor(shoulderW / 2) - armW, y: limbTop, width: armW, height: upperArmH },
            target: { x: centerX - Math.floor(shoulderW / 2) - armW, y: limbTop, width: armW, height: upperArmH },
          },
          {
            source: { x: centerX - Math.floor(shoulderW / 2) - forearmW, y: limbTop + upperArmH, width: forearmW, height: forearmH },
            target: { x: centerX - Math.floor(shoulderW / 2) - forearmW, y: limbTop + upperArmH, width: forearmW, height: forearmH },
          },
        ],
      ),
      makeLimb(
        "rightArm",
        { x: rightArmX + armW / 2, y: limbTop },
        [
          {
            source: { x: centerX + Math.floor(shoulderW / 2), y: limbTop, width: armW, height: upperArmH },
            target: { x: centerX + Math.floor(shoulderW / 2), y: limbTop, width: armW, height: upperArmH },
          },
          {
            source: { x: centerX + Math.floor(shoulderW / 2), y: limbTop + upperArmH, width: forearmW, height: forearmH },
            target: { x: centerX + Math.floor(shoulderW / 2), y: limbTop + upperArmH, width: forearmW, height: forearmH },
          },
        ],
      ),
      makeLimb(
        "leftLeg",
        { x: centerX - legW / 2 - 1, y: torsoTop + torsoH },
        [
          {
            source: { x: centerX - legW - 1, y: torsoTop + torsoH, width: legW, height: thighH },
            target: { x: centerX - legW - 1, y: torsoTop + torsoH, width: legW, height: thighH },
          },
          {
            source: { x: centerX - calfW - 1, y: torsoTop + torsoH + thighH, width: calfW, height: calfH },
            target: { x: centerX - calfW - 1, y: torsoTop + torsoH + thighH, width: calfW, height: calfH },
          },
        ],
      ),
      makeLimb(
        "rightLeg",
        { x: rightLegX + legW / 2, y: torsoTop + torsoH },
        [
          {
            source: { x: centerX + 1, y: torsoTop + torsoH, width: legW, height: thighH },
            target: { x: centerX + 1, y: torsoTop + torsoH, width: legW, height: thighH },
          },
          {
            source: { x: centerX + 1, y: torsoTop + torsoH + thighH, width: calfW, height: calfH },
            target: { x: centerX + 1, y: torsoTop + torsoH + thighH, width: calfW, height: calfH },
          },
        ],
      ),
    );
  }
  return { static: staticParts, limbs };
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
      const parsed = JSON.parse(raw) as Partial<CharacterAppearance> | Partial<SkinExportPackage>;
      const appearance = "appearance" in parsed && parsed.appearance ? parsed.appearance : parsed;
      state.appearanceDraft = normalizeAppearance(appearance as Partial<CharacterAppearance>);
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

function exportSkinPackage(): void {
  if (!state.appearanceDraft) return;
  const appearance = normalizeAppearance(state.appearanceDraft);
  const skinPackage: SkinExportPackage = {
    format: "nbld.skin",
    version: 1,
    exportedAt: new Date().toISOString(),
    appearance,
    layers: {
      skeleton: appearance.skeleton,
      hair: appearance.hair,
    },
    textures: {
      skeleton: Object.fromEntries(
        Object.entries(appearance.skeleton).map(([key, rows]) => [key, layerRowsToPngDataUrl(rows, appearance.palette.pixelSwatches)]),
      ) as SkinExportPackage["textures"]["skeleton"],
      hair: Object.fromEntries(
        Object.entries(appearance.hair).map(([key, rows]) => [key, layerRowsToPngDataUrl(rows, appearance.palette.pixelSwatches)]),
      ) as SkinExportPackage["textures"]["hair"],
    },
  };
  downloadTextFile(
    `${state.characterName || characterNameInput.value.trim() || "skin"}.nbld-skin.json`,
    JSON.stringify(skinPackage, null, 2),
    "application/json",
  );
  loginError.textContent = "皮肤包已导出，包含所有骨骼层、发层贴图和配置";
}

function layerRowsToPngDataUrl(rows: string[] | undefined, swatches: string[]): string {
  const matrix = rowsToMatrix(rows ?? [], AVATAR_EDITOR_WIDTH, AVATAR_EDITOR_HEIGHT);
  const output = document.createElement("canvas");
  output.width = AVATAR_EDITOR_WIDTH;
  output.height = AVATAR_EDITOR_HEIGHT;
  const outputCtx = output.getContext("2d")!;
  outputCtx.clearRect(0, 0, output.width, output.height);
  matrix.forEach((row, y) => {
    row.forEach((symbol, x) => {
      if (symbol === EMPTY_PIXEL_SYMBOL) return;
      outputCtx.fillStyle = pixelSymbolToColor(symbol, swatches);
      outputCtx.fillRect(x, y, 1, 1);
    });
  });
  return output.toDataURL("image/png");
}

function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const link = document.createElement("a");
  link.download = filename;
  link.href = URL.createObjectURL(new Blob([content], { type: mimeType }));
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
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
    state.playerVisual = { ...entered.position };
    state.camera = { ...entered.position };
    applyRuntimeResources(entered.resources, getCombatStats(character.stats), entered.sprinting);
    state.players.clear();
    state.chunks.clear();
    state.pendingChunkRenders = [];
    state.deferredChunkRenders = [];
    state.currentTile = undefined;
    state.lastChunkKey = "";
    state.lastChunkWindowKey = "";
    state.lastResourceSyncAt = performance.now();
    state.resourceSyncInFlight = false;
    state.status = "已连接";
    state.lastError = "";
    persistSession();

    await refreshChunks(true);
    connectWebSocket(state.api);

    loginModal.classList.add("hidden");
    registerModal.classList.add("hidden");
    characterModal.classList.add("hidden");
    appearanceModal.classList.add("hidden");
    toggleInventory(false);
    hud.classList.remove("hidden");
    staminaHud.classList.remove("hidden");
    debugPanel.classList.remove("hidden");
    helpPanel.classList.remove("hidden");
    resizeCanvas();
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
  state.runtimeResources = {};
  state.currentStamina = 100;
  state.wantsSprint = false;
  state.sprinting = false;
  state.players.clear();
  state.chunks.clear();
  state.pendingChunkRenders = [];
  state.deferredChunkRenders = [];
  state.availableCharacters = [];
  state.selectedCharacterId = "";
  state.status = "未连接";
  state.socketStatus = "未连接";
  state.lastError = "";
  state.currentTile = undefined;
  state.lastChunkKey = "";
  state.lastChunkWindowKey = "";
  state.lastResourceSyncAt = 0;
  state.resourceSyncInFlight = false;

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
  staminaHud.classList.add("hidden");
  debugPanel.classList.add("hidden");
  helpPanel.classList.add("hidden");
  orientationOverlay.classList.add("hidden");
  loginError.textContent = "";
  pauseMenu.classList.add("hidden");
  inventoryModal.classList.add("hidden");
  state.menuOpen = false;
  state.inventoryOpen = false;
}

type PauseSection = "settings" | "profile" | "events";

function togglePauseMenu(): void {
  state.menuOpen = !state.menuOpen;
  pauseMenu.classList.toggle("hidden", !state.menuOpen);
  if (state.menuOpen) {
    toggleInventory(false);
    renderPauseMenu("settings");
  }
}

function toggleInventory(open = !state.inventoryOpen): void {
  state.inventoryOpen = open;
  inventoryModal.classList.toggle("hidden", !open);
  if (!open) return;
  state.menuOpen = false;
  pauseMenu.classList.add("hidden");
  renderInventoryModal();
}

function renderInventoryModal(): void {
  const character = currentPlayerCharacter();
  const combat = withRuntimeResources(getCombatStats(character?.stats));
  inventoryModal.innerHTML = `
    <div class="inventory-frame">
      <div class="inventory-titlebar">
        <div>
          <p class="eyebrow">Inventory</p>
          <h2>${escapeHtml(character?.name || state.characterName || "角色")}</h2>
        </div>
        <button type="button" class="inventory-close" data-inventory-close>关闭 B</button>
      </div>
      <div class="inventory-top">
        <section class="equipment-panel">
          <h3>穿戴</h3>
          ${renderEquipmentSlots(character)}
        </section>
        <section class="character-preview-panel">
          <div class="preview-stage">
            <canvas id="inventoryAvatarCanvas" width="120" height="150"></canvas>
          </div>
          <div class="preview-controls">
            <button type="button" data-preview-rotate="-1">左转</button>
            <span>${facingLabel(state.inventoryFacing)}</span>
            <button type="button" data-preview-rotate="1">右转</button>
          </div>
        </section>
        <section class="inventory-stats-panel">
          <h3>全部属性</h3>
          ${renderFullInventoryStats(character, combat)}
        </section>
      </div>
      <div class="inventory-bottom">
        <div class="inventory-section-header">
          <h3>背包储物区</h3>
          <span>54 格 · 3 行 x 18 列</span>
        </div>
        <div class="bag-grid">
          ${renderBagSlots(character)}
        </div>
        <div class="inventory-section-header hotbar-header">
          <h3>快捷物品栏同步</h3>
          <span>按 B 关闭</span>
        </div>
        ${renderHotbar(character, true)}
      </div>
    </div>
  `;

  inventoryModal.querySelector<HTMLButtonElement>("[data-inventory-close]")?.addEventListener("click", () => toggleInventory(false));
  for (const button of inventoryModal.querySelectorAll<HTMLButtonElement>("[data-preview-rotate]")) {
    button.addEventListener("click", () => {
      rotateInventoryFacing(Number(button.dataset.previewRotate || 1));
      renderInventoryModal();
    });
  }
  renderInventoryAvatar(character);
}

function renderInventoryAvatar(character: CharacterSummary | undefined): void {
  const canvas = inventoryModal.querySelector<HTMLCanvasElement>("#inventoryAvatarCanvas");
  if (!canvas) return;
  const target = canvas.getContext("2d", { alpha: true });
  if (!target) return;
  target.imageSmoothingEnabled = false;
  target.clearRect(0, 0, canvas.width, canvas.height);
  target.save();
  target.translate(canvas.width / 2, canvas.height - 18);
  target.scale(10.5, 10.5);
  const previousScale = state.tileScale;
  state.tileScale = 6;
  renderAvatarSkeleton(target, { x: 0, y: 0 }, character, state.inventoryFacing, true, IDLE_LIMB_STATE);
  state.tileScale = previousScale;
  target.restore();
}

function rotateInventoryFacing(direction: number): void {
  const facings: Facing[] = ["front", "right", "back", "left"];
  const index = facings.indexOf(state.inventoryFacing);
  state.inventoryFacing = facings[(index + direction + facings.length) % facings.length];
}

function facingLabel(facing: Facing): string {
  switch (facing) {
    case "back":
      return "背面";
    case "left":
      return "左侧";
    case "right":
      return "右侧";
    case "front":
    default:
      return "正面";
  }
}

function renderPauseMenu(section: PauseSection): void {
  pauseNav.innerHTML = `
    <button type="button" class="${section === "settings" ? "active" : ""}" data-section="settings">设置</button>
    <button type="button" class="${section === "profile" ? "active" : ""}" data-section="profile">我的</button>
    <button type="button" class="${section === "events" ? "active" : ""}" data-section="events">活动</button>
    <button type="button" data-action="logout">退出游戏</button>
  `;

  if (section === "settings") {
    pauseContent.innerHTML = renderSettingsPanel();
  } else if (section === "profile") {
    pauseContent.innerHTML = renderProfilePanel();
  } else {
    pauseContent.innerHTML = `
      <h2>活动</h2>
      <p>当前没有接入活动数据。</p>
    `;
  }

  for (const button of pauseNav.querySelectorAll<HTMLButtonElement>("[data-section]")) {
    button.addEventListener("click", () => renderPauseMenu(button.dataset.section as PauseSection));
  }
  pauseNav.querySelector<HTMLButtonElement>("[data-action='logout']")?.addEventListener("click", () => {
    logoutToLogin();
  });

  bindSettingsPanelEvents();
}

function renderSettingsPanel(): string {
  return `
    <div class="settings-tabs">
      <button type="button" class="${state.settingsPage === "audio" ? "active" : ""}" data-settings-page="audio">声音设置</button>
      <button type="button" class="${state.settingsPage === "video" ? "active" : ""}" data-settings-page="video">画面设置</button>
      <button type="button" class="${state.settingsPage === "keys" ? "active" : ""}" data-settings-page="keys">按键绑定</button>
    </div>
    ${renderSettingsPage()}
  `;
}

function renderProfilePanel(): string {
  const character = currentPlayerCharacter();
  const stats = character?.stats;
  const combat = withRuntimeResources(getCombatStats(stats));
  const warnings = stats?.metadata?.warnings ?? [];
  return `
    <div class="profile-panel">
      <div class="profile-hero-card">
        <div>
          <p class="eyebrow">NBLD 角色档案</p>
          <h2>${escapeHtml(state.characterName || character?.name || "-")}</h2>
          <p>账号 ${escapeHtml(state.accountUsername || state.accountEmail || "-")} · 地图 ${escapeHtml(state.mapId || "-")}</p>
        </div>
        <div class="profile-power">
          <span>战力</span>
          <strong>${formatInteger(combat.powerScore)}</strong>
        </div>
      </div>
      <div class="profile-grid">
        <section class="profile-card resource-card">
          <h3>资源</h3>
          ${renderResourceBars(combat)}
        </section>
        <section class="profile-card">
          <h3>核心属性</h3>
          <div class="stat-grid">
            ${CORE_STAT_CODES.map((code) => renderStatCell(code, combatAttributeValue(combat, code), false)).join("")}
          </div>
        </section>
        <section class="profile-card">
          <h3>战斗修正</h3>
          <div class="stat-grid">
            ${RATIO_STAT_CODES.map((code) => renderStatCell(code, combatAttributeValue(combat, code), true)).join("")}
          </div>
        </section>
        <section class="profile-card source-card">
          <h3>来源分层</h3>
          ${renderSourceBreakdown(stats)}
        </section>
      </div>
      ${warnings.length > 0 ? `<div class="profile-warning">${warnings.map(escapeHtml).join(" / ")}</div>` : ""}
    </div>
  `;
}

function renderSettingsPage(): string {
  if (state.settingsPage === "audio") {
    return `
      <div class="settings-group">
        <label>主音量 <input type="range" min="0" max="100" value="${state.audioSettings.masterVolume}" data-audio="masterVolume"></label>
        <label>音乐音量 <input type="range" min="0" max="100" value="${state.audioSettings.musicVolume}" data-audio="musicVolume"></label>
        <label>音效音量 <input type="range" min="0" max="100" value="${state.audioSettings.sfxVolume}" data-audio="sfxVolume"></label>
      </div>
    `;
  }
  if (state.settingsPage === "video") {
    return `
      <div class="settings-group">
        <label>区块渲染预算 <input type="range" min="1" max="4" value="${state.videoSettings.chunkRenderBudget}" data-video="chunkRenderBudget"></label>
        <label><input type="checkbox" ${state.videoSettings.showDebug ? "checked" : ""} data-video-toggle="showDebug"> 显示调试面板</label>
        <label><input type="checkbox" ${state.videoSettings.showHelp ? "checked" : ""} data-video-toggle="showHelp"> 显示帮助</label>
      </div>
    `;
  }
  return `
    <div class="settings-group keybind-grid">
      ${Object.entries(state.keyBindings).map(([action, code]) => `
        <button type="button" data-bind-key="${action}">${escapeHtml(action)}: ${escapeHtml(code)}</button>
      `).join("")}
      <p>${state.awaitingKeyBinding ? `按下按键绑定 ${escapeHtml(state.awaitingKeyBinding)}` : "点击按钮后按下新按键"}</p>
    </div>
  `;
}

function bindSettingsPanelEvents(): void {
  for (const button of pauseContent.querySelectorAll<HTMLButtonElement>("[data-settings-page]")) {
    button.addEventListener("click", () => {
      state.settingsPage = button.dataset.settingsPage as AppState["settingsPage"];
      renderPauseMenu("settings");
    });
  }
  for (const input of pauseContent.querySelectorAll<HTMLInputElement>("[data-audio]")) {
    input.addEventListener("input", () => {
      const key = input.dataset.audio as keyof AppState["audioSettings"];
      state.audioSettings[key] = Number(input.value);
    });
  }
  for (const input of pauseContent.querySelectorAll<HTMLInputElement>("[data-video]")) {
    input.addEventListener("input", () => {
      const key = input.dataset.video as keyof AppState["videoSettings"];
      const value = Number(input.value);
      state.videoSettings[key] = value as never;
    });
  }
  for (const input of pauseContent.querySelectorAll<HTMLInputElement>("[data-video-toggle]")) {
    input.addEventListener("change", () => {
      const key = input.dataset.videoToggle as "showDebug" | "showHelp";
      state.videoSettings[key] = input.checked;
      debugPanel.classList.toggle("hidden", !state.videoSettings.showDebug);
      helpPanel.classList.toggle("hidden", !state.videoSettings.showHelp);
    });
  }
  for (const button of pauseContent.querySelectorAll<HTMLButtonElement>("[data-bind-key]")) {
    button.addEventListener("click", () => {
      state.awaitingKeyBinding = button.dataset.bindKey as keyof AppState["keyBindings"];
      renderPauseMenu("settings");
    });
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
    applyRuntimeResources(message.resources, getCombatStats(currentPlayerCharacter()?.stats), message.sprinting);
    // Peer roster now arrives via the first world_snapshot (entered[]),
    // so we just clear any stale remote state and wait for the tick.
    state.players.clear();
    state.remoteVisuals.clear();
    state.remoteFacing.clear();
    return;
  }

  if (message.type === "world_snapshot") {
    handleWorldSnapshot(message);
    return;
  }

  if (message.type === "map_transition" && message.playerId === state.playerId && message.position) {
    state.mapId = message.mapId || state.mapId;
    applyRuntimeResources(message.resources, getCombatStats(currentPlayerCharacter()?.stats), message.sprinting);
    state.player = { ...message.position };
    state.playerVisual = { ...message.position };
    state.camera = { ...message.position };
    state.chunks.clear();
    state.pendingChunkRenders = [];
    state.deferredChunkRenders = [];
    state.lastChunkKey = "";
    void refreshChunks(true);
    return;
  }

  if (message.type === "error") {
    state.lastError = message.error || "websocket error";
  }
}

function applySlimPlayer(slim: SlimPlayerState): void {
  const previous = state.players.get(slim.playerId);
  // Merge over previous so appearance/equipment (only sent on "entered") are
  // preserved across slim move deltas. Far-tier deltas omit facing/sprinting;
  // keep the prior value in that case.
  const player: WorldPlayer = {
    ...(previous ?? { playerId: slim.playerId }),
    playerId: slim.playerId,
    mapId: slim.mapId ?? previous?.mapId,
    position: slim.position,
    facing: slim.facing || previous?.facing,
    sprinting: slim.sprinting ?? previous?.sprinting,
  };
  if (previous) {
    // Server-authoritative facing when provided; otherwise derive from motion.
    const facing = slim.facing
      ? (slim.facing as Facing)
      : facingFromVector(
          slim.position.x - previous.position.x,
          slim.position.y - previous.position.y,
          state.remoteFacing.get(slim.playerId) ?? "front",
        );
    state.remoteFacing.set(slim.playerId, facing);
  }
  state.players.set(slim.playerId, player);
  if (!state.remoteVisuals.has(slim.playerId)) {
    state.remoteVisuals.set(slim.playerId, { ...slim.position });
  }
}

function handleWorldSnapshot(message: WSServerMessage): void {
  // Self: keep the local stamina/sprint bar fresh while moving (the HTTP
  // resource sync is skipped during sustained movement). Position is advisory
  // — the client keeps predicting its own, matching prior behavior.
  if (message.self) {
    state.mapId = message.self.mapId || state.mapId;
    applyRuntimeResources(
      { ...state.runtimeResources, staminaCurrent: message.self.staminaCurrent },
      getCombatStats(currentPlayerCharacter()?.stats),
      message.self.sprinting,
    );
  }

  if (message.entered) {
    for (const player of message.entered) {
      state.players.set(player.playerId, player);
      state.remoteVisuals.set(player.playerId, { ...player.position });
      state.remoteFacing.set(player.playerId, (player.facing as Facing) || "front");
    }
  }

  if (message.moved) {
    for (const slim of message.moved) {
      if (slim.playerId === state.playerId) continue;
      applySlimPlayer(slim);
    }
  }

  if (message.left) {
    for (const playerId of message.left) {
      state.players.delete(playerId);
      state.remoteVisuals.delete(playerId);
      state.remoteFacing.delete(playerId);
    }
  }
}

let lastFrameAt = performance.now();
function loop(now: number): void {
  const deltaSeconds = Math.min(0.05, (now - lastFrameAt) / 1000);
  state.lastFrameMs = now - lastFrameAt;
  lastFrameAt = now;

  processPendingChunkRenders(state.videoSettings.chunkRenderBudget);
  updatePlayer(deltaSeconds, now);
  if (!isMovementPressed() && now - state.lastResourceSyncAt >= RESOURCE_SYNC_INTERVAL_MS) {
    void syncRuntimeResources();
    state.lastResourceSyncAt = now;
  }
  updatePlayerVisual(deltaSeconds);
  updateCamera(deltaSeconds);
  if (now - state.lastHudUpdateAt >= HUD_REFRESH_INTERVAL_MS) {
    updateHud();
    state.lastHudUpdateAt = now;
  }
  draw();

  requestAnimationFrame(loop);
}

function processPendingChunkRenders(limit: number): void {
  const startedAt = performance.now();
  let processed = 0;
  for (let index = 0; index < limit && state.pendingChunkRenders.length > 0; index += 1) {
    state.pendingChunkRenders.sort((left, right) => {
      const leftCenterX = left.snapshot.coord.chunkX * CHUNK_SIZE + CHUNK_SIZE / 2;
      const leftCenterY = left.snapshot.coord.chunkY * CHUNK_SIZE + CHUNK_SIZE / 2;
      const rightCenterX = right.snapshot.coord.chunkX * CHUNK_SIZE + CHUNK_SIZE / 2;
      const rightCenterY = right.snapshot.coord.chunkY * CHUNK_SIZE + CHUNK_SIZE / 2;
      const leftDistance = Math.hypot(leftCenterX - state.player.x, leftCenterY - state.player.y);
      const rightDistance = Math.hypot(rightCenterX - state.player.x, rightCenterY - state.player.y);
      return leftDistance - rightDistance;
    });
    const next = state.pendingChunkRenders.shift();
    if (!next) break;
    state.chunks.set(next.key, renderChunk(next.snapshot));
    processed += 1;
  }
  if (processed < limit && state.lastFrameMs < 14) {
    const nextDeferred = state.deferredChunkRenders.shift();
    if (nextDeferred) {
      state.chunks.set(nextDeferred.key, renderChunk(nextDeferred.snapshot));
      processed += 1;
    }
  }
  state.lastChunkRenderCount = processed;
  state.lastChunkRenderMs = processed > 0 ? performance.now() - startedAt : 0;
}

function updatePlayer(deltaSeconds: number, now: number): void {
  if (!state.token || !state.characterId) return;

  const combat = getCombatStats(currentPlayerCharacter()?.stats);
  const staminaMax = Math.max(1, combat.resources.staminaMax);
  state.currentStamina = clamp(state.currentStamina, 0, staminaMax);

  let dx = 0;
  let dy = 0;
  if (state.pressed.has(state.keyBindings.moveLeft) || state.pressed.has("ArrowLeft")) dx -= 1;
  if (state.pressed.has(state.keyBindings.moveRight) || state.pressed.has("ArrowRight")) dx += 1;
  if (state.pressed.has(state.keyBindings.moveUp) || state.pressed.has("ArrowUp")) dy += 1;
  if (state.pressed.has(state.keyBindings.moveDown) || state.pressed.has("ArrowDown")) dy -= 1;

  const moving = dx !== 0 || dy !== 0;
  const wantsSprint = isSprintPressed();
  state.wantsSprint = moving && wantsSprint && state.currentStamina > 0;
  predictRuntimeStamina(deltaSeconds, combat);

  if (moving) {
    const length = Math.hypot(dx, dy);
    const speed = getCurrentMoveSpeed(combat, state.wantsSprint);
    state.facing = facingFromVector(dx / length, dy / length, state.facing);
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
  const idleRefreshDue = !isMovementPressed() && now - state.lastChunkRefreshAt > IDLE_CHUNK_REFRESH_INTERVAL_MS;
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

function getCurrentMoveSpeed(combat: CharacterCombatStats, sprinting: boolean): number {
  const baseMoveSpeed = Math.max(0, combat.moveSpeed);
  return sprinting ? baseMoveSpeed * SPRINT_SPEED_MULTIPLIER : baseMoveSpeed;
}

function predictRuntimeStamina(deltaSeconds: number, combat: CharacterCombatStats): void {
  const staminaMax = Math.max(1, state.runtimeResources.staminaMax ?? combat.resources.staminaMax);
  state.currentStamina = clamp(state.currentStamina, 0, staminaMax);
  if (!state.wantsSprint) return;

  const drainPerSecond = Math.max(0, SPRINT_STAMINA_COST_PER_SECOND - STAMINA_REGEN_WHILE_RUNNING);
  const nextStamina = clamp(state.currentStamina - drainPerSecond * deltaSeconds, 0, staminaMax);
  state.currentStamina = nextStamina;
  state.runtimeResources = {
    ...state.runtimeResources,
    staminaMax,
    staminaCurrent: nextStamina,
  };
  state.sprinting = nextStamina > 0;
  if (nextStamina <= 0) {
    state.wantsSprint = false;
  }
}

function updatePlayerVisual(deltaSeconds: number): void {
  const stiffness = 1 - Math.pow(0.0001, deltaSeconds);
  state.playerVisual.x += (state.player.x - state.playerVisual.x) * stiffness;
  state.playerVisual.y += (state.player.y - state.playerVisual.y) * stiffness;

  for (const [playerId, player] of state.players) {
    if (playerId === state.playerId || player.mapId !== state.mapId) continue;
    const visual = state.remoteVisuals.get(playerId) ?? { ...player.position };
    visual.x += (player.position.x - visual.x) * stiffness;
    visual.y += (player.position.y - visual.y) * stiffness;
    state.remoteVisuals.set(playerId, visual);
  }
}

function facingFromVector(dx: number, dy: number, fallback: Facing): Facing {
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? "right" : "left";
  }
  if (Math.abs(dy) > 0) {
    return dy > 0 ? "back" : "front";
  }
  return fallback;
}

function sendMove(): void {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: "move", position: state.player, sprinting: state.wantsSprint, facing: state.facing }));
    return;
  }

  if (state.api) {
    void state.api.move(state.token, state.player.x, state.player.y, state.wantsSprint)
      .then((response) => applyRuntimeResources(response.resources, getCombatStats(currentPlayerCharacter()?.stats), response.sprinting))
      .catch((error) => {
        state.lastError = errorToString(error);
      });
  }
}

function releaseGameplayInput(): void {
  if (state.pressed.size === 0 && !state.wantsSprint) return;
  state.pressed.clear();
  if (state.wantsSprint) {
    state.wantsSprint = false;
    sendMove();
  }
}

async function syncRuntimeResources(force = false): Promise<void> {
  if (!state.api || !state.token || !state.characterId) return;
  if (state.resourceSyncInFlight) return;
  if (!force && isMovementPressed()) return;

  state.lastResourceSyncAt = performance.now();
  state.resourceSyncInFlight = true;
  try {
    const world = await state.api.worldState(state.token);
    state.mapId = world.mapId || state.mapId;
    if (world.position) {
      state.player = { ...world.position };
    }
    applyRuntimeResources(world.resources, getCombatStats(currentPlayerCharacter()?.stats), world.sprinting);
    if (world.players) {
      state.players.clear();
      for (const player of world.players) state.players.set(player.playerId, player);
    }
  } catch (error) {
    state.lastError = errorToString(error);
  } finally {
    state.resourceSyncInFlight = false;
  }
}

async function refreshChunks(force: boolean): Promise<void> {
  if (!state.api || !state.token) return;
  if (state.chunkRefreshInFlight) return;
  if (!force && state.status === "加载区块中") return;

  const previousStatus = state.status;
  state.chunkRefreshInFlight = true;
  state.status = "加载区块中";
  const startedAt = performance.now();
  try {
    const windowData = await state.api.chunks(state.token, state.player);
    applyChunkWindow(windowData);
    state.lastChunkRefreshCount = windowData.chunks.length;
    state.lastChunkRefreshMs = performance.now() - startedAt;
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
    const targetQueue = isChunkInVisibleWindow(chunk.coord) ? state.pendingChunkRenders : state.deferredChunkRenders;
    const otherQueue = targetQueue === state.pendingChunkRenders ? state.deferredChunkRenders : state.pendingChunkRenders;
    const otherIndex = otherQueue.findIndex((item) => item.key === key);
    if (otherIndex >= 0) otherQueue.splice(otherIndex, 1);
    const pendingIndex = targetQueue.findIndex((item) => item.key === key);
    if (pendingIndex >= 0) {
      targetQueue[pendingIndex] = { key, snapshot: chunk };
    } else {
      targetQueue.push({ key, snapshot: chunk });
    }
  }
  if (state.pendingChunkRenders.length > 48) {
    state.pendingChunkRenders = state.pendingChunkRenders.slice(-48);
  }
  if (state.deferredChunkRenders.length > 96) {
    state.deferredChunkRenders = state.deferredChunkRenders.slice(-96);
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

function isChunkInVisibleWindow(coord: ChunkCoord): boolean {
  if (coord.mapId !== state.mapId) return false;
  const minX = state.camera.x - TARGET_VISIBLE_TILES_X / 2;
  const maxX = state.camera.x + TARGET_VISIBLE_TILES_X / 2;
  const minY = state.camera.y - TARGET_VISIBLE_TILES_Y / 2;
  const maxY = state.camera.y + TARGET_VISIBLE_TILES_Y / 2;
  const chunkMinX = coord.chunkX * CHUNK_SIZE;
  const chunkMaxX = chunkMinX + CHUNK_SIZE;
  const chunkMinY = coord.chunkY * CHUNK_SIZE;
  const chunkMaxY = chunkMinY + CHUNK_SIZE;
  return chunkMaxX >= minX && chunkMinX <= maxX && chunkMaxY >= minY && chunkMinY <= maxY;
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
  state.camera.x += (state.playerVisual.x - state.camera.x) * stiffness;
  state.camera.y += (state.playerVisual.y - state.camera.y) * stiffness;
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
  const screen = worldToScreen(state.playerVisual.x, state.playerVisual.y);
  const character = state.availableCharacters.find((item) => item.id === state.characterId);
  renderAvatarSkeleton(ctx, screen, character, state.facing, true, getLimbMotionState(true));
}

function drawRemotePlayer(player: WorldPlayer): void {
  const visual = state.remoteVisuals.get(player.playerId) ?? player.position;
  const screen = worldToScreen(visual.x, visual.y);
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
  const facing = state.remoteFacing.get(player.playerId) ?? "front";
  renderAvatarSkeleton(ctx, screen, character, facing, false, getLimbMotionState(false));
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
  moveState: LimbMotionState,
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

  const renderedCustomSkin = drawAnimatedAvatarImageLayer(
    target,
    screen.x,
    imageTopY,
    skinLayer,
    body,
    facing,
    moveState,
    appearance.palette.pixelSwatches,
  );

  const armWidth = Math.max(3, body.upperArmWidth * 0.18 * scale);
  const armLength = Math.max(10, (body.upperArmLength + body.forearmLength) * 0.12 * scale);
  const legWidth = Math.max(4, body.thighWidth * 0.18 * scale);
  if (!renderedCustomSkin) {
    if (side) {
      const farArmOffset = facing === "left" ? -armWidth * 0.45 : armWidth * 0.45;
      const nearArmOffset = facing === "left" ? armWidth * 0.45 : -armWidth * 0.45;
      const farLegOffset = facing === "left" ? -legWidth * 0.45 : legWidth * 0.45;
      const nearLegOffset = facing === "left" ? legWidth * 0.45 : -legWidth * 0.45;
      const sideArmX = screen.x + (facing === "left" ? shoulder * 0.18 : -shoulder * 0.18);
      drawLimb(target, sideArmX + farArmOffset, topY + headHeight + 4, armLength, armWidth, moveState.leftArm, palette.skinShadow, palette.skinShadow, 0.72);
      drawLimb(target, screen.x + farLegOffset, topY + headHeight + torsoHeight, legHeight, legWidth, moveState.leftLeg, palette.metalShadow, palette.metalShadow, 0.72);
      drawHeadLayer(target, screen.x, topY, headWidth, headHeight, palette.skinPrimary, palette.skinShadow);
      drawTorsoLayer(target, screen.x, topY + headHeight, shoulder, chest, waist, hip, torsoHeight, palette.clothPrimary, palette.clothShadow, palette.metalPrimary, [], scale);
      drawLimb(target, screen.x + nearLegOffset, topY + headHeight + torsoHeight, legHeight, legWidth, moveState.rightLeg, palette.clothShadow, palette.metalShadow);
      drawLimb(target, sideArmX + nearArmOffset, topY + headHeight + 4, armLength, armWidth, moveState.rightArm, palette.skinPrimary, palette.skinShadow);
    } else {
      drawHeadLayer(target, screen.x, topY, headWidth, headHeight, palette.skinPrimary, palette.skinShadow);
      drawTorsoLayer(target, screen.x, topY + headHeight, shoulder, chest, waist, hip, torsoHeight, palette.clothPrimary, palette.clothShadow, palette.metalPrimary, [], scale);
      drawLimb(target, screen.x - shoulder / 2, topY + headHeight + 4, armLength, armWidth, moveState.leftArm, palette.skinPrimary, palette.skinShadow);
      drawLimb(target, screen.x + shoulder / 2, topY + headHeight + 4, armLength, armWidth, moveState.rightArm, palette.skinPrimary, palette.skinShadow);
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

function drawAvatarImageLayer(target: CanvasRenderingContext2D, centerX: number, topY: number, rows: string[] | undefined, swatches: string[], fallbackFill: string, _stroke: string): void {
  if (!rows || rows.length === 0) return;
  const raster = getAvatarLayerRaster(rows, swatches);
  if (!raster) return;
  const pixel = state.tileScale / TILE_TEXTURE_SIZE_PX;
  const width = AVATAR_EDITOR_WIDTH * pixel;
  const height = AVATAR_EDITOR_HEIGHT * pixel;
  const startX = centerX - width / 2;
  target.imageSmoothingEnabled = false;
  target.drawImage(raster, startX, topY, width, height);
}

function drawAnimatedAvatarImageLayer(
  target: CanvasRenderingContext2D,
  centerX: number,
  topY: number,
  rows: string[] | undefined,
  body: CharacterBodyAppearance,
  facing: Facing,
  moveState: LimbMotionState,
  swatches: string[],
): boolean {
  if (!rows || rows.length === 0) return false;
  const pixel = state.tileScale / TILE_TEXTURE_SIZE_PX;
  const startX = centerX - (AVATAR_EDITOR_WIDTH * pixel) / 2;
  const matrix = rowsToMatrix(rows, AVATAR_EDITOR_WIDTH, AVATAR_EDITOR_HEIGHT);
  const parts = getAvatarPartRects(body, facing, "render");

  for (const limb of parts.limbs) {
    for (const part of limb.parts) clearMatrixRect(matrix, part.source);
  }

  target.imageSmoothingEnabled = false;
  for (const limb of parts.limbs.filter((item) => item.depth === "behind")) {
    drawAvatarLimbPixels(target, rows, limb, startX, topY, pixel, moveState[limb.poseKey], swatches);
  }
  drawAvatarMatrixPixels(target, matrix, startX, topY, pixel, swatches);
  for (const limb of parts.limbs.filter((item) => item.depth === "front")) {
    drawAvatarLimbPixels(target, rows, limb, startX, topY, pixel, moveState[limb.poseKey], swatches);
  }

  return true;
}

function clearMatrixRect(matrix: string[][], rect: AvatarLayerRect): void {
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const row = matrix[rect.y + y];
      if (!row || row[rect.x + x] === undefined) continue;
      row[rect.x + x] = EMPTY_PIXEL_SYMBOL;
    }
  }
}

function drawAvatarMatrixPixels(target: CanvasRenderingContext2D, matrix: string[][], startX: number, topY: number, pixel: number, swatches: string[]): void {
  for (let y = 0; y < AVATAR_EDITOR_HEIGHT; y += 1) {
    for (let x = 0; x < AVATAR_EDITOR_WIDTH; x += 1) {
      const symbol = matrix[y]?.[x] ?? EMPTY_PIXEL_SYMBOL;
      if (symbol === EMPTY_PIXEL_SYMBOL) continue;
      target.fillStyle = pixelSymbolToColor(symbol, swatches);
      target.fillRect(startX + x * pixel, topY + y * pixel, pixel, pixel);
    }
  }
}

function drawAvatarLimbPixels(
  target: CanvasRenderingContext2D,
  rows: string[],
  limb: AvatarLimbSegment,
  startX: number,
  topY: number,
  pixel: number,
  pose: LimbPose,
  swatches: string[],
): void {
  const matrix = rowsToMatrix(rows, AVATAR_EDITOR_WIDTH, AVATAR_EDITOR_HEIGHT);
  const angleDegrees = pose === "disabled" ? 0 : normalizeLimbAngle(pose);
  const anchorX = startX + limb.anchor.x * pixel;
  const anchorY = topY + limb.anchor.y * pixel;
  target.save();
  target.globalAlpha *= limb.alpha;
  target.translate(anchorX, anchorY);
  target.rotate((angleDegrees * Math.PI) / 180);

  for (const part of limb.parts) {
    for (let y = 0; y < part.source.height; y += 1) {
      for (let x = 0; x < part.source.width; x += 1) {
        const symbol = matrix[part.source.y + y]?.[part.source.x + x] ?? EMPTY_PIXEL_SYMBOL;
        if (symbol === EMPTY_PIXEL_SYMBOL) continue;
        target.fillStyle = pixelSymbolToColor(symbol, swatches);
        const drawX = (part.target.x + x - limb.anchor.x) * pixel;
        const drawY = (part.target.y + y - limb.anchor.y) * pixel;
        target.fillRect(drawX, drawY, pixel, pixel);
      }
    }
  }

  target.restore();
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

function drawLimb(target: CanvasRenderingContext2D, anchorX: number, anchorY: number, length: number, width: number, pose: LimbPose, fill: string, stroke: string, alpha = 1): void {
  const angleDegrees = pose === "disabled" ? 0 : normalizeLimbAngle(pose);
  target.save();
  target.globalAlpha *= alpha;
  target.translate(anchorX, anchorY);
  target.rotate((angleDegrees * Math.PI) / 180);
  drawPixelRect(target, -width / 2, 0, width, length, fill, stroke);
  target.restore();
}

function normalizeLimbAngle(angle: Exclude<LimbPose, "disabled">): -90 | -45 | 0 | 45 | 90 {
  if (angle <= -67.5) return -90;
  if (angle < -22.5) return -45;
  if (angle < 22.5) return 0;
  if (angle < 67.5) return 45;
  return 90;
}

function applyLimbDisableMode(state: LimbMotionState, mode: LimbDisableMode): LimbMotionState {
  if (mode === "arms") return { ...state, leftArm: "disabled", rightArm: "disabled" };
  if (mode === "legs") return { ...state, leftLeg: "disabled", rightLeg: "disabled" };
  if (mode === "all") return { leftArm: "disabled", rightArm: "disabled", leftLeg: "disabled", rightLeg: "disabled" };
  return state;
}

function getLimbMotionState(local: boolean): LimbMotionState {
  const moving = local ? state.characterId !== "" && isMovementPressed() : true;
  if (!moving) {
    return applyLimbDisableMode(IDLE_LIMB_STATE, "none");
  }

  const phase = Math.sin(performance.now() / 110);
  const swing: 45 | 90 = Math.abs(phase) > 0.4 ? 90 : 45;
  const forwardSwing: 45 | 90 = swing;
  const backwardSwing: -45 | -90 = swing === 45 ? -45 : -90;
  return applyLimbDisableMode({
    leftArm: phase > 0 ? backwardSwing : forwardSwing,
    rightArm: phase > 0 ? forwardSwing : backwardSwing,
    leftLeg: phase > 0 ? forwardSwing : backwardSwing,
    rightLeg: phase > 0 ? backwardSwing : forwardSwing,
  }, "none");
}

function updateHud(): void {
  if (!state.token || !state.characterId) return;
  const character = currentPlayerCharacter();
  const combat = withRuntimeResources(getCombatStats(character?.stats));
  const occupied = positionToOccupiedTile(state.player);
  const chunkX = worldToChunk(occupied.x);
  const chunkY = worldToChunk(occupied.y);
  const tile = state.currentTile;
  const visibleTilesX = TARGET_VISIBLE_TILES_X;
  const visibleTilesY = TARGET_VISIBLE_TILES_Y;
  const speed = getCurrentMoveSpeed(combat, isSprintDisplayActive());
  hud.innerHTML = renderGameHud(character, combat);
  staminaHud.innerHTML = renderStaminaHud(combat);

  const dominant = dominantTerrain();
  debugPanel.innerHTML = `
    <div><b>已加载区块</b> ${state.chunks.size}　<b>缩放</b> ${state.tileScale.toFixed(1)}px/格</div>
    <div><b>实际渲染</b> ${RENDER_TILE_WINDOW_X} x ${RENDER_TILE_WINDOW_Y} 格　<b>当前可见</b> ${visibleTilesX} x ${visibleTilesY} 格</div>
    <div><b>帧时间</b> ${state.lastFrameMs.toFixed(2)} ms　<b>近处待渲染</b> ${state.pendingChunkRenders.length}　<b>远处静默队列</b> ${state.deferredChunkRenders.length}</div>
    <div><b>最近区块刷新</b> ${state.lastChunkRefreshMs.toFixed(2)} ms / ${state.lastChunkRefreshCount} 块</div>
    <div><b>最近区块渲染</b> ${state.lastChunkRenderMs.toFixed(2)} ms / ${state.lastChunkRenderCount} 块</div>
    <div><b>主要地形</b> ${escapeHtml(dominant || "-")}</div>
    <div><b>坐标</b> X:${state.player.x.toFixed(2)} Y:${state.player.y.toFixed(2)}　<b>区块</b> ${chunkX}, ${chunkY}　<b>速度</b> ${speed.toFixed(1)} m/s</div>
    <div><b>地形</b> ${escapeHtml(tile?.terrain ?? "未加载")}　<b>方块</b> ${escapeHtml(tile?.block ?? "未加载")}　<b>装饰</b> ${escapeHtml(tile?.decoration ?? "-")}</div>
    <div><b>最后错误</b> ${escapeHtml(state.lastError || "无")}</div>
  `;
}

function renderGameHud(character: CharacterSummary | undefined, combat: CharacterCombatStats): string {
  return `
    <div class="combat-hud">
      <div class="hud-bars-row">
        <div class="heart-resource">
          <div class="icon-meter" aria-label="生命">${renderIconRepeats("❤", 10, combat.resources.healthCurrent / Math.max(1, combat.resources.healthMax))}</div>
          <div class="compact-resource-track hp"><i style="width:${resourcePercent(combat.resources.healthCurrent, combat.resources.healthMax)}%"></i></div>
        </div>
        <div class="mana-resource">
          <div class="icon-meter" aria-label="法力">${renderIconRepeats("💧", 10, combat.resources.manaCurrent / Math.max(1, combat.resources.manaMax))}</div>
          <div class="compact-resource-track mp"><i style="width:${resourcePercent(combat.resources.manaCurrent, combat.resources.manaMax)}%"></i></div>
        </div>
        <div class="level-plate">Lv.${character?.stats.level ?? 1}</div>
      </div>
      ${renderHotbar(character, false)}
      <div class="experience-track" title="经验条占位，待接入等级经验协议">
        <i style="width:${experiencePercent(character)}%"></i>
      </div>
      <div class="hud-hint">B 背包 · Esc 菜单 · ${escapeHtml(state.socketStatus)}</div>
    </div>
  `;
}

function renderStaminaHud(combat: CharacterCombatStats): string {
  const current = combat.resources.staminaCurrent;
  const max = combat.resources.staminaMax;
  const percent = resourcePercent(current, max);
  const status = staminaStatusLabel(current, max);
  return `
    <div class="stamina-widget ${isSprintDisplayActive() ? "running" : ""}">
      <div class="stamina-widget-header">
        <span>耐力</span>
        <strong>${formatInteger(current)} / ${formatInteger(max)}</strong>
      </div>
      <div class="stamina-widget-track" aria-label="耐力 ${formatInteger(current)} / ${formatInteger(max)}">
        <i style="width:${percent}%"></i>
      </div>
      <div class="stamina-widget-footer">
        <span>${status}</span>
        <span>Shift 疾跑 x${SPRINT_SPEED_MULTIPLIER.toFixed(1)}</span>
      </div>
    </div>
  `;
}

function staminaStatusLabel(current: number, max: number): string {
  if (isSprintDisplayActive()) {
    return `消耗 ${formatInteger(SPRINT_STAMINA_COST_PER_SECOND)}/秒 · 恢复 ${formatInteger(STAMINA_REGEN_WHILE_RUNNING)}/秒`;
  }
  if (current >= max - 0.01) return "已满";
  return `恢复 ${formatInteger(STAMINA_REGEN_RECENTLY_STOPPED)}-${formatInteger(STAMINA_REGEN_RESTED)}/秒`;
}

function isSprintDisplayActive(): boolean {
  return state.wantsSprint || state.sprinting;
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

function currentPlayerCharacter(): CharacterSummary | undefined {
  return state.availableCharacters.find((item) => item.id === state.characterId)
    ?? state.availableCharacters.find((item) => item.id === state.selectedCharacterId);
}

function getCombatStats(stats: CharacterStats | undefined): CharacterCombatStats {
  if (stats?.combat) return stats.combat;
  const health = stats?.base.health ?? 100;
  const mana = stats?.base.mana ?? 60;
  const stamina = stats?.base.stamina ?? 100;
  const physicalAttack = stats?.attack.physicalAttack ?? 10;
  const magicAttack = stats?.attack.spellAttack ?? 10;
  const physicalDefense = stats?.defense.physicalDefense ?? 5;
  const magicDefense = stats?.defense.spellDefense ?? 5;
  const physicalCrit = legacyPercentToRatio(stats?.attack.physicalCrit ?? 0);
  const magicCrit = legacyPercentToRatio(stats?.attack.spellCrit ?? 0);
  const critDamageBonus = legacyPercentToRatio(stats?.attack.critDamageBonus ?? 0);
  const damageBonus = legacyPercentToRatio(stats?.attack.damageBonus ?? 0);
  const damageImmunity = legacyPercentToRatio(stats?.defense.damageMitigation ?? 0);
  const extraImmunity = legacyPercentToRatio(stats?.defense.bonusMitigation ?? 0);
  const powerScore = (physicalAttack + magicAttack) * 8
    + (physicalDefense + magicDefense) * 6
    + Math.round(health / 5 + mana / 10 + stamina / 10)
    + Math.round(100 * (physicalCrit + magicCrit + critDamageBonus + damageBonus + damageImmunity));
  return {
    resources: {
      healthMax: health,
      healthCurrent: health,
      manaMax: mana,
      manaCurrent: mana,
      staminaMax: stamina,
      staminaCurrent: stamina,
    },
    physicalAttack,
    magicAttack,
    physicalDefense,
    magicDefense,
    moveSpeed: stats?.base.moveSpeed ?? 5,
    physicalCrit,
    magicCrit,
    critDamageBonus,
    damageBonus,
    extraDamage: legacyPercentToRatio(stats?.attack.bonusDamage ?? 0),
    critResist: legacyPercentToRatio(stats?.defense.critResistance ?? 0),
    damageImmunity,
    extraImmunity,
    healPower: 0,
    healTakenBonus: 0,
    powerScore,
  };
}

function withRuntimeResources(combat: CharacterCombatStats): CharacterCombatStats {
  const runtime = state.runtimeResources;
  const staminaMax = Math.max(1, runtime.staminaMax ?? combat.resources.staminaMax);
  state.currentStamina = clamp(state.currentStamina, 0, staminaMax);
  return {
    ...combat,
    resources: {
      ...combat.resources,
      healthMax: runtime.healthMax ?? combat.resources.healthMax,
      healthCurrent: runtime.healthCurrent ?? combat.resources.healthCurrent,
      manaMax: runtime.manaMax ?? combat.resources.manaMax,
      manaCurrent: runtime.manaCurrent ?? combat.resources.manaCurrent,
      staminaMax,
      staminaCurrent: state.currentStamina,
    },
  };
}

function applyRuntimeResources(resources: RuntimeResources | undefined, combat: CharacterCombatStats, sprinting?: boolean): void {
  const staminaMax = Math.max(1, resources?.staminaMax ?? combat.resources.staminaMax);
  const staminaCurrent = clamp(resources?.staminaCurrent ?? state.currentStamina, 0, staminaMax);
  state.runtimeResources = {
    healthMax: resources?.healthMax ?? state.runtimeResources.healthMax ?? combat.resources.healthMax,
    healthCurrent: resources?.healthCurrent ?? state.runtimeResources.healthCurrent ?? combat.resources.healthCurrent,
    manaMax: resources?.manaMax ?? state.runtimeResources.manaMax ?? combat.resources.manaMax,
    manaCurrent: resources?.manaCurrent ?? state.runtimeResources.manaCurrent ?? combat.resources.manaCurrent,
    staminaMax,
    staminaCurrent,
  };
  state.currentStamina = staminaCurrent;
  if (sprinting !== undefined) {
    state.sprinting = sprinting && state.currentStamina > 0;
  }
}

function legacyPercentToRatio(value: number): number {
  return value > 1 ? value / 100 : value;
}

function renderMiniResourceBars(combat: CharacterCombatStats): string {
  return `
    <div class="resource-bars mini">
      ${renderResourceBar("hp", "生命", combat.resources.healthCurrent, combat.resources.healthMax)}
      ${renderResourceBar("mp", "法力", combat.resources.manaCurrent, combat.resources.manaMax)}
      ${renderResourceBar("sp", "耐力", combat.resources.staminaCurrent, combat.resources.staminaMax)}
    </div>
  `;
}

function renderHotbar(character: CharacterSummary | undefined, inventoryMode: boolean): string {
  const items = character?.inventory?.items ?? [];
  return `
    <div class="hotbar ${inventoryMode ? "inventory-hotbar" : ""}">
      ${Array.from({ length: 9 }, (_, index) => renderItemSlot(items[index], index, index === state.selectedHotbarIndex, "hotbar")).join("")}
    </div>
  `;
}

function renderBagSlots(character: CharacterSummary | undefined): string {
  const items = character?.inventory?.items ?? [];
  return Array.from({ length: 54 }, (_, index) => renderItemSlot(items[index + 9], index, false, "bag")).join("");
}

function renderEquipmentSlots(character: CharacterSummary | undefined): string {
  const equipment = character?.equipment;
  const slots: Array<[string, string | undefined]> = [
    ["头盔", equipment?.helmet],
    ["胸甲", equipment?.chest],
    ["裤子", equipment?.pants],
    ["鞋子", equipment?.shoes],
    ["肩甲", equipment?.shoulders],
    ["披风", equipment?.cloak],
    ["左护臂", equipment?.leftBracer],
    ["右护臂", equipment?.rightBracer],
    ["戒指 1", undefined],
    ["戒指 2", undefined],
    ["戒指 3", undefined],
    ["吊坠 1", undefined],
    ["吊坠 2", undefined],
  ];
  return `
    <div class="equipment-slots">
      ${slots.map(([label, itemId]) => `
        <div class="equipment-slot">
          <span>${label}</span>
          <strong>${itemId ? escapeHtml(itemId) : "空"}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function renderFullInventoryStats(character: CharacterSummary | undefined, combat: CharacterCombatStats): string {
  void character;
  const groups: Array<{ title: string; stats: Array<[string, string]> }> = [
    {
      title: "基础类",
      stats: [
        ["生命", `${formatInteger(combat.resources.healthCurrent)}/${formatInteger(combat.resources.healthMax)}`],
        ["耐力值", `${formatInteger(combat.resources.staminaCurrent)}/${formatInteger(combat.resources.staminaMax)}`],
        ["法力值", `${formatInteger(combat.resources.manaCurrent)}/${formatInteger(combat.resources.manaMax)}`],
        ["移速", formatFlat(combat.moveSpeed)],
      ],
    },
    {
      title: "攻击类",
      stats: [
        ["法术攻击", formatInteger(combat.magicAttack)],
        ["物理攻击", formatInteger(combat.physicalAttack)],
        ["法术暴击", formatRatio(combat.magicCrit)],
        ["物理暴击", formatRatio(combat.physicalCrit)],
        ["伤害加成", formatRatio(combat.damageBonus)],
        ["爆伤加成", formatRatio(combat.critDamageBonus)],
        ["追加伤害", formatRatio(combat.extraDamage)],
      ],
    },
    {
      title: "防御类",
      stats: [
        ["法术防御", formatInteger(combat.magicDefense)],
        ["物理防御", formatInteger(combat.physicalDefense)],
        ["暴击抵抗", formatRatio(combat.critResist)],
        ["伤害免疫", formatRatio(combat.damageImmunity)],
        ["追加免疫", formatRatio(combat.extraImmunity)],
      ],
    },
  ];
  return `
    <div class="inventory-stat-pages">
      ${groups.map((group) => `
        <div class="inventory-stat-group">
          <h4>${group.title}</h4>
          <div class="inventory-stat-grid">
            ${group.stats.map(([label, value]) => renderInventoryStat(label, value)).join("")}
          </div>
        </div>
      `).join("")}
      <div class="inventory-stat-pager">
        <button type="button" disabled>上一页</button>
        <span>1 / 1</span>
        <button type="button" disabled>下一页</button>
      </div>
    </div>
  `;
}

function renderItemSlot(item: { itemId: string; quantity: number } | undefined, index: number, selected: boolean, kind: "hotbar" | "bag"): string {
  const label = item ? compactItemName(item.itemId) : "";
  const quantity = item && item.quantity > 1 ? item.quantity : "";
  return `
    <div class="item-slot ${kind}-slot ${selected ? "selected" : ""}">
      <span class="slot-index">${kind === "hotbar" ? index + 1 : ""}</span>
      <span class="slot-icon">${item ? "●" : "□"}</span>
      <strong>${escapeHtml(label)}</strong>
      <em>${quantity}</em>
    </div>
  `;
}

function renderInventoryStat(label: string, value: string): string {
  return `
    <div class="inventory-stat">
      <span>${label}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function compactItemName(itemId: string): string {
  return itemId
    .replace(/^item_/, "")
    .replace(/^potion_/, "")
    .split(/[_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 3))
    .join(".");
}

function renderIconRepeats(icon: string, count: number, ratio: number): string {
  const filled = Math.round(clamp(ratio, 0, 1) * count);
  return Array.from({ length: count }, (_, index) => `<span class="${index < filled ? "filled" : "empty"}">${icon}</span>`).join("");
}

function resourcePercent(current: number, max: number): string {
  return (clamp(current / Math.max(1, max), 0, 1) * 100).toFixed(1);
}

function experiencePercent(character: CharacterSummary | undefined): string {
  const version = character?.version ?? 0;
  return String(18 + (version % 7) * 9);
}

function renderResourceBars(combat: CharacterCombatStats): string {
  return `
    <div class="resource-bars">
      ${renderResourceBar("hp", "生命", combat.resources.healthCurrent, combat.resources.healthMax)}
      ${renderResourceBar("mp", "法力", combat.resources.manaCurrent, combat.resources.manaMax)}
      ${renderResourceBar("sp", "耐力", combat.resources.staminaCurrent, combat.resources.staminaMax)}
    </div>
  `;
}

function renderResourceBar(kind: "hp" | "mp" | "sp", label: string, current: number, max: number): string {
  const safeMax = Math.max(1, max);
  const ratio = clamp(current / safeMax, 0, 1);
  return `
    <div class="resource-row ${kind}">
      <div class="resource-label"><span>${label}</span><b>${formatInteger(current)} / ${formatInteger(max)}</b></div>
      <div class="resource-track"><i style="width:${(ratio * 100).toFixed(1)}%"></i></div>
    </div>
  `;
}

function renderStatCell(code: string, value: number, ratio: boolean): string {
  return `
    <div class="stat-cell">
      <span>${escapeHtml(attributeLabel(code))}</span>
      <strong>${ratio ? formatRatio(value) : formatFlat(value)}</strong>
    </div>
  `;
}

function renderSourceBreakdown(stats: CharacterStats | undefined): string {
  const sources = stats?.sources;
  const defs = stats?.metadata?.attributeDefs ?? [];
  if (!sources) {
    return `<p class="muted-line">当前角色仍使用兼容属性结构，等待服务端刷新后会显示来源拆分。</p>`;
  }

  const rows = Object.entries(SOURCE_LABELS).map(([key, label]) => {
    const values = sources[key as keyof typeof sources];
    if (!isAttributeValues(values)) return "";
    const total = sumVisibleAttributes(values, defs);
    const filled = Math.min(100, Math.abs(total) * 3);
    return `
      <div class="source-row">
        <span>${label}</span>
        <div class="source-track"><i style="width:${filled.toFixed(1)}%"></i></div>
        <b>${formatSourceTotal(total)}</b>
      </div>
    `;
  }).join("");

  return `
    <div class="source-breakdown">
      ${rows}
      ${sources.equipmentNote ? `<p class="muted-line">${escapeHtml(sources.equipmentNote)}</p>` : ""}
    </div>
  `;
}

function isAttributeValues(value: unknown): value is AttributeValues {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sumVisibleAttributes(values: AttributeValues, defs: AttributeDefinition[]): number {
  const visibleCodes = new Set(defs.filter((def) => def.clientVisible).map((def) => def.code));
  let total = 0;
  for (const [code, value] of Object.entries(values)) {
    if (visibleCodes.size > 0 && !visibleCodes.has(code)) continue;
    if (code === "move_speed") {
      total += value * 10;
      continue;
    }
    total += value;
  }
  return total;
}

function combatAttributeValue(combat: CharacterCombatStats, code: string): number {
  switch (code) {
    case "physical_attack":
      return combat.physicalAttack;
    case "magic_attack":
      return combat.magicAttack;
    case "physical_defense":
      return combat.physicalDefense;
    case "magic_defense":
      return combat.magicDefense;
    case "move_speed":
      return combat.moveSpeed;
    case "physical_crit":
      return combat.physicalCrit;
    case "magic_crit":
      return combat.magicCrit;
    case "crit_damage_bonus":
      return combat.critDamageBonus;
    case "damage_bonus":
      return combat.damageBonus;
    case "extra_damage":
      return combat.extraDamage;
    case "crit_resist":
      return combat.critResist;
    case "damage_immunity":
      return combat.damageImmunity;
    case "extra_immunity":
      return combat.extraImmunity;
    case "heal_power":
      return combat.healPower;
    case "heal_taken_bonus":
      return combat.healTakenBonus;
    default:
      return 0;
  }
}

function attributeLabel(code: string): string {
  return ATTRIBUTE_LABELS[code] ?? code;
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString("zh-CN");
}

function formatFlat(value: number): string {
  return Number.isInteger(value) ? formatInteger(value) : value.toFixed(1);
}

function formatRatio(value: number): string {
  return `${(value * 100).toFixed(value === 0 ? 0 : 1)}%`;
}

function formatSourceTotal(value: number): string {
  if (Math.abs(value) < 0.0001) return "0";
  return value > 0 ? `+${formatFlat(value)}` : formatFlat(value);
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
  const viewportWidth = Math.max(1, Math.floor(window.innerWidth));
  const viewportHeight = Math.max(1, Math.floor(window.innerHeight));
  const fitWidth = Math.min(viewportWidth, Math.floor(viewportHeight * GAME_ASPECT_RATIO));
  const fitHeight = Math.min(viewportHeight, Math.floor(fitWidth / GAME_ASPECT_RATIO));
  const left = Math.floor((viewportWidth - fitWidth) / 2);
  const top = Math.floor((viewportHeight - fitHeight) / 2);

  canvas.width = Math.max(1, fitWidth);
  canvas.height = Math.max(1, fitHeight);
  canvas.style.width = `${fitWidth}px`;
  canvas.style.height = `${fitHeight}px`;
  canvas.style.left = `${left}px`;
  canvas.style.top = `${top}px`;
  canvas.style.right = "auto";
  canvas.style.bottom = "auto";
  state.tileScale = getFittedTileScale();
  updateOrientationOverlay();
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

function isPortraitHandheldViewport(): boolean {
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const narrowScreen = Math.min(window.innerWidth, window.innerHeight) <= 820;
  return state.characterId !== "" && coarsePointer && narrowScreen && window.innerHeight > window.innerWidth;
}

function updateOrientationOverlay(): void {
  orientationOverlay.classList.toggle("hidden", !isPortraitHandheldViewport());
}

function requestLandscapeOrientation(): void {
  const orientation = screen.orientation as ScreenOrientationWithLock | undefined;
  if (!orientation?.lock) return;
  void orientation.lock("landscape").catch(() => {
    updateOrientationOverlay();
  });
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

function isGameplayKey(code: string): boolean {
  return isMovementKey(code) || isSprintKey(code);
}

function isSprintKey(code: string): boolean {
  return code === state.keyBindings.sprint || code === "ShiftLeft" || code === "ShiftRight";
}

function isSprintPressed(): boolean {
  return state.pressed.has(state.keyBindings.sprint) || state.pressed.has("ShiftLeft") || state.pressed.has("ShiftRight");
}

function isMovementPressed(): boolean {
  return state.pressed.has(state.keyBindings.moveLeft)
    || state.pressed.has(state.keyBindings.moveRight)
    || state.pressed.has(state.keyBindings.moveUp)
    || state.pressed.has(state.keyBindings.moveDown)
    || state.pressed.has("ArrowLeft")
    || state.pressed.has("ArrowRight")
    || state.pressed.has("ArrowUp")
    || state.pressed.has("ArrowDown");
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
