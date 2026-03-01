# Architecture Design Document

> 최종 수정: 2026-03-01
> Pi SDK + setup-token(구독) 기반 아키텍처.
> PRD v0.2 반영: 범용 에이전트, 동적 레지스트리, API 레이어.

## 1. 기술 결정 요약

| 결정 | 선택 | 이유 |
|------|------|------|
| LLM 통신 | HTTP API (Pi SDK) | 구조화된 요청/응답, 도구 호출 내장 |
| 에이전트 런타임 | Pi SDK (`@mariozechner/pi-*`) | OpenClaw 코어 엔진, 실전 검증 |
| Slack 연동 | Slack Bolt (TypeScript) | 공식 프레임워크, 이벤트/스레드 지원 |
| 인증 | setup-token (Claude 구독) | Claude Max 구독으로 월정액, API 키 과금 불필요 |
| 에이전트 등록 | 파일시스템 기반 동적 레지스트리 | config 재시작 없이 에이전트 추가/삭제 |
| API | REST API 서버 | Web UI + 외부 연동 대비 |

### 인증 방식: setup-token
- `claude setup-token` 명령으로 토큰 생성 → Pi SDK에 전달
- Claude Max/Pro 구독 크레딧을 API처럼 사용 가능
- 토큰 만료 시 재발급 필요
- API 키 방식도 병행 가능 (필요 시 전환)

---

## 2. 시스템 아키텍처

```
┌──────────────────────────────────────────────────────────────┐
│                      Slack Workspace                          │
│    DM / @agent 멘션 / 스레드 답장                              │
└────────────────────────┬─────────────────────────────────────┘
                         │ Slack Events API (WebSocket)
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                      Agent Gateway                            │
│                                                               │
│  ┌──────────┐   ┌──────────────┐   ┌───────────────────────┐ │
│  │  Slack   │   │   REST API   │   │     Scheduler         │ │
│  │  Bolt    │   │   Server     │   │   (cron/heartbeat)    │ │
│  └────┬─────┘   └──────┬───────┘   └──────────┬────────────┘ │
│       │                │                       │              │
│       ▼                ▼                       ▼              │
│  ┌────────────────────────────────────────────────────────┐   │
│  │                  Message Router                         │   │
│  │  Slack 메시지 / API 요청 → 에이전트 매핑                 │   │
│  └───────────────────────┬────────────────────────────────┘   │
│                          ▼                                    │
│  ┌────────────────────────────────────────────────────────┐   │
│  │                Agent Registry                           │   │
│  │                                                        │   │
│  │  워크스페이스 디렉토리 감시 (fs watch)                    │   │
│  │  에이전트 추가/삭제 자동 감지                             │   │
│  │  에이전트 메타데이터 + Slack 매핑 관리                    │   │
│  └───────────────────────┬────────────────────────────────┘   │
│                          ▼                                    │
│  ┌────────────────────────────────────────────────────────┐   │
│  │                Session Manager                          │   │
│  │                                                        │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐             │   │
│  │  │ Agent A  │  │ Agent B  │  │ Agent C  │  ...        │   │
│  │  │ session  │  │ session  │  │ session  │             │   │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘             │   │
│  └───────┼──────────────┼──────────────┼──────────────────┘   │
│          ▼              ▼              ▼                      │
│  ┌────────────────────────────────────────────────────────┐   │
│  │           Pi Agent Loop (per session)                   │   │
│  │                                                        │   │
│  │  createAgentSession() / agentLoop()                    │   │
│  │     ↓                                                  │   │
│  │  pi-ai: LLM API 호출 (Anthropic/OpenAI/Google)         │   │
│  │     ↓                                                  │   │
│  │  tool call → Tool Executor → 결과 → 반복               │   │
│  └────────────────────────────────────────────────────────┘   │
│          │                                                    │
│          ▼                                                    │
│  ┌────────────────────────────────────────────────────────┐   │
│  │                 Tool Executor                           │   │
│  │                                                        │   │
│  │  기본 도구: Bash, Read, Write, Edit, WebSearch, WebFetch│   │
│  │  (셸로 git, gh, curl 등 뭐든 실행 가능)                 │   │
│  └────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
           │
           ▼
┌────────────────────────┐  ┌──────────────────┐
│ /workspaces/           │  │ Anthropic API    │
│  ├── agent-a/          │  │ (또는 Bedrock/   │
│  ├── agent-b/          │  │  Vertex)         │
│  └── _shared/          │  └──────────────────┘
└────────────────────────┘
```

