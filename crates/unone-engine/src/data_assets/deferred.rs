use std::{cell::RefCell, collections::{BTreeMap, BTreeSet}, rc::Rc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// The receipt is input. Downloading or copying bytes alone cannot change game state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(tag="state",rename_all="lowercase",deny_unknown_fields)]
pub enum DataAssetReceipt {
    Ready { id: String, request: u32, sha256: String },
    Failed { id: String, request: u32 },
}

impl DataAssetReceipt {
    fn key(&self) -> (&str,u32) {
        match self {
            Self::Ready{id,request,..} | Self::Failed{id,request} => (id,*request)
        }
    }
    pub(crate) fn validate(rows: &[Self]) -> Result<(), String> {
        let mut ids = BTreeSet::new();
        let mut requests = BTreeSet::new();
        for row in rows {
            let (id, request) = row.key();
            if id.is_empty() || request == 0 || !ids.insert(id) || !requests.insert(request) {
                return Err("Each deferred receipt needs a distinct id and a distinct nonzero request".into());
            }
            if let Self::Ready{sha256,..} = row {
                if sha256.len()!=64 || !sha256.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
                    return Err("A ready receipt needs 64 lowercase SHA-256 digits".into());
                }
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
enum State {
    Idle,
    Loading(u32),
    Ready { bytes: Option<Rc<Vec<u8>>>, decoded: Option<(Rc<()>,mlua::Buffer)> },
    Failed,
}

/// Transaction snapshots share unchanged rows and immutable byte storage. A
/// staged allocation belongs to exactly one request and is never game-visible.
#[derive(Clone, Debug)]
pub(crate) struct DeferredAssets {
    rows: Rc<BTreeMap<String,State>>,
    pending: Rc<BTreeMap<u32,String>>,
    staged: Rc<BTreeMap<u32,Rc<Vec<u8>>>>,
    next: u32,
    pub(crate) revision: u32,
}
impl Default for DeferredAssets {
    fn default() -> Self {
        Self { rows: Default::default(), pending: Default::default(), staged: Default::default(), next:0, revision:1 }
    }
}

impl DeferredAssets {
    pub(crate) fn declare(&mut self, id: &str) {
        Rc::make_mut(&mut self.rows).insert(id.to_owned(),State::Idle);
    }
    pub(crate) fn is_empty(&self) -> bool { self.rows.is_empty() }
    fn row(&self, id:&str) -> Result<&State,String> {
        self.rows.get(id).ok_or_else(|| format!("ASSET_NOT_DEFERRED: '{id}' is not a declared on-demand data asset"))
    }
    pub(crate) fn status(&self, id:&str) -> Result<&'static str,String> {
        Ok(match self.row(id)? {State::Idle=>"idle",State::Loading(_)=>"loading",State::Ready{..}=>"ready",State::Failed=>"failed"})
    }
    fn change(&mut self) -> Result<(),String> {
        self.revision=self.revision.checked_add(1).ok_or("DEFERRED_DATA_REVISION_EXHAUSTED")?;
        Ok(())
    }
    pub(crate) fn request(&mut self, id:&str) -> Result<(),String> {
        if matches!(self.row(id)?,State::Idle|State::Failed) {
            let token=self.next.checked_add(1).ok_or("DEFERRED_DATA_REQUEST_EXHAUSTED")?;
            self.change()?;
            self.next=token;
            Rc::make_mut(&mut self.rows).insert(id.into(),State::Loading(token));
            Rc::make_mut(&mut self.pending).insert(token,id.into());
        }
        Ok(())
    }
    pub(crate) fn release(&mut self, id:&str) -> Result<(),String> {
        let token=match self.row(id)? {State::Idle=>return Ok(()),State::Loading(token)=>Some(*token),_=>None};
        if let Some(token)=token {
            self.change()?;
            Rc::make_mut(&mut self.pending).remove(&token);
            Rc::make_mut(&mut self.staged).remove(&token);
        }
        Rc::make_mut(&mut self.rows).insert(id.into(),State::Idle);
        Ok(())
    }
    pub(crate) fn requests(&self) -> impl Iterator<Item=(u32,&str)> {
        self.pending.iter().map(|(token,id)|(*token,id.as_str()))
    }
    pub(crate) fn reserve(&mut self, token:u32, length:usize) -> Option<*mut u8> {
        if !self.pending.contains_key(&token) || length > (1<<30) { return None; }
        let mut bytes=Vec::new();
        bytes.try_reserve_exact(length).ok()?;
        bytes.resize(length,0);
        let pointer=bytes.as_mut_ptr();
        Rc::make_mut(&mut self.staged).insert(token,Rc::new(bytes));
        Some(pointer)
    }
    pub(crate) fn load(&mut self, vm:&Rc<()>, id:&str, decode:impl FnOnce(&[u8])->mlua::Result<mlua::Buffer>) -> mlua::Result<mlua::Buffer> {
        let Some(State::Ready{decoded,bytes})=Rc::make_mut(&mut self.rows).get_mut(id) else {
            return Err(mlua::Error::RuntimeError(format!("ASSET_DATA_NOT_READY: '{id}' needs a ready receipt before load")));
        };
        if let Some((owner,buffer))=decoded && Rc::ptr_eq(owner,vm) {return Ok(buffer.clone())}
        let raw=bytes.as_ref().ok_or_else(|| mlua::Error::RuntimeError("ASSET_DATA_RELEASED".into()))?;
        let buffer=decode(raw.as_slice())?;
        *decoded=Some((Rc::clone(vm),buffer.clone()));
        if !cfg!(feature="preview-tools") {*bytes=None;}
        Ok(buffer)
    }
}

type Reader = Box<dyn FnMut(&str) -> Result<Vec<u8>,String>>;
/// Host-owned read policy. The in-memory/WASM runtime has no implicit filesystem reader.
#[derive(Default)]
pub(crate) struct DataReader(pub(crate) Option<Reader>);
impl std::fmt::Debug for DataReader {
    fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result {f.debug_tuple("DataReader").field(&self.0.is_some()).finish()}
}

impl super::DataAssets {
    /// Admit the entire receipt set atomically. Explicit empty receipts suppress
    /// native completion, so a replay observes the same loading frames as Web.
    fn admit(&mut self, explicit: Option<&[DataAssetReceipt]>) -> Result<Vec<DataAssetReceipt>,String> {
        let mut receipts=Vec::new();
        let mut changes=Vec::new();
        let load=|this:&mut Self,id:&str,request:u32| -> Option<Rc<Vec<u8>>> {
            if let Some(bytes)=this.deferred.staged.get(&request) {return Some(bytes.clone());}
            let path=&this.decls.get(id)?.source;
            this.reader.0.as_mut()?(path).ok().map(Rc::new)
        };
        if let Some(rows)=explicit {
            for row in rows {
                let (id,request)=row.key();
                if self.deferred.pending.get(&request).map(String::as_str)!=Some(id) {
                    return Err(format!("DEFERRED_DATA_REQUEST_MISMATCH: '{id}' request {request} is not active"));
                }
                let bytes=if let DataAssetReceipt::Ready{sha256,..}=row {
                    let bytes=load(self,id,request).ok_or_else(||format!("DEFERRED_DATA_BYTES_MISSING: '{id}'"))?;
                    if format!("{:x}",Sha256::digest(bytes.as_slice()))!=*sha256 {return Err(format!("DEFERRED_DATA_HASH_MISMATCH: '{id}'"));}
                    Some(bytes)
                } else {None};
                changes.push((id.to_owned(),request,bytes));
            }
            receipts.extend_from_slice(rows);
        } else if self.reader.0.is_some() {
            let pending=Rc::clone(&self.deferred.pending);
            for (&request,id) in pending.iter() {
                let bytes=load(self,id,request);
                receipts.push(match &bytes {
                    Some(raw)=>DataAssetReceipt::Ready{id:id.clone(),request,sha256:format!("{:x}",Sha256::digest(raw.as_slice()))},
                    None=>DataAssetReceipt::Failed{id:id.clone(),request},
                });
                changes.push((id.clone(),request,bytes));
            }
        }
        if !changes.is_empty() {self.deferred.change()?;}
        for (id,request,bytes) in changes {
            let state=match bytes {Some(bytes)=>State::Ready{bytes:Some(bytes),decoded:None},None=>State::Failed};
            Rc::make_mut(&mut self.deferred.rows).insert(id,state);
            Rc::make_mut(&mut self.deferred.pending).remove(&request);
            Rc::make_mut(&mut self.deferred.staged).remove(&request);
        }
        Ok(receipts)
    }
}

pub(crate) struct Tick {
    store: Rc<RefCell<super::DataAssets>>,
    before: Option<DeferredAssets>,
    receipts: Vec<DataAssetReceipt>,
}
impl Tick {
    pub(crate) fn begin(store:&Rc<RefCell<super::DataAssets>>, explicit:Option<&[DataAssetReceipt]>)->Result<Option<Self>,String>{
        if store.borrow().deferred.is_empty() && explicit.is_none_or(<[DataAssetReceipt]>::is_empty) {return Ok(None);}
        let before=store.borrow().deferred.clone();
        let receipts=store.borrow_mut().admit(explicit)?;
        Ok(Some(Self{store:store.clone(),before:Some(before),receipts}))
    }
    pub(crate) fn commit(mut self) {
        self.before.take();
        self.store.borrow_mut().last_receipts=std::mem::take(&mut self.receipts);
    }
}
impl Drop for Tick {
    fn drop(&mut self) {
        if let Some(before)=self.before.take() {self.store.borrow_mut().deferred=before;}
    }
}
