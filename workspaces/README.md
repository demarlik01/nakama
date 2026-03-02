# Agent Workspaces

각 에이전트별 작업공간을 관리하는 프로젝트입니다.

## 구조
```
workspaces/
├── _shared/           # 모든 에이전트가 공유하는 리소스
│   ├── README.md     # 공유 공간 설명
│   └── agent-guide.md # 에이전트 개발 가이드
├── test-agent/       # 테스트 에이전트
│   ├── AGENTS.md     # 시스템 프롬프트
│   ├── agent.json    # 에이전트 설정
│   └── agent.md      # 상세 설명
└── README.md         # 이 파일
```

## 에이전트 추가하기
1. 새 디렉토리 생성
2. `AGENTS.md` - 시스템 프롬프트 작성
3. `agent.json` - 설정 파일 작성  
4. `agent.md` - 상세 설명 (선택사항)

## 개발 가이드
자세한 내용은 `_shared/agent-guide.md` 참조

## 현재 에이전트
- **test-agent**: 능동적인 개발 도우미