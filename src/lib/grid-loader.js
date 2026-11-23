/* ============================================================
 * grid-loader.js — 方块网格加载动画引擎（零依赖，Canvas 2D）
 * ------------------------------------------------------------
 * 一个引擎 + 6 个预设，全部是时间的纯函数：
 *   drawAt(t)  → 任意时刻 t(ms) 都能画出确定的一帧
 * 所以动画可以直接接 rAF，也可以暂停 / 冻结 / 截图 / 做视频。
 *
 * 用法：
 *   import { createGridLoader, VARIANTS } from './grid-loader.js'
 *   const loader = createGridLoader(canvas, { variant: 'wave', n: 5, speed: 1 })
 *   loader.start()     // 自动 rAF
 *   loader.drawAt(800) // 冻在 800ms（做截帧/设计稿对比）
 *   loader.destroy()
 * ============================================================ */

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** 高斯鼓包：x 距中心越近越接近 1 */
const bell = (x, w) => Math.exp(-(x * x) / (2 * w * w));
/** 确定性伪随机（同一个 seed 永远同一个值，方便逐帧可复现） */
const rnd = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
};

/* ---------------------------------------------------------------- palettes */
export const PALETTES = {
  violet: { idle: '#34354f', hot: '#a78bfa' },
  cyan: { idle: '#2a3846', hot: '#67e8f9' },
  amber: { idle: '#3e3626', hot: '#f6c177' },
  emerald: { idle: '#264039', hot: '#6ee7b7' },
  blue: { idle: '#2a3350', hot: '#7aa2ff' },
  pink: { idle: '#41303c', hot: '#f9a8d4' },
  /* 单色：Codex 那种"没颜色、只有明暗"的终端感 */
  mono: { idle: '#3a3a3c', hot: '#f4f2ee' },
  monoLight: { idle: '#dcdad5', hot: '#1b1b1d' },
  /* 浅黄沙：浮起扫描用，格子和底座都取自同一支黄 */
  sand: { idle: '#c9b888', hot: '#e6d7a9' },
  sandLight: { idle: '#c0a97a', hot: '#c8b283' },
};

/* 莫兰迪色（低饱和、灰调、互相之间明度接近）——给 morandi 预设逐格分色用 */
const MORANDI = [
  '#c9b8ae', // 灰粉米
  '#a9b4a0', // 灰绿
  '#93a3ae', // 灰蓝
  '#b0a2ab', // 灰紫
  '#c6a99b', // 陶土
  '#c2bca3', // 灰黄
  '#8e9a93', // 墨绿灰
  '#d3c3b4', // 暖沙
];

/* ---------------------------------------------------------------- presets */
/* 每个预设：period(ms) 一个完整循环 + intensity(i, j, n, u, t) → 0..1
 * u = 归一化相位 0..1 */
