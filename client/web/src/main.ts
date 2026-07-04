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
const CHUNK_TEXTURE_SCALE = 4;
const PLAYER_WALK_SPEED_TILES_PER_SECOND = 4;
const PLAYER_SPRINT_SPEED_TILES_PER_SECOND = 6;
const CHUNK_REFRESH_INTERVAL_MS = 500;
const MOVE_SEND_INTERVAL_MS = 90;
const TARGET_VISIBLE_TILES_X = 40;
const TARGET_VISIBLE_TILES_Y = 22.5;
const RENDER_TILE_WINDOW_X = 120;
const RENDER_TILE_WINDOW_Y = 120;
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

type Facing = "front" | "back" | "left" | "right";
type LayerEditorMode = "hair" | "skeleton";
type PaintMode = "fill" | "erase";
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
  camera: Position;
  tileScale: number;
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
  selectedHairLayer: keyof CharacterAppearance["hair"];
  selectedSkeletonLayer: keyof CharacterAppearance["skeleton"];
  selectedLayerMode: LayerEditorMode;
  appearanceDraft: CharacterAppearance | null;
  paintMode: PaintMode;
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
            <div class="appearance-palette" id="appearancePalette"></div>
          </div>
          <div class="appearance-right">
            <div class="hair-toolbar" id="hairToolbar"></div>
            <div class="pixel-editor" id="hairGrid"></div>
            <div class="pixel-tools" id="pixelTools"></div>
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
  camera: { x: 0, y: 0 },
  tileScale: 1,
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
  selectedHairLayer: "front",
  selectedSkeletonLayer: "frontTorso",
  selectedLayerMode: "hair",
  appearanceDraft: null,
  paintMode: "fill",
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

app.querySelector<HTMLButtonElement>("#createCharacterButton")!.addEventListener("click", () => {
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

baseUrlInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void loginWithEmail();
  }
});

window.addEventListener("resize", resizeCanvas);
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
  state.appearanceDraft = structuredClone(character.appearance);
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
  const body = appearance.body;
  const cards = [
    renderDirectionCard("正面", body, "front"),
    renderDirectionCard("背面", body, "back"),
    renderDirectionCard("左侧", body, "left"),
    renderDirectionCard("右侧", body, "right"),
  ];
  appearancePreview.innerHTML = cards.join("");
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

function renderAppearanceControls(body: CharacterBodyAppearance): void {
  const fields: Array<[keyof CharacterBodyAppearance, string, number, number]> = [
    ["height", "总身高", 42, 58],
    ["frontShoulderWidth", "正面肩宽", 22, 28],
    ["sideWidth", "侧身厚度", 10, 16],
    ["chestWidth", "胸围", 14, 28],
    ["waistWidth", "腰围", 10, 26],
    ["hipWidth", "臀围", 12, 27],
    ["torsoHeight", "躯干高度", 14, 26],
    ["upperArmWidth", "上臂宽度", 2, 8],
    ["upperArmLength", "上臂长度", 6, 18],
    ["forearmWidth", "小臂宽度", 2, 7],
    ["forearmLength", "小臂长度", 5, 17],
    ["thighWidth", "大腿宽度", 3, 9],
    ["thighLength", "大腿长度", 7, 20],
    ["calfWidth", "小腿宽度", 2, 8],
    ["calfLength", "小腿长度", 6, 19],
    ["chestDepth", "胸纵深", 7, 16],
    ["waistDepth", "腰纵深", 6, 15],
    ["hipDepth", "臀纵深", 7, 16],
  ];

  appearanceGrid.innerHTML = fields.map(([key, label, min, max]) => `
    <label class="appearance-field">
      <span>${label}</span>
      <input type="number" data-appearance-key="${key}" data-min="${min}" data-max="${max}" value="${body[key]}">
    </label>
  `).join("");

  for (const input of appearanceGrid.querySelectorAll<HTMLInputElement>("input[data-appearance-key]")) {
    input.addEventListener("input", () => {
      if (!state.appearanceDraft) return;
      state.appearanceDraft = readAppearanceFromEditor();
      renderAppearancePreview(state.appearanceDraft);
    });
  }
}

