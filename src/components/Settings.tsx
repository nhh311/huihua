import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  CircleAlert,
  Download,
  ExternalLink,
  FolderOpen,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react'
import { unzipSync, strFromU8 } from 'fflate'
import { useApp } from '../store'
import { bridge } from '../lib/bridge'
import { exportText } from '../lib/export'
import type { ConfigView, ProviderView } from '../types'
import { Field, Modal } from './ui'

type Tab = 'keys' | 'models' | 'styles' | 'data'

const APP_VERSION =
  document.querySelector('meta[name="application-version"]')?.getAttribute('content') || '1.0.0'

const PROVIDER_META = [
  { id: 'deepseek', name: 'DeepSeek', subtitle: '对话与生图规划' },
  { id: 'seedream', name: 'Seedream', subtitle: '火山方舟' },
  { id: 'minimax', name: 'MiniMax', subtitle: '稀宇科技' },
  { id: 'hunyuan', name: '混元', subtitle: '腾讯 TokenHub' },
]

const baseOf = (config: ConfigView | null, id: string) => {
  if (!config) return ''
  return id === 'deepseek' ? config.deepseek.baseUrl : config.providers[id]?.baseUrl || ''
}

const hintOf = (config: ConfigView | null, id: string) => {
  if (!config) return ''
  return id === 'deepseek' ? config.deepseek.keyHint : config.providers[id]?.keyHint || ''
}

const bytesToDataUrl = (bytes: Uint8Array, name: string) => {
  const ext = name.split('.').pop()?.toLowerCase() || 'png'
  const mime =
    ext === 'jpg' || ext === 'jpeg'
      ? 'image/jpeg'
      : ext === 'webp'
        ? 'image/webp'
        : ext === 'gif'
          ? 'image/gif'
          : 'image/png'
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return `data:${mime};base64,${btoa(binary)}`
}

