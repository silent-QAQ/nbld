// 技能行编译到结构表（§123 / §129）。移植自旧编辑器 compile()，并新增 skill_modifiers。
import type { Condition, Skill, Step } from "./model/types";
import type {
  CompileResult,
  SkillConditionGroupRow,
  SkillConditionRow,
  SkillMechanicRow,
  SkillModifierRow,
  SkillStepRow,
} from "./model/output";
import { conditionMeta } from "./data/conditions";
import { operatorSymbols } from "./data/common";
import { normalizedTargeterParams, targeterText } from "./targeter";
import { validateSkill } from "./validate";

function inferredConditionScope(type: string): string {
  return conditionMeta(type).scope || "target";
}

/** 条件导出文本（无空格），如 target.target_hp_ratio<0.35。 */
export function conditionText(condition: Condition): string {
  const param = condition.param ? `:${condition.param}` : "";
  const scope = condition.scope || inferredConditionScope(condition.type);
  return `${scope}.${condition.type}${param}${operatorSymbols[condition.operator]}${condition.value}`;
}

/** 单条技能行文本（§118 固定格式）。 */
export function stepText(step: Step): string {
  const params = Object.entries(step.mechanic)
    .filter(([key]) => key !== "id")
    .map(([key, value]) => `${key}=${value}`)
    .join(";");
  const cond = step.conditions.length
    ? ` ${step.conditions.map((c) => `?${conditionText(c)}`).join(" ")}`
    : "";
  const timing = [
    step.chance < 1 ? `chance=${step.chance}` : "",
    step.delay > 0 ? `delay=${step.delay}` : "",
    step.repeat > 1 ? `repeat=${step.repeat}` : "",
    step.interval > 0 ? `interval=${step.interval}` : "",
  ].filter(Boolean).join(";");
  return `${step.mechanic.id}{${params}} ${targeterText(step)} ~${step.trigger}${timing ? `{${timing}}` : ""}${cond}`;
}

/** 将编辑态技能编译为完整结构表产物。 */
export function compile(skill: Skill): CompileResult {
  const main = {
    skill_id: skill.skill_id.trim(),
    skill_name: skill.skill_name.trim(),
    skill_group: skill.skill_group.trim(),
    skill_desc: skill.skill_desc.trim(),
    icon: skill.icon.trim(),
    rarity: skill.rarity,
    slot_type: skill.slot_type,
    skill_type: skill.skill_type,
    target_type: skill.target_type,
    cooldown: skill.cooldown,
    stamina_cost: skill.stamina_cost,
    mana_cost: skill.mana_cost,
    default_trigger: skill.default_trigger,
    weapon_tags: skill.weapon_tags,
    offhand_tags: skill.offhand_tags,
  };

  const steps: SkillStepRow[] = [];
  const mechanicsOut: SkillMechanicRow[] = [];
  const conditionsOut: SkillConditionRow[] = [];
  const conditionGroupsOut: SkillConditionGroupRow[] = [];

  skill.steps.forEach((step, index) => {
    const stepId = `step_${main.skill_id}_${index + 1}`;
    const conditionGroupId = step.conditions.length ? `cg_${main.skill_id}_${index + 1}` : "";
    steps.push({
      step_id: stepId,
      skill_id: main.skill_id,
      trigger: step.trigger,
      targeter: step.targeter,
      target_selector: step.target_selector || step.targeter,
      targeter_params: normalizedTargeterParams(step),
      chance: step.chance,
      delay: step.delay,
      repeat: step.repeat,
      interval: step.interval || 0,
      condition_group_id: conditionGroupId,
    });
    const mechanicParams = Object.fromEntries(
      Object.entries(step.mechanic).filter(([key]) => key !== "id"),
    );
    mechanicsOut.push({
      mechanic_id: `mech_${main.skill_id}_${index + 1}`,
      step_id: stepId,
      skill_id: main.skill_id,
      mechanic_type: step.mechanic.id,
      mechanic_params: mechanicParams,
    });
    if (conditionGroupId) {
      conditionGroupsOut.push({
        condition_group_id: conditionGroupId,
        step_id: stepId,
        skill_id: main.skill_id,
        logic: "AND",
      });
    }
    step.conditions.forEach((condition, conditionIndex) => {
      conditionsOut.push({
        condition_id: `cond_${main.skill_id}_${index + 1}_${conditionIndex + 1}`,
        condition_group_id: conditionGroupId,
        step_id: stepId,
        skill_id: main.skill_id,
        condition_scope: condition.scope || inferredConditionScope(condition.type),
        condition_type: condition.type,
        compare_operator: condition.operator,
        value: condition.value,
        param: condition.param,
      });
    });
  });

  const modifiersOut: SkillModifierRow[] = skill.modifiers.map((modifier, index) => ({
    modifier_id: `mod_${main.skill_id}_${index + 1}`,
    skill_id: main.skill_id,
    source: modifier.source,
    source_ref: modifier.source_ref,
    target_field: modifier.target_field,
    mode: modifier.mode,
    value: modifier.value,
    note: modifier.note,
  }));

  return {
    skill: main,
    skill_steps: steps,
    skill_mechanics: mechanicsOut,
    skill_condition_groups: conditionGroupsOut,
    skill_conditions: conditionsOut,
    skill_modifiers: modifiersOut,
    skill_text: skill.steps.map(stepText),
    issues: validateSkill(skill),
  };
}
