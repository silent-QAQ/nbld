// 测试预览页（§10.7）：选择施法者攻防/暴击、假人防御/血量，实时估算每一步的伤害/治疗/资源/控制结果。
// 【口径】按《属性配置表字段文档》§13.4 第一版公式：
//   main_damage：吃增伤、可暴击、吃防御；extra_damage：不吃增伤、不暴击、吃防御。
//   防御减伤采用 defense/(defense+K) 口径，K=100，属编辑器估算，非服务端权威结算。
import type { AppState } from "../state";
import type { Step } from "../model/types";
import { byId, delegate } from "../dom";
import { mechanicById, mechanicLabel } from "../data/mechanics";
import { escapeHtml, number } from "../util";

const DEFENSE_K = 100;

interface Estimate {
  index: number;
  name: string;
  mechanic: string;
  detail: string;
  value: string;
}

/** 防御减伤系数（0-1，越大减伤越多）。 */
function mitigation(defense: number): number {
  const d = Math.max(0, defense);
  return d / (d + DEFENSE_K);
}

/** 估算单步骤结果（伤害/治疗/资源/持续/控制）。 */
function estimateStep(step: Step, index: number, prev: AppState["preview"]): Estimate {
  const m = step.mechanic as Record<string, unknown>;
  const id = step.mechanic.id;
  const name = step.name || `步骤${index + 1}`;
  const mechName = mechanicLabel(id);
  const damageType = String(m.damage_type ?? "physical");
  const attack = damageType === "magical" ? prev.magic_attack : prev.physical_attack;
  const crit = damageType === "magical" ? prev.magic_crit : prev.physical_crit;
  const ratio = number(m.ratio);
  const flat = number(m.flat);

  const base: Estimate = { index, name, mechanic: mechName, detail: "", value: "—" };

  if (id === "damage" || id === "projectile" || id === "ray" || id === "area" || id === "orbit") {
    const isExtra = m.extra_damage === true || m.extra_damage === "true";
    const raw = attack * ratio + flat;
    const mit = mitigation(prev.target_defense);
    const bonus = isExtra ? 1 : 1 + prev.damage_bonus;
    const afterDef = raw * (1 - mit) * bonus;
    const canCrit = !isExtra && (m.can_crit === true || m.can_crit === "true");
    const critMul = canCrit ? 1 + prev.crit_damage_bonus : 1;
    const hit = afterDef;
    const expected = canCrit ? afterDef * (1 - crit) + afterDef * crit * (1 + prev.crit_damage_bonus) : afterDef;
    base.detail = `${damageType === "magical" ? "法术" : "物理"} · ${attack.toFixed(0)}×${ratio}${flat ? `+${flat}` : ""} · 减伤${(mit * 100).toFixed(0)}%${isExtra ? " · 追加(不暴击/不增伤)" : canCrit ? ` · 暴击${(crit * 100).toFixed(0)}%×${critMul.toFixed(2)}` : ""}`;
    base.value = canCrit
      ? `期望 ${expected.toFixed(1)}（普 ${hit.toFixed(1)} / 暴 ${(hit * critMul).toFixed(1)}）`
      : `${hit.toFixed(1)}`;
    return base;
  }
  if (id === "dot") {
    const perTick = attack * ratio * (1 - mitigation(prev.target_defense));
    const duration = number(m.duration);
    const tick = Math.max(0.01, number(m.tick));
    const ticks = Math.max(1, Math.floor(duration / tick));
    base.detail = `每跳 ${perTick.toFixed(1)} × ${ticks} 跳（${duration}s / ${tick}s）`;
    base.value = `合计 ${(perTick * ticks).toFixed(1)}`;
    return base;
  }
  if (id === "heal") {
    const raw = attack * ratio + flat;
    base.detail = `法攻/攻击 ${attack.toFixed(0)}×${ratio}${flat ? `+${flat}` : ""} · 不吃防御`;
    base.value = `${raw.toFixed(1)}`;
    return base;
  }
  if (id === "shield") {
    const raw = attack * ratio + flat;
    base.detail = `护盾量 ${attack.toFixed(0)}×${ratio}${flat ? `+${flat}` : ""} · 持续 ${number(m.duration)}s`;
    base.value = `${raw.toFixed(1)}`;
    return base;
  }
  if (id === "control") {
    base.detail = `类型 ${String(m.control)} · 持续 ${number(m.duration)}s`;
    base.value = prev.target_hp <= 0 ? "目标已死亡" : `控制 ${number(m.duration)}s`;
    return base;
  }
  if (id === "resource") {
    base.detail = `${String(m.resource)} · ${String(m.operation)} · ${String(m.value_type)}`;
    base.value = `${number(m.value)}`;
    return base;
  }
  if (id === "status" || id === "attribute" || id === "aura") {
    base.detail = `强度 ${number(m.value)} · 持续 ${number(m.duration)}s`;
    base.value = "状态/属性效果";
    return base;
  }
  base.detail = mechanicById(id).hint;
  base.value = mechanicById(id).server ? "逻辑效果" : "表现效果";
  return base;
}

