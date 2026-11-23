const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..', 'dist')
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

http
  .createServer((request, response) => {
    const pathname = decodeURIComponent((request.url || '/').split('?')[0])
    const relative = pathname === '/' ? 'mock.html' : pathname.replace(/^\/+/, '')
    const file = path.resolve(root, relative)
    if (!file.startsWith(root)) {
      response.writeHead(403)
      response.end('forbidden')
      return
    }
    fs.readFile(file, (error, data) => {
      if (error) {
        response.writeHead(404)
        response.end('not found')
        return
      }
      response.writeHead(200, {
        'content-type': types[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
      })
      response.end(data)
    })
  })
  .listen(8123, '127.0.0.1', () => console.log('mock server http://127.0.0.1:8123'))
