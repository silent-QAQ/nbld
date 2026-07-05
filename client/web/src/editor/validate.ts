// 技能校验（§12 / §129.5）。基础静态+逻辑校验移植自旧编辑器；
// 平衡校验与资源缺失校验作为可选增强，通过 ValidateContext 注入技能库。
import type { Condition, Issue, MechanicState, Skill, Step } from "./model/types";
import { conditionTypes } from "./data/conditions";
import { conditionScopes } from "./data/common";
import { mechanics, mechanicById, mechanicLabel } from "./data/mechanics";
import { normalizedTargeterParams } from "./targeter";
import { number } from "./util";

/** 校验上下文：提供技能库以做引用完整性/平衡校验（可选）。 */
export interface ValidateContext {
  /** 全部技能，用于 meta/effect_ref/skill_ref 引用检查。 */
  library?: Skill[];
}

function parseRangeSelectorParams(selector: string): Record<string, string> {
  const match = selector.match(/\+o\(([^)]*)\)/);
  if (!match) return {};
  return match[1].split(",").reduce<Record<string, string>>((params, part) => {
    const [rawKey, ...rawValue] = part.split("=");
    const key = (rawKey || "").trim();
    const value = rawValue.join("=").trim();
    if (key) params[key] = value;
    return params;
  }, {});
}

function validateTargetSelector(step: Step, line: number): Issue[] {
  const issues: Issue[] = [];
  const selector = (step.target_selector || "").trim();
  if (!selector) {
    issues.push({ line, level: "bad", text: "缺少目标选择器表达式" });
    return issues;
  }
  if (!selector.startsWith("@")) issues.push({ line, level: "bad", text: "目标选择器必须以 @ 开头" });
  if (["@p", "@e", "@pl"].includes(step.targeter) && !/^@(p|e|pl)\(.+\)$/.test(selector)) {
    issues.push({ line, level: "bad", text: `${step.targeter} 选择器必须使用括号参数` });
  }
  if (["@bj", "@fw"].includes(step.targeter) && !/^@(bj|fw)=\(.+\)$/.test(selector)) {
    issues.push({ line, level: "bad", text: `${step.targeter} 范围选择器必须使用 =(...)` });
  }
  if (["@o", "@el"].includes(step.targeter)) {
    if (!selector.includes("+o(")) {
      issues.push({ line, level: "bad", text: `${step.targeter} 范围选择器必须包含 +o(...)` });
    } else {
      const params = parseRangeSelectorParams(selector);
      const outerRadius = number(params.r);
      const innerRadius = params.ir === undefined ? null : number(params.ir);
      const hasArcStart = params.ag !== undefined;
      const hasArcWidth = params.c !== undefined || params.ctc !== undefined;
      if (outerRadius <= 0) issues.push({ line, level: "bad", text: `${step.targeter} 圆/扇/环范围必须配置 r 外半径` });
      if (innerRadius !== null && (innerRadius < 0 || innerRadius >= outerRadius)) {
        issues.push({ line, level: "bad", text: `${step.targeter} 环形内半径 ir 必须大于等于 0 且小于 r` });
      }
      if (hasArcStart !== hasArcWidth) {
        issues.push({ line, level: "bad", text: `${step.targeter} 扇形/扇环必须同时配置 ag 与 c 或 ctc` });
      }
      if (hasArcWidth) {
        const arcWidth = params.c !== undefined ? number(params.c) : number(params.ctc);
        if (arcWidth <= 0 || arcWidth > 360) issues.push({ line, level: "bad", text: `${step.targeter} 扇形/扇环角度宽度必须在 0 到 360 之间` });
      }
    }
  }
  return issues;
}

