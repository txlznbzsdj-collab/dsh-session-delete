# dsh-session-delete

在 DSH Web 侧边栏「会话列表」中，给每个会话的三点下拉菜单**底部**新增一个 **「删除」** 按钮，点击后弹出**二次确认**对话框，确认后**硬删除**该会话（内存会话 + 磁盘持久化数据一并移除）。

## 功能

- 会话三点菜单底部新增「删除」项（危险样式，红色）。
- 点击「删除」→ 弹窗确认「此操作会永久删除该会话，无法恢复」。
- 确认后调用 host 端点硬删除：
  1. dispose 内存中的 live 会话（触发 `session/disposed` → `host/session-removed`，所有客户端列表即时移除）；
  2. 删除磁盘上的持久化 jsonl 会话目录，确保重启后不再出现。
- 删除成功/失败有轻量 toast 提示。

## 安装（注册到 web profile）

1. 把本目录放到任意插件目录，例如：
   `E:\桌面\dshGUI_install\plugins\dsh-session-delete`
2. 编辑 `C:\Users\<用户>\.dsh\profiles\web\package.json`：
   - 在 `dependencies` 增加：
     ```json
     "dsh-session-delete": "link:E:/桌面/dshGUI_install/plugins/dsh-session-delete"
     ```
   - 在 `dsh.profile.bundles` 数组加入：`"dsh-session-delete"`
3. 在 `C:\Users\<用户>\.dsh\profiles\web` 下执行：
   ```bash
   pnpm install
   ```
4. 重启 DSH Web GUI（`dsh web`），刷新浏览器。

## 说明与限制

- 客户端用 DOM 注入：监听 `[role="menu"]` 会话菜单出现，克隆现有菜单项样式并追加「删除」。菜单类名是哈希的，因此采用“克隆现有项”而非硬编码类名，具备一定的版本韧性。
- 会话 id 通过 React fiber（`__reactFiber$…` 链上的 `memoizedProps.node.id`）读取，不依赖 DOM data 属性。
- host 端点 `/plugins/dsh-session-delete/delete` 仅允许本机回环地址访问，并校验 Origin，防止跨站调用。
- 依赖 DSH 内部会话存储（`ctx.sessions.store`）与持久化服务（`ctx.sessionPersistence`）。若 DSH 后续升级改变这些内部结构，可能需要相应适配。
- 「删除」是硬删除，不可恢复，请谨慎使用。
