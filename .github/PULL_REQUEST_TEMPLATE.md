## What and why

<!-- What does this change, and what problem does it solve? Link the issue if there is one. -->

## How it was tested

<!-- Commands you ran and anything you checked by hand. -->

- [ ] `npm run verify` passes
- [ ] `npm run e2e:shell` passes (only if `app/` changed)

## Checklist

- [ ] New UI text is in `i18n/locales/zh-CN.json` and `en.json`, not hard-coded
- [ ] Changed a bridge method → updated `docs/host-api.md` and `tests/e2e/mock-host.ts`
- [ ] Changed the data format → followed the process in CONTRIBUTING.md (format doc and schema first, golden sample, migration test)
- [ ] Changed a shortcut → updated `docs/shortcuts.md` and `packages/web/src/ShortcutHelp.tsx`
