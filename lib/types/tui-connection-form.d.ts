/**
 * Short-lived ANSI connection form used by `/database connect` in dsh-tui.
 *
 * dsh-tui 0.6.x exposes commands but no public custom-form/sensitive-input
 * slot. This adapter therefore owns a small terminal form and only activates
 * after the command adapter has detected an active `dsh-tui` runtime. It
 * snapshots the host's `readable` listeners, consumes input for the lifetime
 * of the form, then restores the listeners exactly. It never imports dsh-tui,
 * React, or Ink.
 * @module @yejiming/dsh-data-agent/tui-connection-form
 */
import { type ConnectionFormDraft, type ConnectionFormInitial, type DatabaseConnectionInput } from './connections.ts';
import { type DatabaseType } from './database-types.ts';
export declare const TUI_DATABASE_TYPES: readonly ["mysql", "postgres", "sqlite", "oracle", "hive", "impala", "clickhouse", "doris", "sqlserver"];
export type TuiConnectionField = 'type' | 'host' | 'port' | 'user' | 'database' | 'password' | 'passwordRef' | 'secure' | 'readonly' | 'confirm' | 'cancel';
export interface TuiConnectionFormState {
    type: DatabaseType;
    host: string;
    port: string;
    user: string;
    database: string;
    password: string;
    passwordRef: string;
    secure: boolean;
    readonly: boolean;
    focus: TuiConnectionField;
    cursor: number;
    selector?: {
        field: 'type' | 'readonly' | 'secure';
        index: number;
    };
    error?: string;
}
export type TuiFormKey = {
    name: 'text';
    text: string;
} | {
    name: 'tab' | 'backtab' | 'enter' | 'escape' | 'backspace' | 'delete';
} | {
    name: 'left' | 'right' | 'up' | 'down' | 'home' | 'end' | 'space';
};
export type TuiFormTransition = {
    kind: 'editing';
    state: TuiConnectionFormState;
} | {
    kind: 'submitted';
    state: TuiConnectionFormState;
    input: DatabaseConnectionInput;
} | {
    kind: 'cancelled';
    state: TuiConnectionFormState;
};
type StreamListener = (...args: unknown[]) => void;
export interface TuiFormInput {
    isTTY?: boolean;
    isRaw?: boolean;
    read(): unknown;
    listeners(event: string): Function[];
    on(event: string, listener: StreamListener): unknown;
    emit?(event: string): unknown;
    push?(value: string): unknown;
    removeListener(event: string, listener: StreamListener): unknown;
    setRawMode?(mode: boolean): unknown;
    ref?(): unknown;
}
export interface TuiFormOutput {
    isTTY?: boolean;
    columns?: number;
    write(value: string): unknown;
    on?(event: string, listener: StreamListener): unknown;
    removeListener?(event: string, listener: StreamListener): unknown;
    emit?(event: string): unknown;
}
export interface RunTuiConnectionFormOptions {
    input?: TuiFormInput;
    output?: TuiFormOutput;
    signal?: AbortSignal;
    initialDraft?: ConnectionFormInitial;
    persistDraft?: (draft: ConnectionFormDraft) => void | Promise<void>;
}
/** Initial form intentionally leaves host/port empty so placeholders are real defaults. */
export declare function createTuiConnectionFormState(initialDraft?: ConnectionFormInitial): TuiConnectionFormState;
/** Project form state onto the only values allowed to cross the durable seam. */
export declare function connectionFormDraft(state: TuiConnectionFormState): ConnectionFormDraft;
/** Relevant focus order for the selected database kind. */
export declare function tuiConnectionFields(type: DatabaseType): readonly TuiConnectionField[];
/** Default network port shown as a placeholder and applied only at submit time. */
export declare function defaultDatabasePort(type: Exclude<DatabaseType, 'sqlite'>, secure?: boolean): number;
/**
 * Check only terminal capability. The command adapter already proves that the
 * actual dsh-tui plugin is loaded before it exposes `/database`; repeating a
 * profile-name or argv heuristic here would reject custom profiles that use
 * dsh-tui and admit profiles that merely happen to be named `dsh-tui`.
 */
export declare function isDshTuiTerminal(input?: Pick<TuiFormInput, 'isTTY'>, output?: Pick<TuiFormOutput, 'isTTY'>): boolean;
/** Pure keyboard reducer, kept separate from terminal ownership for regression tests. */
export declare function updateTuiConnectionForm(current: TuiConnectionFormState, key: TuiFormKey): TuiFormTransition;
/** Rendered value is masked before it reaches the ANSI string. */
export declare function renderTuiConnectionForm(state: TuiConnectionFormState, columns?: number): string;
/**
 * Own the terminal only for the form lifetime. `undefined` means user cancel.
 * The returned password has never crossed stdout, argv, env, or a DSH event.
 */
export declare function runTuiConnectionForm(options?: RunTuiConnectionFormOptions): Promise<DatabaseConnectionInput | undefined>;
/** Decode the keyboard subset owned by the form; unknown terminal reports are ignored. */
export declare function decodeTuiFormInput(value: string): TuiFormKey[];
export {};