function validateMechanic(mechanic: MechanicState, line: number): Issue[] {
  const issues: Issue[] = [];
  const numericFields = ["ratio", "flat", "duration", "tick", "range", "radius", "width", "length", "speed", "distance", "value", "count", "max_count", "max_targets", "strength", "jumps", "falloff", "collision_radius", "trigger_radius", "trigger_limit", "max_stage", "hit_interval", "max_stack", "shield_duration", "spread_angle", "homing_strength", "max_pierce", "arm_time", "scale", "rotation", "volume", "pitch"];
  numericFields.forEach((field) => {
    if (field in mechanic && number(mechanic[field]) < 0) issues.push({ line, level: "bad", text: `${mechanic.id}.${field} 不能为负数` });
  });
  if (["area", "aura", "dot"].includes(mechanic.id) && number(mechanic.duration) <= 0) {
    issues.push({ line, level: "bad", text: `${mechanicLabel(mechanic.id)}必须配置持续时间` });
  }
  if (["area", "aura", "dot"].includes(mechanic.id) && number(mechanic.tick) <= 0) {
    issues.push({ line, level: "bad", text: `${mechanicLabel(mechanic.id)}必须配置跳频` });
  }
  if (mechanic.id === "projectile" && number(mechanic.speed) <= 0) issues.push({ line, level: "bad", text: "投射物速度必须大于 0" });
  if (mechanic.id === "projectile" && number(mechanic.range) <= 0) issues.push({ line, level: "bad", text: "投射物射程必须大于 0" });
  if (mechanic.id === "projectile" && number(mechanic.count) < 1) issues.push({ line, level: "bad", text: "投射物数量至少为 1" });
  if (mechanic.id === "projectile" && mechanic.pattern === "homing" && number(mechanic.homing_strength) <= 0) issues.push({ line, level: "warn", text: "追踪投射物建议配置追踪强度" });
  if (mechanic.id === "ray" && (number(mechanic.length) <= 0 || number(mechanic.width) <= 0)) issues.push({ line, level: "bad", text: "射线长度和宽度必须大于 0" });
  if (mechanic.id === "ray" && number(mechanic.duration) > 0 && number(mechanic.tick) <= 0) issues.push({ line, level: "bad", text: "持续射线必须配置跳频" });
  if (mechanic.id === "damage") {
    if (["line", "cone"].includes(String(mechanic.shape)) && number(mechanic.range) <= 0) issues.push({ line, level: "bad", text: "伤害直线/扇形形状必须配置距离" });
    if (mechanic.shape === "line" && number(mechanic.width) <= 0) issues.push({ line, level: "bad", text: "伤害直线形状必须配置宽度" });
    if (mechanic.shape === "cone" && number(mechanic.angle) <= 0) issues.push({ line, level: "bad", text: "伤害扇形形状必须配置角度" });
    if (mechanic.shape === "circle" && number(mechanic.radius) <= 0) issues.push({ line, level: "bad", text: "伤害圆形形状必须配置半径" });
  }
  if (mechanic.id === "area" && mechanic.effect_mode === "meta" && !mechanic.effect_ref) issues.push({ line, level: "bad", text: "区域调用技能组时必须配置调用技能" });
  if (mechanic.id === "aura" && mechanic.effect_mode === "meta" && !mechanic.effect_ref) issues.push({ line, level: "bad", text: "光环调用技能组时必须配置调用技能" });
  if (mechanic.id === "summon" && number(mechanic.count) > number(mechanic.max_count)) issues.push({ line, level: "bad", text: "召唤数量不能大于召唤上限" });
  if (mechanic.id === "trap" && !mechanic.effect_ref) issues.push({ line, level: "bad", text: "陷阱必须配置触发技能" });
  if (mechanic.id === "chain" && !mechanic.effect_ref) issues.push({ line, level: "bad", text: "连锁必须配置每跳技能" });
  if (mechanic.id === "chain" && number(mechanic.jumps) < 1) issues.push({ line, level: "bad", text: "连锁跳数至少为 1" });
  if (mechanic.id === "marker" && !mechanic.marker_id) issues.push({ line, level: "bad", text: "标记点必须配置标记 ID" });
  if (mechanic.id === "orbit" && number(mechanic.count) < 1) issues.push({ line, level: "bad", text: "环绕物数量至少为 1" });
  if (mechanic.id === "force" && number(mechanic.tick) <= 0) issues.push({ line, level: "bad", text: "力场必须配置跳频" });
  if (mechanic.id === "modify_projectile" && !mechanic.projectile_tag) issues.push({ line, level: "bad", text: "修改投射物必须配置投射物标签" });
  if (mechanic.id === "cooldown" && !mechanic.target_skill) issues.push({ line, level: "bad", text: "冷却机制必须配置目标技能" });
  if (mechanic.id === "vfx" && !mechanic.vfx_id) issues.push({ line, level: "bad", text: "特效必须配置 vfx_id" });
  if (mechanic.id === "sfx" && !mechanic.sfx_id) issues.push({ line, level: "bad", text: "音效必须配置 sfx_id" });
  if (mechanic.id === "hitstop" && number(mechanic.duration) > 0.12) issues.push({ line, level: "warn", text: "顿帧持续时间建议不超过 0.12 秒" });
  if (mechanic.id === "meta" && !mechanic.skill_ref) issues.push({ line, level: "bad", text: "技能组机制必须配置调用技能" });
  return issues;
}