export const VARIANTS = {
  /* 1. 海面波：两道不同速度的波在网格上交叉，像"一小块海"在起伏 */
  wave: {
    label: 'Sea Wave · 海面波',
    note: '两道交叉的波，适合"Agent 正在干活"的常驻状态',
    palette: 'violet',
    period: 2400,
    intensity(i, j, n, u) {
      const diag = (i + j) / (2 * (n - 1));
      const row = i / (n - 1);
      const h1 = ((u * 1.5) % 1.35) - 0.15;
      const h2 = 1.15 - ((u * 1.15) % 1.35);
      return clamp(
        Math.max(bell(diag - h1, 0.1), 0.85 * bell(row - h2, 0.09)) * 1.05,
        0,
        1
      );
    },
  },

  /* 2. 去噪填充：像 diffusion 出图，一块一块被"算出来"，末尾整体淡出重置 */
  diffuse: {
    label: 'Denoise Fill · 去噪填充',
    note: '逐格点亮 + 边缘高光，最像"图片正在生成"',
    palette: 'amber',
    period: 3000,
    intensity(i, j, n, u) {
      const th = rnd(i * 31 + j * 17 + 3); // 每格自己的出现阈值
      const reveal = smoothstep(th * 0.82, th * 0.82 + 0.1, u * 1.02);
      const edge = bell(u - (th * 0.82 + 0.05), 0.045); // 正在生成的那一圈
      const tail = u > 0.9 ? 1 - smoothstep(0.9, 1, u) : 1; // 收尾淡出
      return clamp((reveal * 0.78 + edge * 0.55) * tail, 0, 1);
    },
  },

  /* 3. 环绕：中环上的格子依次点亮，像轨道上有东西在转 */
  orbit: {
    label: 'Orbit · 环绕',
    note: '环形追光，安静、克制，适合小尺寸状态位',
    palette: 'emerald',
    period: 2000,
    intensity(i, j, n, u) {
      const c = (n - 1) / 2;
      const di = i - c;
      const dj = j - c;
      const r = Math.hypot(di, dj);
      if (r < 0.5) return 0.18 + 0.14 * Math.sin(u * TAU); // 中心格慢呼吸
      const a = Math.atan2(dj, di) / TAU + 0.5; // 0..1
      const head = u;
      const d = Math.abs(((a - head + 1.5) % 1) - 0.5) * 2; // 环形距离
      const trail = Math.abs(((a - (head - 0.12) + 1.5) % 1) - 0.5) * 2;
      return clamp(bell(d, 0.22) + 0.45 * bell(trail, 0.3), 0, 1);
    },
  },

  /* 4. 扫描：一条斜向扫描线整体刷过一遍，像在刷新/重新渲染 */
  scanner: {
    label: 'Scanner · 扫描刷新',
    note: '整屏刷一遍，适合"重新加载/重新绘帧"',
    palette: 'blue',
    period: 1800,
    intensity(i, j, n, u) {
      const head = u * (n + 2) - 1;
      const d = i - (head - j * 0.45); // 行偏移 → 斜线
      const sweep = bell(d, 0.55);
      const residual = 0.06 * (1 - smoothstep(0, 1, u)); // 刷过之后留一点余温
      return clamp(sweep + residual, 0, 1);
    },
  },

  /* 5. 随机闪烁：每一拍随机点亮几格再衰减，像数据在噼里啪啦地来 */
  sparkle: {
    label: 'Sparkle · 随机闪烁',
    note: '噪声式闪动，最"热闹"，适合短时等待',
    palette: 'pink',
    period: 1400,
    intensity(i, j, n, u, t) {
      const beat = 150;
      const k = Math.floor(t / beat);
      const f = (t % beat) / beat;
      let a = 0;
      for (let b = 0; b < 2; b++) {
        const h = rnd(i * 71 + j * 37 + (k - b) * 13);
        if (h > 0.52) {
          a = Math.max(a, ((h - 0.52) / 0.48) * Math.pow(1 - Math.min(1, (f + b) * 0.8), 1.5));
        }
      }
      return clamp(a, 0, 1);
    },
  },

  /* 6. 经典九宫格脉冲：SpinKit 那种 3×3 依次缩放的节奏 */
  pulse: {
    label: 'Pulse · 九宫格脉冲',
    note: '最经典的一版，一眼就懂"在转"',
    palette: 'cyan',
    n: 3,
    period: 1300,
    intensity(i, j, n, u) {
      const d = (i + j) / (2 * (n - 1));
      const p = (u - d * 0.42 + 1) % 1;
      const dip = bell(p - 0.35, 0.11) + bell(p - 0.35 + 1, 0.11);
      return clamp(1 - 0.88 * dip, 0, 1);
    },
  },

  /* 7. Codex 风格：单色、直角、几乎无光晕；两束光点沿“蛇形路径”追着跑。
   *    路径是 boustrophedon（一行从左到右、下一行从右到左），所以光点像在网格里
   *    逐格巡航，而不是整片一起亮——这正是 Codex / 终端类 agent 的“我在干活”。 */
  codex: {
    label: 'Codex Sweep · 码流',
    note: '单色直角小方格 + 双光点蛇形巡航，最像 Codex 的工作状态',
    palette: 'mono',
    n: 5,
    gap: 0.2,
    radius: 0.12,
    alphaBase: 0.14, // 灭的时候很淡 → 亮点在网格里跑
    sizeBase: 1, // 不缩放，保持"像素块"的硬边
    glow: 0.3, // 几乎不放光，硬边更像终端
    period: 1900,
    intensity(i, j, n, u) {
      const m = j % 2 === 0 ? j * n + i : j * n + (n - 1 - i); // 蛇形序号
      const M = n * n;
      const p = u * M;
      let best = 0;
      for (let k = 0; k < 2; k++) {
        const head = (p + (k * M) / 2) % M;
        let s = (((head - m) % M) + M) % M; // 0..M，正数 = 已被扫过（拖尾）
        if (s > M / 2) s -= M;
        const sigma = s > 0 ? 2.0 : 0.85;
        best = Math.max(best, Math.exp(-(s * s) / (2 * sigma * sigma)));
      }
      return clamp(best + 0.04, 0, 1);
    },
  },

  /* 8. 莫兰迪扫描：scanner 的放大版——50×50、更方的角、每格一种莫兰迪色。
   *    颜色按 (i,j) 固定分配，所以扫过去像一面慢慢被照亮的色卡墙，
   *    而不是单色光带。格子不缩放、不发光，靠颜色本身说话。 */
  morandi: {
    label: 'Morandi Sweep · 莫兰迪扫描',
    note: '50×50 + 莫兰迪分色，扫过像一面被点亮的色卡墙',
    palette: 'mono',
    n: 50,
    gap: 0.18,
    radius: 0.1,
    alphaBase: 1, // 亮度全靠颜色混合，不用整体透明
    sizeBase: 1, // 格子大小恒定，保持"瓷砖"感
    glow: 0, // 不放光，硬边
    period: 4200,
    intensity(i, j, n, u) {
      const p = (i + j) / (2 * (n - 1)); // 归一化对角线位置 0..1
      const w = 0.08;
      const head = u * (1 + 2 * w) - w;
      const s = p - head;
      let v = Math.exp(-(s * s) / (2 * (s > 0 ? 0.1 : 0.032) ** 2)); // 前缘硬、拖尾长
      const head2 = ((u + 0.52) % 1) * (1 + 2 * w) - w; // 第二道细边，增加层次
      const s2 = p - head2;
      v = Math.max(v, 0.32 * Math.exp(-(s2 * s2) / (2 * 0.028 ** 2)));
      return clamp(v);
    },
    colorFor(i, j, n, a) {
      /* 色相按 4×4 的小区块分配（而不是逐格随机），这样是一片片颜色，
       * 而不是彩噪；同一块内再按格子做一点明度抖动，保留颗粒感。 */
      const bi = Math.floor(i / 4);
      const bj = Math.floor(j / 4);
      const c = MORANDI[(bi * 3 + bj * 5) % MORANDI.length];
      const jitter = ((i * 13 + j * 7) % 5) * 0.012; // 0..0.048
      const t = clamp(0.06 + 0.94 * Math.pow(a, 0.85) + jitter * a, 0, 1);
      return mixHex('#1a1b1f', c, t);
    },
  },

  /* 9. 浮起扫描（float）：一整面同色的浅黄小方块，只有"高低"在动。
   *    一条斜向的鼓包从左下推到右上：扫到哪儿，那一带格子就鼓起、抬起来；
   *    其余地方在底下缓慢地升起落下（像水面/呼吸），不靠明暗区分任何东西。 */
  float: {
    label: 'Float Scan · 浮起扫描',
    note: '同色浅黄 + 扫描鼓包，扫过处鼓起浮起，其余在底下轻轻浮动',
    palette: 'sand',
    n: 50,
    gap: 0.3,
    radius: 0.16,
    alphaBase: 1,
    sizeBase: 1,
    glow: 0,
    restSize: 0.8, // 静止尺寸
    swell: 0.3, // 鼓起来时稍微变大（50×50 下已经够看见）
    lift: 0.34, // 向上抬三分之一格高
    pit: 0.85, // 投影强度：抬得越高、影子越远越大
    shadeFor() {
      return 'rgba(28,24,14,0.9)';
    },
    period: 4200,
    heightFor(i, j, n, u) {
      /* 底噪浮动：两层不同速度的行波叠起来，避免整面墙同步呼吸 */
      const bob =
        0.5 +
        0.5 * Math.sin(TAU * (u * 2 + (i * 0.055 + j * 0.042))) * 0.6 +
        0.5 * Math.sin(TAU * (u * 1.3 - (i * 0.031 - j * 0.019))) * 0.4;
      /* 扫描带：沿着对角线推过去，前坡紧、后坡缓。
       * 每格再加一点相位抖动，让同一带里的方块不是整齐划一地鼓，
       * 而是一个接一个地冒出来 —— 这样才像"一格一格浮起来"。 */
      const jit = (rnd(i * 41 + j * 23) - 0.5) * 0.045;
      const p = (i + j) / (2 * (n - 1)) + jit;
      const w = 0.09;
      const head = u * (1 + 2 * w) - w;
      const s = p - head;
      const swell = Math.exp(-(s * s) / (2 * (s > 0 ? 0.085 : 0.055) ** 2));
      return clamp(0.32 * bob + swell, 0, 1);
    },
    colorFor(i, j, n, h, pal) {
      /* 全部同一支黄，只留 ±4% 的明度抖动，避免一整面死平 */
      const k = rnd(i * 17 + j * 29) * 0.5;
      return mixHex(pal.hot, '#f2e8c8', k * 0.5);
    },
    shadeFor(i, j, n, h, pal) {
      return mixHex(pal.hot, '#0b0c0f', 0.6);
    },
  },
};

