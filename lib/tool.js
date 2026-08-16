import { a as classifyStatement, c as assertSingleStatement, i as runClientQuery, n as redactQueryResult, o as clientsSchema, r as redactSecretText, s as enforceReadRowLimit } from "./connections-DeauhaZi.js";
import { i as DEFAULT_MAX_RESULT_CHARS, o as DEFAULT_QUERY_TIMEOUT_MS, r as DEFAULT_MAX_QUERY_CHARS } from "./defaults-DP4RyRh1.js";
import z from "schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
const VIEW_KINDS = [
	"metric",
	"line",
	"bar",
	"pie",
	"scatter",
	"table"
];
const AXIS_TYPES = ["category", "time"];
const WIDTHS = ["full", "half"];
const METRIC_FORMATS = ["number", "percent"];
function fail(message) {
	throw new Error(message);
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Reject keys outside the allowed set (additionalProperties=false semantics). */
function assertOnlyKeys(record, allowed, label) {
	for (const key of Object.keys(record)) if (!allowed.includes(key)) fail(label + ": 不支持的字段 \"" + key + "\"");
}
function requireNonEmptyString(value, label) {
	if (typeof value !== "string" || value.trim().length === 0) fail(label + ": 必须是非空字符串");
	return value;
}
function optionalString(record, key, label) {
	const value = record[key];
	if (value === void 0) return void 0;
	if (typeof value !== "string") fail(label + "." + key + ": 必须是字符串");
	return value;
}
function optionalEnum(record, key, allowed, label) {
	const value = record[key];
	if (value === void 0) return void 0;
	if (typeof value !== "string" || !allowed.includes(value)) fail(label + "." + key + ": 必须是 " + allowed.join("/") + " 之一");
	return value;
}
/** Read a required non-empty string field with a concrete error path. */
function requiredStringField(record, key, label) {
	return requireNonEmptyString(record[key], label + "." + key);
}
/** Read an optional array of unique non-empty strings (the table whitelist). */
function optionalStringArray(record, key, label) {
	const value = record[key];
	if (value === void 0) return void 0;
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) fail(label + "." + key + ": 必须是非空字符串数组");
	const items = value.map((item) => item);
	if (new Set(items).size !== items.length) fail(label + "." + key + ": 列名不能重复");
	return items;
}
function parseXAxis(value, label) {
	if (!isRecord(value)) fail(label + ".x: 必须是对象 { field, type, label? }");
	assertOnlyKeys(value, [
		"field",
		"type",
		"label"
	], label + ".x");
	const field = requiredStringField(value, "field", label + ".x");
	const type = optionalEnum(value, "type", AXIS_TYPES, label + ".x");
	if (type === void 0) fail(label + ".x.type: 必须是 category/time 之一");
	const axisLabel = optionalString(value, "label", label + ".x");
	const axis = {
		field,
		type
	};
	if (axisLabel !== void 0) axis.label = axisLabel;
	return axis;
}
function parseView(value, label, datasetIds) {
	if (!isRecord(value)) fail(label + ": 必须是对象");
	const kind = value["kind"];
	if (typeof kind !== "string" || !VIEW_KINDS.includes(kind)) fail(label + ": kind 必须是 metric/line/bar/pie/scatter/table 之一");
	const viewKind = kind;
	const id = requiredStringField(value, "id", label);
	const datasetId = requiredStringField(value, "datasetId", label);
	if (!datasetIds.has(datasetId)) fail(label + ": 引用了不存在的 dataset id \"" + datasetId + "\"");
	if (viewKind === "metric") {
		assertOnlyKeys(value, [
			"id",
			"kind",
			"datasetId",
			"field",
			"label",
			"format"
		], label);
		const metric = {
			id,
			kind: "metric",
			datasetId,
			field: requiredStringField(value, "field", label),
			label: requiredStringField(value, "label", label)
		};
		const format = optionalEnum(value, "format", METRIC_FORMATS, label);
		if (format !== void 0) metric.format = format;
		return metric;
	}
	const width = optionalEnum(value, "width", WIDTHS, label);
	const viewLabel = optionalString(value, "label", label);
	switch (viewKind) {
		case "line":
		case "bar": {
			assertOnlyKeys(value, [
				"id",
				"kind",
				"datasetId",
				"label",
				"width",
				"x",
				"y",
				"seriesField"
			], label);
			const x = parseXAxis(value["x"], label);
			const y = value["y"];
			if (!Array.isArray(y) || y.length < 1 || y.length > 4 || y.some((item) => typeof item !== "string" || item.trim().length === 0)) fail(label + ".y: 必须是 1-4 个非空字段名");
			const seriesField = optionalString(value, "seriesField", label);
			if (seriesField !== void 0 && y.length >= 2) fail(label + ": seriesField 与多个 y 字段互斥，只能二选一");
			const view = {
				id,
				kind: viewKind,
				datasetId,
				x,
				y: y.map((item) => item)
			};
			if (viewLabel !== void 0) view.label = viewLabel;
			if (width !== void 0) view.width = width;
			if (seriesField !== void 0) view.seriesField = seriesField;
			return view;
		}
		case "pie": {
			assertOnlyKeys(value, [
				"id",
				"kind",
				"datasetId",
				"label",
				"width",
				"categoryField",
				"valueField"
			], label);
			const view = {
				id,
				kind: "pie",
				datasetId,
				categoryField: requiredStringField(value, "categoryField", label),
				valueField: requiredStringField(value, "valueField", label)
			};
			if (viewLabel !== void 0) view.label = viewLabel;
			if (width !== void 0) view.width = width;
			return view;
		}
		case "scatter": {
			assertOnlyKeys(value, [
				"id",
				"kind",
				"datasetId",
				"label",
				"width",
				"xField",
				"yField"
			], label);
			const view = {
				id,
				kind: "scatter",
				datasetId,
				xField: requiredStringField(value, "xField", label),
				yField: requiredStringField(value, "yField", label)
			};
			if (viewLabel !== void 0) view.label = viewLabel;
			if (width !== void 0) view.width = width;
			return view;
		}
		case "table": {
			assertOnlyKeys(value, [
				"id",
				"kind",
				"datasetId",
				"label",
				"width",
				"columns"
			], label);
			const view = {
				id,
				kind: "table",
				datasetId
			};
			const columns = optionalStringArray(value, "columns", label);
			if (viewLabel !== void 0) view.label = viewLabel;
			if (width !== void 0) view.width = width;
			if (columns !== void 0) view.columns = columns;
			return view;
		}
	}
}
/**
* Strictly parse a model-supplied analysis request. Every structural
* violation (unknown fields, duplicate ids, dangling references, count or
* union constraints) throws with a message naming the offending view/dataset.
*/
function parseAnalysisRequest(input, prefix = "render-analysis") {
	if (!isRecord(input)) fail(prefix + ": 请求必须是对象");
	assertOnlyKeys(input, [
		"title",
		"summary",
		"datasets",
		"views"
	], prefix);
	const title = requireNonEmptyString(input["title"], prefix + ".title");
	const summary = optionalString(input, "summary", prefix);
	const datasets = input["datasets"];
	if (!Array.isArray(datasets) || datasets.length < 1 || datasets.length > 6) fail(prefix + ": datasets 必须是 1-6 个");
	const parsedDatasets = [];
	const datasetIds = /* @__PURE__ */ new Set();
	for (let index = 0; index < datasets.length; index += 1) {
		const label = prefix + ".datasets[" + index + "]";
		const item = datasets[index];
		if (!isRecord(item)) fail(label + ": 必须是对象");
		assertOnlyKeys(item, ["id", "sql"], label);
		const id = requiredStringField(item, "id", label);
		if (datasetIds.has(id)) fail(label + ": dataset id \"" + id + "\" 重复");
		datasetIds.add(id);
		parsedDatasets.push({
			id,
			sql: requiredStringField(item, "sql", label)
		});
	}
	const views = input["views"];
	if (!Array.isArray(views) || views.length < 1 || views.length > 8) fail(prefix + ": views 必须是 1-8 个");
	const parsedViews = [];
	const viewIds = /* @__PURE__ */ new Set();
	for (let index = 0; index < views.length; index += 1) {
		const label = prefix + ".views[" + index + "]";
		const view = parseView(views[index], label, datasetIds);
		if (viewIds.has(view.id)) fail(label + ": view id \"" + view.id + "\" 重复");
		viewIds.add(view.id);
		parsedViews.push(view);
	}
	const request = {
		title,
		datasets: parsedDatasets,
		views: parsedViews
	};
	if (summary !== void 0) request.summary = summary;
	return request;
}
/** Whether one string parses to a finite number. */
function isFiniteNumberText(value) {
	return value.trim() !== "" && Number.isFinite(Number(value));
}
/** Whether one string parses as a time value. */
function isParseableTimeText(value) {
	return value.trim() !== "" && !Number.isNaN(Date.parse(value));
}
/**
* Validate view→dataset semantics AFTER all queries succeeded and BEFORE any
* meta is built: field existence, finite numerics, pie non-negativity, time
* parseability, and table whitelist existence. The client is never asked to
* aggregate, sort, or treat null as zero — validation happens here.
*/
function validateViewSemantics(views, datasets, prefix = "render-analysis") {
	for (const view of views) {
		const dataset = datasets.get(view.datasetId);
		if (dataset === void 0) fail(prefix + ": view \"" + view.id + "\" 引用了未知 dataset \"" + view.datasetId + "\"");
		const columns = new Set(dataset.columns);
		const requireColumn = (field) => {
			if (!columns.has(field)) fail(prefix + ": view \"" + view.id + "\" 引用了 dataset \"" + view.datasetId + "\" 中不存在的字段 \"" + field + "\"");
		};
		const requireNumeric = (field) => {
			requireColumn(field);
			for (const row of dataset.rows) {
				const value = row[field] ?? null;
				if (value !== null && !isFiniteNumberText(value)) fail(prefix + ": view \"" + view.id + "\" 的字段 \"" + field + "\" 含有非数值 \"" + value + "\"（不能转换为有限数）");
			}
		};
		switch (view.kind) {
			case "metric":
				requireNumeric(view.field);
				break;
			case "line":
			case "bar":
				if (view.x.type === "time") {
					requireColumn(view.x.field);
					for (const row of dataset.rows) {
						const value = row[view.x.field] ?? null;
						if (value !== null && !isParseableTimeText(value)) fail(prefix + ": view \"" + view.id + "\" 的 x 字段 \"" + view.x.field + "\" 含有不可解析的时间值 \"" + value + "\"");
					}
				} else requireColumn(view.x.field);
				if (view.seriesField !== void 0) requireColumn(view.seriesField);
				for (const field of view.y) requireNumeric(field);
				break;
			case "pie":
				requireColumn(view.categoryField);
				requireNumeric(view.valueField);
				for (const row of dataset.rows) {
					const value = row[view.valueField] ?? null;
					if (value !== null && Number(value) < 0) fail(prefix + ": view \"" + view.id + "\" 的 valueField \"" + view.valueField + "\" 含负数 \"" + value + "\"（饼图值必须非负）");
				}
				break;
			case "scatter":
				requireNumeric(view.xField);
				requireNumeric(view.yField);
				break;
			case "table": for (const column of view.columns ?? []) requireColumn(column);
		}
	}
}
/** Compress object rows into column-aligned two-dimensional arrays (D2). */
function rowsToArrays(columns, rows) {
	return rows.map((row) => columns.map((column) => row[column] ?? null));
}
/** JSON-encoded UTF-8 size of the normalized report (the 512 KiB bound). */
function reportJsonBytes(report) {
	return new TextEncoder().encode(JSON.stringify(report)).length;
}
/** One-line model-facing summary; never re-injects rows into model context (D5). */
function formatAnalysisSummary(report) {
	const emptyIds = report.datasets.filter((dataset) => dataset.rows.length === 0).map((dataset) => dataset.id);
	let text = "已生成分析报告《" + report.title + "》：" + report.datasets.length + " 个数据集、" + report.views.length + " 个视图（version 1）。";
	if (emptyIds.length > 0) text += "其中 " + emptyIds.length + " 个数据集无数据：" + emptyIds.join("、") + "。";
	return text;
}
const BASE_VIEW_PROPERTIES = {
	id: {
		type: "string",
		required: true,
		description: "视图唯一 id（本报告内不重复）"
	},
	kind: {
		type: "string",
		required: true,
		description: "视图类型"
	},
	datasetId: {
		type: "string",
		required: true,
		description: "引用本次请求中的一个 dataset id"
	},
	label: {
		type: "string",
		description: "可选视图标题，用于图表可访问名称与空态"
	},
	width: {
		type: "string",
		enum: ["full", "half"],
		description: "可选宽度：full 整行 / half 半行（缺省由系统决定）"
	}
};
const METRIC_VIEW_SCHEMA = {
	type: "object",
	properties: {
		id: BASE_VIEW_PROPERTIES.id,
		kind: {
			type: "string",
			const: "metric",
			required: true
		},
		datasetId: BASE_VIEW_PROPERTIES.datasetId,
		field: {
			type: "string",
			required: true,
			description: "数值字段名（来自 dataset 查询结果的列）"
		},
		label: {
			type: "string",
			required: true,
			description: "指标名称，如「本月营收」"
		},
		format: {
			type: "string",
			enum: ["number", "percent"],
			description: "可选数值格式：number（默认）或 percent（值×100 后加 %）"
		}
	},
	additionalProperties: false
};
const LINE_BAR_VIEW_SCHEMA = (kind) => ({
	type: "object",
	properties: {
		id: BASE_VIEW_PROPERTIES.id,
		kind: {
			type: "string",
			const: kind,
			required: true
		},
		datasetId: BASE_VIEW_PROPERTIES.datasetId,
		label: BASE_VIEW_PROPERTIES.label,
		width: BASE_VIEW_PROPERTIES.width,
		x: {
			type: "object",
			properties: {
				field: {
					type: "string",
					required: true,
					description: "x 轴字段名"
				},
				type: {
					type: "string",
					enum: ["category", "time"],
					required: true,
					description: "category 分类轴 / time 时间轴（数据需可由 Date 解析，SQL 请 ORDER BY）"
				},
				label: {
					type: "string",
					description: "可选 x 轴名称"
				}
			},
			additionalProperties: false,
			required: true
		},
		y: {
			type: "array",
			required: true,
			items: { type: "string" },
			description: "1-4 个数值 y 字段名；声明多个 y 时不得同时声明 seriesField"
		},
		seriesField: {
			type: "string",
			description: "可选分组字段：按该字段取值拆成多个系列（与多个 y 字段互斥）"
		}
	},
	additionalProperties: false
});
const PIE_VIEW_SCHEMA = {
	type: "object",
	properties: {
		id: BASE_VIEW_PROPERTIES.id,
		kind: {
			type: "string",
			const: "pie",
			required: true
		},
		datasetId: BASE_VIEW_PROPERTIES.datasetId,
		label: BASE_VIEW_PROPERTIES.label,
		width: BASE_VIEW_PROPERTIES.width,
		categoryField: {
			type: "string",
			required: true,
			description: "分类字段名"
		},
		valueField: {
			type: "string",
			required: true,
			description: "非负数值字段名"
		}
	},
	additionalProperties: false
};
const SCATTER_VIEW_SCHEMA = {
	type: "object",
	properties: {
		id: BASE_VIEW_PROPERTIES.id,
		kind: {
			type: "string",
			const: "scatter",
			required: true
		},
		datasetId: BASE_VIEW_PROPERTIES.datasetId,
		label: BASE_VIEW_PROPERTIES.label,
		width: BASE_VIEW_PROPERTIES.width,
		xField: {
			type: "string",
			required: true,
			description: "数值 x 字段名"
		},
		yField: {
			type: "string",
			required: true,
			description: "数值 y 字段名"
		}
	},
	additionalProperties: false
};
const TABLE_VIEW_SCHEMA = {
	type: "object",
	properties: {
		id: BASE_VIEW_PROPERTIES.id,
		kind: {
			type: "string",
			const: "table",
			required: true
		},
		datasetId: BASE_VIEW_PROPERTIES.datasetId,
		label: BASE_VIEW_PROPERTIES.label,
		width: BASE_VIEW_PROPERTIES.width,
		columns: {
			type: "array",
			items: { type: "string" },
			description: "可选列白名单；省略时按 dataset 列顺序显示"
		}
	},
	additionalProperties: false
};
/** The view union: exactly the six supported kinds, nothing else. */
const ANALYSIS_VIEWS_SCHEMA = { oneOf: [
	METRIC_VIEW_SCHEMA,
	LINE_BAR_VIEW_SCHEMA("line"),
	LINE_BAR_VIEW_SCHEMA("bar"),
	PIE_VIEW_SCHEMA,
	SCATTER_VIEW_SCHEMA,
	TABLE_VIEW_SCHEMA
] };
/** Wire parameter schema of the render-analysis tool. */
const RENDER_ANALYSIS_PARAMETERS = {
	title: {
		type: "string",
		required: true,
		description: "报告标题，如「月度经营分析」"
	},
	summary: {
		type: "string",
		description: "可选一句话结论/摘要，显示在报告头部"
	},
	datasets: {
		type: "array",
		required: true,
		items: {
			type: "object",
			properties: {
				id: {
					type: "string",
					required: true,
					description: "数据集唯一 id（供 views 引用）"
				},
				sql: {
					type: "string",
					required: true,
					description: "一条只读 SQL（SELECT/SHOW/DESCRIBE/EXPLAIN；聚合、Top N、排序都写在 SQL 中）"
				}
			},
			additionalProperties: false
		},
		description: "1-6 个数据集；每个按顺序恰好执行一次，同一数据集可被多个视图复用"
	},
	views: {
		type: "array",
		required: true,
		items: ANALYSIS_VIEWS_SCHEMA,
		description: "1-8 个视图；每个视图必须回答一个不同子问题，多个视图可共享同一 dataset"
	}
};
/** Canonical output schema of the render-analysis tool. */
const ANALYSIS_REPORT_OUTPUT_SCHEMA = {
	type: "object",
	properties: {
		version: {
			type: "integer",
			const: 1,
			required: true
		},
		title: {
			type: "string",
			required: true
		},
		summary: { type: "string" },
		datasets: {
			type: "array",
			required: true,
			items: {
				type: "object",
				properties: {
					id: {
						type: "string",
						required: true
					},
					columns: {
						type: "array",
						required: true,
						items: { type: "string" }
					},
					rows: {
						type: "array",
						required: true,
						items: {
							type: "array",
							items: { oneOf: [{ type: "string" }, { type: "null" }] }
						}
					}
				},
				additionalProperties: false
			}
		},
		views: {
			type: "array",
			required: true,
			items: ANALYSIS_VIEWS_SCHEMA
		}
	},
	additionalProperties: false
};
//#endregion
//#region src/structured.ts
function normalizeNewlines(text) {
	return text.replace(/\r\n?/g, "\n");
}
function splitLine(line, delimiter) {
	return line.split(delimiter);
}
/** Make column names valid unique JSON object keys. */
function uniqueColumns(columns) {
	const used = /* @__PURE__ */ new Set();
	return columns.map((raw, index) => {
		let name = raw.trim();
		if (name.length === 0) name = `column_${index + 1}`;
		if (used.has(name)) {
			let suffix = 2;
			while (used.has(`${name}_${suffix}`)) suffix += 1;
			name = `${name}_${suffix}`;
		}
		used.add(name);
		return name;
	});
}
function rowObject(columns, fields) {
	const row = {};
	for (let index = 0; index < columns.length; index += 1) row[columns[index]] = fields[index] ?? null;
	return row;
}
function emptyOutput() {
	return {
		columns: [],
		rows: [],
		rowLimitExceeded: false
	};
}
function skipLeadingBlank(lines) {
	let index = 0;
	while (index < lines.length && lines[index].trim().length === 0) index += 1;
	return index;
}
/** PostgreSQL `-A` appends a `(N rows)` / `(N row)` footer after SELECT output. */
function isPostgresFooter(line) {
	return /^\(\d+ rows?\)$/.test(line.trim());
}
function parseDelimited(stdout, delimiter, maxRows, skipFooter = false) {
	const lines = normalizeNewlines(stdout).split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	const headerIndex = skipLeadingBlank(lines);
	if (headerIndex >= lines.length) return emptyOutput();
	const columns = uniqueColumns(splitLine(lines[headerIndex], delimiter));
	const rows = [];
	let rowLimitExceeded = false;
	for (let index = headerIndex + 1; index < lines.length; index += 1) {
		const line = lines[index];
		if (skipFooter && isPostgresFooter(line)) continue;
		if (rows.length >= maxRows) {
			rowLimitExceeded = true;
			break;
		}
		rows.push(rowObject(columns, splitLine(line, delimiter)));
	}
	return {
		columns,
		rows,
		rowLimitExceeded
	};
}
/** Minimal RFC-4180-style parser for sqlite3 `-csv` output. */
function parseCsv(text) {
	const records = [];
	let record = [];
	let field = "";
	let quoted = false;
	let index = 0;
	const pushField = () => {
		record.push(field);
		field = "";
	};
	const pushRecord = () => {
		pushField();
		records.push(record);
		record = [];
	};
	while (index < text.length) {
		const char = text[index];
		if (quoted) {
			if (char === "\"") {
				if (text[index + 1] === "\"") {
					field += "\"";
					index += 2;
					continue;
				}
				quoted = false;
				index += 1;
				continue;
			}
			field += char;
			index += 1;
			continue;
		}
		if (char === "\"" && field.length === 0) {
			quoted = true;
			index += 1;
			continue;
		}
		if (char === ",") {
			pushField();
			index += 1;
			continue;
		}
		if (char === "\n") {
			pushRecord();
			index += 1;
			continue;
		}
		if (char === "\r") {
			if (text[index + 1] === "\n") index += 1;
			pushRecord();
			index += 1;
			continue;
		}
		field += char;
		index += 1;
	}
	if (field.length > 0 || record.length > 0) pushRecord();
	return records;
}
function parseCsvOutput(stdout, maxRows) {
	const records = parseCsv(normalizeNewlines(stdout)).filter((record) => !(record.length === 1 && record[0] === ""));
	if (records.length === 0) return emptyOutput();
	const columns = uniqueColumns(records[0]);
	const rows = [];
	let rowLimitExceeded = false;
	for (let index = 1; index < records.length; index += 1) {
		if (rows.length >= maxRows) {
			rowLimitExceeded = true;
			break;
		}
		rows.push(rowObject(columns, records[index]));
	}
	return {
		columns,
		rows,
		rowLimitExceeded
	};
}
/**
* Parse one database type's structured-query stdout. The matching template is
* `buildStructuredQueryTemplate`: mysql tab-separated with a header, postgres
* pipe-separated with a header and row-count footer, sqlite CSV with a header,
* oracle pipe-separated with heading on, hive/impala tsv with a header.
*/
function parseStructuredQueryOutput(type, stdout, maxRows) {
	switch (type) {
		case "mysql": return parseDelimited(stdout, "	", maxRows);
		case "postgres": return parseDelimited(stdout, "|", maxRows, true);
		case "sqlite": return parseCsvOutput(stdout, maxRows);
		case "oracle": return parseDelimited(stdout, "|", maxRows);
		case "hive":
		case "impala": return parseDelimited(stdout, "	", maxRows);
	}
}
//#endregion
//#region src/structured-read.ts
/** Look up the session connection, failing with the same message for every tool. */
async function requireToolConnection(ctx, exec, toolName) {
	const sessionId = exec.agent?.id;
	if (sessionId === void 0) throw new Error(toolName + ": 缺少会话上下文（agent loop 未注入）");
	try {
		return await ctx.dataAgentConnections.resolveForExecution(sessionId);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(toolName + ": " + message);
	}
}
/** Run and redact a client result/error before it reaches tool/session output. */
async function runRedactedClientQuery(ctx, connection, sql, options, signal) {
	try {
		const result = await runClientQuery(ctx, connection, sql, options, signal);
		return redactQueryResult(result, connection);
	} catch (error) {
		const message = redactSecretText(error instanceof Error ? error.message : String(error), [connection.password]);
		throw new Error(message, error instanceof Error ? { cause: error } : void 0);
	}
}
/** Query runner options with the deployment overrides applied. */
function runnerOptions(resolved, mode) {
	return {
		clients: resolved.clients,
		timeoutMs: resolved.queryTimeoutMs,
		maxResultChars: resolved.maxResultChars,
		...mode !== void 0 ? { mode } : {}
	};
}
/**
* Execute one read-only SQL through the structured client template and parse
* it into the canonical { columns, rows } shape, with maxRows enforced at both
* the SQL level (LIMIT injection) and the parse level.
*/
async function runStructuredReadQuery(ctx, connection, sql, resolved, toolName, signal) {
	if (sql.trim().length === 0) throw new Error(toolName + ": sql 不能为空");
	if (sql.length > resolved.maxQueryChars) throw new Error(toolName + ": sql 超过长度上限（" + resolved.maxQueryChars + " 字符）");
	assertSingleStatement(sql, toolName);
	if (classifyStatement(sql, connection.type) !== "read") throw new Error(toolName + " 只执行读语句（SELECT/SHOW/DESCRIBE/EXPLAIN，SQLite 还含查询型 PRAGMA）；写语句请使用 sql-write");
	const limitedSql = enforceReadRowLimit(sql, connection.type, resolved.maxRows);
	const startedAt = Date.now();
	const result = await runRedactedClientQuery(ctx, connection, limitedSql, runnerOptions(resolved, "structured"), signal);
	const elapsedMs = Date.now() - startedAt;
	if (result.exitCode !== 0) {
		const detail = result.stderr.trim() !== "" ? result.stderr.trim() : result.stdout.trim();
		throw new Error(toolName + " 执行失败（exit " + result.exitCode + "）：" + detail);
	}
	const parsed = parseStructuredQueryOutput(connection.type, result.stdout, resolved.maxRows);
	return {
		columns: parsed.columns,
		rows: parsed.rows,
		elapsedMs,
		truncated: result.truncated || parsed.rowLimitExceeded
	};
}
//#endregion
//#region src/tool.ts
/** Cordis plugin name (diagnostics only). */
const name = "data-agent-tool";
/** Services required before the tool can register. */
const inject = [
	"tools",
	"subprocess",
	"dataAgentConnections"
];
/** Loader schema with deployment defaults (no library defaults). */
const Config = z.object({
	queryTimeoutMs: z.number().step(1).min(1e3).default(DEFAULT_QUERY_TIMEOUT_MS),
	maxResultChars: z.number().step(1).min(1024).default(DEFAULT_MAX_RESULT_CHARS),
	maxRows: z.number().step(1).min(1).default(100),
	maxQueryChars: z.number().step(1).min(1024).default(DEFAULT_MAX_QUERY_CHARS),
	readonly: z.boolean().default(false),
	clients: clientsSchema
});
/** One-line tool-call label (newlines collapsed). */
function oneLine(sql) {
	const line = sql.replace(/\s+/g, " ").trim();
	return line.length > 80 ? `${line.slice(0, 77)}...` : line;
}
/** Format the raw terminal result. */
function formatResult(value) {
	const parts = [];
	if (value.stdout.length > 0) parts.push(value.stdout);
	if (value.stderr.length > 0) parts.push(`[stderr]\n${value.stderr}`);
	if (value.truncated) parts.push("… 输出超过上限，已截断（可缩小查询或增加 maxResultChars）");
	if (value.exitCode !== 0) parts.push(`[exit code: ${value.exitCode ?? "signal"}]`);
	return parts.join("\n");
}
/** Format the structured result as JSON text (the canonical value stays JSON). */
function formatStructuredResult(value) {
	return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}
