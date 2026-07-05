// 机制标准库（§133 第三版清单 + §134.5 第四版优化标准）。
// 原样移植自旧编辑器；参数名与枚举值与文档逐条对齐。
import type { Option } from "./common";

/** 机制参数定义：[key, label, type, default, selectOptions?] */
export type MechanicParamType = "number" | "text" | "select";
export type MechanicParam = readonly [
  key: string,
  label: string,
  type: MechanicParamType,
  fallback: string,
  options?: Option[],
];

export type MechanicCategory =
  | "damage"
  | "shape"
  | "motion"
  | "state"
  | "entity"
  | "logic"
  | "feedback"
  | "meta";

export interface Mechanic {
  id: string;
  title: string;
  hint: string;
  category: MechanicCategory;
  description: string;
  targeters: string[];
  params: MechanicParam[];
  /** 服务端权威机制（改变战斗结果）；false 为表现反馈机制。 */
  server: boolean;
}

export const mechanicCategories: Option[] = [
  ["all", "全部"],
  ["damage", "伤害"],
  ["shape", "载体"],
  ["motion", "位移"],
  ["state", "状态"],
  ["entity", "实体"],
  ["logic", "逻辑"],
  ["feedback", "表现"],
  ["meta", "技能组"],
];

function mechanic(
  id: string,
  title: string,
  hint: string,
  category: MechanicCategory,
  description: string,
  targeters: string[],
  params: MechanicParam[],
  server = true,
): Mechanic {
  return { id, title, hint, category, description, targeters, params, server };
}

