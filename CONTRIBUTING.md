# Contributing

Use **Node.js 20+** and **pnpm** (see `package.json` `packageManager`).

```bash
pnpm install
pnpm run validate
```

`validate` runs Prettier, ESLint, TypeScript, `cf-types:check` (regenerates Wrangler types and asserts `worker-configuration.d.ts` is committed), and Vitest.

## Wrangler-generated types

After changing `wrangler.toml` or Worker bindings, regenerate types and commit the result:

```bash
pnpm run cf-types
```

CI runs `pnpm run cf-types:check`, which fails if `worker-configuration.d.ts` is out of date relative to the current Wrangler config.

## Vitest and the Workers test pool

If `pnpm run test` fails inside Miniflare with a missing export from `@vitest/expect` (for example `ChaiStyleAssertions`), pin all `@vitest/*` packages to the same version as `vitest` using `pnpm.overrides`, then reinstall. This usually indicates duplicate Vitest packages in the dependency tree.

## Request types allowlist

Primal cache `requestType` strings live in `src/data/primal-request-types.json`. Update `noParams` vs `withParams` when Primal adds or changes operations, then run `pnpm run validate`.

## Code of conduct

This project follows the [SmartFlowSocial Code of Conduct](CODE_OF_CONDUCT.md). Report unacceptable behavior on Nostr at `npub1ckqlguq0htvs3smwy8pl5uwmfas0h208p7p8hs92ghaurgkmzzrsw3vlh0`.