/** Empty and multi-statement checks shared by the write/raw tools. */
function validateSingleSql(sql, toolName) {
	if (sql.trim().length === 0) throw new Error(toolName + ": sql 不能为空");
	assertSingleStatement(sql, toolName);
}
/**
* The Web-only render-analysis tool (D1-D5): one call builds one versioned
* analysis report from 1-6 read-only datasets and 1-8 views. The full report
* is persisted as presentationMeta; the model only receives a short summary
* (output.render), never the rows themselves.
*/
function defineRenderAnalysisTool(ctx, resolved) {
	return defineTool({
		name: "render-analysis",
		description: "Web only: render one versioned analysis report (v1) from 1-6 read-only datasets and 1-8 metric, line, bar, pie, scatter, or table views. First use sql-query to inspect and verify data, then call this tool only when visualization adds value. Use one primary chart for a simple relationship or 3-6 complementary views for multi-metric, time-series, or segmented analysis. Put aggregation, Top N, and sorting in SQL, and add ORDER BY for line or time datasets. Reuse a dataset across views via datasetId; each dataset runs once. Arbitrary chart options, scripts, HTML, CSS, and URLs are not accepted. Empty datasets are valid and render as no-data states.",
		parameters: RENDER_ANALYSIS_PARAMETERS,
		output: {
			schema: ANALYSIS_REPORT_OUTPUT_SCHEMA,
			render: (_args, value) => [{
				type: "text",
				text: formatAnalysisSummary(value)
			}],
			presentationMeta: (_args, value) => value
		},
		presentCall: (args) => ({
			card: "generic",
			kind: "read",
			title: "render-analysis《" + args.title + "》",
			rawInput: args.title
		}),
		presentResult: (args, result) => ({
			card: "generic",
			title: "render-analysis《" + args.title + "》",
			content: result.content
		}),
		async execute(args, exec) {
			const request = parseAnalysisRequest(args);
			const connection = await requireToolConnection(ctx, exec, "render-analysis");
			const planned = request.datasets.map((dataset) => {
				const sql = dataset.sql;
				if (sql.trim().length === 0) throw new Error("render-analysis: dataset \"" + dataset.id + "\" 的 sql 不能为空");
				if (sql.length > resolved.maxQueryChars) throw new Error("render-analysis: dataset \"" + dataset.id + "\" 的 sql 超过长度上限（" + resolved.maxQueryChars + " 字符）");
				assertSingleStatement(sql, "render-analysis");
				if (classifyStatement(sql, connection.type) !== "read") throw new Error("render-analysis: dataset \"" + dataset.id + "\" 必须是读语句（SELECT/SHOW/DESCRIBE/EXPLAIN，SQLite 还含查询型 PRAGMA）");
				return {
					id: dataset.id,
					sql: enforceReadRowLimit(sql, connection.type, resolved.maxRows)
				};
			});
			const results = /* @__PURE__ */ new Map();
			for (const item of planned) {
				let read;
				try {
					read = await runStructuredReadQuery(ctx, connection, item.sql, resolved, "render-analysis", exec.signal);
				} catch (error) {
					if (exec.signal.aborted) throw error;
					const message = error instanceof Error ? error.message : String(error);
					throw new Error("render-analysis: dataset \"" + item.id + "\" 执行失败：" + message);
				}
				if (read.truncated) throw new Error("render-analysis: dataset \"" + item.id + "\" 的查询结果被截断（超过 maxRows/maxResultChars）；请缩小、聚合或拆分查询");
				results.set(item.id, {
					columns: read.columns,
					rows: read.rows
				});
			}
			validateViewSemantics(request.views, results);
			const report = {
				version: 1,
				title: request.title,
				...request.summary !== void 0 ? { summary: request.summary } : {},
				datasets: request.datasets.map((dataset) => {
					const data = results.get(dataset.id);
					return {
						id: dataset.id,
						columns: data.columns,
						rows: rowsToArrays(data.columns, data.rows)
					};
				}),
				views: request.views
			};
			const bytes = reportJsonBytes(report);
			if (bytes > 524288) throw new Error("render-analysis: 报告 JSON 超过 524288 字节上限（当前 " + bytes + " 字节）；请聚合、筛选或拆分报告，不得静默删减数据");
			return report;
		}
	});
}
/**
* Mount the data-agent database tools: `sql-query` (structured read-only),
* `sql-write` (explicit write semantics), and `sql-cmd` (raw compatibility).
* @param ctx - the preset-scoped agent context.
* @param config - validated loader configuration.
*/
function apply(ctx, config) {
	const resolved = {
		queryTimeoutMs: config.queryTimeoutMs,
		maxResultChars: config.maxResultChars,
		maxRows: config.maxRows,
		maxQueryChars: config.maxQueryChars,
		readonly: config.readonly,
		clients: config.clients
	};
	ctx.tools.register(defineTool({
		name: "sql-query",
		description: `Execute exactly one read-only SQL statement (SELECT, SHOW, DESCRIBE, EXPLAIN, or a read-only SQLite PRAGMA) on the connected database. Returns structured JSON with columns, rows, affectedRows, elapsedMs, and truncated. An unbounded SELECT is limited automatically, and every result is capped at ${resolved.maxRows} rows. Use sql-write for write operations and sql-cmd when raw database-client output is required.`,
		parameters: { sql: {
			type: "string",
			required: true,
			description: "一条只读 SQL，如 \"SELECT * FROM orders LIMIT 5;\"、\"SHOW TABLES;\"、\"DESCRIBE users;\""
		} },
		output: {
			schema: {
				type: "object",
				properties: {
					columns: {
						type: "array",
						items: { type: "string" },
						required: true
					},
					rows: {
						type: "array",
						items: {
							type: "object",
							properties: {},
							additionalProperties: true
						},
						required: true
					},
					affectedRows: {
						type: "integer",
						required: true
					},
					elapsedMs: {
						type: "integer",
						required: true
					},
					truncated: {
						type: "boolean",
						required: true
					}
				},
				additionalProperties: false
			},
			render: (_args, value) => [{
				type: "text",
				text: formatStructuredResult(value)
			}]
		},
		presentCall: (args) => ({
			card: "generic",
			kind: "read",
			title: `sql-query ${oneLine(args.sql)}`,
			rawInput: args.sql
		}),
		presentResult: (args, result) => ({
			card: "generic",
			title: `sql-query ${oneLine(args.sql)}`,
			content: result.content
		}),
		async execute(args, exec) {
			const read = await runStructuredReadQuery(ctx, await requireToolConnection(ctx, exec, "sql-query"), args.sql, resolved, "sql-query", exec.signal);
			return {
				columns: read.columns,
				rows: read.rows,
				affectedRows: 0,
				elapsedMs: read.elapsedMs,
				truncated: read.truncated
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "sql-write",
		description: "Execute exactly one write or administrative SQL statement, such as INSERT, UPDATE, DELETE, or DDL, on the connected database. Each call starts an independent database-client process and auto-commits. Multi-statement transactions cannot span calls; use one atomic statement such as INSERT ... SELECT, or a database-side script or stored procedure. Use sql-query for read-only queries.",
		parameters: { sql: {
			type: "string",
			required: true,
			description: "一条写/管理 SQL，如 \"INSERT INTO t VALUES (1);\"、\"UPDATE t SET x=1;\"、\"CREATE INDEX idx_t_x ON t(x);\""
		} },
		output: {
			schema: {
				type: "object",
				properties: {
					exitCode: {
						oneOf: [{ type: "integer" }, { type: "null" }],
						required: true
					},
					stdout: {
						type: "string",
						required: true
					},
					stderr: {
						type: "string",
						required: true
					},
					truncated: {
						type: "boolean",
						required: true
					}
				},
				additionalProperties: false
			},
			render: (_args, value) => [{
				type: "text",
				text: formatResult(value)
			}]
		},
		presentCall: (args) => ({
			card: "terminal",
			title: `sql-write ${oneLine(args.sql)}`,
			description: "执行一条写/管理 SQL（自动提交）"
		}),
		presentResult: (args, result) => ({
			card: "terminal",
			title: `sql-write ${oneLine(args.sql)}`,
			content: result.content
		}),
		async execute(args, exec) {
			const connection = await requireToolConnection(ctx, exec, "sql-write");
			validateSingleSql(args.sql, "sql-write");
			if (classifyStatement(args.sql, connection.type) === "read") throw new Error("sql-write 只执行写/管理语句；只读查询请使用 sql-query");
			if (connection.readonly ?? resolved.readonly) throw new Error("当前连接为只读模式，sql-write 拒绝执行写/管理语句（仅放行 SELECT/SHOW/DESCRIBE/EXPLAIN/查询型 PRAGMA 等）");
			return runRedactedClientQuery(ctx, connection, args.sql, runnerOptions(resolved), exec.signal);
		}
	}));
	ctx.tools.register(defineTool({
		name: "sql-cmd",
		description: `Execute exactly one SQL statement or database-client command, such as SHOW TABLES or DESCRIBE users, on the connected database and return raw exitCode, stdout, stderr, and truncated fields. Prefer sql-query for structured read results and sql-write for explicit write semantics. Read SELECT results are limited to ${resolved.maxRows} rows. Each call starts an independent database-client process and auto-commits.`,
		parameters: { sql: {
			type: "string",
			required: true,
			description: "一条 SQL 文本（或客户端命令），如 \"SHOW TABLES;\"、\"DESCRIBE users;\"、\"SELECT * FROM orders LIMIT 5;\""
		} },
		output: {
			schema: {
				type: "object",
				properties: {
					exitCode: {
						oneOf: [{ type: "integer" }, { type: "null" }],
						required: true
					},
					stdout: {
						type: "string",
						required: true
					},
					stderr: {
						type: "string",
						required: true
					},
					truncated: {
						type: "boolean",
						required: true
					}
				},
				additionalProperties: false
			},
			render: (_args, value) => [{
				type: "text",
				text: formatResult(value)
			}]
		},
		presentCall: (args) => ({
			card: "terminal",
			title: `sql-cmd ${oneLine(args.sql)}`,
			description: "在数据库客户端执行一条 SQL"
		}),
		presentResult: (args, result) => ({
			card: "terminal",
			title: `sql-cmd ${oneLine(args.sql)}`,
			content: result.content
		}),
		async execute(args, exec) {
			const connection = await requireToolConnection(ctx, exec, "sql-cmd");
			validateSingleSql(args.sql, "sql-cmd");
			if ((connection.readonly ?? resolved.readonly) && classifyStatement(args.sql, connection.type) === "write") throw new Error("当前连接为只读模式，sql-cmd 拒绝执行非读语句（仅放行 SELECT/SHOW/DESCRIBE/EXPLAIN/查询型 PRAGMA 等）");
			return runRedactedClientQuery(ctx, connection, classifyStatement(args.sql, connection.type) === "read" ? enforceReadRowLimit(args.sql, connection.type, resolved.maxRows) : args.sql, runnerOptions(resolved), exec.signal);
		}
	}));
	if (ctx.get("webServer") !== void 0) ctx.tools.register(defineRenderAnalysisTool(ctx, resolved));
}
//#endregion
export { Config, apply, inject, name };
