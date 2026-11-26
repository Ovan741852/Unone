use super::*;
use crate::{DataAssetReceipt, data_assets::deferred::Tick};

impl EngineRuntime {
    pub(super) fn begin_data_tick(
        &self,
        explicit: Option<&[DataAssetReceipt]>,
    ) -> Result<Option<Tick>, Box<Diagnostic>> {
        Tick::begin(&self.data_assets, explicit).map_err(|e| {
            Box::new(Diagnostic::error(
                "INPUT_DATA_ASSETS_INVALID",
                "Deferred data did not match its receipt",
                e,
            ))
        })
    }
    /// Bind the native host's verified content reader. It receives a declared,
    /// content-relative source only when that asset has an active request.
    pub fn set_data_asset_reader(
        &mut self,
        read: impl FnMut(&str) -> Result<Vec<u8>, String> + 'static,
    ) {
        self.data_assets.borrow_mut().reader.0 = Some(Box::new(read));
    }
    pub fn last_data_receipts(&self) -> Option<Vec<DataAssetReceipt>> {
        let store = self.data_assets.borrow();
        (!store.deferred.is_empty()).then(|| store.last_receipts.clone())
    }
    #[cfg(feature = "dev-tools")]
    pub(crate) fn data_receipt_recording_bound(&self) -> usize {
        // A token can complete at most once per tick. Include the longest
        // encoded receipt for each id in the debugger's admission budget.
        let assets = self.data_assets.borrow();
        if assets.deferred.is_empty() {
            return 0;
        }
        assets.decls().filter(|decl| decl.on_demand).map(|decl| {
            let receipt = DataAssetReceipt::Ready {
                id: decl.id.clone(), request: u32::MAX, sha256: "0".repeat(64),
            };
            serde_json::to_vec(&receipt).expect("receipt serializes").len() + 1
        }).sum()
    }
    pub fn data_asset_request_plan(&self, session: u32, after: u32) -> Option<serde_json::Value> {
        let store = self.data_assets.borrow();
        let deferred = &store.deferred;
        (after!=deferred.revision).then(||{
            let requests:Vec<_>=deferred.requests().map(|(request,id)|serde_json::json!({ "id":id, "request":request })).collect();
            serde_json::json!({ "revision":deferred.revision, "session":session, "requests":requests })
        })
    }
    /// The host fills this allocation synchronously before the next Core call.
    pub fn reserve_deferred_bytes(&mut self, request: u32, length: usize) -> Option<*mut u8> {
        self.data_assets
            .borrow_mut()
            .deferred
            .reserve(request, length)
    }
}
