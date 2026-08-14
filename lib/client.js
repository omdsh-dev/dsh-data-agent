window.__ModuleLoader__.load({
	id: "@yejiming/dsh-data-agent",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/persistence.ts
		/** localStorage key holding the most recent connection configuration. */
		const CONNECTION_STORAGE_KEY = "dsh-data-agent.connection.v1";
		/** The default storage face (localStorage; unavailable → degraded no-op). */
		function defaultStorage() {
			try {
				if (typeof localStorage !== "undefined") {
					const probe = "__dsh_probe__";
					localStorage.setItem(probe, "1");
					localStorage.removeItem(probe);
					return localStorage;
				}
			} catch {}
		}
		/** Validate one parsed storage value into a SavedConnection (or null). */
		function parseSaved(value) {
			if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
			const candidate = value;
			const type = candidate.type;
			if (type !== "mysql" && type !== "postgres" && type !== "sqlite" && type !== "oracle" && type !== "hive" && type !== "impala") return null;
			const database = candidate.database;
			if (typeof database !== "string") return null;
			const saved = {
				type,
				database,
				savedAt: typeof candidate.savedAt === "string" ? candidate.savedAt : ""
			};
			if (typeof candidate.host === "string") saved.host = candidate.host;
			if (typeof candidate.port === "number" && Number.isInteger(candidate.port)) saved.port = candidate.port;
			if (typeof candidate.user === "string") saved.user = candidate.user;
			if (typeof candidate.password === "string") saved.password = candidate.password;
			return saved;
		}
		/** Save one connection configuration (best-effort; storage failures degrade silently). */
		function saveConnection(connection, storage = defaultStorage()) {
			if (storage === void 0) return;
			try {
				storage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(connection));
			} catch {}
		}
		/** Load the saved connection configuration; null when absent or malformed. */
		function loadConnection(storage = defaultStorage()) {
			if (storage === void 0) return null;
			try {
				const raw = storage.getItem(CONNECTION_STORAGE_KEY);
				if (raw === null) return null;
				return parseSaved(JSON.parse(raw));
			} catch {
				return null;
			}
		}
		//#endregion
		//#region \0dsh-css:/Users/yejiming/Desktop/OpenSource/dsh-data-agent/src/client/DataAgentWorkbench.module.css.mjs
		const css = ".Sv3uVW_workbench{box-sizing:border-box;font-family:var(--dsw-font-family,-apple-system, BlinkMacSystemFont, \"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif);color:var(--dsw-alias-label-primary,inherit);flex-direction:column;gap:10px;font-size:13px;line-height:1.5;display:flex}.Sv3uVW_strip{width:100%}.Sv3uVW_docked{width:100%;max-height:55vh;overflow-y:auto}.Sv3uVW_rail{z-index:8;border-right:1px solid var(--dsw-alias-border-l2,#80808059);background:var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-layer-1,#ffffff08));padding:12px;overflow-y:auto}html.Sv3uVW_da-split [data-phase=active] [data-conversation-scroll]>:first-child{margin-left:380px}html.Sv3uVW_da-split [data-phase=active] [data-composer-seat]{padding-left:380px}.Sv3uVW_sections{flex-direction:column;gap:12px;display:flex}.Sv3uVW_card{border:1px solid var(--dsw-alias-border-l2,#80808059);border-radius:12px;flex-direction:column;gap:10px;padding:12px 14px;display:flex}.Sv3uVW_cardTitle{text-transform:uppercase;letter-spacing:.06em;color:var(--dsw-alias-label-tertiary,#808080b3);align-items:center;gap:6px;font-size:11px;font-weight:600;display:flex}.Sv3uVW_titleIcon{width:14px;height:14px;color:var(--dsw-alias-label-secondary,#808080cc);flex:none}.Sv3uVW_fieldGrid{flex-direction:column;gap:10px;display:flex}.Sv3uVW_fieldRow2{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;display:grid}.Sv3uVW_field{flex-direction:column;gap:4px;min-width:0;display:flex}.Sv3uVW_label{color:var(--dsw-alias-label-secondary,#808080b3);font-size:11px;font-weight:500}.Sv3uVW_input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,#80808059);background:var(--dsw-alias-bg-layer-2,#ffffff0a);width:100%;height:32px;color:var(--dsw-alias-label-primary,inherit);font:inherit;border-radius:8px;padding:0 10px;font-size:13px;transition:border-color .15s ease-out,box-shadow .15s ease-out}.Sv3uVW_input::placeholder{color:var(--dsw-alias-label-caption,#80808080)}.Sv3uVW_input:focus-visible,.Sv3uVW_input:focus{border-color:var(--dsw-alias-button-info-fill,#3b82f6);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-button-info-fill,#3b82f6) 18%, transparent);outline:none}.Sv3uVW_input:disabled{opacity:.55}select.Sv3uVW_input{-webkit-appearance:none;appearance:none;cursor:pointer;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' fill='none' stroke='%23777' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\");background-position:right 10px center;background-repeat:no-repeat;padding-right:28px}.Sv3uVW_actions{align-items:center;gap:8px;margin-top:2px;display:flex}.Sv3uVW_actions>.Sv3uVW_primary,.Sv3uVW_actions>.Sv3uVW_ghost{flex:1}.Sv3uVW_primary,.Sv3uVW_ghost{height:32px;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;justify-content:center;align-items:center;gap:6px;padding:0 14px;font-size:13px;font-weight:500;transition:background-color .15s ease-out,border-color .15s ease-out,opacity .15s ease-out;display:inline-flex}.Sv3uVW_primary{background:var(--dsw-alias-button-info-fill,#3b82f6);color:#fff}.Sv3uVW_primary:hover:not(:disabled){background:var(--dsw-alias-button-info-hover,#3573e0)}.Sv3uVW_primary:active:not(:disabled){background:var(--dsw-static-deepseek-600,#2f5fc0)}.Sv3uVW_ghost{border-color:var(--dsw-alias-border-l2,#80808059);color:var(--dsw-alias-label-primary,inherit);background:0 0}.Sv3uVW_ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#80808014)}.Sv3uVW_ghost:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active,#80808024)}.Sv3uVW_primary:focus-visible,.Sv3uVW_ghost:focus-visible{box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-button-info-fill,#3b82f6) 25%, transparent);outline:none}.Sv3uVW_primary:disabled,.Sv3uVW_ghost:disabled{opacity:.45;cursor:default}.Sv3uVW_small{border-radius:6px;height:24px;padding:0 10px;font-size:12px}.Sv3uVW_hint{color:var(--dsw-alias-label-tertiary,#80808099);font-size:12px}.Sv3uVW_summaryRow{align-items:center;gap:8px;min-height:28px;display:flex}.Sv3uVW_statusOk{color:var(--dsw-alias-state-success-primary,#22c55e);flex:none;align-items:center;gap:5px;font-size:12px;font-weight:500;display:inline-flex}.Sv3uVW_summaryType{border:1px solid var(--dsw-alias-border-l2,#80808059);background:var(--dsw-alias-bg-layer-2,#ffffff0a);font-family:var(--ds-font-family-code,ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);color:var(--dsw-alias-label-secondary,#808080cc);border-radius:999px;flex:none;padding:2px 8px;font-size:11px}.Sv3uVW_summaryDb{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-family:var(--ds-font-family-code,ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);flex:1;font-size:12px;overflow:hidden}.Sv3uVW_summaryActions{flex:none;gap:6px;display:flex}.Sv3uVW_browseRow{border:1px solid var(--dsw-alias-border-l2,#80808059);background:var(--dsw-alias-bg-layer-2,#ffffff0a);width:100%;height:36px;color:var(--dsw-alias-label-primary,inherit);font:inherit;text-align:left;cursor:pointer;border-radius:8px;align-items:center;gap:8px;padding:0 12px;font-size:13px;font-weight:500;transition:background-color .15s ease-out,border-color .15s ease-out;display:flex}.Sv3uVW_browseRow:hover{background:var(--dsw-alias-interactive-bg-hover,#80808014);border-color:var(--dsw-alias-border-l3,#80808080)}.Sv3uVW_browseRow:focus-visible{border-color:var(--dsw-alias-button-info-fill,#3b82f6);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-button-info-fill,#3b82f6) 18%, transparent);outline:none}.Sv3uVW_browseIcon{width:14px;height:14px;color:var(--dsw-alias-button-info-fill,#3b82f6);flex:none}.Sv3uVW_browseChevron{width:12px;height:12px;color:var(--dsw-alias-label-tertiary,#80808099);flex:none;margin-left:auto}.Sv3uVW_sqlInput{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,#80808059);background:var(--dsw-alias-bg-layer-2,#ffffff0a);width:100%;min-height:190px;color:var(--dsw-alias-label-primary,inherit);font-family:var(--ds-font-family-code,ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);resize:vertical;border-radius:10px;padding:10px 12px;font-size:12.5px;line-height:1.6;transition:border-color .15s ease-out,box-shadow .15s ease-out}.Sv3uVW_sqlInput::placeholder{color:var(--dsw-alias-label-caption,#80808080)}.Sv3uVW_sqlInput:focus-visible,.Sv3uVW_sqlInput:focus{border-color:var(--dsw-alias-button-info-fill,#3b82f6);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-button-info-fill,#3b82f6) 18%, transparent);outline:none}.Sv3uVW_sqlInput:disabled{opacity:.55}.Sv3uVW_sqlActions{justify-content:flex-end;align-items:center;gap:10px;display:flex}.Sv3uVW_sqlActions .Sv3uVW_primary{flex:none;min-width:92px}.Sv3uVW_shortcutHint{color:var(--dsw-alias-label-caption,#80808080);font-size:11.5px}.Sv3uVW_sqlResult{border:1px solid var(--dsw-alias-border-l1,#80808033);background:var(--dsw-alias-markdown-code-block,#ffffff0a);font-family:var(--ds-font-family-code,ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);white-space:pre-wrap;word-break:break-word;border-radius:8px;max-height:200px;margin:0;padding:10px 12px;font-size:11.5px;line-height:1.55;overflow-y:auto}.Sv3uVW_errorBar{border:1px solid var(--dsw-alias-state-error-secondary,#ef444480);background:var(--dsw-alias-interactive-bg-hover-danger,#ef444414);border-radius:10px;flex-direction:column;gap:3px;padding:10px 12px;display:flex}.Sv3uVW_errorHead{color:var(--dsw-alias-state-error-primary,#ef4444);align-items:center;gap:6px;font-size:12px;font-weight:600;display:flex}.Sv3uVW_errorIcon{flex:none;width:14px;height:14px}.Sv3uVW_errorText{white-space:pre-wrap;word-break:break-word;font-size:12px}.Sv3uVW_schemaModal{width:min(900px,94vw)}.Sv3uVW_modalBody{align-items:stretch;gap:20px;height:min(540px,58vh);display:flex}.Sv3uVW_modalCol{flex-direction:column;flex:1;gap:8px;min-width:0;min-height:0;display:flex}.Sv3uVW_modalColTitle{text-transform:uppercase;letter-spacing:.06em;color:var(--dsw-alias-label-tertiary,#808080b3);flex:none;align-items:center;gap:6px;font-size:11px;font-weight:600;display:flex}.Sv3uVW_colCount{border:1px solid var(--dsw-alias-border-l1,#80808033);background:var(--dsw-alias-bg-layer-2,#ffffff0a);color:var(--dsw-alias-label-secondary,#808080cc);border-radius:999px;flex:none;padding:1px 7px;font-size:10px;font-weight:500}.Sv3uVW_treeScroll{flex:1;min-height:0;padding-right:4px;overflow-y:auto}.Sv3uVW_tree{flex-direction:column;gap:1px;margin:0;padding:0;list-style:none;display:flex}.Sv3uVW_treeNode{flex-direction:column;display:flex}.Sv3uVW_treeItem{width:100%;min-height:28px;color:var(--dsw-alias-label-primary,inherit);font:inherit;text-align:left;cursor:pointer;background:0 0;border:none;border-radius:7px;align-items:center;gap:6px;padding:0 8px;font-size:12.5px;display:flex}.Sv3uVW_treeItem:hover{background:var(--dsw-alias-interactive-bg-hover,#80808014)}.Sv3uVW_treeItem.Sv3uVW_active,.Sv3uVW_treeItem.Sv3uVW_active:hover{background:var(--dsw-alias-interactive-bg-active,#3b82f62e)}.Sv3uVW_treeChevron{width:12px;height:12px;color:var(--dsw-alias-label-tertiary,#80808099);flex:none;transition:transform .15s ease-out}.Sv3uVW_treeChevron.Sv3uVW_open{transform:rotate(90deg)}.Sv3uVW_treeIcon{width:14px;height:14px;color:var(--dsw-alias-label-secondary,#808080cc);flex:none}.Sv3uVW_treeItem.Sv3uVW_active .Sv3uVW_treeIcon{color:var(--dsw-alias-button-info-fill,#3b82f6)}.Sv3uVW_treeName{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-family:var(--ds-font-family-code,ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);flex:1;font-size:12px;overflow:hidden}.Sv3uVW_treeCount{border:1px solid var(--dsw-alias-border-l1,#80808033);background:var(--dsw-alias-bg-layer-2,#ffffff0a);color:var(--dsw-alias-label-secondary,#808080cc);border-radius:999px;flex:none;padding:0 6px;font-size:10px}.Sv3uVW_treeChildren{border-left:1px solid var(--dsw-alias-border-l2,#80808059);flex-direction:column;gap:1px;margin-left:12px;padding-left:10px;display:flex}.Sv3uVW_colScroll{border:1px solid var(--dsw-alias-border-l1,#80808033);border-radius:8px;flex:1;min-height:0;overflow:auto}.Sv3uVW_columnsTable{border-collapse:collapse;width:100%;font-family:var(--ds-font-family-code,ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);font-size:12px}.Sv3uVW_columnsTable th{z-index:1;text-align:left;text-transform:uppercase;letter-spacing:.05em;color:var(--dsw-alias-label-tertiary,#808080b3);background:var(--dsw-alias-bg-layer-2,#ffffff0a);border-bottom:1px solid var(--dsw-alias-border-l2,#80808059);padding:7px 10px;font-size:10.5px;font-weight:600;position:sticky;top:0}.Sv3uVW_columnsTable td{border-bottom:1px solid var(--dsw-alias-border-l1,#80808033);color:var(--dsw-alias-label-primary,inherit);padding:5px 10px}.Sv3uVW_columnsTable tbody tr:hover td{background:var(--dsw-alias-interactive-bg-hover,#80808014)}.Sv3uVW_typeCell{color:var(--dsw-alias-label-secondary,#808080cc)}.Sv3uVW_nullCell{color:var(--dsw-alias-label-caption,#80808080);font-size:11px}.Sv3uVW_emptyState{border:1px dashed var(--dsw-alias-border-l2,#80808059);min-height:0;color:var(--dsw-alias-label-tertiary,#808080b3);border-radius:8px;flex-direction:column;flex:1;justify-content:center;align-items:center;gap:8px;display:flex}.Sv3uVW_emptyStateIcon{width:20px;height:20px;color:var(--dsw-alias-label-dimmed,#80808066)}.Sv3uVW_emptyStateText{font-size:12px}.Sv3uVW_modalHint{color:var(--dsw-alias-label-caption,#80808080);flex:none;align-items:center;gap:6px;margin-top:2px;font-size:11.5px;display:flex}@media (width<=640px){.Sv3uVW_modalBody{flex-direction:column;height:auto}.Sv3uVW_treeScroll{flex:none;height:300px}.Sv3uVW_colScroll{flex:none;height:240px}.Sv3uVW_emptyState{flex:none;height:120px}}";
		const tagId = "@yejiming/dsh-data-agent/DataAgentWorkbench.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@yejiming/dsh-data-agent";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var DataAgentWorkbench_module_css_default = {
			"small": "Sv3uVW_small",
			"treeCount": "Sv3uVW_treeCount",
			"sqlActions": "Sv3uVW_sqlActions",
			"statusOk": "Sv3uVW_statusOk",
			"colScroll": "Sv3uVW_colScroll",
			"ghost": "Sv3uVW_ghost",
			"summaryType": "Sv3uVW_summaryType",
			"summaryActions": "Sv3uVW_summaryActions",
			"browseRow": "Sv3uVW_browseRow",
			"errorIcon": "Sv3uVW_errorIcon",
			"schemaModal": "Sv3uVW_schemaModal",
			"primary": "Sv3uVW_primary",
			"errorBar": "Sv3uVW_errorBar",
			"tree": "Sv3uVW_tree",
			"active": "Sv3uVW_active",
			"modalHint": "Sv3uVW_modalHint",
			"treeScroll": "Sv3uVW_treeScroll",
			"browseChevron": "Sv3uVW_browseChevron",
			"errorText": "Sv3uVW_errorText",
			"strip": "Sv3uVW_strip",
			"docked": "Sv3uVW_docked",
			"typeCell": "Sv3uVW_typeCell",
			"summaryDb": "Sv3uVW_summaryDb",
			"label": "Sv3uVW_label",
			"emptyStateText": "Sv3uVW_emptyStateText",
			"shortcutHint": "Sv3uVW_shortcutHint",
			"rail": "Sv3uVW_rail",
			"card": "Sv3uVW_card",
			"modalBody": "Sv3uVW_modalBody",
			"treeChevron": "Sv3uVW_treeChevron",
			"emptyState": "Sv3uVW_emptyState",
			"treeNode": "Sv3uVW_treeNode",
			"modalCol": "Sv3uVW_modalCol",
			"treeChildren": "Sv3uVW_treeChildren",
			"actions": "Sv3uVW_actions",
			"hint": "Sv3uVW_hint",
			"field": "Sv3uVW_field",
			"columnsTable": "Sv3uVW_columnsTable",
			"nullCell": "Sv3uVW_nullCell",
			"workbench": "Sv3uVW_workbench",
			"cardTitle": "Sv3uVW_cardTitle",
			"sqlInput": "Sv3uVW_sqlInput",
			"open": "Sv3uVW_open",
			"summaryRow": "Sv3uVW_summaryRow",
			"sqlResult": "Sv3uVW_sqlResult",
			"input": "Sv3uVW_input",
			"treeItem": "Sv3uVW_treeItem",
			"fieldGrid": "Sv3uVW_fieldGrid",
			"errorHead": "Sv3uVW_errorHead",
			"da-split": "Sv3uVW_da-split",
			"sections": "Sv3uVW_sections",
			"treeIcon": "Sv3uVW_treeIcon",
			"browseIcon": "Sv3uVW_browseIcon",
			"emptyStateIcon": "Sv3uVW_emptyStateIcon",
			"fieldRow2": "Sv3uVW_fieldRow2",
			"titleIcon": "Sv3uVW_titleIcon",
			"colCount": "Sv3uVW_colCount",
			"treeName": "Sv3uVW_treeName",
			"modalColTitle": "Sv3uVW_modalColTitle"
		};
		//#endregion
		//#region src/client/DataAgentWorkbench.tsx
		/**
		* The database workbench: connection config (collapsible after connect),
		* a browse button that opens the schema explorer Modal, and the SQL command
		* box, rendered into the composer input dock (the strip ABOVE the input bar)
		* for data-agent sessions.
		*
		* Layout is phase-driven by the conversation root's `data-phase` attribute:
		* - hero (blank session): the workbench is a full-width stacked strip above
		*   the input bar (which stays at the bottom);
		* - active (conversation started): the workbench becomes a fixed left rail
		*   (measured from the conversation column), the chat records and the input
		*   bar shift right via the `da-split` CSS rules; if measurement is
		*   unavailable the workbench falls back to a docked bottom panel.
		*
		* Interaction model:
		* - after a successful connect the connection form collapses into a summary
		*   row (click 连接配置 to expand the readonly form again);
		* - the schema explorer lives in a Modal (ui-primitives) opened by the
		*   库表 button; a single click on a database toggles its table list in a
		*   file-explorer style tree (folder rows with chevrons, indented table rows
		*   with guide lines, the whole tree scrolls inside the column);
		* - clicking a table loads its columns into the Modal's structure panel.
		*
		* Non-data-agent sessions render null — zero impact on ordinary sessions.
		* Connection state lives on the server (the dataAgentConnections store), so
		* remounts never lose it — this component mirrors `/status` on mount.
		*/
		/** The plugin's preset id, matching the installed agent preset directory. */
		const DATA_AGENT_PRESET = "data-agent";
		/** 16×16 stroke icons drawn inline (the primitives package does not export icon atoms). */
		function Icon({ className, children, size = 14 }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				className,
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children
			});
		}
		/** Database cylinder: section header of the connection form. */
		function DatabaseIcon({ className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Icon, {
				className,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ellipse", {
						cx: "8",
						cy: "4",
						rx: "5.5",
						ry: "2.1",
						stroke: "currentColor",
						strokeWidth: "1.2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M2.5 4V12C2.5 13.16 4.96 14.1 8 14.1C11.04 14.1 13.5 13.16 13.5 12V4",
						stroke: "currentColor",
						strokeWidth: "1.2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M2.5 8C2.5 9.16 4.96 10.1 8 10.1C11.04 10.1 13.5 9.16 13.5 8",
						stroke: "currentColor",
						strokeWidth: "1.2"
					})
				]
			});
		}
		/** Table grid: browse row + table rows in the tree. */
		function TableIcon({ className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Icon, {
				className,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "2",
						y: "3",
						width: "12",
						height: "10",
						rx: "1.5",
						stroke: "currentColor",
						strokeWidth: "1.2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M2 6.5H14",
						stroke: "currentColor",
						strokeWidth: "1.2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M6.5 6.5V13",
						stroke: "currentColor",
						strokeWidth: "1.2"
					})
				]
			});
		}
		/** Folder: schema rows in the tree. */
		function FolderIcon({ className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, {
				className,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M1.8 4.6C1.8 4.05 2.25 3.6 2.8 3.6H5.9L7.1 5.1H13.2C13.75 5.1 14.2 5.55 14.2 6.1V11.4C14.2 11.95 13.75 12.4 13.2 12.4H2.8C2.25 12.4 1.8 11.95 1.8 11.4V4.6Z",
					stroke: "currentColor",
					strokeWidth: "1.2",
					strokeLinejoin: "round"
				})
			});
		}
		/** Terminal prompt: section header of the SQL box. */
		function TerminalIcon({ className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Icon, {
				className,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "1.5",
						y: "2.5",
						width: "13",
						height: "11",
						rx: "2",
						stroke: "currentColor",
						strokeWidth: "1.2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M4.5 6L6.5 8L4.5 10",
						stroke: "currentColor",
						strokeWidth: "1.2",
						strokeLinecap: "round",
						strokeLinejoin: "round"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M8 10.5H11.2",
						stroke: "currentColor",
						strokeWidth: "1.2",
						strokeLinecap: "round"
					})
				]
			});
		}
		/** Chevron: tree expand indicator (rotates 90° when open). */
		function ChevronIcon({ className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				className,
				width: "12",
				height: "12",
				viewBox: "0 0 12 12",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M4.5 2.5L8 6L4.5 9.5",
					stroke: "currentColor",
					strokeWidth: "1.5",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
		}
		/** Alert triangle: error bar heading. */
		function AlertIcon({ className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Icon, {
				className,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M8 2.2L14.2 13H1.8L8 2.2Z",
						stroke: "currentColor",
						strokeWidth: "1.2",
						strokeLinejoin: "round"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M8 6.4V9.2",
						stroke: "currentColor",
						strokeWidth: "1.2",
						strokeLinecap: "round"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "8",
						cy: "11",
						r: "0.9",
						fill: "currentColor"
					})
				]
			});
		}
		/** Play triangle: SQL run button. */
		function PlayIcon({ className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				className,
				width: "12",
				height: "12",
				viewBox: "0 0 12 12",
				fill: "currentColor",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3.4 2.1C3.4 1.66 3.88 1.4 4.26 1.62L9.9 5.02C10.26 5.23 10.26 5.77 9.9 5.98L4.26 9.38C3.88 9.6 3.4 9.34 3.4 8.9V2.1Z" })
			});
		}
		/** The conversation column's phase attribute value while the session is blank. */
		function isHeroPhase(element) {
			return element?.getAttribute("data-phase") === "hero";
		}
		/**
		* 开始对话后（active 布局）左栏工作台相对会话列顶部的下移偏移（px）：
		* 让工作台避开会话头部区域、整体往下沉一些，顶部露出对话记录。
		*/
		const RAIL_TOP_OFFSET = 96;
		/** Default port per type (used to fill the form from a saved connection). */
		function defaultPortOf(type) {
			switch (type) {
				case "postgres": return "5432";
				case "oracle": return "1521";
				case "hive": return "10000";
				case "impala": return "21050";
				case "sqlite": return "";
				case "mysql": return "3306";
			}
		}
		/** Run one /connect request (shared by the form connect and mount auto-reconnect). */
		async function performConnect(sessionId, body) {
			return (await fetch("/plugins/data-agent/connect", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					sessionId,
					...body
				})
			})).json();
		}
		/** Build the /connect payload from a saved connection. */
		function payloadFromSaved(saved) {
			if (saved.type === "sqlite") return {
				type: saved.type,
				database: saved.database
			};
			const body = {
				type: saved.type,
				host: saved.host ?? "127.0.0.1",
				user: saved.user ?? "",
				database: saved.database
			};
			if (saved.port !== void 0) body.port = saved.port;
			if (saved.password !== void 0 && saved.password !== "") body.password = saved.password;
			return body;
		}
		/** The database workbench body. */
		function DataAgentWorkbench({ sessionId, useSessions, t }) {
			const isDataAgent = useSessions((snapshot) => snapshot).byId[sessionId]?.agentPreset === DATA_AGENT_PRESET;
			const rootRef = (0, react.useRef)(null);
			const [phase, setPhase] = (0, react.useState)("hero");
			const [railRect, setRailRect] = (0, react.useState)(null);
			const [initialSaved] = (0, react.useState)(loadConnection);
			const [type, setType] = (0, react.useState)(initialSaved?.type ?? "mysql");
			const [host, setHost] = (0, react.useState)(initialSaved?.host ?? "127.0.0.1");
			const [port, setPort] = (0, react.useState)(initialSaved?.port !== void 0 ? String(initialSaved.port) : defaultPortOf(initialSaved?.type ?? "mysql"));
			const [user, setUser] = (0, react.useState)(initialSaved?.user ?? "");
			const [password, setPassword] = (0, react.useState)(initialSaved?.password ?? "");
			const [database, setDatabase] = (0, react.useState)(initialSaved?.database ?? "");
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const [connected, setConnected] = (0, react.useState)(false);
			const [configOpen, setConfigOpen] = (0, react.useState)(false);
			const [restoring, setRestoring] = (0, react.useState)(false);
			const [schemaModalOpen, setSchemaModalOpen] = (0, react.useState)(false);
			const [schemas, setSchemas] = (0, react.useState)([]);
			const [activeSchema, setActiveSchema] = (0, react.useState)(null);
			const [tables, setTables] = (0, react.useState)([]);
			const [activeTable, setActiveTable] = (0, react.useState)(null);
			const [columns, setColumns] = (0, react.useState)(null);
			const [sql, setSql] = (0, react.useState)("");
			const [sqlBusy, setSqlBusy] = (0, react.useState)(false);
			const [sqlResult, setSqlResult] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				const column = rootRef.current?.closest("[data-phase]") ?? null;
				if (column === null) return;
				const measure = () => {
					const rect = column.getBoundingClientRect();
					setRailRect({
						left: rect.left,
						top: rect.top,
						bottom: window.innerHeight - rect.bottom
					});
				};
				const refreshPhase = () => {
					setPhase(isHeroPhase(column) ? "hero" : "active");
				};
				refreshPhase();
				measure();
				const observer = new MutationObserver(refreshPhase);
				observer.observe(column, {
					attributes: true,
					attributeFilter: ["data-phase"]
				});
				const resizer = new ResizeObserver(measure);
				resizer.observe(column);
				window.addEventListener("resize", measure);
				return () => {
					observer.disconnect();
					resizer.disconnect();
					window.removeEventListener("resize", measure);
				};
			}, []);
			const split = phase === "active" && railRect !== null;
			(0, react.useEffect)(() => {
				const root = document.documentElement;
				const splitClass = DataAgentWorkbench_module_css_default["da-split"];
				if (split && splitClass !== void 0) root.classList.add(splitClass);
				else if (splitClass !== void 0) root.classList.remove(splitClass);
				return () => {
					if (splitClass !== void 0) root.classList.remove(splitClass);
				};
			}, [split]);
			const firstDraftRun = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				if (firstDraftRun.current) {
					firstDraftRun.current = false;
					return;
				}
				saveConnection({
					type,
					database,
					...type !== "sqlite" ? {
						host,
						user
					} : {},
					...type !== "sqlite" && port !== "" ? { port: Number(port) } : {},
					...password !== "" ? { password } : {},
					savedAt: (/* @__PURE__ */ new Date()).toISOString()
				});
			}, [
				type,
				host,
				port,
				user,
				database,
				password
			]);
			(0, react.useEffect)(() => {
				let cancelled = false;
				const saved = initialSaved;
				setBusy(true);
				fetch(`/plugins/data-agent/status?sessionId=${encodeURIComponent(sessionId)}`).then((response) => response.json()).then(async (body) => {
					if (cancelled) return;
					if (body.connected) {
						setConnected(true);
						if (body.summary !== void 0) {
							setType(body.summary.type);
							setHost(body.summary.host ?? "");
							setPort(body.summary.port !== void 0 ? String(body.summary.port) : "");
							setUser(body.summary.user ?? "");
							setDatabase(body.summary.database);
						}
						const schemasBody = await (await fetch(`/plugins/data-agent/schemas?sessionId=${encodeURIComponent(sessionId)}`)).json();
						if (!cancelled && schemasBody.ok) setSchemas(schemasBody.schemas ?? []);
						return;
					}
					if (saved !== null && saved.database !== "") {
						setRestoring(true);
						try {
							const result = await performConnect(sessionId, payloadFromSaved(saved));
							if (cancelled) return;
							if (result.ok) {
								setConnected(true);
								setConfigOpen(false);
								const schemasBody = await (await fetch(`/plugins/data-agent/schemas?sessionId=${encodeURIComponent(sessionId)}`)).json();
								if (!cancelled && schemasBody.ok) setSchemas(schemasBody.schemas ?? []);
							} else setError(`连接恢复失败：${result.error ?? "unknown error"}`);
						} catch (cause) {
							if (!cancelled) setError(`连接恢复失败：${cause instanceof Error ? cause.message : String(cause)}`);
						} finally {
							if (!cancelled) setRestoring(false);
						}
					}
				}).catch(() => {}).finally(() => {
					if (!cancelled) setBusy(false);
				});
				return () => {
					cancelled = true;
				};
			}, [sessionId]);
			const sqlite = type === "sqlite";
			const connect = async () => {
				setBusy(true);
				setError(null);
				const body = {
					sessionId,
					type
				};
				if (sqlite) body.database = database;
				else {
					body.host = host;
					if (port !== "") body.port = Number(port);
					body.user = user;
					body.database = database;
					if (password !== "") body.password = password;
				}
				try {
					const result = await performConnect(sessionId, body);
					if (result.ok) {
						setConnected(true);
						setConfigOpen(false);
						const schemasBody = await (await fetch(`/plugins/data-agent/schemas?sessionId=${encodeURIComponent(sessionId)}`)).json();
						if (schemasBody.ok) setSchemas(schemasBody.schemas ?? []);
					} else setError(result.error ?? "unknown error");
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setBusy(false);
				}
			};
			const disconnect = async () => {
				setBusy(true);
				setError(null);
				try {
					await fetch("/plugins/data-agent/disconnect", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionId })
					});
					setConnected(false);
					setConfigOpen(false);
					setSchemaModalOpen(false);
					setSchemas([]);
					setActiveSchema(null);
					setTables([]);
					setActiveTable(null);
					setColumns(null);
					setSqlResult(null);
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setBusy(false);
				}
			};
			/** Toggle one schema's table list (single click; only one open at a time). */
			const toggleSchema = async (schema) => {
				if (activeSchema === schema) {
					setActiveSchema(null);
					setTables([]);
					setActiveTable(null);
					setColumns(null);
					return;
				}
				setActiveSchema(schema);
				setActiveTable(null);
				setColumns(null);
				setTables([]);
				try {
					const result = await (await fetch(`/plugins/data-agent/tables?sessionId=${encodeURIComponent(sessionId)}&schema=${encodeURIComponent(schema)}`)).json();
					if (result.ok) setTables(result.tables ?? []);
					else setError(result.error ?? "unknown error");
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				}
			};
			const selectTable = async (table) => {
				setActiveTable(table);
				setColumns(null);
				const params = new URLSearchParams({
					sessionId,
					table
				});
				if (activeSchema !== null) params.set("schema", activeSchema);
				try {
					const result = await (await fetch(`/plugins/data-agent/describe?${params.toString()}`)).json();
					if (result.ok) setColumns(result.columns ?? []);
					else setError(result.error ?? "unknown error");
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				}
			};
			const runSql = async () => {
				if (sql.trim() === "") return;
				setSqlBusy(true);
				setSqlResult(null);
				try {
					const result = await (await fetch("/plugins/data-agent/query", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							sessionId,
							sql
						})
					})).json();
					if (result.ok && result.result !== void 0) {
						const parts = [];
						if (result.result.stdout !== "") parts.push(result.result.stdout);
						if (result.result.stderr !== "") parts.push(`[stderr]\n${result.result.stderr}`);
						if (result.result.truncated) parts.push("… 输出超过上限，已截断");
						if (result.result.exitCode !== 0) parts.push(`[exit code: ${result.result.exitCode ?? "signal"}]`);
						setSqlResult(parts.join("\n"));
					} else setSqlResult(`Error: ${result.error ?? "unknown error"}`);
				} catch (cause) {
					setSqlResult(`Error: ${cause instanceof Error ? cause.message : String(cause)}`);
				} finally {
					setSqlBusy(false);
				}
			};
			if (!isDataAgent) return null;
			const databaseLabel = sqlite ? t("form.database.sqlite") : type === "oracle" ? t("form.database.oracle") : type === "hive" || type === "impala" ? t("form.database.hive") : t("form.database");
			const railStyle = split ? {
				position: "fixed",
				left: railRect.left,
				top: railRect.top + RAIL_TOP_OFFSET,
				bottom: railRect.bottom,
				width: 380
			} : void 0;
			const formDisabled = busy || connected;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: rootRef,
				className: `${DataAgentWorkbench_module_css_default.workbench} ${split ? DataAgentWorkbench_module_css_default.rail : phase === "active" ? DataAgentWorkbench_module_css_default.docked : DataAgentWorkbench_module_css_default.strip}`,
				style: railStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: DataAgentWorkbench_module_css_default.sections,
						children: [
							connected && !configOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
								className: DataAgentWorkbench_module_css_default.card,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: DataAgentWorkbench_module_css_default.summaryRow,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
											state: "done",
											size: 8,
											className: DataAgentWorkbench_module_css_default.dot
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: DataAgentWorkbench_module_css_default.statusOk,
											children: t("state.connected")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: DataAgentWorkbench_module_css_default.summaryType,
											children: t(`type.${type}`)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: DataAgentWorkbench_module_css_default.summaryDb,
											title: database,
											children: database
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: DataAgentWorkbench_module_css_default.summaryActions,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: `${DataAgentWorkbench_module_css_default.ghost} ${DataAgentWorkbench_module_css_default.small}`,
												onClick: () => setConfigOpen(true),
												children: t("action.config")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: `${DataAgentWorkbench_module_css_default.ghost} ${DataAgentWorkbench_module_css_default.small}`,
												disabled: busy,
												onClick: () => {
													disconnect();
												},
												children: t("action.disconnect")
											})]
										})
									]
								})
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								className: DataAgentWorkbench_module_css_default.card,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: DataAgentWorkbench_module_css_default.cardTitle,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DatabaseIcon, { className: DataAgentWorkbench_module_css_default.titleIcon }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("form.title") })]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: DataAgentWorkbench_module_css_default.fieldGrid,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
												className: DataAgentWorkbench_module_css_default.field,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: DataAgentWorkbench_module_css_default.label,
													children: t("form.type")
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
													className: DataAgentWorkbench_module_css_default.input,
													value: type,
													disabled: formDisabled,
													onChange: (event) => {
														const next = event.target.value;
														setType(next);
														setPort(next === "postgres" ? "5432" : next === "mysql" ? "3306" : next === "oracle" ? "1521" : next === "hive" ? "10000" : next === "impala" ? "21050" : "");
													},
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
															value: "mysql",
															children: t("type.mysql")
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
															value: "postgres",
															children: t("type.postgres")
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
															value: "sqlite",
															children: t("type.sqlite")
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
															value: "oracle",
															children: t("type.oracle")
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
															value: "hive",
															children: t("type.hive")
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
															value: "impala",
															children: t("type.impala")
														})
													]
												})]
											}),
											!sqlite && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: DataAgentWorkbench_module_css_default.fieldRow2,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
													className: DataAgentWorkbench_module_css_default.field,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: DataAgentWorkbench_module_css_default.label,
														children: t("form.host")
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
														className: DataAgentWorkbench_module_css_default.input,
														type: "text",
														value: host,
														disabled: formDisabled,
														onChange: (event) => setHost(event.target.value)
													})]
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
													className: DataAgentWorkbench_module_css_default.field,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: DataAgentWorkbench_module_css_default.label,
														children: t("form.port")
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
														className: DataAgentWorkbench_module_css_default.input,
														type: "number",
														min: 1,
														max: 65535,
														value: port,
														disabled: formDisabled,
														onChange: (event) => setPort(event.target.value)
													})]
												})]
											}),
											!sqlite && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: DataAgentWorkbench_module_css_default.fieldRow2,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
													className: DataAgentWorkbench_module_css_default.field,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: DataAgentWorkbench_module_css_default.label,
														children: t("form.user")
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
														className: DataAgentWorkbench_module_css_default.input,
														type: "text",
														value: user,
														disabled: formDisabled,
														onChange: (event) => setUser(event.target.value)
													})]
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
													className: DataAgentWorkbench_module_css_default.field,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: DataAgentWorkbench_module_css_default.label,
														children: t("form.password")
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
														className: DataAgentWorkbench_module_css_default.input,
														type: "password",
														value: password,
														autoComplete: "new-password",
														disabled: formDisabled,
														onChange: (event) => setPassword(event.target.value)
													})]
												})]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
												className: DataAgentWorkbench_module_css_default.field,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: DataAgentWorkbench_module_css_default.label,
													children: databaseLabel
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													className: DataAgentWorkbench_module_css_default.input,
													type: "text",
													value: database,
													placeholder: sqlite ? t("form.database.sqlite.placeholder") : void 0,
													disabled: formDisabled,
													onChange: (event) => setDatabase(event.target.value)
												})]
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: DataAgentWorkbench_module_css_default.actions,
										children: !connected ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: DataAgentWorkbench_module_css_default.primary,
											disabled: busy || database === "" || !sqlite && host === "",
											onClick: () => {
												connect();
											},
											children: restoring ? t("state.reconnecting") : busy ? t("state.checking") : t("action.connect")
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: DataAgentWorkbench_module_css_default.ghost,
											onClick: () => setConfigOpen(false),
											children: t("action.collapse")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: DataAgentWorkbench_module_css_default.ghost,
											disabled: busy,
											onClick: () => {
												disconnect();
											},
											children: t("action.disconnect")
										})] })
									})
								]
							}),
							connected && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
								className: DataAgentWorkbench_module_css_default.card,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: DataAgentWorkbench_module_css_default.browseRow,
									onClick: () => setSchemaModalOpen(true),
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TableIcon, { className: DataAgentWorkbench_module_css_default.browseIcon }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("action.browse") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChevronIcon, { className: DataAgentWorkbench_module_css_default.browseChevron })
									]
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								className: DataAgentWorkbench_module_css_default.card,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: DataAgentWorkbench_module_css_default.cardTitle,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TerminalIcon, { className: DataAgentWorkbench_module_css_default.titleIcon }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("wb.sql") })]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										className: DataAgentWorkbench_module_css_default.sqlInput,
										value: sql,
										rows: 8,
										spellCheck: false,
										placeholder: t("wb.sql.placeholder"),
										onChange: (event) => setSql(event.target.value),
										onKeyDown: (event) => {
											if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
												event.preventDefault();
												runSql();
											}
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: DataAgentWorkbench_module_css_default.sqlActions,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: DataAgentWorkbench_module_css_default.shortcutHint,
											children: t("wb.sql.shortcut")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: DataAgentWorkbench_module_css_default.primary,
											disabled: sqlBusy || !connected || sql.trim() === "",
											onClick: () => {
												runSql();
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PlayIcon, {}), sqlBusy ? t("wb.sql.running") : t("wb.sql.run")]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
										className: DataAgentWorkbench_module_css_default.sqlResult,
										children: sqlResult ?? t("wb.sql.empty")
									})
								]
							})
						]
					}),
					error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: DataAgentWorkbench_module_css_default.errorBar,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DataAgentWorkbench_module_css_default.errorHead,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AlertIcon, { className: DataAgentWorkbench_module_css_default.errorIcon }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("error.title") })]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: DataAgentWorkbench_module_css_default.errorText,
							children: error
						})]
					}),
					schemaModalOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: schemaModalOpen,
						onClose: () => setSchemaModalOpen(false),
						title: t("wb.modal.title"),
						closeLabel: t("action.close"),
						className: DataAgentWorkbench_module_css_default.schemaModal,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DataAgentWorkbench_module_css_default.modalBody,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: DataAgentWorkbench_module_css_default.modalCol,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: DataAgentWorkbench_module_css_default.modalColTitle,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("wb.schemas") }), schemas.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: DataAgentWorkbench_module_css_default.colCount,
											children: schemas.length
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: DataAgentWorkbench_module_css_default.treeScroll,
										children: [schemas.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: DataAgentWorkbench_module_css_default.hint,
											children: t("wb.loading")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
											className: DataAgentWorkbench_module_css_default.tree,
											children: schemas.map((schema) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
												className: DataAgentWorkbench_module_css_default.treeNode,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
													type: "button",
													className: `${DataAgentWorkbench_module_css_default.treeItem}${activeSchema === schema ? ` ${DataAgentWorkbench_module_css_default.active}` : ""}`,
													onClick: () => {
														toggleSchema(schema);
													},
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChevronIcon, { className: `${DataAgentWorkbench_module_css_default.treeChevron}${activeSchema === schema ? ` ${DataAgentWorkbench_module_css_default.open}` : ""}` }),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FolderIcon, { className: DataAgentWorkbench_module_css_default.treeIcon }),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: DataAgentWorkbench_module_css_default.treeName,
															children: schema
														}),
														activeSchema === schema && tables.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: DataAgentWorkbench_module_css_default.treeCount,
															children: tables.length
														})
													]
												}), activeSchema === schema && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: DataAgentWorkbench_module_css_default.treeChildren,
													children: [tables.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: DataAgentWorkbench_module_css_default.hint,
														children: t("wb.empty")
													}), tables.map((table) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
														type: "button",
														className: `${DataAgentWorkbench_module_css_default.treeItem}${activeTable === table ? ` ${DataAgentWorkbench_module_css_default.active}` : ""}`,
														onClick: () => {
															selectTable(table);
														},
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TableIcon, { className: DataAgentWorkbench_module_css_default.treeIcon }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: DataAgentWorkbench_module_css_default.treeName,
															children: table
														})]
													}, table))]
												})]
											}, schema))
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: DataAgentWorkbench_module_css_default.modalHint,
										children: t("wb.hint.click")
									})
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: DataAgentWorkbench_module_css_default.modalCol,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: DataAgentWorkbench_module_css_default.modalColTitle,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [t("wb.columns"), activeTable !== null && ` · ${activeTable}`] })
								}), columns === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: DataAgentWorkbench_module_css_default.emptyState,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TableIcon, { className: DataAgentWorkbench_module_css_default.emptyStateIcon }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: DataAgentWorkbench_module_css_default.emptyStateText,
										children: t("wb.hint.click")
									})]
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: DataAgentWorkbench_module_css_default.colScroll,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
										className: DataAgentWorkbench_module_css_default.columnsTable,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "name" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "type" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "null" })
										] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: columns.map((column) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: column.name }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: DataAgentWorkbench_module_css_default.typeCell,
												children: column.type
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: DataAgentWorkbench_module_css_default.nullCell,
												children: column.nullable === void 0 ? "" : column.nullable ? "YES" : "NO"
											})
										] }, column.name)) })]
									})
								})]
							})]
						})
					})
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** `data-agent` namespace dictionaries for the database workbench. */
		/** Dictionary namespace owned by this plugin. */
		const NS = "data-agent";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"form.title": "数据库连接",
			"form.type": "数据库类型",
			"type.mysql": "MySQL",
			"type.postgres": "PostgreSQL",
			"type.sqlite": "SQLite",
			"type.oracle": "Oracle",
			"type.hive": "Hive",
			"type.impala": "Impala",
			"form.host": "主机",
			"form.port": "端口",
			"form.user": "用户名",
			"form.password": "密码",
			"form.database": "数据库名",
			"form.database.oracle": "服务名 / SID",
			"form.database.hive": "默认库",
			"form.database.impala": "默认库",
			"form.database.sqlite": "数据库文件路径",
			"form.database.sqlite.placeholder": "/path/to/orders.db",
			"action.connect": "连接",
			"action.disconnect": "断开",
			"state.connected": "已连接",
			"state.disconnected": "未连接",
			"state.checking": "正在检查连接…",
			"state.reconnecting": "正在恢复连接…",
			"wb.schemas": "库",
			"wb.tables": "表",
			"wb.columns": "表结构",
			"wb.sql": "SQL 命令",
			"wb.sql.placeholder": "在此输入 SQL，例如 SELECT * FROM orders LIMIT 10;",
			"wb.sql.run": "运行",
			"wb.sql.running": "运行中…",
			"wb.sql.shortcut": "Ctrl / ⌘ + Enter 运行",
			"wb.sql.empty": "-- 尚无输出 --",
			"wb.loading": "加载中…",
			"wb.empty": "（空）",
			"wb.modal.title": "库表浏览",
			"wb.hint.click": "单击库展开表 · 点击表查看结构",
			"action.config": "连接配置",
			"action.browse": "库表",
			"action.close": "关闭",
			"action.collapse": "收起",
			"error.title": "操作失败"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"form.title": "Database connection",
			"form.type": "Database type",
			"type.mysql": "MySQL",
			"type.postgres": "PostgreSQL",
			"type.sqlite": "SQLite",
			"type.oracle": "Oracle",
			"type.hive": "Hive",
			"type.impala": "Impala",
			"form.host": "Host",
			"form.port": "Port",
			"form.user": "User",
			"form.password": "Password",
			"form.database": "Database",
			"form.database.oracle": "Service name / SID",
			"form.database.hive": "Default database",
			"form.database.impala": "Default database",
			"form.database.sqlite": "Database file path",
			"form.database.sqlite.placeholder": "/path/to/orders.db",
			"action.connect": "Connect",
			"action.disconnect": "Disconnect",
			"state.connected": "Connected",
			"state.disconnected": "Not connected",
			"state.checking": "Checking connection…",
			"state.reconnecting": "Restoring connection…",
			"wb.schemas": "Databases",
			"wb.tables": "Tables",
			"wb.columns": "Columns",
			"wb.sql": "SQL",
			"wb.sql.placeholder": "Write SQL here, e.g. SELECT * FROM orders LIMIT 10;",
			"wb.sql.run": "Run",
			"wb.sql.running": "Running…",
			"wb.sql.shortcut": "Ctrl / ⌘ + Enter to run",
			"wb.sql.empty": "-- no output --",
			"wb.loading": "Loading…",
			"wb.empty": "(empty)",
			"wb.modal.title": "Database explorer",
			"wb.hint.click": "Click a database to expand tables · click a table for columns",
			"action.config": "Connection settings",
			"action.browse": "Tables",
			"action.close": "Close",
			"action.collapse": "Collapse",
			"error.title": "Operation failed"
		};
		//#endregion
		//#region src/client/index.ts
		/** Required services: the locale service, the slot registry, and the sessions list. */
		const inject = [
			"slots",
			"locale",
			"sessions"
		];
		/**
		* Client plugin body: register the data-agent dictionaries and the database
		* workbench into the composer input dock. The registration rides the slot
		* service's effect wrapper, so plugin unload removes it.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "data-agent: dictionaries");
			ctx.locale.bind(NS);
			ctx.inject([
				"slots",
				"locale",
				"sessions"
			], (scope) => {
				const list = scope.sessions.list;
				const sessionsSource = {
					getSnapshot: () => list.getSnapshot(),
					subscribe: (fn) => list.subscribe(fn)
				};
				scope.slots.inject("conversation.input.dock", () => scope.slots.register({
					name: "conversation.input.dock",
					id: "data-agent",
					order: 0,
					locale: NS,
					inject: () => ({ hooks: { sessions: sessionsSource } })
				}, DataAgentWorkbench));
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map