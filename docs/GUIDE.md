# GitStar Auto-Classifier 使用说明

## 项目目的

GitHub 上 star 了太多项目，时间久了根本记不清每个项目是干什么的。这个工具帮你自动分类所有 star 的项目，按类别整理后展示在 README 中，方便查阅和检索。

## 运作机制

```
GitHub Action（每周一定时触发 / 手动触发）
  │
  ├─ 1. 通过 GitHub API 拉取你所有 star 的项目
  │     （包含项目名、描述、语言、topics、star 数等元信息）
  │
  ├─ 2. 与历史分类记录（data/classifications.json）对比，找出新增项目
  │     首次运行：全量分类
  │     后续运行：只处理增量
  │
  ├─ 3. 调用 LLM API（OpenAI 兼容格式），批量分类项目
  │     每批 10 个项目，自动归入 28 个预定义类别之一
  │
  ├─ 4. 将分类结果合并到 state 文件，重新生成 README.md
  │
  └─ 5. 自动 commit & push（[skip ci] 避免循环触发）
```

### 分类类别

AI/ML · Analytics · Blockchain/Web3 · CLI Tool · Cloud/DevOps · Database · Developer Tool · Documentation · Editor/IDE · Embedded/IoT · Frontend Framework · Game Development · GIS/Mapping · Image Processing · Learning/Education · Library/Utility · Messaging/Chat · Mobile Development · Monitoring/Observability · Networking · Operating System · Package Manager · Security · Static Site Generator · Template/Boilerplate · Testing · Web Framework · Other

## 项目结构

```
├── .github/workflows/
│   └── classify-stars.yml      # GitHub Action 工作流
├── src/
│   ├── main.js                 # 入口：编排整个流程
│   ├── github-client.js        # GitHub API 客户端（拉取 star 列表）
│   ├── classifier.js           # LLM 分类器（调用 API + 解析结果）
│   ├── state.js                # 状态管理（读取/写入/对比/合并）
│   ├── readme-generator.js     # README 生成器
│   └── config.js               # 配置加载（支持 .env 文件）
├── data/
│   └── classifications.json    # 分类状态文件（git 跟踪）
├── .env                        # 本地配置（已 gitignore）
├── README.md                   # 自动生成的分类结果
└── docs/
    └── GUIDE.md                # 本文件
```

## 配置说明

### 方式一：本地运行（推荐先用此方式验证）

1. 在项目根目录创建 `.env` 文件（已自动 gitignore，不会提交）：

```bash
# 必填：你的 GitHub 用户名
GH_USERNAME=your-github-username

# 可选：GitHub Token（不填则使用匿名请求，有速率限制）
# 公开 star 不需要 token，但建议配置以提高 API 限额
GH_TOKEN=

# 必填：LLM API Key
LLM_API_KEY=sk-your-api-key

# 必填：OpenAI 兼容的 API Base URL
# DeepSeek:     https://api.deepseek.com
# OpenAI:       https://api.openai.com/v1
# 其他兼容服务: 按服务商文档填写
LLM_BASE_URL=https://api.deepseek.com

# 可选：模型名称（默认 gpt-4o-mini）
# DeepSeek:     deepseek-v4-flash
# OpenAI:       gpt-4o-mini / gpt-4o
LLM_MODEL=deepseek-v4-flash
```

2. 运行：

```bash
node src/main.js
```

3. 全量重分类：

```bash
FORCE_REFRESH=true node src/main.js
```

### 方式二：GitHub Actions 自动运行

#### 1. 配置 Secrets

在 GitHub 仓库页面：**Settings → Secrets and variables → Actions → Repository secrets**

| 名称 | 说明 |
|---|---|
| `LLM_API_KEY` | 你的 LLM API Key |
| `LLM_BASE_URL` | API Base URL（如 `https://api.deepseek.com`） |

#### 2. 配置 Variables（可选）

在 **Settings → Secrets and variables → Actions → Variables**：

| 名称 | 默认值 | 说明 |
|---|---|---|
| `GH_USERNAME` | 仓库所有者 | 要分类的 GitHub 用户名 |
| `LLM_MODEL` | `gpt-4o-mini` | 模型名称 |

#### 3. 触发方式

- **自动**：每周一 UTC 03:00 自动运行
- **手动**：进入 Actions → Classify Starred Repos → Run workflow
  - 勾选 `force_refresh` 可强制全量重分类

#### 4. 使用 DeepSeek 的完整配置示例

Secrets：
```
LLM_API_KEY   = sk-xxxxxxxxxxxxxxxx
LLM_BASE_URL  = https://api.deepseek.com
```

Variables：
```
LLM_MODEL     = deepseek-v4-flash
```

## 增量机制

- 分类结果保存在 `data/classifications.json`，以 repo `full_name` 为 key
- 每次运行时，拉取所有 star → 对比 state → 只将未分类的项目发送给 LLM
- 如需全量重分类：设置 `FORCE_REFRESH=true` 或在 Actions 中勾选 `force_refresh`

## 注意事项

- `.env` 文件已被 `.gitignore` 排除，API Key 不会被提交到仓库
- GitHub Actions 中的 Secrets 也是加密存储的，日志中不会泄露
- 155 个项目单次分类耗时约 2 分钟，LLM 费用约 ¥0.01（DeepSeek flash）
- 后续增量运行通常只有 0-5 个新项目，耗时和费用可忽略
