# LLM 에이전트 런타임 접근법 조사

> 작성일: 2026-02-26
> 목적: Slack 연동 "AI 팀원" 에이전트 개발을 위한 LLM 통신 방식 비교

---

## 0. Pi (pi-mono) 아키텍처 — OpenClaw의 기반

### 개요
Pi는 Mario Zechner(badlogic)가 만든 코딩 에이전트. **OpenClaw는 Pi를 기반으로 만들어졌다.**
소스: https://github.com/badlogic/pi-mono

### 모노레포 구조
```
packages/
  ai/          → @mariozechner/pi-ai (LLM 통신 레이어)
  agent/       → @mariozechner/pi-agent-core (에이전트 루프)
  coding-agent → @mariozechner/pi-coding-agent (CLI + 도구 + 세션)
```

### LLM 통신 방식: **직접 HTTP API 호출 (SDK 사용)**

Pi는 PTY가 아니다. `@anthropic-ai/sdk`를 직접 사용해서 Anthropic Messages API를 호출한다.

**`packages/ai/src/providers/anthropic.ts` 핵심 코드:**
```typescript
import Anthropic from "@anthropic-ai/sdk";

// 클라이언트 생성 후 직접 스트리밍 호출
const { client, isOAuthToken } = createClient(model, apiKey, ...);
const params = buildParams(model, context, isOAuthToken, options);
const anthropicStream = client.messages.stream({ ...params, stream: true }, { signal: options?.signal });
```

### 멀티 프로바이더 지원
`packages/ai/src/providers/` 디렉토리에 각 프로바이더별 구현:
- `anthropic.ts` — Anthropic Messages API (`@anthropic-ai/sdk`)
- `openai-completions.ts` — OpenAI Chat Completions API
- `openai-responses.ts` — OpenAI Responses API
- `google.ts` — Google AI (Gemini)
- `google-vertex.ts` — Google Vertex AI
- `azure-openai-responses.ts` — Azure OpenAI

### API 레지스트리 패턴
`api-registry.ts`에서 `registerApiProvider()`로 프로바이더를 등록하고, 모델의 `api` 필드로 라우팅:
```typescript
registerApiProvider({ api: "anthropic-messages", stream: streamAnthropic, streamSimple: ... });
registerApiProvider({ api: "openai-completions", stream: streamOpenAI, streamSimple: ... });
```

### 에이전트 루프 (`packages/agent/src/agent-loop.ts`)
```
사용자 메시지 → convertToLlm() → LLM API 스트리밍 호출
                                      ↓
                               tool call 감지 → 도구 실행 → 결과를 컨텍스트에 추가
                                      ↓
                               tool call 없으면 → 종료
```
- `streamSimple()` / `streamFn()`으로 LLM 호출
- `config.getApiKey(provider)`로 런타임에 API 키 해결 (만료 토큰 대응)
- steering 메시지로 실행 중 사용자 개입 가능

### "스텔스 모드" — Claude Code 흉내
Anthropic 프로바이더에 흥미로운 코드:
```typescript
const claudeCodeVersion = "2.1.2";
const claudeCodeTools = ["Read", "Write", "Edit", "Bash", "Grep", ...];
const toClaudeCodeName = (name) => ccToolLookup.get(name.toLowerCase()) ?? name;
```
도구 이름을 Claude Code와 동일하게 매핑해서 Anthropic API에 전송. 이는 Claude Code의 시스템 프롬프트 캐시를 활용하기 위한 최적화로 추정.

### OpenClaw와의 관계
- OpenClaw는 Pi의 `pi-ai`, `pi-agent-core` 패키지를 의존성으로 사용
- OpenClaw이 추가한 것: Gateway(제어 플레인), 채널 어댑터(Telegram/Slack/etc), 멀티 에이전트 라우팅, Web UI
- **핵심 LLM 통신은 Pi의 코드가 담당**

