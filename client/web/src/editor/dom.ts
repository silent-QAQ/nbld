// 极简 DOM 辅助。

/** 按 id 取元素并断言类型。 */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
}

/** 事件委托：在 root 上监听，命中 selector 时回调最近祖先元素。 */
export function delegate(
  root: HTMLElement,
  eventType: string,
  selector: string,
  handler: (el: HTMLElement, event: Event) => void,
): void {
  root.addEventListener(eventType, (event) => {
    const target = event.target as HTMLElement | null;
    const match = target?.closest(selector) as HTMLElement | null;
    if (match && root.contains(match)) handler(match, event);
  });
}

/** 生成 <option> 列表 HTML。 */
export function optionsHtml(entries: readonly (readonly [string, string])[], selected: string): string {
  return entries
    .map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`)
    .join("");
}
