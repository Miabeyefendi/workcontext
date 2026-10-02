import { toast } from "../../hooks/use-toast";

/**
 * Shared rate-limit notifier.
 *
 * Three constraints shape this module:
 *
 * 1. `TOAST_LIMIT` in `use-toast.ts` is `1`, so only one toast can ever be on
 *    screen. A persistent "you are rate limited" toast therefore cannot
 *    coexist with a "you are back" toast — the second would evict the first.
 *    So we keep ONE toast handle for the whole lifecycle and mutate it in
 *    place with `update()`. That in-place flip is what delivers the user's
 *    second message: "tell me when they are no longer requesting".
 *
 * 2. Radix auto-dismisses a toast after 5s by default and `duration` is
 *    captured when the toast *opens*, so updating the text every second would
 *    not keep it on screen. A countdown that silently vanished after 5s would
 *    be worse than no toast, so blocked toasts are created with
 *    `duration: Infinity` and dismissed explicitly.
 *
 * 3. Not every 429 is time-based. Plan/quota 429s (e.g. "Grammar check limit
 *    reached, please upgrade") carry no reset time. Counting down from a
 *    made-up number, or promising the limit "has reset", would be a lie — so
 *    we only ever run a timer when the server stated when the window ends.
 */

const POLL_INTERVAL_MS = 1000;
/** Hard cap on any in-UI timer so a malformed header can't pin a toast. */
const MAX_COUNTDOWN_S = 60 * 60;
/** How long the "back online" message stays before we release the slot. */
const RECOVERY_DISPLAY_MS = 5000;

export interface RateLimitDetails {
  message?: string;
  /** Seconds the backend says to wait. */
  retryAfter?: number | null;
  /** Window budget from RateLimit-Policy / RateLimit-Limit. */
  limit?: number | null;
  remaining?: number | null;
  /** Seconds until the window resets. */
  reset?: number | null;
}

type ToastHandle = ReturnType<typeof toast>;

let activeHandle: ToastHandle | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let blockedUntil = 0;
let lastDetails: RateLimitDetails = {};

function clearTicker() {
  if (ticker !== null) {
    clearInterval(ticker);
    ticker = null;
  }
}


function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs === 0 ? `${mins}m` : `${mins}m ${String(secs).padStart(2, "0")}s`;
}

function releaseToast() {
  activeHandle = null;
  clearTicker();
}

/**
 * Read the standard draft-7 RateLimit headers, falling back to the legacy
 * `X-RateLimit-*` names emitted by the older in-memory limiter.
 */
