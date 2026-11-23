const fs = require('node:fs')
const path = require('node:path')

const port = process.env.CDP_PORT || '9223'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
  const target = targets.find(
    (item) => item.type === 'page' && item.url.startsWith('http://127.0.0.1:8123')
  )
  if (!target) throw new Error('page target not found')

  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })

  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (!message.id) return
    const resolve = pending.get(message.id)
    if (resolve) {
      pending.delete(message.id)
      resolve(message)
    }
  })

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId
      pending.set(id, resolve)
      socket.send(JSON.stringify({ id, method, params }))
    })

  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    })
    if (response.result?.exceptionDetails) {
      throw new Error(response.result.exceptionDetails.text || 'evaluation failed')
    }
    return response.result?.result?.value
  }

  const waitFor = async (expression, timeout = 8000) => {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return true
      await sleep(180)
    }
    return false
  }

  const screenshot = async (name) => {
    const response = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const data = response.result?.data
    if (!data) throw new Error('screenshot failed')
    const file = path.join(__dirname, name)
    fs.writeFileSync(file, Buffer.from(data, 'base64'))
    console.log('saved', file)
  }

  await send('Page.enable')
  await send('Runtime.enable')

  const loaded = await waitFor("!!document.querySelector('.suggestion-card')", 12000)
  if (!loaded) throw new Error('welcome did not render')
  await evaluate("document.querySelector('.suggestion-card').click()")
  await sleep(260)
  await evaluate("document.querySelector('.button-plan').click()")
  await sleep(1400)
  await evaluate("(()=>{const el=document.querySelector('.chat-scroll'); if(el) el.scrollTop=el.scrollHeight})()")
  await sleep(240)
  await screenshot('plan.png')

  const started = await evaluate(
    "!!document.querySelector('.plan-foot .button-primary') && !document.querySelector('.plan-foot .button-primary').disabled"
  )
  if (!started) throw new Error('start button is not enabled')
  await evaluate("document.querySelector('.plan-foot .button-primary').click()")
  await sleep(3200)
  await evaluate("(()=>{const el=document.querySelector('.chat-scroll'); if(el) el.scrollTop=el.scrollHeight})()")
  await sleep(300)
  await screenshot('generated.png')

  socket.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
