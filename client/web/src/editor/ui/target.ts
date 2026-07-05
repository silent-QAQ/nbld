// 目标选择器编辑器（§137-142）。
// 【重要】DOM 交互逻辑逐字移植自旧编辑器，保持行为不变；只把全局 $ 改为局部查询、
// 把回写目标改为当前 step 对象。字段 id 与旧编辑器一致以复用解析逻辑。
import type { AppState } from "../state";
import type { Step } from "../model/types";
import { optionsHtml } from "../dom";
import { entityTargets, coordinateTargets, rangeShapes, targetKinds } from "../data/targeters";
import {
  parseRangeSelectorParams,
  splitTargetPoints,
  targetSelectorFrom,
  targeterText,
  targetKindFromStep,
  rangeShapeFromStep,
  normalizedTargeterParams,
} from "../targeter";
import { number } from "../util";

/** 目标编辑区内部字段查询（scoped 到 centerBody）。 */
function $(id: string): HTMLInputElement | HTMLSelectElement {
  return document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
}

/** 渲染目标编辑区 HTML（供 steps 面板内联）。 */
export function targetEditorHtml(step: Step): string {
  const params = normalizedTargeterParams(step);
  return `
    <div class="field">
      <label>目标类型</label>
      <select id="targetKind">${optionsHtml(targetKinds, targetKindFromStep(step))}</select>
    </div>
    <div class="field target-kind target-entity">
      <label>单实体</label>
      <select id="targetEntity">${optionsHtml(entityTargets, entityTargets.some(([id]) => id === step.targeter) ? step.targeter : "@s")}</select>
    </div>
    <div class="field target-kind target-coordinate">
      <label>单坐标</label>
      <select id="targetCoord">${optionsHtml(coordinateTargets, "@entitylo")}</select>
    </div>
    <div class="field target-kind target-range">
      <label>范围形状</label>
      <select id="targetShape">${optionsHtml(rangeShapes, rangeShapeFromStep(step))}</select>
    </div>
    <div class="field target-kind target-query">
      <label>查询参数</label>
      <input id="targetQuery" placeholder="n=张三 / id=1001 / %a=elite">
    </div>
    <div class="field target-kind target-coordinate target-range">
      <label>实体坐标来源</label>
      <select id="targetCoordEntity">${optionsHtml(entityTargets, "@s")}</select>
    </div>
    <div class="field target-kind target-coordinate target-range">
      <label>指定坐标</label>
      <input id="targetCoordValue" placeholder="p=10,4,0">
    </div>
    <div class="field target-kind target-range">
      <label>范围点</label>
      <select id="targetPoint">${optionsHtml(coordinateTargets, "@entitylo")}</select>
    </div>
    <div class="field target-kind target-range">
      <label>点参数</label>
      <input id="targetPointValue" placeholder="p=4,4,0 / n=张三">
    </div>
    <div class="field target-kind target-range">
      <label>&nbsp;</label>
      <button id="addTargetPoint" type="button">添加范围点</button>
    </div>
    <div class="field full target-kind target-range">
      <label>范围点列表</label>
      <div class="pill-row" id="targetPointList"></div>
    </div>
    <div class="field full">
      <label>目标选择器表达式</label>
      <input id="targetSelector" value="${targeterText(step)}">
    </div>
    <input id="targeter" type="hidden" value="${step.targeter}">
    <input id="targetParam" type="hidden" value="${step.target_param || ""}">
    <div class="field"><label>最远距离</label><input id="targetRange" type="number" min="0" step="0.1" value="${params.range}"></div>
    <div class="field"><label>外半径 r</label><input id="targetRadius" type="number" min="0" step="0.1" value="${params.radius}"></div>
    <div class="field"><label>内半径 ir</label><input id="targetInnerRadius" type="number" min="0" step="0.1" value="${params.inner_radius}"></div>
    <div class="field"><label>起始角 ag</label><input id="targetAngle" type="number" step="1" value="${params.angle}"></div>
    <div class="field"><label>角宽 c</label><input id="targetArc" type="number" min="0" max="360" step="1" value="${params.arc}"></div>
    <div class="field"><label>边界宽 w</label><input id="targetWidth" type="number" min="0" step="0.1" value="${params.width}"></div>
    <div class="field"><label>锚点上限</label><input id="maxTargets" type="number" min="1" step="1" value="${params.max_targets}"></div>`;
}

