const fs = require('node:fs')
const path = require('node:path')

const port = process.env.CDP_PORT || '9333'
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
  const failures = []
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (!message.id) return
    pending.get(message.id)?.(message)
    pending.delete(message.id)
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
      console.log('EVAL ERROR', response.result.exceptionDetails.text, response.result.exceptionDetails.exception?.description)
    }
    return response.result?.result?.value
  }

  const shot = async (name) => {
    const response = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(__dirname, name), Buffer.from(response.result.data, 'base64'))
    console.log('saved', name)
  }

  const check = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, detail === undefined ? '' : detail)
    if (!ok) failures.push(name)
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false })

  await send('Page.navigate', { url: 'http://127.0.0.1:8123/mock.html?nolib' })
  await delay(900)
  await evaluate(`(async () => {
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase('huihua')
      request.onsuccess = request.onerror = request.onblocked = () => resolve()
    })
    location.reload()
    return 'cleared'
  })()`)
  await delay(2000)

  await evaluate(`(() => {
    const nav = [...document.querySelectorAll('.nav-item')].find((node) => node.textContent.includes('预设库'))
    nav?.click()
    return Boolean(nav)
  })()`)
  await delay(1000)

  const empty = await evaluate(`(() => ({
    shown: Boolean(document.querySelector('.library-empty')),
    title: document.querySelector('.library-empty h2')?.textContent?.trim() || '',
    steps: document.querySelectorAll('.library-steps > div').length,
    buttons: [...document.querySelectorAll('.presets-empty-actions button')].map((n) => n.textContent.trim()),
    hint: document.querySelector('.library-empty small')?.textContent?.trim() || '',
    overflowX: document.querySelector('.presets-view')?.scrollWidth - document.querySelector('.presets-view')?.clientWidth,
  }))()`)
  console.log('empty:', empty)
  check('开源版空状态出现', empty.shown === true)
  check('空状态标题正确', empty.title === '这个版本不带内置素材库', empty.title)
  check('三步说明', empty.steps === 3, empty.steps)
  check('导入/规范按钮', empty.buttons.some((t) => t.includes('导入素材库')) && empty.buttons.some((t) => t.includes('格式规范')))
  check('空状态无横向溢出', !(empty.overflowX > 0), empty.overflowX)
  await shot('presets-open-empty.png')

  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.presets-empty-actions button')].find((n) => n.textContent.includes('格式规范'))
    button?.click()
    return Boolean(button)
  })()`)
  await delay(500)
  const spec = await evaluate(`(() => ({
    open: Boolean(document.querySelector('.preset-spec')),
    pre: document.querySelectorAll('.preset-spec pre').length,
    fields: document.querySelectorAll('.preset-spec li').length,
  }))()`)
  console.log('spec:', spec)
  check('格式规范弹层', spec.open === true && spec.pre >= 2 && spec.fields >= 5)
  await shot('presets-open-spec.png')
  await evaluate(`(() => { document.querySelector('.modal-head button, .modal-close')?.click(); return true })()`)
  await delay(400)

  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.presets-empty-actions button')].find((n) => n.textContent.includes('导入素材库'))
    button?.click()
    return Boolean(button)
  })()`)
  await delay(1400)
  const imported = await evaluate(`(() => {
    const catalog = window.huihua && document.querySelector('.presets-badge')
    return {
      badge: catalog ? catalog.textContent.trim() : '',
      cards: document.querySelectorAll('.preset-card').length,
      toast: document.querySelector('.toast')?.textContent?.trim() || '',
      empty: Boolean(document.querySelector('.library-empty')),
      overflowX: document.querySelector('.presets-view')?.scrollWidth - document.querySelector('.presets-view')?.clientWidth,
    }
  })()`)
  console.log('imported:', imported)
  check('导入后显示本地素材库', imported.badge === '本地素材库', imported.badge)
  check('导入后有卡片', imported.cards === 28, imported.cards)
  check('导入后 toast 带数量', /已导入\s*\d+/.test(imported.toast), imported.toast)
  check('导入后不再空状态', imported.empty === false)
  await shot('presets-open-imported.png')

  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.presets-edition button')].find((n) => n.textContent.includes('移除'))
    button?.click()
    return Boolean(button)
  })()`)
  await delay(500)
  const confirm = await evaluate(`(() => ({
    open: Boolean(document.querySelector('.modal')),
    copy: document.querySelector('.preset-remove-copy')?.textContent?.trim().slice(0, 40) || '',
    buttons: [...document.querySelectorAll('.modal button')].map((n) => n.textContent.trim()),
  }))()`)
  console.log('remove modal:', confirm)
  check('移除要二次确认', confirm.open === true && confirm.buttons.some((t) => t.includes('移除')))
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.modal button')].find((n) => n.textContent.trim() === '移除')
    button?.click()
    return Boolean(button)
  })()`)
  await delay(900)
  const removed = await evaluate(`(() => ({
    empty: Boolean(document.querySelector('.library-empty')),
    badge: document.querySelector('.presets-badge')?.textContent?.trim() || '',
    toast: document.querySelector('.toast')?.textContent?.trim() || '',
  }))()`)
  console.log('removed:', removed)
  check('移除后回到空状态', removed.empty === true)
  check('移除后 toast', /已移除/.test(removed.toast), removed.toast)

  const errors = await evaluate(`(() => window.__errors || [])()`)
  check('无控制台异常', !errors || errors.length === 0, errors)

  socket.close()
  if (failures.length) {
    console.log(`\n${failures.length} FAIL:`, failures.join(' / '))
    process.exit(1)
  }
  console.log('\nALL OK')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
