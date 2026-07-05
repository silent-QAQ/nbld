// 技能库面板（§10.1）：列表 / 筛选 / 搜索 / 新建 / 导入导出。
import type { AppState } from "../state";
import type { Skill } from "../model/types";
import { byId, delegate, optionsHtml } from "../dom";
import { slotTypes, rarities, weapons } from "../data/common";
import { skillTypes } from "../data/common";
import { createSkill } from "../factory";
import { exportLibrary, parseImport } from "../store";
import { escapeHtml, uid } from "../util";

function label(entries: readonly (readonly [string, string])[], value: string): string {
  return entries.find(([v]) => v === value)?.[1] ?? value;
}

function matches(skill: Skill, f: AppState["filter"]): boolean {
  if (f.slot && skill.slot_type !== f.slot) return false;
  if (f.rarity && skill.rarity !== f.rarity) return false;
  if (f.weapon && !skill.weapon_tags.includes(f.weapon)) return false;
  if (f.keyword) {
    const kw = f.keyword.toLowerCase();
    const hay = `${skill.skill_name} ${skill.skill_id} ${skill.skill_group}`.toLowerCase();
    if (!hay.includes(kw)) return false;
  }
  return true;
}

export function renderLibrary(app: AppState, host: HTMLElement): void {
  const f = app.filter;
  const filtered = app.library.filter((s) => matches(s, f));
  host.innerHTML = `
    <div class="panel-header">
      <h2>技能库</h2>
      <span class="pill">${filtered.length}/${app.library.length}</span>
    </div>
    <div class="panel-body">
      <div class="library-filter">
        <input id="libKeyword" placeholder="搜索名称 / ID / 技能组" value="${escapeHtml(f.keyword)}">
        <div class="grid">
          <div class="field"><label>槽位</label><select id="libSlot"><option value="">全部</option>${optionsHtml(slotTypes, f.slot)}</select></div>
          <div class="field"><label>武器</label><select id="libWeapon"><option value="">全部</option>${optionsHtml(weapons, f.weapon)}</select></div>
          <div class="field"><label>稀有度</label><select id="libRarity"><option value="">全部</option>${optionsHtml(rarities, f.rarity)}</select></div>
          <div class="field"><label>&nbsp;</label><button id="libClear">清除筛选</button></div>
        </div>
      </div>
      <div class="library-list" id="libList">
        ${filtered.map((skill) => libraryItem(skill, skill.id === app.selectedSkillId)).join("") || '<div class="pill">无匹配技能</div>'}
      </div>
      <div class="toolbar" style="margin-top:10px">
        <button data-lib-action="duplicate">复制技能</button>
        <button data-lib-action="delete" class="danger">删除技能</button>
      </div>
    </div>`;
}

function libraryItem(skill: Skill, selected: boolean): string {
  const updated = new Date(skill.updated_at).toLocaleString("zh-CN", { hour12: false });
  return `<article class="library-item${selected ? " selected" : ""}" data-skill="${escapeHtml(skill.id)}">
    <strong class="rarity-${skill.rarity}">${escapeHtml(skill.skill_name || "未命名")}</strong>
    <span class="meta">${escapeHtml(skill.skill_id)} · ${label(skillTypes, skill.skill_type)} · ${label(slotTypes, skill.slot_type)}</span>
    <span class="meta">冷却 ${skill.cooldown}s · 耐 ${skill.stamina_cost} / 蓝 ${skill.mana_cost} · ${skill.steps.length} 步</span>
    <span class="meta">${updated}</span>
  </article>`;
}

export function bindLibrary(app: AppState): void {
  const panel = byId("libraryPanel");

  delegate(panel, "click", "[data-skill]", (el) => {
    app.selectSkill(el.dataset.skill as string);
    app.render();
  });
  delegate(panel, "input", "#libKeyword", (el) => {
    app.filter.keyword = (el as HTMLInputElement).value;
    renderLibrary(app, panel);
  });
  delegate(panel, "change", "#libSlot", (el) => { app.filter.slot = (el as HTMLSelectElement).value; renderLibrary(app, panel); });
  delegate(panel, "change", "#libWeapon", (el) => { app.filter.weapon = (el as HTMLSelectElement).value; renderLibrary(app, panel); });
  delegate(panel, "change", "#libRarity", (el) => { app.filter.rarity = (el as HTMLSelectElement).value; renderLibrary(app, panel); });
  delegate(panel, "click", "#libClear", () => {
    app.filter = { slot: "", weapon: "", rarity: "", keyword: "" };
    renderLibrary(app, panel);
  });
  delegate(panel, "click", '[data-lib-action="duplicate"]', () => duplicateSkill(app));
  delegate(panel, "click", '[data-lib-action="delete"]', () => deleteSkill(app));

  byId("newSkill").addEventListener("click", () => {
    const id = `skill_new_${Math.random().toString(36).slice(2, 6)}`;
    const skill = createSkill(id, "新技能");
    app.library.push(skill);
    app.selectSkill(skill.id);
    app.persist();
    app.render();
  });
  byId("exportLib").addEventListener("click", () => downloadText(exportLibrary(app.library), "skill_library.json"));
  byId("importLib").addEventListener("click", () => byId<HTMLInputElement>("importFile").click());
  byId<HTMLInputElement>("importFile").addEventListener("change", (event) => onImport(app, event));
}

function duplicateSkill(app: AppState): void {
  const skill = app.currentSkill();
  if (!skill) return;
  const copy = JSON.parse(JSON.stringify(skill)) as Skill;
  copy.id = uid("skill");
  copy.skill_id = `${skill.skill_id}_copy`;
  copy.skill_name = `${skill.skill_name}副本`;
  copy.updated_at = Date.now();
  app.library.push(copy);
  app.selectSkill(copy.id);
  app.persist();
  app.render();
}

function deleteSkill(app: AppState): void {
  if (app.library.length <= 1) return;
  const skill = app.currentSkill();
  if (!skill) return;
  if (!confirm(`确认删除技能「${skill.skill_name}」？此操作不可撤销。`)) return;
  app.library = app.library.filter((s) => s.id !== skill.id);
  app.selectSkill(app.library[0].id);
  app.persist();
  app.render();
}

function onImport(app: AppState, event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = parseImport(String(reader.result));
      const existingIds = new Set(app.library.map((s) => s.skill_id));
      imported.forEach((skill) => {
        skill.id = uid("skill");
        if (existingIds.has(skill.skill_id)) skill.skill_id = `${skill.skill_id}_imported`;
        existingIds.add(skill.skill_id);
        app.library.push(skill);
      });
      if (imported[0]) app.selectSkill(app.library[app.library.length - imported.length].id);
      app.persist();
      app.render();
      alert(`已导入 ${imported.length} 个技能`);
    } catch (err) {
      alert(`导入失败：${(err as Error).message}`);
    }
  };
  reader.readAsText(file);
  input.value = "";
}

function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export { downloadText };