function entityExpression(app: AppState, targeter: string): { targeter: string; param: string; selector: string } {
  const param = ["@p", "@e"].includes(targeter) ? $("targetQuery").value.trim() : "";
  return { targeter, param, selector: targetSelectorFrom(targeter, param) };
}

function coordinateSelector(app: AppState): string {
  const type = $("targetCoord").value;
  if (type === "@entitylo") return `${entityExpression(app, $("targetCoordEntity").value).selector}lo`;
  if (type === "@pl") return `@pl(${$("targetCoordValue").value.trim() || "p=0,0,0"})`;
  return "@zp";
}

function pointSelector(app: AppState): string {
  const type = $("targetPoint").value;
  if (type === "@entitylo") return `${entityExpression(app, $("targetCoordEntity").value).selector}lo`;
  if (type === "@pl") return `@pl(${$("targetPointValue").value.trim() || $("targetCoordValue").value.trim() || "p=0,0,0"})`;
  return "@zp";
}

function selectorBase(selector: string): string {
  return selector.startsWith("@pl(") ? "@pl" : selector;
}

function selectorParam(selector: string): string {
  const match = selector.match(/^@\w+\((.*)\)$/);
  return match ? match[1] : "";
}

function rangeExpression(app: AppState): { targeter: string; param: string; selector: string } {
  const shape = $("targetShape").value;
  const points = app.targetPoints.length ? app.targetPoints : [pointSelector(app)];
  const r = Math.max(0, number($("targetRadius").value));
  const ir = Math.max(0, number($("targetInnerRadius").value));
  const ag = number($("targetAngle").value);
  const c = Math.max(0, Math.min(360, number($("targetArc").value)));
  const w = Math.max(0, number($("targetWidth").value));
  if (shape === "polygon" || shape === "border") {
    const targeter = shape === "polygon" ? "@fw" : "@bj";
    const param = `${points.join("/")}${shape === "border" && w > 0 ? `;w=${w}` : ""}`;
    return { targeter, param, selector: targetSelectorFrom(targeter, param) };
  }
  const base = shape === "ellipse" ? points.slice(0, 2).join("/") : points[0];
  const targeter = shape === "ellipse" ? "@el" : "@o";
  const param = `${base}+o(${[
    `r=${r}`,
    ["ring", "fanring"].includes(shape) ? `ir=${ir}` : "",
    ["sector", "fanring"].includes(shape) ? `ag=${ag}` : "",
    ["sector", "fanring"].includes(shape) ? `c=${c}` : "",
  ].filter(Boolean).join(",")})`;
  return { targeter, param, selector: param };
}

function targetExpressionFromEditor(app: AppState): { targeter: string; param: string; selector: string } {
  const kind = $("targetKind").value;
  if (kind === "entity") return entityExpression(app, $("targetEntity").value);
  if (kind === "coordinate") {
    const selector = coordinateSelector(app);
    return { targeter: selectorBase(selector), param: selectorParam(selector), selector };
  }
  return rangeExpression(app);
}

/** 显隐控制：按目标类型切换字段可见性。 */
export function syncTargetEditorVisibility(): void {
  const kind = $("targetKind").value;
  document.querySelectorAll(".target-kind").forEach((item) => ((item as HTMLElement).hidden = true));
  document.querySelectorAll(`.target-${kind}`).forEach((item) => ((item as HTMLElement).hidden = false));
  const coordinateType = kind === "range" ? $("targetPoint").value : $("targetCoord").value;
  const needsQuery = kind === "entity"
    ? ["@p", "@e"].includes($("targetEntity").value)
    : ["coordinate", "range"].includes(kind) && coordinateType === "@entitylo" && ["@p", "@e"].includes($("targetCoordEntity").value);
  (document.querySelector(".target-query") as HTMLElement).hidden = !needsQuery;
  document.querySelectorAll(".target-coordinate").forEach((item) => ((item as HTMLElement).hidden = kind !== "coordinate"));
  if (kind === "range") {
    document.querySelectorAll(".target-range").forEach((item) => ((item as HTMLElement).hidden = false));
  }
}

