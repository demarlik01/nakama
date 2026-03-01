# Spec 06: 통합 테스트 (PoC 완료 기준)

## 목표
PoC 완료를 판단하는 end-to-end 시나리오.

## 시나리오 1: 에이전트 생성 + 대화

1. `POST /api/agents` → "test-agent" 생성
2. Slack DM으로 "안녕, 너 누구야?" 전송
3. 에이전트가 AGENTS.md 기반 자기소개 응답
4. → Slack 스레드에 응답 표시

## 시나리오 2: 도구 사용

1. Slack에서 "현재 디렉토리에 hello.txt 만들어줘"
2. 에이전트가 Write 도구로 파일 생성
3. "hello.txt 내용 읽어봐"
4. 에이전트가 Read 도구로 파일 읽기 → 응답

## 시나리오 3: 메모리

1. Slack에서 "내 이름은 김효석이야, 기억해"
2. 에이전트가 MEMORY.md에 기록
3. 세션 종료 (idle timeout 또는 수동)
4. 새 세션에서 "내 이름 기억해?"
5. 에이전트가 MEMORY.md에서 읽어서 응답

## 시나리오 4: 셸 실행

1. Slack에서 "git status 확인해줘"
2. 에이전트가 Bash 도구로 `git status` 실행
3. 결과를 Slack에 전달

## 시나리오 5: API로 에이전트 관리

1. `GET /api/agents` → 에이전트 목록 확인
2. `PATCH /api/agents/test-agent` → displayName 변경
3. `GET /api/agents/test-agent` → 변경 확인
4. `DELETE /api/agents/test-agent` → 삭제 (아카이브)
5. `GET /api/agents` → 목록에서 제거 확인

## PoC 완료 기준 체크리스트

- [ ] 에이전트 생성 (API)
- [ ] Slack DM 대화 가능
- [ ] Slack @멘션 대화 가능
- [ ] 스레드 기반 컨텍스트 유지
- [ ] 기본 도구 동작 (Bash, Read, Write, Edit)
- [ ] AGENTS.md 기반 역할 수행
- [ ] MEMORY.md 기반 장기 기억
- [ ] 에이전트 목록/상태 API
- [ ] 에이전트 수정/삭제 API
