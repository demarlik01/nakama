# Architecture Document

> 최종 수정: 2026-03-14
> P1~P8 구현 완료 기준. Pi SDK + Slack Bolt + Web Dashboard.

## 1. 기술 결정 요약

| 결정 | 선택 | 이유 |
|------|------|------|
| 언어 | TypeScript (Node.js) | Pi SDK = TypeScript, Slack Bolt 지원 |
| LLM 런타임 | Pi SDK (`@mariozechner/pi-*`) | 에이전트 루프 + 도구 호출 + 멀티 프로바이더 |
| LLM 인증 | setup-token (Claude 구독) | Claude Max 구독 크레딧 사용, API 키 과금 불필요 |
| Slack 연동 | `@slack/bolt` (Socket Mode) | 공식 프레임워크, 이벤트/스레드/인터랙션 |
| Web UI | Vite + React 19 + shadcn/ui | 다크 테마, 포트 3001 |
| API | Express | REST API, SSE 실시간 이벤트 |
| 세션 영속화 | Pi SDK SessionManager (JSONL) | 대화 히스토리 파일 기반 저장/복원 |
| 사용량 추적 | SQLite (better-sqlite3) | 토큰 사용량 DB |
| 크론 상태 | cron-store.json | 크론 잡 상태 영속화 |
| 이미지 처리 | sharp | Slack 첨부 이미지 리사이즈 → LLM 비전 |
| HTML 파싱 | linkedom + @mozilla/readability | web-fetch 도구 콘텐츠 추출 |
| 스케줄러 | croner | 크론 + interval 지원 |
| 파일 감시 | chokidar | 에이전트 동적 등록/해제 |

---

## 2. 시스템 아키텍처

```
┌──────────────────────────────────────────────────────────────┐
│                      Slack Workspace                          │
│    DM / @agent 멘션 / 스레드 답장 / 리액션                      │
└────────────────────────┬─────────────────────────────────────┘
                         │ Socket Mode (WebSocket)
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                     Agent Gateway                             │
│                                                               │
│  ┌───────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │  Slack    │  │   REST API   │  │  Cron / Heartbeat      │ │
│  │  Gateway  │  │   + SSE      │  │  Service               │ │
│  └─────┬─────┘  └──────┬───────┘  └──────────┬─────────────┘ │
│        │               │                      │               │
│        ▼               ▼                      ▼               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                 Message Router                           │  │
│  │  Slack 메시지 → 에이전트 매핑 (채널/DM/스레드/리액션)      │  │
│  │  컨시어지: 매핑 실패 시 에이전트 목록 안내                  │  │
│  └────────────────────────┬────────────────────────────────┘  │
│                           ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                Agent Registry                            │  │
│  │  파일시스템 감시 (chokidar) → 에이전트 동적 등록/해제      │  │
│  │  agent.json 메타데이터 + Slack 매핑 관리                  │  │
│  │  CRUD API (생성/수정/삭제)                                │  │
│  └────────────────────────┬────────────────────────────────┘  │
│                           ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │               Session Manager                            │  │
│  │                                                          │  │
│  │  세션 모드: single | per-channel | per-thread            │  │
│  │  세션 영속화 (JSONL via Pi SDK SessionManager)             │  │
│  │  idle timeout → 자동 종료                                 │  │
│  │  세션 TTL 클린업 (6시간 주기)                               │  │
│  │  메시지 큐 (per agent)                                    │  │
│  │                                                          │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐                 │  │
│  │  │ Agent A  │ │ Agent B  │ │ Agent C  │ ...             │  │
│  │  │ session  │ │ session  │ │ session  │                 │  │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘                 │  │
│  └───────┼─────────────┼─────────────┼──────────────────────┘  │
│          ▼             ▼             ▼                         │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │          Pi Agent Loop (per session)                      │  │
│  │                                                          │  │
│  │  createAgentSession() / agentLoop()                      │  │
│  │  LLM API 호출 (Anthropic/OpenAI/Google)                   │  │
│  │  tool call → Tool Executor → 결과 → 반복                  │  │
│  └──────────────────────┬──────────────────────────────────┘  │
│                         ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                Tool Executor                              │  │
│  │                                                          │  │
│  │  내장: Bash, Read, Write, Edit                            │  │
│  │  커스텀: WebSearch, WebFetch, MemoryRead, MemoryWrite     │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  Notifier        │  UsageTracker    │  SSE Manager       │  │
│  │  에러/알림 전송    │  토큰 사용량 추적  │  실시간 이벤트      │  │
│  └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
         │                                        │
         ▼                                        ▼
┌─────────────────────┐  ┌─────────────────────────────────────┐
│ ~/.nakama/  │  │ Web Dashboard (React)                │
│  ├── workspaces/    │  │  Dashboard, Agents, Sessions,        │
│  │   └── {agent}/   │  │  CronJobs, Health, Settings          │
│  │     └── sessions/│  │  포트 3001                            │
│  ├── usage.db       │  │                                      │
│  └── cron-store.json│  │                                      │
└─────────────────────┘  └─────────────────────────────────────┘
```

