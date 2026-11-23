/**
 * grid-loader — 方块网格加载动画引擎（零依赖，Canvas 2D）
 * 每一帧都是时间的纯函数：drawAt(canvas, opts, tMs) 可复现任意时刻。
 */

export type PaletteKey =
  | 'violet' | 'cyan' | 'amber' | 'emerald' | 'blue' | 'pink'
  | 'mono' | 'monoLight' | 'sand' | 'sandLight';

export type VariantKey =
  | 'wave' | 'diffuse' | 'orbit' | 'scanner' | 'sparkle'
  | 'pulse' | 'codex' | 'morandi' | 'float';

export interface Palette {
  idle: string;
  hot: string;
}

export interface Variant {
  label: string;
  note: string;
  palette: PaletteKey;
  period: number;
  n?: number;
  gap?: number;
  radius?: number;
  alphaBase?: number;
  sizeBase?: number;
  glow?: number;
  /** float 专用：静止尺寸、鼓起幅度、抬升高度、投影强度 */
  restSize?: number;
  swell?: number;
  lift?: number;
  pit?: number;
  /** 亮度模式：返回 0..1 */
  intensity?: (i: number, j: number, n: number, u: number, t: number) => number;
  /** 高度模式：返回 0..1，走"鼓起/抬起/投影"渲染路径 */
  heightFor?: (i: number, j: number, n: number, u: number) => number;
  /** 逐格自定义颜色（莫兰迪那种分色） */
  colorFor?: (i: number, j: number, n: number, a: number, pal: Palette) => string;
  /** 投影颜色 */
  shadeFor?: (i: number, j: number, n: number, h: number, pal: Palette) => string;
}

export interface DrawOptions {
  variant?: VariantKey | string;
  /** 网格 n×n；画布 <32px 且未显式指定时自动降到 3 */
  n?: number;
  gap?: number;
  radius?: number;
  alphaBase?: number;
  sizeBase?: number;
  glow?: number;
  speed?: number;
  theme?: 'dark' | 'light';
  palette?: Palette;
  /** float 专用 */
  restSize?: number;
  swell?: number;
  lift?: number;
  pit?: number;
  /** 中间叠加的图标（已加载完成的 Image / Canvas） */
  icon?: CanvasImageSource & { width: number; height: number };
  iconSize?: number;
  iconColor?: string | null;
  iconAlpha?: number;
  iconShadow?: number;
  iconPulse?: number;
}

export interface Loader {
  start(): void;
  stop(): void;
  drawAt(tMs: number): void;
  update(next: DrawOptions): void;
  destroy(): void;
  readonly opts: DrawOptions;
}

export const PALETTES: Record<PaletteKey, Palette>;
export const VARIANTS: Record<string, Variant>;

export function drawAt(canvas: HTMLCanvasElement, opts: DrawOptions, t: number): void;
export function createGridLoader(canvas: HTMLCanvasElement, opts?: DrawOptions): Loader;
/** 把透明底的图标染成单色（结果缓存，每帧只 drawImage） */
export function tintedImage(img: CanvasImageSource & { width: number }, color: string): HTMLCanvasElement;
