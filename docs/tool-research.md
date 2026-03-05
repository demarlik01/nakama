# OpenClaw 툴 구현 리서치

> 소스: `/Users/hyo/.local/share/mise/installs/node/24.14.0/lib/node_modules/openclaw/dist/`
> 분석 대상: `web_search`, `web_fetch`, `memory_search`, `memory_get`

---

## 1. web_search

### 소스 위치
- `src/agents/tools/web-search.ts` → 빌드 후 `dist/subagent-registry-CkqrXKq4.js` (line ~37120)

### 아키텍처
멀티 프로바이더 구조. provider 설정에 따라 다른 검색 백엔드 사용:

| Provider | API | 모델/엔드포인트 |
|----------|-----|-----------------|
| **brave** (기본) | Brave Search API | `https://api.search.brave.com/res/v1/web/search` |
| perplexity | OpenRouter 또는 Direct | `perplexity/sonar-pro` |
| grok | xAI API | `grok-4-1-fast` |
| gemini | Google Generative AI | `gemini-2.5-flash` |
| kimi | Moonshot AI | `moonshot-v1-128k` |

프로바이더 자동 감지: API 키가 있는 프로바이더를 우선순위(brave → gemini → kimi → perplexity → grok)로 선택.

### 핵심 로직 (Brave 기준)

```
1. URL 구성: https://api.search.brave.com/res/v1/web/search?q=...&count=...
2. GET 요청, 헤더: { Accept: "application/json", "X-Subscription-Token": apiKey }
3. 응답에서 data.web.results 배열 추출
4. 각 결과를 { title, url, description, published, siteName } 으로 매핑
```

### 입력 파라미터 (WebSearchSchema)
```typescript
{
  query: string;           // 필수. 검색 쿼리
  count?: number;          // 1-10, 기본 5
  country?: string;        // 2자리 국가 코드 (e.g., 'US', 'KR')
  search_lang?: string;    // ISO 언어 코드 (e.g., 'en', 'ko')
  ui_lang?: string;        // 로케일 (e.g., 'en-US', 'ko-KR')
  freshness?: string;      // 'pd', 'pw', 'pm', 'py', 또는 'YYYY-MM-DDtoYYYY-MM-DD'
}
```

### 출력 포맷

**Brave 결과:**
```json
{
  "query": "검색어",
  "provider": "brave",
  "count": 5,
  "tookMs": 350,
  "externalContent": { "untrusted": true, "source": "web_search", "provider": "brave", "wrapped": true },
  "results": [
    {
      "title": "...(wrapped)...",
      "url": "https://...",
      "description": "...(wrapped)...",
      "published": "2d ago",
      "siteName": "example.com"
    }
  ]
}
```

**Perplexity/Grok/Gemini/Kimi 결과** (AI 합성형):
```json
{
  "query": "...",
  "provider": "gemini",
  "content": "...(AI 합성 답변, wrapped)...",
  "citations": [{ "url": "...", "title": "..." }]
}
```

### 주요 특징
- **캐싱**: `SEARCH_CACHE` (in-memory Map), `cacheTtlMs` 설정 가능 (기본값 config에서)
- **콘텐츠 래핑**: `wrapWebContent()` — untrusted 외부 콘텐츠를 구분/방어하는 래퍼
- **SSRF 보호**: `withTrustedWebSearchEndpoint()` 네트워크 가드
- **언어 파라미터 정규화**: `search_lang`/`ui_lang` 실수 시 자동 교정 (스왑 감지)
- **Freshness 정규화**: Brave용 (`pd/pw/pm/py/range`), Perplexity용 (`day/week/month/year`로 매핑)

### Pi SDK 구현 참고
- `createWebSearchTool()` 팩토리 패턴 — config에서 provider/apiKey 해석 후 `{ name, label, description, parameters, execute }` 객체 반환
- `execute(toolCallId, args)` → `jsonResult(payload)` 반환
- Schema는 `@sinclair/typebox`의 `Type.Object()` 사용

---

## 2. web_fetch

### 소스 위치
- `src/agents/tools/web-fetch.ts` → `dist/subagent-registry-CkqrXKq4.js` (line ~36615)
- `src/agents/tools/web-fetch-utils.ts` (line ~36294) — HTML→Markdown, Readability 등
- `src/agents/tools/web-fetch-visibility.ts` (line ~36204) — HTML 정제