---

## 3. 소스 구조

```
nakama/
├── src/                          # 백엔드 (TypeScript)
│   ├── index.ts                  # 엔트리포인트
│   ├── config.ts                 # YAML 설정 로드 + 검증
│   ├── types.ts                  # 공통 타입 정의
│   ├── core/
│   │   ├── registry.ts           # AgentRegistry — 에이전트 CRUD + fs watch
│   │   ├── router.ts             # MessageRouter — Slack→에이전트 라우팅
│   │   ├── session.ts            # SessionManager — 세션 생명주기
│   │   ├── session-files.ts      # 세션 파일 I/O (영속화)
│   │   ├── memory.ts             # 시스템 프롬프트 조립
│   │   ├── cron.ts               # CronService — 크론 잡 관리
│   │   ├── heartbeat.ts          # HeartbeatRunner — 주기적 폴링
│   │   ├── notifier.ts           # Notifier — Slack 알림/에러 전송
│   │   ├── usage.ts              # UsageTracker — 토큰 사용량
│   │   └── llm/
│   │       ├── factory.ts        # LLM 프로바이더 팩토리
│   │       ├── provider.ts       # LLM 프로바이더 인터페이스
│   │       └── pi-provider.ts    # Pi SDK 기반 구현체
│   ├── slack/
│   │   ├── app.ts                # SlackGateway — Bolt 이벤트 핸들링
│   │   ├── commands.ts           # /nakama 슬래시 커맨드
│   │   ├── block-kit.ts          # Block Kit 메시지 포맷
│   │   ├── response-filter.ts    # 응답 필터링 (길이 제한 등)
│   │   ├── image-handler.ts      # 이미지 첨부 처리
│   │   ├── media-parser.ts       # MEDIA: 프로토콜 파싱
│   │   └── inbound-context.ts    # 인바운드 메시지 컨텍스트
│   ├── api/
│   │   ├── server.ts             # Express API 서버
│   │   ├── sse.ts                # SSE 실시간 이벤트
│   │   ├── middleware/
│   │   │   └── auth.ts           # Basic Auth
│   │   └── routes/
│   │       ├── agents.ts         # 에이전트 CRUD + 세션/로그
│   │       └── cron.ts           # 크론 잡 CRUD + 수동 실행
│   ├── tools/
│   │   ├── index.ts              # 도구 export
│   │   ├── web-search.ts         # Brave Search API
│   │   ├── web-fetch.ts          # URL 페치 + readability
│   │   └── memory.ts             # MEMORY.md 읽기/쓰기
│   └── utils/
│       ├── logger.ts             # 로거
│       └── duration.ts           # 시간 파싱 유틸
│
├── web/                          # 프론트엔드 (React)
│   └── src/
│       ├── pages/
│       │   ├── Dashboard.tsx     # 대시보드 (Overview)
│       │   ├── AgentList.tsx      # 에이전트 목록
│       │   ├── AgentDetail.tsx    # 에이전트 상세/설정
│       │   ├── AgentCreate.tsx    # 에이전트 생성
│       │   ├── Sessions.tsx       # 세션 목록
│       │   ├── SessionDetail.tsx  # 세션 대화 내용
│       │   ├── CronJobs.tsx       # 크론 잡 관리
│       │   ├── Health.tsx         # 시스템 상태
│       │   └── Settings.tsx       # 설정
│       ├── components/
│       │   ├── Layout.tsx
│       │   ├── EmptyState.tsx
│       │   ├── chat/
│       │   │   ├── ChatBubble.tsx
│       │   │   ├── SessionSelect.tsx
│       │   │   └── ToolCallBlock.tsx
│       │   └── ui/               # shadcn/ui 컴포넌트
│       ├── hooks/
│       │   └── useEventSource.ts # SSE 훅
│       └── lib/
│           ├── api.ts            # API 클라이언트
│           ├── message-parser.ts # 메시지 파싱 유틸
│           └── utils.ts
│
├── config.yaml                   # 서버 설정
├── package.json
└── docs/
    ├── architecture.md           # ← 이 파일
    ├── PRD.md
    ├── usage-guide.md
    ├── roadmap/                  # P1~P9 로드맵
    └── research/                 # 리서치 문서
```

