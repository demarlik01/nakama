# Spec 02: Agent Registry

## 목표
파일시스템 기반으로 에이전트를 자동 등록/해제하는 레지스트리.

## 동작 방식

1. `workspaces/` 하위 디렉토리 스캔
2. `AGENTS.md`가 있는 디렉토리 = 에이전트
3. `agent.json`에서 메타데이터 로드 (Slack 매핑, 모델 등)
4. `chokidar`로 디렉토리 감시 → 추가/삭제 자동 반영

## 에이전트 워크스페이스 구조

```
/workspaces/{agent-id}/
├── AGENTS.md          # 필수: 이 파일이 있어야 에이전트로 인식
├── agent.json         # 메타데이터
├── MEMORY.md          # 장기 기억 (자동 생성)
├── memory/            # 일별 로그 (자동 생성)
└── docs/              # 도메인 지식 (선택)
```

## agent.json 스키마

```json
{
  "displayName": "코드 리뷰어",
  "slackChannels": ["C01CODEREVIEW"],
  "slackUsers": ["U01HSKIM"],
  "model": "claude-sonnet-4-20250514",
  "enabled": true,
  "schedules": []
}
```

## 인터페이스

```typescript
class AgentRegistry {
  constructor(workspacesRoot: string)

  // 초기 스캔 + watch 시작
  start(): Promise<void>

  // 에이전트 조회
  getAll(): AgentDefinition[]
  getById(id: string): AgentDefinition | undefined
  findBySlackUser(userId: string): AgentDefinition | undefined
  findBySlackChannel(channelId: string): AgentDefinition[]

  // 에이전트 CRUD (API에서 호출)
  create(params: CreateAgentParams): Promise<AgentDefinition>
  update(id: string, params: Partial<AgentDefinition>): Promise<AgentDefinition>
  remove(id: string): Promise<void>

  // 이벤트
  on('agent:added', (agent: AgentDefinition) => void)
  on('agent:removed', (agentId: string) => void)
  on('agent:updated', (agent: AgentDefinition) => void)
}
```

## 완료 기준
- [ ] 서버 시작 시 workspaces/ 스캔 → 에이전트 목록 로드
- [ ] 디렉토리 + AGENTS.md 추가 → 자동 등록 (서버 재시작 불필요)
- [ ] 디렉토리 삭제 → 자동 해제
- [ ] agent.json CRUD
- [ ] 이벤트 emit (added/removed/updated)