export function Settings({ onClose }: { onClose: () => void }) {
  const config = useApp((s) => s.config)
  const styles = useApp((s) => s.styles)
  const sessions = useApp((s) => s.sessions)
  const catalog = useApp((s) => s.catalog)
  const setConfig = useApp((s) => s.setConfig)
  const saveStyle = useApp((s) => s.saveStyle)
  const deleteStyle = useApp((s) => s.deleteStyle)
  const toastMessage = useApp((s) => s.toastMessage)

  const [tab, setTab] = useState<Tab>('keys')
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [bases, setBases] = useState<Record<string, string>>({})
  const [testing, setTesting] = useState('')
  const [tests, setTests] = useState<Record<string, { ok: boolean; text: string }>>({})
  const [saving, setSaving] = useState(false)

  const [allModels, setAllModels] = useState<ProviderView[]>([])
  const [modelBusy, setModelBusy] = useState('')
  const [custom, setCustom] = useState<{ provider: string; id: string }>({ provider: 'seedream', id: '' })
  const [probe, setProbe] = useState<{
    provider: string
    models: { id: string; name: string; desc: string; status: string }[]
    note: string
    selected: string[]
  } | null>(null)

  const [styleBusy, setStyleBusy] = useState(false)
  const styleInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setBases(
      Object.fromEntries(PROVIDER_META.map((item) => [item.id, baseOf(config, item.id)])) as Record<
        string,
        string
      >
    )
  }, [config])

  const loadAll = async () => {
    try {
      const value = await bridge.models.all()
      setAllModels(value)
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  useEffect(() => {
    void loadAll()
  }, [])

  const saveKeys = async () => {
    setSaving(true)
    const patch: any = { deepseekBaseUrl: bases.deepseek, providers: {} }
    if (keys.deepseek?.trim()) patch.deepseekKey = keys.deepseek.trim()
    for (const item of PROVIDER_META.filter((p) => p.id !== 'deepseek')) {
      patch.providers[item.id] = { baseUrl: bases[item.id] }
      if (keys[item.id]?.trim()) patch.providers[item.id].key = keys[item.id].trim()
    }
    const next = await setConfig(patch)
    setSaving(false)
    if (next) {
      setKeys({})
      setTests({})
      await loadAll()
      toastMessage('接口设置已保存', 'success')
    }
  }

  const test = async (id: string) => {
    setTesting(id)
    try {
      await bridge.config.test({
        provider: id,
        key: keys[id]?.trim() || undefined,
        baseUrl: bases[id],
      })
      setTests((current) => ({ ...current, [id]: { ok: true, text: '连接正常，Key 可用' } }))
    } catch (error) {
      setTests((current) => ({
        ...current,
        [id]: { ok: false, text: error instanceof Error ? error.message : String(error) },
      }))
    } finally {
      setTesting('')
    }
  }

  const toggleModel = async (provider: ProviderView, modelId: string) => {
    const enabled = provider.models.filter((m) => m.enabled).map((m) => m.id)
    const next = enabled.includes(modelId)
      ? enabled.filter((id) => id !== modelId)
      : [...enabled, modelId]
    if (!next.length) {
      toastMessage('至少保留一个可用模型', 'info')
      return
    }
    setModelBusy(modelId)
    await setConfig({ enabled: { [provider.id]: next } })
    await loadAll()
    setModelBusy('')
  }

  const addCustom = async () => {
    const id = custom.id.trim()
    if (!id) return
    const exists = allModels.find((p) => p.id === custom.provider)?.models.some((m) => m.id === id)
    if (exists) {
      toastMessage('这个模型已经在列表里了', 'info')
      return
    }
    const next = [
      ...((config?.models?.custom || []) as any[]),
      { id, provider: custom.provider, name: id, desc: '手动添加' },
    ]
    const provider = allModels.find((p) => p.id === custom.provider)
    const enabled = provider?.models.filter((m) => m.enabled).map((m) => m.id) || []
    await setConfig({ custom: next, enabled: { [custom.provider]: [...enabled, id] } })
    setCustom((current) => ({ ...current, id: '' }))
    await loadAll()
    toastMessage('已添加模型', 'success')
  }

  const removeCustom = async (providerId: string, modelId: string) => {
    const next = ((config?.models?.custom || []) as any[]).filter(
      (item) => !(item.provider === providerId && item.id === modelId)
    )
    await setConfig({ custom: next })
    await loadAll()
  }

  const runProbe = async (providerId: string) => {
    setModelBusy(`probe-${providerId}`)
    try {
      const result = await bridge.models.probe({ provider: providerId })
      setProbe({
        provider: providerId,
        models: result.models || [],
        note: result.note || '',
        selected: (result.models || []).map((m: any) => m.id),
      })
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setModelBusy('')
    }
  }

  const applyProbe = async () => {
    if (!probe) return
    const provider = allModels.find((p) => p.id === probe.provider)
    if (!provider) return
    const selected = probe.selected
    const known = new Set(provider.models.map((m) => m.id))
    const customList = [...((config?.models?.custom || []) as any[])]
    for (const id of selected) {
      if (!known.has(id)) {
        const candidate = probe.models.find((m) => m.id === id)
        customList.push({
          id,
          provider: probe.provider,
          name: candidate?.name || id,
          desc: '从接口探测添加',
        })
      }
    }
    const enabled = provider.models.filter((m) => m.enabled).map((m) => m.id)
    const nextEnabled = Array.from(new Set([...enabled, ...selected]))
    await setConfig({
      custom: customList,
      enabled: { [probe.provider]: nextEnabled.length ? nextEnabled : enabled },
    })
    await loadAll()
    setProbe(null)
    toastMessage('模型列表已更新', 'success')
  }

  const importStyle = async (file: File) => {
    setStyleBusy(true)
    try {
      const zip = unzipSync(new Uint8Array(await file.arrayBuffer()))
      const manifestName = Object.keys(zip).find((name) => /(^|\/)(style|manifest)\.json$/i.test(name))
      if (!manifestName) throw new Error('压缩包里没有 style.json 或 manifest.json')
      const manifest = JSON.parse(strFromU8(zip[manifestName]))
      const samples = Object.entries(zip)
        .filter(([name]) => /\.(png|jpe?g|webp)$/i.test(name))
        .slice(0, 3)
        .map(([name, bytes]) => bytesToDataUrl(bytes, name))
      if (!manifest.prompt || !String(manifest.prompt).trim()) throw new Error('清单里缺少 prompt')
      const saved = await saveStyle({
        name: String(manifest.name || file.name.replace(/\.zip$/i, '')).slice(0, 40),
        description: String(manifest.description || ''),
        prompt: String(manifest.prompt),
        recommended: manifest.recommended || null,
        samples,
      })
      if (saved) toastMessage('风格已导入', 'success')
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setStyleBusy(false)
    }
  }

  const exportBackup = async () => {
    const data = {
      app: '绘话',
      version: 1,
      exportedAt: new Date().toISOString(),
      sessions,
      config: config
        ? {
            defaults: config.defaults,
            models: config.models,
            onboarded: config.onboarded,
          }
        : null,
    }
    const content = JSON.stringify(data, null, 2)
    const path = await exportText(`绘话-备份-${new Date().toISOString().slice(0, 10)}.json`, content)
    if (path) {
      toastMessage(`备份已保存到 ${path}`, 'success')
    }
  }

  const providerName = (id: string) => catalog.find((p) => p.id === id)?.name || id
  const styleCount = useMemo(() => styles.length, [styles])

  return (
    <Modal
      title="设置"
      subtitle="接口密钥只保存在本机，不会上传到绘话的服务器。"
      onClose={onClose}
      wide
      footer={
        <div className="settings-foot">
          <span className="settings-foot-note">
            {tab === 'keys' ? '修改后点「保存接口」生效' : '设置改动会立即保存'}
          </span>
          <div>
            {tab === 'keys' ? (
              <button className="button button-primary" disabled={saving} onClick={() => void saveKeys()}>
                {saving ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
                保存接口
              </button>
            ) : (
              <button className="button button-quiet" onClick={onClose}>
                完成
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="settings-tabs">
        {(
          [
            ['keys', '接口'],
            ['models', '模型'],
            ['styles', `风格（${styleCount}）`],
            ['data', '数据'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'keys' ? (
        <div className="settings-section">
          <div className="settings-intro">
            <KeyRound size={18} />
            <div>
              <strong>四把 Key 相互独立</strong>
              <p>
                请不要填入「生图模式」里正在使用的 Key。密钥以明文保存在
                <code> %APPDATA%\绘话\config.json</code>，只建议在自己的电脑上使用。
              </p>
            </div>
          </div>

          <div className="key-cards">
            {PROVIDER_META.map((item) => (
              <div className={`key-card ${item.id === 'deepseek' ? 'key-card-main' : ''}`} key={item.id}>
                <div className="key-card-head">
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.subtitle}</span>
                  </div>
                  <span className={`key-state ${config?.deepseek.hasKey && item.id === 'deepseek' ? 'is-ok' : ''} ${config?.providers[item.id]?.hasKey ? 'is-ok' : ''}`}>
                    {item.id === 'deepseek'
                      ? config?.deepseek.hasKey
                        ? `已保存 ${config.deepseek.keyHint}`
                        : '未配置'
                      : config?.providers[item.id]?.hasKey
                        ? `已保存 ${config.providers[item.id].keyHint}`
                        : '未配置'}
                  </span>
                </div>
                <div className="key-card-row">
                  <input
                    type="password"
                    placeholder={hintOf(config, item.id) ? '已保存，留空则不修改' : '填写 API Key'}
                    value={keys[item.id] || ''}
                    onChange={(event) =>
                      setKeys((current) => ({ ...current, [item.id]: event.target.value }))
                    }
                  />
                  <button
                    className="button button-quiet"
                    disabled={testing === item.id}
                    onClick={() => void test(item.id)}
                  >
                    {testing === item.id ? <Loader2 size={14} className="spin" /> : '测试'}
                  </button>
                </div>
                <input
                  className="base-input"
                  value={bases[item.id] || ''}
                  placeholder="API 地址"
                  onChange={(event) =>
                    setBases((current) => ({ ...current, [item.id]: event.target.value }))
                  }
                />
                {tests[item.id] ? (
                  <p className={`test-result ${tests[item.id].ok ? 'is-ok' : 'is-error'}`}>
                    {tests[item.id].ok ? <Check size={13} /> : <CircleAlert size={13} />}
                    {tests[item.id].text}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === 'models' ? (
        <div className="settings-section">
          <div className="settings-intro">
            <RefreshCw size={18} />
            <div>
              <strong>模型由内置目录 + 接口探测共同维护</strong>
              <p>
                取消勾选会从参数栏隐藏；探测只获取候选，勾选后才加入。未适配的模型按供应商默认参数调用。
              </p>
            </div>
          </div>

          <div className="model-add">
            <select
              value={custom.provider}
              onChange={(event) => setCustom((current) => ({ ...current, provider: event.target.value }))}
            >
              {PROVIDER_META.filter((p) => p.id !== 'deepseek').map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <input
              placeholder="手动添加模型 ID"
              value={custom.id}
              onChange={(event) => setCustom((current) => ({ ...current, id: event.target.value }))}
            />
            <button className="button button-quiet" onClick={() => void addCustom()}>
              <Plus size={15} />
              添加
            </button>
          </div>

          <div className="model-groups">
            {allModels.map((provider) => (
              <div className="model-group" key={provider.id}>
                <div className="model-group-head">
                  <div>
                    <strong>{provider.name}</strong>
                    <span>{provider.subtitle}</span>
                  </div>
                  <button
                    className="button button-quiet"
                    disabled={modelBusy === `probe-${provider.id}`}
                    onClick={() => void runProbe(provider.id)}
                  >
                    {modelBusy === `probe-${provider.id}` ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    获取新模型
                  </button>
                </div>

                {probe?.provider === provider.id ? (
                  <div className="probe-panel">
                    <div className="probe-head">
                      <strong>探测到 {probe.models.length} 个候选</strong>
                      <button className="ghost-link" onClick={() => setProbe(null)}>
                        取消
                      </button>
                    </div>
                    {probe.note ? <p className="probe-note">{probe.note}</p> : null}
                    {probe.models.length ? (
                      <div className="probe-list">
                        {probe.models.map((model) => (
                          <label key={model.id}>
                            <input
                              type="checkbox"
                              checked={probe.selected.includes(model.id)}
                              onChange={(event) =>
                                setProbe((current) =>
                                  current
                                    ? {
                                        ...current,
                                        selected: event.target.checked
                                          ? [...current.selected, model.id]
                                          : current.selected.filter((id) => id !== model.id),
                                      }
                                    : current
                                )
                              }
                            />
                            <span>
                              <strong>{model.name || model.id}</strong>
                              <small>
                                {model.id}
                                {model.status ? ` · ${model.status}` : ''}
                              </small>
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : null}
                    <button className="button button-primary" onClick={() => void applyProbe()}>
                      更新列表
                    </button>
                  </div>
                ) : null}

                <div className="model-list">
                  {provider.models.map((model) => (
                    <div className={`model-row ${model.enabled ? '' : 'is-off'}`} key={model.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={Boolean(model.enabled)}
                          disabled={modelBusy === model.id}
                          onChange={() => void toggleModel(provider, model.id)}
                        />
                        <span>
                          <strong>{model.name}</strong>
                          <small>
                            {model.id} · {model.resolutions.join('/')} · 最多 {model.countMax} 张
                          </small>
                        </span>
                      </label>
                      {!model.builtin ? (
                        <button
                          className="icon-button"
                          title="删除自定义模型"
                          onClick={() => void removeCustom(provider.id, model.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === 'styles' ? (
        <div className="settings-section">
          <div className="settings-intro">
            <SparklesIcon />
            <div>
              <strong>风格包是一个 zip</strong>
              <p>
                压缩包内放 <code>style.json</code>（至少包含 name / prompt）和 1–3 张示例图。风格只追加约束，不会覆盖你的描述。
              </p>
            </div>
          </div>

          <div className="style-actions">
            <button className="button button-quiet" disabled={styleBusy} onClick={() => styleInput.current?.click()}>
              {styleBusy ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
              导入风格包
            </button>
            <input
              ref={styleInput}
              type="file"
              hidden
              accept=".zip"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void importStyle(file)
                event.target.value = ''
              }}
            />
          </div>

          <div className="style-list">
            {styles.map((style) => (
              <div className="style-card" key={style.id}>
                <div className="style-cover">
                  {style.coverUrl ? (
                    <img src={style.coverUrl} alt={style.name} />
                  ) : (
                    <span>{style.name.slice(0, 1)}</span>
                  )}
                </div>
                <div className="style-info">
                  <strong>
                    {style.name}
                    {style.builtin ? <em>内置</em> : null}
                    {style.kind === 'preset' ? <em>预设</em> : null}
                    {style.kind === 'asset' ? <em>素材</em> : null}
                  </strong>
                  <p>{style.description || style.prompt.slice(0, 80)}</p>
                  {style.spec ? (
                    <details className="style-spec">
                      <summary>查看详细规格</summary>
                      <pre>{style.spec}</pre>
                    </details>
                  ) : null}
                  {style.recommended ? (
                    <small>
                      推荐 {style.recommended.provider} · {style.recommended.ratio} ·{' '}
                      {style.recommended.resolution}
                    </small>
                  ) : null}
                </div>
                {!style.builtin ? (
                  <button
                    className="icon-button"
                    title="删除风格"
                    onClick={() => {
                      if (window.confirm('删除这个风格包？')) void deleteStyle(style.id)
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === 'data' ? (
        <div className="settings-section">
          <div className="settings-intro">
            <FolderOpen size={18} />
            <div>
              <strong>数据都在本机</strong>
              <p>对话存在 IndexedDB，图片、风格和配置存在下面的目录；备份不包含任何 Key。</p>
            </div>
          </div>

          <Field label="数据目录">
            <div className="inline-row">
              <input readOnly value={config?.dataDir || ''} />
              <button className="button button-quiet" onClick={() => void bridge.app.openDataDir()}>
                <ExternalLink size={14} />
                打开
              </button>
            </div>
          </Field>

          <div className="data-actions">
            <button className="button button-quiet" onClick={exportBackup}>
              <Download size={15} />
              导出备份（不含 Key）
            </button>
            <button
              className="button button-quiet"
              onClick={() => {
                if (!window.confirm('恢复默认设置会重置接口地址、模型选择与偏好；不会删除 Key、对话和图片。继续？')) return
                void bridge.config.reset().then(() => window.location.reload())
              }}
            >
              <RefreshCw size={15} />
              恢复默认设置
            </button>
          </div>

          <div className="about-box">
            <span>绘话 {APP_VERSION}</span>
            <span>DeepSeek Flash · 深度思考</span>
            <span>Seedream / MiniMax / 混元</span>
            <span>Windows 10 / 11 x64</span>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}

const SparklesIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
    <path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" />
  </svg>
)
