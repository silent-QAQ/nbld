// 条件库（§121 / §127 第二版）。原样移植自旧编辑器并加类型。
import type { CompareOperator, ConditionScope } from "../model/types";

export interface ConditionMeta {
  id: string;
  label: string;
  scope: ConditionScope;
  valueType: "ratio" | "distance" | "count" | "bool" | "angle" | "number";
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  operators: CompareOperator[];
  paramRequired: boolean;
  paramHint?: string;
  hint: string;
}

export const conditionTypes: ConditionMeta[] = [
  { id: "target_hp_ratio", label: "目标血量比例", scope: "target", valueType: "ratio", min: 0, max: 1, step: 0.01, defaultValue: 0.35, operators: ["lte", "lt", "gte", "gt"], paramRequired: false, hint: "判断当前目标生命百分比，常用于斩杀、低血追击。" },
  { id: "caster_hp_ratio", label: "施法者血量比例", scope: "caster", valueType: "ratio", min: 0, max: 1, step: 0.01, defaultValue: 0.5, operators: ["lte", "lt", "gte", "gt"], paramRequired: false, hint: "判断施法者生命百分比，常用于濒死反击和防御被动。" },
  { id: "mana_ratio", label: "法力比例", scope: "caster", valueType: "ratio", min: 0, max: 1, step: 0.01, defaultValue: 0.2, operators: ["gte", "gt", "lte", "lt"], paramRequired: false, hint: "判断施法者当前法力比例。" },
  { id: "stamina_ratio", label: "耐力比例", scope: "caster", valueType: "ratio", min: 0, max: 1, step: 0.01, defaultValue: 0.2, operators: ["gte", "gt", "lte", "lt"], paramRequired: false, hint: "判断施法者当前耐力比例。" },
  { id: "distance", label: "目标距离", scope: "target", valueType: "distance", min: 0, max: 30, step: 0.1, defaultValue: 4, operators: ["lte", "lt", "gte", "gt"], paramRequired: false, hint: "判断施法者与目标的 2D 平面距离。" },
  { id: "target_count", label: "目标数量", scope: "skill", valueType: "count", min: 0, max: 20, step: 1, defaultValue: 1, operators: ["gte", "gt", "lte", "lt", "eq"], paramRequired: false, hint: "判断本次目标器选中的目标数量。" },
  { id: "hit_count", label: "连续命中数", scope: "skill", valueType: "count", min: 0, max: 50, step: 1, defaultValue: 3, operators: ["gte", "gt", "eq"], paramRequired: false, hint: "判断当前技能组或连击窗口内的连续命中次数。" },
  { id: "stack", label: "指定层数", scope: "target", valueType: "count", min: 0, max: 99, step: 1, defaultValue: 1, operators: ["gte", "gt", "lte", "lt", "eq"], paramRequired: true, paramHint: "frost / burn / armor_break", hint: "判断目标身上某类层数。" },
  { id: "has_status", label: "持有状态", scope: "target", valueType: "bool", min: 0, max: 1, step: 1, defaultValue: 1, operators: ["eq", "neq"], paramRequired: true, paramHint: "slow / freeze / shielded", hint: "判断目标是否持有指定状态。" },
  { id: "offhand", label: "副手类型", scope: "caster", valueType: "bool", min: 0, max: 1, step: 1, defaultValue: 1, operators: ["eq", "neq"], paramRequired: true, paramHint: "buckler / grimoire / gauntlet", hint: "判断施法者当前副手标签。" },
  { id: "talent", label: "天赋激活", scope: "skill", valueType: "bool", min: 0, max: 1, step: 1, defaultValue: 1, operators: ["eq", "neq"], paramRequired: true, paramHint: "tianqu_pojun_core", hint: "判断指定天赋节点是否激活。" },
  { id: "cooldown_ready", label: "技能冷却完成", scope: "skill", valueType: "bool", min: 0, max: 1, step: 1, defaultValue: 1, operators: ["eq", "neq"], paramRequired: true, paramHint: "skill_spear_dash_001", hint: "判断另一个技能是否处于可释放状态。" },
  { id: "facing_angle", label: "朝向夹角", scope: "target", valueType: "angle", min: 0, max: 180, step: 1, defaultValue: 60, operators: ["lte", "lt", "gte", "gt"], paramRequired: false, hint: "判断目标是否位于施法者朝向夹角内。" },
  { id: "line_of_sight", label: "视线无遮挡", scope: "world", valueType: "bool", min: 0, max: 1, step: 1, defaultValue: 1, operators: ["eq", "neq"], paramRequired: false, hint: "2D 射线检测是否被墙体或障碍阻挡。" },
  { id: "terrain_tag", label: "地形标签", scope: "world", valueType: "bool", min: 0, max: 1, step: 1, defaultValue: 1, operators: ["eq", "neq"], paramRequired: true, paramHint: "water / grass / lava", hint: "判断目标点或施法者所在地形标签。" },
  { id: "state_tag", label: "战斗状态标签", scope: "caster", valueType: "bool", min: 0, max: 1, step: 1, defaultValue: 1, operators: ["eq", "neq"], paramRequired: true, paramHint: "guarding / channeling / airborne", hint: "判断施法者或目标当前战斗状态标签。" },
  { id: "resource_value", label: "资源绝对值", scope: "caster", valueType: "number", min: 0, max: 9999, step: 1, defaultValue: 10, operators: ["gte", "gt", "lte", "lt"], paramRequired: true, paramHint: "hp / mana / stamina", hint: "判断生命、法力或耐力的绝对数值。" },
  { id: "random", label: "随机判定", scope: "skill", valueType: "ratio", min: 0, max: 1, step: 0.01, defaultValue: 0.5, operators: ["lte", "lt"], paramRequired: false, hint: "独立随机值判定；常规概率仍优先使用触发几率字段。" },
];

export function conditionMeta(id: string): ConditionMeta {
  return conditionTypes.find((c) => c.id === id) ?? conditionTypes[0];
}