---

## 3. 컴포넌트 상세

### 3.1 Agent Registry (동적 에이전트 관리)

에이전트 등록은 **파일시스템 기반**. config.yaml에 하드코딩하지 않는다.

```
/workspaces/
├── _shared/                    # 팀 공유 (모든 에이전트 읽기 가능)
├── reviewer/                   # 에이전트 "reviewer"
│   └── AGENTS.md               # ← 이 파일이 있으면 에이전트로 인식
├── marketing-bot/              # 에이전트 "marketing-bot"
│   └── AGENTS.md
└── new-agent/                  # 폴더 + AGENTS.md 추가 → 자동 등록
    └── AGENTS.md
```

**동작 방식:**
- `workspaces/` 하위 디렉토리를 fs.watch로 감시
- `AGENTS.md`가 있는 디렉토리 = 에이전트
- 디렉토리 추가/삭제 → 에이전트 자동 등록/해제 (서버 재시작 불필요)
- Slack 채널 매핑은 `agent.json`에 저장 (Web UI에서 설정)

```typescript
// Agent Registry
interface AgentDefinition {
  id: string;                    // 디렉토리명
  displayName: string;           // agent.json에서 로드
  workspacePath: string;         // /workspaces/{id}/
  slackChannels: string[];       // 멘션 가능한 채널
  slackUsers: string[];          // DM 매핑된 유저
  model?: string;                // 모델 오버라이드 (없으면 기본값)
  enabled: boolean;
}

// 워크스페이스 스캔
function scanAgents(rootPath: string): AgentDefinition[] {
  return fs.readdirSync(rootPath)
    .filter(dir => dir !== '_shared')
    .filter(dir => fs.existsSync(path.join(rootPath, dir, 'AGENTS.md')))
    .map(dir => loadAgentDefinition(rootPath, dir));
}
```

**에이전트별 설정 파일:**
```
/workspaces/{agent-id}/
├── AGENTS.md          # 역할, 톤, 행동 규칙 (사용자 작성)
├── agent.json         # 메타데이터 (Web UI가 관리)
│   {
│     "displayName": "코드 리뷰어",
│     "slackChannels": ["C01CODEREVIEW"],
│     "slackUsers": ["U01HSKIM"],
│     "model": "claude-sonnet-4-20250514",
│     "enabled": true
│   }
├── MEMORY.md          # 장기 기억 (에이전트 자동 관리)
├── TOOLS.md           # 도구 메모 (에이전트 자동 관리)
├── HEARTBEAT.md       # 능동적 행동 체크리스트 (선택)
├── memory/            # 일별 로그
│   ├── 2026-03-01.md
│   └── 2026-02-28.md
└── docs/              # 도메인 지식 (사용자 추가)
```

### 3.2 REST API Server

Web UI 및 외부 연동을 위한 API 레이어.

```
POST   /api/agents                  # 에이전트 생성
GET    /api/agents                  # 에이전트 목록
GET    /api/agents/:id              # 에이전트 상세
PATCH  /api/agents/:id              # 에이전트 설정 수정
DELETE /api/agents/:id              # 에이전트 삭제

GET    /api/agents/:id/logs         # 활동 로그
GET    /api/agents/:id/sessions     # 세션 목록
GET    /api/agents/:id/usage        # 토큰 사용량

POST   /api/agents/:id/message      # 에이전트에게 메시지 전송 (API 경유)

GET    /api/health                  # 서버 상태
GET    /api/config                  # 서버 설정 (읽기 전용)
```