### 우리 에이전트에의 시사점
- **Pi의 아키텍처를 직접 참고/사용 가능** — npm 패키지로 배포됨
- `@mariozechner/pi-ai`: LLM 멀티 프로바이더 레이어
- `@mariozechner/pi-agent-core`: 에이전트 루프 (tool use 기반)
- `@mariozechner/pi-coding-agent`: SDK로 프로그래매틱 사용 가능 (`createAgentSession()`)

---

## 1. OpenClaw 아키텍처

### 개요
OpenClaw는 자체 호스팅 AI 에이전트 오케스트레이션 플랫폼 (GitHub 180K+ stars, 2026.02 기준).
LLM은 "두뇌"이고, OpenClaw는 "운영체제" 역할.
**Pi(pi-mono)를 기반으로 만들어졌으며**, LLM 통신 코어는 Pi의 `pi-ai` 패키지를 사용.

### LLM 통신 방식
- **OpenAI-compatible HTTP API** 방식으로 LLM과 통신
- `models.providers` 설정에서 provider/model 형식으로 지정 (예: `anthropic/claude-opus-4-6`)
- 지원 API 형식: `openai-completions`, `anthropic`, 직접 HTTP 등
- PTY 방식이 아님 — 표준 REST API 호출

### 핵심 구조
```
채널(Telegram/WhatsApp/Slack) → Gateway(제어 플레인) → Agent Runtime → LLM API
                                                           ↓
                                                    Tool 실행 (Bash, Read, Write 등)
```

### 주요 특징
- **채널 어댑터**: Telegram, WhatsApp, Discord, Slack 등 메시징 앱 연동
- **Gateway**: 세션 관리, 권한 제어, 도구 허용 목록, 샌드박스
- **Agent Runtime**: 세션 해결 → 컨텍스트 조립 → 실행 루프 (LLM 호출 → 도구 실행 반복)
- **API 키 로테이션**: 여러 키를 설정해 429 에러 시 자동 전환
- **멀티 프로바이더**: OpenAI, Anthropic, Google, Ollama (로컬) 등 동시 지원

### 우리 에이전트에 적용 가능성
- OpenClaw 자체를 에이전트로 쓸 수 있음 (Slack 채널 어댑터 있음)
- 또는 OpenClaw의 아키텍처 패턴(Gateway → Agent Loop → Tool)을 참고해서 자체 구현

---

## 2. Claude Agent SDK (구 Claude Code SDK)

### 개요
Anthropic 공식 SDK. Claude Code의 에이전트 루프, 도구, 컨텍스트 관리를 라이브러리로 제공.

### 사용 방식
```python
from claude_agent_sdk import query, ClaudeAgentOptions

async for message in query(
    prompt="Find and fix the bug in auth.py",
    options=ClaudeAgentOptions(allowed_tools=["Read", "Edit", "Bash"]),
):
    print(message)
```

### 인증
- **API 키**: `ANTHROPIC_API_KEY` (정석, 유료 API)
- **Bedrock/Vertex/Azure**: 각 클라우드 프로바이더 경유 가능
- **setup-token (구독 인증)**: `claude setup-token` 명령으로 토큰 생성 → SDK에 전달. Claude Max/Pro 구독 크레딧 사용 가능. OpenClaw/Pi에서 현재 이 방식으로 운영 중 (검증됨).

### 내장 도구
| 도구 | 기능 |
|------|------|
| Read | 파일 읽기 |
| Write | 파일 생성 |
| Edit | 파일 수정 |
| Bash | 셸 명령 실행 |
| Glob/Grep | 파일 검색 |
| WebSearch/WebFetch | 웹 검색/가져오기 |
| AskUserQuestion | 사용자에게 질문 |

### Hooks 시스템
- `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart` 등 라이프사이클 훅
- 커스텀 로직 주입 가능 (감사 로그, 도구 차단 등)

### 장단점
- ✅ 가장 완성도 높은 Claude 에이전트 런타임
- ✅ 내장 도구 + 커스텀 도구 확장 가능
- ✅ Python/TypeScript 지원
- ❌ Anthropic API 키 필요 (유료, 사용량 기반 과금)
- ❌ Claude 전용 (다른 LLM 사용 불가)

