import { c as buildIntrospectTemplate, l as buildStructuredQueryTemplate, s as buildClientTemplate } from "./defaults-Bac6QvNt.js";
//#region src/query.ts
/** Read one collected stream from offset 0. */
function readCaptured(reader) {
	if (reader === void 0) return {
		text: "",
		truncated: false
	};
	const read = reader.readFrom(0);
	return {
		text: read.text,
		truncated: read.lossy
	};
}
/**
* Run one SQL text through the type's CLI client. The SQL is written to the
* child's stdin (`{ data }` batch disposition) so it never appears in argv;
* passwords travel in the env entries built by the template.
*
* Failure classification:
* - the caller's external signal (e.g. the tool exec signal) aborts → the
*   abort reason propagates;
* - the internal timeout fires → an Error naming the deadline is thrown;
* - the executable cannot be resolved → an Error naming the command is thrown;
* - the process runs to completion → `{ exitCode, stdout, stderr, truncated }`
*   is returned even for a non-zero exit (the caller decides what that means).
* @param ctx - context exposing the subprocess service.
* @param connection - the stored connection (password included).
* @param sql - the SQL text (or client command) to run.
* @param options - timeouts, caps, client overrides.
* @param externalSignal - caller-owned cancellation (the tool exec signal).
* @param introspect - use the machine-readable introspection flag set.
* @returns the captured outcome.
*/
async function runClientQuery(ctx, connection, sql, options, externalSignal, introspect = false) {
	const template = options.mode === "structured" ? buildStructuredQueryTemplate(connection.type, connection, options.clients[connection.type]) : options.mode === "introspect" || introspect ? buildIntrospectTemplate(connection.type, connection, options.clients[connection.type]) : buildClientTemplate(connection.type, connection, options.clients[connection.type]);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(/* @__PURE__ */ new Error(`查询超过 ${options.timeoutMs}ms 未完成，已终止客户端进程`)), options.timeoutMs);
	const onExternalAbort = () => {
		controller.abort(externalSignal.reason);
	};
	if (externalSignal.aborted) controller.abort(externalSignal.reason);
	else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
	try {
		let executable;
		try {
			executable = await ctx.subprocess.resolveExecutable(template.command, template.env, controller.signal);
		} catch (error) {
			controller.signal.throwIfAborted();
			throw new Error(`无法解析数据库客户端 "${template.command}"（${error instanceof Error ? error.message : String(error)}）；请确认客户端已安装，或在 data-agent 插件配置的 clients 中覆盖命令名/路径`);
		}
		const handle = ctx.subprocess.spawn({
			argv: [executable, ...template.args],
			cwd: process.cwd(),
			stdio: {
				stdin: { data: `${template.stdinPrefix}${sql}\n` },
				stdout: { maxBytes: options.maxResultChars },
				stderr: { maxBytes: options.maxResultChars }
			},
			graceMs: options.graceMs ?? 5e3,
			signal: controller.signal,
			env: template.env
		});
		let outcome;
		try {
			outcome = await handle.done;
		} catch (error) {
			controller.signal.throwIfAborted();
			throw new Error(`启动数据库客户端失败：${error instanceof Error ? error.message : String(error)}`);
		}
		if (controller.signal.aborted) controller.signal.throwIfAborted();
		const stdout = readCaptured(handle.collected.stdout);
		const stderr = readCaptured(handle.collected.stderr);
		return {
			exitCode: outcome.exitCode,
			stdout: stdout.text,
			stderr: stderr.text,
			truncated: stdout.truncated || stderr.truncated
		};
	} finally {
		clearTimeout(timer);
		externalSignal.removeEventListener("abort", onExternalAbort);
	}
}
//#endregion
export { runClientQuery as t };