**에이전트 생성 플로우 (API):**
```typescript
// POST /api/agents
{
  "id": "reviewer",               // 디렉토리명 (slug)
  "displayName": "코드 리뷰어",
  "agentsMd": "# 코드 리뷰어\n\n## 역할\nPR이 올라오면...",
  "slackChannels": ["C01CODEREVIEW"],
  "slackUsers": ["U01HSKIM"],
  "model": "claude-sonnet-4-20250514"  // optional
}

// → 서버가 수행하는 일:
// 1. /workspaces/reviewer/ 디렉토리 생성
// 2. AGENTS.md 작성
// 3. agent.json 작성
// 4. Agent Registry가 fs.watch로 자동 감지 → 등록
```

**Phase 1에서는** API 서버를 간단한 Express/Fastify로 구현.
Web UI는 P1이지만, API 구조는 Phase 1부터 만들어둔다.

### 3.3 Slack Bolt (프론트엔드)

```typescript
// 이벤트 핸들링
app.event('app_mention', handler)   // 채널에서 @agent 멘션
app.event('message', handler)       // DM 수신
app.event('message', handler)       // 스레드 답장 (thread_ts)
```

**Slack → Agent 라우팅:**
```
DM              → 발신자에 매핑된 에이전트 (agent.json의 slackUsers)
@agent 멘션     → 멘션된 에이전트 (Slack Bot User → agent-id 매핑)
스레드 답장     → 해당 스레드의 세션에 연결
```

**Agent → Slack 응답:**
- 스레드 기반 대화 (thread_ts로 연결)
- 긴 응답은 분할 (Slack 4000자 제한)
- 코드 블록은 Snippet으로 첨부
- 진행 상황은 메시지 업데이트 (`chat.update`)

### 3.4 Message Router

Agent Registry를 참조해서 메시지를 올바른 에이전트로 라우팅.

```typescript
class MessageRouter {
  constructor(private registry: AgentRegistry) {}

  route(event: SlackEvent): AgentDefinition | null {
    // 1. @멘션 → Bot User ID로 에이전트 찾기
    if (event.type === 'app_mention') {
      return this.registry.findByBotUserId(event.botUserId);
    }
    // 2. DM → 발신자 유저 ID로 매핑된 에이전트 찾기
    if (event.channel_type === 'im') {
      return this.registry.findBySlackUser(event.user);
    }
    // 3. 스레드 → 기존 세션에서 에이전트 찾기
    if (event.thread_ts) {
      return this.registry.findByThread(event.thread_ts);
    }
    return null;
  }
}
```

### 3.5 Session Manager

에이전트 세션의 전체 생명주기 관리.

#### 세션 = Pi agentLoop 인스턴스

```typescript
import { createAgentSession } from '@mariozechner/pi-coding-agent';

const session = createAgentSession({
  model: agent.model || config.llm.defaultModel,
  apiKey: resolveApiKey(config),
  workingDirectory: agent.workspacePath,
  tools: ['Bash', 'Read', 'Write', 'Edit', 'WebSearch', 'WebFetch'],
  systemPrompt: buildSystemPrompt(agent),
});
```

#### 세션 상태

```
 [IDLE] ──message──▶ [RUNNING] ──complete──▶ [IDLE]
   │                    │                       │
   │                    │ error                 │ idle timeout
   │                    ▼                       ▼
   │                [ERROR]                [DISPOSED]
   │                    │                       │
   │                 retry                  새 세션
   │                    │                   (메모리 복원)
   └────────────────[RUNNING]
```

#### 동시성

```
에이전트당:
  - Active session: 최대 1개 (순차 처리)
  - 새 메시지 → 큐에 추가, 현재 응답 완료 후 처리
  - 큐 사이즈: 10 (초과 시 "바쁩니다" 응답)

메시지 큐 (per agent):
  ┌──────────────────────────────────┐
  │  msg3 → msg2 → msg1 → [처리중]   │
  └──────────────────────────────────┘
```

### 3.6 Tool Executor

**기본 도구 (모든 에이전트):**

| 도구 | 설명 |
|------|------|
| Bash | 셸 명령 실행 (git, gh, curl 등 뭐든 가능) |
| Read | 파일 읽기 |
| Write | 파일 쓰기/생성 |
| Edit | 파일 부분 편집 |
| WebSearch | 웹 검색 |
| WebFetch | URL 내용 가져오기 |

