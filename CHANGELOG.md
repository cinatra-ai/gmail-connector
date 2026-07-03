# Changelog

All notable changes to this project are documented here, derived from the
project's merged pull request and release-tag history.

## v0.1.2 — 2026-06-25

- ci: add truthful-attribution-gate in WARN (advisory) mode (#19)
- ci: adopt the reusable extension->host IoC conformance gate (org-wide rollout) (#20)
- ci: tag-driven GitHub release on v* (#21)
- ci: adopt secret-scan-gate (#22)
- Gate Gmail connect button on Google OAuth config state (#23)

## v0.1.1 — 2026-06-13

- test: re-ground dev-recipient-override onto the deps slot (cinatra#172 Stage H1) (#15)
- ci(release): grant contents: write + pin reusable workflow to .github HEAD (#16)
- ci: repin reusable release workflow (immutable-safe decoration + corrected build-input provisioning) (#17)
- release: gmail-connector v0.1.1 (republish on corrected serverEntry build pipeline) (#18)

## v0.1.0 — 2026-06-03

- Initial release.

## Unreleased

- ci: adopt source-leak-gate (#1)
- ci: adopt source-leak-gate (#2)
- chore: add .gitignore (#3)
- ci: adopt org gates — SHA-pin all uses: refs, bump leak-gate to v0.1.0, add actions-pinned + gitignore gate callers (#4)
- chore: keep internal planning notes untracked (#5)
- Self-register at serverEntry activation: host deps via capability services, email-send provider, nango post-save alias hook (#6)
- Contribute send-as addresses to the chat via the chat-user-context capability (#7)
- chore: npm files allowlist + git-archive export-ignore (packaging hygiene) (#8)
- chore: drop the empty src/__tests__/ dir entry from source archives (#9)
- ci: adopt the org ui-design-system gate (#10)
- chore: Configure Renovate (#11)
- Resolve the nango-system surface directly (cinatra#151 Stage 3) (#13)
- feat: register email-sender-identities + declare the email_send facade primitive (cinatra#151 Stage 4) (#14)
- docs(readme): expand README to the org standard (#24) (#25)
- ci(ui-gate): ramp raw-JSX block to error (#26)
- ci: adopt source-leak-gate (#27)
- ci: adopt source-leak-gate (#28)
- docs(readme): conform to extension-kind-gate strict format (#29)
- ci(ui-gate): re-vendor preset with Block-C (dynamic-import ban) + bump pin to v0.1.1 (#30)
- chore: strip private engineering-tracker refs from public source (#31)
- chore: strip private tracker references from workflow comments (#34)
- ci(release): pin reusable-extension-release to gated v0.1.1 (release-approval wall) (#35)
- chore: add cinatra.vendor connector provenance metadata (#36)
- fix(mcp): bind Gmail send/reply identity to the trusted session actor (#37)
- chore(deps): declare cinatra.consumes for closure-gate enrollment (#38)

