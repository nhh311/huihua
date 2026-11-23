const model = (base) => ({
  resolutions: ['1K', '2K'],
  ratios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
  defaultResolution: '2K',
  countMax: 4,
  refMax: 8,
  seed: false,
  negative: false,
  watermark: false,
  edit: true,
  builtin: true,
  adapted: true,
  ...base,
})

const CATALOG = [
  {
    id: 'seedream',
    name: 'Seedream',
    subtitle: '火山方舟 · 豆包',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-seedream-5-5-261028',
    hasKey: true,
    models: [
      model({
        id: 'doubao-seedream-5-5-261028',
        name: 'Seedream 5.5',
        desc: '最新旗舰，原生 RGBA，支持多轮编辑',
        provider: 'seedream',
        resolutions: ['1K', '1.5K', '2K'],
        refMax: 10,
      }),
      model({
        id: 'doubao-seedream-5-0-pro-260628',
        name: 'Seedream 5.0 Pro',
        desc: '高质量，支持更大的面积',
        provider: 'seedream',
        resolutions: ['1K', '2K', '4K'],
        refMax: 10,
        adapted: true,
      }),
      model({
        id: 'doubao-seedream-5-0-flash-260915',
        name: 'Seedream 5.0 Flash',
        desc: '更快、更便宜',
        provider: 'seedream',
        resolutions: ['1K', '2K'],
        refMax: 10,
      }),
    ],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    subtitle: 'H3 生图',
    baseUrl: 'https://api.minimax.cn',
    defaultModel: 'MiniMax-H3-Image',
    hasKey: true,
    models: [
      model({
        id: 'MiniMax-H3-Image',
        name: 'MiniMax H3',
        desc: '细节与指令跟随，支持最多 16 张参考图',
        provider: 'minimax',
        resolutions: ['1K', '2K', '4K'],
        refMax: 16,
      }),
      model({
        id: 'MiniMax-H3-Image-Highspeed',
        name: 'MiniMax H3 高速',
        desc: '速度优先，参数与 H3 相同',
        provider: 'minimax',
        resolutions: ['1K', '2K'],
        refMax: 16,
      }),
    ],
  },
  {
    id: 'hunyuan',
    name: '混元',
    subtitle: '腾讯 TokenHub',
    baseUrl: 'https://tokenhub.tencentmaas.com',
    defaultModel: 'hy-image-v3.5-preview',
    hasKey: true,
    models: [
      model({
        id: 'hy-image-v3.5-preview',
        name: '混元生图 3.5',
        desc: '中文语义与风格化，唯一支持 seed',
        provider: 'hunyuan',
        resolutions: ['1K', '2K', '4K'],
        seed: true,
        refMax: 5,
        countMax: 1,
      }),
    ],
  },
]

const STYLES = [
  {
    id: 'builtin-cinematic-night',
    name: '电影感夜景',
    description: '低照度、青橙对比、宽银幕氛围',
    prompt: '电影感夜景，低照度，青橙对比，宽银幕构图，细腻体积光',
    recommended: { provider: 'seedream', ratio: '16:9', resolution: '2K', count: 1 },
    samples: [],
    sampleUrls: [],
    coverUrl: null,
    builtin: true,
    createdAt: null,
  },
  {
    id: 'builtin-japanese-illustration',
    name: '日系插画',
    description: '柔和线条、空气感、低饱和配色',
    prompt: '日系插画，柔和线条，空气感，低饱和配色，细腻纸张质感',
    recommended: { provider: 'seedream', ratio: '3:4', resolution: '2K', count: 1 },
    samples: [],
    sampleUrls: [],
    coverUrl: null,
    builtin: true,
    createdAt: null,
  },
  {
    id: 'builtin-product-photo',
    name: '产品摄影',
    description: '干净背景、棚拍光、商业质感',
    prompt: '产品摄影，干净背景，棚拍柔光，商业质感，高细节',
    recommended: { provider: 'seedream', ratio: '1:1', resolution: '2K', count: 1 },
    samples: [],
    sampleUrls: [],
    coverUrl: null,
    builtin: true,
    createdAt: null,
  },
]

const PRESET_DATA = window.__PRESETS_MOCK__ || { meta: {}, categories: [], presets: [] }
const PRESET_FAVORITES = new Set()
let PRESET_RECENT = []