function estimatedTotalDamage(estimates: Estimate[]): number {
  return estimates.reduce((sum, e) => {
    const match = e.value.match(/期望 ([\d.]+)|合计 ([\d.]+)|^([\d.]+)$/);
    if (!match) return sum;
    return sum + Number(match[1] ?? match[2] ?? match[3] ?? 0);
  }, 0);
}

export function renderPreview(app: AppState, host: HTMLElement): void {
  const skill = app.currentSkill();
  if (!skill) { host.innerHTML = '<div class="pill">请选择技能</div>'; return; }
  const p = app.preview;
  const estimates = skill.steps.map((step, index) => estimateStep(step, index, p));
  const totalDamage = estimatedTotalDamage(estimates);
  const dps = skill.cooldown > 0 ? totalDamage / skill.cooldown : totalDamage;

  const numField = (key: keyof AppState["preview"], label: string, step = "1") =>
    `<div class="field"><label>${label}</label><input data-preview="${key}" type="number" step="${step}" value="${p[key]}"></div>`;

  const rows = estimates.map((e) => `<tr>
      <td>${e.index + 1}. ${escapeHtml(e.name)}</td>
      <td>${escapeHtml(e.mechanic)}</td>
      <td>${escapeHtml(e.detail)}</td>
      <td class="preview-num">${escapeHtml(e.value)}</td>
    </tr>`).join("");

  host.innerHTML = `
    <div class="card">
      <h3>施法者属性</h3>
      <div class="grid">
        ${numField("physical_attack", "物理攻击")}
        ${numField("magic_attack", "法术攻击")}
        ${numField("physical_crit", "物理暴击率", "0.01")}
        ${numField("magic_crit", "法术暴击率", "0.01")}
        ${numField("crit_damage_bonus", "爆伤加成", "0.05")}
        ${numField("damage_bonus", "增伤加成", "0.05")}
      </div>
    </div>
    <div class="card">
      <h3>目标假人</h3>
      <div class="grid">
        ${numField("target_hp", "生命值")}
        ${numField("target_defense", "防御")}
      </div>
    </div>
    <div class="card">
      <h3>预估结果（编辑器估算，非服务端权威）</h3>
      <div class="pill-row">
        <span class="pill">总伤害 ${totalDamage.toFixed(1)}</span>
        <span class="pill">冷却 ${skill.cooldown}s</span>
        <span class="pill">DPS ≈ ${dps.toFixed(1)}</span>
        <span class="pill">耐 ${skill.stamina_cost} / 蓝 ${skill.mana_cost}</span>
        <span class="pill${totalDamage >= p.target_hp && p.target_hp > 0 ? "" : " warn"}">${totalDamage >= p.target_hp && p.target_hp > 0 ? "可击杀假人" : "无法一轮击杀"}</span>
      </div>
      <table class="preview-table">
        <thead><tr><th>步骤</th><th>机制</th><th>口径</th><th>数值</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4">无步骤</td></tr>'}</tbody>
      </table>
    </div>`;
}

export function bindPreview(app: AppState): void {
  const body = byId("centerBody");
  delegate(body, "input", "[data-preview]", (el) => {
    const key = (el as HTMLElement).dataset.preview as keyof AppState["preview"];
    app.preview[key] = number((el as HTMLInputElement).value);
    renderPreview(app, body);
  });
}
