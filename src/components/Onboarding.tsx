import { useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Loader2,
  Lock,
  Sparkles,
} from 'lucide-react'
import { useApp } from '../store'
import { bridge } from '../lib/bridge'

export function Onboarding({ onDone }: { onDone: () => void }) {
  const config = useApp((s) => s.config)
  const setConfig = useApp((s) => s.setConfig)
  const toastMessage = useApp((s) => s.toastMessage)

  const [keys, setKeys] = useState({ deepseek: '', seedream: '', minimax: '', hunyuan: '' })
  const [advanced, setAdvanced] = useState(false)
  const [bases, setBases] = useState({
    deepseek: config?.deepseek.baseUrl || 'https://api.deepseek.com',
    seedream: config?.providers.seedream?.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3',
    minimax: config?.providers.minimax?.baseUrl || 'https://api.minimax.cn',
    hunyuan: config?.providers.hunyuan?.baseUrl || 'https://tokenhub.tencentmaas.com',
  })
  const [testing, setTesting] = useState(false)
  const [tested, setTested] = useState(false)
  const [saving, setSaving] = useState(false)

  const deepseekReady = Boolean(config?.deepseek.hasKey) || Boolean(keys.deepseek.trim())

  const test = async () => {
    if (!keys.deepseek.trim()) {
      toastMessage('先填写 DeepSeek Key 再测试', 'info')
      return
    }
    setTesting(true)
    try {
      await bridge.config.test({
        provider: 'deepseek',
        key: keys.deepseek.trim(),
        baseUrl: bases.deepseek,
      })
      setTested(true)
      toastMessage('DeepSeek Key 可用', 'success')
    } catch (error) {
      setTested(false)
      toastMessage(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    if (!deepseekReady) {
      toastMessage('请填写 DeepSeek Key，或点「稍后设置」', 'info')
      return
    }
    setSaving(true)
    const patch: any = {
      onboarded: true,
      deepseekBaseUrl: bases.deepseek,
      providers: {},
    }
    if (keys.deepseek.trim()) patch.deepseekKey = keys.deepseek.trim()
    for (const id of ['seedream', 'minimax', 'hunyuan'] as const) {
      patch.providers[id] = { baseUrl: bases[id] }
      if (keys[id].trim()) patch.providers[id].key = keys[id].trim()
    }
    const next = await setConfig(patch)
    setSaving(false)
    if (next) onDone()
  }

  const skip = async () => {
    await setConfig({ onboarded: true })
    onDone()
  }

  return (
    <div className="onboarding">
      <div className="onboarding-visual">
        <div className="onboarding-brand">
          <Sparkles size={18} />
          绘话
        </div>
        <div className="onboarding-copy">
          <span>第一次使用绘话</span>
          <h1>
            先聊清楚，
            <br />
            再画出来。
          </h1>
          <p>
            用对话把画面说清楚，DeepSeek 帮你整理成生图文案，再交给 Seedream、MiniMax 或混元。
            图片和对话都留在本机。
          </p>
        </div>
        <div className="onboarding-steps">
          <div>
            <span>先聊清楚画面、光线和构图</span>
          </div>
          <div>
            <span>再整理成可直接生成的文案</span>
          </div>
          <div>
            <span>选模型出图，结果自动保存在本机</span>
          </div>
        </div>
      </div>

      <div className="onboarding-panel">
        <div className="onboarding-panel-head">
          <span className="onboarding-icon">
            <KeyRound size={18} />
          </span>
          <div>
            <h2>连接模型</h2>
            <p>至少填写 DeepSeek；生图供应商可以稍后再填。</p>
          </div>
        </div>

        <label className="onboard-field">
          <span>
            DeepSeek Key <em>必填</em>
          </span>
          <div className="inline-row">
            <input
              type="password"
              autoFocus
              placeholder={config?.deepseek.hasKey ? '已保存，留空则不修改' : 'sk-...'}
              value={keys.deepseek}
              onChange={(event) => setKeys((current) => ({ ...current, deepseek: event.target.value }))}
            />
            <button className="button button-quiet" disabled={testing} onClick={() => void test()}>
              {testing ? <Loader2 size={14} className="spin" /> : tested ? <Check size={14} /> : '测试'}
            </button>
          </div>
        </label>

        <div className="onboard-divider">
          <span>生图供应商（可选）</span>
        </div>

        {(
          [
            ['seedream', 'Seedream', '火山方舟 Ark'],
            ['minimax', 'MiniMax', '稀宇科技'],
            ['hunyuan', '混元', '腾讯 TokenHub'],
          ] as const
        ).map(([id, name, hint]) => (
          <label className="onboard-field" key={id}>
            <span>
              {name} <small>{hint}</small>
            </span>
            <input
              type="password"
              placeholder={
                config?.providers[id]?.hasKey
                  ? `已保存 ${config.providers[id].keyHint}，留空则不修改`
                  : '可以稍后再填'
              }
              value={keys[id]}
              onChange={(event) => setKeys((current) => ({ ...current, [id]: event.target.value }))}
            />
          </label>
        ))}

        <button className="advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}>
          {advanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          自定义 API 地址
        </button>
        {advanced ? (
          <div className="advanced-bases">
            {(['deepseek', 'seedream', 'minimax', 'hunyuan'] as const).map((id) => (
              <label key={id}>
                <span>{id}</span>
                <input
                  value={bases[id]}
                  onChange={(event) => setBases((current) => ({ ...current, [id]: event.target.value }))}
                />
              </label>
            ))}
          </div>
        ) : null}

        <div className="onboard-security">
          <Lock size={13} />
          Key 以明文保存在本机 config.json，只建议在自己的电脑上使用。请不要复用「生图模式」的 Key。
        </div>

        <div className="onboard-actions">
          <button className="button button-primary" disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 size={16} className="spin" /> : <ArrowRight size={16} />}
            保存并开始
          </button>
          <button className="ghost-link" onClick={() => void skip()}>
            稍后设置
          </button>
        </div>
      </div>
    </div>
  )
}