---

## 3. PTY (Pseudo-Terminal) 기반 접근법

### 개요
CLI 도구(Claude Code 등)를 PTY로 감싸서 프로그래매틱하게 제어하는 방식.
OpenClaw 초기에 이런 접근을 했다는 이야기가 있으나, 현재는 API 기반으로 전환.

### 동작 방식
```
에이전트 프로세스 → PTY spawn → claude-code CLI → LLM 응답 파싱
```

### 장단점
- ✅ CLI만 있으면 됨 (SDK 불필요)
- ✅ Claude Max 구독 활용 가능 (CLI 자체는 구독으로 동작)
- ⚠️ PTY 방식 자체의 불안정성 (응답 파싱, 에러 처리) — API 방식이 더 나음
- ❌ 출력 파싱 불안정 (구조화된 응답 아님)
- ❌ 에러 처리 어려움
- ❌ 동시성/성능 제한

---

## 4. 다른 에이전트 프레임워크들

### LangGraph (LangChain)
- **LLM 호출**: 표준 HTTP API (OpenAI/Anthropic/etc API 키 기반)
- **특징**: 상태 머신 기반 에이전트 그래프, 체크포인트, 분기 로직
- **Slack 연동**: LangChain + Slack Bolt 조합 예시 다수 존재
- **장점**: 멀티 LLM, 복잡한 워크플로우, 큰 생태계
- **단점**: 추상화 레이어 복잡, 러닝 커브

### CrewAI
- **LLM 호출**: LiteLLM 래퍼 (100+ LLM 지원)
- **특징**: 역할 기반 멀티 에이전트, 태스크 위임
- **장점**: 직관적 멀티 에이전트 설계
- **단점**: 단순 유스케이스에 과도할 수 있음

### AutoGen (Microsoft)
- **LLM 호출**: OpenAI-compatible API
- **특징**: 대화형 멀티 에이전트, 코드 실행
- **장점**: 에이전트 간 대화 패턴, 인간 참여 루프
- **단점**: 설정 복잡

### Vercel AI SDK
- **LLM 호출**: 통합 API (다중 프로바이더)
- **특징**: TypeScript 우선, 스트리밍 기본
- **Slack 연동**: 공식 Slackbot 가이드 제공 (`ai-sdk.dev/cookbook/guides/slackbot`)
- **장점**: 웹/Node.js 생태계와 자연스러운 통합
- **단점**: Python 미지원

### Slack 전용 오픈소스
- **Slack Bolt** + LLM: 가장 기본적인 패턴. Slack 이벤트 수신 → LLM API 호출 → 응답 전송
- **LLM-slackbot-channels** (GitHub): LangChain 기반 Slack 봇
- **NVIDIA NIM + LangChain Slack Agent**: 엔터프라이즈 급 예시

---

## 5. 비용 비교

| 항목 | API 직접 호출 | Claude Agent SDK | OpenClaw + API 키 | PTY/CLI 래핑 |
|------|-------------|-----------------|-------------------|-------------|
| **인증** | API 키 | API 키 | API 키 | 구독 OAuth |
| **비용 구조** | 사용량 기반 (토큰당) | 사용량 기반 (토큰당) | 사용량 기반 + 셀프호스팅 | 월정액 ($100-200) |
| **Claude Opus 비용** | $15/M input, $75/M output | 동일 | 동일 | Max $200/월 무제한* |
| **구독 인증** | setup-token | setup-token | setup-token | CLI 구독 |
| **확장성** | 높음 | 높음 | 높음 | 낮음 |
| **예상 월비용 (중간 사용)** | $50-500 | $50-500 | $50-500 + 서버 | $200 고정 |

> setup-token 방식으로 Claude 구독 크레딧 사용 가능 (OpenClaw/Pi에서 검증됨)

---

## 6. 종합 비교표

