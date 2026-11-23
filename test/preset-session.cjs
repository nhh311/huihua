/**
 * 2.0.1 两处修复的回归：
 * 1) 预设库「在对话里使用」必须落进全新空白对话，不能复用带历史的会话；
 * 2) 生成完之后输入框不能残留上一轮的提示词（切到作品再切回来也不回填）。
 * 依赖：node test/serve.cjs + CDP 9333。
 */
const fs = require('node:fs')
const path = require('node:path')

const port = process.env.CDP_PORT || '9333'
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

globalThis.window = {}
eval(fs.readFileSync(path.join(__dirname, 'preset-data.js'), 'utf8'))
const DATA = globalThis.window.__PRESETS_MOCK__
delete globalThis.window

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, detail === undefined ? '' : JSON.stringify(detail))
}

async function main() {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
  const target = targets.find((item) => item.type === 'page') || targets[0]
  if (!target) throw new Error('page not found')

  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })

  let nextId = 0
  const pending = new Map()
  const errors = []
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.id) {
      pending.get(message.id)?.(message)
      pending.delete(message.id)
      return
    }
    if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text)
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args?.map((arg) => arg.value || arg.description).join(' '))
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
      console.log('EVAL ERROR', response.result.exceptionDetails.exception?.description)
    }
    return response.result?.result?.value
  }

  const navPresets = async () => {
    await evaluate(`[...document.querySelectorAll('.nav-item')].find((node) => node.textContent.includes('预设库'))?.click()`)
    await delay(700)
  }
  const navGallery = async () => {
    await evaluate(`[...document.querySelectorAll('.nav-item')].find((node) => node.textContent.includes('作品'))?.click()`)
    await delay(500)
  }
  const useCard = async (index) => {
    await navPresets()
    const opened = await evaluate(`(() => {
      const card = document.querySelectorAll('.preset-card')[${index}]
      card?.click()
      return Boolean(card)
    })()`)
    await delay(700)
    const clicked = await evaluate(`(() => {
      const button = [...document.querySelectorAll('.preset-actions button')].find((node) => node.textContent.includes('在对话里使用'))
      button?.click()
      return Boolean(button) && !button.disabled
    })()`)
    await delay(800)
    return { opened, clicked }
  }
  const snapshot = () =>
    evaluate(`(() => ({
      view: document.querySelector('.presets-view') ? 'presets' : document.querySelector('.gallery-view') ? 'gallery' : 'chat',
      text: document.querySelector('.composer textarea')?.value || '',
      sessions: document.querySelectorAll('.session-item').length,
      messages: document.querySelectorAll('.message').length,
      units:
        document.querySelectorAll('.message').length +
        document.querySelectorAll('.plan-head').length +
        document.querySelectorAll('.generation-card').length,
      plan: Boolean(document.querySelector('.plan-head')),
      generation: Boolean(document.querySelector('.generation-card')),
      activeTitle: document.querySelector('.session-item.is-active .session-title')?.textContent?.trim() || '',
    }))()`)

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: 'http://127.0.0.1:8123/mock.html' })
  await delay(900)
  await evaluate(`(async () => {
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase('huihua')
      request.onsuccess = request.onerror = request.onblocked = () => resolve()
    })
    location.reload()
    return 'cleared'
  })()`)
  await delay(1800)

  const initial = await snapshot()
  check('初始只有一条空对话', initial.sessions === 1 && initial.messages === 0, initial)

  // 1) 空白会话可以直接带入
  const first = await useCard(0)
  const applied = await snapshot()
  check('预设能带入空白对话', first.clicked && applied.view === 'chat' && applied.messages === 0, { first, applied })
  check('输入框拿到预设提示词', applied.text.length > 20, applied.text.slice(0, 40))
  check('没有多出空会话', applied.sessions === 1, applied.sessions)

  // 2) 发出去以后输入框清空
  await evaluate(`document.querySelector('.button-send')?.click()`)
  await delay(1600)
  const sent = await snapshot()
  check('发送后输入框清空', sent.text === '' && sent.messages === 2, sent)

  // 3) 已经有历史的对话不能再被复用
  const second = await useCard(1)
  const fresh = await snapshot()
  check('有历史时另开新对话', second.clicked && fresh.sessions === 2 && fresh.messages === 0, { second, fresh })
  check('新对话带上新提示词', fresh.text.length > 20 && fresh.text !== sent.text, fresh.text.slice(0, 40))
  check('新对话标题是「新对话」', fresh.activeTitle === '新对话', fresh.activeTitle)

  // 4) 整理文案 → 生成，结束后切去作品再切回来：输入框不能残留
  await evaluate(`document.querySelector('.button-plan')?.click()`)
  await delay(1200)
  const planned = await snapshot()
  check('整理文案后输入框清空', planned.plan && planned.text === '', planned)

  await evaluate(`document.querySelector('.button-primary')?.click()`)
  await delay(2800)
  const generated = await snapshot()
  check('生成完成', generated.generation && generated.text === '', generated)

  await navGallery()
  await evaluate(`document.querySelectorAll('.session-item')[0]?.click()`)
  await delay(900)
  const returned = await snapshot()
  check('切走再回来不残留提示词', returned.view === 'chat' && returned.text === '', returned)
  check('切回来生成结果还在', returned.generation === true, returned)
  check('消息没有被重复追加', returned.units === 3, returned)

  // 5) 连续使用：有历史就新建，空白就复用
  const third = await useCard(2)
  const thirdState = await snapshot()
  check('再次使用另开新对话', third.clicked && thirdState.sessions === 3 && thirdState.messages === 0, {
    third,
    thirdState,
  })
  const thirdText = thirdState.text
  const fourth = await useCard(3)
  const fourthState = await snapshot()
  check('空白对话复用不叠加', fourth.clicked && fourthState.sessions === 3 && fourthState.messages === 0, {
    fourth,
    fourthState,
  })
  check('复用时会换成新提示词', fourthState.text.length > 20 && fourthState.text !== thirdText, {
    before: thirdText.slice(0, 30),
    after: fourthState.text.slice(0, 30),
  })

  // 6) 旧会话内容没被动过
  await evaluate(`document.querySelectorAll('.session-item')[2]?.click()`)
  await delay(700)
  const oldest = await snapshot()
  check('旧会话仍保留两条消息', oldest.messages === 2, oldest)

  check('无控制台异常', errors.length === 0, errors.slice(0, 4))

  const failed = results.filter((item) => !item.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (failed.length) {
    console.log('FAILED:', failed.map((item) => item.name).join(' / '))
    process.exitCode = 1
  }
  socket.close()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
