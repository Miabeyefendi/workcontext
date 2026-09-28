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

// Sentry User Feedback integration (client-side only)
Sentry.init({
  dsn: "https://1f6ae299d41a7fc29dd459272f92b516@o4511580853108736.ingest.us.sentry.io/4511999687655424",
  integrations: [
    Sentry.feedbackIntegration({
      // Additional SDK configuration goes in here, for example:
      colorScheme: "system",
      isNameRequired: true,
      isEmailRequired: true,
    }),
  ],
});

// IMPORTANT: Do NOT combine this with any other PostHog init approach (e.g. a PostHogProvider).
// instrumentation-client.ts is the correct client-side PostHog init for Next.js 15.3+.
// Note: The User Feedback integration only needs to be added to your instrumentation-client.(js|ts) file.
// Adding it to any server-side configuration files (like instrumentation.(js|ts)) will break your build
// because the Feedback integration depends on Browser APIs.