---

## 4. 핵심 컴포넌트

### 4.1 Agent Registry

에이전트 등록은 **파일시스템 기반 동적 관리**. chokidar로 워크스페이스 감시.

```
~/.nakama/workspaces/
├── _shared/                    # 팀 공유 (읽기 전용)
├── reviewer/                   # 에이전트 "reviewer"
│   ├── AGENTS.md               # 역할/톤/행동 규칙 (사용자 작성)
│   ├── agent.json              # 메타데이터 (Web UI/API가 관리)
│   ├── MEMORY.md               # 장기 기억
│   ├── TOOLS.md                # 도구 메모
│   ├── HEARTBEAT.md            # 능동적 행동 체크리스트
│   ├── memory/                 # 일별 로그
│   └── docs/                   # 도메인 지식
└── ...
```

- `AGENTS.md` 존재 → 에이전트로 인식
- 디렉토리 추가/삭제 → 자동 등록/해제 (서버 재시작 불필요)
- `AgentRegistryEvents`로 변경 이벤트 방출

### 4.2 Message Router

Slack 메시지를 에이전트로 라우팅. 채널 모드 기반.

```
채널 모드:
  - mention: @멘션 시에만 반응
  - proactive: 채널의 모든 메시지에 반응

라우팅 우선순위:
  1. 스레드 → 기존 세션의 에이전트
  2. DM → slackUsers에 매핑된 에이전트
  3. @멘션 → slackBotUserId로 에이전트 찾기
  4. 채널 proactive 모드 → 해당 채널의 에이전트
  5. 매칭 실패 → 컨시어지 응답 (에이전트 목록 안내)
```

리액션 트리거: 특정 이모지 리액션으로 에이전트 호출 가능 (`reactionTriggers`).

### 4.3 Session Manager

세션 생명주기 관리. Pi SDK의 `createAgentSession()`으로 에이전트 루프 실행.

**세션 모드:**
- `single`: 에이전트당 세션 1개
- `per-channel`: 채널별 세션
- `per-thread`: 스레드별 세션

**세션 영속화:** Pi SDK의 `PiSessionManager`가 JSONL 파일로 대화 히스토리 저장. 각 에이전트 워크스페이스 내 `sessions/` 디렉토리에 저장. 세션 재시작 시 복원.

**세션 TTL 클린업:** 6시간 주기로 만료 세션 정리 (`sessionTTLDays` 기준).

**동시성:** 에이전트당 메시지 큐. 순차 처리 (maxQueueSize 초과 시 거부).

**Graceful Shutdown:** SIGINT/SIGTERM 시 활성 세션 대기 (최대 30초) 후 순차 종료.

### 4.4 Slack Gateway

`@slack/bolt` Socket Mode 기반. 이벤트 핸들링:
- `app_mention` — 채널 멘션
- `message` — DM, 스레드 답장, proactive 채널
- `reaction_added` — 리액션 트리거
- `/nakama` 슬래시 커맨드 — 에이전트 목록/상태 조회

Slack 응답 처리:
- 4000자 제한 분할
- 코드 블록 Snippet 첨부
- `MEDIA:` 프로토콜로 이미지/파일 첨부
- 에이전트별 커스텀 프로필 (displayName, icon)

