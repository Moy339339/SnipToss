import { useCallback, useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { APP_VERSION, versionLabel } from "./brand";
import { call, onHostEvent, type NewerVersion } from "./host";
import type { Notify } from "./report";

/**
 * Checking for updates (shell app/Updates.cs): after startup the shell checks automatically (at most once a day, can be turned off in Settings → General) and sends updateAvailable when it finds one,
 * and the title bar shows an "update available" button that opens that version's download page in the browser; Help → Check for Updates… is the manual check, and the result is reported in a toast.
 * It does not interrupt with a dialog and does not download by itself: whether and when to update is up to the user
 */
export function useUpdates(notify: Notify) {
  const intl = useIntl();
  const [newer, setNewer] = useState<NewerVersion | null>(null);
  useEffect(() => onHostEvent("updateAvailable", (n) => setNewer(n)), []);

  const open = useCallback((n: NewerVersion) => void call("openExternal", { url: n.url }).catch((e: Error) => notify(e.message)), [notify]);

  const check = useCallback(async () => {
    const failed = () => notify(intl.formatMessage({ id: "help.update.failed" }));
    try {
      const r = await call("checkUpdates");
      if (r.newer) {
        const n = r.newer;
        setNewer(n);
        notify(intl.formatMessage({ id: "help.update.available" }, { version: versionLabel(n.version) }), {
          label: intl.formatMessage({ id: "help.update.open" }),
          run: () => open(n),
        });
      } else if (r.error) failed();
      else notify(intl.formatMessage({ id: "help.update.latest" }, { version: versionLabel(APP_VERSION) }));
    } catch {
      failed();
    }
  }, [intl, notify, open]);

  return { newer, check, open };
}
