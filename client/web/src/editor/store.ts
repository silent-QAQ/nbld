// 技能库持久化：localStorage 自动存 + JSON 导入/导出（§14）。
import type { Skill } from "./model/types";
import { demoSkill } from "./factory";

const STORAGE_KEY = "nbld.skill_editor.library.v1";

export interface LibraryFile {
  version: 1;
  skills: Skill[];
}

/** 从 localStorage 读取技能库；为空时返回内置示例。 */
export function loadLibrary(): Skill[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [demoSkill()];
    const parsed = JSON.parse(raw) as LibraryFile;
    if (!parsed || !Array.isArray(parsed.skills) || parsed.skills.length === 0) {
      return [demoSkill()];
    }
    return parsed.skills.map(normalizeSkill);
  } catch {
    return [demoSkill()];
  }
}

/** 写入 localStorage。 */
export function saveLibrary(skills: Skill[]): void {
  const payload: LibraryFile = { version: 1, skills };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // 存储不可用时静默失败，不阻断编辑。
  }
}

/** 导出整库为格式化 JSON 文本。 */
export function exportLibrary(skills: Skill[]): string {
  const payload: LibraryFile = { version: 1, skills };
  return JSON.stringify(payload, null, 2);
}

/** 解析导入文本：支持整库文件或单个技能对象。抛错表示格式非法。 */
export function parseImport(text: string): Skill[] {
  const data = JSON.parse(text) as unknown;
  if (data && typeof data === "object" && Array.isArray((data as LibraryFile).skills)) {
    return (data as LibraryFile).skills.map(normalizeSkill);
  }
  if (Array.isArray(data)) {
    return (data as Skill[]).map(normalizeSkill);
  }
  if (data && typeof data === "object" && "skill_id" in (data as Skill)) {
    return [normalizeSkill(data as Skill)];
  }
  throw new Error("无法识别的技能配置格式");
}

/** 补齐旧数据缺失字段，保证类型完整。 */
function normalizeSkill(skill: Skill): Skill {
  return {
    id: skill.id || `skill_${Math.random().toString(36).slice(2, 8)}`,
    skill_id: skill.skill_id ?? "",
    skill_name: skill.skill_name ?? "",
    skill_group: skill.skill_group ?? "",
    skill_desc: skill.skill_desc ?? "",
    icon: skill.icon ?? "",
    rarity: skill.rarity ?? "common",
    slot_type: skill.slot_type ?? "mainhand_active",
    skill_type: skill.skill_type ?? "melee",
    target_type: skill.target_type ?? "single_enemy",
    cooldown: skill.cooldown ?? 0,
    stamina_cost: skill.stamina_cost ?? 0,
    mana_cost: skill.mana_cost ?? 0,
    default_trigger: skill.default_trigger ?? "onCast",
    weapon_tags: skill.weapon_tags ?? [],
    offhand_tags: skill.offhand_tags ?? [],
    steps: skill.steps ?? [],
    modifiers: skill.modifiers ?? [],
    updated_at: skill.updated_at ?? Date.now(),
  };
}
