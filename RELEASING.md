# Releasing

`main` is the release branch. User-visible changes require `npm run changeset`.

## Trusted publishing

The npm package uses a trusted publisher with user `grikomsn`, repository `opencode-provider-inco`, workflow `release.yml`, and no environment. GitHub Actions uses `id-token: write` and provenance; no long-lived npm token is required.

Changesets opens a version pull request. After it is merged, CI validates the package, publishes missing npm versions, and creates the matching GitHub release. Reruns skip existing versions and tags.
