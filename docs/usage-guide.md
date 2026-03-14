# Nakama — 사용 가이드

## 목차

- [에이전트와 대화하기](#에이전트와-대화하기)
- [슬래시 커맨드](#슬래시-커맨드)
- [채널 모드](#채널-모드)
- [컨시어지](#컨시어지)
- [에이전트가 할 수 있는 것](#에이전트가-할-수-있는-것)
- [Web UI / API](#web-ui--api)
- [LLM 인증 설정](#llm-인증-설정)
- [에이전트 커스터마이징](#에이전트-커스터마이징)

---

## 에이전트와 대화하기

### 멘션 (기본)

채널에 에이전트가 배정되어 있으면, `@봇이름`으로 멘션해서 대화를 시작합니다.

```
@AgentBot 이 API의 에러 핸들링 개선해줘
```

### 스레드 대화

스레드 안에서는 **멘션 없이** 계속 대화할 수 있습니다. 에이전트가 스레드를 기억합니다.

```
@AgentBot 이 코드 리뷰해줘      ← 스레드 시작 (멘션 필요)
  └─ 테스트도 추가해줘           ← 멘션 없이 이어감
  └─ LGTM 머지해도 돼?          ← 멘션 없이 이어감
```

### `/as` — 특정 에이전트로 스레드 시작

에이전트가 여러 개일 때, 특정 에이전트를 지정해서 대화를 시작합니다.

```
@AgentBot /as engineer 이 버그 좀 봐줘
@AgentBot /as marketer 다음 주 캠페인 초안 잡아줘
```

- `@봇` 멘션 + `/as {agent-id 또는 이름}` 형식
- 스레드가 시작되면 이후 대화는 해당 에이전트가 계속 담당
- 스레드 시작 시 최근 채널 메시지 5~10개가 컨텍스트로 자동 주입됨

### DM

봇에게 직접 DM을 보내면 해당 유저에 매핑된 에이전트가 응답합니다.

---

## 슬래시 커맨드

Slack 채팅창에서 바로 실행 가능합니다. 결과는 **본인에게만 보입니다** (ephemeral).

| 커맨드 | 설명 | 예시 |
|--------|------|------|
| `/nakama agents` | 등록된 에이전트 목록 보기 | `/nakama agents` |
| `/nakama assign {agent}` | 현재 채널에 에이전트 배정 | `/nakama assign engineer` |
| `/nakama unassign` | 현재 채널의 에이전트 배정 해제 | `/nakama unassign` |
| `/nakama switch {agent}` | 현재 채널의 에이전트를 다른 것으로 교체 | `/nakama switch marketer` |

### 워크플로우 예시

```
1. 새 채널 #dev-backend 생성
2. 봇 초대: /invite @AgentBot
3. 봇 멘션 → 컨시어지가 안내 (아직 배정 안 됨)
4. /nakama assign engineer → 채널에 engineer 에이전트 배정
5. @AgentBot 안녕 → engineer 에이전트가 응답
```

---

## 채널 모드

에이전트가 채널에서 어떻게 반응할지를 결정합니다.

| 모드 | 동작 | 용도 |
|------|------|------|
| `mention` | `@봇` 멘션했을 때만 응답 | 일반 업무 채널 (기본값) |
| `proactive` | 모든 메시지에 응답 가능 (에이전트가 판단) | 에이전트 전용 채널, 1:1 작업 채널 |

- proactive 모드에서도 에이전트가 "응답 불필요"로 판단하면 침묵합니다 (NO_REPLY)
- 과잉 응답 방지를 위한 rate limit + 중복 가드가 내장되어 있습니다

---

## 컨시어지

봇이 초대된 채널에 **에이전트가 배정되어 있지 않을 때** 자동 안내합니다.

```
┌──────────────────────────────────────────┐
│ 이 채널에 배정된 에이전트가 없습니다.       │
│                                          │
│ 사용 가능한 에이전트 목록                   │
│ • Engineer (engineer) - 백엔드 개발       │
│ • Marketer (marketer) - 마케팅 기획       │
│                                          │
│ /nakama assign {agent} 명령어로 에이전트를 배정하세요│
└──────────────────────────────────────────┘
```

- LLM 호출 없이 룰 베이스 응답 (토큰 비용 0)
- 에이전트가 하나라도 배정되면 컨시어지 대신 에이전트가 응답

---

## 에이전트가 할 수 있는 것

에이전트 생성 시 `tools` 배열로 능력을 지정합니다.

| 도구 | 설명 |
|------|------|
| `coding` | 파일 읽기/쓰기/편집 + bash 실행 (Pi SDK 내장) |
| `web_search` | 웹 검색 (Brave Search API) |
| `web_fetch` | URL → 마크다운 추출 |
| `memory` | 워크스페이스 내 memory/ 파일 읽기/쓰기 |

### 파일 첨부

에이전트가 파일을 생성하면 Slack에 자동으로 첨부합니다.

```
에이전트 응답:
"분석 결과를 정리했습니다."
MEDIA:./reports/analysis.png     ← 자동으로 슬랙에 파일 업로드
```

### 이미지 이해

유저가 이미지를 업로드하면 에이전트가 내용을 "볼 수" 있습니다 (비전/멀티모달).
- 지원 포맷: JPEG, PNG, GIF, WebP
- 자동 리사이즈 (1200px / 5MB 한도)

---

## Web UI / API

### Web UI

`http://localhost:3001` 에서 대시보드 접근 가능.

- 에이전트 목록 및 상태 확인
- 에이전트 생성/편집/삭제
- 실시간 세션 모니터링 (SSE)

### REST API

```bash
# 인증
AUTH=$(echo -n "admin:{password}" | base64)

# 에이전트 목록
curl -s http://localhost:3001/api/agents \
  -H "Authorization: Basic $AUTH"

# 에이전트 생성
curl -s -X POST http://localhost:3001/api/agents \
  -H "Authorization: Basic $AUTH" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "my-agent",
    "displayName": "My Agent",
    "channels": { "C0CHANNEL1": { "mode": "mention" } },
    "slackUsers": [],
    "model": "anthropic/claude-sonnet-4-20250514",
    "tools": ["coding", "web_search", "web_fetch", "memory"]
  }'

# 에이전트 삭제
curl -s -X DELETE http://localhost:3001/api/agents/my-agent \
  -H "Authorization: Basic $AUTH"
```

---

## 에이전트 커스터마이징

각 에이전트의 워크스페이스(`~/.nakama/workspaces/{agent-id}/`)에 있는 파일로 행동을 커스터마이징합니다.

| 파일 | 용도 | 누가 편집 |
|------|------|-----------|
| `AGENTS.md` | 역할, 톤, 행동 규칙 정의 | 사용자 |
| `agent.json` | 모델, 채널, 도구 설정 | Web UI / API |
| `MEMORY.md` | 장기 기억 | 에이전트 (자동) |
| `HEARTBEAT.md` | 능동 행동 체크리스트 | 사용자/에이전트 |

### AGENTS.md 예시

```markdown
# 역할
너는 백엔드 엔지니어야. TypeScript + Node.js 전문.

## 행동 규칙
- 코드 변경 시 항상 테스트 포함
- PR 리뷰 요청 받으면 보안/성능/가독성 관점에서 피드백
- 모르는 건 모른다고 솔직하게

## 톤
- 간결하고 직설적
- 이모지 최소화
```

에이전트는 이 파일을 시스템 프롬프트로 사용하여 역할에 맞게 행동합니다.

---

## LLM 인증 설정

Nakama는 `config.yaml`의 `llm.auth` 설정으로 LLM 인증을 관리합니다.

### 인증 방식

#### 1. API Key 방식

Anthropic API 키를 직접 사용합니다.

**CLI로 설정:**

```bash
nakama auth set-key
# 프롬프트에 API 키 입력
```

**config.yaml 직접 편집:**

```yaml
llm:
  auth:
    type: api-key
    key: sk-ant-api03-...
```

#### 2. OAuth 방식 (Claude Max/Pro 구독)

Claude 구독 크레딧을 사용합니다. 브라우저 기반 OAuth 로그인 후 토큰이 config.yaml에 자동 저장됩니다.

**CLI로 설정:**

```bash
nakama auth login
# 브라우저에서 인증 완료 → 토큰 자동 저장
```

**config.yaml 직접 편집:**

```yaml
llm:
  auth:
    type: oauth
    accessToken: sk-ant-oat01-...
    refreshToken: sk-ant-ort01-...
    expires: 1773354715015
```

### `nakama auth` CLI

| 명령어 | 설명 |
|--------|------|
| `nakama auth login` | OAuth 로그인 (브라우저) |
| `nakama auth set-key` | API 키 설정 |
| `nakama auth status` | 현재 인증 상태 확인 |

### 참고

- 전체 설정 예시는 [`config.example.yaml`](../config.example.yaml) 참조
- OAuth 토큰은 만료 시 자동 갱신됩니다
