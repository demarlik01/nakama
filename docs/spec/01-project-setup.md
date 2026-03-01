# Spec 01: 프로젝트 셋업

## 목표
TypeScript + Node.js 프로젝트 초기 구조 생성.

## 범위
- `package.json` (dependencies, scripts)
- `tsconfig.json`
- 디렉토리 구조
- `config.yaml` 로더
- 타입 정의

## 디렉토리 구조

```
agent-for-work/
├── src/
│   ├── index.ts              # 엔트리포인트 (모든 컴포넌트 부트스트랩)
│   ├── config.ts             # config.yaml 로드 + 검증
│   ├── types.ts              # 공통 타입/인터페이스
│   ├── api/
│   │   ├── server.ts         # REST API 서버 (Express/Fastify)
│   │   └── routes/
│   │       └── agents.ts     # 에이전트 CRUD 라우트
│   ├── slack/
│   │   └── app.ts            # Slack Bolt 앱
│   ├── core/
│   │   ├── registry.ts       # Agent Registry
│   │   ├── router.ts         # Message Router
│   │   ├── session.ts        # Session Manager
│   │   └── memory.ts         # 시스템 프롬프트 조립
│   └── utils/
│       └── logger.ts         # 로깅
├── config.example.yaml
├── package.json
├── tsconfig.json
└── workspaces/
    └── _shared/
        └── README.md
```

## 주요 의존성

```json
{
  "dependencies": {
    "@slack/bolt": "^4.x",
    "@mariozechner/pi-ai": "latest",
    "@mariozechner/pi-agent-core": "latest",
    "@mariozechner/pi-coding-agent": "latest",
    "express": "^4.x",
    "yaml": "^2.x",
    "chokidar": "^4.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "tsx": "^4.x",
    "@types/node": "^22.x",
    "@types/express": "^4.x"
  }
}
```

## config.yaml 스키마

```yaml
server:
  port: 3000

slack:
  app_token: ${SLACK_APP_TOKEN}
  bot_token: ${SLACK_BOT_TOKEN}

llm:
  provider: anthropic
  defaultModel: claude-sonnet-4-20250514
  auth: setup-token

workspaces:
  root: ./workspaces
  shared: _shared

api:
  enabled: true
  port: 3001

session:
  idleTimeoutMin: 30
  maxQueueSize: 10
  autoSummaryOnDispose: true
```

## 타입 정의 (types.ts)

```typescript
export interface AgentDefinition {
  id: string;
  displayName: string;
  workspacePath: string;
  slackChannels: string[];
  slackUsers: string[];
  model?: string;
  enabled: boolean;
  schedules?: AgentSchedule[];
}

export interface AgentSchedule {
  name: string;
  cron?: string;
  every?: string;
  message: string;
  deliverTo: string;
}

export interface AppConfig {
  server: { port: number };
  slack: { appToken: string; botToken: string };
  llm: { provider: string; defaultModel: string; auth: string };
  workspaces: { root: string; shared: string };
  api: { enabled: boolean; port: number };
  session: { idleTimeoutMin: number; maxQueueSize: number; autoSummaryOnDispose: boolean };
}
```

## 완료 기준
- [ ] `npm run dev`로 서버 시작 가능
- [ ] config.yaml 로드 + 환경변수 치환
- [ ] 타입 정의 완료
- [ ] 빈 컴포넌트 stub (registry, router, session, slack, api)