function renderPaletteControls(palette: CharacterAppearance["palette"]): void {
  const fields: Array<[keyof CharacterAppearance["palette"], string]> = [
    ["skinPrimary", "肤色主色"],
    ["skinShadow", "肤色阴影"],
    ["hairPrimary", "发色主色"],
    ["hairShadow", "发色阴影"],
    ["clothPrimary", "服装主色"],
    ["clothShadow", "服装阴影"],
    ["metalPrimary", "金属主色"],
    ["metalShadow", "金属阴影"],
  ];

  appearancePalette.innerHTML = fields.map(([key, label]) => `
    <label class="appearance-field">
      <span>${label}</span>
      <input type="color" data-palette-key="${key}" value="${palette[key]}">
    </label>
  `).join("");

  for (const input of appearancePalette.querySelectorAll<HTMLInputElement>("input[data-palette-key]")) {
    input.addEventListener("input", () => {
      if (!state.appearanceDraft) return;
      state.appearanceDraft = readAppearanceFromEditor();
      renderAppearancePreview(state.appearanceDraft);
    });
  }
}

function renderLayerControls(): void {
  if (!state.appearanceDraft) return;
  const hair = state.appearanceDraft.hair;
  const hairStyle = state.appearanceDraft.style.hairStyle;
  const hairLayers: Array<[keyof CharacterAppearance["hair"], string]> = [
    ["front", "前层后发"],
    ["frontFg", "前层前发"],
    ["back", "背面后发"],
    ["backFg", "背面前发"],
    ["left", "左侧后发"],
    ["leftFg", "左侧前发"],
    ["right", "右侧后发"],
    ["rightFg", "右侧前发"],
  ];
  const skeletonLayers: Array<[keyof CharacterAppearance["skeleton"], string]> = [
    ["frontTorso", "正面骨骼层"],
    ["backTorso", "背面骨骼层"],
    ["leftTorso", "左侧骨骼层"],
    ["rightTorso", "右侧骨骼层"],
  ];

  hairToolbar.innerHTML = `
    <div class="layer-mode-switch">
      <button type="button" class="secondary hair-layer-btn ${state.selectedLayerMode === "hair" ? "active" : ""}" data-layer-mode="hair">发型层</button>
      <button type="button" class="secondary hair-layer-btn ${state.selectedLayerMode === "skeleton" ? "active" : ""}" data-layer-mode="skeleton">骨骼层</button>
    </div>
    <label class="appearance-field">
      <span>发型名</span>
      <input type="text" id="hairStyleInput" value="${hairStyle}">
    </label>
    ${(state.selectedLayerMode === "hair" ? hairLayers.map(([key, label]) => `<button type="button" class="secondary hair-layer-btn ${state.selectedHairLayer === key ? "active" : ""}" data-hair-layer="${key}">${label}</button>`) : skeletonLayers.map(([key, label]) => `<button type="button" class="secondary hair-layer-btn ${state.selectedSkeletonLayer === key ? "active" : ""}" data-skeleton-layer="${key}">${label}</button>`)).join("")}
  `;

  for (const input of hairToolbar.querySelectorAll<HTMLInputElement>("#hairStyleInput")) {
    input.addEventListener("input", () => {
      if (!state.appearanceDraft) return;
      state.appearanceDraft.style.hairStyle = input.value.trim() || "custom";
    });
  }

  for (const button of hairToolbar.querySelectorAll<HTMLButtonElement>("[data-hair-layer]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedHairLayer = button.dataset.hairLayer as keyof CharacterAppearance["hair"];
      renderLayerControls();
    });
  }

  for (const button of hairToolbar.querySelectorAll<HTMLButtonElement>("[data-skeleton-layer]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedSkeletonLayer = button.dataset.skeletonLayer as keyof CharacterAppearance["skeleton"];
      renderLayerControls();
    });
  }

  for (const button of hairToolbar.querySelectorAll<HTMLButtonElement>("[data-layer-mode]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedLayerMode = button.dataset.layerMode as LayerEditorMode;
      renderLayerControls();
    });
  }

  const rows = state.selectedLayerMode === "hair"
    ? hair[state.selectedHairLayer] ?? []
    : state.appearanceDraft.skeleton[state.selectedSkeletonLayer] ?? [];
  renderPixelEditorGrid(rows);
}

