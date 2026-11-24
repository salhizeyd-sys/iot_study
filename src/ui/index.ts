export const $ = <T extends HTMLElement = HTMLElement>(s: string): T | null =>
  document.querySelector<T>(s);

export const esc = (s: any): string =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c)
  );

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(m: string): void {
  const t = $('#toast');
  if (!t) return;
  t.textContent = m;
  t.style.display = 'block';
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (t) t.style.display = 'none';
  }, 3200);
}
