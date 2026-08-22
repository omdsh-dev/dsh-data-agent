import { C as isDatabaseType, S as defaultDatabasePort$1, b as DATABASE_TYPES, i as validatePasswordRef, r as redactSecretText, x as databaseTypeLabel$1 } from "./connections-CFXOZTHZ.js";
import { RUN_CODE_NAME } from "@deepseek-ai/dsh-tools";
//#region src/tui-connection-form.ts
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
const TUI_DATABASE_TYPES = DATABASE_TYPES;
/** Initial form intentionally leaves host/port empty so placeholders are real defaults. */
function createTuiConnectionFormState(initialDraft) {
	return {
		type: initialDraft?.type ?? "mysql",
		host: initialDraft?.host ?? "",
		port: initialDraft?.port ?? "",
		user: initialDraft?.user ?? "",
		database: initialDraft?.database ?? "",
		password: "",
		passwordRef: initialDraft?.passwordRef ?? "",
		secure: initialDraft?.secure ?? false,
		readonly: initialDraft?.readonly ?? false,
		focus: "type",
		cursor: 0
	};
}
/** Project form state onto the only values allowed to cross the durable seam. */
function connectionFormDraft(state) {
	return {
		type: state.type,
		host: state.host,
		port: state.port,
		user: state.user,
		database: state.database,
		readonly: state.readonly,
		...state.type === "clickhouse" ? { secure: state.secure } : {}
	};
}
/** Relevant focus order for the selected database kind. */
function tuiConnectionFields(type) {
	if (type === "sqlite") return [
		"type",
		"database",
		"readonly",
		"confirm",
		"cancel"
	];
	const fields = [
		"type",
		"host",
		"port",
		"user",
		"database",
		"password",
		"passwordRef"
	];
	if (type === "clickhouse") fields.push("secure");
	return [
		...fields,
		"readonly",
		"confirm",
		"cancel"
	];
}
/** Default network port shown as a placeholder and applied only at submit time. */
function defaultDatabasePort(type, secure = false) {
	return defaultDatabasePort$1(type, secure);
}
/**
* Check only terminal capability. The command adapter already proves that the
* actual dsh-tui plugin is loaded before it exposes `/database`; repeating a
* profile-name or argv heuristic here would reject custom profiles that use
* dsh-tui and admit profiles that merely happen to be named `dsh-tui`.
*/
function isDshTuiTerminal(input = process.stdin, output = process.stdout) {
	return input.isTTY === true && output.isTTY === true;
}
/** Pure keyboard reducer, kept separate from terminal ownership for regression tests. */
function updateTuiConnectionForm(current, key) {
	let state = {
		...current,
		error: void 0
	};
	if (state.selector !== void 0) return updateOpenSelector(state, key);
	if (key.name === "escape") return {
		kind: "cancelled",
		state: clearPassword(state)
	};
	if (key.name === "tab" || key.name === "backtab") {
		state = moveFocus(state, key.name === "tab" ? 1 : -1);
		return {
			kind: "editing",
			state
		};
	}
	if (state.focus === "confirm") {
		if (key.name !== "enter") return {
			kind: "editing",
			state
		};
		const validated = validateTuiConnectionForm(state);
		return validated.error !== void 0 ? {
			kind: "editing",
			state: {
				...state,
				error: validated.error
			}
		} : {
			kind: "submitted",
			state: clearPassword(state),
			input: validated.input
		};
	}
	if (state.focus === "cancel") return key.name === "enter" ? {
		kind: "cancelled",
		state: clearPassword(state)
	} : {
		kind: "editing",
		state
	};
	if (state.focus === "type") {
		if (key.name === "enter" || key.name === "space") state = {
			...state,
			selector: {
				field: "type",
				index: TUI_DATABASE_TYPES.indexOf(state.type)
			}
		};
		return {
			kind: "editing",
			state
		};
	}
	if (state.focus === "readonly" || state.focus === "secure") {
		if (key.name === "enter" || key.name === "space") state = {
			...state,
			selector: {
				field: state.focus,
				index: state[state.focus] ? 1 : 0
			}
		};
		return {
			kind: "editing",
			state
		};
	}
	if (key.name === "enter" || key.name === "up" || key.name === "down") return {
		kind: "editing",
		state
	};
	return {
		kind: "editing",
		state: editTextField(state, key)
	};
}
/** Rendered value is masked before it reaches the ANSI string. */
function renderTuiConnectionForm(state, columns = 80) {
	const width = Math.max(20, Math.min(72, columns - 8));
	const lines = [
		"\x1B[2J\x1B[H\x1B[?25l",
		`${bold("Data Agent · 数据库连接")}`,
		dim("Tab/Shift+Tab 切换 · Enter 展开/确认选项 · ↑/↓ 选择 · Esc 返回"),
		""
	];
	for (const field of tuiConnectionFields(state.type)) lines.push(...renderField(state, field, width));
	if (state.error !== void 0) lines.push("", red(`! ${state.error}`));
	lines.push("", dim(state.type === "sqlite" ? "SQLite 连接不收集数据库凭据。" : "临时密码不持久化；凭据引用可随非敏感连接 profile 恢复。"));
	return lines.join("\n");
}
/**
* Own the terminal only for the form lifetime. `undefined` means user cancel.
* The returned password has never crossed stdout, argv, env, or a DSH event.
*/
function runTuiConnectionForm(options = {}) {
	const input = options.input ?? process.stdin;
	const output = options.output ?? process.stdout;
	if (input.isTTY !== true || output.isTTY !== true) return Promise.reject(/* @__PURE__ */ new Error("数据库连接表单需要交互式 TTY"));
	const originalListeners = input.listeners("readable");
	const wasRaw = input.isRaw === true;
	let state = createTuiConnectionFormState(options.initialDraft);
	let settled = false;
	return new Promise((resolve, reject) => {
		const redraw = () => output.write(renderTuiConnectionForm(state, output.columns ?? 80));
		const cleanup = () => {
			input.removeListener("readable", onReadable);
			output.removeListener?.("resize", redraw);
			options.signal?.removeEventListener("abort", onAbort);
			if (!wasRaw) input.setRawMode?.(false);
			output.write("\x1B[0m\x1B[?25h\x1B[2J\x1B[H");
			for (const listener of originalListeners) input.on("readable", listener);
			requestHostFullRedraw(input, output);
		};
		const finish = async (value, error) => {
			if (settled) return;
			settled = true;
			const draft = connectionFormDraft(state);
			state = clearPassword(state);
			cleanup();
			try {
				await options.persistDraft?.(draft);
				if (error !== void 0) reject(error);
				else resolve(value);
			} catch (persistError) {
				reject(persistError);
			}
		};
		const onAbort = () => {
			finish(void 0, options.signal?.reason instanceof Error ? options.signal.reason : /* @__PURE__ */ new Error("数据库连接已取消"));
		};
		const onReadable = () => {
			if (settled) return;
			try {
				let chunk;
				while ((chunk = input.read()) !== null) {
					const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
					for (const key of decodeTuiFormInput(text)) {
						const transition = updateTuiConnectionForm(state, key);
						state = transition.state;
						if (transition.kind === "submitted") {
							finish(transition.input);
							return;
						}
						if (transition.kind === "cancelled") {
							finish(void 0);
							return;
						}
					}
				}
				redraw();
			} catch (error) {
				finish(void 0, error);
			}
		};
		try {
			for (const listener of originalListeners) input.removeListener("readable", listener);
			input.setRawMode?.(true);
			input.ref?.();
			input.on("readable", onReadable);
			output.on?.("resize", redraw);
			options.signal?.addEventListener("abort", onAbort, { once: true });
			if (options.signal?.aborted === true) onAbort();
			else redraw();
		} catch (error) {
			settled = true;
			state = clearPassword(state);
			cleanup();
			reject(error);
		}
	});
}
/**
* Ask dsh-tui to invalidate Ink's cached frame after our direct ANSI drawing.
*
* A same-size `resize` event does not invalidate Ink's physical-frame cache,
* so unchanged rows such as the prompt remain blank after the form clears the
* screen. Ctrl+L is dsh-tui's documented redraw shortcut and reaches the host
* only after its original readable listener has been restored.
*/
function requestHostFullRedraw(input, output) {
	try {
		if (input.push !== void 0) {
			input.push("\f");
			input.emit?.("readable");
			return;
		}
	} catch {}
	output.emit?.("resize");
}
/** Decode the keyboard subset owned by the form; unknown terminal reports are ignored. */
function decodeTuiFormInput(value) {
	const keys = [];
	let index = 0;
	while (index < value.length) {
		const rest = value.slice(index);
		const known = KNOWN_SEQUENCES.find(([sequence]) => rest.startsWith(sequence));
		if (known !== void 0) {
			keys.push({ name: known[1] });
			index += known[0].length;
			continue;
		}
		const character = value[index];
		if (character === "" || character === "\x1B") {
			if (character === "\x1B" && value[index + 1] === "[") {
				index += 2;
				while (index < value.length && !/[\x40-\x7E]/.test(value[index])) index += 1;
				index += 1;
			} else {
				keys.push({ name: "escape" });
				index += 1;
			}
			continue;
		}
		if (character === "	") keys.push({ name: "tab" });
		else if (character === "\r" || character === "\n") keys.push({ name: "enter" });
		else if (character === "" || character === "\b") keys.push({ name: "backspace" });
		else if (character === " ") keys.push({ name: "space" });
		else if (character >= " ") keys.push({
			name: "text",
			text: character
		});
		index += 1;
	}
	return keys;
}
const KNOWN_SEQUENCES = [
	["\x1B[Z", "backtab"],
	["\x1B[A", "up"],
	["\x1B[B", "down"],
	["\x1B[C", "right"],
	["\x1B[D", "left"],
	["\x1B[H", "home"],
	["\x1B[F", "end"],
	["\x1B[1~", "home"],
	["\x1B[4~", "end"],
	["\x1B[3~", "delete"]
];
function validateTuiConnectionForm(state) {
	const database = state.database.trim();
	if (database === "") return { error: state.type === "sqlite" ? "SQLite 数据库文件路径不能为空" : "数据库名不能为空" };
	if (state.type === "sqlite") return { input: {
		type: "sqlite",
		database,
		readonly: state.readonly
	} };
	const portText = state.port.trim();
	const port = portText === "" ? defaultDatabasePort(state.type, state.secure) : Number(portText);
	if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "端口必须是 1–65535 的整数，或留空使用默认值" };
	const input = {
		type: state.type,
		host: state.host.trim() || "127.0.0.1",
		port,
		database,
		readonly: state.readonly
	};
	if (state.type === "clickhouse") input.secure = state.secure;
	const user = state.user.trim();
	if (user !== "") input.user = user;
	const passwordRef = state.passwordRef.trim();
	if (state.password !== "" && passwordRef !== "") return { error: "临时密码与凭据引用不能同时填写" };
	if (passwordRef !== "") {
		try {
			validatePasswordRef(passwordRef);
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) };
		}
		input.passwordRef = passwordRef;
	} else if (state.password !== "") input.password = state.password;
	return { input };
}
function editTextField(state, key) {
	if (!isTextField(state.focus)) return state;
	const value = state[state.focus];
	if (key.name === "text") return replaceField(state, value.slice(0, state.cursor) + key.text + value.slice(state.cursor), state.cursor + key.text.length);
	if (key.name === "space") return replaceField(state, value.slice(0, state.cursor) + " " + value.slice(state.cursor), state.cursor + 1);
	if (key.name === "backspace" && state.cursor > 0) return replaceField(state, value.slice(0, state.cursor - 1) + value.slice(state.cursor), state.cursor - 1);
	if (key.name === "delete" && state.cursor < value.length) return replaceField(state, value.slice(0, state.cursor) + value.slice(state.cursor + 1), state.cursor);
	if (key.name === "left") return {
		...state,
		cursor: Math.max(0, state.cursor - 1)
	};
	if (key.name === "right") return {
		...state,
		cursor: Math.min(value.length, state.cursor + 1)
	};
	if (key.name === "home") return {
		...state,
		cursor: 0
	};
	if (key.name === "end") return {
		...state,
		cursor: value.length
	};
	return state;
}
function replaceField(state, value, cursor) {
	if (!isTextField(state.focus)) return state;
	return {
		...state,
		[state.focus]: value,
		cursor
	};
}
function isTextField(field) {
	return field === "host" || field === "port" || field === "user" || field === "database" || field === "password" || field === "passwordRef";
}
function moveFocus(state, delta) {
	const fields = tuiConnectionFields(state.type);
	const focus = fields[(Math.max(0, fields.indexOf(state.focus)) + delta + fields.length) % fields.length];
	return {
		...state,
		focus,
		cursor: isTextField(focus) ? state[focus].length : 0
	};
}
function clearPassword(state) {
	return {
		...state,
		password: "",
		cursor: state.focus === "password" ? 0 : state.cursor
	};
}
function updateOpenSelector(state, key) {
	const selector = state.selector;
	const optionCount = selector.field === "type" ? TUI_DATABASE_TYPES.length : 2;
	if (key.name === "escape") return {
		kind: "editing",
		state: closeSelector(state)
	};
	if (key.name === "enter") {
		let selected;
		if (selector.field === "type") {
			const type = TUI_DATABASE_TYPES[selector.index];
			const previousDefault = state.type === "sqlite" ? "" : String(defaultDatabasePort(state.type, state.secure));
			const secure = type === "clickhouse" && state.secure;
			const port = state.port === "" || state.port === previousDefault ? type === "sqlite" ? "" : String(defaultDatabasePort(type, secure)) : state.port;
			selected = {
				...state,
				type,
				secure,
				port
			};
		} else if (selector.field === "secure") {
			const secure = selector.index === 1;
			const previousDefault = String(defaultDatabasePort("clickhouse", state.secure));
			const port = state.port === "" || state.port === previousDefault ? String(defaultDatabasePort("clickhouse", secure)) : state.port;
			selected = {
				...state,
				secure,
				port
			};
		} else selected = {
			...state,
			readonly: selector.index === 1
		};
		return {
			kind: "editing",
			state: closeSelector(selected)
		};
	}
	let delta = 0;
	if (key.name === "up" || key.name === "left") delta = -1;
	if (key.name === "down" || key.name === "right") delta = 1;
	if (delta === 0 && key.name !== "home" && key.name !== "end") return {
		kind: "editing",
		state
	};
	const index = key.name === "home" ? 0 : key.name === "end" ? optionCount - 1 : (selector.index + delta + optionCount) % optionCount;
	return {
		kind: "editing",
		state: {
			...state,
			selector: {
				...selector,
				index
			}
		}
	};
}
function closeSelector(state) {
	const { selector: _selector, ...rest } = state;
	return rest;
}
function renderField(state, field, width) {
	const focused = state.focus === field;
	const pointer = focused ? cyan("›") : " ";
	if (field === "confirm" || field === "cancel") {
		const label = field === "confirm" ? "确定并连接" : "取消";
		return [`${pointer} ${focused ? cyan(bold(`[ ${label} ]`)) : `[ ${label} ]`}`];
	}
	const label = fieldLabel(field, state.type);
	let value;
	let placeholder = false;
	if (field === "type") value = databaseTypeLabel(state.type);
	else if (field === "readonly") value = state.readonly ? "是" : "否";
	else if (field === "secure") value = state.secure ? "是" : "否";
	else {
		const raw = state[field];
		if (field === "password") value = "*".repeat([...raw].length);
		else value = raw;
		if (value === "") {
			placeholder = true;
			value = field === "host" ? "127.0.0.1（默认）" : field === "port" ? `${defaultDatabasePort(state.type, state.secure)}（默认）` : field === "password" ? "可留空" : field === "passwordRef" ? "例如 DB_PASSWORD，可留空" : field === "user" ? "可留空" : "请输入";
		}
	}
	const maxValue = Math.max(8, width - 20);
	const shown = truncate(value.replace(/[\r\n\u001B]/g, " "), maxValue);
	const content = placeholder ? dim(shown) : shown;
	const expandable = field === "type" || field === "readonly" || field === "secure";
	const line = `${pointer} ${label.padEnd(8, "　")} [ ${focused ? cyan(content) : content}${expandable ? " ▾" : ""} ]`;
	if (state.selector?.field !== field) return [line];
	return [line, ...renderSelectorOptions(state)];
}
function renderSelectorOptions(state) {
	const selector = state.selector;
	const labels = selector.field === "type" ? TUI_DATABASE_TYPES.map(databaseTypeLabel) : ["否", "是"];
	const selectedIndex = selector.field === "type" ? TUI_DATABASE_TYPES.indexOf(state.type) : state[selector.field] ? 1 : 0;
	return labels.map((label, index) => {
		return `    ${index === selector.index ? cyan("›") : " "} ${index === selectedIndex ? cyan("●") : dim("○")} ${index === selector.index ? cyan(bold(label)) : label}`;
	});
}
function databaseTypeLabel(type) {
	return databaseTypeLabel$1(type);
}
function fieldLabel(field, type) {
	switch (field) {
		case "type": return "数据库类型";
		case "host": return "数据库主机";
		case "port": return "数据库端口";
		case "user": return "数据库用户";
		case "database": return type === "sqlite" ? "文件路径" : "数据库名";
		case "password": return "密码";
		case "passwordRef": return "凭据引用";
		case "secure": return "HTTPS";
		case "readonly": return "只读模式";
	}
}
function truncate(value, width) {
	const characters = [...value];
	return characters.length <= width ? value : `…${characters.slice(-(width - 1)).join("")}`;
}
function bold(value) {
	return `\u001B[1m${value}\u001B[22m`;
}
function dim(value) {
	return `\u001B[2m${value}\u001B[22m`;
}
function cyan(value) {
	return `\u001B[36m${value}\u001B[39m`;
}
function red(value) {
	return `\u001B[31m${value}\u001B[39m`;
}
//#endregion
//#region src/catalog-command.ts
const CATALOG_COMMAND_USAGE = [
	"用法：",
	"  /catalog scan --all",
	"  /catalog scan --schema <name>",
	"  /catalog scan --schema <name> --table <name>",
	"  /catalog status [--run <run-id>]",
	"  /catalog cancel [--run <run-id>]",
	"  /catalog diff [--from <run-id> --to <run-id>]",
	"  /catalog view",
	"说明：无参数 scan 仅在有交互 provider 时选择范围；不会隐式执行全库扫描。"
].join("\n");
function registerCatalogCommand(ctx, presentation) {
	return ctx.commands.register({
		name: "catalog",
		description: "扫描、查看或比较 data-agent 数据目录",
		input: { hint: "scan | status | cancel | diff | view" },
		recordInput: false,
		handler: async (invocation) => executeCatalogCommand(ctx, invocation, presentation)
	});
}
async function executeCatalogCommand(ctx, invocation, presentation) {
	try {
		const action = parseCatalogAction(invocation.rawInput);
		const sessionId = String(invocation.agent.id);
		switch (action.kind) {
			case "scan": {
				const scope = action.scope ?? await askForCatalogScope(ctx, invocation);
				if (scope === void 0) return {
					kind: "error",
					text: `当前界面没有可用的问答 provider；未开始扫描。\n\n${CATALOG_COMMAND_USAGE}`
				};
				const run = await ctx.dataAgentCatalogScanner.start({
					sessionId,
					scope
				});
				presentation?.watch(run);
				return {
					kind: "success",
					text: `Catalog 扫描已进入后台队列。\nrun: ${run.id}\nsource: ${run.sourceId}\nscope: ${formatScope(run.scope)}\nAI model: ${run.enrichment?.provider ?? "未配置"}/${run.enrichment?.model ?? "未配置"}\n使用 /catalog status 查看技术扫描和 AI 业务含义进度。`
				};
			}
			case "status": {
				const sourceId = await resolveCommandSourceId(ctx, sessionId);
				if (sourceId === void 0) return {
					kind: "success",
					text: `当前没有Catalog source或扫描记录。\n\n${CATALOG_COMMAND_USAGE}`
				};
				const status = ctx.dataAgentCatalog.status(sourceId);
				if (status === void 0) return {
					kind: "success",
					text: `source ${sourceId} 尚未扫描。\n\n${CATALOG_COMMAND_USAGE}`
				};
				const run = action.runId === void 0 ? status.activeRun ?? status.latestRun : ctx.dataAgentCatalog.listRuns(sourceId, 200).find((candidate) => candidate.id === action.runId);
				if (action.runId !== void 0 && run === void 0) return {
					kind: "error",
					text: `未找到 Catalog run ${action.runId}（仅查询最近 200 条记录）。`
				};
				const lines = [`Catalog source: ${status.source.name} (${status.source.id})`, `资产: ${status.counts.assets}，字段: ${status.counts.fields}，待确认: ${status.counts.needsReview}`];
				if (run !== void 0) {
					lines.push(`run: ${run.id}`, `状态: ${run.status}`, `范围: ${formatScope(run.scope)}`, `进度: ${run.progress.schemas} schema / ${run.progress.relations} 表或视图 / ${run.progress.fields} 字段`);
					if (run.error !== void 0) lines.push(`错误: ${run.error}`);
					if (run.enrichment !== void 0) {
						lines.push(`AI 业务含义: ${run.enrichment.status}`, `AI 模型: ${run.enrichment.provider}/${run.enrichment.model}`, `AI 进度: ${run.enrichment.tablesCompleted}/${run.enrichment.tablesTotal} 表，${run.enrichment.candidatesGenerated} 个候选，${run.enrichment.tablesFailed} 个失败`);
						if (run.enrichment.error !== void 0) lines.push(`AI 错误: ${run.enrichment.error}`);
					}
				}
				return {
					kind: "success",
					text: lines.join("\n")
				};
			}
			case "cancel": {
				const sourceId = await requireCommandSourceId(ctx, sessionId);
				const run = await ctx.dataAgentCatalogScanner.cancel(sourceId, action.runId);
				return {
					kind: "success",
					text: `已请求取消 Catalog run ${run.id}；当前状态 ${run.status}。`
				};
			}
			case "diff": {
				const sourceId = await requireCommandSourceId(ctx, sessionId);
				return {
					kind: "success",
					text: formatCatalogDiff(ctx.dataAgentCatalog.diff(sourceId, action.fromRunId, action.toRunId, void 0, 50))
				};
			}
			case "view":
				if (presentation?.open(sessionId) !== true) return {
					kind: "error",
					text: "当前dsh-tui未提供Catalog全屏scene能力；请升级dsh-tui，或暂用 /catalog status 和Web数据目录查看。"
				};
				return { kind: "success" };
		}
	} catch (error) {
		return {
			kind: "error",
			text: error instanceof Error ? error.message : String(error)
		};
	}
}
function parseCatalogAction(rawInput) {
	const tokens = splitCommandLine$1(rawInput.trim());
	if (tokens.length === 0) throw new Error(`必须提供 Catalog 子命令。\n\n${CATALOG_COMMAND_USAGE}`);
	const [subcommand, ...args] = tokens;
	if (subcommand === "status") {
		const values = parseNamedArguments(args, /* @__PURE__ */ new Set(["run"]));
		return {
			kind: "status",
			...values.get("run") !== void 0 ? { runId: values.get("run") } : {}
		};
	}
	if (subcommand === "scan") return parseScan(args);
	if (subcommand === "view") {
		if (args.length > 0) throw new Error(`view 不接受额外参数。\n\n${CATALOG_COMMAND_USAGE}`);
		return { kind: "view" };
	}
	if (subcommand === "cancel") {
		const values = parseNamedArguments(args, /* @__PURE__ */ new Set(["run"]));
		return {
			kind: "cancel",
			...values.get("run") !== void 0 ? { runId: values.get("run") } : {}
		};
	}
	if (subcommand === "diff") {
		const values = parseNamedArguments(args, /* @__PURE__ */ new Set(["from", "to"]));
		const fromRunId = values.get("from");
		const toRunId = values.get("to");
		if (fromRunId === void 0 !== (toRunId === void 0)) throw new Error("diff 的 --from 与 --to 必须同时提供");
		return {
			kind: "diff",
			...fromRunId !== void 0 ? { fromRunId } : {},
			...toRunId !== void 0 ? { toRunId } : {}
		};
	}
	throw new Error(`未知 catalog 子命令：${subcommand}\n\n${CATALOG_COMMAND_USAGE}`);
}
function parseScan(args) {
	if (args.length === 0) return { kind: "scan" };
	let all = false;
	const named = [];
	for (const token of args) if (token === "--all") all = true;
	else named.push(token);
	const values = parseNamedArguments(named, /* @__PURE__ */ new Set(["schema", "table"]));
	const schema = values.get("schema");
	const table = values.get("table");
	if (all && (schema !== void 0 || table !== void 0)) throw new Error("--all 不能与 --schema/--table 同时使用");
	if (table !== void 0 && schema === void 0) throw new Error("--table 必须与 --schema 同时提供");
	if (all) return {
		kind: "scan",
		scope: { kind: "source" }
	};
	if (schema !== void 0 && table !== void 0) return {
		kind: "scan",
		scope: {
			kind: "table",
			schema,
			table
		}
	};
	if (schema !== void 0) return {
		kind: "scan",
		scope: {
			kind: "schema",
			schema
		}
	};
	throw new Error(`scan 必须显式提供 --all 或 --schema。\n\n${CATALOG_COMMAND_USAGE}`);
}
async function askForCatalogScope(ctx, invocation) {
	const questions = ctx.get("userQuestions");
	if (questions === void 0) return void 0;
	try {
		const kind = answerValue$1(await questions.ask({
			agent: invocation.agent,
			signal: invocation.signal,
			questions: [{
				id: "scope",
				header: "扫描范围",
				question: "选择 Catalog 扫描范围（不会读取业务明细）",
				options: [
					{ label: "单表" },
					{ label: "Schema" },
					{ label: "全库" }
				]
			}]
		}), "scope");
		if (kind === "全库") {
			if (answerValue$1(await questions.ask({
				agent: invocation.agent,
				signal: invocation.signal,
				questions: [{
					id: "confirm",
					header: "确认全库",
					question: "确认扫描当前数据源的全部可见Schema和对象？",
					options: [{ label: "取消" }, { label: "确认" }]
				}]
			}), "confirm") !== "确认") throw new Error("已取消 Catalog 扫描。");
			return { kind: "source" };
		}
		if (kind !== "Schema" && kind !== "单表") throw new Error("未选择有效的扫描范围");
		const detail = await questions.ask({
			agent: invocation.agent,
			signal: invocation.signal,
			questions: [{
				id: "schema",
				header: "Schema",
				question: "输入要扫描的 Schema / database 名称"
			}, ...kind === "单表" ? [{
				id: "table",
				header: "表或视图",
				question: "输入要扫描的表或视图名称"
			}] : []]
		});
		const schema = answerValue$1(detail, "schema")?.trim();
		if (schema === void 0 || schema.length === 0) throw new Error("Schema 不能为空");
		if (kind === "Schema") return {
			kind: "schema",
			schema
		};
		const table = answerValue$1(detail, "table")?.trim();
		if (table === void 0 || table.length === 0) throw new Error("表或视图名称不能为空");
		return {
			kind: "table",
			schema,
			table
		};
	} catch (error) {
		if (error.code === "NO_PROVIDER") return void 0;
		throw error;
	}
}
async function resolveCommandSourceId(ctx, sessionId) {
	const connected = ctx.dataAgentConnections.get(sessionId)?.profileId;
	if (connected !== void 0 && ctx.dataAgentCatalog.status(connected) !== void 0) return connected;
	const sources = ctx.dataAgentCatalog.listSources();
	return sources.length === 1 ? sources[0].id : void 0;
}
async function requireCommandSourceId(ctx, sessionId) {
	const sourceId = await resolveCommandSourceId(ctx, sessionId);
	if (sourceId === void 0) throw new Error("无法确定 Catalog source；请连接对应profile或在Web选择source");
	return sourceId;
}
function formatScope(scope) {
	if (scope.kind === "source") return "全库";
	if (scope.kind === "schema") return `Schema ${scope.schema}`;
	return `${scope.schema}.${scope.table}`;
}
function formatCatalogDiff(diff) {
	const groups = /* @__PURE__ */ new Map();
	for (const item of diff.items) groups.set(item.kind, (groups.get(item.kind) ?? 0) + 1);
	const summary = [
		"added",
		"changed",
		"missing",
		"restored",
		"unavailable"
	].map((kind) => `${kind}: ${groups.get(kind) ?? 0}`).join("，");
	const details = diff.items.slice(0, 20).map((item) => `- [${item.kind}] ${item.path}: ${item.summary.join("; ")}`);
	return [
		`Catalog diff ${diff.fromRunId} → ${diff.toRunId}`,
		`范围: ${formatScope(diff.scope)}`,
		summary,
		...details,
		...diff.truncated ? ["结果已截断；请在Web数据目录继续查看。"] : []
	].join("\n");
}
function parseNamedArguments(tokens, allowed) {
	const values = /* @__PURE__ */ new Map();
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (/password|secret|credential/i.test(token)) throw new Error("Catalog 命令不接受任何secret或credential参数");
		if (!token.startsWith("--")) throw new Error(`无法解析参数：${token}\n\n${CATALOG_COMMAND_USAGE}`);
		const assignment = token.slice(2).split("=", 2);
		const key = assignment[0];
		if (!allowed.has(key)) throw new Error(`未知 Catalog 参数：--${key}\n\n${CATALOG_COMMAND_USAGE}`);
		const value = assignment.length === 2 ? assignment[1] : tokens[++index];
		if (value === void 0 || value.startsWith("--") || value.length === 0 || value.length > 256) throw new Error(`参数 --${key} 缺少有效值`);
		if (values.has(key)) throw new Error(`参数 --${key} 不能重复`);
		values.set(key, value);
	}
	return values;
}
function answerValue$1(answer, id) {
	const item = answer.answers.find((candidate) => candidate.id === id);
	return item?.custom ?? item?.selected[0];
}
function splitCommandLine$1(value) {
	const tokens = [];
	let token = "";
	let quote;
	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
		if (quote !== void 0) {
			if (char === quote) quote = void 0;
			else token += char;
			continue;
		}
		if (char === "\"" || char === "'") quote = char;
		else if (/\s/.test(char)) {
			if (token.length > 0) {
				tokens.push(token);
				token = "";
			}
		} else token += char;
	}
	if (quote !== void 0) throw new Error("Catalog 命令包含未闭合引号");
	if (token.length > 0) tokens.push(token);
	return tokens;
}
//#endregion
//#region src/catalog-tui.ts
const STATUS_KEY = "data-agent:catalog";
const SCENE_ID = "data-agent-catalog";
const POLL_INTERVAL_MS = 750;
const SEARCH_PAGE_SIZE = 50;
const DETAIL_PAGE_SIZE = 200;
/** Create an adapter only from public optional services exposed by dsh-tui. */
function createCatalogTuiAdapter(ctx) {
	let sessionId;
	let runId;
	let sourceId;
	let timer;
	let clearStatus;
	let disposed = false;
	const replaceStatus = (text) => {
		clearStatus?.();
		clearStatus = void 0;
		if (text === void 0 || disposed) return;
		const statusService = optionalService(ctx, "tuiStatus", (value) => typeof value.set === "function");
		if (statusService === void 0) return;
		try {
			clearStatus = statusService.set(STATUS_KEY, text, ctx);
		} catch (error) {
			ctx.logger.warn("data-agent: unable to update dsh-tui Catalog status: %s", error);
		}
	};
	const stopPolling = () => {
		if (timer !== void 0) clearTimeout(timer);
		timer = void 0;
	};
	const poll = () => {
		stopPolling();
		if (disposed || runId === void 0 || sourceId === void 0) return;
		try {
			const current = ctx.dataAgentCatalog.listRuns(sourceId, 200).find((candidate) => candidate.id === runId);
			if (current === void 0) {
				replaceStatus("Catalog · 无法找到扫描记录 · /catalog status");
				return;
			}
			replaceStatus(formatCatalogTuiStatus(current));
			if (isCatalogRunSettled(current)) return;
		} catch (error) {
			replaceStatus("Catalog · 状态读取失败 · /catalog status");
			ctx.logger.warn("data-agent: unable to poll dsh-tui Catalog status: %s", error);
			return;
		}
		timer = setTimeout(poll, POLL_INTERVAL_MS);
		timer.unref?.();
	};
	let scenesService;
	let disposeScene;
	const ensureScene = () => {
		if (disposeScene !== void 0) return true;
		scenesService = optionalService(ctx, "tuiScenes", (value) => typeof value.register === "function" && typeof value.open === "function");
		if (scenesService === void 0) return false;
		try {
			disposeScene = scenesService.register({
				id: SCENE_ID,
				title: "Data Catalog",
				component: (props) => props.React.createElement(CatalogScene, {
					...props,
					ctx,
					sessionId
				})
			}, ctx);
		} catch (error) {
			ctx.logger.warn("data-agent: unable to register dsh-tui Catalog scene: %s", error);
			return false;
		}
		return true;
	};
	ensureScene();
	return {
		watch(run) {
			runId = run.id;
			sourceId = run.sourceId;
			replaceStatus(formatCatalogTuiStatus(run));
			if (!isCatalogRunSettled(run)) {
				timer = setTimeout(poll, POLL_INTERVAL_MS);
				timer.unref?.();
			}
		},
		open(nextSessionId) {
			if (!ensureScene() || scenesService === void 0) return false;
			sessionId = nextSessionId;
			stopPolling();
			replaceStatus(void 0);
			try {
				return scenesService.open(SCENE_ID);
			} catch (error) {
				ctx.logger.warn("data-agent: unable to open dsh-tui Catalog scene: %s", error);
				return false;
			}
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			stopPolling();
			replaceStatus(void 0);
			disposeScene?.();
			disposeScene = void 0;
		}
	};
}
/** One bounded status-line projection shared by the adapter and tests. */
function formatCatalogTuiStatus(run) {
	const progress = `${run.progress.schemas} Schema · ${run.progress.relations} 表/视图 · ${run.progress.fields} 字段`;
	if (run.status === "queued") return "Catalog · 等待扫描 · 0 Schema · 0 表/视图 · 0 字段";
	if (run.status === "running") return `Catalog · 正在读取技术元数据 · ${progress}`;
	if (run.status === "applying") return `Catalog · 正在发布技术目录 · ${progress}`;
	if (run.status === "failed") return "Catalog · ✕ 技术扫描失败 · /catalog status";
	if (run.status === "cancelled") return "Catalog · 已取消技术扫描 · /catalog status";
	if (run.status === "interrupted") return "Catalog · 扫描被中断 · /catalog status";
	const enrichment = run.enrichment;
	if (enrichment === void 0) return `Catalog · ✓ 技术目录完成 · ${progress} · /catalog view`;
	const aiProgress = `${enrichment.tablesCompleted}/${enrichment.tablesTotal} 表 · ${enrichment.candidatesGenerated} 候选`;
	if (enrichment.status === "queued") return `Catalog · 等待生成AI业务含义 · ${aiProgress}`;
	if (enrichment.status === "running") return `Catalog · 正在生成AI业务含义 · ${aiProgress}${enrichment.tablesFailed > 0 ? ` · ${enrichment.tablesFailed} 失败` : ""}`;
	if (enrichment.status === "succeeded") return `Catalog · ✓ 完成 · ${aiProgress} · /catalog view`;
	if (enrichment.status === "partial") return `Catalog · ⚠ 技术目录完成，AI部分成功 · ${aiProgress} · ${enrichment.tablesFailed} 失败 · /catalog view`;
	if (enrichment.status === "cancelled") return `Catalog · 技术目录完成，AI已取消 · ${aiProgress} · /catalog view`;
	return `Catalog · 技术目录完成，AI生成失败 · ${aiProgress} · /catalog view`;
}
function isCatalogRunSettled(run) {
	if (run.status === "queued" || run.status === "running" || run.status === "applying") return false;
	if (run.status !== "succeeded") return true;
	return run.enrichment === void 0 || run.enrichment.status !== "queued" && run.enrichment.status !== "running";
}
/** Text projection for the independently scrollable right pane. */
function buildCatalogTuiDetailLines(detail) {
	const meaningByAsset = /* @__PURE__ */ new Map();
	for (const semantic of detail.semantics) if (semantic.definition.kind === "meaning") meaningByAsset.set(semantic.definition.targetAssetId, semantic);
	const tableMeaning = meaningByAsset.get(detail.asset.assetId);
	const lines = [
		detail.asset.payload.name,
		detail.asset.payload.path,
		`状态 ${detail.asset.status} · ${detail.fields.length}${detail.truncated ? "+" : ""} 字段 · ${detail.relations.length} 关系`
	];
	if (detail.asset.payload.comment !== void 0) lines.push(`数据库注释：${detail.asset.payload.comment}`);
	lines.push("", "表业务含义");
	if (tableMeaning?.definition.kind === "meaning") lines.push(`[${tableMeaning.definition.status}] ${tableMeaning.definition.description}`, `AI来源 ${tableMeaning.definition.generatedBy.provider}/${tableMeaning.definition.generatedBy.model} · ${tableMeaning.definition.generatedBy.runId}`);
	else lines.push("— 尚无表级业务含义候选");
	lines.push("", "字段业务含义");
	for (const field of detail.fields) {
		const meaning = meaningByAsset.get(field.assetId);
		const type = field.payload.dataType ?? "类型未知";
		const nullable = field.payload.nullable === void 0 ? "" : field.payload.nullable ? " · 可空" : " · 非空";
		lines.push(`${field.payload.name} · ${type}${nullable}`);
		lines.push(meaning?.definition.kind === "meaning" ? `  [${meaning.definition.status}] ${meaning.definition.description}` : "  — 尚无AI业务含义");
	}
	if (detail.fields.length === 0) lines.push("— 没有字段");
	if (detail.truncated) lines.push("", "字段过多，当前只显示有界详情页；可在Web数据目录查看其余字段。");
	if (detail.relations.length > 0) {
		lines.push("", "关系");
		for (const relation of detail.relations) lines.push(`${relation.kind}${relation.name === void 0 ? "" : ` · ${relation.name}`} · ${relation.columnAssetIds.length} 字段`);
	}
	return lines;
}
function CatalogScene(props) {
	const { React, ui, close, ctx, sessionId } = props;
	const h = React.createElement;
	const { columns, rows } = ui.useTerminalSize();
	const [source, setSource] = React.useState();
	const [status, setStatus] = React.useState();
	const [items, setItems] = React.useState([]);
	const [nextCursor, setNextCursor] = React.useState();
	const [selected, setSelected] = React.useState(0);
	const [detail, setDetail] = React.useState();
	const [focus, setFocus] = React.useState("list");
	const [detailScroll, setDetailScroll] = React.useState(0);
	const [query, setQuery] = React.useState("");
	const [queryDraft, setQueryDraft] = React.useState("");
	const [queryOpen, setQueryOpen] = React.useState(false);
	const [allSchemas, setAllSchemas] = React.useState(false);
	const [loading, setLoading] = React.useState(true);
	const [loadingMore, setLoadingMore] = React.useState(false);
	const [error, setError] = React.useState();
	const [refreshNonce, setRefreshNonce] = React.useState(0);
	const [liveNonce, setLiveNonce] = React.useState(0);
	const searchRequest = React.useCallback((selectedSource, cursor) => ({
		query: query.trim() === "" ? "*" : query.trim(),
		filters: {
			sourceId: selectedSource.id,
			...!allSchemas && defaultBrowseSchema(selectedSource) !== "" ? { schema: defaultBrowseSchema(selectedSource) } : {},
			assetKinds: ["table", "view"],
			assetStatuses: ["observed"],
			includeInferred: true
		},
		...cursor !== void 0 ? { cursor } : {},
		pageSize: SEARCH_PAGE_SIZE
	}), [query, allSchemas]);
	React.useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(void 0);
		if (sessionId === void 0) {
			setError("无法确定当前data-agent会话。");
			setLoading(false);
			return () => {
				cancelled = true;
			};
		}
		ctx.dataAgentCatalog.resolveSource(sessionId).then(async (nextSource) => {
			const page = await ctx.dataAgentCatalog.search(searchRequest(nextSource));
			if (cancelled) return;
			setSource(nextSource);
			setStatus(ctx.dataAgentCatalog.status(nextSource.id));
			setItems(page.items);
			setNextCursor(page.nextCursor);
			setSelected((previous) => Math.min(previous, Math.max(0, page.items.length - 1)));
		}).catch((cause) => {
			if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
		}).finally(() => {
			if (!cancelled) setLoading(false);
		});
		return () => {
			cancelled = true;
		};
	}, [
		ctx,
		sessionId,
		searchRequest,
		refreshNonce
	]);
	const selectedItem = items[selected];
	React.useEffect(() => {
		if (source === void 0 || selectedItem === void 0) {
			setDetail(void 0);
			return;
		}
		try {
			setDetail(ctx.dataAgentCatalog.getAsset(source.id, selectedItem.id, void 0, DETAIL_PAGE_SIZE));
			setError(void 0);
		} catch (cause) {
			setDetail(void 0);
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	}, [
		ctx,
		source,
		selectedItem?.id,
		refreshNonce,
		liveNonce
	]);
	React.useEffect(() => setDetailScroll(0), [selectedItem?.id]);
	React.useEffect(() => {
		if (source === void 0) return;
		const timer = setInterval(() => {
			const next = ctx.dataAgentCatalog.status(source.id);
			setStatus(next);
			const run = next?.latestRun;
			if (run !== void 0 && !isCatalogRunSettled(run)) setLiveNonce((value) => value + 1);
		}, 1e3);
		return () => clearInterval(timer);
	}, [ctx, source]);
	const loadMore = React.useCallback(() => {
		if (source === void 0 || nextCursor === void 0 || loadingMore) return;
		setLoadingMore(true);
		ctx.dataAgentCatalog.search(searchRequest(source, nextCursor)).then((page) => {
			setItems((previous) => [...previous, ...page.items]);
			setNextCursor(page.nextCursor);
		}).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setLoadingMore(false));
	}, [
		ctx,
		source,
		nextCursor,
		loadingMore,
		searchRequest
	]);
	const compact = columns < 92;
	const contentRows = Math.max(6, rows - 4);
	const listRows = compact ? Math.max(3, Math.floor(contentRows * .42)) : contentRows;
	const detailRows = compact ? Math.max(3, contentRows - listRows) : contentRows;
	const leftWidth = compact ? columns - 2 : Math.max(30, Math.min(48, Math.floor(columns * .34)));
	const rightWidth = compact ? columns - 2 : Math.max(30, columns - leftWidth - 3);
	const visibleListRows = Math.max(1, listRows - 2);
	const visibleDetailRows = Math.max(1, detailRows - 2);
	const listStart = Math.max(0, Math.min(selected - Math.floor(visibleListRows / 2), items.length - visibleListRows));
	const visibleItems = items.slice(listStart, listStart + visibleListRows);
	const detailLines = detail === void 0 ? [] : buildCatalogTuiDetailLines(detail);
	const maxDetailScroll = Math.max(0, detailLines.length - visibleDetailRows);
	const clampedDetailScroll = Math.min(detailScroll, maxDetailScroll);
	const visibleDetail = detailLines.slice(clampedDetailScroll, clampedDetailScroll + visibleDetailRows);
	const moveList = React.useCallback((delta) => {
		setSelected((previous) => {
			const next = Math.max(0, Math.min(items.length - 1, previous + delta));
			if (next >= items.length - 3 && nextCursor !== void 0) loadMore();
			return next;
		});
	}, [
		items.length,
		nextCursor,
		loadMore
	]);
	ui.useInput((input, key) => {
		if (queryOpen) {
			if (key.escape) {
				setQueryOpen(false);
				setQueryDraft(query);
				return;
			}
			if (key.return) {
				setQuery(queryDraft.trim());
				setSelected(0);
				setQueryOpen(false);
				return;
			}
			if (key.backspace || key.delete) {
				setQueryDraft((previous) => previous.slice(0, -1));
				return;
			}
			if (input !== "" && !key.ctrl && !key.meta && !key.super) setQueryDraft((previous) => (previous + input.replace(/[\r\n\u0000-\u001f\u007f]/g, "")).slice(0, 120));
			return;
		}
		if (key.escape || input === "q") return close();
		if (input === "/") {
			setQueryDraft(query);
			setQueryOpen(true);
			return;
		}
		if (input === "r") {
			setRefreshNonce((value) => value + 1);
			return;
		}
		if (input === "a") {
			setAllSchemas((previous) => !previous);
			setSelected(0);
			return;
		}
		if (key.tab || focus === "list" && (key.rightArrow || key.return) || focus === "detail" && key.leftArrow) {
			setFocus((previous) => previous === "list" ? "detail" : "list");
			return;
		}
		if (focus === "list") {
			if (key.upArrow || input === "k") return moveList(-1);
			if (key.downArrow || input === "j") return moveList(1);
			if (key.pageUp) return moveList(-visibleListRows);
			if (key.pageDown) return moveList(visibleListRows);
			if (key.home || input === "g") return setSelected(0);
			if (key.end || input === "G") {
				setSelected(Math.max(0, items.length - 1));
				loadMore();
			}
			return;
		}
		if (key.upArrow || input === "k") return setDetailScroll((previous) => Math.max(0, previous - 1));
		if (key.downArrow || input === "j") return setDetailScroll((previous) => Math.min(maxDetailScroll, previous + 1));
		if (key.pageUp) return setDetailScroll((previous) => Math.max(0, previous - visibleDetailRows));
		if (key.pageDown) return setDetailScroll((previous) => Math.min(maxDetailScroll, previous + visibleDetailRows));
		if (key.home || input === "g") return setDetailScroll(0);
		if (key.end || input === "G") setDetailScroll(maxDetailScroll);
	});
	const latestRun = status?.latestRun;
	const headerStatus = latestRun === void 0 ? "尚无扫描" : formatCatalogTuiStatus(latestRun).replace(/^Catalog · /, "");
	const sourceLabel = source === void 0 ? "正在解析数据源…" : `${source.name} · ${status?.counts.assets ?? 0} 资产 · ${status?.counts.needsReview ?? 0} 待确认`;
	const searchLabel = queryOpen ? `/ ${queryDraft}▌` : `${query === "" ? "全部表与视图" : `搜索：${query}`} · ${allSchemas || source === void 0 || defaultBrowseSchema(source) === "" ? "全部Schema" : defaultBrowseSchema(source)}`;
	const listPane = h(ui.Box, {
		flexDirection: "column",
		width: compact ? "100%" : leftWidth,
		height: listRows,
		borderStyle: "single",
		borderColor: focus === "list" ? "permission" : "subtle",
		paddingX: 1
	}, h(ui.Text, {
		bold: true,
		color: focus === "list" ? "permission" : void 0,
		wrap: "truncate"
	}, `表与视图 · ${items.length}${nextCursor === void 0 ? "" : "+"}`), ...visibleItems.map((item, index) => {
		const active = listStart + index === selected;
		return h(ui.Text, {
			key: item.id,
			inverse: active,
			bold: active,
			wrap: "truncate"
		}, `${active ? "›" : " "} ${item.name}  [${item.status}]`);
	}), ...items.length === 0 && !loading ? [h(ui.Text, {
		key: "empty",
		color: "subtle"
	}, "（没有匹配的表或视图）")] : [], ...loading || loadingMore ? [h(ui.Text, {
		key: "loading",
		color: "suggestion"
	}, loadingMore ? "继续加载…" : "加载目录…")] : []);
	const rightPane = h(ui.Box, {
		flexDirection: "column",
		width: compact ? "100%" : rightWidth,
		height: detailRows,
		borderStyle: "single",
		borderColor: focus === "detail" ? "permission" : "subtle",
		paddingX: 1
	}, h(ui.Text, {
		bold: true,
		color: focus === "detail" ? "permission" : void 0,
		wrap: "truncate"
	}, selectedItem === void 0 ? "表详情" : `${selectedItem.name} · ${clampedDetailScroll + 1}/${Math.max(1, detailLines.length)}`), ...visibleDetail.map((line, index) => h(ui.Text, {
		key: `${clampedDetailScroll + index}:${line}`,
		color: line.startsWith("表业务含义") || line.startsWith("字段业务含义") || line === "关系" ? "claude" : void 0,
		bold: line === detail?.asset.payload.name || line.startsWith("表业务含义") || line.startsWith("字段业务含义") || line === "关系",
		wrap: "truncate"
	}, line === "" ? " " : line)), ...selectedItem !== void 0 && detail === void 0 && !loading ? [h(ui.Text, {
		key: "detail-loading",
		color: "suggestion"
	}, "加载详情…")] : [], ...selectedItem === void 0 && !loading ? [h(ui.Text, {
		key: "detail-empty",
		color: "subtle"
	}, "从左侧选择一张表查看AI业务含义。")] : []);
	return h(ui.Box, {
		flexDirection: "column",
		width: "100%",
		paddingX: 1
	}, h(ui.Text, {
		bold: true,
		color: "claude",
		wrap: "truncate"
	}, `✦ 数据目录  ${sourceLabel}`), h(ui.Text, {
		color: latestRun?.status === "failed" ? "error" : "subtle",
		wrap: "truncate"
	}, headerStatus), h(ui.Text, {
		color: queryOpen ? "suggestion" : "subtle",
		wrap: "truncate"
	}, searchLabel), ...error === void 0 ? [] : [h(ui.Text, {
		key: "error",
		color: "error",
		wrap: "truncate"
	}, `错误：${error}`)], h(ui.Box, {
		flexDirection: compact ? "column" : "row",
		width: "100%",
		height: contentRows,
		gap: compact ? 0 : 1
	}, listPane, rightPane), h(ui.Text, {
		dimColor: true,
		italic: true,
		wrap: "truncate"
	}, "↑↓/jk 滚动 · Tab/←→ 切换区域 · / 搜索 · a 全部Schema · r 刷新 · Esc/q 返回 · 只读，确认/删除请使用Web"));
}
function optionalService(ctx, name, validate) {
	const value = ctx.get(name);
	if (value === void 0 || value === null || typeof value !== "object") return void 0;
	return validate(value) ? value : void 0;
}
function defaultBrowseSchema(source) {
	return [
		"mysql",
		"clickhouse",
		"doris",
		"hive",
		"impala"
	].includes(source.type) ? source.database : "";
}
//#endregion
//#region src/command.ts
const name = "data-agent-database-command";
const inject = [
	"commands",
	"dataAgentConnections",
	"dataAgentCatalog",
	"dataAgentCatalogScanner",
	"tools"
];
const DATABASE_COMMAND_USAGE = [
	"用法：",
	"  /database status",
	`  /database connect --type <${DATABASE_TYPES.join("|")}> --database <name|path> [--host <host>] [--port <port>] [--user <user>] [--password-ref <REF>] [--readonly] [--secure]`,
	"  /database test",
	"  /database disconnect",
	"安全提示：TUI 无参数 connect 可输入掩码临时密码；命令参数不接受 --password，请使用 --password-ref。"
].join("\n");
const DATA_AGENT_TOOL_NAMES = [
	"str_replace_editor",
	"sql-query",
	"sql-write",
	"sql-cmd",
	"catalog-search",
	"catalog-get",
	"metric-get"
];
const DATA_AGENT_OWN_TOOL_NAMES = /* @__PURE__ */ new Set([
	...DATA_AGENT_TOOL_NAMES,
	"render-analysis",
	RUN_CODE_NAME
]);
const defaultInteraction = {
	isTuiFormAvailable: () => isDshTuiTerminal(),
	collectTuiConnection: (signal, options) => runTuiConnectionForm({
		signal,
		...options.initialDraft !== void 0 ? { initialDraft: options.initialDraft } : {},
		persistDraft: options.persistDraft
	})
};
/** Official Cordis runtime name exported by `@deepseek-harness-tui/dsh-tui`. */
const DSH_TUI_PLUGIN_RUNTIME_NAME = "dsh-tui";
/**
* Detect actual plugin usage from Cordis' live registry. Package installation,
* argv and profile labels are deliberately irrelevant.
*/
function isDshTuiPluginLoaded(ctx) {
	for (const runtime of ctx.registry.values()) {
		if (runtime.name !== "dsh-tui") continue;
		for (const fiber of runtime.fibers) if (fiber.uid !== null) return true;
	}
	return false;
}
/** Mount both human commands and return one symmetric disposer. */
function registerDshTuiCommands(ctx) {
	const catalogTui = createCatalogTuiAdapter(ctx);
	const disposeDatabase = ctx.commands.register({
		name: "database",
		description: "查看、连接、测试或断开 data-agent 数据库连接",
		input: { hint: "status | connect | test | disconnect" },
		recordInput: false,
		handler: async (invocation) => executeDatabaseCommand(ctx, invocation)
	});
	const disposeCatalog = registerCatalogCommand(ctx, catalogTui);
	const refreshTimer = setTimeout(() => ctx.emit("commands/change"), 0);
	return () => {
		clearTimeout(refreshTimer);
		disposeCatalog();
		catalogTui.dispose();
		disposeDatabase();
	};
}
/** Keep the tool boundary everywhere; follow the actual dsh-tui runtime lifecycle for commands. */
function apply(ctx, options = {}) {
	const inheritedToolNames = ctx.tools.schemas().map((schema) => schema.name).filter((toolName) => !DATA_AGENT_OWN_TOOL_NAMES.has(toolName));
	ctx.tools.restrict({ deny: inheritedToolNames });
	const detect = options.isDshTuiPluginLoaded ?? isDshTuiPluginLoaded;
	let disposeCommands;
	const reconcile = () => {
		const shouldRegister = detect(ctx);
		if (shouldRegister && disposeCommands === void 0) disposeCommands = registerDshTuiCommands(ctx);
		else if (!shouldRegister && disposeCommands !== void 0) {
			disposeCommands();
			disposeCommands = void 0;
		}
	};
	reconcile();
	if (options.isDshTuiPluginLoaded === void 0) ctx.on("internal/plugin", reconcile, { global: true });
	ctx.effect(() => () => {
		disposeCommands?.();
		disposeCommands = void 0;
	}, "data-agent: dsh-tui human command adapters");
}
/** Public for focused command tests and alternate command adapters. */
async function executeDatabaseCommand(ctx, invocation, interaction = defaultInteraction) {
	let transientPassword;
	try {
		const action = parseDatabaseAction(invocation.rawInput);
		const sessionId = String(invocation.agent.id);
		switch (action.kind) {
			case "status": {
				const summary = await ctx.dataAgentConnections.status(sessionId);
				const tools = ctx.tools.schemas(invocation.agent).map((schema) => schema.name).sort();
				return {
					kind: "success",
					text: `${formatConnectionStatus(summary)}\n模型工具：${tools.join(", ") || "（无）"}\n\n${DATABASE_COMMAND_USAGE}`
				};
			}
			case "connect": {
				const input = action.input ?? await askForConnection(ctx, invocation, interaction);
				if (input === void 0) return {
					kind: "error",
					text: `当前界面没有可用的问答 provider。\n\n${DATABASE_COMMAND_USAGE}`
				};
				transientPassword = input.password;
				return {
					kind: "success",
					text: `数据库连接成功。\n${formatConnectionStatus((await ctx.dataAgentConnections.connect(sessionId, input, invocation.signal)).summary)}`
				};
			}
			case "test": {
				const result = await ctx.dataAgentConnections.test(sessionId, invocation.signal);
				return {
					kind: "success",
					text: `数据库连接测试成功，发现 ${result.tables.length} 张表。\n${formatConnectionStatus(result.summary)}`
				};
			}
			case "disconnect":
				await ctx.dataAgentConnections.disconnect(sessionId);
				return {
					kind: "success",
					text: "当前会话已断开数据库连接；可复用的非敏感 connection profile 已保留。"
				};
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			kind: "error",
			text: redactSecretText(message, [transientPassword])
		};
	} finally {
		transientPassword = void 0;
	}
}
/** Parse one command's raw input without ever accepting a plaintext password. */
function parseDatabaseAction(rawInput) {
	const tokens = splitCommandLine(rawInput.trim());
	if (tokens.length === 0 || tokens[0] === "status") {
		if (tokens.length > 1) throw new Error(`status 不接受额外参数。\n\n${DATABASE_COMMAND_USAGE}`);
		return { kind: "status" };
	}
	const subcommand = tokens[0];
	if (subcommand === "test" || subcommand === "disconnect") {
		if (tokens.length > 1) throw new Error(`${subcommand} 不接受额外参数。\n\n${DATABASE_COMMAND_USAGE}`);
		return { kind: subcommand };
	}
	if (subcommand !== "connect") throw new Error(`未知 database 子命令：${subcommand}\n\n${DATABASE_COMMAND_USAGE}`);
	if (tokens.length === 1) return { kind: "connect" };
	return {
		kind: "connect",
		input: parseConnectArguments(tokens.slice(1))
	};
}
/** Non-interactive `connect` argument grammar. */
function parseConnectArguments(tokens) {
	const values = /* @__PURE__ */ new Map();
	let readonly;
	let secure;
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token === "--password" || token.startsWith("--password=") || token.startsWith("password=")) throw new Error("安全限制：/database 不接受明文密码参数；请改用 --password-ref <REF>。");
		if (token === "--readonly") {
			readonly = true;
			continue;
		}
		if (token === "--readwrite") {
			readonly = false;
			continue;
		}
		if (token === "--secure") {
			secure = true;
			continue;
		}
		if (token === "--insecure") {
			secure = false;
			continue;
		}
		const assignment = token.startsWith("--") ? token.slice(2).split("=", 2) : token.split("=", 2);
		let key;
		let value;
		if (assignment.length === 2) {
			key = normalizeArgumentName(assignment[0]);
			value = assignment[1];
		} else {
			if (!token.startsWith("--")) throw new Error(`无法解析参数：${token}\n\n${DATABASE_COMMAND_USAGE}`);
			key = normalizeArgumentName(token.slice(2));
			const next = tokens[index + 1];
			if (next === void 0 || next.startsWith("--")) throw new Error(`参数 --${key} 缺少值`);
			value = next;
			index += 1;
		}
		if (key === "password") throw new Error("安全限制：/database 不接受明文密码参数；请改用 --password-ref <REF>。");
		if (!CONNECT_ARGUMENTS.has(key)) throw new Error(`未知连接参数：--${key}\n\n${DATABASE_COMMAND_USAGE}`);
		values.set(key, value);
	}
	const type = values.get("type");
	if (!isDatabaseType(type)) throw new Error("connect 必须提供有效的 --type");
	const database = values.get("database");
	if (database === void 0 || database.length === 0) throw new Error("connect 必须提供 --database");
	const input = {
		type,
		database
	};
	copyNonEmpty(values, "host", (value) => {
		input.host = value;
	});
	copyNonEmpty(values, "user", (value) => {
		input.user = value;
	});
	copyNonEmpty(values, "passwordRef", (value) => {
		input.passwordRef = value;
	});
	copyNonEmpty(values, "profileId", (value) => {
		input.profileId = value;
	});
	copyNonEmpty(values, "name", (value) => {
		input.name = value;
	});
	const port = values.get("port");
	if (port !== void 0) {
		const number = Number(port);
		if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error("--port 必须是 1-65535 的整数");
		input.port = number;
	}
	if (readonly !== void 0) input.readonly = readonly;
	if (type === "clickhouse" && secure !== void 0) input.secure = secure;
	return input;
}
/** Render a public summary; no password-bearing field exists in the type. */
function formatConnectionStatus(summary) {
	if (summary === void 0) return "数据库状态：未连接。";
	const endpoint = summary.type === "sqlite" ? summary.database : `${summary.host ?? "localhost"}${summary.port !== void 0 ? `:${summary.port}` : ""}`;
	const lines = [
		summary.reconnectRequired === true ? "数据库状态：需要重新认证" : "数据库状态：已连接",
		`类型：${summary.type}`,
		`地址：${endpoint}`,
		`数据库：${summary.database}`,
		`只读：${summary.readonly === true ? "是" : "否"}`
	];
	if (summary.type === "clickhouse") lines.push(`HTTPS：${summary.secure === true ? "是" : "否"}`);
	if (summary.user !== void 0) lines.push(`用户：${summary.user}`);
	if (summary.profileId !== void 0) lines.push(`Profile：${summary.name ?? summary.profileId}`);
	if (summary.passwordRef !== void 0) lines.push(`凭据引用：${summary.passwordRef}`);
	if (summary.credential !== void 0) lines.push(`凭据：${summary.credential.configured ? `已配置${summary.credential.source !== void 0 ? `（${summary.credential.source}）` : ""}` : "未配置"}`);
	if (summary.tables !== void 0) lines.push(`表：${summary.tables.length} 张`);
	return lines.join("\n");
}
async function askForConnection(ctx, invocation, interaction) {
	if (interaction.isTuiFormAvailable()) {
		const sessionId = String(invocation.agent.id);
		const initialDraft = ctx.dataAgentConnections.getFormDraft?.(sessionId);
		const input = await interaction.collectTuiConnection(invocation.signal, {
			...initialDraft !== void 0 ? { initialDraft } : {},
			persistDraft: async (draft) => {
				await ctx.dataAgentConnections.saveFormDraft?.(sessionId, draft);
			}
		});
		if (input === void 0) throw new Error("已取消数据库连接。");
		return input;
	}
	const questions = ctx.get("userQuestions");
	if (questions === void 0) return void 0;
	try {
		const typeValue = answerValue(await questions.ask({
			agent: invocation.agent,
			signal: invocation.signal,
			questions: [{
				id: "type",
				header: "数据库类型",
				question: "选择要连接的数据库类型",
				options: DATABASE_TYPES.map((label) => ({ label }))
			}]
		}), "type");
		if (!isDatabaseType(typeValue)) throw new Error("未选择有效的数据库类型");
		const detailQuestions = typeValue === "sqlite" ? [{
			id: "database",
			header: "文件路径",
			question: "SQLite 数据库文件路径"
		}, {
			id: "readonly",
			header: "只读",
			question: "是否启用只读模式？",
			options: [{ label: "是" }, { label: "否" }]
		}] : [
			{
				id: "host",
				header: "主机",
				question: "数据库主机（留空使用 127.0.0.1）"
			},
			{
				id: "port",
				header: "端口",
				question: typeValue === "clickhouse" ? `数据库端口（留空使用HTTP ${defaultDatabasePort$1("clickhouse")}；HTTPS ${defaultDatabasePort$1("clickhouse", true)}）` : `数据库端口（留空使用 ${defaultDatabasePort$1(typeValue)}）`
			},
			{
				id: "user",
				header: "用户",
				question: "数据库用户名"
			},
			{
				id: "database",
				header: "数据库",
				question: "数据库名 / Oracle 服务名"
			},
			{
				id: "passwordRef",
				header: "凭据引用",
				question: "DSH credential reference（可留空）"
			},
			...typeValue === "clickhouse" ? [{
				id: "secure",
				header: "HTTPS",
				question: "是否使用HTTPS并验证服务器证书？",
				options: [{ label: "是" }, { label: "否" }]
			}] : [],
			{
				id: "readonly",
				header: "只读",
				question: "是否启用只读模式？",
				options: [{ label: "是" }, { label: "否" }]
			}
		];
		const details = await questions.ask({
			agent: invocation.agent,
			signal: invocation.signal,
			questions: detailQuestions
		});
		const database = answerValue(details, "database")?.trim();
		if (database === void 0 || database.length === 0) throw new Error("database 不能为空");
		const input = {
			type: typeValue,
			database,
			readonly: answerValue(details, "readonly") === "是"
		};
		if (typeValue !== "sqlite") {
			input.host = answerValue(details, "host")?.trim() || "127.0.0.1";
			if (typeValue === "clickhouse") input.secure = answerValue(details, "secure") === "是";
			const portText = answerValue(details, "port")?.trim();
			input.port = portText === void 0 || portText === "" ? defaultDatabasePort$1(typeValue, input.secure === true) : Number(portText);
			const user = answerValue(details, "user")?.trim();
			if (user !== void 0 && user !== "") input.user = user;
			const passwordRef = answerValue(details, "passwordRef")?.trim();
			if (passwordRef !== void 0 && passwordRef !== "") input.passwordRef = passwordRef;
		}
		return input;
	} catch (error) {
		if (error.code === "NO_PROVIDER") return void 0;
		throw error;
	}
}
const CONNECT_ARGUMENTS = /* @__PURE__ */ new Set([
	"type",
	"host",
	"port",
	"user",
	"database",
	"passwordRef",
	"profileId",
	"name"
]);
function normalizeArgumentName(value) {
	return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}
