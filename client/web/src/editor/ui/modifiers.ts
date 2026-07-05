// 联动修正页（§10.5 / §14 skill_modifiers）：展示并编辑哪些系统在修改本技能的哪个字段、如何叠加。
import type { AppState } from "../state";
import type { Modifier, ModifierMode, ModifierSource } from "../model/types";
import { byId, delegate, optionsHtml } from "../dom";
import { modifierSources, modifierModes } from "../data/common";
import { escapeHtml, number, uid } from "../util";

function label(entries: readonly (readonly [string, string])[], value: string): string {
  return entries.find(([v]) => v === value)?.[1] ?? value;
}

function modeSymbol(mode: ModifierMode): string {
  return mode === "add" ? "+" : mode === "mul" ? "×" : "=";
}

/** 可被修正的字段提示，帮助策划理解 target_field 语法。 */
const TARGET_FIELD_HINTS: readonly string[] = [
  "step.<序号>.enabled",
  "mechanic.<序号>.ratio",
  "mechanic.<序号>.flat",
  "targeter_params.<序号>.range",
  "cooldown",
  "stamina_cost",
];

function modifierRow(app: AppState, modifier: Modifier): string {
  const desc = `${label(modifierSources, modifier.source)} · ${escapeHtml(modifier.source_ref || "-")}`;
  const rule = `${escapeHtml(modifier.target_field || "?")} ${modeSymbol(modifier.mode)} ${modifier.value}`;
  return `<div class="mini-item" data-modifier="${escapeHtml(modifier.id)}">
    <span><strong>${desc}</strong><br>${rule}${modifier.note ? ` · ${escapeHtml(modifier.note)}` : ""}</span>
    <button data-remove-modifier="${escapeHtml(modifier.id)}" title="删除">×</button>
  </div>`;
}

export function renderModifiers(app: AppState, host: HTMLElement): void {
  const skill = app.currentSkill();
  if (!skill) { host.innerHTML = '<div class="pill">请选择技能</div>'; return; }
  const draft = app.modifierDraft;
  host.innerHTML = `
    <div class="card">
      <h3>联动修正</h3>
      <p style="color:var(--muted);font-size:12px;margin:0">
        展示武器模板 / 副手 / 天赋 / 被动 / 词条对本技能的字段修正与叠加方式。运行时按 加法 → 乘法 → 覆盖 顺序结算。
      </p>
      <div class="mini-list">
        ${skill.modifiers.length ? skill.modifiers.map((m) => modifierRow(app, m)).join("") : '<div class="pill">暂无修正，可在下方添加</div>'}
      </div>
    </div>
    <div class="card">
      <h3>新增修正</h3>
      <div class="grid">
        <div class="field"><label>来源</label><select data-mod-draft="source">${optionsHtml(modifierSources, draft.source)}</select></div>
        <div class="field"><label>来源引用</label><input data-mod-draft="source_ref" placeholder="spear / tianqu_pojun_core" value="${escapeHtml(draft.source_ref)}"></div>
        <div class="field"><label>目标字段</label><input data-mod-draft="target_field" list="modTargetFields" placeholder="mechanic.1.ratio" value="${escapeHtml(draft.target_field)}"></div>
        <div class="field"><label>叠加模式</label><select data-mod-draft="mode">${optionsHtml(modifierModes, draft.mode)}</select></div>
        <div class="field"><label>数值</label><input data-mod-draft="value" type="number" step="0.01" value="${draft.value}"></div>
        <div class="field full"><label>备注</label><input data-mod-draft="note" placeholder="破军核心激活时开放低血追击" value="${escapeHtml(draft.note)}"></div>
      </div>
      <datalist id="modTargetFields">${TARGET_FIELD_HINTS.map((h) => `<option value="${h}">`).join("")}</datalist>
      <div class="toolbar"><button id="addModifier" class="primary">添加修正</button></div>
    </div>`;
}

export function bindModifiers(app: AppState): void {
  const body = byId("centerBody");

  delegate(body, "input", "[data-mod-draft]", (el) => {
    const key = (el as HTMLElement).dataset.modDraft as keyof AppState["modifierDraft"];
    const value = (el as HTMLInputElement | HTMLSelectElement).value;
    if (key === "value") app.modifierDraft.value = number(value);
    else if (key === "source") app.modifierDraft.source = value as ModifierSource;
    else if (key === "mode") app.modifierDraft.mode = value as ModifierMode;
    else app.modifierDraft[key] = value;
  });
  delegate(body, "change", "[data-mod-draft]", (el) => {
    const key = (el as HTMLElement).dataset.modDraft as keyof AppState["modifierDraft"];
    if (key === "source" || key === "mode") {
      app.modifierDraft[key] = (el as HTMLSelectElement).value as ModifierSource & ModifierMode;
    }
  });

  delegate(body, "click", "#addModifier", () => {
    const skill = app.currentSkill();
    if (!skill) return;
    const d = app.modifierDraft;
    if (!d.target_field.trim()) { alert("请填写目标字段，如 mechanic.1.ratio"); return; }
    skill.modifiers.push({
      id: uid("mod"),
      source: d.source,
      source_ref: d.source_ref.trim(),
      target_field: d.target_field.trim(),
      mode: d.mode,
      value: d.value,
      note: d.note.trim(),
    });
    app.resetModifierDraft();
    app.touch();
    app.render();
  });

  delegate(body, "click", "[data-remove-modifier]", (el) => {
    const skill = app.currentSkill();
    if (!skill) return;
    const id = (el as HTMLElement).dataset.removeModifier;
    skill.modifiers = skill.modifiers.filter((m) => m.id !== id);
    app.touch();
    app.render();
  });
}
