// 技能 / 步骤 / 条件工厂：默认值与示例数据。
import type { Skill, Step } from "./model/types";
import { defaultTargeterParams } from "./targeter";
import { defaultsFor, normalizedParams } from "./params";
import { mechanicById } from "./data/mechanics";
import { uid } from "./util";

/** 新建一个空步骤，默认机制与触发器可指定。 */
export function createStep(mechanicId = "damage", trigger = "onCast"): Step {
  const mechanic = mechanicById(mechanicId);
  return {
    id: uid("step"),
    name: "新技能步骤",
    trigger,
    targeter: "@t",
    target_selector: "@t",
    target_param: "",
    targeter_params: defaultTargeterParams("@t"),
    chance: 1,
    delay: 0,
    repeat: 1,
    interval: 0,
    mechanic: { id: mechanic.id, ...normalizedParams(defaultsFor(mechanic)) },
    conditions: [],
  };
}

/** 新建一个空技能。 */
export function createSkill(skillId: string, skillName: string): Skill {
  return {
    id: uid("skill"),
    skill_id: skillId,
    skill_name: skillName,
    skill_group: "combat.new",
    skill_desc: "",
    icon: "",
    rarity: "common",
    slot_type: "mainhand_active",
    skill_type: "melee",
    target_type: "single_enemy",
    cooldown: 6,
    stamina_cost: 10,
    mana_cost: 0,
    default_trigger: "onCast",
    weapon_tags: [],
    offhand_tags: [],
    steps: [createStep("damage", "onCast")],
    modifiers: [],
    updated_at: Date.now(),
  };
}

/** 内置示例：突进穿刺（对齐文档 §15 / §117）。 */
export function demoSkill(): Skill {
  return {
    id: uid("skill"),
    skill_id: "skill_spear_dash_001",
    skill_name: "突进穿刺",
    skill_group: "combat.spear",
    skill_desc: "向前突进并对直线路径上的敌人造成物理伤害，可通过破军天赋追加低血追击。",
    icon: "icon_spear_dash",
    rarity: "rare",
    slot_type: "mainhand_active",
    skill_type: "dash",
    target_type: "direction",
    cooldown: 8,
    stamina_cost: 15,
    mana_cost: 0,
    default_trigger: "onCast",
    weapon_tags: ["spear"],
    offhand_tags: [],
    modifiers: [
      { id: uid("mod"), source: "talent", source_ref: "tianqu_pojun_core", target_field: "step.2.enabled", mode: "override", value: 1, note: "破军核心激活时开放低血追击" },
      { id: uid("mod"), source: "weapon", source_ref: "spear", target_field: "mechanic.1.ratio", mode: "mul", value: 1.1, note: "长枪模板增伤" },
    ],
    steps: [
      {
        id: uid("step"),
        name: "穿刺命中",
        trigger: "onCast",
        targeter: "@s",
        target_selector: "@s",
        target_param: "",
        targeter_params: { range: 0, radius: 0, inner_radius: 0, angle: 0, arc: 90, width: 0, max_targets: 1 },
        chance: 1,
        delay: 0.18,
        repeat: 1,
        interval: 0,
        mechanic: { id: "damage", shape: "line", range: 4.5, radius: 0, width: 0.6, angle: 0, max_targets: 3, team: "enemy", damage_type: "physical", ratio: 1.35, flat: 0, can_crit: true },
        conditions: [],
      },
      {
        id: uid("step"),
        name: "破军追击",
        trigger: "onHit",
        targeter: "@tg",
        target_selector: "@tg",
        target_param: "",
        targeter_params: { range: 0, radius: 0, inner_radius: 0, angle: 0, arc: 90, width: 0, max_targets: 1 },
        chance: 1,
        delay: 0,
        repeat: 1,
        interval: 0,
        mechanic: { id: "damage", damage_type: "physical", ratio: 0.8, flat: 0, can_crit: false, extra_damage: true },
        conditions: [
          { id: uid("cond"), scope: "target", type: "target_hp_ratio", operator: "lt", value: 0.35, param: "" },
          { id: uid("cond"), scope: "skill", type: "talent", operator: "eq", value: 1, param: "tianqu_pojun_core" },
        ],
      },
    ],
    updated_at: Date.now(),
  };
}
