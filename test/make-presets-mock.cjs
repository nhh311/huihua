/**
 * 用真实预设包生成一份小样本，供 mock.html 里的预设立页做界面验收。
 * 输出：dist/mock-presets/{thumb,preview}/*.webp + test/preset-data.js
 */
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const src = path.join(root, 'src-tauri', 'resources', 'presets')
const outDir = path.join(root, 'dist', 'mock-presets')

const RATIOS = [
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
  ['3:2', 3 / 2],
  ['2:3', 2 / 3],
]

function webpSize(file) {
  const buf = fs.readFileSync(file)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null
  const chunk = buf.toString('ascii', 12, 16)
  if (chunk === 'VP8 ') {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
  }
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8X') {
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 }
  }
  return null
}

function nearestRatio(width, height) {
  if (!width || !height) return '1:1'
  const value = width / height
  let best = '1:1'
  let bestScore = Infinity
  for (const [ratio, target] of RATIOS) {
    const score = Math.abs(Math.log(value / target))
    if (score < bestScore) {
      bestScore = score
      best = ratio
    }
  }
  return best
}

const data = JSON.parse(fs.readFileSync(path.join(src, 'presets.json'), 'utf8'))
const NEEDS =
  /附件|参考图|这张图|原图|图中|图片中|照片中|把这张|输入图|attached image|uploaded image|reference image|this image|input image/i

const wanted = []
const add = (preset) => {
  if (preset && !wanted.some((item) => item.id === preset.id)) wanted.push(preset)
}

// 每个主分类先取两条，保证封面风格多样
const cats = [
  'nb_portrait',
  'nb_product',
  'nb_infographic',
  'gi2_poster',
  'nb_scene',
  'nb_figurine',
  'nb_anime',
  'gi2_ui',
]
for (const cat of cats) {
  data.presets.filter((item) => item.cat === cat && item.image).slice(0, 2).forEach(add)
}
// 带变量的、需要参考图的、GPT 系的各补几条
data.presets.filter((item) => item.prompt.includes('{') && item.image).slice(0, 4).forEach(add)
data.presets.filter((item) => NEEDS.test(item.prompt) && item.image).slice(0, 4).forEach(add)
data.presets.filter((item) => item.model === 'gpt-image-2' && item.image).slice(0, 4).forEach(add)
data.presets.filter((item) => item.cat === 'popular' && item.image).slice(0, 2).forEach(add)
// 提示词里写死比例的（原站 72 条），用来验收「按提示词预选比例」
data.presets
  .filter((item) => /\b(16:9|9:16|4:3|3:4|3:2|2:3|1:1)\b/.test(item.prompt) && item.image)
  .slice(0, 2)
  .forEach(add)
// 中英变量数不一致的（原站 6 条），用来验收槽位补齐
data.presets
  .filter((item) => {
    const zh = new Set((item.prompt.match(/\{([^{}]+)\}/g) || []).map((v) => v.slice(1, -1)))
    const en = new Set((item.promptEn.match(/\{([^{}]+)\}/g) || []).map((v) => v.slice(1, -1)))
    return zh.size !== en.size && zh.size > 0 && item.image
  })
  .slice(0, 2)
  .forEach(add)

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(path.join(outDir, 'thumb'), { recursive: true })
fs.mkdirSync(path.join(outDir, 'preview'), { recursive: true })

const presets = []
for (const item of wanted) {
  const srcThumb = path.join(src, 'thumb', item.image)
  const srcPreview = path.join(src, 'preview', item.image)
  if (!fs.existsSync(srcThumb) || !fs.existsSync(srcPreview)) continue
  const size = webpSize(srcPreview) || { width: 0, height: 0 }
  const flat = item.id.replace(/[^A-Za-z0-9_-]+/g, '-')
  fs.copyFileSync(srcThumb, path.join(outDir, 'thumb', `${flat}.webp`))
  fs.copyFileSync(srcPreview, path.join(outDir, 'preview', `${flat}.webp`))
  presets.push({
    ...item,
    ratio: nearestRatio(size.width, size.height),
    width: size.width,
    height: size.height,
    thumb: `/mock-presets/thumb/${flat}.webp`,
    preview: `/mock-presets/preview/${flat}.webp`,
    needsReference: NEEDS.test(item.prompt),
    favorite: false,
    usedAt: null,
  })
}

const payload = {
  meta: data.meta,
  categories: data.categories,
  presets,
}
fs.writeFileSync(
  path.join(__dirname, 'preset-data.js'),
  `window.__PRESETS_MOCK__ = ${JSON.stringify(payload)}\n`
)
console.log(`preset-data.js ready: ${presets.length} presets, ${data.categories.length} categories`)
