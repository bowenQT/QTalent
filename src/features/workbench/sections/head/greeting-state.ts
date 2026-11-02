/** Time-of-day greeting by the viewer's local hour (prototype workbench.js greet). */
export function greetingFor(hour: number, name: string): string {
  const part =
    hour < 11
      ? '上午好'
      : hour < 13
        ? '中午好'
        : hour < 18
          ? '下午好'
          : '晚上好';
  return `${part}，${name}`;
}

/** Shown on the server render and before the viewer's clock is known. */
export const neutralGreeting = (name: string) => `你好，${name}`;

const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

/** `2026-09-04` → `9 月 4 日 · 周五`; the weekday is computed, never fixed. */
export function dateLine(asOf: string): string {
  const [year, month, day] = asOf.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${month} 月 ${day} 日 · 周${weekdays[weekday]}`;
}
