# verify/

用 Chrome DevTools Protocol（CDP）对运行中的 DSH Web GUI 做端到端验证的脚本。

## 前置

1. 以远程调试端口启动 Chrome 并打开 GUI：

   ```sh
   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/dsh-cdp http://127.0.0.1:3456/
   ```

   （非 headless 也行，只要能渲染出会话列表。）

2. 环境变量（可选）：
   - `CDP`：调试端口地址，默认 `http://127.0.0.1:9222`
   - `GUI`：GUI 地址，默认 `http://127.0.0.1:3456/`

## 脚本

- `inject-check.mjs`：检查插件样式是否已注入、会话行是否渲染、控制台有无报错。

## 运行

```sh
node verify/inject-check.mjs
```

需要 Node 18+（自带全局 `WebSocket`）。无第三方依赖。
