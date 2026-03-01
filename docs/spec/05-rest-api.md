# Spec 05: REST API

## 목표
에이전트 CRUD + 상태 조회 API. Web UI 대비.

## 엔드포인트

### 에이전트 관리
```
POST   /api/agents              # 에이전트 생성
GET    /api/agents              # 에이전트 목록
GET    /api/agents/:id          # 에이전트 상세
PATCH  /api/agents/:id          # 에이전트 설정 수정
DELETE /api/agents/:id          # 에이전트 삭제
```

### 상태/로그
```
GET    /api/agents/:id/status   # 세션 상태 (idle/running/error)
GET    /api/health              # 서버 상태
```

## 에이전트 생성 요청

```json
POST /api/agents
{
  "id": "reviewer",
  "displayName": "코드 리뷰어",
  "agentsMd": "# 코드 리뷰어\n\n## 역할\n...",
  "slackChannels": ["C01CODEREVIEW"],
  "slackUsers": ["U01HSKIM"],
  "model": "claude-sonnet-4-20250514"
}
```

**서버 동작:**
1. `/workspaces/reviewer/` 디렉토리 생성
2. `AGENTS.md` 작성 (agentsMd 내용)
3. `agent.json` 작성 (메타데이터)
4. `MEMORY.md` 빈 파일 생성
5. `memory/` 디렉토리 생성
6. Agent Registry가 fs.watch로 감지 → 자동 등록

## 에이전트 수정

```json
PATCH /api/agents/reviewer
{
  "displayName": "시니어 리뷰어",
  "slackChannels": ["C01CODEREVIEW", "C02BACKEND"],
  "model": "claude-opus-4-6"
}
```

**서버 동작:** agent.json 업데이트 → Registry 이벤트

## 에이전트 삭제

```
DELETE /api/agents/reviewer
```

**서버 동작:** 워크스페이스 디렉토리를 아카이브 (즉시 삭제 X, `_archived/` 이동)

## 응답 형식

```json
// GET /api/agents
{
  "agents": [
    {
      "id": "reviewer",
      "displayName": "코드 리뷰어",
      "enabled": true,
      "model": "claude-sonnet-4-20250514",
      "slackChannels": ["C01CODEREVIEW"],
      "status": "idle"
    }
  ]
}
```

## 완료 기준
- [ ] 에이전트 생성 API → 워크스페이스 + 파일 생성
- [ ] 에이전트 목록/상세 API
- [ ] 에이전트 수정 API → agent.json 업데이트
- [ ] 에이전트 삭제 API → 아카이브
- [ ] 서버 health API
