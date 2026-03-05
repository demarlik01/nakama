# OpenClaw Heartbeat & Cron 구현 분석

> 소스코드 기반 리서치. 코드 위치는 OpenClaw dist 번들 기준 (minified JS이므로 라인 번호는 근사치).
> Base path: `/Users/hyo/.local/share/mise/installs/node/24.14.0/lib/node_modules/openclaw/dist/`

---

## 1. Heartbeat 구현

### 1.1 아키텍처 요약

Heartbeat는 **두 레이어**로 구현되어 있다:

1. **HeartbeatRunner** (`health-fOOBvmWF.js`): 주기적 타이머 관리, 에이전트별 스케줄링
2. **HeartbeatWake** (`reply-DhtejUNZ.js` L7283~7430): 실제 wake 이벤트 디스패치, coalesce 처리

HeartbeatRunner가 `setTimeout`으로 다음 heartbeat 시점을 계산해 타이머를 걸고, 시점이 되면 `requestHeartbeatNow()`를 호출. 이 함수는 HeartbeatWake 모듈의 pending queue에 wake reason을 넣고 coalesce 타이머(250ms 기본)를 통해 실제 `runHeartbeatOnce()`를 실행한다.

```
HeartbeatRunner (setTimeout loop)
  → requestHeartbeatNow({reason: "interval"})
    → HeartbeatWake.schedule(coalesceMs)
      → handler(wakeParams) → runHeartbeatOnce(opts)
        → getReplyFromConfig(ctx, ..., cfg)  // LLM 호출
```

### 1.2 실행 주기

- **기본값**: `30m` (30분)
- **상수**: `DEFAULT_HEARTBEAT_EVERY = "30m"` (`reply-DhtejUNZ.js` L10770)
- **파싱**: `parseDurationMs(raw, {defaultUnit: "m"})` — duration 문자열 지원 ("5m", "1h", "30s" 등)
- **설정**: `agents.defaults.heartbeat.every` 또는 `agents.list[].heartbeat.every`

```jsonc
// config.json5
{
  "agents": {
    "defaults": {
      "heartbeat": {
        "every": "30m",         // duration 문자열
        "activeHours": {
          "start": "08:00",     // HH:MM (24h)
          "end": "23:00",
          "timezone": "user"    // "user" | "local" | IANA TZ
        }
      }
    }
  }
}
```

### 1.3 에이전트 전달 방식

Heartbeat는 **유저 메시지로 전달**된다. LLM에게 보내는 context 객체:

```javascript
// health-fOOBvmWF.js L491~510
const ctx = {
  Body: appendCronStyleCurrentTimeLine(prompt, cfg, startedAt),
  From: sender,
  To: sender,
  OriginatingChannel: delivery.channel,
  OriginatingTo: delivery.to,
  AccountId: delivery.accountId,
  MessageThreadId: delivery.threadId,
  Provider: "heartbeat",      // or "cron-event" / "exec-event"
  SessionKey: sessionKey
};
```

- `ctx.Body`에 heartbeat 프롬프트가 들어감
- `appendCronStyleCurrentTimeLine()`이 현재 시각 라인을 추가
- 이 ctx가 `getReplyFromConfig(ctx, opts, cfg)`로 전달 → 기존 세션의 history에 유저 메시지로 추가됨

### 1.4 Heartbeat 프롬프트

**기본 프롬프트** (`reply-DhtejUNZ.js` L10769):
```
Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. 
Do not infer or repeat old tasks from prior chats. 
If nothing needs attention, reply HEARTBEAT_OK.
```

- `resolveHeartbeatPrompt(cfg, heartbeat)` → `heartbeat.prompt ?? agents.defaults.heartbeat.prompt ?? DEFAULT`
- 오버라이드: `agents.defaults.heartbeat.prompt` 설정으로 커스텀 가능

### 1.5 HEARTBEAT.md 파일의 역할

- **파일명**: `HEARTBEAT.md` (상수: `DEFAULT_HEARTBEAT_FILENAME`, `agent-scope-lcHHTjPm.js` L82)
- **위치**: 에이전트 workspace 디렉토리의 루트
- **역할**: heartbeat 때 에이전트가 참조하는 작업 체크리스트/지침서
- **빈 파일 감지**: `isHeartbeatContentEffectivelyEmpty(content)`가 true이면 heartbeat 실행 건너뜀 (`skipReason: "empty-heartbeat-file"`)
  - 단, cron 이벤트/exec 이벤트/wake reason이 있으면 이 게이트를 바이패스
