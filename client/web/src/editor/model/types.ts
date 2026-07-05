// 技能编辑引擎核心数据模型。
// 字段命名严格对齐《技能系统设计文档》§123 / §129 的结构表规范。

/** 比较运算符，用于条件表达式。 */
export type CompareOperator = "gte" | "lte" | "gt" | "lt" | "eq" | "neq";

/** 条件作用域，固定四类（§121）。 */
export type ConditionScope = "caster" | "target" | "skill" | "world";

/** 单条量化条件（编辑态）。 */
export interface Condition {
  id: string;
  scope: ConditionScope;
  type: string;
  operator: CompareOperator;
  value: number;
  param: string;
}

/** 目标器几何参数（锚点搜索，不承担形状职责）。 */
export interface TargeterParams {
  range: number;
  radius: number;
  inner_radius: number;
  angle: number;
  arc: number;
  width: number;
  max_targets: number;
}

/** 机制效果的参数集合，键随机制类型变化。 */
export type MechanicValues = Record<string, string | number | boolean>;

/** 机制效果（编辑态），id 为机制类型。 */
export interface MechanicState extends MechanicValues {
  id: string;
}

/** 一条技能行 / 步骤（编辑态）。 */
export interface Step {
  id: string;
  name: string;
  trigger: string;
  targeter: string;
  target_selector: string;
  target_param: string;
  targeter_params: TargeterParams;
  chance: number;
  delay: number;
  repeat: number;
  interval: number;
  mechanic: MechanicState;
  conditions: Condition[];
}

/** 联动修正来源（§10.5 / §14 skill_modifiers）。 */
export type ModifierSource =
  | "weapon"
  | "offhand"
  | "talent"
  | "passive"
  | "affix";

/** 修正的数值叠加模式。 */
export type ModifierMode = "add" | "mul" | "override";

/** 单条联动修正（编辑态）。 */
export interface Modifier {
  id: string;
  source: ModifierSource;
  source_ref: string;
  target_field: string;
  mode: ModifierMode;
  value: number;
  note: string;
}

/** 技能稀有度。 */
export type Rarity = "common" | "rare" | "epic" | "legendary" | "mythic";

/** 一个完整技能（技能组，编辑态）。 */
export interface Skill {
  id: string;
  skill_id: string;
  skill_name: string;
  skill_group: string;
  skill_desc: string;
  icon: string;
  rarity: Rarity;
  slot_type: string;
  skill_type: string;
  target_type: string;
  cooldown: number;
  stamina_cost: number;
  mana_cost: number;
  default_trigger: string;
  weapon_tags: string[];
  offhand_tags: string[];
  steps: Step[];
  modifiers: Modifier[];
  updated_at: number;
}

/** 校验问题条目。 */
export interface Issue {
  line: number;
  level: "bad" | "warn";
  text: string;
}
