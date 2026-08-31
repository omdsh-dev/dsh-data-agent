/**
 * Alpha.2 New Session compatibility surface.
 *
 * The host's agent-preset seat owns the staged selection. This component
 * preserves that seat verbatim and adds the database entry only while the
 * staged preset is `data-agent`.
 */
import { useLayoutEffect, useRef } from 'react'
import type { ComponentType } from 'react'
import type { AgentPresetSeatProps, AgentPresetSeatState } from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import { IconDataOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: contributes the alpha.2 useSessions global slot prop.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { DataAgentKey } from './locales.ts'
import { DATA_AGENT_PRESET, type ObservableSnapshot, type WorkbenchOpenSnapshot } from './workbench-open.ts'
import { overrideComposerPlaceholder } from './workbench-placeholder.ts'
import css from './DataAgentWorkbench.module.css'

export interface DataAgentHeroControlsInjected {
  /** The host entry shadowed by this additive wrapper. */
  originalSeat: ComponentType<AgentPresetSeatProps>
  /** Data-agent copy; the slot's own `t` remains bound to agent-preset copy. */
  dataAgentT: TranslateNS<'data-agent'>
  requestWorkbench(): void
  useHeroWorkbench: <T>(selector: (snapshot: WorkbenchOpenSnapshot) => T) => T
}

export type DataAgentHeroControlsProps = AgentPresetSeatProps & DataAgentHeroControlsInjected

/** Render the original preset picker plus the database entry for data-agent. */
export function DataAgentHeroControls(props: DataAgentHeroControlsProps) {
  const {
    originalSeat: OriginalSeat,
    dataAgentT,
    requestWorkbench,
    useHeroWorkbench,
    useAgentPresetSeat,
  } = props
  const preset = useAgentPresetSeat((state: AgentPresetSeatState) => state.current)
  const currentSessionId = props.useSessions((state: { current?: string }) => state.current)
  const pending = useHeroWorkbench(state => state.pending)
  const triggerLabel = dataAgentT('workbench.open.disconnected' as DataAgentKey)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const showHeroWorkbench = preset === DATA_AGENT_PRESET && currentSessionId === undefined

  // The no-Session composer bar exposes no placeholder prop to root entries.
  // Walk upward only until this hero row and its sibling composer card share
  // an ancestor, then restore the host's Lexical copy on cleanup.
  useLayoutEffect(() => {
    if (!showHeroWorkbench) return
    let scope = triggerRef.current?.parentElement ?? null
    let card: HTMLElement | null = null
    while (scope !== null && card === null) {
      card = scope.querySelector<HTMLElement>('[data-composer-card]')
      scope = scope.parentElement
    }
    const placeholder = dataAgentT('composer.placeholder.disconnected' as DataAgentKey)
    return overrideComposerPlaceholder(card, placeholder)
  }, [dataAgentT, showHeroWorkbench])

  return (
    <>
      <OriginalSeat {...props} />
      {showHeroWorkbench && (
        <Tooltip label={triggerLabel} side="top" delayMs={400}>
          <button
            type="button"
            ref={triggerRef}
            className={css.heroTrigger}
            aria-label={triggerLabel}
            disabled={pending}
            onClick={requestWorkbench}
          >
            <IconDataOutline16 size={17} />
            <span>{pending ? dataAgentT('state.checking' as DataAgentKey) : dataAgentT('action.config' as DataAgentKey)}</span>
          </button>
        </Tooltip>
      )}
    </>
  )
}

/** Structural type of the host preset entry's raw inject face. */
export interface HostAgentPresetSeatFace {
  hooks: {
    agentPresetSeat: ObservableSnapshot<AgentPresetSeatState>
  }
  load(): Promise<void>
  select(id: string): Promise<string | undefined>
  introduced(): void
}
