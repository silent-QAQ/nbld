// 基础枚举表：从旧编辑器常量移植并加类型。
import type { CompareOperator } from "../model/types";

/** [value, label] 二元组，用于下拉框。 */
export type Option = readonly [string, string];

export const skillTypes: Option[] = [
  ["melee", "近战"],
  ["projectile", "投射物"],
  ["ray", "射线"],
  ["area", "区域"],
  ["aura", "光环"],
  ["dash", "位移"],
  ["guard", "防御"],
  ["counter", "反击"],
  ["summon", "召唤"],
  ["buff", "增益"],
  ["debuff", "减益"],
  ["control", "控制"],
  ["heal", "治疗"],
  ["passive", "被动触发"],
];

export const slotTypes: Option[] = [
  ["mainhand_active", "主手主动"],
  ["offhand_active", "副手主动"],
  ["armor_passive", "防具被动"],
];

export const rarities: Option[] = [
  ["common", "普通"],
  ["rare", "稀有"],
  ["epic", "史诗"],
  ["legendary", "传说"],
  ["mythic", "神话"],
];

export const targetTypes: Option[] = [
  ["single_enemy", "单体敌方"],
  ["single_ally", "单体友方"],
  ["self", "自身"],
  ["aoe_enemy", "范围敌方"],
  ["aoe_ally", "范围友方"],
  ["point", "指定落点"],
  ["direction", "方向"],
];

export const triggers: Option[] = [
  ["onCast", "释放时"],
  ["onHit", "命中时"],
  ["onCrit", "暴击时"],
  ["onKill", "击杀时"],
  ["onTick", "周期"],
  ["onDamaged", "受击时"],
  ["onDodge", "闪避后"],
  ["onBlock", "格挡后"],
  ["onEnd", "结束时"],
];

export const conditionScopes: Option[] = [
  ["caster", "施法者"],
  ["target", "目标"],
  ["skill", "技能"],
  ["world", "场景"],
];

export const weapons: Option[] = [
  ["light_sword", "轻剑"],
  ["long_blade", "长刀"],
  ["staff", "法杖"],
  ["greatsword", "重剑"],
  ["dagger_main", "匕首"],
  ["club", "棍木"],
  ["bow", "弓箭"],
  ["axe", "斧头"],
  ["greatshield", "重盾"],
  ["spear", "长枪"],
];

export const offhands: Option[] = [
  ["offhand_dagger", "匕首副手"],
  ["buckler", "轻盾"],
  ["grimoire", "法典"],
  ["gauntlet", "护手"],
];

export const modifierSources: Option[] = [
  ["weapon", "武器模板"],
  ["offhand", "副手联动"],
  ["talent", "天赋天枢"],
  ["passive", "被动魂石"],
  ["affix", "装备词条"],
];

export const modifierModes: Option[] = [
  ["add", "加法"],
  ["mul", "乘法"],
  ["override", "覆盖"],
];

export const operatorSymbols: Record<CompareOperator, string> = {
  gte: ">=",
  lte: "<=",
  gt: ">",
  lt: "<",
  eq: "=",
  neq: "!=",
};
