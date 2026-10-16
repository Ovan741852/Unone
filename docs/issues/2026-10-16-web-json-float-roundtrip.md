# Web publication lost binary64 precision during its JSON envelope pass

## Reproduction and ownership

The Voidwake responsive-layout migration exposed a shared host transport defect.
The native observation retained a computed width of `93.80000000000001`, while
the Web player's published JSON contained `93.8`. Other observed examples were
`45.800000000000004` becoming `45.8` and `38.800000000000004` becoming `38.8`.
These small differences matter to exact replay/output comparisons even when
they are invisible on screen.

An isolated official-package probe published both the numeric values and their
IEEE-754 encodings using `buffer.writef64` and `buffer.readu32`. The native and
WASM VMs produced identical bits for the source literals, arithmetic and
`createResponsiveLayout().resolve().rect()` output. Their canonical digests
also matched before the Web presentation envelope. This rules out the layout
solver and Luau arithmetic as the cause of the reproduced publication defect.

| Encoded JSON number | Original binary64 bits | Bits after the default parser |
| --- | --- | --- |
| `93.80000000000001` | `4057733333333334` | `4057733333333333` |
| `45.800000000000004` | `4046e66666666667` | `4046e66666666666` |
| `38.800000000000004` | `4043666666666667` | `4043666666666666` |

The same one-ULP loss was independently reproduced in a small native Rust
program using the checkout's cached `serde_json 1.0.151` without the
`float_roundtrip` feature. The Web bridge's `write_snapshot` path first creates
and hashes canonical snapshot JSON, then parses it back into `serde_json::Value`
to add instance presentation metadata. Its default parser could change a finite
number during that extra pass, before the final player envelope was emitted.

This is Core canonical-data and host-transport ownership. Game geometry must not
be rounded to conceal it. No UI breakpoint, coordinate unit, overflow tolerance,
responsive package version or gameplay rule changes for this correction.

## Correction

The shared `unone-engine` dependency enables `serde_json`'s `float_roundtrip`
feature alongside `raw_value`. Cargo feature unification carries the same
correct JSON conversion into the CLI, production player and other hosts that
depend on Core, including the standalone player workspace. This also preserves
finite binary64 values when other shared JSON boundaries read them.

The correction preserves the existing JSON format and strict structural
validation. It does not add an absolute rounding floor, accept a percentage
overflow, modify tiny layout bounds, or exclude UI from acceptance comparisons.

## Regression and verification scope

- `json_numeric_roundtrip_preserves_ieee_binary64_values` checks typed and
  portable-value JSON round trips by exact bits. It includes the three observed
  failures, negative values, negative zero, the smallest subnormal, the smallest
  normal and the largest finite double.
- `canonical_observation_json_keeps_runtime_number_bits_and_digest` runs a real
  Luau project, encodes its canonical snapshot and verifies that a JSON consumer
  retains the published number bits and the Core digest contract.
- `web_publication_preserves_binary64_through_instance_envelope` exercises the
  actual Web FFI load/tick/publication path at frames zero and one, in both JSON
  and memory instance modes. It checks exact observation and UI geometry bits,
  full world values and agreement with Core's canonical digest.

Targeted commands are:

```powershell
cargo test -p unone-engine --release --test json_numeric_roundtrip
cargo test -p unone-web-live-smoke --release web_publication_preserves_binary64_through_instance_envelope
```

The final matching native/WASM production runtime and Voidwake acceptance are
recorded with the enclosing game migration. The isolated probe establishes the
specific JSON publication failure; it does not establish that every possible
cross-platform numerical expression is deterministic.

The [fixed reproduction evidence](../evidence/2026-10-16-json-float-roundtrip/manifest.json)
contains raw default-parser output, the isolated native/WASM number-bit probe,
its harness and the relevant runtime manifest. It was captured before the
corrected runtime rebuild.