### 아키텍처
3단계 추출 파이프라인:

```
1. HTTP fetch (네이티브 fetch + SSRF 가드 + 리다이렉트 추적)
2. Content-Type 기반 분기:
   - text/markdown → 그대로 사용 (extractor: "cf-markdown")
   - text/html → Readability 파싱 시도 → 실패 시 Firecrawl 폴백
   - application/json → JSON.stringify(parse, null, 2)
   - 기타 → raw
3. 텍스트 truncation + 외부 콘텐츠 래핑
```

### 핵심 라이브러리
- **`@mozilla/readability`** — Mozilla의 Readability.js. HTML에서 본문 추출
- **`linkedom`** — 경량 DOM 파서 (jsdom 대신). `parseHTML()`로 DOM 생성
- **자체 `htmlToMarkdown()`** — 간단한 정규식 기반 HTML→Markdown 변환기 (Turndown 미사용)
  - `<a>` → `[label](href)`, `<h1-6>` → `# ...`, `<li>` → `- ...`
  - `<script>`, `<style>`, `<noscript>` 제거
  - HTML 엔티티 디코딩, 태그 스트리핑
- **Firecrawl** (옵셔널 폴백) — `api.firecrawl.dev` API, POST로 URL 전달 → markdown 반환
- **`sanitizeHtml()`** — linkedom으로 DOM 파싱 후 불필요한 요소(script, style, nav, footer 등) 제거

### 추출 흐름 상세

```
HTML 입력
  ↓
sanitizeHtml() — 코멘트/스크립트/스타일 제거 (linkedom)
  ↓
[HTML 크기 체크] — 1MB 초과 or 중첩 3000단계 초과 → fallback(htmlToMarkdown)
  ↓
Readability(document, { charThreshold: 0 }).parse()
  ↓
성공 → extractMode === "text" ? parsed.textContent : htmlToMarkdown(parsed.content)
실패 → Firecrawl 폴백 (API 키 있으면) 또는 에러
```

### 입력 파라미터 (WebFetchSchema)
```typescript
{
  url: string;              // 필수. HTTP/HTTPS URL
  extractMode?: "markdown" | "text";  // 기본 "markdown"
  maxChars?: number;        // 최소 100, 기본 50,000
}
```

### 출력 포맷
```json
{
  "url": "원본 URL",
  "finalUrl": "리다이렉트 후 최종 URL",
  "status": 200,
  "contentType": "text/html",
  "title": "페이지 제목 (wrapped)",
  "extractMode": "markdown",
  "extractor": "readability",  // "readability" | "cf-markdown" | "firecrawl" | "json" | "raw"
  "externalContent": { "untrusted": true, "source": "web_fetch", "wrapped": true },
  "truncated": false,
  "length": 12345,
  "rawLength": 12300,
  "wrappedLength": 12345,
  "fetchedAt": "2026-03-05T13:00:00.000Z",
  "tookMs": 850,
  "text": "...(추출된 콘텐츠, wrapped)..."
}
```

### 주요 설정
- `maxResponseBytes`: 기본 2MB, 최대 10MB
- `maxRedirects`: 기본 3
- `userAgent`: Chrome UA 스푸핑
- `cacheTtlMs`: in-memory `FETCH_CACHE` (Map)
- `readability`: 비활성화 가능 (config)
- Firecrawl: API 키 있으면 자동 활성화, `onlyMainContent`, `maxAgeMs` 등 설정

### Pi SDK 구현 참고
- `createWebFetchTool()` 팩토리 — `{ name, label, description, parameters, execute }` 반환
- Readability + linkedom 조합이 핵심. Firecrawl 없이도 대부분 동작
- HTML→Markdown 변환은 자체 구현 (외부 라이브러리 의존 없음)
- SSRF 방어가 `fetchWithWebToolsNetworkGuard()`에 내장

---

## 3. memory_search / memory_get

