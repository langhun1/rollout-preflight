# Rollout Preflight

Review what a Flagsmith release would change before approving it. Supply a small contract of synthetic users and expected flag states. The CLI evaluates the same contract against two Flagsmith environments and shows the exact user profiles that would block the release.

## Try the review dashboard

```sh
node review-server.mjs
```

Open http://127.0.0.1:4337. The built-in demo shows a candidate that accidentally turns on express checkout for anonymous visitors. Select **Trial customers only** and run the preflight again. Enter a reviewer name to download the approval record for the corrected candidate. Demo records identify their simulated data. For live review, start the server with environment keys and select **Live Flagsmith**. The dashboard listens on loopback and keeps the keys on the server.

## Run a check

Use Node.js 22 or later. Configure the baseline and candidate keys from Flagsmith's environment settings as `FLAGSMITH_BASELINE_KEY` and `FLAGSMITH_CANDIDATE_KEY`. Start with [example.json](example.json) and replace the flag and profiles with your release contract. For self-hosted Flagsmith, set `FLAGSMITH_API_URL` to the API root, for example `http://localhost:8000/api/v1/`.

```sh
node preflight.mjs scan example.json
```

An expectation of `"unchanged"` protects the profile's baseline enabled state and value. To approve a deliberate change, declare the exact candidate state as `{"enabled":true,"value":null}` or supply the expected remote config value. A missing flag blocks the release. Profiles without an identity use the environment defaults. Identity profiles are sent with transient traits to the Flagsmith Flags API. Use synthetic data.

## Record approval

After reviewing the output, use the printed digest and your reviewer name.

```sh
node preflight.mjs approve example.json <digest> "Release reviewer"
```

Approval evaluates both environments again. If any relevant result or contract field changed, the previous digest fails. The approval is a local record for the reviewer or release pipeline. It makes no change to Flagsmith.

For a read-only smoke test, use Flagsmith's [published Quick Start environment key](https://docs.flagsmith.com/getting-started/quick-start) for both environments. Approval requires separate keys.

