"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import { CONSENT_CHANGED_EVENT, readConsent } from "../lib/cookieConsent";

const CF_BEACON_TOKEN =
  process.env.NEXT_PUBLIC_CF_BEACON_TOKEN || "f3da85fd10fc461b899406759faec1e0";

/**
 * Loads the Cloudflare Web Analytics beacon only once the user has explicitly
 * granted analytics consent, matching how PostHogInit gates posthog-js.
 *
 * Cloudflare publishes no programmatic opt-out API for the beacon, so the
 * script tag is simply not rendered until consent is granted. If consent is
 * later revoked we unmount the tag and remove the already-injected element.
 *
 * Limitation worth knowing: a beacon that already loaded may have queued and
 * sent a request before revocation took effect, and Cloudflare cannot retract
 * data it has already received. Revocation stops all future collection; it does
 * not undo collection that already happened. Cloudflare Web Analytics is
 * cookieless (no cookies, no cross-site tracking identifiers), which is why it
 * is often treated as exempt from consent requirements - but gating it keeps
 * this site internally consistent, since GA4 and PostHog are already gated.
 */
export default function CloudflareAnalyticsInit() {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const sync = () => setAllowed(Boolean(readConsent()?.analytics));

    sync();
    window.addEventListener(CONSENT_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener(CONSENT_CHANGED_EVENT, sync);
      // Best-effort teardown: next/script cannot retroactively unload a tag it
      // has already executed, so drop the element from the DOM ourselves.
      document
        .querySelectorAll('script[src*="static.cloudflareinsights.com"]')
        .forEach((el) => el.remove());
    };
  }, []);

  if (!allowed) return null;

  return (
    <Script
      src="https://static.cloudflareinsights.com/beacon.min.js"
      data-cf-beacon={JSON.stringify({ token: CF_BEACON_TOKEN })}
      strategy="afterInteractive"
    />
  );
}
