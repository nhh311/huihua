import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  Check,
  FolderOpen,
  ImageOff,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react'
import { bridge } from '../lib/bridge'
import {
  alignRatio,
  applyVars,
  defaultValues,
  filterPresets,
  presetSlots,
  presetVars,
  ratioFromPrompt,
  RATIO_LABEL,
  sourceModelName,
} from '../lib/presets'
import { useActiveSession, useApp } from '../store'
import type { Preset } from '../types'
import { Modal } from './ui'
import './presets.css'

interface Props {
  onApply: (payload: {
    preset: Preset
    prompt: string
    provider: string
    model: string
    ratio: string
    resolution: string
    count: number
    mode: 'chat' | 'generate'
  }) => void
  onOpenSettings: () => void
}

function PresetThumb({ preset, big = false }: { preset: Preset; big?: boolean }) {
  const start = () => (big ? preset.preview || preset.thumb : preset.thumb || preset.preview)
  const [src, setSrc] = useState(start)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setSrc(big ? preset.preview || preset.thumb : preset.thumb || preset.preview)
    setFailed(false)
  }, [preset.id, preset.preview, preset.thumb, big])

  if (failed || !src) {
    return (
      <div className="preset-ph">
        <ImageOff size={big ? 22 : 18} />
        {big ? <span>示例图没有随安装包一起装上</span> : null}
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={preset.title}
      loading={big ? 'eager' : 'lazy'}
      draggable={false}
      onError={() => {
        // 大图先失败就退回缩略图，缩略图也失败才显示占位；避免只是缺 preview 时整块空白
        const fallback = big ? preset.thumb : preset.preview
        if (fallback && src !== fallback) setSrc(fallback)
        else setFailed(true)
      }}
    />
  )
}

const ratioStyle = (preset: Preset) => {
  const ratio = preset.width && preset.height ? preset.width / preset.height : 1
  return { aspectRatio: String(Math.min(1.9, Math.max(0.62, ratio))) }
}

