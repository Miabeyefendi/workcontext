import posthog from "posthog-js";
import * as Sentry from "@sentry/nextjs";

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

if (process.env.NODE_ENV !== "production" && !token) {
  console.error(
    "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, " +
    "this causes events to be silently missed. " +
    "This error stops appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured",
  );
}

if (token) {
  posthog.init(token, {
    // Route events through the Next.js reverse proxy to avoid ad-blockers
    api_host: "/ingest",
    // PostHog UI host (for toolbar, etc.) - use custom host from env
    ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.posthog.com",
    // Use 2026-01-30 defaults as required
    defaults: "2026-01-30",
    // Enable error tracking via unhandled exception capture
    capture_exceptions: true,
    // Enable debug logging in development
    debug: process.env.NODE_ENV === "development",
  });
}

// Sentry User Feedback + Session Replay integrations (client-side only)
// NOTE: This file runs in the BROWSER. Next.js only inlines NEXT_PUBLIC_* vars
// into the client bundle, so NEXT_PUBLIC_SENTRY_DSN is the one that will
// actually resolve here. SENTRY_DSN is kept as a fallback for parity with the
// server/edge configs, which run on Node where the non-public var is readable.
const sentryDsn =
  process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;

if (process.env.NODE_ENV !== "production" && !sentryDsn) {
  console.error(
    "NEXT_PUBLIC_SENTRY_DSN is missing or un-configured, so client-side Sentry " +
    "events will be silently dropped. " +
    "This error stops appearing once NEXT_PUBLIC_SENTRY_DSN is configured",
  );
}

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    integrations: [
      Sentry.feedbackIntegration({
        // Additional SDK configuration goes in here, for example:
        colorScheme: "system",
        isNameRequired: true,
        isEmailRequired: true,
      }),
      Sentry.replayIntegration(),
    ],
    // Session Replay
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    // Performance tracing for the browser
    tracesSampleRate: 1,
  });
}

// IMPORTANT: Do NOT combine this with any other PostHog init approach (e.g. a PostHogProvider).
// instrumentation-client.ts is the correct client-side PostHog init for Next.js 15.3+.
// Note: The User Feedback integration only needs to be added to your instrumentation-client.(js|ts) file.
// Adding it to any server-side configuration files (like instrumentation.(js|ts)) will break your build
// because the Feedback integration depends on Browser APIs.