### 4.5 Cron / Heartbeat

**CronService:** 에이전트별 크론 잡. config 또는 API로 등록.
- `at` (일회성), `every` (interval), `cron` (표현식) 스케줄 지원
- `sessionTarget`: main 세션에 주입 or isolated 세션 생성
- `deliverTo`: 결과 전송 채널 지정
- 상태 저장: `~/.nakama/cron-store.json` (source: `config` | `api`)

**HeartbeatRunner:** 주기적 폴링. `HEARTBEAT.md` 기반 체크리스트.
- `activeHours` 설정으로 야간 비활성화

### 4.6 이미지/비전 파이프라인

Slack 파일 첨부 → 이미지 비전 처리:
1. `image-handler.ts`: Slack 파일 URL에서 이미지 다운로드
2. `sharp`로 리사이즈 (LLM 입력 크기 최적화)
3. base64 인코딩 → Pi SDK `ImageContent`로 변환
4. LLM에 멀티모달 메시지로 전달

텍스트 파일 첨부도 지원 (`ProcessedTextFile` 타입).

### 4.7 에이전트별 제한 (LimitsConfig)

에이전트별로 리소스 제한 설정 가능:
- `maxConcurrentSessions` — 동시 세션 수 제한
- `dailyTokenLimit` — 일일 토큰 한도
- `maxMessageLength` — 메시지 길이 제한
- `proactiveResponseMinIntervalSec` — proactive 채널 응답 최소 간격

### 4.8 Tool Executor

| 도구 | 출처 | 설명 |
|------|------|------|
| Bash, Read, Write, Edit | Pi SDK (codingTools) | 내장 코딩 도구 |
| WebSearch | 커스텀 | Brave Search API |
| WebFetch | 커스텀 | URL 페치 + @mozilla/readability |
| MemoryRead | 커스텀 | MEMORY.md 읽기 |
| MemoryWrite | 커스텀 | MEMORY.md 쓰기 |

에이전트별 `tools` 필드로 사용 가능한 도구 제한 가능.

### 4.9 Memory System

```
L1: Conversation Context — Pi 내부 messages 배열 (세션 중 유지)
L2: Daily Log — memory/YYYY-MM-DD.md (오늘+어제 로드)
L3: Long-term — MEMORY.md (매 세션 로드)
L4: Identity — AGENTS.md (시스템 프롬프트 주입)
L5: Domain — docs/ (Read 도구로 필요시 참조)
L6: Shared — _shared/ (전체 에이전트 읽기 가능)
```

### 4.10 LLM Provider

Pi SDK 기반. `provider.ts` 인터페이스로 추상화.

```
config.llm.implementation → factory → PiLlmProvider
에이전트별 model 오버라이드: agent.model ?? config.llm.defaultModel
```

현재 Pi 구현만 완료. anthropic-direct / openai-direct는 미구현 (placeholder).

---

## 5. REST API

인증: Basic Auth (config.yaml `api.auth`, optional).

### System

```
GET    /api/health                         시스템 상태 (slackConnected, agentCount, uptimeSec)
GET    /api/config                         설정 조회 (시크릿 마스킹)
GET    /api/events                         SSE 실시간 이벤트 스트림
```

### Agents

```
POST   /api/agents                         에이전트 생성
GET    /api/agents                         에이전트 목록
GET    /api/agents/:id                     에이전트 상세
PUT    /api/agents/:id                     에이전트 전체 수정
PATCH  /api/agents/:id                     에이전트 부분 수정
DELETE /api/agents/:id                     에이전트 삭제
GET    /api/agents/:id/status              에이전트 상태
GET    /api/agents/:id/logs                활동 로그
GET    /api/agents/:id/agents-md           AGENTS.md 내용 조회
POST   /api/agents/:id/message             에이전트에게 메시지 전송
```

### Sessions

```
GET    /api/sessions                       전체 활성 세션 목록
GET    /api/sessions/all                   활성+아카이브 통합 (?agentFilter=xxx)
GET    /api/agents/:id/sessions            에이전트별 세션 목록
GET    /api/agents/:id/sessions/:sid       세션 상세 (대화 내용)
GET    /api/agents/:id/sessions/:sid/usage 세션 토큰 사용량
```

