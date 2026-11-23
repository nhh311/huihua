/**
 * 2.0.2 回归：作品导出路径 / 删除确认 / 最近删除还原与彻底删除 / 灯箱按钮可达 / 会话最近删除
 * 依赖：node test/serve.cjs + CDP 9333（见 presets-shot.cjs 注释）
 */
const port = process.env.CDP_PORT || '9333'
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
      errors.push(
        message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text
      )
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

  const clickText = async (selector, text, index = 0) => {
    const ok = await evaluate(`(() => {
      const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .filter((node) => node.textContent.includes(${JSON.stringify(text)}) && node.offsetParent !== null)
      const node = nodes[${index}]
      if (!node) return false
      node.click()
      return true
    })()`)
    await delay(450)
    return ok
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
  await delay(1500)

  // ---- 作品页：卡片按钮常驻、导出路径提示 ----
  if (!(await clickText('.nav-item', '作品'))) throw new Error('作品 nav missing')
  await delay(700)

  const cards = await evaluate(`document.querySelectorAll('.gallery-card').length`)
  check('作品卡片渲染', cards === 3, `cards=${cards}`)

  const actionsVisible = await evaluate(`(() => {
    const bar = document.querySelector('.gallery-actions')
    if (!bar) return false
    const style = getComputedStyle(bar)
    return style.display !== 'none' && style.visibility !== 'hidden' && bar.getBoundingClientRect().height > 0
  })()`)
  check('卡片操作按钮常驻可见', actionsVisible === true)

  await evaluate(`document.querySelector('.gallery-card [title^="导出原图"]')?.click()`)
  await delay(600)
  const exportPath = await evaluate(`document.querySelector('.export-result-path')?.textContent || ''`)
  check('导出后显示完整保存路径', exportPath.includes('Downloads') && exportPath.includes('绘话-'), exportPath)

  // ---- 删除确认 -> 最近删除 -> 还原 ----
  await evaluate(`document.querySelector('.gallery-card .gallery-actions .is-danger')?.click()`)
  await delay(400)
  const confirmTitle = await evaluate(`document.querySelector('.modal-head h2')?.textContent || ''`)
  check('删除前出现确认弹窗', confirmTitle.includes('删除这张作品'), confirmTitle)

  await clickText('.modal-foot button, .modal .button', '移到最近删除')
  await delay(700)
  const afterDelete = await evaluate(`document.querySelectorAll('.gallery-card').length`)
  const trashBadge = await evaluate(`document.querySelector('.page-head-actions .button')?.textContent || ''`)
  check('确认后作品移入最近删除', afterDelete === 2, `cards=${afterDelete} btn=${trashBadge}`)

  await clickText('.page-head-actions .button', '最近删除')
  await delay(500)
  const trashRows = await evaluate(`document.querySelectorAll('.trash-row').length`)
  check('最近删除列出 1 条', trashRows === 1, `rows=${trashRows}`)

  await clickText('.trash-row .button', '还原')
  await delay(800)
  const restored = await evaluate(`document.querySelectorAll('.gallery-card').length`)
  check('还原后回到作品库', restored === 3, `cards=${restored}`)

  // ---- 再次删除 -> 彻底删除二段确认 ----
  await evaluate(`document.querySelector('.gallery-card .gallery-actions .is-danger')?.click()`)
  await delay(350)
  await clickText('.modal .button', '移到最近删除')
  await delay(600)
  await clickText('.page-head-actions .button', '最近删除')
  await delay(450)
  await evaluate(`[...document.querySelectorAll('.trash-row .button')].find((n) => n.textContent.trim() === '彻底删除')?.click()`)
  await delay(350)
  const twoStep = await evaluate(`document.querySelector('.trash-actions span')?.textContent || ''`)
  check('彻底删除需要二次确认', twoStep.includes('彻底删除'), twoStep)
  await evaluate(`document.querySelector('.trash-actions .button-danger')?.click()`)
  await delay(700)
  const trashRowsAfterPurge = await evaluate(`document.querySelectorAll('.trash-row').length`)
  check('二次确认后彻底删除', trashRowsAfterPurge === 0, `rows=${trashRowsAfterPurge}`)
  await evaluate(`[...document.querySelectorAll('.modal .icon-btn, .modal .icon-button')].at(-1)?.click()`)
  await delay(350)

  // ---- 灯箱：信息区按钮可达 + 导出路径 ----
  await evaluate(`document.querySelector('.gallery-image')?.click()`)
  await delay(700)
  const lightbox = await evaluate(`(() => {
    const info = document.querySelector('.lightbox-info')
    const actions = document.querySelector('.lightbox-actions')
    if (!info || !actions) return null
    const rect = actions.getBoundingClientRect()
    const panel = document.querySelector('.lightbox-panel').getBoundingClientRect()
    return {
      visible: rect.height > 0 && rect.top >= panel.top - 1 && rect.bottom <= panel.bottom + 1,
      scrollable: info.scrollHeight > info.clientHeight,
      prompt: document.querySelector('.lightbox-prompt')?.textContent?.length || 0,
    }
  })()`)
  check('灯箱操作区在可视范围内', Boolean(lightbox?.visible), JSON.stringify(lightbox))
  await evaluate(`[...document.querySelectorAll('.lightbox-actions .button')].find((n) => n.textContent.includes('导出原图'))?.click()`)
  await delay(700)
  const lightboxExport = await evaluate(`document.querySelector('.lightbox-export')?.textContent || ''`)
  check('灯箱导出后显示路径', lightboxExport.includes('已保存到') && lightboxExport.includes('Downloads'), lightboxExport)
  await evaluate(`document.querySelector('.lightbox-close')?.click()`)
  await delay(400)

  // ---- 手机端：作品操作条换行不溢出 ----
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await delay(500)
  const mobile = await evaluate(`(() => {
    const doc = document.documentElement
    const bar = document.querySelector('.gallery-actions')
    return {
      overflow: doc.scrollWidth - doc.clientWidth,
      barWidth: bar ? Math.round(bar.getBoundingClientRect().width) : 0,
      cardWidth: Math.round((document.querySelector('.gallery-card') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width),
    }
  })()`)
  check('手机端无横向溢出', mobile.overflow <= 1, JSON.stringify(mobile))
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false })
  await delay(400)

  // ---- 会话最近删除 ----
  await clickText('.nav-item', '作品')
  await delay(200)
  await clickText('.new-chat', '新对话')
  await delay(500)
  await evaluate(`document.querySelector('.session-item .session-delete')?.click()`)
  await delay(400)
  const sessionModal = await evaluate(`document.querySelector('.modal-head h2')?.textContent || ''`)
  check('删除对话前确认', sessionModal.includes('删除'), sessionModal)
  await clickText('.modal .button', '移到最近删除')
  await delay(600)
  const sidebarTrash = await evaluate(`document.querySelector('.sidebar-trash')?.textContent || ''`)
  check('侧栏最近删除有计数', sidebarTrash.includes('1'), sidebarTrash)
  await evaluate(`document.querySelector('.sidebar-trash')?.click()`)
  await delay(500)
  const sessionRows = await evaluate(`document.querySelectorAll('.trash-row').length`)
  check('对话最近删除列出 1 条', sessionRows === 1, `rows=${sessionRows}`)
  await clickText('.trash-row .button', '还原')
  await delay(600)
  const trashAfterRestore = await evaluate(`document.querySelectorAll('.trash-row').length`)
  check('对话还原成功', trashAfterRestore === 0, `rows=${trashAfterRestore}`)

  check('无控制台异常', errors.length === 0, errors.slice(0, 3).join(' | '))

  const failed = results.filter((item) => !item.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  socket.close()
  process.exit(failed.length ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