- **bootstrap 시 자동 생성**: `agent-scope-lcHHTjPm.js` L268~300에서 workspace 초기화 시 템플릿에서 복사

### 1.6 응답 처리 (HEARTBEAT_OK)

- **토큰**: `HEARTBEAT_TOKEN = "HEARTBEAT_OK"` (`tokens-DgYNpQOp.js` L4)
- **ACK 최대 길이**: `DEFAULT_HEARTBEAT_ACK_MAX_CHARS = 300` (`reply-DhtejUNZ.js` L10771)

**처리 플로우** (`health-fOOBvmWF.js` L560~700):

1. LLM 응답에서 `stripHeartbeatToken(text)` 실행
2. `isHeartbeatContentEffectivelyEmpty` 체크
3. HEARTBEAT_OK + 300자 이내 → `shouldSkip = true`
4. shouldSkip인 경우:
   - transcript 되돌림 (`pruneHeartbeatTranscript` — 파일을 이전 사이즈로 truncate)
   - `updatedAt` 복원 (세션이 heartbeat만으로 최신으로 보이지 않게)
   - heartbeat 이벤트 emit: `status: "ok-token"`
5. 실제 내용이 있는 경우:
   - 중복 체크 (이전 heartbeat와 동일 텍스트 + 24시간 내 → skip)
   - delivery target으로 메시지 전송
   - 세션 store에 `lastHeartbeatText`, `lastHeartbeatSentAt` 기록

### 1.7 설정 방법

**Config 타입** (`types.agent-defaults.d.ts`):

```typescript
heartbeat?: {
  every?: string;                    // duration ("30m", "1h")
  activeHours?: {
    start?: string;                  // "08:00"
    end?: string;                    // "23:00"
    timezone?: string;               // "user" | "local" | IANA
  };
  model?: string;                    // 모델 오버라이드 ("anthropic/claude-haiku")
  session?: string;                  // "main" 또는 세션키
  target?: "last" | "none" | string; // 전달 대상 채널
  directPolicy?: "allow" | "block";
  to?: string;                       // 특정 대상 (E.164, chat id 등)
  accountId?: string;
  prompt?: string;                   // 커스텀 프롬프트
  ackMaxChars?: number;              // HEARTBEAT_OK 뒤 허용 글자수 (기본 300)
  suppressToolErrorWarnings?: boolean;
  lightContext?: boolean;            // HEARTBEAT.md만 포함하는 경량 모드
  includeReasoning?: boolean;        // reasoning 내용도 전달
};
```

**에이전트별 오버라이드**: `agents.list[].heartbeat`로 가능 (defaults와 merge됨)

### 1.8 Active Hours

- `isWithinActiveHours(cfg, heartbeat, nowMs)` (`health-fOOBvmWF.js` L42~70)
- `Intl.DateTimeFormat`으로 타임존 변환 후 분(minute) 단위 비교
- `start > end`인 경우 자정을 넘기는 범위로 처리 (야간)
- 범위 밖이면 `{status: "skipped", reason: "quiet-hours"}`

---

## 2. Cron 구현

### 2.1 아키텍처 요약

```
CronService (gateway-cli-vk3t7zJU.js L6793~6830)
  ├── state: CronServiceState (store, timer, running)
  ├── start() → load store → runMissedJobs → recompute → armTimer
  ├── armTimer() → setTimeout(onTimer, delay)
  │   └── onTimer() → findDueJobs → runDueJob(concurrently) → persist → armTimer
  └── Store: JSON file (cron/store.json)
```

### 2.2 스케줄러 라이브러리: `croner`

- **Import**: `import { Cron } from "croner"` (`gateway-cli-vk3t7zJU.js` L126)
- **사용**: `new Cron(expr, { timezone, catch: false })` — 다음 실행 시간 계산용
- **캐싱**: `resolveCachedCron(expr, timezone)` — LRU 캐시 (max 4096)로 `Cron` 인스턴스 재사용
- croner는 **스케줄링 전용** (타이머 자체는 자체 `setTimeout`으로 관리)

### 2.3 스케줄 타입 (3가지)