### Usage

```
GET    /api/agents/:id/usage               에이전트별 사용량 (?period=day|week|month)
GET    /api/usage/summary                  전체 사용량 서머리
```

### Cron

```
GET    /api/cron                           크론 잡 목록 (?agentId=xxx)
POST   /api/cron                           크론 잡 생성 (body: agentId)
PATCH  /api/cron/:id                       크론 잡 수정
DELETE /api/cron/:id                       크론 잡 삭제
POST   /api/cron/:id/run                   크론 잡 수동 실행
```

---

## 6. Web Dashboard

React 19 + Vite + shadcn/ui. 다크 테마. 포트 3001.

**페이지:**
- **Dashboard** — Overview (에이전트 수, 세션 수, 시스템 상태)
- **Agents** — 에이전트 목록 카드 뷰 + 생성/상세/설정
- **Sessions** — 전체 세션 리스트 + 대화 내용 뷰어 (Chat UI)
- **Cron Jobs** — 크론 잡 관리 UI
- **Health** — 시스템 상태
- **Settings** — 설정 뷰어

**실시간:** SSE (`useEventSource` 훅)로 에이전트 상태 변경, 새 메시지 등 수신.

---

## 7. 설정

```yaml
# config.yaml
server:
  port: 3000

slack:
  app_token: ${SLACK_APP_TOKEN}
  bot_token: ${SLACK_BOT_TOKEN}

llm:
  implementation: pi              # pi | anthropic-direct | openai-direct
  provider: anthropic
  defaultModel: claude-sonnet-4-20250514
  auth: setup-token

workspaces:
  root: ~/.nakama/workspaces
  shared: ~/.nakama/shared

api:
  enabled: true
  port: 3001
  # auth:                         # optional Basic Auth
  #   username: admin
  #   password: ${API_PASSWORD}

notifications:
  defaultChannel: ${DEFAULT_CHANNEL}

session:
  idleTimeoutMin: 30
  maxQueueSize: 10
  autoSummaryOnDispose: true
  sessionTTLDays: 30

tools:
  webSearch:
    braveApiKey: ${BRAVE_API_KEY}
```

---

## 8. 개발 현황

| Phase | 상태 | 주요 내용 |
|-------|------|----------|
| P1 | ✅ 완료 | Slack 연동, 에이전트 레지스트리, 세션, 기본 도구, REST API |
| P2 | ✅ 완료 | 리액션 트리거, 에이전트 CRUD API |
| P3 | ✅ 완료 | Web UI 기본 |
| P4 | ✅ 완료 | 멀티에이전트 |
| P5 | ✅ 완료 | 세션 영속화 |
| P6 | ✅ 완료 | 프롬프트 템플릿, 채널 라우팅, 컨시어지, 커스텀 툴, 파일 첨부, 이미지 비전 |
| P7 | ✅ 완료 | /nakama 통합, 프로필 커스터마이징, Heartbeat & Cron, 에이전트 메모리, 세션 모드 |
| P8 | ✅ 완료 | Web Dashboard UI 전면 개편 |
| P9 | 미착수 | Webhook, Slack Interactive, RAG, MCP, 에이전트간 통신, 감사로그 등 |

상세 로드맵: `docs/roadmap/P1-ROADMAP.md` ~ `P9-ROADMAP.md`

---

## 9. 확장 고려사항

| 확장 | 현재 상태 | 향후 |
|------|----------|------|
| 에이전트 간 협업 | `_shared/` 폴더 공유 | 메시지 전달 API (P9) |
| 멀티 LLM | agent.json에 model 필드 ✅ | UI에서 모델 선택 |
| 커스텀 도구 | WebSearch/WebFetch/Memory 구현 ✅ | 플러그인 구조 |
| 외부 이벤트 | Slack 이벤트만 | Webhook 수신 (P9) |
| 권한 관리 | 에이전트별 워크스페이스 격리 | 도구별 권한 |
| 스케일링 | 단일 Node.js 프로세스 | Worker threads |
| RAG | 미구현 | 벡터 검색 (P9) |
