// 效果编排页（§10.3）：左侧步骤列表 + 步骤表单（名称/触发/时序）+ 内嵌目标选择器 + 机制选择器 + 量化条件。
// 步骤时序/机制/条件逻辑移植自旧编辑器；目标选择器整段复用 ui/target.ts，不改其行为。
import type { AppState } from "../state";
import type { CompareOperator, Condition, Step } from "../model/types";
import { byId, delegate, optionsHtml } from "../dom";
import { triggers, conditionScopes, operatorSymbols } from "../data/common";
import { mechanics, mechanicCategories, mechanicById, mechanicLabel } from "../data/mechanics";
import { conditionTypes, conditionMeta } from "../data/conditions";
import { stepText, conditionText } from "../compile";
import { targeterText } from "../targeter";
import { escapeHtml, number, clamp01, numberStepFor } from "../util";
import { renderOutput } from "./output";
import {
  targetEditorHtml,
  initTargetEditor,
  buildTargetFromEditor,
  writeTargetToStep,
  addTargetPoint,
  removeTargetPoint,
} from "./target";

// 目标选择器控件 id：几何 / 结构字段变化需重建选择器表达式（复用 target.ts 逻辑）。
const TARGET_REBUILD_IDS = new Set([
  "targetKind", "targetEntity", "targetCoord", "targetCoordEntity", "targetShape",
  "targetQuery", "targetCoordValue", "targetPointValue", "targetRadius",
  "targetInnerRadius", "targetAngle", "targetArc", "targetWidth",
]);

function conditionReadable(condition: Condition): string {
  const meta = conditionMeta(condition.type);
  const scopeLabel = conditionScopes.find(([s]) => s === (condition.scope || meta.scope))?.[1] ?? condition.scope;
  const param = condition.param ? `(${condition.param})` : "";
  return `${scopeLabel}.${meta.label}${param}`;
}

function stepListHtml(app: AppState): string {
  const skill = app.currentSkill();
  if (!skill) return "";
  return skill.steps.map((step, index) => {
    const selected = step.id === app.selectedStepId ? " selected" : "";
    return `<article class="step${selected}" data-select-step="${escapeHtml(step.id)}">
      <div class="step-head">
        <div class="step-title">${index + 1}. ${escapeHtml(step.name)} · ${escapeHtml(mechanicLabel(step.mechanic.id))} · ${escapeHtml(targeterText(step))} ~${escapeHtml(step.trigger)}</div>
        <div class="step-actions"><button data-select-step="${escapeHtml(step.id)}" title="编辑">›</button></div>
      </div>
      <div class="step-body">
        <div class="line-preview">${escapeHtml(stepText(step))}</div>
        <div class="pill-row">
          <span class="pill">${escapeHtml(step.trigger)}</span>
          <span class="pill">${escapeHtml(step.conditions.length + " 条件")}</span>
          <span class="pill">${escapeHtml(mechanicLabel(step.mechanic.id))}</span>
        </div>
      </div>
    </article>`;
  }).join("");
}

function mechanicPickerHtml(app: AppState): string {
  const mechanic = mechanicById(app.selectedMechanic);
  const visible = app.mechanicCategory === "all"
    ? mechanics
    : mechanics.filter((m) => m.category === app.mechanicCategory);
  const filter = mechanicCategories.map(([id, label]) =>
    `<button data-mechanic-category="${id}"${id === app.mechanicCategory ? ' class="active"' : ""}>${escapeHtml(label)}</button>`).join("");
  const buttons = visible.map((m) =>
    `<button class="mechanic-button${m.id === mechanic.id ? " active" : ""}" data-mechanic="${escapeHtml(m.id)}"><strong>${escapeHtml(m.title)}</strong><span>${escapeHtml(m.hint)}</span></button>`).join("");
  const params = mechanic.params.map(([key, label, type, fallback, options]) => {
    const value = app.mechanicParams[key] ?? fallback;
    if (type === "select" && options) {
      return `<div class="field"><label>${escapeHtml(label)}</label><select data-param="${escapeHtml(key)}">${optionsHtml(options, String(value))}</select></div>`;
    }
    const numAttrs = type === "number" ? ` step="${numberStepFor(key)}" min="0"` : "";
    return `<div class="field"><label>${escapeHtml(label)}</label><input data-param="${escapeHtml(key)}" type="${type}"${numAttrs} value="${escapeHtml(value)}"></div>`;
  }).join("");
  return `<div class="card">
    <h3>机制效果</h3>
    <div class="mechanic-filter" id="mechanicFilter">${filter}</div>
    <div class="mechanic-grid" id="mechanicButtons">${buttons}</div>
    <div class="line-preview">${escapeHtml(`${mechanic.title} · ${mechanic.hint} · 推荐锚点: ${mechanic.targeters.join(", ")} · ${mechanic.description}`)}</div>
    <div class="grid" id="mechanicParams">${params}</div>
    <div class="toolbar"><button id="applyMechanic" class="primary">应用到当前步骤</button></div>
  </div>`;
}

