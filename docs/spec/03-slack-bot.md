# Spec 03: Slack Bot + Message Router

## 목표
Slack Bolt로 메시지 수신 → Agent Registry 참조 → 올바른 에이전트로 라우팅.

## Slack 이벤트 처리

| 이벤트 | 라우팅 규칙 |
|--------|-----------|
| DM | 발신자 userId → agent.json의 slackUsers에서 매핑된 에이전트 |
| @멘션 | 멘션된 Bot User → 에이전트 매핑 |
| 스레드 답장 | 기존 세션의 thread_ts로 에이전트 찾기 |

## Message Router

```typescript
class MessageRouter {
  constructor(
    private registry: AgentRegistry,
    private sessionManager: SessionManager
  )

  route(event: SlackMessageEvent): {
    agent: AgentDefinition;
    threadTs?: string;
  } | null
}
```

## Slack → 에이전트 응답

- 스레드 기반 (thread_ts)
- 4000자 초과 시 분할 전송
- 코드 블록은 Slack code formatting 사용
- 처리 중 "..." 타이핑 인디케이터 (선택)

## Slack App 설정 필요 사항

### Bot Token Scopes
- `chat:write`
- `app_mentions:read`
- `im:history`
- `im:read`
- `im:write`
- `channels:history`
- `groups:history`

### Event Subscriptions
- `app_mention`
- `message.im`
- `message.channels` (선택: 채널 모니터링)

### Socket Mode
- App-Level Token으로 WebSocket 연결 (서버 외부 노출 불필요)

## 완료 기준
- [ ] Slack Bot 시작 → WebSocket 연결
- [ ] DM 메시지 수신 → 콘솔 로그 출력
- [ ] @멘션 수신 → 콘솔 로그 출력
- [ ] Message Router가 올바른 에이전트로 매핑
- [ ] 에이전트 응답 → Slack 스레드에 전송
