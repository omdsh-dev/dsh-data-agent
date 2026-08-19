import { d as defaultDatabasePort$1, l as DATABASE_TYPES, p as isDatabaseType, u as databaseTypeLabel$1 } from "./defaults-Cngd8Tf8.js";
import { i as validatePasswordRef, r as redactSecretText } from "./connections-CHY4uB6z.js";
import { RUN_CODE_NAME } from "@deepseek-ai/dsh-tools";
//#region src/tui-connection-form.ts
/**
* Short-lived ANSI connection form used by `/database connect` in dsh-tui.
*
* dsh-tui 0.6.x exposes commands but no public custom-form/sensitive-input
* slot. This adapter therefore owns a small terminal form and only activates
* for an interactive `dsh-tui` profile. It snapshots the host's `readable`
* listeners, consumes input for the lifetime of the form, then restores the
* listeners exactly. It never imports dsh-tui, React, or Ink.
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
/** Detect the supported host without coupling to dsh-tui modules. */
function isDshTuiTerminal(argv = process.argv, input = process.stdin, output = process.stdout) {
	if (input.isTTY !== true || output.isTTY !== true) return false;
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === "--profile" && argv[index + 1] === "dsh-tui") return true;
		if (value === "--profile=dsh-tui") return true;
	}
	return false;
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
//#region src/command.ts
const name = "data-agent-database-command";
const inject = [
	"commands",
	"dataAgentConnections",
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
	"sql-cmd"
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
/** Register the command in the calling preset/agent scope. */
function apply(ctx) {
	const inheritedToolNames = ctx.tools.schemas().map((schema) => schema.name).filter((toolName) => !DATA_AGENT_OWN_TOOL_NAMES.has(toolName));
	ctx.tools.restrict({ deny: inheritedToolNames });
	ctx.commands.register({
		name: "database",
		description: "查看、连接、测试或断开 data-agent 数据库连接",
		input: { hint: "status | connect | test | disconnect" },
		recordInput: false,
		handler: async (invocation) => executeDatabaseCommand(ctx, invocation)
	});
	const refreshTimer = setTimeout(() => ctx.emit("commands/change"), 0);
	ctx.effect(() => () => clearTimeout(refreshTimer), "data-agent: refresh scoped command adapters");
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
export { formatConnectionStatus as a, parseConnectArguments as c, executeDatabaseCommand as i, parseDatabaseAction as l, DATA_AGENT_TOOL_NAMES as n, inject as o, apply as r, name as s, DATABASE_COMMAND_USAGE as t };