function conditionsHtml(app: AppState, step: Step): string {
  const draft = app.conditionDraft;
  const meta = conditionMeta(draft.type);
  const operatorOptions = meta.operators.map((op) => `<option value="${op}"${op === draft.operator ? " selected" : ""}>${operatorSymbols[op]}</option>`).join("");
  const list = step.conditions.map((c) =>
    `<div class="mini-item"><span>${escapeHtml(conditionReadable(c))} · ${escapeHtml(conditionText(c))}</span><button data-remove-condition="${escapeHtml(c.id)}">×</button></div>`).join("");
  return `<div class="card">
    <h3>量化条件</h3>
    <div class="grid">
      <div class="field"><label>作用域</label><select id="conditionScope">${optionsHtml(conditionScopes, draft.scope)}</select></div>
      <div class="field"><label>条件类型</label><select id="conditionType">${optionsHtml(conditionTypes.map((c) => [c.id, c.label] as const), draft.type)}</select></div>
      <div class="field"><label>比较</label><select id="conditionOperator">${operatorOptions}</select></div>
      <div class="field"><label>数值</label><input id="conditionValue" type="number" min="${meta.min}" max="${meta.max}" step="${meta.step}" value="${draft.value}"></div>
      <div class="field"><label>参数${meta.paramRequired ? " (必填)" : ""}</label><input id="conditionParam" placeholder="${escapeHtml(meta.paramHint || "可选参数")}" value="${escapeHtml(draft.param)}"></div>
      <div class="field full"><label>条件说明</label><div class="line-preview">${escapeHtml(`${meta.label} · ${meta.valueType} · ${meta.hint}${meta.paramRequired ? " · 必须填写参数" : ""}`)}</div></div>
    </div>
    <div class="toolbar">
      <button id="addCondition">添加条件</button>
      <button id="clearConditions" class="danger">清空条件</button>
    </div>
    <div class="mini-list" id="conditionList">${list}</div>
  </div>`;
}

function stepFormHtml(app: AppState, step: Step): string {
  return `<div class="card">
    <h3>步骤配置 · <span class="pill">${escapeHtml(step.name)}</span></h3>
    <div class="grid">
      <div class="field"><label>步骤名称</label><input id="stepName" value="${escapeHtml(step.name)}"></div>
      <div class="field"><label>触发时机</label><select id="stepTrigger">${optionsHtml(triggers, step.trigger)}</select></div>
      ${targetEditorHtml(step)}
      <div class="field"><label>触发几率</label><input id="chance" type="number" min="0" max="1" step="0.01" value="${step.chance}"></div>
      <div class="field"><label>延迟</label><input id="delay" type="number" step="0.05" value="${step.delay}"></div>
      <div class="field"><label>重复次数</label><input id="repeat" type="number" step="1" min="1" value="${step.repeat}"></div>
      <div class="field"><label>重复间隔</label><input id="interval" type="number" min="0" step="0.05" value="${step.interval || 0}"></div>
    </div>
    <div class="line-preview" id="skillLinePreview">${escapeHtml(stepText(step))}</div>
  </div>`;
}

export function renderSteps(app: AppState, host: HTMLElement): void {
  const skill = app.currentSkill();
  if (!skill) { host.innerHTML = '<div class="pill">请选择或新建技能</div>'; return; }
  const step = app.selectedStep();
  host.innerHTML = `
    <div class="toolbar" style="margin-bottom:10px">
      <button id="addStep" class="primary">新增步骤</button>
      <button id="duplicateStep">复制步骤</button>
      <button id="removeStep" class="danger">删除步骤</button>
      <span class="pill">${skill.steps.length} 步</span>
    </div>
    <div class="step-list">${stepListHtml(app)}</div>
    ${step ? stepFormHtml(app, step) : ""}
    ${step ? mechanicPickerHtml(app) : ""}
    ${step ? conditionsHtml(app, step) : ""}`;
  if (step) initTargetEditor(app, step);
}

/** 局部刷新：写回步骤后仅更新行文本与导出面板，避免整页重渲染打断输入焦点。 */
function refreshDerived(app: AppState): void {
  const step = app.selectedStep();
  const preview = document.getElementById("skillLinePreview");
  if (step && preview) preview.textContent = stepText(step);
  renderOutput(app, byId("outputPanel"));
}