**도구 철학:**
- 기본 도구는 최소한으로 유지
- Bash가 있으면 git, gh, npm, python 등 뭐든 실행 가능
- 역할별 전용 도구가 필요하면 그때 플러그인으로 추가
- 처음부터 많이 넣지 않는다

**보안:**
- 각 에이전트는 자기 워크스페이스(`/workspaces/{id}/`)에서만 파일 읽기/쓰기
- `_shared/`는 읽기 전용
- Bash 실행은 에이전트 워크스페이스를 cwd로 설정
- 위험한 명령어 블랙리스트 (Phase 2에서 강화)

### 3.7 Memory System

#### 메모리 계층

```
┌──────────────────────────────────────────────────────────┐
│ L1: Conversation Context (Pi 내부)                        │
│ - agentLoop의 messages 배열                               │
│ - 세션 살아있는 동안 자동 유지                              │
│ - 세션 종료 시 소멸                                        │
├──────────────────────────────────────────────────────────┤
│ L2: Daily Log (일별 기록)                                 │
│ - /workspaces/{agent}/memory/YYYY-MM-DD.md               │
│ - 에이전트가 중요한 것을 직접 기록                          │
│ - 세션 시작 시 오늘 + 어제 로드                            │
├──────────────────────────────────────────────────────────┤
│ L3: Long-term Memory (장기)                               │
│ - /workspaces/{agent}/MEMORY.md                          │
│ - 핵심만 큐레이션 (선호도, 교훈, 패턴)                      │
│ - 매 세션 시작 시 로드                                     │
├──────────────────────────────────────────────────────────┤
│ L4: Agent Identity (정체성)                               │
│ - /workspaces/{agent}/AGENTS.md                          │
│ - 역할, 톤, 행동 규칙                                     │
│ - 시스템 프롬프트로 주입                                   │
├──────────────────────────────────────────────────────────┤
│ L5: Domain Knowledge (도메인)                             │
│ - /workspaces/{agent}/docs/                              │
│ - 프로젝트 문서, 가이드 등                                 │
│ - 필요할 때 에이전트가 Read 도구로 읽음                     │
├──────────────────────────────────────────────────────────┤
│ L6: Shared Knowledge (팀 공유)                            │
│ - /workspaces/_shared/                                   │
│ - 팀 컨벤션, 공통 가이드, 회사 정책                        │
│ - 모든 에이전트 읽기 가능                                  │
└──────────────────────────────────────────────────────────┘
```

#### 세션 시작 시 컨텍스트 조립

```typescript
function buildSystemPrompt(agent: AgentDefinition): string {
  const ws = agent.workspacePath;

  const parts = [
    readFileIfExists(`${ws}/AGENTS.md`),
    readFileIfExists(`${ws}/MEMORY.md`),
    readFileIfExists(`${ws}/memory/${today()}.md`),
    readFileIfExists(`${ws}/memory/${yesterday()}.md`),
  ].filter(Boolean);

  return parts.join('\n\n---\n\n');
}
```

#### 컨텍스트 윈도우 관리

```
1. 세션 수명 제한
   - idle 30분 → 세션 종료
   - 새 대화 시 새 세션 (메모리에서 복원)

2. 세션 종료 시 자동 요약
   - 에이전트에게 "오늘 한 일 요약해서 memory/{today}.md에 기록해"
   - 다음 세션에서 요약본으로 복원

3. 도메인 지식은 참조만
   - 시스템 프롬프트에 "docs/ 폴더에 참고 자료 있음" 정도만
   - 필요할 때 Read 도구로 직접 읽게 함
```

### 3.8 Scheduler

```typescript
// 에이전트별 스케줄 (agent.json에서 로드)
interface AgentSchedule {
  name: string;
  cron?: string;           // "0 9 * * 1-5"
  every?: string;          // "30m"
  message: string;
  deliverTo: string;       // Slack 채널 or "dm"
}

// 레지스트리에서 에이전트 스케줄 로드 → 동적 등록
registry.onAgentChange((agent) => {
  scheduler.unregisterAll(agent.id);
  for (const schedule of agent.schedules) {
    scheduler.register(agent.id, schedule);
  }
});
```