function copyNonEmpty(values, key, apply) {
	const value = values.get(key);
	if (value !== void 0 && value.length > 0) apply(value);
}
function answerValue(answer, id) {
	const item = answer.answers.find((candidate) => candidate.id === id);
	return item?.custom ?? item?.selected[0];
}
/** Minimal shell-like splitter for quoted command arguments; no expansion. */
function splitCommandLine(value) {
	const tokens = [];
	let token = "";
	let quote;
	let escaping = false;
	for (const character of value) {
		if (escaping) {
			token += character;
			escaping = false;
			continue;
		}
		if (character === "\\" && quote !== "'") {
			escaping = true;
			continue;
		}
		if (quote !== void 0) {
			if (character === quote) quote = void 0;
			else token += character;
			continue;
		}
		if (character === "\"" || character === "'") {
			quote = character;
			continue;
		}
		if (/\s/.test(character)) {
			if (token.length > 0) {
				tokens.push(token);
				token = "";
			}
			continue;
		}
		token += character;
	}
	if (escaping) token += "\\";
	if (quote !== void 0) throw new Error("命令参数包含未闭合的引号");
	if (token.length > 0) tokens.push(token);
	return tokens;
}
//#endregion
export { executeDatabaseCommand as a, isDshTuiPluginLoaded as c, parseDatabaseAction as d, apply as i, name as l, DATA_AGENT_TOOL_NAMES as n, formatConnectionStatus as o, DSH_TUI_PLUGIN_RUNTIME_NAME as r, inject as s, DATABASE_COMMAND_USAGE as t, parseConnectArguments as u };
