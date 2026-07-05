// 导出面板（§10 右栏 / §129）：编译当前技能为结构表，分页展示 + 校验状态 + 复制/下载。
// 移植自旧编辑器 renderOutput()，并扩展 modifiers 分页与技能库引用校验。
import type { AppState } from "../state";
import type { OutputTab } from "../state";
import { byId, delegate } from "../dom";
import { compile } from "../compile";
import { validateSkill } from "../validate";
import { downloadText } from "./library";
import { escapeHtml } from "../util";

const OUTPUT_TABS: [OutputTab, string][] = [
  ["all", "总配置"],
  ["steps", "步骤表"],
  ["mechanics", "效果表"],
  ["conditions", "条件表"],
  ["modifiers", "修正表"],
  ["text", "技能文本"],
];

/** 取当前技能编译产物；无技能时返回 null。 */
function currentResult(app: AppState) {
  const skill = app.currentSkill();
  if (!skill) return null;
  const result = compile(skill);
  // 引用完整性/平衡校验需要整库上下文，覆盖 compile 内的默认校验结果。
  result.issues = validateSkill(skill, { library: app.library });
  return result;
}

/** 按当前页签挑选要展示的产物切片。 */
function payloadFor(app: AppState, result: NonNullable<ReturnType<typeof currentResult>>): unknown {
  switch (app.outputTab) {
    case "steps": return result.skill_steps;
    case "mechanics": return result.skill_mechanics;
    case "conditions": return { groups: result.skill_condition_groups, conditions: result.skill_conditions };
    case "modifiers": return result.skill_modifiers;
    case "text": return result.skill_text;
    default: return result;
  }
}

/** 当前导出面板的文本内容（复制/下载复用）。 */
function outputText(app: AppState): string {
  const result = currentResult(app);
  if (!result) return "";
  const payload = payloadFor(app, result);
  if (app.outputTab === "text" && Array.isArray(payload)) return payload.join("\n");
  return JSON.stringify(payload, null, 2);
}

export function renderOutput(app: AppState, host: HTMLElement): void {
  const result = currentResult(app);
  const badCount = result ? result.issues.filter((i) => i.level === "bad").length : 0;
  const warnCount = result ? result.issues.filter((i) => i.level === "warn").length : 0;
  const summaryClass = badCount ? "pill bad" : warnCount ? "pill warn" : "pill";
  const summaryText = badCount || warnCount ? `${badCount} 错误 · ${warnCount} 警告` : "0 个问题";
  const statusHtml = result && result.issues.length
    ? result.issues
        .map((issue) => `<span class="pill ${issue.level}">${issue.line ? `第 ${issue.line} 步：` : "技能："}${escapeHtml(issue.text)}</span>`)
        .join("")
    : `<span class="pill">配置可导出</span>`;
  host.innerHTML = `
    <div class="panel-header">
      <h2>导出结果</h2>
      <span class="${summaryClass}" id="validationSummary">${summaryText}</span>
    </div>
    <div class="tabs">
      ${OUTPUT_TABS.map(([id, label]) => `<button data-tab="${id}"${id === app.outputTab ? ' class="active"' : ""}>${label}</button>`).join("")}
    </div>
    <pre id="output">${escapeHtml(outputText(app))}</pre>
    <div class="status" id="status">${statusHtml}</div>`;
}

export function bindOutput(app: AppState): void {
  const panel = byId("outputPanel");
  delegate(panel, "click", "[data-tab]", (el) => {
    app.outputTab = el.dataset.tab as OutputTab;
    renderOutput(app, panel);
  });

  byId("copyJson").addEventListener("click", () => {
    navigator.clipboard?.writeText(outputText(app)).catch(() => {});
  });
  byId("downloadJson").addEventListener("click", () => {
    const skill = app.currentSkill();
    downloadText(outputText(app), `${skill?.skill_id || "skill_config"}.json`);
  });
}
