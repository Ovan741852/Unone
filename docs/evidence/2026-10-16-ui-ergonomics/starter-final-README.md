# Final SDK untouched starter validation

Passed without changing systems or authoring source.

The public project init created a new starter-final directory. With the supplied UNONE_LUAU_ANALYZER set, normal verify reported 3 passed, 0 failed, 1 not applicable (the scaffold publishes no UI tree), including 2/2 deterministic tests. Public Web preflight returned compatible on its first attempt. Public Web prepare returned ready on its first attempt using web-production-0 and renderer_mode official.

The systems object was identical before and after prepare. Enabled systems are camera2d, input, observation, particle, ui and world. This fits the SDK's minimal official runtime directly. No systems correction or fallback runtime was needed. Prepare automatically added bundle_manifest as part of normal packaging.

No SDK/package implementation source, engine checkout source, Cargo, other agents' files, original probe, original author-evidence or original sdk files were accessed or changed. The generated project's AGENTS.md and project.unone.json were read; generated scripts were not read or edited. The boundary was enforced by instructions, not an OS sandbox.

Evidence:
- commands.json: exact CLI argv, shell commands, environment and complete raw outputs.
- sdk-manifest.json: the final SDK manifest as read.
- init.json, verify.json, preflight.json, prepare.json: raw official CLI responses.
- config-before.json / config-after.json: systems comparison evidence.
- report.json: structured verdict and limitations.

Export: ../starter-final/dist/player/index.html.
Release: releases/24dc037dfd6c9001efe5fbfb9e6f9414757ed8d62699df1ad4dc3a6060b0b6c4/

This bounded run confirms public CLI readiness. It makes no browser appearance or input-delivery claim.

