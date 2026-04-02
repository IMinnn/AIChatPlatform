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
cd .../AIPlatform
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


## 说明

- 当前版本使用 `storage/app-state.json` 做本地持久化。
- 知识库支持 `.txt`、`.md`、`.csv`、`.json`、`.html` 等文本类文件。
- RAG 检索使用本地轻量向量哈希方案，方便快速验证整套流程。
- 模型接口默认按 OpenAI 兼容 `chat/completions` 流式协议代理。