// ---- gallery mock (作品 / 最近删除) ----
const MOCK_PREVIEWS = (PRESET_DATA.presets || []).slice(0, 3)
const GALLERY_ITEMS = MOCK_PREVIEWS.map((preset, index) => ({
  id: `17953653246${index}-mock`,
  file: `images/2026-11/17953653246${index}-mock.png`,
  thumb: `thumbs/17953653246${index}-mock.jpg`,
  width: preset.width || 1024,
  height: preset.height || 1024,
  createdAt: new Date(Date.now() - (index + 1) * 3600 * 1000).toISOString(),
  prompt: preset.prompt || '示例作品',
  provider: 'seedream',
  model: 'doubao-seedream-5-5-261028',
  ratio: preset.ratio || '1:1',
  resolution: '2K',
  seed: null,
  sessionId: null,
  styleId: null,
  countIndex: index,
  url: preset.preview,
  thumbUrl: preset.thumb,
  deletedAt: null,
}))

const PRESETS_EMPTY = /(^|[?&])nolib\b/.test(location.search)
let PRESET_ORIGIN = 'builtin'

const presetCatalog = () =>
  PRESETS_EMPTY && PRESET_ORIGIN === 'builtin'
    ? {
        available: false,
        error: '还没有素材库。',
        root: '',
        source: '',
        scrapedAt: '',
        license: '',
        origin: 'builtin',
        userRoot: 'mock://user/presets',
        count: 0,
        categories: [],
        presets: [],
        favorites: [],
        recent: [],
      }
    : {
        available: true,
        error: null,
        root: PRESET_ORIGIN === 'user' ? 'mock://user/presets' : 'mock://resources/presets',
        source: (PRESET_DATA.meta && PRESET_DATA.meta.source) || 'nanobanana-ai.cn',
        scrapedAt: (PRESET_DATA.meta && PRESET_DATA.meta.scrapedAt) || '2026-11-22',
        license: (PRESET_DATA.meta && PRESET_DATA.meta.license) || 'Mock data for UI review',
        origin: PRESET_ORIGIN,
        userRoot: 'mock://user/presets',
        count: PRESET_DATA.presets.length,
        categories: PRESET_DATA.categories,
        presets: PRESET_DATA.presets.map((preset) => ({
          ...preset,
          favorite: PRESET_FAVORITES.has(preset.id),
          usedAt: (PRESET_RECENT.find((item) => item.id === preset.id) || {}).at || null,
        })),
        favorites: [...PRESET_FAVORITES],
        recent: PRESET_RECENT,
      }

const touchPreset = (id) => {
  PRESET_RECENT = [{ id, at: Date.now() }, ...PRESET_RECENT.filter((item) => item.id !== id)].slice(0, 12)
}

const CONFIG = {
  version: 1,
  deepseek: { baseUrl: 'https://api.deepseek.com', hasKey: true, keyHint: 'sk-••••a1b2' },
  providers: {
    seedream: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', hasKey: true, keyHint: '••••9f3c' },
    minimax: { baseUrl: 'https://api.minimax.cn', hasKey: true, keyHint: '••••7d2a' },
    hunyuan: { baseUrl: 'https://tokenhub.tencentmaas.com', hasKey: true, keyHint: '••••5e81' },
  },
  defaults: {
    provider: 'seedream',
    model: 'doubao-seedream-5-5-261028',
    ratio: '1:1',
    resolution: '2K',
    count: 1,
    seed: null,
    search: true,
    styleId: null,
    theme: 'system',
  },
  models: { enabled: {}, hidden: [], custom: [] },
  onboarded: true,
  dataDir: 'C:\\Users\\<user>\\AppData\\Roaming\\绘话',
}

const PLAN = {
  title: '雨夜霓虹街角',
  prompt: '雨夜的老街拐角，湿润路面反射霓虹招牌，一位撑伞的行人经过，电影感，青橙对比，35mm 胶片质感',
  provider: 'seedream',
  model: 'doubao-seedream-5-5-261028',
  ratio: '16:9',
  resolution: '2K',
  count: 1,
  seed: null,
  styleId: null,
  notes: '用低机位强调街角纵深，雨滴与反光作为前景。',
  recommended: { provider: 'minimax', ratio: '3:4', resolution: '2K', count: 1 },
}

const noop = () => {}
const resolved = (value) => Promise.resolve(value)

