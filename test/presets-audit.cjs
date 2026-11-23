/**
 * 预设库交互回归：搜索 / 收藏 / 变量槽 / 比例对齐 / 需参考图 / 装风格去重 / 直接生成 / 手机端
 * 依赖：node test/serve.cjs + CDP 9333（见 presets-shot.cjs 注释）
 */
const fs = require('node:fs')
const path = require('node:path')

const port = process.env.CDP_PORT || '9333'
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

globalThis.window = {}
eval(fs.readFileSync(path.join(__dirname, 'preset-data.js'), 'utf8'))
const DATA = globalThis.window.__PRESETS_MOCK__
delete globalThis.window
const RATIOS = ['16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '1:1']
const ratioFromPrompt = (text) => {
  const found = (text || '').match(/\b(16:9|9:16|4:3|3:4|3:2|2:3|1:1)\b/g)
  if (!found) return null
  const unique = [...new Set(found)]
  return unique.length === 1 ? unique[0] : null
}
const placeholders = (text) => {
  const out = []
  for (const match of (text || '').matchAll(/\{([^{}]+)\}/g)) if (!out.includes(match[1])) out.push(match[1])
  return out
}

const ratioTarget = DATA.presets.find((item) => {
  const hint = ratioFromPrompt(item.prompt)
  return hint && hint !== item.ratio
})
const slotCount = (item) =>
  Math.max(placeholders(item.prompt).length, placeholders(item.promptEn).length)
const varTarget = [...DATA.presets].sort((a, b) => slotCount(b) - slotCount(a))[0]
const refTarget = DATA.presets.find((item) => item.needsReference && item !== ratioTarget)
const plainTarget = DATA.presets.find(
  (item) => !item.needsReference && item !== varTarget && item !== ratioTarget
)

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, detail === undefined ? '' : detail)
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

  const openCard = async (title) => {
    const opened = await evaluate(`(() => {
      const card = [...document.querySelectorAll('.preset-card')].find((node) => node.querySelector('h3')?.textContent.trim() === ${JSON.stringify(title)})
      card?.click()
      return Boolean(card)
    })()`)
    await delay(600)
    return opened
  }
  const closeDetail = async () => {
    await evaluate(`document.querySelector('.preset-detail-head .icon-btn')?.click()`)
    await delay(300)
  }

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
  await evaluate(`[...document.querySelectorAll('.nav-item')].find((node) => node.textContent.includes('预设库'))?.click()`)
  await delay(1200)

  const base = await evaluate(`(() => ({
    view: Boolean(document.querySelector('.presets-view')),
    cards: document.querySelectorAll('.preset-card').length,
    cats: document.querySelectorAll('.presets-cat').length,
    stat: [...document.querySelectorAll('.presets-stats div')].map((node) => node.textContent.trim()),
    overflowX: (() => { const view = document.querySelector('.presets-view'); return view.scrollWidth - view.clientWidth })(),
  }))()`)
  check('列表渲染', base.view && base.cards === DATA.presets.length, base)
  check('分类齐全', base.cats === DATA.categories.length + 1, `${base.cats} chips`)
  check('无横向溢出', base.overflowX === 0, `${base.overflowX}px`)

  await evaluate(`(() => {
    const input = document.querySelector('.presets-search input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '手办')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await delay(500)
  const searched = await evaluate(`(() => ({
    cards: document.querySelectorAll('.preset-card').length,
    empty: Boolean(document.querySelector('.presets-empty')),
  }))()`)
  check('搜索生效', searched.cards > 0 && searched.cards < DATA.presets.length, searched)

  await evaluate(`(() => {
    const input = document.querySelector('.presets-search input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await delay(400)

  const favTitle = await evaluate(`(() => {
    const card = document.querySelector('.preset-card')
    card.querySelector('.preset-star')?.click()
    return card.querySelector('h3')?.textContent.trim()
  })()`)
  await delay(500)
  await evaluate(`[...document.querySelectorAll('.presets-tabs button')].find((node) => node.textContent.includes('收藏'))?.click()`)
  await delay(500)
  const favView = await evaluate(`(() => ({
    cards: document.querySelectorAll('.preset-card').length,
    title: document.querySelector('.preset-card h3')?.textContent.trim(),
  }))()`)
  check('收藏筛选', favView.cards === 1 && favView.title === favTitle, { favTitle, favView })
  await evaluate(`[...document.querySelectorAll('.presets-tabs button')].find((node) => node.textContent.includes('全部'))?.click()`)
  await delay(400)

  if (ratioTarget && (await openCard(ratioTarget.title))) {
    const hint = ratioFromPrompt(ratioTarget.prompt)
    const ratioState = await evaluate(`(() => {
      const labels = [...document.querySelectorAll('.preset-params label')]
      const row = labels.find((node) => node.querySelector('span')?.textContent.includes('比例'))
      return {
        value: row?.querySelector('select')?.value,
        note: document.querySelector('.preset-note')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        prompt: document.querySelector('.preset-prompt pre')?.textContent || '',
      }
    })()`)
    check('按提示词预选比例', ratioState.value === hint, { want: hint, got: ratioState.value })
    check(
      '提示词已对齐',
      ratioState.prompt.includes(hint) && !ratioState.prompt.includes(ratioTarget.ratio),
      { hint, imageRatio: ratioTarget.ratio }
    )
    check('比例说明可见', ratioState.note.includes(hint) && ratioState.note.includes('示例图'), ratioState.note)

    const alt = RATIOS.find((item) => item !== hint)
    await evaluate(`(() => {
      const labels = [...document.querySelectorAll('.preset-params label')]
      const row = labels.find((node) => node.querySelector('span')?.textContent.includes('比例'))
      const select = row.querySelector('select')
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
      setter.call(select, ${JSON.stringify(alt)})
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`)
    await delay(400)
    const after = await evaluate(`document.querySelector('.preset-prompt pre')?.textContent || ''`)
    check('改比例同步提示词', after.includes(alt) && !after.includes(hint), { alt })
    await closeDetail()
  } else {
    check('按提示词预选比例', false, 'mock 样本里没有带比例提示词的预设')
  }

  if (varTarget && (await openCard(varTarget.title))) {
    const desired = slotCount(varTarget)
    const before = await evaluate(`(() => ({
      inputs: document.querySelectorAll('.preset-vars input').length,
      labels: [...document.querySelectorAll('.preset-vars label span')].map((node) => node.textContent.trim()),
      prompt: document.querySelector('.preset-prompt pre')?.textContent || '',
    }))()`)
    check('变量槽数量', before.inputs === desired, { want: desired, got: before.inputs, labels: before.labels })

    await evaluate(`(() => {
      const input = document.querySelector('.preset-vars input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, '测试主体')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return input.value
    })()`)
    await delay(400)
    const after = await evaluate(`(() => ({
      prompt: document.querySelector('.preset-prompt pre')?.textContent || '',
      missing: document.querySelector('.preset-prompt em')?.textContent || '',
    }))()`)
    check('变量实时填充', after.prompt.includes('测试主体'), after.prompt.slice(0, 60))

    await evaluate(`[...document.querySelectorAll('.preset-lang button')].find((node) => node.textContent.trim() === 'EN')?.click()`)
    await delay(500)
    const english = await evaluate(`document.querySelector('.preset-prompt pre')?.textContent || ''`)
    check('切到 EN 提示词可用', english.length > 0 && english !== before.prompt, english.slice(0, 50))
    await closeDetail()
  }

  if (refTarget && (await openCard(refTarget.title))) {
    const blocked = await evaluate(`(() => {
      const gen = [...document.querySelectorAll('.preset-actions button')].find((node) => node.textContent.includes('直接生成'))
      const chat = [...document.querySelectorAll('.preset-actions button')].find((node) => node.textContent.includes('在对话里使用'))
      return {
        genDisabled: gen?.disabled,
        chatDisabled: chat?.disabled,
        hint: document.querySelector('.preset-hint')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      }
    })()`)
    check('需参考图的预设禁止直出', blocked.genDisabled === true && blocked.chatDisabled === false, blocked)
    await closeDetail()
  }

  if (plainTarget && (await openCard(plainTarget.title))) {
    const installed = await evaluate(`(async () => {
      const before = (await window.huihua.styles.list()).length
      const button = [...document.querySelectorAll('.preset-actions button')].find((node) => node.textContent.includes('装进风格库'))
      button.click()
      await new Promise((resolve) => setTimeout(resolve, 700))
      const after = (await window.huihua.styles.list()).length
      button.click()
      await new Promise((resolve) => setTimeout(resolve, 700))
      const again = (await window.huihua.styles.list()).length
      return { before, after, again }
    })()`)
    check('装进风格库', installed.after === installed.before + 1, installed)
    check('重复装不新增', installed.again === installed.after, installed)

    const generated = await evaluate(`(async () => {
      const button = [...document.querySelectorAll('.preset-actions button')].find((node) => node.textContent.includes('直接生成'))
      button.click()
      await new Promise((resolve) => setTimeout(resolve, 2600))
      return {
        inChat: !document.querySelector('.presets-view'),
        plan: Boolean(document.querySelector('.plan-head')),
        generation: Boolean(document.querySelector('.generation-card')),
        images: document.querySelectorAll('.generation-tile img').length,
      }
    })()`)
    check('直接生成落到对话', generated.inChat && generated.plan, generated)
    check('直接生成出现结果卡', generated.generation, generated)
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await evaluate(`[...document.querySelectorAll('.nav-item')].find((node) => node.textContent.includes('预设库'))?.click()`)
  await delay(700)
  const mobile = await evaluate(`(() => ({
    cards: document.querySelectorAll('.preset-card').length,
    overflowX: (() => { const view = document.querySelector('.presets-view'); return view.scrollWidth - view.clientWidth })(),
    catsWrap: getComputedStyle(document.querySelector('.presets-cats')).flexWrap,
  }))()`)
  check('手机端单列且不溢出', mobile.cards > 0 && mobile.overflowX === 0 && mobile.catsWrap === 'nowrap', mobile)

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