```typescript
// CronScheduleSchema (cron.d.ts)
type Schedule = 
  | { kind: "at"; at: string }           // 일회성: ISO 날짜/시간 또는 duration
  | { kind: "every"; everyMs: number; anchorMs?: number }  // 반복: ms 간격
  | { kind: "cron"; expr: string; tz?: string; staggerMs?: number }  // cron 표현식
```

- **at**: 한 번 실행 후 `deleteAfterRun`이면 삭제
- **every**: 고정 간격 (ms 단위), anchorMs로 기준점 지정 가능
- **cron**: 5-field 또는 6-field cron 표현식 + 타임존

### 2.4 Stagger (지터)

- 정시 실행 (`0 * * * *` 등)일 때 자동으로 최대 300초(5분) 스태거 적용
- `DEFAULT_TOP_OF_HOUR_STAGGER_MS = 300_000` (`stagger-DHf-39rR.js`)
- jobId의 SHA-256 해시로 결정론적 오프셋 계산 → 같은 job은 항상 같은 오프셋
- `staggerMs: 0`으로 비활성화 가능

### 2.5 크론 작업 실행 방식

**두 가지 sessionTarget**:

#### A. `sessionTarget: "main"` (메인 세션에서 실행)
- `payload.kind`은 반드시 `"systemEvent"`
- `enqueueSystemEvent(text, {contextKey: "cron:<jobId>"})` → 시스템 이벤트 큐에 추가
- `wakeMode: "now"` → `runHeartbeatOnce()` 직접 호출 (busy면 최대 2분 대기 후 재시도)
- `wakeMode: "next-heartbeat"` → `requestHeartbeatNow()` 호출 → 다음 heartbeat 때 함께 처리
- **핵심**: main session의 기존 대화 히스토리를 공유

#### B. `sessionTarget: "isolated"` (격리 세션에서 실행)
- `payload.kind`은 반드시 `"agentTurn"`
- `runCronIsolatedAgentTurn()` 호출 (`gateway-cli-vk3t7zJU.js` L3909~)
- **새 세션**을 생성: `sessionKey = "cron:<jobId>"` + run uuid
- 완전히 독립적인 agent 턴 실행
- 결과를 main session에 시스템 이벤트로 요약 전달 가능

### 2.6 격리 실행 상세 (`runCronIsolatedAgentTurn`)

```
gateway-cli-vk3t7zJU.js L3909~4100
```

1. agentId 해석: `job.agentId` → `agentConfigOverride` → 에이전트별 설정 merge
2. 세션키 생성: `cron:<jobId>` (base) + agent prefix
3. workspace 확보: `ensureAgentWorkspace()`
4. 모델 해석 순서:
   - Agent config의 model → subagent model → hooks gmail model → **payload.model** (최우선)
5. `runCliAgent()` 호출 — 실제 LLM 에이전트 실행
6. delivery 처리: announce/webhook/none

### 2.7 모델/Thinking 오버라이드

**가능하다.** `payload` 안에서:

```typescript
payload: {
  kind: "agentTurn";
  message: string;
  model?: string;          // "anthropic/claude-haiku" 등
  fallbacks?: string[];    // 폴백 모델 목록
  thinking?: string;       // "off" | "low" | "medium" | "high" 등
  timeoutSeconds?: number;
  lightContext?: boolean;   // 경량 부트스트랩
  deliver?: boolean;
  channel?: string;
  to?: string;
}
```

- model 오버라이드 시 `resolveAllowedModelRef()`로 allowlist 체크
- 허용되지 않으면 에이전트 기본값으로 폴백 (경고 로그)

### 2.8 결과 전달 방식

**delivery 설정** (per-job):

```typescript
delivery?: {
  mode: "none" | "announce" | "webhook";
  to?: string;          // chat id, E.164 등
  channel?: string;     // "telegram" | "discord" | "last"
  accountId?: string;
  bestEffort?: boolean;
  failureDestination?: { ... };
}
```

- **announce**: 채널 플러그인으로 메시지 전송 (텔레그램, 디스코드 등)
- **webhook**: HTTP POST로 결과 전송
- **none**: 전달 안 함 (main session에 시스템 이벤트로만)

### 2.9 Store 구조

