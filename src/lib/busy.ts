import { bridge } from './bridge'

const flags = new Set<string>()
const listeners = new Set<(busy: boolean) => void>()

function publish() {
  const busy = flags.size > 0
  listeners.forEach((listener) => listener(busy))
  void bridge?.app?.setBusy?.(busy)
}

export function setBusy(key: string, value: boolean) {
  if (value) {
    flags.add(key)
  } else {
    flags.delete(key)
  }
  publish()
}

export function isBusy() {
  return flags.size > 0
}

export function onBusyChange(listener: (busy: boolean) => void) {
  listeners.add(listener)
  listener(flags.size > 0)
  return () => {
    listeners.delete(listener)
  }
}
