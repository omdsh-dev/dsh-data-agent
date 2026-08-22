import type { DataAgentKey } from './locales.ts';
type T = (key: DataAgentKey, values?: Record<string, string | number>) => string;
interface CatalogPanelProps {
    id: string;
    labelledBy: string;
    active: boolean;
    sessionId: string;
    connected: boolean;
    connectionProfileId?: string;
    stateKey: object;
    t: T;
    onAvailabilityChange(available: boolean): void;
}
export declare function CatalogPanel(props: CatalogPanelProps): import("react").JSX.Element;
export {};
