import { useEffect, useState } from 'react'
import { bridge } from '../lib/bridge'
import ConfirmDialog from './ConfirmDialog'

export default function ExitGuard() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const off = bridge?.app?.onCloseRequested?.(() => setOpen(true))
    return () => off?.()
  }, [])

  const keepRunning = () => {
    setOpen(false)
    void bridge.app.hideToTray()
  }

  const quit = () => {
    setOpen(false)
    void bridge.app.quit()
  }

  return (
    <ConfirmDialog
      open={open}
      title="任务还在进行"
      subtitle="直接关窗会中断正在跑的对话或生图。可以让它继续在托盘后台跑，完成后再从托盘打开；也可以退出并中断。"
      onClose={() => setOpen(false)}
      actions={[
        { label: '继续在后台跑', tone: 'primary', onClick: keepRunning },
        { label: '退出并中断', tone: 'danger', onClick: quit },
        { label: '取消', onClick: () => setOpen(false) },
      ]}
    />
  )
}
