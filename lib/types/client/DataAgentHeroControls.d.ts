import type { ComponentType } from 'react';
import type { AgentPresetSeatProps, AgentPresetSeatState } from '@deepseek-ai/dsh-client-ui-agent-preset/client';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import { type ObservableSnapshot, type WorkbenchOpenSnapshot } from './workbench-open.ts';
export interface DataAgentHeroControlsInjected {
    /** The host entry shadowed by this additive wrapper. */
    originalSeat: ComponentType<AgentPresetSeatProps>;
    /** Data-agent copy; the slot's own `t` remains bound to agent-preset copy. */
    dataAgentT: TranslateNS<'data-agent'>;
    requestWorkbench(): void;
    useHeroWorkbench: <T>(selector: (snapshot: WorkbenchOpenSnapshot) => T) => T;
}
export type DataAgentHeroControlsProps = AgentPresetSeatProps & DataAgentHeroControlsInjected;
/** Render the original preset picker plus the database entry for data-agent. */
export declare function DataAgentHeroControls(props: DataAgentHeroControlsProps): import("react").JSX.Element;
/** Structural type of the host preset entry's raw inject face. */
export interface HostAgentPresetSeatFace {
    hooks: {
        agentPresetSeat: ObservableSnapshot<AgentPresetSeatState>;
    };
    load(): Promise<void>;
    select(id: string): Promise<string | undefined>;
    introduced(): void;
}