| 접근법 | LLM 통신 | 멀티 LLM | Slack 연동 | 내장 도구 | 난이도 | 안정성 | 추천도 |
|--------|---------|---------|-----------|---------|-------|-------|-------|
| **Pi (pi-mono) SDK** | HTTP API (직접) | ✅ | 직접 구현 | ✅ 풍부 | 중 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Claude Agent SDK** | HTTP API | ❌ Claude만 | 직접 구현 | ✅ 풍부 | 중 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **OpenClaw 활용** | HTTP API | ✅ | ✅ 기본 제공 | ✅ 풍부 | 중 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **LangGraph + Slack Bolt** | HTTP API | ✅ | 조합 필요 | 커스텀 | 상 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Vercel AI SDK + Slack** | HTTP API | ✅ | 가이드 있음 | 일부 | 중 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **직접 API 호출 + Slack Bolt** | HTTP API | ✅ | 직접 구현 | 직접 구현 | 상 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **PTY/CLI 래핑** | PTY | ❌ | 직접 구현 | CLI 의존 | 상 | ⭐⭐ | ⭐ |
| **CrewAI** | HTTP API | ✅ | 직접 구현 | 일부 | 중 | ⭐⭐⭐ | ⭐⭐⭐ |

---

## 7. 권장 접근법

### 🏆 추천: Pi SDK (@mariozechner/pi-*) + Slack Bolt

**이유:**
1. **실전 검증** — OpenClaw(180K+ stars)의 실제 코어 엔진
2. **멀티 프로바이더** — Anthropic, OpenAI, Google, Azure 등 모두 지원
3. **에이전트 루프** — tool use 기반 자율 실행 루프 내장, steering 지원
4. **내장 도구** — Read, Write, Edit, Bash, Grep, Find 등
5. **SDK 모드** — `createAgentSession()`으로 프로그래매틱 사용 가능
6. **npm 패키지** — `@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-coding-agent`

**아키텍처:**
```
Slack (Bolt SDK)
  → 이벤트 수신 (멘션, DM, 스레드)
  → Pi createAgentSession() or agentLoop()
    → pi-ai가 LLM API 호출 (Anthropic/OpenAI/etc)
    → 도구 실행 (Bash, Read, Edit 등)
    → 결과를 Slack 스레드에 응답
```

### 🥈 대안: Claude Agent SDK + Slack Bolt
- Anthropic 공식 SDK, 가장 안정적
- Claude 전용이지만 완성도 높음
- Hooks 시스템으로 커스텀 로직 주입

### 🥉 대안: OpenClaw 직접 활용
- 이미 Slack 채널 어댑터 있음
- 도구 생태계 + 멀티 LLM 지원
- 단, 커스터마이징 범위가 OpenClaw 프레임워크에 제한됨

### 기타: LangGraph + Slack Bolt
- 복잡한 멀티스텝 워크플로우가 필요한 경우
- 멀티 LLM 전환이 중요한 경우

---

## 8. 핵심 인사이트

1. **모든 프로덕션 에이전트는 HTTP API 호출 방식을 사용** — PTY는 해킹에 가까움
2. **Pi가 핵심** — OpenClaw의 LLM 통신 코어는 Pi의 `pi-ai` 패키지. Pi를 이해하면 OpenClaw를 이해한 것
3. **Pi의 Anthropic 프로바이더는 `@anthropic-ai/sdk`를 직접 사용** — 자체 HTTP 구현이 아닌 공식 SDK 래핑
4. **setup-token으로 구독 인증 가능** — `claude setup-token`으로 토큰 생성, Pi SDK에서 사용. API 키 과금 없이 구독 크레딧 활용.
5. **Slack Bolt**는 거의 모든 접근법에서 Slack 연동의 기본 레이어
6. **Pi SDK가 가장 실용적** — 멀티 프로바이더 + 에이전트 루프 + 내장 도구, 이미 검증됨
7. **비용**: 중간 사용량 기준 월 $50-500 예상 (API 키 방식)
