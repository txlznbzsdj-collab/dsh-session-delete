// dsh-session-delete host 侧插件：
//   注册 /plugins/dsh-session-delete/delete 端点，硬删除一个会话：
//    1) 若会话为 live（在 ctx.sessions 内存存储中），dispose 它 → 触发
//       session/disposed → host/session-removed，所有客户端列表即时移除。
//    2) 删除该会话的持久化数据（jsonl 会话目录），确保重启后不再出现。
export const name = "dsh-session-delete";

export const inject = ["sessions", "sessionPersistence"];

const DELETE_ENDPOINT = "/plugins/dsh-session-delete/delete";

/** 本地回环地址才允许调用（web 服务器只服务本机 GUI）。 */
function isLoopback(address) {
	return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function jsonResponse(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"content-length": Buffer.byteLength(payload)
	});
	res.end(payload);
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (chunk) => {
			data += chunk;
			if (data.length > 1_000_000) {
				req.destroy();
				reject(new Error("body too large"));
			}
		});
		req.on("end", () => {
			try {
				resolve(data.length === 0 ? {} : JSON.parse(data));
			} catch (error) {
				reject(error);
			}
		});
		req.on("error", reject);
	});
}

/** 从 fs/promises 里按需取 rm/stat，避免顶层静态依赖。 */
function fsModule() {
	return import("node:fs/promises");
}

function mount(ctx) {
	const sessions = ctx.sessions;

	/**
	 * 硬删除一个会话。
	 * @param sessionId 会话 id（如 session-<uuid>）
	 * @returns {Promise<{ok:boolean; live?:boolean; persisted?:boolean; message:string}>}
	 */
	async function deleteSession(sessionId) {
		if (typeof sessionId !== "string" || sessionId.length === 0) {
			throw new Error("missing sessionId");
		}
		const fs = await fsModule();

		// 1) 持久化数据：优先通过 sessionPersistence 列出工件，按 id 匹配删除其会话目录；
		//    若 API 没找到，则兜底直接扫描会话根目录下的 <project>/<sessionId> 目录。
		let persisted = false;
		try {
			const persistence = ctx.get?.("sessionPersistence") || ctx.sessionPersistence;
			if (persistence && typeof persistence.listArtifacts === "function") {
				const artifacts = await persistence.listArtifacts();
				for (const artifact of artifacts) {
					if (artifact.header && artifact.header.id === sessionId && artifact.path) {
						const dir = artifact.path.substring(0, Math.max(
							artifact.path.lastIndexOf("/"),
							artifact.path.lastIndexOf("\\")
						));
						if (dir && dir.length > 0) {
							await fs.rm(dir, { recursive: true, force: true });
							persisted = true;
						}
						break;
					}
				}
			}
		} catch (error) {
			ctx.logger?.warn?.(`[dsh-session-delete] remove persisted data failed for "${sessionId}": ${String(error)}`);
		}

		// 1b) 兜底：无论上面是否找到，都尝试按目录名 <sessionId> 直接清理磁盘。
		//     扫描 DSH 会话根目录下的每个项目目录，删除名字恰为 sessionId 的子目录。
		if (!persisted) {
			try {
				const root = (ctx.get?.("sessionPersistence") || ctx.sessionPersistence)?.root;
				if (root) {
					const projects = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
					for (const proj of projects) {
						if (!proj.isDirectory() || proj.name === "artifacts") continue;
						const target = `${root}\\${proj.name}\\${sessionId}`;
						const exists = await fs.stat(target).then((s) => s.isDirectory()).catch(() => false);
						if (exists) {
							await fs.rm(target, { recursive: true, force: true });
							persisted = true;
						}
					}
				}
			} catch (error) {
				ctx.logger?.warn?.(`[dsh-session-delete] direct disk scan failed for "${sessionId}": ${String(error)}`);
			}
		}

		// 2) live 会话：dispose 它（从内存存储移除）。detachEntered / entry.detach()
		//    只在该 entry 已 announce（entry.announced === true）时才 emit session/disposed
		//    → 才会触发前端 host/session-removed 即时移除列表项。冷会话（仅持久化、非
		//    live）或未 announce 的 live 会话 detach 后不会广播，前端列表不会即时刷新。
		//    所以若该会话不会自行广播，我们就手动 emit session/disposed，让 host-apiproxy
		//    推送 host/session-removed 给所有前端，实现即时移除（无需手动刷新）。
		let live = false;
		let announced = false;
		try {
			const entry = sessions.store && sessions.store.get(sessionId);
			if (entry) {
				announced = !!entry.announced;
				// 优先用公开可用路径：store 的内部 detachEntered 是该版本唯一
				// 能“移除会话并发出 host/session-removed”的通道。
				if (typeof sessions.detachEntered === "function") {
					sessions.detachEntered(entry);
				} else if (typeof entry.detach === "function") {
					entry.detach();
				}
				live = true;
			}
		} catch (error) {
			ctx.logger.warn(`[dsh-session-delete] dispose live session failed for "${sessionId}": ${String(error)}`);
		}

		// 2b) 若该会话不会自行广播（冷会话 / 未 announce），手动 emit session/disposed
		//     触发前端即时移除。live 且 announced 的会话 detach 已广播，跳过避免重复。
		if (!live || !announced) {
			try {
				ctx.emit("session/disposed", { id: sessionId, header: { id: sessionId } });
			} catch (error) {
				ctx.logger.warn(`[dsh-session-delete] emit session/disposed failed for "${sessionId}": ${String(error)}`);
			}
		}

		if (!live && !persisted) {
			return { ok: false, live: false, persisted: false, message: `session not found: ${sessionId}` };
		}
		return { ok: true, live, persisted, message: "deleted" };
	}

	ctx.effect(() => {
		const disposeRoute = ctx.webServer.register({
			kind: "exact",
			path: DELETE_ENDPOINT,
			handler: async (req, res) => {
				if (!isLoopback(req.socket?.remoteAddress)) {
					jsonResponse(res, 403, { error: "local access only" });
					return;
				}
				const origin = req.headers?.origin;
				if (origin) {
					let originHost;
					try {
						originHost = new URL(origin).host;
					} catch {}
					if (!originHost || originHost !== req.headers.host) {
						jsonResponse(res, 403, { error: "origin mismatch" });
						return;
					}
				}
				if (req.method !== "POST") {
					jsonResponse(res, 405, { error: "method not allowed" });
					return;
				}
				let payload;
				try {
					payload = await readBody(req);
				} catch (error) {
					jsonResponse(res, 400, { error: "invalid json body" });
					return;
				}
				try {
					const result = await deleteSession(payload.sessionId);
					if (!result.ok) {
						jsonResponse(res, 404, result);
						return;
					}
					jsonResponse(res, 200, result);
				} catch (error) {
					jsonResponse(res, 400, { error: String(error && error.message || error) });
				}
			}
		});
		return () => {
			disposeRoute?.();
		};
	}, "dsh-session-delete: delete route");
}

export function apply(ctx) {
	if (typeof ctx.inject === "function") {
		// webServer 可能晚于 bundle loader 就绪；sessions 作为静态依赖。
		// sessionPersistence 用可选注入（取不到就当没有持久化后端）。
		const deps = ["sessions", "webServer", "sessionPersistence"];
		ctx.inject(deps, (serviceCtx) => {
			mount(serviceCtx);
		});
		return;
	}
	mount(ctx);
}
