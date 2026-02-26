"use client";

import { useEffect } from "react";

export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }

    if (!("serviceWorker" in navigator)) {
      return;
    }

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });

        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
      } catch {
        // Keep silent in production; app continues without offline mode.
      }
    };

    register();
  }, []);

  return null;
}
