// 编辑器全局状态。UI 各面板读取此对象并调用其方法后触发 render。
import type { CompareOperator, ConditionScope, ModifierMode, ModifierSource, Skill, Step } from "./model/types";
import { loadLibrary, saveLibrary } from "./store";
import { createStep } from "./factory";
import { mechanicById } from "./data/mechanics";
import { conditionMeta } from "./data/conditions";
import { defaultsFor, denormalizedParams, normalizedParams } from "./params";
import { uid } from "./util";

/** 中央面板的页签。 */
export type CenterPage = "base" | "steps" | "timeline" | "modifiers" | "preview";

/** 导出面板的页签。 */
export type OutputTab = "all" | "steps" | "mechanics" | "conditions" | "modifiers" | "text";

/** 技能库筛选条件。 */
export interface LibraryFilter {
  slot: string;
  weapon: string;
  rarity: string;
  keyword: string;
}

/** 条件编辑草稿（“量化条件”表单当前值）。 */
export interface ConditionDraft {
  scope: ConditionScope;
  type: string;
  operator: CompareOperator;
  value: number;
  param: string;
}

/** 联动修正编辑草稿（“新增修正”表单当前值）。 */
export interface ModifierDraft {
  source: ModifierSource;
  source_ref: string;
  target_field: string;
  mode: ModifierMode;
  value: number;
  note: string;
}

/** 测试预览页的施法者 / 假人参数。 */
export interface PreviewParams {
  physical_attack: number;
  magic_attack: number;
  physical_crit: number;
  magic_crit: number;
  crit_damage_bonus: number;
  damage_bonus: number;
  target_hp: number;
  target_defense: number;
}

function defaultConditionDraft(): ConditionDraft {
  const meta = conditionMeta("target_hp_ratio");
  return { scope: meta.scope, type: meta.id, operator: meta.operators[0], value: meta.defaultValue, param: "" };
}

function defaultModifierDraft(): ModifierDraft {
  return { source: "weapon", source_ref: "", target_field: "", mode: "add", value: 0, note: "" };
}

function defaultPreview(): PreviewParams {
  return {
    physical_attack: 120,
    magic_attack: 120,
    physical_crit: 0.15,
    magic_crit: 0.15,
    crit_damage_bonus: 0.5,
    damage_bonus: 0,
    target_hp: 1000,
    target_defense: 60,
  };
}

export class AppState {
  library: Skill[] = [];
  selectedSkillId = "";
  selectedStepId = "";
  selectedMechanic = "damage";
  mechanicCategory = "all";
  mechanicParams: Record<string, string> = {};
  centerPage: CenterPage = "steps";
  outputTab: OutputTab = "all";
  targetPoints: string[] = [];
  filter: LibraryFilter = { slot: "", weapon: "", rarity: "", keyword: "" };
  conditionDraft: ConditionDraft = defaultConditionDraft();
  modifierDraft: ModifierDraft = defaultModifierDraft();
  preview: PreviewParams = defaultPreview();

  /** 渲染回调，由 main 注入。 */
  renderFn: () => void = () => {};

  constructor() {
    this.library = loadLibrary();
    this.selectedSkillId = this.library[0]?.id ?? "";
    const skill = this.currentSkill();
    this.selectedStepId = skill?.steps[0]?.id ?? "";
    this.syncMechanicFromStep();
  }

  render(): void {
    this.renderFn();
  }

  /** 保存到 localStorage。 */
  persist(): void {
    saveLibrary(this.library);
  }

  currentSkill(): Skill | undefined {
    return this.library.find((s) => s.id === this.selectedSkillId) ?? this.library[0];
  }

  selectedStep(): Step | undefined {
    const skill = this.currentSkill();
    if (!skill) return undefined;
    return skill.steps.find((s) => s.id === this.selectedStepId) ?? skill.steps[0];
  }

  /** 选中技能后同步步骤与机制编辑态。 */
  selectSkill(id: string): void {
    this.selectedSkillId = id;
    const skill = this.currentSkill();
    this.selectedStepId = skill?.steps[0]?.id ?? "";
    this.syncMechanicFromStep();
  }

  /** 选中步骤后同步机制编辑态。 */
  selectStep(id: string): void {
    this.selectedStepId = id;
    this.syncMechanicFromStep();
  }

  /** 用当前步骤的机制回填机制编辑面板。 */
  syncMechanicFromStep(): void {
    const step = this.selectedStep();
    if (step) {
      this.selectedMechanic = step.mechanic.id;
      this.mechanicParams = denormalizedParams(step.mechanic);
    } else {
      this.mechanicParams = defaultsFor(mechanicById(this.selectedMechanic));
    }
  }

  /** 触碰技能更新时间戳并持久化。 */
  touch(): void {
    const skill = this.currentSkill();
    if (skill) skill.updated_at = Date.now();
    this.persist();
  }

  addStep(): void {
    const skill = this.currentSkill();
    if (!skill) return;
    const step = createStep(this.selectedMechanic, skill.default_trigger);
    skill.steps.push(step);
    this.selectStep(step.id);
    this.touch();
  }

  duplicateStep(): void {
    const skill = this.currentSkill();
    const step = this.selectedStep();
    if (!skill || !step) return;
    const copy = JSON.parse(JSON.stringify(step)) as Step;
    copy.id = `step_${Math.random().toString(36).slice(2, 8)}`;
    copy.name = `${copy.name}副本`;
    copy.conditions.forEach((c) => (c.id = `cond_${Math.random().toString(36).slice(2, 8)}`));
    skill.steps.push(copy);
    this.selectStep(copy.id);
    this.touch();
  }

  removeStep(): void {
    const skill = this.currentSkill();
    if (!skill || skill.steps.length <= 1) return;
    skill.steps = skill.steps.filter((s) => s.id !== this.selectedStepId);
    this.selectStep(skill.steps[0].id);
    this.touch();
  }

  /** 切换机制选择器的当前机制，用其默认参数回填编辑表单。 */
  selectMechanic(id: string): void {
    this.selectedMechanic = id;
    this.mechanicParams = defaultsFor(mechanicById(id));
  }

  /** 把机制编辑表单的当前值应用到选中步骤。 */
  applyMechanicToStep(): void {
    const step = this.selectedStep();
    if (!step) return;
    const mechanic = mechanicById(this.selectedMechanic);
    step.mechanic = { id: mechanic.id, ...normalizedParams(this.mechanicParams) };
    this.touch();
  }

  /** 用条件草稿向选中步骤追加一条条件。 */
  addConditionFromDraft(): void {
    const step = this.selectedStep();
    if (!step) return;
    const d = this.conditionDraft;
    step.conditions.push({ id: uid("cond"), scope: d.scope, type: d.type, operator: d.operator, value: d.value, param: d.param.trim() });
    this.touch();
  }

  /** 切换条件类型时用元数据回填草稿默认值。 */
  syncConditionDraftType(type: string): void {
    const meta = conditionMeta(type);
    this.conditionDraft = { scope: meta.scope, type: meta.id, operator: meta.operators[0], value: meta.defaultValue, param: "" };
  }

  removeCondition(conditionId: string): void {
    const step = this.selectedStep();
    if (!step) return;
    step.conditions = step.conditions.filter((c) => c.id !== conditionId);
    this.touch();
  }

  clearConditions(): void {
    const step = this.selectedStep();
    if (!step) return;
    step.conditions = [];
    this.touch();
  }

  resetModifierDraft(): void {
    this.modifierDraft = defaultModifierDraft();
  }
}