export function Presets({ onApply, onOpenSettings }: Props) {
  const catalog = useApp((state) => state.presets)
  const busy = useApp((state) => state.presetsBusy)
  const config = useApp((state) => state.config)
  const providers = useApp((state) => state.catalog)
  const loadPresets = useApp((state) => state.loadPresets)
  const importPresets = useApp((state) => state.importPresets)
  const removeUserPresets = useApp((state) => state.removeUserPresets)
  const toggleFavorite = useApp((state) => state.toggleFavorite)
  const markPresetUsed = useApp((state) => state.markPresetUsed)
  const installPreset = useApp((state) => state.installPreset)
  const adaptPrompt = useApp((state) => state.adaptPrompt)
  const session = useActiveSession()

  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('all')
  const [favorite, setFavorite] = useState(false)
  const [recent, setRecent] = useState(false)
  const [modelFilter, setModelFilter] = useState('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [lang, setLang] = useState<'zh' | 'en'>('zh')
  const [provider, setProvider] = useState('seedream')
  const [model, setModel] = useState('')
  const [ratio, setRatio] = useState('1:1')
  const [resolution, setResolution] = useState('2K')
  const [count, setCount] = useState(1)
  const [installing, setInstalling] = useState(false)
  const [adapting, setAdapting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [specOpen, setSpecOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [adapted, setAdapted] = useState<{ prompt: string; note: string } | null>(null)

  const items = catalog?.presets || []
  const list = useMemo(
    () =>
      filterPresets(
        items,
        { cat, favorite, recent, model: modelFilter, query },
        catalog?.recent || []
      ),
    [items, cat, favorite, recent, modelFilter, query, catalog?.recent]
  )

  const open = openId ? items.find((item) => item.id === openId) || null : null
  const providerView = providers.find((item) => item.id === provider)
  const modelView = providerView?.models.find((item) => item.id === model)
  const filled = open ? applyVars(open, values, lang) : { text: '', missing: [] }
  const promptRatio = open ? ratioFromPrompt(lang === 'en' ? open.promptEn : open.prompt) : null
  const promptText = adapted?.prompt || alignRatio(filled.text, ratio)
  const canRun = Boolean(promptText.trim()) && Boolean(providerView?.hasKey)
  const needsRefBlocked = Boolean(open?.needsReference)
  const slots = open ? presetSlots(open) : []

  const choose = (preset: Preset) => {
    setOpenId(preset.id)
    setValues(defaultValues(preset))
    setLang('zh')
    setAdapted(null)
    const nextProvider =
      session?.params.provider && providers.some((item) => item.id === session.params.provider)
        ? session.params.provider
        : config?.defaults.provider || 'seedream'
    const nextView = providers.find((item) => item.id === nextProvider)
    const wanted = session?.params.model || config?.defaults.model || ''
    const nextModel =
      nextView?.models.find((item) => item.id === wanted)?.id || nextView?.defaultModel || ''
    setProvider(nextProvider)
    setModel(nextModel)
    setRatio(
      ratioFromPrompt(preset.prompt) ||
        preset.ratio ||
        session?.params.ratio ||
        config?.defaults.ratio ||
        '1:1'
    )
    setResolution(session?.params.resolution || config?.defaults.resolution || '2K')
    setCount(1)
  }

  const changeProvider = (next: string) => {
    setProvider(next)
    const view = providers.find((item) => item.id === next)
    setModel(view?.defaultModel || view?.models[0]?.id || '')
  }

  const install = async () => {
    if (!open || !promptText.trim()) return
    setInstalling(true)
    try {
      await installPreset({
        id: open.id,
        provider,
        model,
        ratio,
        resolution,
        prompt: promptText,
        count,
      })
    } finally {
      setInstalling(false)
    }
  }

  const adapt = async () => {
    if (!open || !promptText.trim()) return
    setAdapting(true)
    try {
      const result = await adaptPrompt({
        provider,
        model,
        prompt: alignRatio(filled.text, ratio),
        title: open.title,
        originalModel: open.model,
      })
      if (result?.prompt) {
        setAdapted(result)
        useApp.getState().toastMessage(result.note || '已适配到当前模型', 'success')
      }
    } finally {
      setAdapting(false)
    }
  }

  const use = (mode: 'chat' | 'generate') => {
    if (!open || !promptText.trim()) return
    if (!providerView?.hasKey) {
      useApp.getState().toastMessage(`${providerView?.name || provider} 还没有填 Key`, 'error')
      onOpenSettings()
      return
    }
    void markPresetUsed(open.id)
    onApply({ preset: open, prompt: promptText, provider, model, ratio, resolution, count, mode })
  }

  const importNow = async () => {
    if (importing) return
    setImporting(true)
    try {
      const result = await importPresets()
      if (result) {
        setOpenId(null)
        setCat('all')
        setQuery('')
        setFavorite(false)
        setRecent(false)
      }
    } finally {
      setImporting(false)
    }
  }

  const removeLibrary = async () => {
    setRemoveOpen(false)
    const ok = await removeUserPresets()
    if (ok) {
      setOpenId(null)
      setCat('all')
    }
  }

  const specModal = specOpen ? (
    <Modal
      title="素材库格式"
      subtitle="一个文件夹、一份 presets.json，图片放 preview/"
      onClose={() => setSpecOpen(false)}
      wide
      footer={
        <>
          <button className="btn" onClick={() => void bridge.app.openDataDir()}>
            打开数据目录
          </button>
          <button
            className="btn primary"
            onClick={() => {
              setSpecOpen(false)
              void importNow()
            }}
          >
            选择文件夹导入
          </button>
        </>
      }
    >
      <div className="preset-spec">
        <h4>目录结构</h4>
        <pre>{`my-library/
  presets.json
  preview/
    poster-01.png
    poster-02.webp
  thumb/            # 可选，同名文件作为卡片缩略图
    poster-01.png`}</pre>
        <h4>presets.json</h4>
        <pre>{`{
  "meta": { "source": "我的素材库", "license": "自制，可商用" },
  "categories": [{ "id": "poster", "name": "海报" }],
  "presets": [
    {
      "id": "poster-01",
      "cat": "poster",
      "title": "雨夜霓虹海报",
      "prompt": "雨夜东京街头，霓虹灯牌，主体：{主体}",
      "params": { "主体": "一位撑伞的女孩" },
      "vars": "主体",
      "image": "poster-01.png"
    }
  ]
}`}</pre>
        <h4>字段</h4>
        <ul>
          <li>
            <code>id</code> 必填且库内唯一；<code>cat</code> 必填，对应分类 id。
          </li>
          <li>
            <code>title</code>、<code>prompt</code> 必填；<code>promptEn</code>、<code>desc</code>、
            <code>model</code> 可空。
          </li>
          <li>
            <code>image</code> 是 <code>preview/</code> 下的相对路径；找不到图不会导入失败，只显示占位。
          </li>
          <li>
            变量写成 {'{变量}'}，默认值放 <code>params</code>；最多 5000 条、单图 40MB、整库 512MB。
          </li>
          <li>分类计数按实际条目重算，<code>meta.count</code> 不用手写。</li>
        </ul>
        <h4>导入与替换</h4>
        <p>
          「导入素材库」选这个文件夹即可；再次导入会整体替换用户库，收藏和最近使用按 id
          保留。点「移除素材库」回到内置库（开源版则回到空状态）。
        </p>
        <p className="preset-spec-note">
          素材版权由导入者负责。内置库与用户库互不覆盖，除非你自己点移除。
        </p>
      </div>
    </Modal>
  ) : null

  if (!catalog) {
    return (
      <div className="presets-view">
        <div className="presets-loading">
          <Loader2 className="spin" size={20} />
          <span>正在读取素材库…</span>
        </div>
      </div>
    )
  }

  if (!catalog.available) {
    return (
      <div className="presets-view">
        <div className="presets-empty library-empty">
          <BookOpen size={30} />
          <h2>这个版本不带内置素材库</h2>
          <p>
            绘话只保留素材库接口。按格式整理好自己的提示词和示例图，选择文件夹导入即可；
            提示词与图片只存在本机，不会上传到任何服务器。
          </p>
          <div className="library-steps">
            <div>
              <strong>1</strong>
              <span>根目录放 presets.json</span>
              <em>标题、提示词、分类，变量写成 {'{变量}'}</em>
            </div>
            <div>
              <strong>2</strong>
              <span>示例图放进 preview/</span>
              <em>文件名填到每条预设的 image 字段</em>
            </div>
            <div>
              <strong>3</strong>
              <span>导入这个文件夹</span>
              <em>再导入一次会整体替换，收藏与最近使用保留</em>
            </div>
          </div>
          <div className="presets-empty-actions">
            <button className="btn primary" onClick={() => void importNow()} disabled={importing}>
              {importing ? <Loader2 className="spin" size={15} /> : <FolderOpen size={15} />}
              导入素材库
            </button>
            <button className="btn" onClick={() => setSpecOpen(true)}>
              <BookOpen size={15} /> 查看格式规范
            </button>
            <button className="btn ghost" onClick={() => void bridge.app.openDataDir()}>
              打开数据目录
            </button>
            <button className="btn ghost" onClick={() => void loadPresets()} disabled={busy}>
              <RefreshCw size={14} /> 重新读取
            </button>
          </div>
          <small>
            {catalog.error || '还没有导入素材库。'}
            {' '}也可以把整理好的文件夹放到 {catalog.userRoot || '%APPDATA%\\绘话\\presets'} 后重启。
          </small>
        </div>
        {specModal}
      </div>
    )
  }

  const categories = [{ id: 'all', name: '全部', count: catalog.count }, ...catalog.categories]
  const isUserLibrary = catalog.origin === 'user'

  return (
    <div className="presets-view">
      <header className="presets-head">
        <div>
          <span className="presets-kicker">
            <Sparkles size={13} /> 素材库 · {catalog.count} 条成品配方
          </span>
          <h1>照着做，就能出图</h1>
          <p>
            每条都是一个完整配方：标题、示例图、变量和提示词。改掉变量就能带进对话，
            也可以一键装成自己的风格。
          </p>
        </div>
        <div className="presets-head-side">
          <div className="presets-stats">
            <div>
              <strong>{catalog.categories.length}</strong>
              <span>分类</span>
            </div>
            <div>
              <strong>{catalog.favorites.length}</strong>
              <span>收藏</span>
            </div>
            <div>
              <strong>{catalog.recent.length}</strong>
              <span>最近用</span>
            </div>
          </div>
          <div className="presets-edition">
            <span className={`presets-badge ${isUserLibrary ? 'is-user' : ''}`}>
              {isUserLibrary ? '本地素材库' : '内置素材库'}
            </span>
            <button
              className="btn ghost small"
              onClick={() => void importNow()}
              disabled={importing}
            >
              {importing ? <Loader2 className="spin" size={13} /> : <Upload size={13} />}
              {isUserLibrary ? '更换素材库' : '导入素材库'}
            </button>
            {isUserLibrary ? (
              <button className="btn ghost small danger-text" onClick={() => setRemoveOpen(true)}>
                <Trash2 size={13} /> 移除
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="presets-toolbar">
        <label className="presets-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜标题、风格、变量，比如「手办」「海报」「赛博」"
          />
          {query ? (
            <button className="presets-search-clear" onClick={() => setQuery('')} title="清空">
              <X size={13} />
            </button>
          ) : null}
        </label>
        <select value={modelFilter} onChange={(event) => setModelFilter(event.target.value)}>
          <option value="all">全部推荐模型</option>
          <option value="nano-banana-pro-plus">Banana Pro</option>
          <option value="gpt-image-2">GPT-Image 2</option>
        </select>
        <div className="presets-tabs">
          <button
            className={!favorite && !recent ? 'is-active' : ''}
            onClick={() => {
              setFavorite(false)
              setRecent(false)
            }}
          >
            全部
          </button>
          <button
            className={favorite ? 'is-active' : ''}
            onClick={() => {
              setFavorite(true)
              setRecent(false)
            }}
          >
            收藏
          </button>
          <button
            className={recent ? 'is-active' : ''}
            onClick={() => {
              setRecent(true)
              setFavorite(false)
            }}
          >
            最近
          </button>
        </div>
      </div>

      <div className="presets-cats">
        {categories.map((item) => (
          <button
            key={item.id}
            className={`presets-cat ${cat === item.id && !favorite && !recent ? 'is-active' : ''}`}
            onClick={() => {
              setCat(item.id)
              setFavorite(false)
              setRecent(false)
            }}
          >
            {item.name}
            <span>{item.id === 'all' ? catalog.count : item.count}</span>
          </button>
        ))}
      </div>

      <div className={`presets-body ${open ? 'has-detail' : ''}`}>
        <div className="presets-main">
          <div className="presets-count">
            {list.length} 条
            {query ? ` · 搜索「${query}」` : ''}
            {favorite ? ' · 收藏' : recent ? ' · 最近使用' : ''}
          </div>
          {list.length ? (
            <div className="presets-grid">
              {list.map((preset) => (
                <article
                  key={preset.id}
                  className={`preset-card ${openId === preset.id ? 'is-active' : ''}`}
                  onClick={() => choose(preset)}
                >
                  <div className="preset-shot" style={ratioStyle(preset)}>
                    <PresetThumb preset={preset} />
                    <button
                      className={`preset-star ${preset.favorite ? 'is-on' : ''}`}
                      title={preset.favorite ? '取消收藏' : '收藏'}
                      onClick={(event) => {
                        event.stopPropagation()
                        void toggleFavorite(preset.id)
                      }}
                    >
                      <Star size={13} fill={preset.favorite ? 'currentColor' : 'none'} />
                    </button>
                    <span className="preset-ratio">
                      {RATIO_LABEL[ratioFromPrompt(preset.prompt) || preset.ratio] ||
                        ratioFromPrompt(preset.prompt) ||
                        preset.ratio}
                    </span>
                    {preset.needsReference ? <span className="preset-ref">需参考图</span> : null}
                  </div>
                  <div className="preset-card-body">
                    <h3>{preset.title}</h3>
                    <p>{preset.desc || preset.prompt.replace(/\{[^{}]+\}/g, '…').slice(0, 54)}</p>
                    <div className="preset-card-meta">
                      <span>{sourceModelName(preset.model)}</span>
                      {presetVars(preset).length ? <em>{presetVars(preset).length} 个变量</em> : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="presets-empty small">
              <Search size={22} />
              <h2>没有匹配的预设</h2>
              <p>换个词，或者把分类切回「全部」。</p>
              <button
                className="btn ghost"
                onClick={() => {
                  setQuery('')
                  setCat('all')
                  setFavorite(false)
                  setRecent(false)
                  setModelFilter('all')
                }}
              >
                清空筛选
              </button>
            </div>
          )}
        </div>

        {open ? (
          <aside className="preset-detail">
            <div className="preset-detail-head">
              <div className="preset-detail-title">
                <span className="preset-detail-cat">
                  {catalog.categories.find((item) => item.id === open.cat)?.name || open.cat}
                </span>
                <h2>{open.title}</h2>
                <p>{open.desc || open.titleEn}</p>
              </div>
              <button className="icon-btn" title="关闭" onClick={() => setOpenId(null)}>
                <X size={16} />
              </button>
            </div>

            <div className="preset-detail-shot">
              <PresetThumb preset={open} big />
            </div>

            <div className="preset-detail-section">
              <div className="preset-detail-label">
                提示词
                <div className="preset-lang">
                  <button
                    className={lang === 'zh' ? 'is-active' : ''}
                    onClick={() => {
                      setLang('zh')
                      setAdapted(null)
                    }}
                  >
                    中文
                  </button>
                  <button
                    className={lang === 'en' ? 'is-active' : ''}
                    onClick={() => {
                      setLang('en')
                      setAdapted(null)
                    }}
                  >
                    EN
                  </button>
                </div>
              </div>
              {slots.length ? (
                <div className="preset-vars">
                  {slots.map((slot) => {
                    const label = lang === 'en' ? slot.en || slot.zh : slot.zh || slot.en
                    return (
                      <label key={slot.key}>
                        <span>{label}</span>
                        <input
                          value={values[slot.key] ?? ''}
                          placeholder={open.params?.[slot.zh] || '填一个值'}
                          onChange={(event) => {
                            const next = { ...values, [slot.key]: event.target.value }
                            setValues(next)
                            setAdapted(null)
                          }}
                        />
                      </label>
                    )
                  })}
                </div>
              ) : null}
              <div className="preset-prompt">
                <pre>{promptText}</pre>
                {filled.missing.length ? (
                  <em>还有 {filled.missing.length} 个变量没填，会保持 {'{变量}'} 原样</em>
                ) : null}
                {adapted ? <span className="preset-adapted">已按当前模型改写</span> : null}
              </div>
            </div>

            <div className="preset-detail-section">
              <div className="preset-detail-label">出图参数</div>
              <div className="preset-params">
                <label>
                  <span>供应商</span>
                  <select value={provider} onChange={(event) => changeProvider(event.target.value)}>
                    {providers.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>模型</span>
                  <select value={model} onChange={(event) => setModel(event.target.value)}>
                    {(providerView?.models || []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>比例</span>
                  <select
                    value={ratio}
                    onChange={(event) => {
                      setRatio(event.target.value)
                      setAdapted(null)
                    }}
                    disabled={!modelView}
                  >
                    {(modelView?.ratios || ['1:1']).map((item) => (
                      <option key={item} value={item}>
                        {item} {RATIO_LABEL[item] || ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>清晰度</span>
                  <select
                    value={resolution}
                    onChange={(event) => setResolution(event.target.value)}
                    disabled={!modelView}
                  >
                    {(modelView?.resolutions || ['2K']).map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>张数</span>
                  <select value={count} onChange={(event) => setCount(Number(event.target.value))}>
                    {Array.from({ length: modelView?.countMax || 4 }, (_, index) => index + 1).map(
                      (item) => (
                        <option key={item} value={item}>
                          {item} 张
                        </option>
                      )
                    )}
                  </select>
                </label>
              </div>
              {promptRatio && open && promptRatio !== open.ratio ? (
                <p className="preset-note">
                  提示词里写的是 {promptRatio}，示例图是 {RATIO_LABEL[open.ratio] || open.ratio}
                  的；已按提示词预选，改比例时会同步改写提示词里那句。
                </p>
              ) : null}
              {!providerView?.hasKey ? (
                <button className="preset-key-warn" onClick={onOpenSettings}>
                  {providerView?.name || provider} 还没填 Key，点这里去设置
                </button>
              ) : null}
            </div>

            <div className="preset-actions">
              <button className="btn primary" onClick={() => use('chat')} disabled={!canRun}>
                <Wand2 size={15} /> 在对话里使用
              </button>
              <button
                className="btn"
                onClick={() => use('generate')}
                disabled={!canRun || needsRefBlocked}
                title={needsRefBlocked ? '这条需要参考图，请先带进对话' : '按这条预设直接生成'}
              >
                <Sparkles size={15} /> 直接生成
              </button>
              <div className="preset-actions-row">
                <button className="btn ghost" onClick={() => void adapt()} disabled={adapting}>
                  {adapting ? <Loader2 className="spin" size={14} /> : <ArrowRight size={14} />}
                  适配当前模型
                </button>
                <button className="btn ghost" onClick={() => void install()} disabled={installing}>
                  {installing ? <Loader2 className="spin" size={14} /> : <Check size={14} />}
                  装进风格库
                </button>
              </div>
              {needsRefBlocked ? (
                <p className="preset-hint">
                  提示词里要求「附件中的图片」：先在对话里拖入参考图，再用这条预设。
                </p>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>

      {specModal}
      {removeOpen ? (
        <Modal
          title="移除素材库"
          subtitle="这只影响本机的用户素材库"
          onClose={() => setRemoveOpen(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setRemoveOpen(false)}>
                取消
              </button>
              <button className="btn danger" onClick={() => void removeLibrary()}>
                <Trash2 size={14} /> 移除
              </button>
            </>
          }
        >
          <p className="preset-remove-copy">
            移除后，用户导入的 {catalog.count} 条素材与示例图会从这台电脑删除。
            {catalog.origin === 'user' ? ' 如果安装包自带内置素材库，会自动切回内置库。' : ''}
            收藏和最近使用记录保留，重新导入同一个库时会接上。
          </p>
        </Modal>
      ) : null}
    </div>
  )
}
