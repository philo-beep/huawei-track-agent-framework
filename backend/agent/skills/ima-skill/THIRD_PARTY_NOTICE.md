# IMA Official Skill Notice

- Component: Tencent IMA official skill package
- Upstream product: https://ima.qq.com
- Version: `1.1.10` (from bundled `meta.json`)
- Local package name observed: `ima-skills-1.1.10.zip`
- Upstream package SHA-256: `7e0d07cae0f98145dc5147e84b77bcc557e2fc4b256b08907922637952c20a7b` when verified during packaging
- Vendored: 2026-10-21
- Included paths: root `SKILL.md`, `meta.json`, `ima_api.cjs`, `knowledge-base/`, `notes/`
- Excluded paths: `.DS_Store`, `.history/`, macOS metadata files
- Credentials: no credentials, tokens, or downloaded user content are included

This repository vendors the official skill without modifying its protocol implementation. Product-specific read-only evidence code lives one directory above and calls the vendored `ima_api.cjs` helper. The IMA Client ID and API Key are loaded from the business runtime's existing `.env` or deployment environment, never from this directory.

The skill documentation and helper remain subject to Tencent IMA's applicable terms and update policy. The runtime records the skill version and exposes `IMA_SKILL_UPDATE_AVAILABLE` if the official helper reports that a newer skill is required.

