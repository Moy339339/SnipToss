// Bundled into one script (app-mac/scripts/build-resources.mjs) and run by the shell in JavaScriptCore, so the shell formats its messages
// with the same intl-messageformat package the UI uses: plurals, selects and the CLDR rules come out the same on both sides.
import { IntlMessageFormat } from "intl-messageformat";
import { keyWordsOf, macifyMessages, macifyShortcuts } from "../../packages/web/src/macKeys.ts";

const formatters = new Map();

/** Formats an ICU message in a language; a formatter is kept per language and message, parsing is the costly part */
globalThis.snipFormat = (locale, pattern, args) => {
  const id = locale + "|" + pattern;
  let formatter = formatters.get(id);
  if (!formatter) {
    formatter = new IntlMessageFormat(pattern, locale);
    formatters.set(id, formatter);
  }
  return String(formatter.format(args));
};

/** A whole catalog (JSON text) with the shortcuts in its messages written the Mac way ("Undo (Ctrl Z)" → "Undo (⌘Z)"), as the UI does on the Mac */
globalThis.snipMacify = (catalog) => JSON.stringify(macifyMessages(JSON.parse(catalog)));

/** One text written the Mac way, with the key names of a catalog (JSON text): for checking formatted messages against the golden ones */
globalThis.snipMacifyText = (text, catalog) => macifyShortcuts(text, keyWordsOf(JSON.parse(catalog)));
