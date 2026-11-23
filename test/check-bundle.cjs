const fs = require('node:fs')
const path = require('node:path')
const dir = path.join(__dirname, '..', 'dist')
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8')
const version = html.match(/name="application-version"[^>]*|content="[^"]+" name="application-version"/)
const meta = html.match(/content="([^"]+)" name="application-version"/)
console.log('meta:', meta ? meta[1] : 'missing', version ? 'tag-ok' : '')
const jsName = html.match(/static\/js\/([^"]+\.js)/)[1]
const js = fs.readFileSync(path.join(dir, 'static', 'js', jsName), 'utf8')
for (const key of ['预设库', '装进风格库', '在对话里使用', '直接生成', '适配当前模型', '需参考图', '预设库 · ', '工坊', '作品']) {
  console.log(key, js.includes(key))
}
console.log('mock leak:', js.includes('__PRESETS_MOCK__') || js.includes('/mock-presets/'))
console.log('bundle:', jsName, js.length)