- 파일: `cron.store` 설정 또는 기본 경로
- JSON 파일, `loadCronStore()` / `saveCronStore()`로 접근 (`send-qsA2ijse.js`)
- 작업별 상태:
  ```typescript
  state: {
    nextRunAtMs?: number;
    runningAtMs?: number;    // 실행 중 마커 (stuck 감지용)
    lastRunAtMs?: number;
    lastRunStatus?: "ok" | "error" | "skipped";
    lastError?: string;
    lastDurationMs?: number;
    consecutiveErrors?: number;
    lastDelivered?: boolean;
    lastDeliveryStatus?: string;
    lastDeliveryError?: string;
  }
  ```

### 2.10 에러 핸들링

1. **Stuck 감지**: `STUCK_RUN_MS = 7200_000` (2시간) — `runningAtMs`가 2시간 이상이면 stuck으로 판단
2. **Job 타임아웃**: `resolveCronJobTimeoutMs(job)` — AbortController로 관리
3. **Retry**: one-shot job(`at`)에서 transient 에러 시 재시도
   ```typescript
   retry?: {
     maxAttempts?: number;      // 기본 3
     backoffMs?: number[];      // [30000, 60000, 300000]
     retryOn?: ("rate_limit" | "network" | "timeout" | "server_error")[];
   }
   ```
4. **Failure Alert**: 연속 실패 시 알림
   ```typescript
   failureAlert?: {
     after?: number;         // N회 연속 실패 후
     cooldownMs?: number;
     mode?: "announce" | "webhook";
   }
   ```
5. **시작 시 복구**: `start()` 시 `runningAtMs`가 남아있으면 stale 마커 제거
6. **Missed job 실행**: `runMissedJobs(state)` — 서비스 재시작 후 놓친 작업 보충 실행

### 2.11 세션 관리

- **Run log**: `cron/runs/<jobId>.jsonl` — 실행 기록 (maxBytes: 2MB, keepLines: 2000)
- **Session reaper**: 완료된 isolated 세션을 자동 정리 (`sessionRetention` 기본 24h)
- **Concurrent runs**: `maxConcurrentRuns` 설정 가능 (기본: 제한 없음? — `resolveRunConcurrency`)

### 2.12 Cron 설정 (config)

```jsonc
{
  "cron": {
    "enabled": true,           // false면 스케줄러 비활성화 (저장은 됨)
    "store": "/path/to/cron-store.json",
    "maxConcurrentRuns": 3,
    "retry": {
      "maxAttempts": 3,
      "backoffMs": [30000, 60000, 300000]
    },
    "sessionRetention": "24h",  // 또는 false로 비활성화
    "runLog": {
      "maxBytes": 2000000,
      "keepLines": 2000
    },
    "failureAlert": {
      "enabled": true,
      "after": 3,
      "mode": "announce"
    }
  }
}
```

---

## 3. 아키텍처 상세

### 3.1 타이머 메커니즘

**Heartbeat**: `setTimeout` 기반 (setInterval 아님)
- `scheduleNext()` → 다음 due인 에이전트까지의 delay 계산 → `setTimeout`
- 실행 완료 후 `advanceAgentSchedule()` → `scheduleNext()` 재호출
- **장점**: drift 축적 없음, 에이전트별 다른 주기 지원

**Cron**: `setTimeout` 기반
- `armTimer(state)` → 다음 due인 job까지의 delay 계산 → `setTimeout`
- `MAX_TIMER_DELAY_MS` 클램핑 (Node.js setTimeout 한계)
- running 중에는 `armRunningRecheckTimer()` — MAX_TIMER_DELAY 후 재체크
- **onTimer → running 플래그 → findDueJobs → 병렬 실행 → persist → armTimer**

### 3.2 CronService 클래스

```javascript
// gateway-cli-vk3t7zJU.js L6793~6830
class CronService {
  constructor(deps) {
    this.state = createCronServiceState(deps);
  }
  async start()    { await start(this.state); }
  stop()           { stop(this.state); }
  async status()   { return await status(this.state); }
  async list()     { return await list(this.state); }
  async add()      { return await add(this.state, input); }
  async update()   { return await update(this.state, jobId, patch); }
  async remove()   { return await remove(this.state, jobId); }
  async run()      { /* 수동 실행 */ }
  wakeNow(opts)    { return wakeNow(this.state, opts); }
}
```

