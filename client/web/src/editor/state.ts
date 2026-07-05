// 编辑器全局状态。UI 各面板读取此对象并调用其方法后触发 render。
import type { Skill, Step } from "./model/types";
import { loadLibrary, saveLibrary } from "./store";
import { createStep } from "./factory";
import { mechanicById } from "./data/mechanics";
import { defaultsFor, denormalizedParams } from "./params";

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
}
