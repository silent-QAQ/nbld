// 通用工具函数，移植自旧编辑器。

/** 解析为有限数，否则回退 0。 */
export function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 钳制到 [0,1]。 */
export function clamp01(value: unknown): number {
  return Math.max(0, Math.min(1, number(value)));
}

/** 生成带前缀的唯一 id。 */
export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
}

/** HTML 转义。 */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 数字输入控件的步进值。 */
export function numberStepFor(key: string): string {
  if (["count", "max_count", "max_targets", "max_stage", "trigger_limit", "max_depth", "max_pierce"].includes(key)) return "1";
  if (["duration", "delay", "interval", "tick", "arm_time"].includes(key)) return "0.05";
  return "0.01";
}
