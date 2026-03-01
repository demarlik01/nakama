# Spec 04: Session Manager (Pi SDK)

## 목표
Pi SDK 기반으로 에이전트 세션을 생성/관리하고, Slack 메시지를 처리.

## 세션 생명주기

```
새 메시지 도착
  ↓
Session Manager
  ├── idle 세션 있음? → 재사용
  └── 없음? → 새 세션 생성
        ↓
      buildSystemPrompt()
        → AGENTS.md + MEMORY.md + 오늘/어제 로그
        ↓
      createAgentSession() (Pi SDK)
        ↓
      메시지 전달 → agentLoop 처리
        ↓
      응답 반환 → Slack 전송
        ↓
      idle 대기
        ↓ (30분 타임아웃)
      세션 종료 (메모리 저장)
```

## 인터페이스

```typescript
class SessionManager {
  constructor(
    private registry: AgentRegistry,
    private config: AppConfig
  )

  // 메시지 처리 (Slack에서 호출)
  handleMessage(agentId: string, message: string, context: {
    slackChannelId: string;
    slackThreadTs?: string;
    slackUserId: string;
  }): Promise<string>

  // 세션 조회
  getActiveSession(agentId: string): SessionState | undefined
  getAllSessions(): SessionState[]

  // 세션 제어
  disposeSession(agentId: string): Promise<void>
}
```

## 시스템 프롬프트 조립 (memory.ts)

```typescript
function buildSystemPrompt(agent: AgentDefinition): string {
  const ws = agent.workspacePath;
  const parts = [
    readFileIfExists(path.join(ws, 'AGENTS.md')),
    readFileIfExists(path.join(ws, 'MEMORY.md')),
    readFileIfExists(path.join(ws, 'memory', `${today()}.md`)),
    readFileIfExists(path.join(ws, 'memory', `${yesterday()}.md`)),
  ].filter(Boolean);
  return parts.join('\n\n---\n\n');
}
```

## Pi SDK 세션 생성

```typescript
import { createAgentSession } from '@mariozechner/pi-coding-agent';

const session = createAgentSession({
  model: agent.model || config.llm.defaultModel,
  apiKey: resolveApiKey(config),
  workingDirectory: agent.workspacePath,
  tools: ['Bash', 'Read', 'Write', 'Edit'],
  systemPrompt: buildSystemPrompt(agent),
});
```

> **Note:** Pi SDK의 정확한 API는 구현 시 확인 필요. 위는 예상 인터페이스.

## 메시지 큐 (per agent)

```
[msg3] → [msg2] → [msg1] → [처리 중]

- 에이전트당 큐 1개
- 순차 처리 (동시 요청 X)
- 큐 사이즈 초과 시 "바쁩니다" 응답
```

## 완료 기준
- [ ] Pi SDK로 에이전트 세션 생성
- [ ] AGENTS.md + MEMORY.md 기반 시스템 프롬프트 조립
- [ ] Slack 메시지 → Pi agentLoop → 응답 반환
- [ ] 기본 도구 동작 (Bash, Read, Write, Edit)
- [ ] idle 세션 재사용
- [ ] 메시지 큐 (순차 처리)
