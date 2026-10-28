# Releasing Agent Desk

1. Bump `version` in `package.json`, commit, and push to `main`.
2. Tag it: `git tag v0.3.1 && git push origin v0.3.1`.
3. The `release` workflow builds macOS (arm64, x64) and Windows (x64, arm64) installers, runs the
   unit tests and the packaged-app E2E on each OS, writes `SHA256SUMS`, signs it, and attaches
   everything to a **draft** release.
4. Look the draft over (notes, file list), then **Publish**. Installed apps check
   `releases/latest` every few hours and on start; drafts and pre-releases are never offered.

Installed apps only accept an update whose file is listed in `SHA256SUMS` with a matching hash, and
whose `SHA256SUMS.sig` verifies against the public key in `desktop/update-key.js`.

## The update signing key

- Private half: GitHub secret `UPDATE_SIGNING_KEY` (Ed25519, PKCS#8 PEM). The original copy was made
  on the maintainer's Mac at `~/.config/agentdesk/update-signing-key.pem`; keep a backup in a
  password manager. Never commit it.
- Public half: `desktop/update-key.js`, shipped in every build.
- `scripts/sign-release.mjs` refuses to sign with a key that doesn't match the shipped public key.

**Rotating** (the old key still exists): put the new public key in `desktop/update-key.js`, release
that version signed with the **old** key (set the secret to the old key for this one release), then
switch the secret to the new key. Copies older than that release update once more, to the version
that trusts the new key.

**Lost key:** installed copies can't verify anything signed with a new key. Ship a release with the
new public key and tell people to download it once by hand; from then on updates work again.

## Code signing

Builds are ad-hoc signed on macOS and unsigned on Windows (Gatekeeper and SmartScreen ask once;
see the README). Adding an Apple Developer ID (signing + notarization) and a Windows signing
certificate only needs `mac.identity` / notarize settings and `win` signing settings in
`package.json` plus secrets; the update flow stays the same.
