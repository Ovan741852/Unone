# Workshop priorities after optional Job dispatch

The earlier 8.5/8/6.5/6.5/6.5/7.5/5.5 scores were subjective assessments, not a
benchmark. Adding a worker pool alone does not justify increasing every score.
This pass improves the actual authoring/inspection loop: file-backed jobs,
main-VM prepare/apply closures, deterministic periodic dispatch, bounded Web
workers, AI-readable placement traces, optional presentation interpolation and a
repeated-evidence comparison tool.

| Area | Previous score | Concrete change | Remaining evidence/work |
|---|---:|---|---|
| AI workflow | 8.5 | Same developer API works across async player backends | Automated failure capture and replay minimization |
| Diagnosis | 8 | Job IDs join placement, source, ticks and costs | JS GC and full process allocation remain incomplete |
| Runtime | 6.5 | File-backed periodic jobs and optional parallel execution | Module/package lifecycle and broader game-production coverage |
| Cross-platform | 6.5 | Native/inline/Web job parity checks | Real mobile sustained-load and renderer parity acceptance |
| Assets/release | 6.5 | Job files included and validated in host payload | CDN/cache-version rollout, recovery and streaming |
| Workshop | 7.5 | AI can observe/step/profile the running async player | Persisted experiment plans, dependencies and evidence lineage |
| General engine | 5.5 | Reusable 3D presentation/compute primitives | Complete content workflows, not a Unity-equivalent claim |

Next investment: automate capture -> identify costly source -> propose bounded
change -> compare repeated release runs -> validate replay -> archive evidence.
Favor mechanisms games actually use. Avoid a broad ECS rewrite until a measured
allocation/locality problem warrants it. Memory budgeting for multiple WASM VMs,
reusing compiled isolated kernels, and replacing the Job JSON byte-array transport
are more targeted follow-ups. These are candidates, not measured speedups.