function renderPixelTools(): void {
  pixelTools.innerHTML = `
    <button type="button" class="secondary ${state.paintMode === "fill" ? "active" : ""}" data-paint-mode="fill">绘制</button>
    <button type="button" class="secondary ${state.paintMode === "erase" ? "active" : ""}" data-paint-mode="erase">擦除</button>
    <button type="button" class="secondary" data-tool="mirror-h">水平镜像</button>
    <button type="button" class="secondary" data-tool="mirror-v">垂直镜像</button>
    <button type="button" class="secondary" data-tool="clear">清空图层</button>
    <button type="button" class="secondary" data-tool="copy-facing">复制到同向</button>
    <button type="button" class="secondary" data-tool="export">导出 JSON</button>
    <button type="button" class="secondary" data-tool="import">导入 JSON</button>
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
  const base = structuredClone(state.appearanceDraft ?? defaultAppearance());

  for (const input of appearanceGrid.querySelectorAll<HTMLInputElement>("input[data-appearance-key]")) {
    const key = input.dataset.appearanceKey as keyof CharacterBodyAppearance;
    const min = Number(input.dataset.min ?? 0);
    const max = Number(input.dataset.max ?? 999);
    const value = clamp(Number(input.value || base.body[key]), min, max);
    base.body[key] = Math.round(value);
    input.value = String(base.body[key]);
  }

  for (const input of appearancePalette.querySelectorAll<HTMLInputElement>("input[data-palette-key]")) {
    const key = input.dataset.paletteKey as keyof CharacterAppearance["palette"];
    base.palette[key] = input.value;
  }

  const hairStyleInput = hairToolbar.querySelector<HTMLInputElement>("#hairStyleInput");
  if (hairStyleInput) base.style.hairStyle = hairStyleInput.value.trim() || "custom";

  return base;
}

function normalizeHairRows(rows: string[]): string[] {
  return rows
    .map((row) => row.replace(/[^01]/g, ""))
    .filter((row) => row.length > 0)
    .slice(0, 24)
    .map((row) => row.slice(0, 24));
}

function renderPixelEditorGrid(rows: string[]): void {
  const width = 24;
  const height = 24;
  const normalized = normalizeHairRows(rows);
  const matrix = Array.from({ length: height }, (_, y) => {
    const row = normalized[y] ?? "";
    return Array.from({ length: width }, (_, x) => row[x] === "1");
  });

  hairGrid.innerHTML = "";
  let dragging = false;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = `pixel-cell ${matrix[y][x] ? "filled" : ""}`;
      cell.dataset.x = String(x);
      cell.dataset.y = String(y);
      const paintCell = () => {
        matrix[y][x] = state.paintMode === "fill";
        cell.classList.toggle("filled", matrix[y][x]);
        updateDraftHairFromMatrix(matrix);
      };
      cell.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        dragging = true;
        paintCell();
      });
      cell.addEventListener("pointerenter", () => {
        if (dragging) paintCell();
      });
      cell.addEventListener("pointerup", () => {
        dragging = false;
      });
      hairGrid.appendChild(cell);
    }
  }
  hairGrid.addEventListener("pointerleave", () => {
    dragging = false;
  }, { once: true });
  window.addEventListener("pointerup", () => {
    dragging = false;
  }, { once: true });
}

function updateDraftHairFromMatrix(matrix: boolean[][]): void {
  if (!state.appearanceDraft) return;
  const rows = matrix
    .map((row) => row.map((cell) => (cell ? "1" : "0")).join("").replace(/0+$/g, ""))
    .filter((row) => row.length > 0);
  if (state.selectedLayerMode === "hair") {
    state.appearanceDraft.hair[state.selectedHairLayer] = normalizeHairRows(rows);
  } else {
    state.appearanceDraft.skeleton[state.selectedSkeletonLayer] = normalizeHairRows(rows);
  }
  renderAppearancePreview(state.appearanceDraft);
}

function applyPixelTool(tool: string): void {
  if (!state.appearanceDraft) return;
  const rows = state.selectedLayerMode === "hair"
    ? state.appearanceDraft.hair[state.selectedHairLayer] ?? []
    : state.appearanceDraft.skeleton[state.selectedSkeletonLayer] ?? [];
  const matrix = rowsToMatrix(rows, 24, 24);

  switch (tool) {
    case "mirror-h":
      for (const row of matrix) row.reverse();
      break;
    case "mirror-v":
      matrix.reverse();
      break;
    case "clear":
      for (const row of matrix) row.fill(false);
      break;
    case "copy-facing":
      copyCurrentLayerToSibling(rows);
      renderLayerControls();
      return;
    case "export":
      void navigator.clipboard.writeText(JSON.stringify(state.appearanceDraft, null, 2));
      loginError.textContent = "外观 JSON 已复制到剪贴板";
      return;
    case "import": {
      const raw = window.prompt("粘贴外观 JSON");
      if (!raw) return;
      try {
        state.appearanceDraft = JSON.parse(raw) as CharacterAppearance;
        renderAppearanceEditor({
          ...(state.availableCharacters.find((item) => item.id === state.selectedCharacterId) as CharacterSummary),
          appearance: state.appearanceDraft,
        });
      } catch {
        loginError.textContent = "外观 JSON 格式无效";
      }
      return;
    }
    default:
      return;
  }

  updateDraftHairFromMatrix(matrix);
  renderLayerControls();
}

function rowsToMatrix(rows: string[], width: number, height: number): boolean[][] {
  const normalized = normalizeHairRows(rows);
  return Array.from({ length: height }, (_, y) => {
    const row = normalized[y] ?? "";
    return Array.from({ length: width }, (_, x) => row[x] === "1");
  });
}

function copyCurrentLayerToSibling(rows: string[]): void {
  if (!state.appearanceDraft) return;
  const value = normalizeHairRows(rows);
  if (state.selectedLayerMode === "hair") {
    const map: Partial<Record<keyof CharacterAppearance["hair"], keyof CharacterAppearance["hair"]>> = {
      left: "right",
      leftFg: "rightFg",
      right: "left",
      rightFg: "leftFg",
      front: "back",
      frontFg: "backFg",
      back: "front",
      backFg: "frontFg",
    };
    const target = map[state.selectedHairLayer];
    if (target) state.appearanceDraft.hair[target] = [...value];
  } else {
    const map: Partial<Record<keyof CharacterAppearance["skeleton"], keyof CharacterAppearance["skeleton"]>> = {
      leftTorso: "rightTorso",
      rightTorso: "leftTorso",
      frontTorso: "backTorso",
      backTorso: "frontTorso",
    };
    const target = map[state.selectedSkeletonLayer];
    if (target) state.appearanceDraft.skeleton[target] = [...value];
  }
}

async function saveSelectedCharacterAppearance(): Promise<void> {
  if (!state.api || !state.token || !state.selectedCharacterId) return;
  const character = state.availableCharacters.find((item) => item.id === state.selectedCharacterId);

  setLoginBusy(true, "保存外观中...");
  loginError.textContent = "";
  try {
    const appearance = readAppearanceFromEditor();
    if (!character || character.id === "draft") {
      const name = characterNameInput.value.trim() || state.accountUsername || "Hero";
      const created = await state.api.createCharacter(state.token, name);
      const updated = await state.api.updateCharacterAppearance(state.token, created.character.id, appearance);
      await loadCharacters();
      renderAppearanceEditor(updated.character);
    } else {
      const updated = await state.api.updateCharacterAppearance(state.token, state.selectedCharacterId, appearance);
      const index = state.availableCharacters.findIndex((item) => item.id === updated.character.id);
      if (index >= 0) {
        state.availableCharacters[index] = updated.character;
      }
      renderCharacterList(state.availableCharacters);
      renderAppearanceEditor(updated.character);
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
    frontShoulderWidth: 24,
    sideWidth: 12,
    chestWidth: 20,
    waistWidth: 16,
    hipWidth: 20,
    torsoHeight: 20,
    upperArmWidth: 4,
    upperArmLength: 11,
    forearmWidth: 4,
    forearmLength: 10,
    thighWidth: 5,
    thighLength: 12,
    calfWidth: 4,
    calfLength: 11,
    chestDepth: 10,
    waistDepth: 9,
    hipDepth: 10,
    headScale: 100,
  };
}

function defaultAppearance() {
  return {
    body: defaultAppearanceBody(),
    style: {
      hairStyle: "short",
    },
    hair: {
      front: ["01110", "11111", "11111"],
      back: ["11111", "11111", "01110"],
      left: ["1110", "1111", "0111"],
      right: ["0111", "1111", "1110"],
      frontFg: ["00100"],
      backFg: [],
      leftFg: ["001"],
      rightFg: ["100"],
    },
    skeleton: {
      frontTorso: ["01110", "11111", "11111", "01110"],
      backTorso: ["01110", "11111", "11111", "01110"],
      leftTorso: ["1110", "1111", "1111", "0111"],
      rightTorso: ["0111", "1111", "1111", "1110"],
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
    },
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
  const appearance = character?.appearance ?? defaultAppearance();
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

  const hairBackLayer = facing === "front" ? appearance.hair.back : facing === "back" ? appearance.hair.front : facing === "left" ? appearance.hair.left : appearance.hair.right;
  const hairFrontLayer = facing === "front" ? appearance.hair.frontFg : facing === "back" ? appearance.hair.backFg : facing === "left" ? appearance.hair.leftFg : appearance.hair.rightFg;
  const torsoLayer = facing === "front"
    ? appearance.skeleton.frontTorso
    : facing === "back"
      ? appearance.skeleton.backTorso
      : facing === "left"
        ? appearance.skeleton.leftTorso
        : appearance.skeleton.rightTorso;

  drawHairLayer(target, screen.x, topY - 2, hairBackLayer, palette.hairPrimary, palette.hairShadow, scale);
  drawHeadLayer(target, screen.x, topY, headWidth, headHeight, palette.skinPrimary, palette.skinShadow);
  drawHairLayer(target, screen.x, topY - 1, hairFrontLayer, palette.hairPrimary, palette.hairShadow, scale);
  drawTorsoLayer(target, screen.x, topY + headHeight, shoulder, chest, waist, hip, torsoHeight, palette.clothPrimary, palette.clothShadow, palette.metalPrimary, torsoLayer, scale);

  const armWidth = Math.max(3, body.upperArmWidth * 0.18 * scale);
  const armLength = Math.max(10, (body.upperArmLength + body.forearmLength) * 0.12 * scale);
  drawLimb(target, screen.x - shoulder / 2, topY + headHeight + 4, armLength, armWidth, moveState.leftArm, palette.skinPrimary, palette.skinShadow);
  drawLimb(target, screen.x + shoulder / 2, topY + headHeight + 4, armLength, armWidth, moveState.rightArm, palette.skinPrimary, palette.skinShadow);

  const legWidth = Math.max(4, body.thighWidth * 0.18 * scale);
  drawLimb(target, screen.x - legWidth, topY + headHeight + torsoHeight, legHeight, legWidth, moveState.leftLeg, palette.clothShadow, palette.metalShadow);
  drawLimb(target, screen.x + legWidth, topY + headHeight + torsoHeight, legHeight, legWidth, moveState.rightLeg, palette.clothShadow, palette.metalShadow);

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