**Dependencies** (`createCronServiceState`):
```javascript
deps: {
  cronEnabled: boolean,
  storePath: string,
  log: Logger,
  nowMs: () => number,
  defaultAgentId: string,
  enqueueSystemEvent: (text, opts) => void,
  requestHeartbeatNow: (opts) => void,
  runHeartbeatOnce: async (opts) => result,
  runIsolatedAgentJob: async (params) => result,
  onEvent?: (evt) => void,
  wakeNowHeartbeatBusyMaxWaitMs?: number,
  sessionStorePath?: string,
  resolveSessionStorePath?: (agentId) => string,
  cronConfig?: CronConfig,
}
```

### 3.3 Heartbeat-Cron 연동

Cron의 `main` 세션 타겟 작업은 heartbeat 시스템을 통해 실행된다:

1. Cron timer fires → `executeJobCore()` 
2. `sessionTarget === "main"` → `enqueueSystemEvent(text)` 
3. `requestHeartbeatNow({reason: "cron:<jobId>"})` 또는 직접 `runHeartbeatOnce()`
4. HeartbeatWake가 wake reason에서 cron 이벤트 감지
5. `resolveHeartbeatRunPrompt()`에서 pending system event를 읽어 프롬프트 구성
6. `buildCronEventPrompt(cronEvents)` → LLM에게 리마인더 전달

이렇게 **cron → system event queue → heartbeat runner → LLM** 파이프라인으로 흐른다.

### 3.4 Lock 관리

```javascript
// locked(state, fn) — 단일 진입 보장
async function locked(state, fn) {
  while (state.op) await state.op;
  state.op = fn();
  try { return await state.op; } 
  finally { state.op = Promise.resolve(); }
}
```

- CronService 내부 상태 변경은 모두 `locked()` 안에서
- Session store 파일 접근은 `updateSessionStore()` (별도 파일 락)
- **Lock 순서**: cron service lock → session store lock (역순 금지)

### 3.5 Gateway 시작 시 연결

```javascript
// gateway-cli-vk3t7zJU.js L22489
startHeartbeatRunner({ cfg: cfgAtStart })

// L6975~7010 — CronService에 heartbeat deps 주입
new CronService({
  cronEnabled: cfg.cron?.enabled !== false,
  storePath: resolveCronStorePath(cfg),
  runHeartbeatOnce: async (opts) => runHeartbeatOnce({...}),
  runIsolatedAgentJob: async (params) => runCronIsolatedAgentTurn({...}),
  enqueueSystemEvent: (text, opts) => enqueueSystemEvent(text, opts),
  requestHeartbeatNow: (opts) => requestHeartbeatNow(opts),
  ...
})
```

---

## 4. agent-for-work 적용 설계 제안

### 4.1 Heartbeat 구현 제안

**핵심 컴포넌트**:

```
HeartbeatRunner
├── config: { every: string, prompt: string, activeHours?, ... }
├── timer: NodeJS.Timeout | null
├── run(): Promise<HeartbeatResult>
└── scheduleNext(): void
```

**설계 포인트**:
1. **setTimeout 사용** — setInterval보다 drift 관리 쉬움
2. **Wake 큐 패턴 채택** — requestHeartbeatNow()로 외부에서 트리거 가능하게
3. **Coalesce** — 250ms 대기 후 배치 처리 (동시 다발 wake 방지)
4. **유저 메시지로 전달** — 시스템 프롬프트가 아닌 `ctx.Body`에 프롬프트
5. **HEARTBEAT_OK 토큰** — 응답에 이 토큰이 있으면 "할 일 없음"으로 처리
6. **Transcript 정리** — HEARTBEAT_OK면 해당 턴의 대화 기록을 truncate (토큰 낭비 방지)
7. **Active hours** — 야간에는 skip (Intl.DateTimeFormat으로 TZ 변환)

