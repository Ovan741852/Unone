# Issue: Web asset loads raced the shared bundle verifier

## Symptom

Generic Web runner loaded the packaged project but intermittently reported BUNDLE_VERIFY_FAILED with bundle verifier has not started. The failure appeared after three asset elements began resolving from the same content bundle.

## Facts

- The Web C ABI exposes one verifier transaction state per Wasm module.
- renderAssets intentionally starts independent asset URL loads concurrently.
- Every readActiveAsset verifies the same content bundle before slicing one archive entry.

## Classification

Architecture/host boundary. A shared mutable verifier cannot be used concurrently by a host loader.

## Fix and regression

web/live/bundle-store.js now serializes complete begin/write/finish transactions with a host-side promise tail. It preserves concurrent asset API calls while protecting the engine ABI. Angry Birds Web packaged smoke now reaches a running frame with all three assets resolved; the failure diagnostic also includes the bundle id.
