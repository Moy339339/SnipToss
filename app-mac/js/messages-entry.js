// Bundled into one script (app-mac/scripts/build-resources.mjs) and run by the shell in JavaScriptCore, so the shell formats its messages
// with the same intl-messageformat package the UI uses: plurals, selects and the CLDR rules come out the same on both sides.
import { IntlMessageFormat } from "intl-messageformat";

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