**최소 구현**:
```typescript
class HeartbeatRunner {
  private timer: NodeJS.Timeout | null = null;
  private intervalMs: number;
  
  constructor(private config: HeartbeatConfig, private agent: Agent) {
    this.intervalMs = parseDuration(config.every ?? "30m");
  }
  
  start() {
    this.scheduleNext();
  }
  
  private scheduleNext() {
    this.timer = setTimeout(() => this.tick(), this.intervalMs);
    this.timer.unref();
  }
  
  private async tick() {
    try {
      const result = await this.agent.run({
        message: this.config.prompt ?? DEFAULT_HEARTBEAT_PROMPT,
        isHeartbeat: true,
      });
      
      if (this.isHeartbeatOk(result)) {
        // 조용히 넘어감, transcript 정리
      } else {
        // 사용자에게 전달
        await this.deliver(result);
      }
    } finally {
      this.scheduleNext();
    }
  }
}
```

### 4.2 Cron 구현 제안

**핵심 컴포넌트**:

```
CronService
├── store: CronStore (JSON file)
├── timer: NodeJS.Timeout | null
├── jobs: CronJob[]
├── start() / stop()
├── add(job) / remove(id) / update(id, patch)
└── armTimer() → onTimer() → executeJob()
```

**스케줄 타입** (OpenClaw 방식 그대로 3종):
- `at`: 일회성 (ISO string)
- `every`: 반복 (ms 간격)
- `cron`: cron 표현식 (croner 라이브러리)

**크론 라이브러리 선택**:
- **croner** 추천 (OpenClaw 검증, lightweight, 타임존 지원, ESM 네이티브)
- node-cron은 자체 타이머 내장이라 제어가 어려움

**실행 모드 2가지**:
1. **main-session**: 기존 대화에 system event로 끼워넣기 → heartbeat가 처리
2. **isolated**: 새 세션 생성 → 독립 실행 → 결과 전달

**최소 구현**:
```typescript
import { Cron } from "croner";

class CronService {
  private timer: NodeJS.Timeout | null = null;
  private store: CronStore;
  
  async start() {
    this.store = await loadStore(this.storePath);
    this.recomputeNextRuns();
    this.armTimer();
  }
  
  private armTimer() {
    if (this.timer) clearTimeout(this.timer);
    const nextAt = this.getNextWakeMs();
    if (!nextAt) return;
    const delay = Math.max(0, nextAt - Date.now());
    this.timer = setTimeout(() => this.onTimer(), delay);
    this.timer.unref();
  }
  
  private async onTimer() {
    const dueJobs = this.findDueJobs();
    for (const job of dueJobs) {
      await this.executeJob(job);
    }
    this.recomputeNextRuns();
    await this.persist();
    this.armTimer();
  }
  
  private computeNextRun(schedule: Schedule): number | undefined {
    if (schedule.kind === "cron") {
      const cron = new Cron(schedule.expr, { timezone: schedule.tz });
      return cron.nextRun()?.getTime();
    }
    // ... at, every 처리
  }
}
```

### 4.3 핵심 설계 원칙 (OpenClaw에서 배울 점)

1. **setTimeout > setInterval**: 매번 다음 실행 시점 재계산 → 정확도 + 유연성
2. **File-based store**: 크론 작업을 JSON 파일에 저장 → 재시작 시 복구, 외부에서 수정 가능
3. **Lock ordering 명시**: 교착 방지를 위해 lock 순서를 문서화
4. **Wake coalesce**: 짧은 시간 내 다중 트리거를 하나로 합침 (250ms 버퍼)
5. **Transcript pruning**: heartbeat-ok 응답은 대화 기록에서 제거 → 토큰 절약
6. **Stagger**: 동일 시간 cron job들의 동시 실행 분산
7. **Dependency injection**: CronService가 heartbeat runner를 직접 참조하지 않고 deps로 주입
8. **Missed job recovery**: 서비스 재시작 후 놓친 작업 보충

### 4.4 단순화 가능한 부분

OpenClaw는 멀티 에이전트, 멀티 채널을 지원하기 때문에 복잡도가 높다. agent-for-work에서는:

- **단일 에이전트**면 에이전트별 heartbeat 스케줄링 불필요
- **채널 라우팅** 불필요하면 delivery 로직 단순화
- **Active hours**는 선택적 구현
- **Stagger**는 job이 적으면 불필요
- **Session reaper**는 isolated 실행이 없으면 불필요

**권장 구현 순서**:
1. HeartbeatRunner (setTimeout + HEARTBEAT_OK 감지)
2. CronService 기본 (store + armTimer + croner)
3. main-session cron (system event → heartbeat)
4. isolated cron (선택)
5. 에러 핸들링 + retry + failure alert
