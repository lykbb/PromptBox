// 外观：主题色（黑白灰、纸张、海蓝……）和明暗（浅色、深色，或跟着系统）分开选。
// 结果写在 <html data-palette data-theme> 上，样式只认这两个属性。
// 选择存在设置里，也抄一份到 localStorage：index.html 在页面画出来之前读它，深色模式下就不会先闪一下白。

export type Theme = 'system' | 'light' | 'dark';
export type Palette = 'mono' | 'paper' | 'ocean' | 'forest' | 'violet';

export const PALETTES: { id: Palette; label: string }[] = [
  { id: 'mono', label: '黑白灰' },
  { id: 'paper', label: '纸张' },
  { id: 'ocean', label: '海蓝' },
  { id: 'forest', label: '森林' },
  { id: 'violet', label: '暮紫' },
];

const THEME_KEY = 'promptbox-theme';
const PALETTE_KEY = 'promptbox-palette';
const DARK = '(prefers-color-scheme: dark)';

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return window.matchMedia(DARK).matches ? 'dark' : 'light';
}

/** 套用外观。跟着系统时也跟着系统的切换走；每次算出浅色还是深色都告诉调用方。返回取消监听的函数。 */
export function applyTheme(theme: Theme, palette: Palette, onResolved?: (mode: 'light' | 'dark') => void): () => void {
  const root = document.documentElement;
  const apply = () => {
    const mode = resolveTheme(theme);
    root.dataset.theme = mode;
    onResolved?.(mode);
  };
  root.dataset.palette = palette;
  apply();
  try {
    localStorage.setItem(THEME_KEY, theme);
    localStorage.setItem(PALETTE_KEY, palette);
  } catch {
    // 存不了只影响下次打开时会不会闪一下
  }
  if (theme !== 'system') return () => undefined;
  const media = window.matchMedia(DARK);
  media.addEventListener('change', apply);
  return () => media.removeEventListener('change', apply);
}
