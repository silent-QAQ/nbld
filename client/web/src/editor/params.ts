// 机制参数的默认值 / 归一化 / 反归一化。移植自旧编辑器。
import type { Mechanic } from "./data/mechanics";
import type { MechanicState, MechanicValues } from "./model/types";

/** 机制的默认参数（字符串形式，供表单使用）。 */
export function defaultsFor(mechanic: Mechanic): Record<string, string> {
  const params: Record<string, string> = {};
  mechanic.params.forEach(([key, , , fallback]) => {
    params[key] = fallback;
  });
  return params;
}

/** 表单字符串值归一化为 boolean / number / string。 */
export function normalizedParams(params: Record<string, string | number | boolean>): MechanicValues {
  const normalized: MechanicValues = {};
  Object.entries(params).forEach(([key, value]) => {
    if (value === "true") normalized[key] = true;
    else if (value === "false") normalized[key] = false;
    else if (value === true || value === false) normalized[key] = value;
    else if (value !== "" && !Number.isNaN(Number(value))) normalized[key] = Number(value);
    else normalized[key] = value as string;
  });
  return normalized;
}

/** 机制值转回字符串（表单回填）。 */
export function denormalizedParams(mechanic: MechanicState): Record<string, string> {
  const result: Record<string, string> = {};
  Object.entries(mechanic).forEach(([key, value]) => {
    if (key !== "id") result[key] = String(value);
  });
  return result;
}
