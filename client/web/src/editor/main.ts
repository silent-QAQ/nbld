// 技能编辑引擎入口：搭建外壳、注入渲染回调、装配各面板。
import "./editor.css";
import { AppState } from "./state";
import type { CenterPage } from "./state";
import { byId, delegate } from "./dom";
import { renderLibrary, bindLibrary } from "./ui/library";
import { renderBase, bindBase } from "./ui/base";
import { renderSteps, bindSteps } from "./ui/steps";
import { renderTimeline } from "./ui/timeline";
import { renderModifiers, bindModifiers } from "./ui/modifiers";
import { renderPreview, bindPreview } from "./ui/preview";
import { renderOutput, bindOutput } from "./ui/output";

const CENTER_PAGES: [CenterPage, string][] = [
  ["base", "基础信息"],
  ["steps", "效果编排"],
  ["timeline", "效果时间线"],
  ["modifiers", "联动修正"],
  ["preview", "测试预览"],
];

function shell(): string {
  return `
  <header class="topbar">
    <div class="brand">
      <h1>技能编辑引擎</h1>
      <span>技能库 · 效果编排 · 联动修正 · 测试预览 · 结构表导出</span>
    </div>
    <div class="top-actions">
      <button id="newSkill" class="primary">新建技能</button>
      <button id="importLib">导入</button>
      <button id="exportLib">导出技能库</button>
      <button id="copyJson">复制 JSON</button>
      <button id="downloadJson">下载配置</button>
    </div>
  </header>
  <main class="workspace">
    <section class="panel" id="libraryPanel"></section>
    <section class="panel">
      <div class="page-nav" id="pageNav">
        ${CENTER_PAGES.map(([id, label]) => `<button data-page="${id}">${label}</button>`).join("")}
      </div>
      <div class="panel-body" id="centerBody"></div>
    </section>
    <section class="panel output-panel" id="outputPanel"></section>
  </main>
  <input id="importFile" type="file" accept="application/json" hidden>`;
}

const app = new AppState();

function renderCenter(): void {
  const body = byId("centerBody");
  document.querySelectorAll("#pageNav button").forEach((btn) => {
    btn.classList.toggle("active", (btn as HTMLElement).dataset.page === app.centerPage);
  });
  switch (app.centerPage) {
    case "base": renderBase(app, body); break;
    case "steps": renderSteps(app, body); break;
    case "timeline": renderTimeline(app, body); break;
    case "modifiers": renderModifiers(app, body); break;
    case "preview": renderPreview(app, body); break;
  }
}

function render(): void {
  renderLibrary(app, byId("libraryPanel"));
  renderCenter();
  renderOutput(app, byId("outputPanel"));
}

function bootstrap(): void {
  const root = byId("editor-root");
  root.innerHTML = shell();
  app.renderFn = render;

  delegate(byId("pageNav"), "click", "[data-page]", (el) => {
    app.centerPage = el.dataset.page as CenterPage;
    render();
  });

  bindLibrary(app);
  bindBase(app);
  bindSteps(app);
  bindModifiers(app);
  bindPreview(app);
  bindOutput(app);

  render();
}

bootstrap();