/* ---------------------------------------------------------------- drawing */
function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = ((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * t;
  const g = ((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * t;
  const bl = (pa & 255) + ((pb & 255) - (pa & 255)) * t;
  return `rgb(${r | 0},${g | 0},${bl | 0})`;
}

/* 把一张带透明度的图（logo / 图标）染成单色，结果缓存起来，每帧只做一次 drawImage */
const tintCache = new WeakMap();
export function tintedImage(img, color) {
  let m = tintCache.get(img);
  if (!m) {
    m = new Map();
    tintCache.set(img, m);
  }
  if (m.has(color)) return m.get(color);
  const c = document.createElement('canvas');
  c.width = Math.max(1, img.width || img.naturalWidth);
  c.height = Math.max(1, img.height || img.naturalHeight);
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0, c.width, c.height);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  m.set(color, c);
  return c;
}

function roundRect(ctx, x, y, w, h, r) {  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, rr);
  else {
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
}

export function drawAt(canvas, opts, t) {
  const o = {
    variant: 'wave',
    speed: 1,
    glow: 1,
    palette: null,
    theme: 'dark',
    ...opts,
  };
  const v = VARIANTS[o.variant] || VARIANTS.wave;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const W = Math.max(1, Math.round(rect.width));
  const H = Math.max(1, Math.round(rect.height));

  /* 几何 / 亮度曲线：未显式传入时用预设自己的默认值
   * 画布很小时自动降格数（5×5 在 16px 上每格不足 2 像素，必糊） */
  let n = o.n ?? v.n ?? 5;
  if (o.n == null && Math.min(W, H) < 32 && n > 3) n = 3;
  const gap = o.gap ?? v.gap ?? 0.22;
  const radius = o.radius ?? v.radius ?? 0.38;
  const alphaBase = o.alphaBase ?? v.alphaBase ?? 0.34;
  const sizeBase = o.sizeBase ?? v.sizeBase ?? 0.52;
  const glow = o.glow ?? v.glow ?? 1;

  let pal = o.palette || PALETTES[v.palette] || PALETTES.violet;
  if (!o.palette && o.theme === 'light' && v.palette === 'mono') pal = PALETTES.monoLight;
  if (!o.palette && o.theme === 'light' && v.palette === 'sand') pal = PALETTES.sandLight;

  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width = W * dpr;
    canvas.height = H * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const pad = 6; // 给光晕留的边
  const box = Math.min(W, H) - pad * 2;
  const cell = box / (n + (n - 1) * gap);
  const step = cell * (1 + gap);
  const total = n * cell + (n - 1) * cell * gap;
  const x0 = (W - total) / 2;
  const y0 = (H - total) / 2;

  const phase = ((t * o.speed) % v.period) / v.period;

  /* 图标（logo / 星标）：画在网格之上，跟着扫描带轻轻起伏；
   * 单色渲染靠 tintedImage 缓存，不做逐帧像素处理。 */
  const paintIcon = () => {
    if (!o.icon || !o.icon.width) return;
    const base = Math.min(W, H) * (o.iconSize ?? 0.28);
    const color = o.iconColor ?? '#fbf8ef'; // 浅白
    let lift = 0;
    if (v.heightFor) {
      const hc = clamp(v.heightFor((n - 1) / 2, (n - 1) / 2, n, phase));
      lift = (o.iconPulse ?? 1) * hc;
    }
    const size = base * (1 + 0.05 * lift);
    const cx = W / 2;
    const cy = H / 2 - size * 0.05 * lift;
    ctx.globalAlpha = o.iconAlpha ?? 1;
    if (o.iconShadow ?? 1) {
      /* 阴影跟着字形走（用 canvas 自己的 shadow），比画椭圆干净 */
      ctx.shadowColor = o.theme === 'light' ? 'rgba(112,92,56,0.45)' : 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = size * (0.03 + 0.05 * lift);
      ctx.shadowOffsetY = size * (0.012 + 0.02 * lift);
    }
    ctx.drawImage(o.iconColor === null ? o.icon : tintedImage(o.icon, color),
      cx - size / 2, cy - size / 2, size, size);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.globalAlpha = 1;
  };

  ctx.save();

  /* ---- 高度模式（float）：不发光的同色块，只靠"鼓起 / 抬起 / 底座"表现浮动 ---- */
  if (v.heightFor) {
    const swell = o.swell ?? v.swell ?? 0.5;
    const lift = o.lift ?? v.lift ?? 0.55;
    const rest = o.restSize ?? v.restSize ?? 1; // 静止时的块大小（× cell）
    const pit = o.pit ?? v.pit ?? 0; // 投影强度，0 = 不画
    const buckets = [[], [], [], []];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const h = clamp(v.heightFor(i, j, n, phase));
        buckets[Math.min(3, (h * 4) | 0)].push(i, j, h);
      }
    }
    /* 先画投影、再画方块：投影是"离桌面多高"的唯一线索，方块本身不换色 */
    if (pit > 0) {
      for (let b = 0; b < 4; b++) {
        const arr = buckets[b];
        for (let k = 0; k < arr.length; k += 3) {
          const i = arr[k];
          const j = arr[k + 1];
          const h = arr[k + 2];
          if (h < 0.14) continue;
          const cx = x0 + i * step + cell / 2;
          const cy = y0 + j * step + cell / 2 + cell * 0.07;
          const g = 1 + 0.18 * h;
          ctx.globalAlpha = pit * smoothstep(0.14, 0.6, h);
          ctx.fillStyle = v.shadeFor ? v.shadeFor(i, j, n, h, pal) : '#241f14';
          ctx.beginPath();
          ctx.ellipse(cx, cy, cell * 0.36 * g, cell * 0.15 * g, 0, 0, TAU);
          ctx.fill();
        }
      }
    }
    /* 从矮到高画，高的盖住矮的，重叠处才有"浮在上面"的层次 */
    for (let b = 0; b < 4; b++) {
      const arr = buckets[b];
      for (let k = 0; k < arr.length; k += 3) {
        const i = arr[k];
        const j = arr[k + 1];
        const h = arr[k + 2];
        const cx = x0 + i * step + cell / 2;
        const cyBase = y0 + j * step + cell / 2;
        const size = cell * rest + cell * swell * h;
        const cy = cyBase - cell * lift * h;
        ctx.globalAlpha = 1;
        ctx.fillStyle = v.colorFor ? v.colorFor(i, j, n, h, pal) : pal.hot;
        roundRect(ctx, cx - size / 2, cy - size / 2, size, size, size * radius);
        ctx.fill();
      }
    }
    ctx.restore();
    paintIcon();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    return;
  }

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = clamp(v.intensity(i, j, n, phase, t * o.speed));
      const s = sizeBase + (1 - sizeBase) * a; // 越亮越大，永不消失
      const size = cell * s;
      const cx = x0 + i * step + cell / 2;
      const cy = y0 + j * step + cell / 2;
      ctx.globalAlpha = alphaBase + (1 - alphaBase) * a;
      if (glow > 0 && a > 0.55) {
        ctx.shadowColor = pal.hot;
        ctx.shadowBlur = cell * 0.55 * glow * (a - 0.55) * 2;
      } else {
        ctx.shadowBlur = 0;
      }
      /* 预设可以自己决定这一格的颜色（莫兰迪那种"逐格分色"就靠它） */
      ctx.fillStyle = v.colorFor
        ? v.colorFor(i, j, n, a, pal)
        : mixHex(pal.idle, pal.hot, Math.pow(a, 0.85));
      roundRect(ctx, cx - size / 2, cy - size / 2, size, size, size * radius);
      ctx.fill();
    }
  }
  ctx.restore();
  paintIcon();
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

/* ---------------------------------------------------------------- runtime */
export function createGridLoader(canvas, opts = {}) {
  const state = {
    opts: { ...opts },
    running: false,
    raf: 0,
    t0: performance.now() - (opts.offset || 0),
  };
  const loop = (now) => {
    if (!state.running) return;
    drawAt(canvas, state.opts, now - state.t0);
    state.raf = requestAnimationFrame(loop);
  };
  return {
    start() {
      if (state.running) return;
      state.running = true;
      state.raf = requestAnimationFrame(loop);
    },
    stop() {
      state.running = false;
      cancelAnimationFrame(state.raf);
    },
    drawAt(t) {
      drawAt(canvas, state.opts, t);
    },
    update(next) {
      Object.assign(state.opts, next);
      if (!state.running) drawAt(canvas, state.opts, 0);
    },
    destroy() {
      this.stop();
    },
    get opts() {
      return state.opts;
    },
  };
}