---

## 4. 워크스페이스 구조

```
/workspaces/
├── _shared/                       # 팀 공유 (모든 에이전트 읽기 가능)
│   ├── README.md                  # 팀 소개, 공통 가이드
│   └── docs/
│       └── ...
│
├── reviewer/                      # 에이전트: 코드 리뷰어
│   ├── AGENTS.md                  # 역할 + 행동 규칙
│   ├── agent.json                 # 메타데이터 (Slack 매핑 등)
│   ├── MEMORY.md                  # 장기 기억
│   ├── TOOLS.md                   # 도구 메모 (선택)
│   ├── HEARTBEAT.md               # 능동적 행동 체크리스트 (선택)
│   ├── memory/
│   │   ├── 2026-03-01.md
│   │   └── 2026-02-28.md
│   └── docs/
│       └── coding-conventions.md
│
├── marketing-bot/                 # 에이전트: 마케팅 어시스턴트
│   ├── AGENTS.md
│   ├── agent.json
│   ├── MEMORY.md
│   └── docs/
│       └── brand-guide.md
│
└── cs-helper/                     # 에이전트: CS 도우미
    ├── AGENTS.md
    ├── agent.json
    ├── MEMORY.md
    └── docs/
        └── faq-template.md
```

---

## 5. 설정

```yaml
# config.yaml — 서버 설정만. 에이전트 정의는 워크스페이스에.
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
  root: /workspaces
  shared: _shared

api:
  enabled: true
  port: 3001                    # API 서버 포트 (Slack과 분리)
  # auth: TBD (Phase 2)

session:
  idleTimeoutMin: 30
  maxQueueSize: 10
  autoSummaryOnDispose: true
```

---

## 6. 데이터 흐름

### 6.1 에이전트 생성 (Web UI → API)

```
Web UI: "새 에이전트" 폼 작성
  │
  ▼
POST /api/agents
  { id: "reviewer", displayName: "코드 리뷰어", agentsMd: "...", ... }
  │
  ▼
API Server
  │ 1. /workspaces/reviewer/ 디렉토리 생성
  │ 2. AGENTS.md 작성
  │ 3. agent.json 작성
  │ 4. MEMORY.md 빈 파일 생성
  ▼
Agent Registry (fs.watch)
  │ 새 디렉토리 + AGENTS.md 감지 → 에이전트 등록
  │ Slack Bot User 매핑 업데이트
  ▼
에이전트 사용 가능
```

### 6.2 일반 대화

```
User: "@reviewer 이 PR 리뷰해줘 #142"
  │
  ▼
Slack Bolt (app_mention)
  │
  ▼
Message Router
  │ @reviewer → registry.find("reviewer")
  │ 에이전트 워크스페이스: /workspaces/reviewer/
  ▼
Session Manager
  │ idle 세션 있으면 재사용, 없으면 새 세션
  │ buildSystemPrompt() → AGENTS.md + MEMORY.md + 오늘/어제 로그
  ▼
Pi agentLoop
  │ 1. LLM: "이 PR 리뷰해줘 #142"
  │ 2. tool_use: Bash("gh pr view 142 --json")
  │ 3. tool_use: Bash("gh pr diff 142")
  │ 4. 최종 응답 (리뷰 결과)
  ▼
Slack Bolt → 스레드에 응답
```

### 6.3 크론 실행

```
Scheduler (agent.json의 schedule)
  │ "매일 9시 스탠드업"
  ▼
Session Manager
  │ reviewer 전용 scheduled session 생성
  │ max runtime: 5분
  ▼
Pi agentLoop → 작업 수행
  ▼
Slack → 지정된 채널에 결과 포스트
  ▼
Session 종료
```

---

## 7. 기술 스택

