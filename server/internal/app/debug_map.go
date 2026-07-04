package app

import (
	"net/http"
	"strconv"

	"nbld/server/internal/protocol"
)

const (
	debugMapMaxChunks          = 240
	debugMapMaxSamplesPerChunk = 80
	debugMapMaxTiles           = 250000
)

type debugMapSampleResponse struct {
	MapID            string               `json:"mapId"`
	CenterX          float64              `json:"centerX"`
	CenterY          float64              `json:"centerY"`
	CenterChunk      debugMapChunkCoord   `json:"centerChunk"`
	ChunkSize        int                  `json:"chunkSize"`
	ChunksWide       int                  `json:"chunksWide"`
	Samples          int                  `json:"samples"`
	Columns          int                  `json:"columns"`
	Rows             int                  `json:"rows"`
	CellSize         int                  `json:"cellSize"`
	Seed             int64                `json:"seed"`
	Layer            string               `json:"layer"`
	Palette          []string             `json:"palette"`
	Terrain          []uint16             `json:"terrain"`
	Rivers           []int                `json:"rivers,omitempty"`
	Decorations      []debugMapDecoration `json:"decorations,omitempty"`
	Terrains         map[string]int       `json:"terrains"`
	Features         map[string]int       `json:"features"`
	DecorationCounts map[string]int       `json:"decorationCounts,omitempty"`
	Bounds           debugMapSampleBounds `json:"bounds"`
}

type debugMapDecoration struct {
	Index int    `json:"index"`
	Kind  string `json:"kind"`
	Block string `json:"block"`
}

type debugMapChunkCoord struct {
	X int `json:"x"`
	Y int `json:"y"`
}

type debugMapSampleBounds struct {
	MinChunkX int `json:"minChunkX"`
	MaxChunkX int `json:"maxChunkX"`
	MinChunkY int `json:"minChunkY"`
	MaxChunkY int `json:"maxChunkY"`
}

const debugMapHTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>NBLD 地图调试器</title>
  <style>
    :root {
      --bg: #101318;
      --panel: #181d24;
      --panel-2: #202733;
      --text: #edf2f7;
      --muted: #9aa7b7;
      --line: #313b49;
      --accent: #f1c96b;
      --danger: #e46b5f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: radial-gradient(circle at 20% 0%, #263245 0, #101318 34rem);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .app {
      display: grid;
      grid-template-columns: 320px minmax(0, 1fr);
      min-height: 100vh;
    }
    aside {
      border-right: 1px solid var(--line);
      background: rgba(24, 29, 36, 0.94);
      padding: 18px;
      overflow: auto;
    }
    main {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      min-width: 0;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--line);
      background: rgba(16, 19, 24, 0.78);
    }
    h1 {
      margin: 0 0 14px;
      font-size: 22px;
      letter-spacing: 0;
    }
    .subtitle {
      margin: 0 0 18px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }
    label {
      display: block;
      margin: 12px 0 6px;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    input, select, button {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel-2);
      color: var(--text);
      padding: 10px 11px;
      font: inherit;
    }
    button {
      cursor: pointer;
      background: #2b5f7a;
      border-color: #37738f;
      font-weight: 700;
    }
    button.secondary { background: #2a313d; border-color: var(--line); }
    button.warn { background: #6b4630; border-color: #8d5d3f; }
    button:disabled { opacity: 0.55; cursor: wait; }
    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .actions {
      display: grid;
      gap: 10px;
      margin-top: 14px;
    }
    .canvas-wrap {
      position: relative;
      min-height: 0;
      overflow: auto;
      padding: 18px;
    }
    canvas {
      image-rendering: pixelated;
      background: #0b0e13;
      border: 1px solid var(--line);
      box-shadow: 0 18px 42px rgba(0,0,0,0.32);
      display: block;
      cursor: grab;
      user-select: none;
      touch-action: none;
    }
    canvas.dragging { cursor: grabbing; }
    .status {
      color: var(--muted);
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .legend, .stats, .tile-info {
      margin-top: 18px;
      padding-top: 14px;
      border-top: 1px solid var(--line);
    }
    .legend-item, .stat-line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 5px 0;
      color: var(--muted);
      font-size: 13px;
    }
    .legend-left {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .swatch {
      width: 16px;
      height: 16px;
      border-radius: 3px;
      border: 1px solid rgba(255,255,255,0.18);
      flex: 0 0 auto;
    }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .tile-info {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.55;
    }
    .error { color: var(--danger); }
    @media (max-width: 900px) {
      .app { grid-template-columns: 1fr; }
      aside { border-right: 0; border-bottom: 1px solid var(--line); }
      .topbar { align-items: flex-start; flex-direction: column; }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside>
      <h1>地图生成调试</h1>
      <p class="subtitle">直接读取服务端地形层数据。主色显示主地形；地形层只叠加河流。路径、树、地下入口、洞口属于地图层，不在这里显示。按住鼠标左键拖动地图即可平移。</p>

      <label>服务端</label>
      <input id="baseUrl" value="" placeholder="默认当前域名" />

      <div class="row">
        <div>
          <label>X 坐标</label>
          <input id="posX" type="number" value="0" step="80" />
        </div>
        <div>
          <label>Y 坐标</label>
          <input id="posY" type="number" value="0" step="80" />
        </div>
      </div>

      <div class="row">
        <div>
          <label>显示层</label>
          <select id="mapLayer">
            <option value="terrain" selected>地形层</option>
            <option value="blocks">基础方块层</option>
          </select>
        </div>
        <div>
          <label>视野区块数</label>
          <select id="chunkSpan">
            <option value="5">5 x 5</option>
            <option value="15">15 x 15</option>
            <option value="30" selected>30 x 30</option>
            <option value="60">60 x 60</option>
            <option value="120">120 x 120</option>
            <option value="240">240 x 240 总览</option>
          </select>
        </div>
        <div>
          <label>每区块采样</label>
          <select id="samples">
            <option value="1">1 x 1</option>
            <option value="2">2 x 2</option>
            <option value="4" selected>4 x 4</option>
            <option value="8">8 x 8</option>
            <option value="80">80 x 80 每格方块</option>
          </select>
        </div>
      </div>

      <div class="row">
        <div>
          <label>显示倍率</label>
          <input id="scale" type="number" value="3" min="0.05" max="8" step="0.05" title="单位：每格像素。0.05px/格 = 4px/区块" />
        </div>
        <div>
          <label>区块网格</label>
          <select id="gridMode">
            <option value="auto" selected>自动</option>
            <option value="on">显示</option>
            <option value="off">隐藏</option>
          </select>
        </div>
      </div>

      <div class="row">
        <div>
          <label>河流显示</label>
          <select id="riverMode">
            <option value="off" selected>隐藏</option>
            <option value="on">显示</option>
          </select>
        </div>
        <div>
          <label>河流透明度</label>
          <input id="riverAlpha" type="number" value="0.55" min="0.1" max="1" step="0.05" />
        </div>
      </div>

      <div class="row">
        <div>
          <label>装饰显示</label>
          <select id="decorationMode">
            <option value="off" selected>隐藏</option>
            <option value="on">显示</option>
          </select>
        </div>
        <div>
          <label>装饰透明度</label>
          <input id="decorationAlpha" type="number" value="0.8" min="0.1" max="1" step="0.05" />
        </div>
      </div>

      <div class="actions">
        <button id="loadBtn">加载当前位置</button>
        <button id="randomBtn" class="warn">随机地图种子</button>
        <button id="originBtn" class="secondary">回到原点</button>
      </div>

      <div class="row actions">
        <button class="secondary" data-pan="-1,0">← 半屏</button>
        <button class="secondary" data-pan="1,0">半屏 →</button>
        <button class="secondary" data-pan="0,1">↑ 半屏</button>
        <button class="secondary" data-pan="0,-1">半屏 ↓</button>
      </div>

      <div class="tile-info" id="tileInfo">移动鼠标到地图上查看地形/基础方块。装饰层默认隐藏，可单独打开。</div>
      <div class="stats" id="stats"></div>
      <div class="legend" id="legend"></div>
    </aside>
    <main>
      <div class="topbar">
        <div class="status" id="status">未加载</div>
        <div class="status mono" id="session"></div>
      </div>
      <div class="canvas-wrap">
        <canvas id="mapCanvas" width="1600" height="1600"></canvas>
      </div>
    </main>
  </div>

  <script>
    const terrainColors = {
      frozen_ice_ocean: '#a8d1f0',
      cold_deep_ocean: '#143466',
      temperate_near_sea: '#287ab8',
      temperate_open_ocean: '#0f3d93',
      tropical_coral_sea: '#1aadb8',
      tropical_deep_ocean: '#0a5ca8',
      polar_tundra: '#adab8c',
      frozen_swamp: '#7a9ea8',
      snow_conifer_forest: '#a8c7b8',
      snow_plateau: '#d1d6d1',
      glacier_mountain: '#e0ebfa',
      cold_grassland: '#7a9452',
      boreal_forest: '#1f5233',
      conifer_hills: '#295c38',
      alpine_meadow: '#75a35f',
      temperate_plains: '#70bd57',
      deciduous_forest: '#2e7a38',
      temperate_wetland: '#3d6b52',
      broadleaf_hills: '#3d803d',
      mountain_meadow: '#759e5c',
      rocky_mountain: '#757570',
      cloud_forest: '#14572e',
      tropical_savanna: '#adad47',
      desert: '#d6bd61',
      gobi: '#b09a6b',
      tropical_rainforest: '#0a6b2e'
    };

    const featureColors = {
      river: '#55b9ff'
    };

    const decorationColors = {
      plant: '#123f1f',
      rock: '#3f3f3c'
    };

    const blockColors = {
      grass: '#69b84f',
      cold_grass: '#6f8f4f',
      dry_grass: '#aaa84b',
      plateau_grass: '#8a9b5a',
      forest_floor: '#2f6f35',
      needle_floor: '#244f34',
      rainforest_floor: '#245338',
      leaf_litter: '#6b5a2e',
      dirt: '#9b8050',
      dirt: '#80684c',
      dry_soil: '#9a8252',
      wet_mud: '#3e4a36',
      mud: '#4d4533',
      frozen_soil: '#8f8d78',
      rocky_soil: '#6a6758',
      moss: '#2f5f38',
      rock: '#777772',
      mountain_rock: '#5f6060',
      cliff_rock: '#4f5152',
      glacier_rock: '#9aa5ab',
      gravel: '#908b7e',
      sand: '#d8c46c',
      dune_sand: '#e0ca74',
      coast_sand: '#d6c78a',
      snow: '#d7ddd9',
      hard_snow: '#eef2f0',
      ice: '#b9d8ee',
      packed_ice: '#8fc5df',
      deep_ice_water: '#6fafd7',
      ice_water: '#93cde5',
      cold_deep_water: '#183d70',
      shallow_sea_water: '#3d92c2',
      open_ocean_water: '#153f91',
      wave_water: '#2860a8',
      tropical_shallow_water: '#22b5b8',
      tropical_deep_water: '#0d66a8',
      grass_tuft: '#2f7a34',
      flower: '#e6d46c',
      bush: '#1f5f34',
      dry_bush: '#8a7441',
      reed: '#6b8f40',
      cactus: '#347a40',
      tree_deciduous: '#245f2c',
      tree_conifer: '#173f26',
      tree_jungle: '#0d4f24',
      small_stone: '#5f5f5b'
    };

    const blockNames = {
      grass: '草地',
      cold_grass: '寒草地',
      dry_grass: '干草地',
      plateau_grass: '高原草地',
      forest_floor: '森林地表',
      needle_floor: '针叶腐殖层',
      rainforest_floor: '雨林地表',
      leaf_litter: '落叶层',
      dirt: '泥土',
      dirt: '裸土',
      dry_soil: '干土',
      wet_mud: '湿泥',
      mud: '泥地',
      frozen_soil: '冻土',
      rocky_soil: '碎石土',
      moss: '苔藓地',
      rock: '岩石',
      mountain_rock: '山岩',
      cliff_rock: '峭壁岩',
      glacier_rock: '冰川岩',
      gravel: '砾石',
      sand: '沙地',
      dune_sand: '沙丘',
      coast_sand: '岸沙',
      snow: '雪地',
      hard_snow: '硬雪',
      ice: '冰面',
      packed_ice: '坚冰',
      deep_ice_water: '深冰水',
      ice_water: '冰水',
      cold_deep_water: '寒带深水',
      shallow_sea_water: '浅海水',
      open_ocean_water: '远洋水',
      wave_water: '浪花水',
      tropical_shallow_water: '热带浅水',
      tropical_deep_water: '热带深水',
      grass_tuft: '草丛',
      flower: '花丛',
      bush: '灌木',
      dry_bush: '枯灌木',
      reed: '芦苇',
      cactus: '仙人掌',
      tree_deciduous: '阔叶树',
      tree_conifer: '针叶树',
      tree_jungle: '雨林树',
      small_stone: '小石块'
    };

    const terrainNames = {
      frozen_ice_ocean: '冰封冰洋',
      cold_deep_ocean: '寒带深海',
      temperate_near_sea: '温带近海',
      temperate_open_ocean: '温带远洋',
      tropical_coral_sea: '热带珊瑚近海',
      tropical_deep_ocean: '热带深海',
      polar_tundra: '极地冻土苔原',
      frozen_swamp: '冰封沼泽',
      snow_conifer_forest: '积雪针叶林',
      snow_plateau: '积雪高原',
      glacier_mountain: '雪山冰川',
      cold_grassland: '寒带草原',
      boreal_forest: '寒带针叶林',
      conifer_hills: '针叶丘陵',
      alpine_meadow: '高寒草甸',
      temperate_plains: '温带平原',
      deciduous_forest: '落叶阔叶林',
      temperate_wetland: '温带沼泽湿地',
      broadleaf_hills: '阔叶丘陵',
      mountain_meadow: '山地草甸',
      rocky_mountain: '岩质山地',
      cloud_forest: '云雾密林',
      tropical_savanna: '热带稀树草原',
      desert: '沙漠',
      gobi: '戈壁滩',
      tropical_rainforest: '热带雨林'
    };

    const featureNames = {
      river: '河流'
    };

    const state = {
      token: '',
      playerId: '',
      mapId: 'map_0_0',
      lastSample: null,
      lastDetail: '',
      riverSet: new Set(),
      decorationByIndex: new Map(),
      bitmapCanvas: document.createElement('canvas'),
      drag: null
    };

    const el = id => document.getElementById(id);
    const canvas = el('mapCanvas');
    const ctx = canvas.getContext('2d');

    function apiBase() {
      return (el('baseUrl').value || location.origin).replace(/\/$/, '');
    }

    async function postJSON(path, body) {
      const response = await fetch(apiBase() + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }

    async function getJSON(path) {
      const response = await fetch(apiBase() + path);
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }

    async function ensureSession() {
      if (state.token) return;
      const deviceId = 'map-debug-' + Math.random().toString(16).slice(2);
      const login = await postJSON('/api/v1/session/guest', { deviceId });
      state.token = login.token;
      state.playerId = login.playerId;
      const enter = await postJSON('/api/v1/world/enter', { token: state.token });
      state.mapId = enter.mapId || 'map_0_0';
      el('session').textContent = state.playerId;
    }

    async function moveTo(x, y) {
      const move = await postJSON('/api/v1/world/move', {
        token: state.token,
        position: { x, y }
      });
      state.mapId = move.mapId || state.mapId;
      el('posX').value = Math.round(move.position.x);
      el('posY').value = Math.round(move.position.y);
    }

    async function loadMap() {
      setBusy(true);
      try {
        await ensureSession();
        const x = Number(el('posX').value || 0);
        const y = Number(el('posY').value || 0);
        const chunks = Number(el('chunkSpan').value || 30);
        const samples = normalizedSamples(chunks, Number(el('samples').value || 4));
        const layer = el('mapLayer').value || 'terrain';
        const detail = mapDetail();
        el('samples').value = String(samples);
        const url = '/debug/map/sample?x=' + encodeURIComponent(x) + '&y=' + encodeURIComponent(y) + '&chunks=' + encodeURIComponent(chunks) + '&samples=' + encodeURIComponent(samples) + '&layer=' + encodeURIComponent(layer) + '&detail=' + encodeURIComponent(detail);
        const sampleData = await getJSON(url);
        state.lastSample = sampleData;
        state.lastDetail = detail;
        state.riverSet = new Set(sampleData.rivers || []);
        state.decorationByIndex = new Map((sampleData.decorations || []).map(item => [item.index, item]));
        state.mapId = sampleData.mapId || 'map_0_0';
        render();
        el('status').textContent = '地图 ' + sampleData.mapId + ' | ' + displayLayer(sampleData.layer) + ' | 中心区块 ' + sampleData.centerChunk.x + ',' + sampleData.centerChunk.y + ' | 视野 ' + sampleData.chunksWide + 'x' + sampleData.chunksWide + ' 区块 | 每区块 ' + sampleData.samples + 'x' + sampleData.samples + ' 采样 | 点数 ' + sampleData.terrain.length + ' | 倍率 ' + currentScale() + 'px/格';
      } catch (err) {
        el('status').innerHTML = '<span class="error">' + escapeHTML(String(err.message || err)) + '</span>';
      } finally {
        setBusy(false);
      }
    }

    function normalizedSamples(chunks, samples) {
      if (chunks > 5 && samples > 8) return 8;
      if (chunks >= 240) return Math.min(samples, 2);
      if (chunks >= 120) return Math.min(samples, 4);
      return samples;
    }

    function mapDetail() {
      return currentScale() > 2 ? 'main' : 'full';
    }

    function currentScale() {
      return clampScale(Number(el('scale').value || 3));
    }

    function clampScale(value) {
      if (!Number.isFinite(value)) return 3;
      return Math.min(8, Math.max(0.05, value));
    }

    function setScale(value) {
      const previousDetail = state.lastDetail || mapDetail();
      const scale = clampScale(value);
      el('scale').value = scale < 1 ? scale.toFixed(2) : String(Number(scale.toFixed(2)));
      if (state.lastSample && previousDetail !== mapDetail()) {
        loadMap();
        return;
      }
      render();
    }

    async function randomSeed() {
      setBusy(true);
      try {
        await ensureSession();
        const seed = await postJSON('/api/v1/world/seed/random', {});
        state.mapId = seed.mapId || 'map_0_0';
        el('posX').value = 0;
        el('posY').value = 0;
        await loadMap();
        el('status').textContent += ' | 种子 ' + seed.seed;
      } catch (err) {
        el('status').innerHTML = '<span class="error">' + escapeHTML(String(err.message || err)) + '</span>';
      } finally {
        setBusy(false);
      }
    }

    function render() {
      const scale = currentScale();
      el('scale').value = scale < 1 ? scale.toFixed(2) : String(Number(scale.toFixed(2)));
      const sample = state.lastSample;
      if (!sample || !sample.terrain || !sample.terrain.length) return;

      const chunkSize = sample.chunkSize || 80;
      const minChunkX = sample.bounds.minChunkX;
      const minChunkY = sample.bounds.minChunkY;
      const maxChunkX = sample.bounds.maxChunkX;
      const maxChunkY = sample.bounds.maxChunkY;
      const columns = sample.columns || sample.chunksWide * sample.samples;
      const rows = sample.rows || sample.chunksWide * sample.samples;
      const cellSize = sample.cellSize || Math.max(1, Math.floor(chunkSize / Math.max(1, sample.samples || 1)));
      const widthCells = columns * cellSize;
      const heightCells = rows * cellSize;
      const pixelSize = Math.max(1, Math.ceil(cellSize * scale));
      canvas.width = Math.max(1, columns * pixelSize);
      canvas.height = Math.max(1, rows * pixelSize);
      canvas.style.width = canvas.width + 'px';
      canvas.style.height = canvas.height + 'px';
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const riverMode = el('riverMode').value;
      const riverAlpha = Math.min(1, Math.max(0.1, Number(el('riverAlpha').value || 0.55)));
      const decorationMode = currentScale() > 2 ? 'off' : el('decorationMode').value;
      const decorationAlpha = Math.min(1, Math.max(0.1, Number(el('decorationAlpha').value || 0.8)));
      const colorByIndex = buildPaletteColors(sample.palette || [], sample.layer || 'terrain');
      const image = ctx.createImageData(columns, rows);
      for (let i = 0; i < sample.terrain.length; i++) {
        const color = colorByIndex[sample.terrain[i]] || [92, 143, 82];
        const p = i * 4;
        image.data[p] = color[0];
        image.data[p + 1] = color[1];
        image.data[p + 2] = color[2];
        image.data[p + 3] = 255;
      }
      const bitmap = state.bitmapCanvas;
      bitmap.width = columns;
      bitmap.height = rows;
      bitmap.getContext('2d').putImageData(image, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      if (riverMode === 'on' && sample.rivers && sample.rivers.length) {
        ctx.fillStyle = featureColors.river;
        ctx.globalAlpha = riverAlpha;
        for (const index of sample.rivers) {
          const x = index % columns;
          const y = Math.floor(index / columns);
          ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
        }
        ctx.globalAlpha = 1;
      }

      if (decorationMode === 'on' && sample.decorations && sample.decorations.length) {
        ctx.globalAlpha = decorationAlpha;
        for (const decoration of sample.decorations) {
          const x = decoration.index % columns;
          const y = Math.floor(decoration.index / columns);
          ctx.fillStyle = decorationColors[decoration.kind] || hashColor(decoration.block || decoration.kind);
          const inset = Math.max(0, Math.floor(pixelSize * 0.2));
          ctx.fillRect(x * pixelSize + inset, y * pixelSize + inset, Math.max(1, pixelSize - inset * 2), Math.max(1, pixelSize - inset * 2));
        }
        ctx.globalAlpha = 1;
      }

      drawChunkGrid(minChunkX, maxChunkX, minChunkY, maxChunkY, chunkSize, scale);
      renderStats(new Map(Object.entries(sample.terrains || {})), new Map(Object.entries(sample.features || {})));
      renderLegend(new Map(Object.entries(sample.terrains || {})), sample.layer || 'terrain');
    }

    function buildPaletteColors(palette, layer) {
      return palette.map(name => hexToRgb(colorForName(name, layer)));
    }

    function colorForName(name, layer) {
      if (layer === 'blocks') return blockColors[name] || hashColor(name);
      return terrainColors[name] || '#5c8f52';
    }

    function hexToRgb(hex) {
      const clean = hex.replace('#', '');
      return [
        parseInt(clean.slice(0, 2), 16),
        parseInt(clean.slice(2, 4), 16),
        parseInt(clean.slice(4, 6), 16)
      ];
    }

    function drawChunkGrid(minChunkX, maxChunkX, minChunkY, maxChunkY, chunkSize, scale) {
      const mode = el('gridMode').value;
      if (mode === 'off') return;
      if (mode === 'auto' && (maxChunkX - minChunkX + 1) > 60) return;
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1;
      for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
        for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY++) {
        const x = (chunkX - minChunkX) * chunkSize * scale;
        const y = (maxChunkY - chunkY) * chunkSize * scale;
        ctx.strokeRect(x + 0.5, y + 0.5, chunkSize * scale, chunkSize * scale);
        }
      }
    }

    function renderStats(terrainCounts, featureCounts) {
      const total = [...terrainCounts.values()].reduce((a, b) => a + b, 0) || 1;
      const layer = state.lastSample ? state.lastSample.layer || 'terrain' : 'terrain';
      const terrainLines = [...terrainCounts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => {
        const pct = (count / total * 100).toFixed(1);
        return '<div class="stat-line"><span>' + escapeHTML(displayName(name, layer)) + '</span><span class="mono">' + pct + '%</span></div>';
      }).join('');
      const featureLines = [...featureCounts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => {
        return '<div class="stat-line"><span>' + escapeHTML(displayFeature(name)) + '</span><span class="mono">' + count + '</span></div>';
      }).join('');
      const decorationCounts = new Map(Object.entries((state.lastSample && state.lastSample.decorationCounts) || {}));
      const decorationLines = [...decorationCounts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => {
        return '<div class="stat-line"><span>' + escapeHTML(name) + '</span><span class="mono">' + count + '</span></div>';
      }).join('');
      const title = layer === 'blocks' ? '基础方块占比' : '主地形占比';
      el('stats').innerHTML = '<strong>' + title + '</strong>' + terrainLines + '<br><strong>河流采样点</strong>' + (featureLines || '<div class="stat-line"><span>无</span><span></span></div>') + '<br><strong>地图装饰采样点</strong>' + (decorationLines || '<div class="stat-line"><span>无</span><span></span></div>');
    }

    function renderLegend(terrainCounts, layer) {
      const names = [...terrainCounts.keys()].sort();
      el('legend').innerHTML = '<strong>图例</strong>' + names.map(name => {
        return '<div class="legend-item"><span class="legend-left"><span class="swatch" style="background:' + colorForName(name, layer) + '"></span><span>' + escapeHTML(displayName(name, layer)) + '</span></span></div>';
      }).join('');
    }

    function displayName(name, layer) {
      if (layer === 'blocks') return (blockNames[name] || name) + (blockNames[name] ? '（' + name + '）' : '');
      return displayTerrain(name);
    }

    function displayLayer(layer) {
      return layer === 'blocks' ? '基础方块层' : '地形层';
    }

    function hashColor(name) {
      let hash = 0;
      for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
      const hue = Math.abs(hash) % 360;
      return 'hsl(' + hue + ', 36%, 48%)';
    }

    function displayTerrain(name) {
      return (terrainNames[name] || name) + (terrainNames[name] ? '（' + name + '）' : '');
    }

    function displayFeature(name) {
      return (featureNames[name] || name) + (featureNames[name] ? '（' + name + '）' : '');
    }

    function setBusy(busy) {
      for (const button of document.querySelectorAll('button')) button.disabled = busy;
    }

    function escapeHTML(value) {
      return value.replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    }

    canvas.addEventListener('mousemove', event => {
      if (state.drag) {
        const dx = event.clientX - state.drag.startClientX;
        const dy = event.clientY - state.drag.startClientY;
        canvas.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const sample = state.lastSample;
      if (!sample || !sample.terrain || !sample.terrain.length) return;
      const column = Math.floor(x / Math.max(1, canvas.width / sample.columns));
      const row = Math.floor(y / Math.max(1, canvas.height / sample.rows));
      if (column < 0 || row < 0 || column >= sample.columns || row >= sample.rows) return;
      const index = row * sample.columns + column;
      const valueName = sample.palette[sample.terrain[index]] || 'unknown';
      const chunkSize = sample.chunkSize || 80;
      const cellSize = sample.cellSize || Math.floor(chunkSize / sample.samples);
      const worldX = sample.bounds.minChunkX * chunkSize + column * cellSize + Math.floor(cellSize / 2);
      const worldY = sample.bounds.maxChunkY * chunkSize + chunkSize - (row + 1) * cellSize + Math.floor(cellSize / 2);
      const chunkX = Math.floor(worldX / chunkSize);
      const chunkY = Math.floor(worldY / chunkSize);
      const feature = state.riverSet.has(index) ? 'river' : '';
      const decoration = state.decorationByIndex.get(index);
      const decorationText = decoration ? ' / 装饰 ' + decoration.kind + ':' + decoration.block : '';
      el('tileInfo').innerHTML =
        '<div><strong>' + escapeHTML(displayName(valueName, sample.layer || 'terrain')) + '</strong>' + (feature ? ' / ' + escapeHTML(displayFeature(feature)) : '') + escapeHTML(decorationText) + '</div>' +
        '<div class="mono">世界坐标 ' + worldX + ', ' + worldY + '</div>' +
        '<div class="mono">区块 ' + chunkX + ', ' + chunkY + '</div>';
    });

    canvas.addEventListener('mousedown', event => {
      if (event.button !== 0 || !state.lastSample) return;
      event.preventDefault();
      state.drag = {
        startClientX: event.clientX,
        startClientY: event.clientY,
        startWorldX: Number(el('posX').value || 0),
        startWorldY: Number(el('posY').value || 0),
        scale: currentScale()
      };
      canvas.classList.add('dragging');
    });

    window.addEventListener('mouseup', event => {
      if (!state.drag) return;
      const drag = state.drag;
      state.drag = null;
      canvas.classList.remove('dragging');
      canvas.style.transform = '';
      const dx = event.clientX - drag.startClientX;
      const dy = event.clientY - drag.startClientY;
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      el('posX').value = Math.round(drag.startWorldX - dx / drag.scale);
      el('posY').value = Math.round(drag.startWorldY + dy / drag.scale);
      loadMap();
    });

    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      const scale = currentScale();
      const factor = event.deltaY < 0 ? 1.18 : 1 / 1.18;
      setScale(scale * factor);
    }, { passive: false });

    el('loadBtn').addEventListener('click', loadMap);
    el('randomBtn').addEventListener('click', randomSeed);
    el('originBtn').addEventListener('click', () => { el('posX').value = 0; el('posY').value = 0; loadMap(); });
    el('scale').addEventListener('change', () => setScale(Number(el('scale').value || 3)));
    el('gridMode').addEventListener('change', render);
    el('riverMode').addEventListener('change', render);
    el('riverAlpha').addEventListener('change', render);
    el('decorationMode').addEventListener('change', render);
    el('decorationAlpha').addEventListener('change', render);
    el('mapLayer').addEventListener('change', loadMap);
    el('chunkSpan').addEventListener('change', loadMap);
    el('samples').addEventListener('change', loadMap);
    for (const button of document.querySelectorAll('[data-pan]')) {
      button.addEventListener('click', () => {
        const [sx, sy] = button.dataset.pan.split(',').map(Number);
        const chunks = Number(el('chunkSpan').value || 30);
        const distance = Math.max(80, Math.floor(chunks * 80 * 0.5));
        el('posX').value = Number(el('posX').value || 0) + sx * distance;
        el('posY').value = Number(el('posY').value || 0) + sy * distance;
        loadMap();
      });
    }

    loadMap();
  </script>
</body>
</html>`

func (s *Server) handleDebugMap(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(debugMapHTML))
}

func (s *Server) handleDebugMapSample(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	query := r.URL.Query()
	centerX := queryFloat(query.Get("x"), 0)
	centerY := queryFloat(query.Get("y"), 0)
	chunksWide := clampInt(queryInt(query.Get("chunks"), 30), 1, debugMapMaxChunks)
	samples := clampInt(queryInt(query.Get("samples"), 4), 1, debugMapMaxSamplesPerChunk)
	if chunksWide%2 == 0 {
		chunksWide++
		if chunksWide > debugMapMaxChunks {
			chunksWide = debugMapMaxChunks - 1
		}
	}
	if chunksWide > 5 && samples > 8 {
		samples = 8
	}
	for chunksWide*chunksWide*samples*samples > debugMapMaxTiles && samples > 1 {
		samples--
	}

	mapID := query.Get("mapId")
	if mapID == "" {
		mapID = "map_0_0"
	}
	layer := query.Get("layer")
	if layer != "blocks" {
		layer = "terrain"
	}
	detail := query.Get("detail")
	if detail != "main" {
		detail = "full"
	}

	centerMapID, localX, localY, _ := resolveMapForPosition(mapID, protocolPosition(centerX, centerY))
	mapX, mapY := parseMapOffset(centerMapID)
	centerChunkX, centerChunkY := worldToChunk(localX, localY)
	radius := chunksWide / 2
	minChunkX := centerChunkX - radius
	maxChunkX := centerChunkX + radius
	minChunkY := centerChunkY - radius
	maxChunkY := centerChunkY + radius
	step := chunkTileSize / samples
	if step < 1 {
		step = 1
	}

	seed := s.chunks.currentSeed()
	columns := chunksWide * samples
	rows := chunksWide * samples
	cellSize := step
	terrainIDs := make(map[string]uint16)
	palette := make([]string, 0, 32)
	terrainData := make([]uint16, 0, columns*rows)
	rivers := make([]int, 0)
	decorations := make([]debugMapDecoration, 0)
	terrains := make(map[string]int)
	features := make(map[string]int)
	decorationCounts := make(map[string]int)

	for chunkY := maxChunkY; chunkY >= minChunkY; chunkY-- {
		for sampleY := samples - 1; sampleY >= 0; sampleY-- {
			for chunkX := minChunkX; chunkX <= maxChunkX; chunkX++ {
				globalChunkX := mapX*mapChunkSpan + chunkX
				globalChunkY := mapY*mapChunkSpan + chunkY
				for sampleX := 0; sampleX < samples; sampleX++ {
					tileX := sampleX*step + step/2
					tileY := sampleY*step + step/2
					if tileX >= chunkTileSize {
						tileX = chunkTileSize - 1
					}
					if tileY >= chunkTileSize {
						tileY = chunkTileSize - 1
					}

					globalX := globalChunkX*chunkTileSize + tileX
					globalY := globalChunkY*chunkTileSize + tileY
					terrain := pickBiome(float64(globalX)/float64(chunkTileSize), float64(globalY)/float64(chunkTileSize), seed)
					feature, _ := decorateTerrain(terrain, globalX, globalY)
					value := terrain
					if layer == "blocks" {
						if detail == "main" {
							value = mainBlockForTerrain(terrain)
						} else {
							value = baseBlockForTerrain(terrain, globalX, globalY, seed)
						}
					}
					terrains[value]++
					if feature != "" {
						features[feature]++
					}
					id, ok := terrainIDs[value]
					if !ok {
						id = uint16(len(palette))
						terrainIDs[value] = id
						palette = append(palette, value)
					}
					if feature == "river" {
						rivers = append(rivers, len(terrainData))
					}
					if detail == "full" {
						if decoration := mapDecorationForTerrain(terrain, globalX, globalY, seed); decoration.Block != "" {
							decorations = append(decorations, debugMapDecoration{
								Index: len(terrainData),
								Kind:  decoration.Kind,
								Block: decoration.Block,
							})
							decorationCounts[decoration.Kind+":"+decoration.Block]++
						}
					}
					terrainData = append(terrainData, id)
				}
			}
		}
	}

	writeJSON(w, http.StatusOK, debugMapSampleResponse{
		MapID:            centerMapID,
		CenterX:          localX,
		CenterY:          localY,
		CenterChunk:      debugMapChunkCoord{X: centerChunkX, Y: centerChunkY},
		ChunkSize:        chunkTileSize,
		ChunksWide:       chunksWide,
		Samples:          samples,
		Columns:          columns,
		Rows:             rows,
		CellSize:         cellSize,
		Seed:             seed,
		Layer:            layer,
		Palette:          palette,
		Terrain:          terrainData,
		Rivers:           rivers,
		Decorations:      decorations,
		Terrains:         terrains,
		Features:         features,
		DecorationCounts: decorationCounts,
		Bounds: debugMapSampleBounds{
			MinChunkX: minChunkX,
			MaxChunkX: maxChunkX,
			MinChunkY: minChunkY,
			MaxChunkY: maxChunkY,
		},
	})
}

func protocolPosition(x, y float64) protocol.Position {
	return protocol.Position{X: x, Y: y}
}

func queryInt(value string, fallback int) int {
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func queryFloat(value string, fallback float64) float64 {
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func clampInt(value, min, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}
