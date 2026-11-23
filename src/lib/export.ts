import { bridge } from './bridge'

/** 走系统保存对话框导出作品原图；用户取消时返回 null。 */
export const exportImage = async (id: string): Promise<string | null> => {
  const result = await bridge.gallery.exportAs(id)
  if (!result || result.canceled || !result.path) return null
  return String(result.path)
}

/** 走系统保存对话框导出文本/JSON；用户取消时返回 null。 */
export const exportText = async (name: string, content: string): Promise<string | null> => {
  const result = await bridge.file.saveText(name, content)
  if (!result || result.canceled || !result.path) return null
  return String(result.path)
}

export const showInFolder = async (path: string) => {
  try {
    await bridge.app.showItem(path)
  } catch {
    // 用户没装资源管理器/路径消失时不用弹错
  }
}

export const baseName = (path: string) => {
  const parts = String(path).split(/[\\/]/)
  return parts[parts.length - 1] || path
}
