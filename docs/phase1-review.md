# Phase 1 Code Review — Dashboard & AgentList

**Reviewer:** Codex (gpt-5.3-codex)  
**Date:** 2026-03-12  
**Scope:** Unstaged changes in `web/` — `App.tsx`, `Layout.tsx`, `Dashboard.tsx`, `AgentList.tsx`

---

## Summary

No critical issues found. 4 warnings and 3 suggestions identified. Key props and hook rules are correct across all changed files. One pre-existing TS error exists in `useEventSource.ts` (unused `useCallback` import).

---

## Warnings

### W1. Clickable Cards are not keyboard-accessible
**Files:** `AgentList.tsx:64`, `Dashboard.tsx:73`, `Dashboard.tsx:147`

Card components use `onClick` + `cursor-pointer` but lack `tabIndex`, `role="button"`, and `onKeyDown` handlers. Screen reader and keyboard-only users cannot interact with these elements.

**Fix:** Wrap cards in `<button>` or add `role="button"`, `tabIndex={0}`, and `onKeyDown` (Enter/Space) handler.

---

### W2. Dashboard loading coupled to `/api/health`
**File:** `Dashboard.tsx:21`

Both `fetchAgents()` and `fetchHealth()` must resolve before `setLoading(false)`. If the health endpoint is slow or hanging, the entire dashboard stays in loading state indefinitely.

**Fix:** Load agents and health independently with separate loading states, or add a timeout/fallback for health.

---

### W3. Sidebar collapsed-state persistence is fragile
**Files:** `Layout.tsx:56`, `Layout.tsx:67`, `Layout.tsx:123`

- `JSON.parse(localStorage.getItem(...))` can return `null` or unexpected shapes — no validation before use.
- `localStorage.setItem()` is unguarded and can throw in restricted storage environments (Safari private mode, full quota).

**Fix:** Wrap in try/catch with fallback defaults:
```ts
function readCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem("sidebar-collapsed");
    return raw ? JSON.parse(raw) ?? {} : {};
  } catch {
    return {};
  }
}
```

---

### W4. `statusVariant` uses `Record<string, ...>` instead of `Record<Agent["status"], ...>`
**File:** `AgentList.tsx:15`

The status-to-variant mapping is typed as `Record<string, ...>`, so new or missing statuses (e.g., `"disposed"`) won't produce compile-time errors.

**Fix:** Type the record key as `Agent["status"]` (or a union type derived from the Agent interface) so the compiler flags missing entries.

---

## Suggestions

### S1. Add `aria-expanded` / `aria-controls` to sidebar collapse buttons
**File:** `Layout.tsx:126`

Collapse/expand buttons should convey their state to assistive technologies.

---

### S2. Prefer semantic/theme tokens over hardcoded colors
**Files:** `Dashboard.tsx:155`, `AgentList.tsx:102`

Hardcoded utilities like `bg-green-500`, `text-blue-400` break when switching themes. Use shadcn/ui semantic classes (`text-primary`, `text-muted-foreground`, etc.) or CSS variables.

---

### S3. Health "unknown/loading" should not render as destructive
**Files:** `Dashboard.tsx:127`, `Layout.tsx:110`

When health data hasn't loaded yet (`null`), the badge renders with `destructive` variant, which falsely signals an error. Use a neutral or `outline` variant for the unknown/loading state.

---

## Pre-existing Issues

| File | Issue |
|---|---|
| `useEventSource.ts:1` | `useCallback` imported but never used (TS6133) |

---

## TypeScript Check

```
npx tsc -p tsconfig.app.json --noEmit
# Only error: useEventSource.ts(1,29): TS6133 — useCallback unused (pre-existing)
# No new type errors from Phase 1 changes.
```

---

## Verdict

Phase 1 changes are structurally sound. Address **W1** (keyboard accessibility) and **W3** (localStorage safety) before merging; the rest can be deferred to Phase 2.