const params = new URLSearchParams(location.search)
const speed = params.get('slow') === '1' ? 4 : 1
const longChat = params.get('long') === '1'
PLAN.count = Math.max(1, Math.min(4, Number(params.get('count') || 1)))

if (params.get('onboard') === '1') CONFIG.onboarded = false

let chatListener = null
let genListener = null
let workshopListeners = []
const emitWorkshop = (payload) => {
  for (const listener of workshopListeners) listener?.(payload)
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const makeImage = (index) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#274b41"/><stop offset="1" stop-color="#b88a44"/></linearGradient></defs><rect width="1024" height="1024" fill="url(%23g)"/><circle cx="760" cy="280" r="180" fill="#f3ead8" opacity=".22"/><text x="80" y="880" fill="#f8f1e4" font-size="58" font-family="Georgia, serif">绘话 · 雨夜霓虹 ${index}</text></svg>`
  const url = `data:image/svg+xml;charset=utf-8,${svg.replace(/#/g, '%23')}`
  return {
    id: `mock-image-${index}`,
    file: `mock-${index}.svg`,
    thumb: null,
    width: 1024,
    height: 1024,
    createdAt: new Date().toISOString(),
    prompt: PLAN.prompt,
    provider: 'seedream',
    model: 'doubao-seedream-5-5-261028',
    ratio: '16:9',
    resolution: '2K',
    seed: null,
    sessionId: 'mock-session',
    styleId: null,
    countIndex: index,
    url,
    thumbUrl: url,
  }
}

