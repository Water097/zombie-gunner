# memory/ · 项目记忆镜像

这个目录是**工作记忆的版本化镜像**，让上下文能跟着 git 走，换机器不用重新交代。

| 文件 | 内容 |
|---|---|
| `MEMORY.md` | 长期项目记忆：坐标/已完成/关键决策（勿回退项）/当前偏差/下一步/纪律 |
| `YYYY-MM-DD.md` | 按日工作日志，append-only，记当天做了什么、为什么、踩了什么坑 |

## 怎么用

```bash
# 换机器 clone 后：把镜像还原到助手的本地记忆目录
node scripts/memory-sync.mjs --pull

# 写完记忆后：本地 → 本目录（镜像），然后 commit
node scripts/memory-sync.mjs

# 只自检是否同步（有差异退出码 1）
node scripts/memory-sync.mjs --check
```

## 注意

- **别手改这里的文件**：本地记忆目录（`.workbuddy/memory/`）才是真相源，同步是单向镜像，手改会被下次同步覆盖。
- 本目录的 `README.md` 受脚本保护，不参与镜像。
- `.workbuddy/` 本身在 `.gitignore` 里（内部状态不进仓库），所以本目录是记忆对外的唯一出口。
- 记忆内容会随仓库公开，写之前别放密钥、个人隐私、第三方敏感信息。
