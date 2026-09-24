import { expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'

vi.mock('../src/client/DataAgentWorkbench.tsx', () => ({ DataAgentWorkbench: () => null }))
vi.mock('../src/client/DataAgentHeroControls.tsx', () => ({ DataAgentHeroControls: () => null }))
vi.mock('../src/client/AnalysisDashboard.tsx', () => ({ RenderAnalysisRow: () => null }))

it('forwards the seat session id and host hooks, then removes its wrapper on disposal', () => {
  const face = { hooks: { agentPresetSeat: {}, showPresetPicker: {} }, select: vi.fn() }
  const hostInject = vi.fn(() => face)
  const host = { component: () => null, options: { priority: 0 }, inject: hostInject }
  const disposers: (() => void)[] = []
  const entries = [host]
  const own = (effect: () => (() => void) | void) => {
    const dispose = effect()
    if (dispose) disposers.push(dispose)
  }
  const ctx = {
    effect: own,
    locale: { register: () => () => {}, bind: () => (key: string) => key },
    sessions: { list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} } },
    uiWorkspace: { startSession: vi.fn() },
    inject: (_keys: string[], fn: (scope: unknown) => void) => fn(ctx),
    slots: {
      inject: (_name: string, effect: () => () => void) => own(effect),
      entries: () => entries,
      subscribe: () => () => {},
      register: (options: typeof host.options & { name: string; inject?: typeof hostInject }, component: typeof host.component) => {
        if (options.name !== 'conversation.hero.agentPreset') return () => {}
        const entry = { component, options, inject: options.inject! }
        entries.push(entry)
        return () => { entries.splice(entries.indexOf(entry), 1) }
      },
    },
  }
  apply(ctx as never)
  expect(entries).toHaveLength(2)
  const inject = entries[1]!.inject as unknown as (sessionId?: string) => typeof face
  const scopedFace = inject('session-fixture')
  expect(hostInject).toHaveBeenLastCalledWith('session-fixture')
  expect(scopedFace.select).toBe(face.select)
  expect(scopedFace.hooks.agentPresetSeat).toBe(face.hooks.agentPresetSeat)
  expect(scopedFace.hooks.showPresetPicker).toBe(face.hooks.showPresetPicker)
  inject(undefined)
  expect(hostInject).toHaveBeenLastCalledWith(undefined)
  for (const dispose of disposers.reverse()) dispose()
  expect(entries).toEqual([host])
})
