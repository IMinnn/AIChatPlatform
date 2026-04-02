# AI Platform

一个私人 AI 大模型聊天平台原型，支持：

- 多对话管理与上下文记忆
- 个人中心配置
- 多模型 API 配置与切换
- 知识库上传与本地 RAG 检索
- ChatGPT 风格的响应式聊天界面

## 快速启动

1. 进入项目目录：

```bash
cd /Users/hm/CodeProjects/OpenAICodex/AIPlatform
```

2. 安装依赖：

```bash
pnpm install
```

3. 配置模型：

编辑 `data/models.json`，填入可用的 OpenAI 兼容接口信息：

```json
[
  {
    "id": "gpt-4o-mini",
    "name": "GPT-4o Mini",
    "apiUrl": "https://api.openai.com/v1/chat/completions",
    "token": "YOUR_API_KEY",
    "provider": "openai-compatible",
    "enabled": true
  }
]
```

4. 运行开发环境：

```bash
pnpm dev --hostname 127.0.0.1 --port 3000
```

5. 打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)

## 生产启动

```bash
cd /Users/hm/CodeProjects/OpenAICodex/AIPlatform
pnpm install
pnpm build
pnpm start
```

## Python Backend

项目里已经新增了一个独立的 Python 后端迁移目录：

`backend/`

当前已迁移的核心接口包括：

- `GET/PUT /api/settings`
- `GET /api/models`
- `GET/PUT /api/model-providers`
- `GET/POST /api/knowledge-bases`
- `GET/POST /api/conversations`
- `GET/PATCH/DELETE /api/conversations/{conversation_id}`
- `POST /api/chat`

启动方式：

```bash
cd /Users/hm/CodeProjects/OpenAICodex/AIPlatform
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

说明：

- 当前前端还没有强制切换到 Python 后端，迁移会分阶段完成
- Python 后端与现有前端共享 `data/models.json` 和 `storage/app-state.json`

## 说明

- 当前版本使用 `storage/app-state.json` 做本地持久化。
- 知识库支持 `.txt`、`.md`、`.csv`、`.json`、`.html` 等文本类文件。
- RAG 检索使用本地轻量向量哈希方案，方便快速验证整套流程。
- 模型接口默认按 OpenAI 兼容 `chat/completions` 流式协议代理。