### 소스 위치
- `src/agents/tools/memory-tool.ts` → `dist/subagent-registry-CkqrXKq4.js` (line ~72343)
- `src/agents/memory-search.ts` → `dist/manager-BpC_d51I.js` (line ~24) — 빌트인 매니저
- `src/memory/backend-config.ts` → `dist/memory-cli-Dlo3GrKB.js` (line ~21) — 백엔드 설정
- `src/memory/sqlite-vec.ts` → `dist/manager-BpC_d51I.js` (line ~2032) — 벡터 저장소
- `src/memory/qmd-manager.ts` → `dist/qmd-manager-C8BwK-Ko.js` — QMD 외부 엔진 매니저

### 아키텍처 (2-tier)

```
memory_search 요청
  ↓
[Backend 선택]
  ├── "qmd" backend → QmdMemoryManager (외부 qmd CLI 바이너리)
  │     ↓ (실패 시)
  │     FallbackMemoryManager → MemoryIndexManager (빌트인)
  └── "builtin" backend → MemoryIndexManager (기본)
```

### Backend 1: QMD (외부 엔진)
- **qmd**: 별도 CLI 바이너리. 컬렉션 기반 문서 인덱싱/검색
- 검색 모드: `search` (기본), `vsearch` (벡터 검색), `query` (딥 검색)
- **MCP (mcporter)**: MCP 프로토콜 통해 qmd와 통신하는 옵션
- 컬렉션: `MEMORY.md`, `memory.md`, `memory/` 디렉토리가 기본 대상
- 커스텀 경로 추가 가능 (`config.memory.qmd.paths`)
- 설정: `config.memory.backend: "qmd"`, `config.memory.qmd.command: "qmd"`

### Backend 2: Builtin (MemoryIndexManager)
SQLite 기반 임베딩 + 하이브리드 검색 엔진.

#### 임베딩 프로바이더
| Provider | 기본 모델 | 비고 |
|----------|-----------|------|
| **openai** | `text-embedding-3-small` | 기본값, max tokens: 8192 |
| gemini | `gemini-embedding-001` | Google API |
| voyage | `voyage-4-large` | Voyage AI |
| mistral | `mistral-embed` | Mistral AI |
| ollama | `nomic-embed-text` | 로컬 |
| **auto** | (자동 감지) | API 키 기반 자동 선택 |

#### 저장소
- **SQLite** — `node:sqlite` (Node 내장) 또는 `better-sqlite3`
- 파일 위치: `~/.local/state/openclaw/memory/{agentId}.sqlite`
- 테이블:
  - `chunks` — 청킹된 문서 조각
  - `chunks_vec` — 벡터 임베딩 (`sqlite-vec` 확장)
  - `chunks_fts` — 전문 검색 (FTS)
  - `embedding_cache` — 임베딩 캐시

#### 청킹
- `chunkMarkdown()` — Markdown 문서를 토큰 단위로 분할
- 기본: **400 토큰**, overlap **80 토큰**
- 키워드 추출: `extractKeywords()`

#### 검색 (하이브리드)
```
쿼리 → 임베딩 생성
  ↓
[벡터 검색] sqlite-vec로 코사인 유사도 (가중치 0.7)
  +
[텍스트 검색] FTS5 전문 검색 (가중치 0.3)
  ↓
결과 병합 + 점수 정규화
  ↓
(선택) MMR 다양성 필터 (lambda 0.7)
  ↓
(선택) 시간 감쇠 (halfLife 30일)
  ↓
상위 N개 결과 반환
```

- **하이브리드 기본 활성화**: `vectorWeight: 0.7`, `textWeight: 0.3`
- **코사인 유사도**: `cosineSimilarity()` 함수 (query-expansion 모듈)
- **MMR**: 기본 비활성화, `lambda: 0.7`
- **시간 감쇠**: 기본 비활성화, `halfLifeDays: 30`
- **최소 스코어**: 기본 0.35

### memory_search 파라미터
```typescript
{
  query: string;        // 필수. 시맨틱 검색 쿼리
  maxResults?: number;  // 기본 6
  minScore?: number;    // 기본 0.35
}
```