export function parseRateLimitHeaders(headers: Headers): RateLimitDetails {
  const num = (v: string | null): number | null => {
    if (!v) return null;
    const parsed = parseInt(v, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };

  let limit = num(headers.get("RateLimit-Limit") ?? headers.get("X-RateLimit-Limit"));
  let remaining = num(
    headers.get("RateLimit-Remaining") ?? headers.get("X-RateLimit-Remaining"),
  );
  let reset = num(headers.get("RateLimit-Reset") ?? headers.get("X-RateLimit-Reset"));

  // `RateLimit: limit=100, remaining=0, reset=60` (draft-7, express-rate-limit v8)
  const combined = headers.get("RateLimit");
  if (combined) {
    for (const part of combined.split(",")) {
      const [rawKey, rawValue] = part.split("=");
      if (!rawKey || rawValue === undefined) continue;
      const key = rawKey.trim().toLowerCase();
      const value = num(rawValue.trim());
      if (value === null) continue;
      if (key === "limit") limit = value;
      if (key === "remaining") remaining = value;
      if (key === "reset") reset = value;
    }
  }

  const retryAfter = num(headers.get("Retry-After"));

  return {
    limit,
    remaining,
    // Some servers send an absolute epoch or an ISO timestamp rather than a
    // delta, so reject anything that is not a plausible number of seconds.
    reset: reset !== null && reset > 0 && reset <= MAX_COUNTDOWN_S ? reset : null,
    retryAfter: retryAfter !== null && retryAfter > 0 ? retryAfter : null,
  };
}

/** Drop the generic "please try again later" tail so we can replace it. */
function usableBackendMessage(message?: string): string | null {
  if (!message) return null;
  const trimmed = message.trim();
  if (!trimmed) return null;
  if (/^rate limit exceeded\.?$/i.test(trimmed)) return null;
  if (/please try again later\.?$/i.test(trimmed)) {
    const head = trimmed.replace(/[,.\s]*please try again later\.?$/i, "");
    return head.length > 3 ? head : null;
  }
  return trimmed;
}

function renderBlocked(details: RateLimitDetails, secondsLeft: number | null) {
  const parts: string[] = [];

  // Prefer the backend's own wording (it may name a specific plan/quota),
  // otherwise describe the window in concrete terms.
  const backend = usableBackendMessage(details.message);
  if (backend) {
    parts.push(backend.endsWith(".") ? backend : `${backend}.`);
  } else if (details.limit != null && details.limit > 0) {
    parts.push(
      `You've used all ${details.limit} requests allowed in this time window.`,
    );
  } else {
    parts.push("Too many requests were sent in a short period.");
  }

  if (secondsLeft !== null) {
    parts.push(`You can try again in ${formatWait(secondsLeft)}.`);
  } else {
    // No reset time from the server, so waiting alone will not clear this.
    parts.push("This limit will not reset on a timer — check your usage or plan.");
  }

  return {
    variant: "destructive" as const,
    title: "Request limit reached",
    description: parts.join(" "),
  };
}

function renderRecovered() {
  return {
    variant: "default" as const,
    title: "You’re back online",
    description: "Your request limit has reset. Feel free to try again.",
  };
}

/** Clamp to a sane positive delta, or null when we have no usable value. */
function normalizeSeconds(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(Math.ceil(value), MAX_COUNTDOWN_S);
}

/**
 * Announce that a request was rejected.
 *
 * Safe to call from anywhere: this is a module singleton with no React
 * dependency, and it is a no-op while a countdown is already ticking — so a
 * burst of 429s cannot restart (and thereby extend) the timer.
 */
export function notifyRateLimited(details: RateLimitDetails = {}) {
  if (typeof window === "undefined") return;

  const merged: RateLimitDetails = { ...lastDetails, ...details };
  lastDetails = merged;

  // Only count down when the server actually stated when the window ends.
  const seconds = normalizeSeconds(merged.retryAfter ?? merged.reset);

  // A countdown is already running for this episode: keep the existing toast,
  // but honour a longer deadline if the server just sent one.
  if (activeHandle !== null && ticker !== null) {
    if (seconds !== null) blockedUntil = Date.now() + seconds * 1000;
    return;
  }

  // `duration: Infinity` — Radix would otherwise auto-dismiss after 5s, long
  // before a 15-minute window is up, leaving the user with no warning at all.
  const handle = toast({
    ...renderBlocked(merged, seconds),
    duration: Infinity,
  });
  activeHandle = handle;

  // Non-time-based limit (plan quota, etc.): show the message, start no timer,
  // and make no promise about when it lifts.
  if (seconds === null) return;

  blockedUntil = Date.now() + seconds * 1000;
  clearTicker();
  ticker = setInterval(() => {
    const remaining = Math.ceil((blockedUntil - Date.now()) / 1000);
    if (remaining <= 0) {
      clearTicker();
      // Window elapsed locally: flip the SAME toast to the "back online"
      // message so the user is told the limit lifted.
      handle.update({ ...renderRecovered(), duration: RECOVERY_DISPLAY_MS, id: handle.id });
      setTimeout(() => {
        handle.dismiss();
        releaseToast();
      }, RECOVERY_DISPLAY_MS);
      return;
    }
    handle.update({ ...renderBlocked(merged, remaining), id: handle.id });
  }, POLL_INTERVAL_MS);
}

/**
 * Called after a request succeeds. While a countdown is running this is a
 * genuine signal that the window rolled over, so announce it right away
 * instead of waiting for the local timer to elapse.
 *
 * Outside a rate-limit episode this is deliberately silent, so ordinary
 * traffic never spams the user — and it will NOT claim a reset for limits
 * that were never time-based.
 */
export function notifyRateLimitCleared() {
  if (typeof window === "undefined") return;
  if (activeHandle === null) return;

  const wasTimeBased = ticker !== null;
  clearTicker();

  if (!wasTimeBased) return;

  activeHandle.update({
    ...renderRecovered(),
    duration: RECOVERY_DISPLAY_MS,
    id: activeHandle.id,
  });
  setTimeout(() => {
    if (activeHandle) activeHandle.dismiss();
    releaseToast();
  }, RECOVERY_DISPLAY_MS);
}

/**
 * Convenience for raw `fetch()` call sites that bypass `apiClient`: inspect a
 * response and fire the matching notification. Returns true when the response
 * was a 429 so the caller can branch on it.
 */
export function reportRateLimitFromResponse(
  response: Response,
  body?: { message?: string; retryAfter?: number } | null,
): boolean {
  if (response.status !== 429) {
    notifyRateLimitCleared();
    return false;
  }

  const headers = parseRateLimitHeaders(response.headers);
  notifyRateLimited({
    ...headers,
    message: body?.message,
    retryAfter: headers.retryAfter ?? normalizeSeconds(body?.retryAfter),
  });
  return true;
}