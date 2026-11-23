const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
// rspack build 会清空 dist，图片样本因此需要按需重建
if (!fs.existsSync(path.join(root, 'dist', 'mock-presets', 'thumb'))) {
  require('./make-presets-mock.cjs')
}
const html = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8')
const scripts = '<script src="./preset-data.js"></script><script src="./mock.js"></script>'
const withMock = html.replace('<script defer', `${scripts}<script defer`)
fs.copyFileSync(path.join(__dirname, 'preset-data.js'), path.join(root, 'dist', 'preset-data.js'))
fs.copyFileSync(path.join(__dirname, 'mock.js'), path.join(root, 'dist', 'mock.js'))
fs.writeFileSync(path.join(root, 'dist', 'mock.html'), withMock)
console.log('dist/mock.html ready')
