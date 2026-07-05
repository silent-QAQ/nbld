// 技能基础信息页（§10.2）。
import type { AppState } from "../state";
import type { Rarity } from "../model/types";
import { byId, delegate, optionsHtml } from "../dom";
import { skillTypes, slotTypes, rarities, targetTypes, triggers, weapons, offhands } from "../data/common";
import { escapeHtml } from "../util";
import { number } from "../util";

function tagChips(name: string, entries: readonly (readonly [string, string])[], selected: string[]): string {
  return entries.map(([value, label]) => {
    const checked = selected.includes(value) ? " checked" : "";
    return `<label class="chip"><input type="checkbox" data-tag="${name}" value="${value}"${checked}>${label}</label>`;
  }).join("");
}

export function renderBase(app: AppState, host: HTMLElement): void {
  const skill = app.currentSkill();
  if (!skill) { host.innerHTML = '<div class="pill">请选择技能</div>'; return; }
  host.innerHTML = `
    <div class="card">
      <h3>基础信息</h3>
      <div class="grid">
        <div class="field"><label>技能 ID</label><input data-base="skill_id" value="${escapeHtml(skill.skill_id)}"></div>
        <div class="field"><label>技能名</label><input data-base="skill_name" value="${escapeHtml(skill.skill_name)}"></div>
        <div class="field"><label>技能组</label><input data-base="skill_group" value="${escapeHtml(skill.skill_group)}"></div>
        <div class="field"><label>技能图标</label><input data-base="icon" placeholder="icon_xxx" value="${escapeHtml(skill.icon)}"></div>
        <div class="field"><label>稀有度</label><select data-base="rarity">${optionsHtml(rarities, skill.rarity)}</select></div>
        <div class="field"><label>槽位</label><select data-base="slot_type">${optionsHtml(slotTypes, skill.slot_type)}</select></div>
        <div class="field"><label>技能类型</label><select data-base="skill_type">${optionsHtml(skillTypes, skill.skill_type)}</select></div>
        <div class="field"><label>目标类型</label><select data-base="target_type">${optionsHtml(targetTypes, skill.target_type)}</select></div>
        <div class="field"><label>默认触发器</label><select data-base="default_trigger">${optionsHtml(triggers, skill.default_trigger)}</select></div>
        <div class="field"><label>冷却</label><input data-base="cooldown" type="number" step="0.1" value="${skill.cooldown}"></div>
        <div class="field"><label>耐力消耗</label><input data-base="stamina_cost" type="number" step="1" value="${skill.stamina_cost}"></div>
        <div class="field"><label>法力消耗</label><input data-base="mana_cost" type="number" step="1" value="${skill.mana_cost}"></div>
        <div class="field full"><label>主手标签</label><div class="chips">${tagChips("weapon", weapons, skill.weapon_tags)}</div></div>
        <div class="field full"><label>副手标签</label><div class="chips">${tagChips("offhand", offhands, skill.offhand_tags)}</div></div>
        <div class="field full"><label>描述（表现文案层，与数值层分离）</label><textarea data-base="skill_desc">${escapeHtml(skill.skill_desc)}</textarea></div>
      </div>
    </div>`;
}

const NUMERIC = new Set(["cooldown", "stamina_cost", "mana_cost"]);

export function bindBase(app: AppState): void {
  const body = byId("centerBody");

  const apply = (el: HTMLElement) => {
    const skill = app.currentSkill();
    if (!skill) return;
    const key = el.dataset.base as string;
    const value = (el as HTMLInputElement | HTMLSelectElement).value;
    if (NUMERIC.has(key)) {
      (skill as unknown as Record<string, number>)[key] = number(value);
    } else if (key === "rarity") {
      skill.rarity = value as Rarity;
    } else {
      (skill as unknown as Record<string, string>)[key] = value;
    }
    app.touch();
    app.render();
  };

  delegate(body, "input", "[data-base]", apply);
  delegate(body, "change", "[data-base]", apply);
  delegate(body, "change", "[data-tag]", (el) => {
    const skill = app.currentSkill();
    if (!skill) return;
    const input = el as HTMLInputElement;
    const list = input.dataset.tag === "weapon" ? skill.weapon_tags : skill.offhand_tags;
    const idx = list.indexOf(input.value);
    if (input.checked && idx < 0) list.push(input.value);
    if (!input.checked && idx >= 0) list.splice(idx, 1);
    app.touch();
    app.render();
  });
}
