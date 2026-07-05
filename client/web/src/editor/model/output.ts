// 编译产物结构表类型，严格对齐《技能系统设计文档》§129 编辑器导出第二版。
import type { Issue, MechanicValues } from "./types";

export interface SkillMainTable {
  skill_id: string;
  skill_name: string;
  skill_group: string;
  skill_desc: string;
  icon: string;
  rarity: string;
  slot_type: string;
  skill_type: string;
  target_type: string;
  cooldown: number;
  stamina_cost: number;
  mana_cost: number;
  default_trigger: string;
  weapon_tags: string[];
  offhand_tags: string[];
}

export interface SkillStepRow {
  step_id: string;
  skill_id: string;
  trigger: string;
  targeter: string;
  target_selector: string;
  targeter_params: {
    range: number;
    radius: number;
    inner_radius: number;
    angle: number;
    arc: number;
    width: number;
    max_targets: number;
  };
  chance: number;
  delay: number;
  repeat: number;
  interval: number;
  condition_group_id: string;
}

export interface SkillMechanicRow {
  mechanic_id: string;
  step_id: string;
  skill_id: string;
  mechanic_type: string;
  mechanic_params: MechanicValues;
}

export interface SkillConditionGroupRow {
  condition_group_id: string;
  step_id: string;
  skill_id: string;
  logic: "AND";
}

export interface SkillConditionRow {
  condition_id: string;
  condition_group_id: string;
  step_id: string;
  skill_id: string;
  condition_scope: string;
  condition_type: string;
  compare_operator: string;
  value: number;
  param: string;
}

export interface SkillModifierRow {
  modifier_id: string;
  skill_id: string;
  source: string;
  source_ref: string;
  target_field: string;
  mode: string;
  value: number;
  note: string;
}

/** 完整编译结果。 */
export interface CompileResult {
  skill: SkillMainTable;
  skill_steps: SkillStepRow[];
  skill_mechanics: SkillMechanicRow[];
  skill_condition_groups: SkillConditionGroupRow[];
  skill_conditions: SkillConditionRow[];
  skill_modifiers: SkillModifierRow[];
  skill_text: string[];
  issues: Issue[];
}