function validateCondition(condition: Condition, line: number): Issue[] {
  const issues: Issue[] = [];
  const knownMeta = conditionTypes.find((item) => item.id === condition.type);
  const meta = knownMeta || conditionTypes[0];
  if (!knownMeta) issues.push({ line, level: "bad", text: `未知条件 ${condition.type}` });
  if (!conditionScopes.some(([scope]) => scope === condition.scope)) issues.push({ line, level: "bad", text: `未知条件作用域 ${condition.scope}` });
  if (!meta.operators.includes(condition.operator)) issues.push({ line, level: "bad", text: `${condition.type} 不支持比较符 ${condition.operator}` });
  if (condition.value < meta.min || condition.value > meta.max) issues.push({ line, level: "bad", text: `${condition.type} 数值超出范围 ${meta.min}-${meta.max}` });
  if (meta.paramRequired && !condition.param) issues.push({ line, level: "bad", text: `${condition.type} 必须填写参数` });
  return issues;
}

function validateStep(step: Step, line: number): Issue[] {
  const issues: Issue[] = [];
  if (!step.name) issues.push({ line, level: "bad", text: "步骤缺少名称" });
  if (!step.mechanic || !step.mechanic.id) issues.push({ line, level: "bad", text: "步骤缺少机制效果" });
  if (step.chance < 0 || step.chance > 1) issues.push({ line, level: "bad", text: "触发几率越界" });
  if (step.repeat < 1) issues.push({ line, level: "bad", text: "重复次数至少为 1" });
  if (step.repeat > 1 && (step.interval || 0) <= 0) issues.push({ line, level: "warn", text: "重复执行建议配置重复间隔" });
  const targeterParams = normalizedTargeterParams(step);
  if (targeterParams.max_targets < 1) issues.push({ line, level: "bad", text: "目标上限至少为 1" });
  if (["@t", "@np", "@ne", "@p", "@e", "@tlo", "@zp"].includes(step.targeter) && targeterParams.range <= 0) {
    issues.push({ line, level: "bad", text: "该目标选择器需要配置最远距离" });
  }
  if (["@p", "@e", "@pl", "@bj", "@fw"].includes(step.targeter) && !(step.target_selector || "").includes("(")) {
    issues.push({ line, level: "warn", text: `${step.targeter} 通常需要填写选择器参数` });
  }
  validateTargetSelector(step, line).forEach((issue) => issues.push(issue));
  if (step.mechanic.id === "meta" && Number(step.mechanic.max_depth) > 3) {
    issues.push({ line, level: "warn", text: "技能组调用深度建议不超过 3" });
  }
  const mechanicInfo = mechanics.find((item) => item.id === step.mechanic.id);
  if (mechanicInfo && !mechanicInfo.targeters.includes(step.targeter)) {
    issues.push({ line, level: "warn", text: `${mechanicLabel(step.mechanic.id)}通常不建议使用目标器 ${step.targeter}` });
  }
  validateMechanic(step.mechanic, line).forEach((issue) => issues.push(issue));
  step.conditions.forEach((condition) => {
    validateCondition(condition, line).forEach((issue) => issues.push(issue));
  });
  return issues;
}

/** 逐步骤运行全部校验，返回问题清单。context 提供技能库时启用引用/平衡校验。 */
export function validateSkill(skill: Skill, context: ValidateContext = {}): Issue[] {
  const issues: Issue[] = [];
  if (!skill.skill_id.trim()) issues.push({ line: 0, level: "bad", text: "技能缺少 skill_id" });
  if (!skill.skill_name.trim()) issues.push({ line: 0, level: "bad", text: "技能缺少技能名" });
  if (skill.cooldown < 0) issues.push({ line: 0, level: "bad", text: "冷却不能为负" });
  if (skill.stamina_cost < 0) issues.push({ line: 0, level: "bad", text: "耐力消耗不能为负" });
  if (skill.mana_cost < 0) issues.push({ line: 0, level: "bad", text: "法力消耗不能为负" });
  if (skill.steps.length === 0) issues.push({ line: 0, level: "bad", text: "技能至少需要 1 条技能行" });
  if (skill.steps.length > 16) issues.push({ line: 0, level: "bad", text: "单技能组最多 16 条技能行（§125）" });
  skill.steps.forEach((step, index) => {
    validateStep(step, index + 1).forEach((issue) => issues.push(issue));
  });
  logicAndBalanceIssues(skill, context).forEach((issue) => issues.push(issue));
  return issues;
}

// __VALIDATE_ENHANCED__

// 占位：Task 7 将在 __VALIDATE_ENHANCED__ 处实现逻辑/平衡/资源校验。
function logicAndBalanceIssues(_skill: Skill, _context: ValidateContext): Issue[] {
  return [];
}

export { mechanicById };