export function bindSteps(app: AppState): void {
  const body = byId("centerBody");

  // 步骤增删改（结构性变化，整页重渲染）。
  delegate(body, "click", "#addStep", () => app.addStep());
  delegate(body, "click", "#duplicateStep", () => app.duplicateStep());
  delegate(body, "click", "#removeStep", () => app.removeStep());
  delegate(body, "click", "[data-select-step]", (el) => {
    app.selectStep(el.dataset.selectStep as string);
    app.render();
  });

  // 步骤基础字段（就地写回，不打断焦点）。
  const applyStepField = () => {
    const step = app.selectedStep();
    if (!step) return;
    step.name = (byId<HTMLInputElement>("stepName")).value;
    step.trigger = (byId<HTMLSelectElement>("stepTrigger")).value;
    step.chance = clamp01((byId<HTMLInputElement>("chance")).value);
    step.delay = number((byId<HTMLInputElement>("delay")).value);
    step.repeat = Math.max(1, Math.floor(number((byId<HTMLInputElement>("repeat")).value)));
    step.interval = Math.max(0, number((byId<HTMLInputElement>("interval")).value));
    app.touch();
    refreshDerived(app);
  };
  ["stepName", "chance", "delay", "repeat", "interval"].forEach((id) => {
    delegate(body, "input", `#${id}`, applyStepField);
  });
  delegate(body, "change", "#stepTrigger", applyStepField);

  // 目标选择器：几何/结构字段重建表达式；表达式框直接写回。复用 target.ts。
  const rebuildTarget = (el: HTMLElement) => {
    const step = app.selectedStep();
    if (!step || !TARGET_REBUILD_IDS.has(el.id)) return;
    buildTargetFromEditor(app, step);
    app.touch();
    refreshDerived(app);
  };
  delegate(body, "input", "[id^='target']", rebuildTarget);
  delegate(body, "change", "[id^='target']", rebuildTarget);
  delegate(body, "input", "#targetSelector", () => {
    const step = app.selectedStep();
    if (!step) return;
    writeTargetToStep(app, step);
    app.touch();
    refreshDerived(app);
  });
  delegate(body, "input", "#maxTargets", () => {
    const step = app.selectedStep();
    if (!step) return;
    writeTargetToStep(app, step);
    app.touch();
    refreshDerived(app);
  });
  delegate(body, "click", "#addTargetPoint", () => {
    const step = app.selectedStep();
    if (step) { addTargetPoint(app, step); app.touch(); refreshDerived(app); }
  });
  delegate(body, "click", "[data-remove-target-point]", (el) => {
    const step = app.selectedStep();
    if (step) { removeTargetPoint(app, step, Number(el.dataset.removeTargetPoint)); app.touch(); refreshDerived(app); }
  });

  // 机制选择器。
  delegate(body, "click", "[data-mechanic-category]", (el) => {
    app.mechanicCategory = el.dataset.mechanicCategory as string;
    app.render();
  });
  delegate(body, "click", "[data-mechanic]", (el) => {
    app.selectMechanic(el.dataset.mechanic as string);
    app.render();
  });
  delegate(body, "input", "[data-param]", (el) => {
    app.mechanicParams[(el as HTMLElement).dataset.param as string] = (el as HTMLInputElement).value;
  });
  delegate(body, "change", "[data-param]", (el) => {
    app.mechanicParams[(el as HTMLElement).dataset.param as string] = (el as HTMLSelectElement).value;
  });
  delegate(body, "click", "#applyMechanic", () => {
    app.applyMechanicToStep();
    app.render();
  });

  // 量化条件。
  delegate(body, "change", "#conditionType", (el) => {
    app.syncConditionDraftType((el as HTMLSelectElement).value);
    app.render();
  });
  delegate(body, "change", "#conditionScope", (el) => { app.conditionDraft.scope = (el as HTMLSelectElement).value as Condition["scope"]; });
  delegate(body, "change", "#conditionOperator", (el) => { app.conditionDraft.operator = (el as HTMLSelectElement).value as CompareOperator; });
  delegate(body, "input", "#conditionValue", (el) => { app.conditionDraft.value = number((el as HTMLInputElement).value); });
  delegate(body, "input", "#conditionParam", (el) => { app.conditionDraft.param = (el as HTMLInputElement).value; });
  delegate(body, "click", "#addCondition", () => { app.addConditionFromDraft(); app.render(); });
  delegate(body, "click", "#clearConditions", () => { app.clearConditions(); app.render(); });
  delegate(body, "click", "[data-remove-condition]", (el) => {
    app.removeCondition((el as HTMLElement).dataset.removeCondition as string);
    app.render();
  });
}
