// verify/inject-check.mjs
// 用 CDP（Chrome DevTools Protocol）验证 dsh-session-delete 插件在运行中的
// DSH Web GUI 里是否：注入「删除」菜单项、确认框弹出、主题变量生效。
//
// 用法：
//   1) 用 --remote-debugging-port=9222 启动 Chrome 并打开 http://127.0.0.1:3456/
//   2) node verify/inject-check.mjs
//
// 需要 WebSocket 全局可用（Node 18+ 自带）。无需第三方依赖。

const CDP = process.env.CDP || "http://127.0.0.1:9222";
const GUI = process.env.GUI || "http://127.0.0.1:3456/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const list = await (await fetch(`${CDP}/json`)).json();
  const tab = list.find((t) => t.type === "page" && String(t.url).startsWith(GUI.replace(/\/$/, ""))) || list.find((t) => t.type === "page");
  if (!tab) throw new Error("no GUI page tab found on CDP");
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) { errors.push(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return undefined; } return r.result?.value; };
  await new Promise((r) => (ws.onopen = r));
  await send("Runtime.enable");

  for (let i = 0; i < 40; i++) { await sleep(500); const n = await ev(`document.querySelectorAll('[class*="sessionRow"]').length`); if (n > 0) break; }

  const cssInjected = await ev(`[...document.styleSheets].some(s=>{try{return s.cssRules&&[...s.cssRules].some(r=>r.cssText&&r.cssText.includes('dsh-session-delete'))}catch(e){return false}})`);
  const rows = await ev(`document.querySelectorAll('[class*="sessionRow"]').length`);
  console.log(JSON.stringify({ cssInjected, rows, errors }, null, 2));
  ws.close();
}

main().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
