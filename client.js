window.__ModuleLoader__.load({
	id: "dsh-session-delete",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		// dsh-session-delete 客户端插件（vanilla DOM，无平台依赖）。
		// 在侧边栏会话列表的三点下拉菜单底部注入一个「删除」项，点击后弹二次确认，
		// 确认后调用 host 端点 /plugins/dsh-session-delete/delete 硬删除会话。
		//
		// 修复要点：
		//   1) 主题适配：样式直接用 DSH 官方主题变量 var(--dsw-*)（已核对 design-platform.css
		//      真实存在：--dsw-alias-bg-layer-2 / --dsw-alias-label-primary / --dsw-alias-border-l2 /
		//      --dsw-alias-state-error-primary / --dsw-alias-interactive-bg-hover），浏览器计算时
		//      按当前亮/暗/皮肤主题自动解析，切换主题即时生效，无需 JS 介入。
		//   2) 点按钮无反应：不再在 overlay 上加捕获阶段 stopPropagation/preventDefault（那会
		//      掐断按钮自身的原生 onClick）。只保留按钮/遮罩各自的点击处理器，按钮 onClick 内
		//      主动 stopPropagation 以隔离冒泡。
		//   3) 菜单关闭不再用 removeChild 强删 React 管理的 DOM（会导致 React 虚拟 DOM 与真实
		//      DOM 不一致，引发列表错乱），而是让 React 自己正常关闭菜单。

		var DELETE_ENDPOINT = "/plugins/dsh-session-delete/delete";
		var pendingSession = null; // { id, title }

		// ── 从会话行 React fiber 里读 session id（与 UI 版本无关，靠 fiber 属性） ──
		function readSessionId(row) {
			if (!row) return undefined;
			var fiberKey = Object.keys(row).find(function (k) {
				return k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$");
			});
			var fiber = fiberKey ? row[fiberKey] : null;
			for (var i = 0; i < 16 && fiber; i++) {
				var mp = fiber.memoizedProps;
				if (mp && typeof mp === "object") {
					if (typeof mp.node === "object" && mp.node && typeof mp.node.id === "string") {
						return mp.node.id;
					}
					if (typeof mp.id === "string" && mp.id.indexOf("session-") === 0) {
						return mp.id;
					}
				}
				fiber = fiber.return;
			}
			return undefined;
		}

		function readSessionTitle(row) {
			if (!row) return "";
			var t = row.querySelector(".YDXeBa_title");
			return t ? (t.textContent || "").trim() : (row.textContent || "").trim();
		}

		// ── 记录打开菜单对应的会话（点击三点按钮时捕获） ──
		function onDocClickCapture(e) {
			var target = e.target;
			if (!target || typeof target.closest !== "function") return;
			var btn = target.closest(".YDXeBa_iconButton");
			if (!btn) return;
			var row = btn.closest(".YDXeBa_sessionRow");
			if (!row) return;
			var aria = btn.getAttribute("aria-label") || "";
			if (aria.indexOf("会话") === -1 || aria.indexOf("操作") === -1) return;
			var id = readSessionId(row);
			if (!id) return;
			pendingSession = { id: id, title: readSessionTitle(row) || aria };
		}

		// ── 判断一个菜单是不是“会话菜单”（包含 归档会话 项） ──
		function isSessionMenu(menuEl) {
			var text = (menuEl.textContent || "");
			// 会话菜单含“归档会话”，而工作区菜单含“删除工作区”。
			return text.indexOf("归档会话") !== -1;
		}

		function findMenuitemByText(menuEl, text) {
			var items = menuEl.querySelectorAll('[role="menuitem"]');
			for (var i = 0; i < items.length; i++) {
				if ((items[i].textContent || "").trim() === text) return items[i];
			}
			return undefined;
		}

		function trashIconSvg() {
			return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
				'<path d="M9 3h6l1 2h4a1 1 0 0 1 0 2H4a1 1 0 0 1 0-2h4l1-2Z" fill="currentColor"/>' +
				'<path d="M5 9h14l-1 11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 9Zm5 2v8h2v-8h-2Zm4 0v8h2v-8h-2Z" fill="currentColor"/>' +
				'</svg>';
		}

		// ── 主题：样式直接写 var(--dsw-*) 官方主题变量，浏览器在计算时按当前
		//   亮/暗/皮肤主题解析，自动适配。以下变量名已对照 DSH 官方
		//   design-platform.css 核对为真实存在（--dsw-surface / 裸 --dsw-alias-border /
		//   裸 --dsw-alias-interactive-bg 均不存在，不要使用）。

		// ── 往会话菜单底部注入一个「删除」danger 项 ──
		function injectDeleteItem(menuEl) {
			if (menuEl.querySelector('[data-dsh-session-delete="1"]')) return;

			var viewport = menuEl.querySelector('[class*="_viewport_"]') || menuEl;

			var template = findMenuitemByText(menuEl, "归档会话") || menuEl.querySelector('[role="menuitem"]');
			if (!template) return;

			var wrap = document.createElement("div");
			if (template.parentElement && template.parentElement !== menuEl) {
				wrap.className = template.parentElement.getAttribute("class") || "";
			}

			var btn = document.createElement("button");
			btn.type = "button";
			btn.setAttribute("role", "menuitem");
			var btnClass = template.getAttribute("class") || "";
			btn.className = btnClass.indexOf("_danger_") === -1
				? btnClass + " " + "dsh-session-delete-danger"
				: btnClass;
			btn.setAttribute("data-dsh-session-delete", "1");
			btn.setAttribute("aria-label", "删除会话");

			var icon = document.createElement("span");
			var iconClass = template.querySelector('[class*="_itemIcon_"]');
			icon.className = iconClass ? iconClass.getAttribute("class") : "";
			icon.innerHTML = trashIconSvg();

			var label = document.createElement("span");
			var labelClass = template.querySelector('[class*="_itemLabel_"]');
			label.className = labelClass ? labelClass.getAttribute("class") : "";
			label.textContent = "删除";

			btn.appendChild(icon);
			btn.appendChild(label);
			wrap.appendChild(btn);
			viewport.appendChild(wrap);

			btn.addEventListener("click", function (e) {
				// 记录目标会话（优先用已捕获的 pendingSession；若没有则从当前打开的行兜底）
				var session = pendingSession;
				if (!session || !session.id) {
					var rows = document.querySelectorAll(".YDXeBa_sessionRow.YDXeBa_menuOpen");
					for (var i = 0; i < rows.length; i++) {
						var id = readSessionId(rows[i]);
						if (id) { session = { id: id, title: readSessionTitle(rows[i]) }; break; }
					}
				}
				// 不清除菜单 DOM：让 React 自己处理点击并正常关闭菜单（避免虚拟 DOM 不一致）。
				// 我们这里不 stopPropagation，让菜单项点击正常冒泡给 React 关闭。
				if (!session || !session.id) {
					alert("无法确定要删除的会话，请重试。");
					return;
				}
				// 延迟一帧等 React 关闭菜单后再弹确认框，避免菜单关闭动作干扰弹窗。
				setTimeout(function () {
					confirmDelete(session);
				}, 30);
			});
		}

		// ── 二次确认弹窗 ──
		function confirmDelete(session) {
			var overlay = document.createElement("div");
			overlay.className = "dsh-session-delete-overlay";
			overlay.setAttribute("role", "dialog");
			overlay.setAttribute("aria-modal", "true");
			overlay.setAttribute("aria-label", "确认删除会话");

			var box = document.createElement("div");
			box.className = "dsh-session-delete-dialog";

			var heading = document.createElement("h2");
			heading.className = "dsh-session-delete-title";
			heading.textContent = "删除会话";

			var body = document.createElement("p");
			body.className = "dsh-session-delete-text";
			var name = document.createElement("strong");
			name.textContent = session.title || session.id;
			body.appendChild(document.createTextNode("确定要删除会话「"));
			body.appendChild(name);
			body.appendChild(document.createTextNode("」吗？"));
			var warn = document.createElement("p");
			warn.className = "dsh-session-delete-warn";
			warn.textContent = "此操作会永久删除该会话，无法恢复。";

			var actions = document.createElement("div");
			actions.className = "dsh-session-delete-actions";

			var cancel = document.createElement("button");
			cancel.type = "button";
			cancel.className = "dsh-session-delete-btn";
			cancel.textContent = "取消";
			cancel.addEventListener("click", function (e) {
				if (e && e.stopPropagation) e.stopPropagation();
				closeOverlay(overlay);
			});

			var del = document.createElement("button");
			del.type = "button";
			del.className = "dsh-session-delete-btn dsh-session-delete-danger-btn";
			del.textContent = "删除";
			del.addEventListener("click", function (e) {
				if (e && e.stopPropagation) e.stopPropagation();
				del.disabled = true;
				del.textContent = "删除中…";
				doDelete(session, overlay, del);
			});

			actions.appendChild(cancel);
			actions.appendChild(del);

			box.appendChild(heading);
			box.appendChild(body);
			box.appendChild(warn);
			box.appendChild(actions);
			overlay.appendChild(box);

			// 点击遮罩取消（target 才是遮罩本身时）
			overlay.addEventListener("click", function (e) {
				if (e.target === overlay) {
					closeOverlay(overlay);
				}
			});

			document.body.appendChild(overlay);
			del.focus();
		}

		function closeOverlay(overlay) {
			try { overlay.remove(); } catch (_) {
				try { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); } catch (_) {}
			}
		}

		function doDelete(session, overlay, delBtn) {
			fetch(DELETE_ENDPOINT, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ sessionId: session.id })
			}).then(function (res) {
				if (!res.ok) return res.json().then(function (b) { throw new Error((b && b.error) || ("HTTP " + res.status)); });
				return res.json();
			}).then(function (result) {
				closeOverlay(overlay);
				if (result && result.ok) {
					toast("已删除会话");
				} else {
					toast((result && result.message) || "删除失败", true);
				}
			}).catch(function (err) {
				closeOverlay(overlay);
				toast("删除失败：" + (err && err.message || "未知错误"), true);
			});
		}

		// ── 轻量 toast ──
		var toastEl = null;
		function toast(text, isError) {
			if (!toastEl) {
				toastEl = document.createElement("div");
				toastEl.className = "dsh-session-delete-toast";
				document.body.appendChild(toastEl);
			}
			toastEl.textContent = text;
			toastEl.classList.toggle("dsh-session-delete-toast-error", !!isError);
			toastEl.classList.add("dsh-session-delete-toast-show");
			clearTimeout(toastEl._t);
			toastEl._t = setTimeout(function () {
				toastEl.classList.remove("dsh-session-delete-toast-show");
			}, 2200);
		}

		// ── 观察菜单出现并注入删除项 ──
		function setupObserver() {
			var mo = new MutationObserver(function (mutations) {
				for (var i = 0; i < mutations.length; i++) {
					var added = mutations[i].addedNodes;
					for (var j = 0; j < added.length; j++) {
						var node = added[j];
						if (!node || node.nodeType !== 1) continue;
						if (node.matches && node.matches('[role="menu"]')) {
							if (isSessionMenu(node)) injectDeleteItem(node);
						} else if (node.querySelectorAll) {
							var menus = node.querySelectorAll('[role="menu"]');
							for (var k = 0; k < menus.length; k++) {
								if (isSessionMenu(menus[k])) injectDeleteItem(menus[k]);
							}
						}
					}
				}
			});
			mo.observe(document.body, { childList: true, subtree: true });

			var inner = function () {
				var menus = document.querySelectorAll('[role="menu"]');
				for (var k = 0; k < menus.length; k++) {
					if (isSessionMenu(menus[k])) injectDeleteItem(menus[k]);
				}
				setTimeout(inner, 250);
			};
			setTimeout(inner, 250);
			return mo;
		}

		// ── 样式：直接写官方主题变量 var(--dsw-*)（已核对真实存在），浏览器计算时
		//   按当前亮/暗/皮肤主题自动解析，且切换主题即时生效，无需 JS 介入。
		//   fallback 仅在最坏情况下兜底。
		function injectStyle() {
			var style = document.createElement("style");
			style.textContent = [
				".dsh-session-delete-overlay{position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;animation:dshSdFade .15s ease}",
				".dsh-session-delete-dialog{background:var(--dsw-alias-bg-layer-2,#ffffff);color:var(--dsw-alias-label-primary,#1f1f1f);border:1px solid var(--dsw-alias-border-l2,#e5e5e5);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.28);width:340px;max-width:calc(100vw - 40px);padding:18px 20px}",
				".dsh-session-delete-title{margin:0 0 10px;font-size:16px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary,#1f1f1f)}",
				".dsh-session-delete-text{margin:0;font-size:14px;line-height:20px;word-break:break-all;color:var(--dsw-alias-label-primary,#1f1f1f)}",
				".dsh-session-delete-warn{margin:8px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#e5484d)}",
				".dsh-session-delete-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}",
				".dsh-session-delete-btn{cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#d5d5d5);background:transparent;color:var(--dsw-alias-label-primary,#1f1f1f);border-radius:8px;padding:6px 14px;font-size:13px;line-height:18px}",
				".dsh-session-delete-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}",
				".dsh-session-delete-danger-btn{border-color:transparent;background:var(--dsw-alias-state-error-primary,#e5484d);color:#fff}",
				".dsh-session-delete-danger-btn:hover{filter:brightness(.92)}",
				".dsh-session-delete-danger-btn:disabled{opacity:.6;cursor:default}",
				".dsh-session-delete-danger{color:var(--dsw-alias-state-error-primary,#e5484d)}",
				".dsh-session-delete-toast{position:fixed;left:50%;bottom:32px;transform:translate(-50%,20px);opacity:0;pointer-events:none;transition:all .2s ease;z-index:2147483700;background:var(--dsw-alias-bg-layer-2,#111);color:var(--dsw-alias-label-primary,#fff);border:1px solid var(--dsw-alias-border-l2,transparent);border-radius:8px;padding:9px 16px;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.3)}",
				".dsh-session-delete-toast-show{opacity:1;transform:translate(-50%,0)}",
				".dsh-session-delete-toast-error{background:var(--dsw-alias-state-error-primary,#e5484d);color:#fff}",
				"@keyframes dshSdFade{from{opacity:0}to{opacity:1}}"
			].join("\n");
			document.head.appendChild(style);
		}

		function apply(ctx) {
			try {
				injectStyle();
				document.addEventListener("click", onDocClickCapture, true);
				setupObserver();
			} catch (error) {
				console.error("[dsh-session-delete] apply failed:", error);
			}
		}

		exports.name = "dsh-session-delete";
		exports.apply = apply;
		return module.exports;
	}
});