function renderTargetPoints(app: AppState): void {
  const host = document.getElementById("targetPointList");
  if (!host) return;
  host.innerHTML = app.targetPoints.length
    ? app.targetPoints.map((point, index) => `<span class="pill">${point} <button type="button" data-remove-target-point="${index}">×</button></span>`).join("")
    : `<span class="pill">未添加，默认使用当前单坐标</span>`;
}

/** 读取当前编辑器的目标器几何参数。 */
function readTargeterParams(): Step["targeter_params"] {
  return {
    range: Math.max(0, number($("targetRange").value)),
    radius: Math.max(0, number($("targetRadius").value)),
    inner_radius: Math.max(0, number($("targetInnerRadius").value)),
    angle: Math.max(0, number($("targetAngle").value)),
    arc: Math.max(0, number($("targetArc").value)),
    width: Math.max(0, number($("targetWidth").value)),
    max_targets: Math.max(1, Math.floor(number($("maxTargets").value))),
  };
}

/** 将目标编辑器的值写回步骤对象。 */
export function writeTargetToStep(app: AppState, step: Step): void {
  step.targeter = $("targeter").value;
  step.target_param = $("targetParam").value.trim();
  step.target_selector = $("targetSelector").value.trim() || targetSelectorFrom($("targeter").value, $("targetParam").value.trim());
  step.targeter_params = readTargeterParams();
}

/** 由结构化控件重建选择器表达式并回写步骤。 */
export function buildTargetFromEditor(app: AppState, step: Step): void {
  syncTargetEditorVisibility();
  const { targeter, param, selector } = targetExpressionFromEditor(app);
  $("targeter").value = targeter;
  $("targetParam").value = param;
  $("targetSelector").value = selector;
  writeTargetToStep(app, step);
}

/** 初始化范围点列表 + 显隐（渲染后调用）。 */
export function initTargetEditor(app: AppState, step: Step): void {
  const selector = targeterText(step);
  if (step.targeter === "@fw" || step.targeter === "@bj") {
    const match = selector.match(/^@(fw|bj)=\((.*)\)$/);
    const body = match ? match[2] : (step.target_param || "");
    const [points, widthPart] = body.split(";w=");
    app.targetPoints = splitTargetPoints(points || "@slo/@zp/@pl(p=4,4,0)");
    if (widthPart) $("targetWidth").value = String(number(widthPart));
  } else {
    const rangeMatch = selector.match(/^(.*?)\+o\(([^)]*)\)/);
    if (rangeMatch) {
      app.targetPoints = splitTargetPoints(rangeMatch[1]);
      const params = parseRangeSelectorParams(selector);
      if (params.r !== undefined) $("targetRadius").value = String(number(params.r));
      if (params.ir !== undefined) $("targetInnerRadius").value = String(number(params.ir));
      if (params.ag !== undefined) $("targetAngle").value = String(number(params.ag));
      if (params.c !== undefined || params.ctc !== undefined) $("targetArc").value = String(number(params.c ?? params.ctc));
    } else {
      syncCoordinateControls(selector);
      app.targetPoints = [];
    }
  }
  renderTargetPoints(app);
  syncTargetEditorVisibility();
}

function syncCoordinateControls(selector: string): void {
  if (selector.endsWith("lo")) {
    $("targetCoord").value = "@entitylo";
    $("targetCoordEntity").value = selector.slice(0, -2);
  } else if (selector.startsWith("@pl(")) {
    $("targetCoord").value = "@pl";
    $("targetCoordValue").value = selector.slice(4, -1);
  } else {
    $("targetCoord").value = "@zp";
  }
}

/** 添加 / 删除范围点。 */
export function addTargetPoint(app: AppState, step: Step): void {
  app.targetPoints.push(pointSelector(app));
  renderTargetPoints(app);
  buildTargetFromEditor(app, step);
}

export function removeTargetPoint(app: AppState, step: Step, index: number): void {
  app.targetPoints.splice(index, 1);
  renderTargetPoints(app);
  buildTargetFromEditor(app, step);
}

