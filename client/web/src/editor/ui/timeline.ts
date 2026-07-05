// 效果时间线页（§10.3）：把技能各步骤按 delay 起点、repeat×interval 时长排布成可视时间轴。
// 只读视图，帮助策划核对命中/位移/表现事件的先后与重叠；编辑仍在“效果编排”页。
import type { AppState } from "../state";
import type { Step } from "../model/types";
import { mechanicById, mechanicLabel } from "../data/mechanics";
import { escapeHtml } from "../util";

/** 单个步骤在时间线上的起止秒。repeat>1 时按 interval 估算持续跨度。 */
function stepSpan(step: Step): { start: number; end: number } {
  const start = Math.max(0, step.delay || 0);
  const repeats = Math.max(1, step.repeat || 1);
  const interval = step.interval || 0;
  const span = repeats > 1 ? interval * (repeats - 1) : 0;
  // 持续型机制（区域/光环/持续伤害/射线）用其 duration 参数体现跨度。
  const duration = Number((step.mechanic as Record<string, unknown>).duration) || 0;
  return { start, end: start + Math.max(span, duration) };
}

function niceCeil(value: number): number {
  if (value <= 1) return 1;
  if (value <= 2) return 2;
  if (value <= 5) return 5;
  return Math.ceil(value);
}

export function renderTimeline(app: AppState, host: HTMLElement): void {
  const skill = app.currentSkill();
  if (!skill || skill.steps.length === 0) {
    host.innerHTML = '<div class="pill">请先在“效果编排”页添加技能步骤</div>';
    return;
  }
  const spans = skill.steps.map(stepSpan);
  const maxTime = niceCeil(Math.max(1, ...spans.map((s) => s.end)));
  const ticks = 5;

  const rows = skill.steps.map((step, index) => {
    const { start, end } = spans[index];
    const category = mechanicById(step.mechanic.id).category;
    const left = (start / maxTime) * 100;
    const width = Math.max(3, ((end - start) / maxTime) * 100);
    const repeatBadge = (step.repeat || 1) > 1 ? ` ×${step.repeat}` : "";
    const blockLabel = `${index + 1}. ${escapeHtml(mechanicLabel(step.mechanic.id))}${repeatBadge}`;
    const rowLabel = `${escapeHtml(step.name || `步骤${index + 1}`)}<br><span style="color:var(--muted)">~${escapeHtml(step.trigger)}</span>`;
    return `<div class="timeline-row">
      <div style="font-size:12px">${rowLabel}</div>
      <div class="timeline-track">
        <div class="timeline-block cat-${category}" style="left:${left}%;width:${width}%" title="${blockLabel} · ${start}s→${end}s">${blockLabel} · ${start}s</div>
      </div>
    </div>`;
  }).join("");

  const tickLabels = Array.from({ length: ticks + 1 }, (_, i) => {
    const t = (maxTime / ticks) * i;
    return `<span>${t % 1 === 0 ? t : t.toFixed(1)}s</span>`;
  }).join("");

  host.innerHTML = `
    <div class="card">
      <h3>效果时间线</h3>
      <p style="color:var(--muted);font-size:12px;margin:0">
        以 delay 为起点、repeat×interval 与机制持续为跨度排布。颜色对应机制类别（伤害 / 载体 / 位移 / 状态 / 实体 / 逻辑 / 表现 / 技能组）。
      </p>
      <div class="timeline">${rows}</div>
      <div class="timeline-axis">
        <div>时间轴</div>
        <div class="timeline-ticks">${tickLabels}</div>
      </div>
    </div>`;
}
