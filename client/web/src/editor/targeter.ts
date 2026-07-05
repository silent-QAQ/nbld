// 目标选择器（第四版 §137-142）纯逻辑层。
// 【重要】本文件的解析/组装/推断逻辑逐字移植自旧编辑器 tools/skill_editor.html，
// 行为保持不变。UI 层负责从表单读取，调用这里的纯函数生成/解析表达式。
import type { Step, TargeterParams } from "./model/types";
import { number } from "./util";

/** 各目标器的默认几何参数预设。 */
export function defaultTargeterParams(targeter: string): TargeterParams {
  const presets: Record<string, TargeterParams> = {
    "@s": { range: 0, radius: 0, inner_radius: 0, angle: 0, arc: 90, width: 0, max_targets: 1 },
    "@t": { range: 8, radius: 0, inner_radius: 0, angle: 0, arc: 90, width: 0, max_targets: 1 },
    "@tg": { range: 0, radius: 0, inner_radius: 0, angle: 0, arc: 90, width: 0, max_targets: 1 },
    "@np": { range: 12, radius: 0, inner_radius: 0, angle: 0, arc: 90, width: 0, max_targets: 1 },
    "@ne": { range: 12, radius: 0, inner_radius: 0, angle: 0, arc: 90, width: 0, max_targets: 1 },
    "@ow": { range: 0, radius: 0, inner_radius: 0, angle: 0, arc: 90, width: 0, max_targets: 1 },
    "@p": { range: 20, radius: 0, inner_radius: 0, angle: 0, arc: 90, width: 0, max_targets: 1 },
    "@e": { range: 20, radius: 0, inner_radius: 0, angle: 0, arc: 90, width: 0, max_targets: 1 },
    "@slo": { range: 0, radius: 0, inner_radius: 0, angle: 0, arc: 90, width: 0, max_targets: 1 },
    "@tlo": { range: 8, radius: 0, inner_radius: 0, angle: 0, arc: 90, width: 0, max_targets: 1 },
    "@tglo": { range: 0, radius: 0, inner_radius: 0, angle: 0, arc: 90, width: 0, max_targets: 1 },
    "@owlo": { range: 0, radius: 0, inner_radius: 0, angle: 0, arc: 90, width: 0, max_targets: 1 },
    "@pl": { range: 0, radius: 0, inner_radius: 0, angle: 0, arc: 90, width: 0, max_targets: 1 },
    "@zp": { range: 12, radius: 0, inner_radius: 0, angle: 0, arc: 90, width: 0, max_targets: 1 },
    "@bj": { range: 0, radius: 0, inner_radius: 0, angle: 0, arc: 90, width: 0, max_targets: 8 },
    "@fw": { range: 0, radius: 0, inner_radius: 0, angle: 0, arc: 90, width: 0, max_targets: 8 },
    "@o": { range: 0, radius: 3, inner_radius: 0, angle: 0, arc: 90, width: 0, max_targets: 8 },
    "@el": { range: 0, radius: 3, inner_radius: 0, angle: 0, arc: 90, width: 0, max_targets: 8 },
  };
  return { ...(presets[targeter] ?? presets["@s"]) };
}

/** 由基础目标器与参数组装完整选择器表达式。 */
export function targetSelectorFrom(base: string, param: string): string {
  if (!param) return base;
  if (["@bj", "@fw"].includes(base)) return `${base}=(${param})`;
  if (base === "@o") return param.includes("+o") ? param : `${param}+o`;
  if (base === "@el") return param.includes("+o") ? param : `${param}+o`;
  return `${base}(${param})`;
}

/** 从 +o(...) 表达式解析范围参数键值。 */
export function parseRangeSelectorParams(selector: string): Record<string, string> {
  const match = selector.match(/\+o\(([^)]*)\)/);
  if (!match) return {};
  return match[1].split(",").reduce<Record<string, string>>((params, part) => {
    const [rawKey, ...rawValue] = part.split("=");
    const key = (rawKey || "").trim();
    const value = rawValue.join("=").trim();
    if (key) params[key] = value;
    return params;
  }, {});
}

/** 拆分多边形点列表。 */
export function splitTargetPoints(text: string): string[] {
  return text ? text.split("/").map((item) => item.trim()).filter(Boolean) : [];
}

/** 提取选择器基础前缀。 */
export function selectorBase(selector: string): string {
  return selector.startsWith("@pl(") ? "@pl" : selector;
}

/** 提取 @x(...) 中的参数体。 */
export function selectorParam(selector: string): string {
  const match = selector.match(/^@\w+\((.*)\)$/);
  return match ? match[1] : "";
}

/** 步骤当前展示的选择器文本。 */
export function targeterText(step: Step): string {
  return step.target_selector || step.targeter || "@s";
}

/** 由步骤推断目标类型（entity/coordinate/range）。 */
export function targetKindFromStep(step: Step): "entity" | "coordinate" | "range" {
  if (["@o", "@el", "@fw", "@bj"].includes(step.targeter)) return "range";
  if (["@slo", "@tlo", "@tglo", "@owlo", "@pl", "@zp"].includes(step.targeter)) return "coordinate";
  return "entity";
}

/** 由步骤推断范围形状。 */
export function rangeShapeFromStep(step: Step): string {
  const selector = targeterText(step);
  if (step.targeter === "@fw") return "polygon";
  if (step.targeter === "@bj") return "border";
  if (step.targeter === "@el") return "ellipse";
  const params = parseRangeSelectorParams(selector);
  if (params.ir !== undefined && (params.c !== undefined || params.ctc !== undefined)) return "fanring";
  if (params.ir !== undefined) return "ring";
  if (params.c !== undefined || params.ctc !== undefined) return "sector";
  return "circle";
}

/** 归一化步骤目标器参数。 */
export function normalizedTargeterParams(step: Step): TargeterParams {
  const params = { ...defaultTargeterParams(step.targeter), ...(step.targeter_params || {}) };
  return {
    range: number(params.range),
    radius: number(params.radius),
    inner_radius: number(params.inner_radius),
    angle: number(params.angle),
    arc: number(params.arc),
    width: number(params.width),
    max_targets: Math.max(1, Math.floor(number(params.max_targets))),
  };
}