| 구분 | 선택 | 이유 |
|------|------|------|
| 언어 | TypeScript (Node.js) | Pi SDK = TypeScript, Slack Bolt 지원 |
| LLM 런타임 | Pi SDK (`@mariozechner/pi-*`) | 에이전트 루프 + 도구 + 멀티 프로바이더 |
| Slack | `@slack/bolt` | 공식, 이벤트/스레드/인터랙션 |
| API | Express 또는 Fastify | 경량, TypeScript 지원 |
| 스케줄러 | `node-cron` | 가볍고 단순 |
| 프로세스 | 단일 Node.js 프로세스 | Phase 1은 충분, 필요 시 worker threads |

**Pi SDK 패키지:**
```
@mariozechner/pi-ai            → LLM 멀티 프로바이더 레이어
@mariozechner/pi-agent-core    → 에이전트 루프 (tool use 기반)
@mariozechner/pi-coding-agent  → 코딩 에이전트 + 내장 도구 + SDK 모드
```

---

## 8. 비용 예측

### setup-token 방식 (구독 기반)

| 항목 | 비용 |
|------|------|
| Claude Max 구독 | $100-200/월 (per seat) |
| Slack 앱 | 무료 (자체 호스팅) |
| 서버 | 기존 인프라 또는 $5-20/월 |

### API 키 방식 (fallback)

| 항목 | 예상 비용 |
|------|----------|
| Claude Sonnet | $3/M input, $15/M output |
| 월 예상 (에이전트 3개, Sonnet) | ~$30-100 |

---

## 9. 개발 단계

### Phase 1: PoC (2주)

```
src/
├── index.ts              # 엔트리포인트
├── api/
│   ├── server.ts         # REST API 서버
│   └── routes/
│       └── agents.ts     # 에이전트 CRUD
├── slack/
│   └── app.ts            # Slack Bolt
├── core/
│   ├── registry.ts       # Agent Registry (fs watch)
│   ├── router.ts         # Message Router
│   ├── session.ts        # Session Manager
│   └── memory.ts         # 시스템 프롬프트 조립
├── config.ts             # 설정 로드
└── types.ts              # 공통 타입
```

**Phase 1 범위:**
- [ ] Agent Registry (파일시스템 기반 동적 등록)
- [ ] Slack Bot (DM, 멘션, 스레드)
- [ ] Message Router
- [ ] Session Manager (Pi SDK 기반)
- [ ] 기본 도구 (Bash, Read, Write, Edit, WebSearch, WebFetch)
- [ ] REST API (에이전트 CRUD)
- [ ] 메모리 (AGENTS.md + MEMORY.md + daily log)
- [ ] 개발팀 시나리오 데모

### Phase 2: MVP (4주)
- [ ] Web UI (에이전트 추가/목록/상태)
- [ ] Scheduler / Heartbeat
- [ ] idle timeout + 자동 세션 종료/복원
- [ ] 메모리 자동 요약
- [ ] 비용 트래킹 (토큰 사용량)
- [ ] 에러 복구
- [ ] 팀 파일럿

### Phase 3: Beta (8주)
- [ ] Web UI (행동 지침 에디터, 대시보드, 메모리 뷰어)
- [ ] 역할 템플릿
- [ ] 팀 권한 관리
- [ ] 에이전트 간 협업 (메시지 전달)
- [ ] 비개발 팀 시나리오 검증
- [ ] 외부 베타

---

## 10. 확장 고려사항

지금 구현하지 않지만, 구조적으로 대비하는 것들:

| 확장 | 현재 구조의 대비 | 나중에 추가 |
|------|----------------|------------|
| 에이전트 간 협업 | `_shared/` 폴더 (읽기 공유) | 에이전트끼리 메시지 전달 API |
| 멀티 LLM | `agent.json`에 model 필드 | UI에서 모델 선택 |
| 커스텀 도구 | Bash로 뭐든 실행 가능 | 플러그인 구조 (도구 패키지) |
| 스케일링 | 단일 프로세스 | Worker threads → 별도 프로세스 |
| 권한 관리 | 에이전트별 워크스페이스 격리 | 도구별 권한, Bash 명령어 블랙리스트 |
| 외부 이벤트 | Slack 이벤트만 | Webhook 수신 (GitHub, Jira 등) |