### memory_search 출력
```json
{
  "results": [
    {
      "path": "memory/2026-03-05.md",
      "startLine": 15,
      "endLine": 25,
      "snippet": "관련 텍스트...",
      "score": 0.82,
      "citation": "memory/2026-03-05.md#L15-L25"
    }
  ],
  "provider": "openai",
  "model": "text-embedding-3-small",
  "fallback": null,
  "citations": "auto",
  "mode": "search"
}
```

### memory_get 파라미터
```typescript
{
  path: string;     // 필수. 상대 경로 (e.g., "MEMORY.md", "memory/2026-03-05.md")
  from?: number;    // 시작 라인 번호
  lines?: number;   // 읽을 라인 수
}
```

### memory_get 출력
```json
{
  "path": "memory/2026-03-05.md",
  "text": "파일 내용...",
  "from": 15,
  "lines": 10
}
```

### 주요 특징
- **파일 감시**: `watcher`로 workspace 변경 감지 → 자동 재인덱싱 (debounce 1.5초)
- **세션 메모리**: 실험적 기능. 채팅 세션 트랜스크립트도 검색 대상에 포함 가능
- **Citations**: `auto` (DM에서만), `on`, `off`
- **Scope**: 채팅 타입별 접근 제어 (기본: direct DM만 허용)
- **에러 폴백**: QMD 실패 → 빌트인, 임베딩 실패 → 사용 불가 안내

---

## 4. 공통 패턴 (Pi SDK AgentTool 구현 참고)

### 툴 팩토리 패턴
모든 툴은 `createXxxTool(options)` 형태의 팩토리 함수:

```typescript
function createWebSearchTool(options: { config?: Config; sandboxed?: boolean }) {
  // config에서 설정 해석
  // 활성화 여부 체크 → null 반환 가능
  return {
    label: "Web Search",
    name: "web_search",
    description: "...",
    parameters: WebSearchSchema,  // @sinclair/typebox 스키마
    execute: async (toolCallId: string, args: unknown) => {
      // 파라미터 파싱 (readStringParam, readNumberParam)
      // 비즈니스 로직
      return jsonResult(payload);  // JSON 결과 래핑
    }
  };
}
```

### 파라미터 파싱 유틸
```typescript
readStringParam(params, "query", { required: true })  // string | undefined
readNumberParam(params, "count", { integer: true })    // number | undefined
```

### 결과 반환
```typescript
jsonResult(payload)  // { type: "json", value: payload } 형태로 추정
```

### 스키마 정의
```typescript
import { Type } from "@sinclair/typebox";

const Schema = Type.Object({
  query: Type.String({ description: "..." }),
  count: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })),
});
```

### 캐싱 패턴
```typescript
const CACHE = new Map();  // in-memory
const cacheKey = normalizeCacheKey(`prefix:${param1}:${param2}`);
const cached = readCache(CACHE, cacheKey);
if (cached) return { ...cached.value, cached: true };
// ... 실행 ...
writeCache(CACHE, cacheKey, payload, ttlMs);
```

### 외부 콘텐츠 래핑
```typescript
wrapWebContent(text, "web_search")    // untrusted 콘텐츠 마킹
wrapExternalContent(text, { source: "web_fetch", includeWarning: false })
```

### 네트워크 보안
- `fetchWithWebToolsNetworkGuard()` — SSRF 방어, 프라이빗 네트워크 차단
- `withTrustedWebSearchEndpoint()` — 신뢰할 수 있는 API 엔드포인트용
- `withTimeout()` — AbortSignal 기반 타임아웃

---

## 5. 의존성 요약

| 기능 | 라이브러리 |
|------|-----------|
| HTML 파싱 (DOM) | `linkedom` |
| 본문 추출 | `@mozilla/readability` |
| HTML→Markdown | 자체 구현 (정규식 기반) |
| 스키마 정의 | `@sinclair/typebox` |
| 벡터 저장소 | `sqlite-vec` (SQLite 확장) |
| 전문 검색 | SQLite FTS5 |
| DB | `node:sqlite` (Node 내장) |
| 임베딩 | OpenAI/Gemini/Voyage/Mistral/Ollama API |
| 웹 검색 | Brave Search API / Perplexity / Grok / Gemini / Kimi |
| URL fetch 폴백 | Firecrawl API (옵셔널) |
| 외부 검색 엔진 | `qmd` CLI (옵셔널) |
