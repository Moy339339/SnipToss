import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useIntl } from "react-intl";
import { fixedCaps } from "./commandKeys";
import { activeKeys, COMMAND_GROUPS, commandById, commandsFor, keyCaps, keysOf, type Command } from "./commands";
import { call, inHost } from "./host";
import { hotkeyParts, keycaps } from "./hotkey";
import { KeepPunctuation } from "./KeepPunctuation";
import { usePrefs } from "./prefs";
import { Sheet } from "./Sheet";

// The Keyboard Shortcuts sheet (? / F1): the command table (commands.ts) with the keys each command has now, grouped as in Settings →
// Keyboard Shortcuts, where they are changed. Commands left without a key are not listed here.

/** A description ending in a parenthesized addition, fullwidth (U+FF08 U+FF09) or halfwidth */
const ADDITION = new RegExp(`^(.+?)[${String.fromCharCode(0xff08)}(](.+)[${String.fromCharCode(0xff09)})]$`);

/** One shortcut row. A parenthesized addition at the end of the description ("Open menu (or press Alt first, then the letter)") goes on its own line one size smaller, so long descriptions do not leave orphan words */
export function ShortcutRow({ label, keys }: { label: string; keys: ReactNode }) {
  const intl = useIntl();
  // The rows of the Mac's app menu keys name the app ("Quit {app}"), as the app menu does
  const text = intl.formatMessage({ id: label }, { app: intl.formatMessage({ id: "brand.name" }) });
  // The parenthesized addition is shown in gray (both fullwidth CJK and halfwidth parentheses are recognized)
  const m = ADDITION.exec(text);
  return (
    <div className="shortcut-row">
      {/* A column: the description, then the addition. Each is one element, so the pieces KeepPunctuation cuts the text into stay in the
          line instead of each becoming an item of the column */}
      <span className="shortcut-label">
        <span>
          <KeepPunctuation>{m ? m[1] : text}</KeepPunctuation>
        </span>
        {m && (
          <span className="shortcut-note">
            <KeepPunctuation>{m[2]}</KeepPunctuation>
          </span>
        )}
      </span>
      <span className="shortcut-keys">{keys}</span>
    </div>
  );
}

/** Several keys of one command: each drawn as its keycaps, a slash between them */
function KeyList({ keys }: { keys: string[][] }) {
  return keys.map((caps, i) => (
    <Fragment key={i}>
      {i > 0 && <span className="shortcut-or">/</span>}
      {caps.map((c, j) => (
        <kbd key={j}>{c}</kbd>
      ))}
    </Fragment>
  ));
}

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { prefs } = usePrefs();
  const bindings = prefs.keybindings;
  /** The Screen Capture shortcut, a global one the shell keeps with the capture settings ("" = none) */
  const [capture, setCapture] = useState("");
  useEffect(() => {
    if (!inHost) return;
    call("captureSettings")
      .then((s) => setCapture(s.hotkey))
      .catch(() => {});
  }, []);

  /** The keycaps of a command as it is now; undefined = no key, not listed */
  const capsOf = (cmd: Command): string[][] | undefined => {
    if (cmd.global) return capture ? [hotkeyParts(capture).map((k) => keycaps(k, t))] : undefined;
    if (cmd.fixed) {
      const caps = fixedCaps(cmd, bindings, intl);
      return caps && [caps];
    }
    const keys = keysOf(cmd, bindings);
    return keys.length ? keys.map((k) => keyCaps(k, t)) : undefined;
  };
  const groups = COMMAND_GROUPS.map((g) => ({
    g,
    rows: commandsFor()
      .filter((x) => x.group === g)
      .flatMap((cmd) => {
        const caps = capsOf(cmd);
        return caps ? [{ cmd, caps }] : [];
      }),
  })).filter((x) => x.rows.length > 0);

  return (
    <Sheet title={t("sc.title")} closeKeys={activeKeys(commandById("app.shortcuts"), bindings)} onClose={onClose}>
      <div className="sheet-grid">
        {groups.map(({ g, rows }) => (
          <section key={g}>
            <div className="section-label">{t(`sc.group.${g}`)}</div>
            {rows.map(({ cmd, caps }) => (
              <ShortcutRow key={cmd.id} label={cmd.label} keys={<KeyList keys={caps} />} />
            ))}
          </section>
        ))}
      </div>
    </Sheet>
  );
}
