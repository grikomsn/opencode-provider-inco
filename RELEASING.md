# Releasing

`main` is the release branch. User-visible changes require `npm run changeset`.

## First npm publication

This new package must be bootstrapped with an authorized npm account before GitHub OIDC publishing can run. The release workflow skips publishing until the package exists.

After the first publication, configure the npm trusted publisher with user `grikomsn`, repository `opencode-provider-inco`, workflow `release.yml`, and no environment. GitHub Actions uses `id-token: write` and provenance; no long-lived npm token is required.

Changesets opens a version pull request. After it is merged, CI validates the package, publishes missing npm versions, and creates the matching GitHub release. Reruns skip existing versions and tags.