window.huihua = {
  app: {
    info: () =>
      resolved({
        version: '1.0.0',
        electron: '45.4.1',
        platform: 'win32',
        arch: 'x64',
        dataDir: CONFIG.dataDir,
      }),
    openDataDir: noop,
    showItem: noop,
    openExternal: noop,
    setBusy: (busy) => {
      window.__busy = busy
    },
    hideToTray: () => {
      window.__hidden = true
      return resolved(true)
    },
    quit: () => {
      window.__quit = true
      return resolved(true)
    },
    onCloseRequested: (callback) => {
      window.__closeCb = callback
      return () => {
        window.__closeCb = null
      }
    },
  },
  config: {
    get: () => resolved(CONFIG),
    update: (patch) => resolved({ ...CONFIG, ...patch }),
    reset: () => resolved(CONFIG),
    test: () => resolved({ ok: true, message: '连接成功，Key 有效' }),
  },
  chat: {
    start: async ({ requestId }) => {
      await delay(120)
      chatListener?.({ requestId, type: 'start', message: { id: 'mock' } })
      await delay(160)
      if (longChat) {
        const paragraph =
          '画面方向先按雨夜的东京街头来：低机位，湿润路面反光，霓虹只做青橙两色，人物撑透明伞站在便利店门口，背景压暗保留层次。'
        for (let index = 0; index < 80; index += 1) {
          chatListener?.({ requestId, type: 'text', text: paragraph })
          await delay(120)
        }
        chatListener?.({ requestId, type: 'done', usage: { input_tokens: 128, output_tokens: 42 } })
        return { ok: true }
      }
      const codeDemo = new URLSearchParams(location.search).get('code') === '1'
      chatListener?.({
        requestId,
        type: 'text',
        text: codeDemo
          ? '先看一段很长的代码，确认不会被撑破：\n\n```js\n' + 'const veryLongIdentifierName = ' + 'x'.repeat(260) + ';\n```\n\n上面这段应该自动换行。'
          : '可以。我已经把画面方向记下来了——先聊清楚光线、构图和主体，再整理成生图文案。',
      })
      await delay(160)
      chatListener?.({ requestId, type: 'done', usage: { input_tokens: 128, output_tokens: 42 } })
      return { ok: true }
    },
    abort: noop,
    title: async () => {
      await delay(80)
      return '雨夜霓虹街景设计'
    },
    upload: async () => {
      await delay(120)
      return { id: 'file-mock' }
    },
    onEvent: (listener) => {
      chatListener = listener
      return () => {
        chatListener = null
      }
    },
  },
  models: {
    catalog: () => resolved(CATALOG),
    all: () => resolved(CATALOG),
    probe: (input) =>
      resolved({
        provider: input.provider,
        models: [
          {
            id: 'doubao-seedream-5-5-261028',
            name: 'Seedream 5.5',
            desc: '已收录',
          },
        ],
        note: '已从端点读取模型，勾选后同步到模型列表。',
      }),
  },
  planner: {
    plan: async () => {
      await delay(320)
      return { plan: PLAN }
    },
  },
  generate: {
    start: async ({ requestId, plan }) => {
      const total = Math.max(1, Math.min(4, plan?.count || 1))
      await delay(220)
      genListener?.({ requestId, type: 'progress', done: 0, total })
      for (let index = 1; index <= total; index += 1) {
        await delay(420 * speed)
        genListener?.({ requestId, type: 'image', item: makeImage(index), done: index, total })
      }
      await delay(180)
      genListener?.({ requestId, type: 'done', succeeded: total, total, warnings: [] })
      return { ok: true }
    },
    abort: noop,
    onEvent: (listener) => {
      genListener = listener
      return () => {
        genListener = null
      }
    },
  },
  workshop: {
    start: async ({ requestId, body, stage }) => {
      const log = (window.__workshopLog = window.__workshopLog || [])
      const users = (body && body.messages ? body.messages : []).filter((message) => message.role === 'user')
      const last = users[users.length - 1] || { content: [] }
      const parts = Array.isArray(last.content) ? last.content : []
      const images = parts.filter((part) => part.type === 'image').length
      const stageValue = stage || 'analysis'
      log.push({ request: log.length + 1, stage: stageValue, images, users: users.length })
      await delay(180)
      emitWorkshop({ requestId, type: 'start' })
      const analysis = [
        '### 当前共识\n- 用途：半身人物与生活方式画面\n- 影调：奶油色高光、低饱和暖调、浅景深\n- 材质：哑光胶片，边缘干净，没有明显笔触\n- 光位：左前方大面积漫射，暗部偏暖褐\n- 比例：建议 3:4\n',
        '\n\n### 新发现\n- 高光偏奶油而不是纯白，暗部保留暖褐，不是冷黑\n- 层次靠光影和前后景虚化，不靠纹理堆叠\n',
        '\n\n### 待确认\n1. 主要人物还是静物？我建议人物，更稳。\n2. 比例固定 3:4 还是按场景判断？我建议 3:4。\n3. 要不要保留很轻的胶片颗粒？我建议保留一层。',
      ]
      const skill = {
        kind: 'image',
        name: '奶油暖光人像',
        description: '低饱和奶油调、柔光与浅景深，适合半身人物与生活方式画面',
        prompt:
          '奶油暖光人像，低饱和暖调，柔和的大面积漫射光，浅景深，背景干净微虚化，肤色通透偏蜜桃色，哑光胶片质感，轻微颗粒，半身居中构图，3:4 竖幅，安静温柔的氛围',
        spec: [
          '## 1 画面判读与取舍',
          '参考图为数字生成后手修：高光边缘有轻微重复笔触，但肤色过渡和背景虚化是高级的，保留；右上角的文字与边框是噪声，排除。',
          '',
          '## 2 色彩合同',
          '- 主色 奶油白 #F3E7D6，面积 42–48%，只出现在高光与背景亮部',
          '- 辅色 蜜桃肤色 #E8C4A8，面积 18–24%，集中在面部与手部',
          '- 辅色 暖褐 #8A6A52，面积 16–20%，暗部与头发',
          '- 点缀 柔粉 #E7B7A6，面积 4–6%，唇部与耳饰，全画面最多 2 处',
          '- 禁用：冷白、荧光粉、青绿、纯黑',
          '- 合计 100%，面积浮动 ±3%',
          '',
          '## 3 光与明度',
          '主光左前方 35°，大面积柔光（柔光箱 + 反光板），色温 4300–4600K；暗部为暖褐而非冷黑；明暗 5 阶，对比偏弱；禁止第二光源与硬边缘阴影。',
          '',
          '## 4 笔触与材质',
          '不做可见笔触；哑光胶片质感。薄底 70%、塑形 25%、接触面 5%；画布颗粒强度 0.15；允许平滑渐变，禁止厚涂与刮痕。',
          '',
          '## 5 构图语法',
          'A 半身居中：地平线在画面下 1/5，主体占高 68–72%，负空间在右上，视线从左下进入。',
          'B 三分侧身：主体偏左 1/3，负空间右侧，背景留一条高光带。',
          'C 生活场景中景：主体占高 55%，前景虚化物 10%，适合咖啡杯、窗边。',
          '',
          '## 6 细节规则表',
          '皮肤：保留毛孔与绒毛，高光柔；头发：成束不碎，边缘融进背景；眼睛：单一高光点；织物：亚麻纹理，褶皱走光位；金属：只做柔反射不做镜面；玻璃：薄边高光；食物：哑光油脂感；植物：叶片低饱和；背景：虚化不出现文字。',
          '',
          '## 7 世界观与情绪',
          '安静的午后室内，只有窗光一个事件；人物占画面高度约 70%；情绪温柔、克制、生活化。',
          '',
          '## 8 边界与禁用',
          '不适合硬光、强对比、赛博霓虹、正脸特写、多人合影；禁用文字、签名、边框、水印、第二光源、纯黑背景。',
          '',
          '## 9 新细节决策',
          '体块还是事件 → 是否接触另一材质 → 是否引入第二事件。例：手上的杯子是体块，与手接触处加深阴影；窗外雨滴是第二事件，默认不加。',
          '',
          '## 10 参数与引擎建议',
          'Seedream 3:4 / 2K / 1 张最稳；需要一致人物时固定 seed；MiniMax 建议降到 1.5K 减少过度锐化；批量出图先出 1 张定光位再放量。',
          '',
          '## 11 验收标准',
          '主色 42–48%、点缀 ≤6%、负空间 ≥12%、主体占高 68–72%、色数 6–8、无可见笔触、无文字边框。逐项检查：高光是否偏奶油、暗部是否暖褐、皮肤是否通透、背景是否干净。',
          '',
          '## 12 提示词变体与修复句',
          '标准版：奶油暖光，左前 35° 柔光 4500K，低饱和暖调，半身居中，浅景深。',
          '保守版：柔光人像，暖褐色阴影，哑光胶片，背景纯色虚化。',
          '修复：脸偏灰 → 提高蜜桃色比例；背景太亮 → 压暗 1/3 档；颗粒太重 → 颗粒降到 0.1。',
        ].join('\n'),
        recommended: { provider: 'seedream', ratio: '3:4', resolution: '2K', count: 1 },
        tips: '想要更通透时，把「哑光」换成「柔亮」。',
      }
      if (stageValue === 'spec') {
        const markdown = '# 规格\n\n' + skill.spec
        for (let index = 0; index < markdown.length; index += 150) {
          await delay(160)
          emitWorkshop({ requestId, type: 'text', text: markdown.slice(index, index + 150) })
        }
      } else if (stageValue === 'compile') {
        const compiled = { ...skill }
        delete compiled.spec
        const payload = JSON.stringify(compiled)
        for (let index = 0; index < payload.length; index += 120) {
          await delay(40)
          emitWorkshop({ requestId, type: 'text', text: payload.slice(index, index + 120) })
        }
      } else {
        const repeats = longChat ? 4 : 1
        for (let round = 0; round < repeats; round += 1) {
          for (const part of analysis) {
            await delay(120)
            emitWorkshop({ requestId, type: 'text', text: part })
          }
        }
      }
      await delay(220)
      emitWorkshop({ requestId, type: 'done' })
      return { ok: true }
    },
    abort: noop,
    onEvent: (listener) => {
      workshopListeners.push(listener)
      return () => {
        workshopListeners = workshopListeners.filter((entry) => entry !== listener)
      }
    },
  },
  presets: {
    catalog: () => resolved(presetCatalog()),
    favorite: (id, on) => {
      if (on) PRESET_FAVORITES.add(id)
      else PRESET_FAVORITES.delete(id)
      return resolved({ favorites: [...PRESET_FAVORITES] })
    },
    use: (id) => {
      touchPreset(id)
      return resolved({ recent: PRESET_RECENT })
    },
    install: (input = {}) => {
      const sourceId = `preset:${input.id}`
      const exists = STYLES.find((style) => style.sourceId === sourceId)
      if (exists) {
        exists.prompt = input.prompt || exists.prompt
        exists.recommended = {
          provider: input.provider || 'seedream',
          ratio: input.ratio || '1:1',
          resolution: input.resolution || '2K',
          count: input.count || 1,
        }
        return resolved(exists)
      }
      const preset = PRESET_DATA.presets.find((item) => item.id === input.id) || {}
      const style = {
        id: `style-mock-preset-${STYLES.length + 1}`,
        name: preset.title || '预设风格',
        description: preset.desc || '来自预设库',
        kind: 'preset',
        prompt: input.prompt || preset.prompt || '',
        spec: `# ${preset.title || '预设'}\n\n- 来源：nanobanana-ai.cn\n- 原模型：${preset.model || '未知'}\n- 分类：${preset.cat || ''}\n- 变量：${preset.vars || '无'}\n\n## 原始提示词\n\n${preset.prompt || ''}\n\n## English\n\n${preset.promptEn || ''}\n\n## 使用建议\n\n先带一张参考图，再按需要的比例和清晰度出图。`,
        recommended: {
          provider: input.provider || 'seedream',
          ratio: input.ratio || preset.ratio || '1:1',
          resolution: input.resolution || '2K',
          count: input.count || 1,
        },
        samples: [],
        sampleUrls: preset.preview ? [preset.preview] : [],
        coverUrl: preset.preview || null,
        sourceId,
        builtin: false,
        createdAt: new Date().toISOString(),
      }
      STYLES.unshift(style)
      return resolved(style)
    },
    adapt: async (input = {}) => {
      await delay(420)
      return {
        prompt: `${input.prompt || ''}\n\n（已适配 ${input.model || '当前模型'}：去掉参数串与权重符号，保留主体、光线、构图和材质描述）`,
        note: '已按当前模型重写提示词',
      }
    },
    importLibrary: async () => {
      await delay(360)
      PRESET_ORIGIN = 'user'
      return {
        count: PRESET_DATA.presets.length,
        images: PRESET_DATA.presets.filter((item) => item.preview).length,
        missing: 0,
        catalog: presetCatalog(),
      }
    },
    removeUser: async () => {
      await delay(240)
      PRESET_ORIGIN = 'builtin'
      return presetCatalog()
    },
  },
  styles: {
    list: () => resolved(STYLES),
    get: (id) => resolved(STYLES.find((style) => style.id === id) || null),
    save: (input) => {
      const samples = (input?.samples || []).map((item) => item.dataUrl).filter(Boolean)
      const style = {
        id: `style-mock-${STYLES.length + 1}`,
        name: input?.name || '未命名技能',
        description: input?.description || '',
        kind: input?.kind || 'image',
        prompt: input?.prompt || '',
        spec: input?.spec || '',
        recommended:
          input?.recommended || { provider: 'seedream', ratio: '1:1', resolution: '2K', count: 1 },
        samples: [],
        sampleUrls: samples,
        coverUrl: samples[0] || null,
        builtin: false,
        createdAt: new Date().toISOString(),
      }
      STYLES.unshift(style)
      return resolved(style)
    },
    delete: () => resolved(true),
  },
  gallery: {
    list: () => resolved(GALLERY_ITEMS.filter((item) => !item.deletedAt)),
    trash: () =>
      resolved(
        GALLERY_ITEMS.filter((item) => item.deletedAt).map((item) => ({
          id: item.id,
          deletedAt: new Date(item.deletedAt).toISOString(),
          item,
          imageUrl: item.url,
          thumbUrl: item.thumbUrl,
        }))
      ),
    remove: (id) => {
      const target = GALLERY_ITEMS.find((item) => item.id === id)
      if (target) target.deletedAt = Date.now()
      return resolved(true)
    },
    restore: (id) => {
      const target = GALLERY_ITEMS.find((item) => item.id === id)
      if (target) target.deletedAt = null
      return resolved(target ? { ...target } : null)
    },
    purge: (id) => {
      const index = GALLERY_ITEMS.findIndex((item) => item.id === id)
      if (index >= 0) GALLERY_ITEMS.splice(index, 1)
      return resolved(true)
    },
    emptyTrash: () => {
      const count = GALLERY_ITEMS.filter((item) => item.deletedAt).length
      for (let i = GALLERY_ITEMS.length - 1; i >= 0; i -= 1) {
        if (GALLERY_ITEMS[i].deletedAt) GALLERY_ITEMS.splice(i, 1)
      }
      return resolved(count)
    },
    exportAs: (id) =>
      resolved({ canceled: false, path: `C:\\Users\\<user>\\Downloads\\绘话-${id}.png` }),
    export: () => resolved(true),
    reveal: noop,
  },
  file: {
    saveText: (name) =>
      resolved({ canceled: false, path: `C:\\Users\\<user>\\Downloads\\${name || '绘话备份.json'}` }),
  },
}
