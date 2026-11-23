import { useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown, ChevronUp, RefreshCw, Sparkles, Wand2 } from 'lucide-react'
import { useApp } from '../store'
import type { Message, Plan, Session } from '../types'

const Label = ({ children }: { children: ReactNode }) => (
  <span className="tiny-label">{children}</span>
)

export function PlanCard({
  message,
  session,
  onStart,
  onReplan,
  busy,
}: {
  message: Message
  session: Session
  onStart: (messageId: string) => void
  onReplan: (messageId: string) => void
  busy: boolean
}) {
  const [open, setOpen] = useState(true)
  const catalog = useApp((s) => s.catalog)
  const styles = useApp((s) => s.styles)
  const patchMessage = useApp((s) => s.patchMessage)

  const plan = message.plan
  if (!plan) return null

  const provider = catalog.find((p) => p.id === plan.provider) || catalog[0]
  const model = provider?.models.find((m) => m.id === plan.model) || provider?.models[0]
  const style = styles.find((s) => s.id === plan.styleId)

  const update = (patch: Partial<Plan>) => {
    patchMessage(session.id, message.id, { plan: { ...plan, ...patch } })
  }

  const changeProvider = (providerId: string) => {
    const next = catalog.find((p) => p.id === providerId)
    if (!next) return
    const nextModel = next.models.find((m) => m.id === next.defaultModel) || next.models[0]
    if (!nextModel) return
    update({
      provider: next.id,
      model: nextModel.id,
      resolution: nextModel.resolutions.includes(plan.resolution)
        ? plan.resolution
        : nextModel.defaultResolution,
      ratio: nextModel.ratios.includes(plan.ratio) ? plan.ratio : '1:1',
      seed: nextModel.seed ? plan.seed : null,
      count: Math.min(plan.count, nextModel.countMax),
    })
  }

  const changeModel = (modelId: string) => {
    if (!provider) return
    const next = provider.models.find((m) => m.id === modelId)
    if (!next) return
    update({
      model: next.id,
      resolution: next.resolutions.includes(plan.resolution)
        ? plan.resolution
        : next.defaultResolution,
      ratio: next.ratios.includes(plan.ratio) ? plan.ratio : '1:1',
      seed: next.seed ? plan.seed : null,
      count: Math.min(plan.count, next.countMax),
    })
  }

  const running = message.planStatus === 'running'
  const recommended = plan.recommended
  const recommendedProvider = recommended
    ? catalog.find((p) => p.id === recommended.provider)
    : null
  const recommendedDiffers =
    Boolean(recommended) &&
    (plan.provider !== recommended!.provider ||
      plan.ratio !== recommended!.ratio ||
      plan.resolution !== recommended!.resolution ||
      plan.count !== recommended!.count)

  const applyRecommended = () => {
    if (!recommended) return
    const nextProvider = catalog.find((p) => p.id === recommended.provider)
    if (!nextProvider) return
    const nextModel =
      nextProvider.models.find((m) => m.id === nextProvider.defaultModel) || nextProvider.models[0]
    if (!nextModel) return
    update({
      provider: nextProvider.id,
      model: nextModel.id,
      ratio: nextModel.ratios.includes(recommended.ratio)
        ? recommended.ratio
        : '1:1',
      resolution: nextModel.resolutions.includes(recommended.resolution)
        ? recommended.resolution
        : nextModel.defaultResolution || '2K',
      count: Math.min(recommended.count, nextModel.countMax),
      seed: nextModel.seed ? plan.seed : null,
    })
  }

  return (
    <div className={`plan-card ${running ? 'is-running' : ''}`}>
      <div className="plan-head">
        <div className="plan-title">
          <span className="plan-icon">
            <Wand2 size={16} />
          </span>
          <div>
            <strong>生图文案</strong>
            <span>
              {plan.fallback ? '已按现有对话生成草稿' : '由 DeepSeek 整理，可继续修改'}
              {style ? ` · ${style.name}` : ''}
            </span>
          </div>
        </div>
        <button className="ghost-link" onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          {open ? '收起' : '展开'}
        </button>
      </div>

      {open ? (
        <>
          <label className="plan-field">
            <Label>标题</Label>
            <input
              value={plan.title}
              onChange={(event) => update({ title: event.target.value })}
              placeholder="给这张图起个名字"
            />
          </label>

          <label className="plan-field">
            <Label>画面描述</Label>
            <textarea
              rows={4}
              value={plan.prompt}
              onChange={(event) => update({ prompt: event.target.value })}
              placeholder="描述你想生成的画面"
            />
            <span className="plan-count">{plan.prompt.length} 字</span>
          </label>

          <div className="plan-grid">
            <label>
              <Label>供应商</Label>
              <select value={plan.provider} onChange={(event) => changeProvider(event.target.value)}>
                {catalog.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <Label>模型</Label>
              <select value={plan.model} onChange={(event) => changeModel(event.target.value)}>
                {(provider?.models || []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <Label>比例</Label>
              <select
                value={plan.ratio}
                onChange={(event) => update({ ratio: event.target.value })}
              >
                {(model?.ratios || ['1:1']).map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <Label>清晰度</Label>
              <select
                value={plan.resolution}
                onChange={(event) => update({ resolution: event.target.value })}
              >
                {(model?.resolutions || ['2K']).map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <Label>张数</Label>
              <select
                value={plan.count}
                onChange={(event) => update({ count: Number(event.target.value) })}
              >
                {Array.from({ length: model?.countMax || 1 }, (_, index) => index + 1).map((n) => (
                  <option key={n} value={n}>
                    {n} 张
                  </option>
                ))}
              </select>
            </label>

            {model?.seed ? (
              <label>
                <Label>种子（可选）</Label>
                <input
                  type="number"
                  min={0}
                  placeholder="留空随机"
                  value={plan.seed ?? ''}
                  onChange={(event) =>
                    update({
                      seed: event.target.value === '' ? null : Math.max(0, Number(event.target.value)),
                    })
                  }
                />
              </label>
            ) : null}
          </div>

          {recommended && recommendedDiffers ? (
            <div className="plan-recommend">
              <Sparkles size={13} />
              <span>
                推荐 {recommendedProvider?.name || recommended.provider} · {recommended.ratio} ·{' '}
                {recommended.resolution} · {recommended.count} 张
              </span>
              <button className="ghost-link" onClick={applyRecommended}>
                应用
              </button>
            </div>
          ) : null}

          {style ? (
            <div className="plan-style">
              <Sparkles size={13} />
              风格约束：{style.name}
              <button className="ghost-link" onClick={() => update({ styleId: null })}>
                移除
              </button>
            </div>
          ) : null}

          {plan.notes ? <p className="plan-notes">{plan.notes}</p> : null}

          <div className="plan-foot">
            <button
              className="button button-quiet"
              disabled={busy || running}
              onClick={() => onReplan(message.id)}
            >
              <RefreshCw size={15} />
              重新整理
            </button>
            <div className="plan-foot-right">
              <span className="plan-meta">
                同步接口 · {plan.resolution} · {plan.count} 张
              </span>
              <button
                className="button button-primary"
                disabled={busy || running || !plan.prompt.trim()}
                onClick={() => onStart(message.id)}
              >
                <Sparkles size={15} />
                开始生成
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