export const mechanics: Mechanic[] = [
  mechanic("damage", "伤害", "Damage", "damage", "对目标造成一次即时伤害。形状由本效果的 shape 参数决定，目标器只提供锚点。", ["@s", "@t", "@tg", "@zp"], [
    ["shape", "判定形状", "select", "target", [["target", "锚点目标"], ["line", "直线"], ["cone", "扇形"], ["circle", "圆形"]]],
    ["range", "距离", "number", "0"],
    ["radius", "半径", "number", "0"],
    ["width", "宽度", "number", "0"],
    ["angle", "角度", "number", "0"],
    ["max_targets", "目标上限", "number", "1"],
    ["team", "阵营", "select", "enemy", [["enemy", "敌方"], ["ally", "友方"], ["both", "全部"]]],
    ["damage_type", "类型", "select", "physical", [["physical", "物理"], ["magical", "法术"]]],
    ["ratio", "倍率", "number", "1.2"],
    ["flat", "固定值", "number", "0"],
    ["can_crit", "暴击", "select", "true", [["true", "是"], ["false", "否"]]],
    ["extra_damage", "追加伤害", "select", "false", [["false", "否"], ["true", "是"]]],
    ["hit_tag", "命中标签", "text", "normal_hit"],
    ["hit_interval", "同目标间隔", "number", "0"],
    ["trigger_hit_event", "触发命中事件", "select", "true", [["true", "是"], ["false", "否"]]],
    ["source", "伤害来源", "select", "skill", [["skill", "技能"], ["dot", "持续"], ["trap", "陷阱"], ["summon", "召唤物"], ["environment", "场景"]]],
  ]),
  mechanic("dot", "持续伤害", "DoT", "damage", "挂载持续伤害；适合灼烧、毒、流血，不建议用高频区域伤害模拟。", ["@tg", "@t", "@zp"], [
    ["dot_id", "持续伤害", "text", "burning"],
    ["damage_type", "伤害类型", "select", "magical", [["physical", "物理"], ["magical", "法术"]]],
    ["ratio", "每跳倍率", "number", "0.18"],
    ["duration", "持续", "number", "4"],
    ["tick", "跳频", "number", "1"],
    ["stack_mode", "叠加模式", "select", "refresh", [["refresh", "刷新"], ["stack", "叠层"], ["independent", "独立"]]],
    ["max_stack", "最大层数", "number", "1"],
    ["snapshot", "快照属性", "select", "false", [["false", "实时"], ["true", "快照"]]],
  ]),
  mechanic("heal", "治疗", "Heal", "damage", "对友方或自身回复生命，范围治疗通过效果参数过滤友方。", ["@s", "@t", "@zp"], [
    ["ratio", "法攻倍率", "number", "0.8"],
    ["flat", "固定值", "number", "0"],
    ["can_crit", "治疗暴击", "select", "false", [["false", "否"], ["true", "是"]]],
    ["team", "阵营", "select", "ally", [["ally", "友方"], ["self", "自身"], ["both", "全部"]]],
    ["overheal_to_shield", "溢出转护盾", "select", "false", [["false", "否"], ["true", "是"]]],
    ["shield_duration", "溢出护盾持续", "number", "3"],
  ]),
  mechanic("projectile", "投射物", "Projectile", "shape", "生成 2D 投射物；发射起点由目标器提供，飞行与碰撞形状由效果参数提供。", ["@s", "@zp", "@t"], [
    ["projectile_id", "投射物", "text", "frost_star"],
    ["damage_type", "伤害类型", "select", "magical", [["physical", "物理"], ["magical", "法术"]]],
    ["speed", "速度", "number", "12"],
    ["range", "射程", "number", "10"],
    ["ratio", "伤害倍率", "number", "0.9"],
    ["collision_radius", "碰撞半径", "number", "0.25"],
    ["max_pierce", "穿透数", "number", "0"],
    ["pattern", "形态", "select", "single", [["single", "单发"], ["spread", "散射"], ["homing", "追踪"], ["boomerang", "回旋"]]],
    ["count", "数量", "number", "1"],
    ["spread_angle", "散射角", "number", "0"],
    ["homing_strength", "追踪强度", "number", "0"],
    ["hit_interval", "同目标间隔", "number", "0.2"],
    ["on_hit_ref", "命中技能", "text", ""],
    ["can_crit", "暴击", "select", "true", [["true", "是"], ["false", "否"]]],
  ]),
  mechanic("modify_projectile", "修改投射物", "ModifyProjectile", "shape", "修改已生成投射物的速度、转向、穿透或分裂，用于天赋强化投射类技能。", ["@s", "@t"], [
    ["projectile_tag", "投射物标签", "text", "frost_star"],
    ["field", "修改字段", "select", "speed", [["speed", "速度"], ["range", "射程"], ["max_pierce", "穿透"], ["split_count", "分裂数"], ["homing_strength", "追踪强度"]]],
    ["mode", "模式", "select", "add", [["add", "加法"], ["mul", "乘法"], ["set", "设定"]]],
    ["value", "数值", "number", "1"],
  ]),
  mechanic("ray", "射线", "Ray", "shape", "生成瞬时或持续射线；射线方向和尺寸属于效果载体，不属于目标器。", ["@s", "@t", "@zp"], [
    ["damage_type", "伤害类型", "select", "magical", [["physical", "物理"], ["magical", "法术"]]],
    ["length", "长度", "number", "8"],
    ["width", "宽度", "number", "0.5"],
    ["ratio", "伤害倍率", "number", "1.0"],
    ["duration", "持续", "number", "0"],
    ["tick", "跳频", "number", "0"],
    ["max_targets", "目标上限", "number", "5"],
    ["block_policy", "阻挡", "select", "stop", [["stop", "遇阻停止"], ["pierce", "穿透阻挡"], ["reflect", "反射"]]],
    ["can_crit", "暴击", "select", "true", [["true", "是"], ["false", "否"]]],
  ]),
  mechanic("area", "区域", "Area", "shape", "生成持续区域；区域形状属于效果载体，目标器只决定区域中心。", ["@zp", "@s", "@t", "@tg"], [
    ["shape", "形状", "select", "circle", [["circle", "圆形"], ["rect", "矩形"], ["sector", "扇形"], ["line", "线形"]]],
    ["radius", "半径", "number", "3"],
    ["damage_type", "伤害类型", "select", "magical", [["physical", "物理"], ["magical", "法术"]]],
    ["ratio", "伤害倍率", "number", "0.6"],
    ["duration", "持续", "number", "4"],
    ["tick", "跳频", "number", "1"],
    ["max_targets", "目标上限", "number", "8"],
    ["effect_mode", "效果模式", "select", "damage", [["damage", "伤害"], ["status", "状态"], ["resource", "资源"], ["meta", "调用技能组"]]],
    ["effect_ref", "调用技能", "text", ""],
    ["enter_once", "进入只触发一次", "select", "false", [["false", "否"], ["true", "是"]]],
  ]),
  mechanic("aura", "光环", "Aura", "shape", "以施法者、召唤物或区域为中心周期影响目标。", ["@s", "@ow", "@zp"], [
    ["aura_id", "光环", "text", "war_aura"],
    ["radius", "半径", "number", "4"],
    ["duration", "持续", "number", "6"],
    ["tick", "跳频", "number", "0.5"],
    ["team", "阵营", "select", "ally", [["ally", "友方"], ["enemy", "敌方"], ["both", "全部"]]],
    ["effect_mode", "效果模式", "select", "attribute", [["attribute", "属性"], ["status", "状态"], ["resource", "资源"], ["meta", "调用技能组"]]],
    ["effect_ref", "调用技能", "text", ""],
    ["value", "强度", "number", "0.1"],
    ["stack_rule", "叠加规则", "select", "highest", [["highest", "取最高"], ["refresh", "刷新"], ["stack", "叠加"], ["unique", "唯一"]]],
  ]),
  mechanic("orbit", "环绕物", "Orbital", "shape", "生成围绕施法者旋转的碰撞体，适合护体剑气、旋刃、元素球。", ["@s"], [
    ["orbital_id", "环绕物", "text", "blade_orbit"],
    ["count", "数量", "number", "3"],
    ["radius", "轨道半径", "number", "1.6"],
    ["duration", "持续", "number", "5"],
    ["tick", "命中间隔", "number", "0.5"],
    ["ratio", "伤害倍率", "number", "0.25"],
    ["damage_type", "伤害类型", "select", "physical", [["physical", "物理"], ["magical", "法术"]]],
    ["on_hit_ref", "命中技能", "text", ""],
  ]),
  mechanic("move", "移动", "Move", "motion", "移动施法者或目标；dash/blink/pull/knockback 都走同一个服务端执行器。", ["@s", "@tg", "@t"], [
    ["mode", "模式", "select", "dash", [["dash", "冲刺"], ["blink", "瞬移"], ["pull", "拉拽"], ["knockback", "击退"], ["leap", "跳跃"]]],
    ["distance", "距离", "number", "3"],
    ["duration", "耗时", "number", "0.15"],
    ["collision", "碰撞处理", "select", "stop", [["stop", "遇阻停止"], ["slide", "沿墙滑动"], ["ignore", "忽略碰撞"]]],
    ["control_check", "受控制抗性", "select", "true", [["true", "是"], ["false", "否"]]],
  ]),
  mechanic("velocity", "速度修改", "Velocity", "motion", "直接修改单位速度向量，适合击飞、加速、减速推拉。", ["@s", "@tg", "@t"], [
    ["mode", "方向", "select", "forward", [["forward", "向前"], ["backward", "向后"], ["towards", "朝目标"], ["away", "远离目标"], ["vector", "指定向量"]]],
    ["speed", "速度", "number", "8"],
    ["duration", "持续", "number", "0.25"],
    ["damping", "阻尼", "number", "0.2"],
    ["control_check", "受控制抗性", "select", "true", [["true", "是"], ["false", "否"]]],
  ]),
  mechanic("force", "力场", "Force", "motion", "以锚点为中心对范围内目标施加吸引、排斥、旋涡力。", ["@zp", "@s", "@t"], [
    ["mode", "模式", "select", "pull", [["pull", "吸引"], ["push", "排斥"], ["vortex", "旋涡"]]],
    ["radius", "半径", "number", "3"],
    ["strength", "强度", "number", "6"],
    ["duration", "持续", "number", "1"],
    ["tick", "跳频", "number", "0.1"],
    ["falloff", "边缘衰减", "number", "0.5"],
  ]),
  mechanic("status", "状态", "Status", "state", "添加、移除或净化状态；Buff/Debuff 都归入状态系统。", ["@s", "@tg", "@t", "@zp"], [
    ["status_id", "状态", "text", "slow"],
    ["operation", "操作", "select", "apply", [["apply", "添加"], ["remove", "移除"], ["cleanse", "净化"]]],
    ["value", "强度", "number", "0.2"],
    ["duration", "持续", "number", "2"],
    ["stack_limit", "层数上限", "number", "1"],
    ["tag", "状态标签", "text", "debuff"],
    ["resist_check", "受抗性", "select", "true", [["true", "是"], ["false", "否"]]],
  ]),
  mechanic("control", "控制", "Control", "state", "施加硬控或软控，必须受韧性/免控规则影响。", ["@tg", "@t", "@zp"], [
    ["control", "类型", "select", "freeze", [["freeze", "冻结"], ["stun", "眩晕"], ["root", "定身"], ["silence", "沉默"], ["interrupt", "打断"], ["airborne", "浮空"]]],
    ["duration", "持续", "number", "1.5"],
    ["strength", "强度", "number", "1"],
    ["resist_check", "受韧性", "select", "true", [["true", "是"], ["false", "否"]]],
    ["break_on_damage", "受击解除", "select", "false", [["false", "否"], ["true", "是"]]],
  ]),
  mechanic("shield", "护盾", "Shield", "state", "给目标添加可被伤害消耗的护盾。", ["@s", "@t", "@zp"], [
    ["shield_id", "护盾", "text", "guard_shield"],
    ["ratio", "倍率", "number", "0.6"],
    ["flat", "固定值", "number", "0"],
    ["duration", "持续", "number", "4"],
    ["damage_type", "吸收类型", "select", "both", [["physical", "物理"], ["magical", "法术"], ["both", "全部"]]],
    ["stack_rule", "叠加规则", "select", "replace", [["replace", "替换"], ["stack", "叠加"], ["highest", "取最高"]]],
  ]),
  mechanic("immunity", "免疫", "Immunity", "state", "短时间免疫指定伤害、控制或追加伤害，用于翻滚、格挡、霸体窗口。", ["@s", "@t", "@zp"], [
    ["immune_type", "免疫类型", "select", "control", [["damage", "伤害"], ["control", "控制"], ["extra_damage", "追加伤害"], ["all", "全部"]]],
    ["duration", "持续", "number", "0.8"],
    ["value", "强度", "number", "1"],
    ["tag", "免疫标签", "text", "roll_iframe"],
  ]),
  mechanic("dispel", "驱散", "Dispel", "state", "按标签移除状态，适合净化、破盾、解除增益。", ["@s", "@tg", "@t", "@zp"], [
    ["dispel_type", "驱散类型", "select", "debuff", [["buff", "增益"], ["debuff", "减益"], ["control", "控制"], ["shield", "护盾"]]],
    ["count", "数量", "number", "1"],
    ["priority", "优先级", "select", "newest", [["newest", "最新"], ["oldest", "最旧"], ["strongest", "最强"], ["random", "随机"]]],
  ]),
  mechanic("resource", "资源", "Resource", "state", "修改生命、法力、耐力；非伤害型扣血也走这里。", ["@s", "@tg", "@t"], [
    ["resource", "资源", "select", "mana", [["hp", "生命"], ["mana", "法力"], ["stamina", "耐力"]]],
    ["operation", "操作", "select", "restore", [["restore", "回复"], ["drain", "削减"], ["cost", "消耗"], ["set", "设定"]]],
    ["value", "数值", "number", "0.1"],
    ["value_type", "数值类型", "select", "ratio", [["ratio", "最大值比例"], ["flat", "固定值"], ["current_ratio", "当前值比例"]]],
  ]),
  mechanic("attribute", "属性修改", "Attribute", "state", "临时修改属性，属性名必须来自属性系统。", ["@s", "@tg", "@t", "@zp"], [
    ["attribute", "属性", "select", "physical_attack", [["hp_max", "生命上限"], ["stamina_max", "耐力上限"], ["mana_max", "法力上限"], ["move_speed", "移速"], ["physical_attack", "物理攻击"], ["magic_attack", "法术攻击"], ["physical_crit", "物理暴击"], ["magic_crit", "法术暴击"], ["damage_bonus", "伤害加成"], ["crit_damage_bonus", "爆伤加成"], ["additional_damage", "追加伤害"], ["physical_defense", "物理防御"], ["magic_defense", "法术防御"], ["crit_resist", "暴击抵抗"], ["damage_immunity", "伤害免疫"], ["additional_immunity", "追加免疫"]]],
    ["mode", "模式", "select", "add", [["add", "加法"], ["mul", "乘法"], ["override", "覆盖"]]],
    ["value", "数值", "number", "0.1"],
    ["duration", "持续", "number", "6"],
    ["stack_rule", "叠加规则", "select", "refresh", [["refresh", "刷新"], ["stack", "叠加"], ["highest", "取最高"], ["unique", "唯一"]]],
  ]),
  mechanic("stack", "层数", "Stack", "state", "处理可被条件读取的层数。", ["@s", "@tg", "@t", "@zp"], [
    ["stack_id", "层数", "select", "frost", [["frost", "寒霜"], ["burn", "灼烧"], ["armor_break", "破甲"], ["bleed", "流血"]]],
    ["operation", "操作", "select", "add", [["add", "叠加"], ["consume", "消耗"], ["detonate", "引爆"], ["spread", "扩散"], ["set", "设定"]]],
    ["count", "数量", "number", "1"],
    ["radius", "扩散半径", "number", "0"],
    ["duration", "持续", "number", "6"],
    ["effect_ref", "引爆技能", "text", ""],
  ]),
  mechanic("summon", "召唤", "Summon", "entity", "召唤单位、图腾或陷阱实体。", ["@zp", "@s"], [
    ["summon_id", "召唤物", "text", "shadow_guard"],
    ["kind", "类型", "select", "unit", [["unit", "单位"], ["totem", "图腾"], ["trap", "陷阱"]]],
    ["count", "数量", "number", "1"],
    ["duration", "持续", "number", "12"],
    ["max_count", "上限", "number", "1"],
    ["inherit_attack", "继承攻击", "number", "0.35"],
    ["team", "阵营", "select", "ally", [["ally", "友方"], ["enemy", "敌方"], ["neutral", "中立"]]],
    ["ai", "AI", "select", "guard", [["guard", "守卫"], ["follow", "跟随"], ["attack", "主动攻击"], ["static", "不移动"]]],
    ["skill_ref", "自带技能", "text", ""],
  ]),
  mechanic("trap", "陷阱", "Trap", "entity", "布置触发器实体，触发后调用指定技能组。", ["@zp", "@s"], [
    ["trap_id", "陷阱", "text", "spike_trap"],
    ["trigger_radius", "触发半径", "number", "1.2"],
    ["arm_time", "布置时间", "number", "0.35"],
    ["duration", "持续", "number", "10"],
    ["trigger_limit", "触发次数", "number", "1"],
    ["team_filter", "触发阵营", "select", "enemy", [["enemy", "敌方"], ["ally", "友方"], ["both", "全部"]]],
    ["effect_ref", "触发技能", "text", "skill_trap_spike"],
  ]),
  mechanic("marker", "标记点", "Marker", "entity", "在场上放置临时标记，供后续技能组寻址。", ["@zp", "@tg", "@s"], [
    ["marker_id", "标记", "text", "spear_mark"],
    ["duration", "持续", "number", "5"],
    ["max_count", "上限", "number", "3"],
    ["attach", "附着", "select", "world", [["world", "地面"], ["target", "目标"], ["caster", "施法者"]]],
    ["visible", "可见", "select", "false", [["false", "否"], ["true", "是"]]],
  ]),
  mechanic("cooldown", "冷却", "Cooldown", "logic", "修改技能冷却。", ["@s"], [
    ["target_skill", "目标技能", "text", "skill_spear_dash_001"],
    ["operation", "操作", "select", "reduce", [["reduce", "缩减"], ["reset", "重置"], ["lock", "禁用"], ["add", "延长"]]],
    ["value", "数值", "number", "0.2"],
  ]),
  mechanic("combo", "连击窗口", "Combo", "logic", "开启、推进或关闭连击窗口。", ["@s"], [
    ["combo_id", "连击", "text", "spear_chain"],
    ["operation", "操作", "select", "open", [["open", "开启"], ["advance", "推进"], ["reset", "重置"], ["close", "关闭"]]],
    ["duration", "窗口", "number", "1.2"],
    ["max_stage", "最大段数", "number", "3"],
  ]),
  mechanic("chain", "连锁", "Chain", "logic", "以锚点目标为起点在目标之间传递效果，接近 MythicMobs 链式技能但限制为 2D 可控范围。", ["@tg", "@t"], [
    ["chain_id", "连锁", "text", "lightning_chain"],
    ["jumps", "跳数", "number", "3"],
    ["radius", "跳跃半径", "number", "4"],
    ["falloff", "衰减", "number", "0.2"],
    ["allow_repeat", "允许重复目标", "select", "false", [["false", "否"], ["true", "是"]]],
    ["effect_ref", "每跳技能", "text", "skill_chain_hit"],
  ]),
  mechanic("event", "事件", "Event", "logic", "广播战斗事件，只做通知，不直接改数值。", ["@s", "@tg"], [
    ["event_id", "事件", "text", "pojun_execute"],
    ["payload", "参数", "text", ""],
  ]),
  mechanic("vfx", "特效", "VFX", "feedback", "播放客户端特效，不参与服务端数值结算；可绑定施法者、目标或坐标。", ["@s", "@tg", "@t", "@zp"], [
    ["vfx_id", "特效", "text", "slash_arc"],
    ["attach", "附着", "select", "point", [["point", "目标点"], ["caster", "施法者"], ["target", "目标"], ["world", "世界"]]],
    ["scale", "缩放", "number", "1"],
    ["duration", "持续", "number", "0.6"],
    ["rotation", "旋转角", "number", "0"],
  ], false),
  mechanic("sfx", "音效", "SFX", "feedback", "播放音效；只输出表现事件，不影响技能判定。", ["@s", "@tg", "@t", "@zp"], [
    ["sfx_id", "音效", "text", "spear_thrust"],
    ["volume", "音量", "number", "1"],
    ["pitch", "音高", "number", "1"],
    ["range", "传播距离", "number", "12"],
  ], false),
  mechanic("camera", "镜头", "Camera", "feedback", "镜头震动或拉近，仅对本地相关玩家生效。", ["@s", "@tg", "@zp"], [
    ["mode", "模式", "select", "shake", [["shake", "震动"], ["zoom", "缩放"], ["flash", "闪白"]]],
    ["strength", "强度", "number", "0.4"],
    ["duration", "持续", "number", "0.15"],
    ["falloff", "距离衰减", "number", "1"],
  ], false),
  mechanic("hitstop", "顿帧", "HitStop", "feedback", "短暂停顿用于强化命中手感；必须限制持续时间。", ["@s", "@tg", "@t"], [
    ["duration", "持续", "number", "0.06"],
    ["scope", "范围", "select", "attacker_target", [["attacker", "攻击者"], ["target", "目标"], ["attacker_target", "双方"], ["local", "本地表现"]]],
    ["strength", "强度", "number", "1"],
  ], false),
  mechanic("meta", "技能组", "MetaSkill", "meta", "调用另一个技能组，是复杂组合的核心入口。", ["@s", "@tg", "@zp", "@t", "@p"], [
    ["skill_ref", "调用技能", "text", "skill_spear_followup_001"],
    ["mode", "模式", "select", "async", [["sync", "同步"], ["async", "异步"], ["queued", "排队"]]],
    ["max_depth", "最大深度", "number", "1"],
  ]),
];

export function mechanicById(id: string): Mechanic {
  return mechanics.find((m) => m.id === id) ?? mechanics[0];
}

export function mechanicLabel(id: string): string {
  return mechanicById(id).title;
}
