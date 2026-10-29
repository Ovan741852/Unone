use crate::physical_input::*;
#[derive(Debug,Clone,Default)]
pub(crate) struct PhysicalSession {pending:Option<PhysicalBatch>,pub active:Option<PhysicalBatch>,pub receipt:Option<PhysicalReceipt>,last_receive:Option<u64>,terminal:Option<String>,last_attempt:Option<PhysicalBatch>}
impl PhysicalSession {
 pub fn healthy(&self)->Result<(),String>{self.terminal.clone().map_or(Ok(()),Err)}
 pub fn report(&self)->serde_json::Value{serde_json::json!({"receipt":self.receipt,"last_receive":self.last_receive,"terminal":self.terminal,"last_attempt":self.last_attempt})}
 pub fn stage(&mut self,b:Option<PhysicalBatch>)->Result<(),String>{
  if let Some(error)=&self.terminal{return Err(error.clone());}
  if let Some(b)=&b{
   b.validate()?;
   let (epoch,through)=self.receipt.as_ref().map_or((b.epoch,0),|r|(r.epoch,r.through_sequence));
   if b.epoch!=epoch||b.after_sequence!=through {return Err("INPUT_PHYSICAL_CURSOR: epoch/sequence mismatch".into());}
   if b.events.first().is_some_and(|e|self.last_receive.is_some_and(|t|e.common.received_us<t)) {
    return Err("INPUT_PHYSICAL_TIME: received_us decreased".into());
   }
  }
  self.pending=b.map(|b|b.canonical()).transpose()?;Ok(())
 }
 pub fn begin(&mut self){self.active=self.pending.take();self.last_attempt=self.active.clone();}
 pub fn commit(&mut self){if let Some(b)=self.active.take(){
  if let Some(e)=b.events.last(){self.last_receive=Some(e.common.received_us);}
  self.receipt=Some(PhysicalReceipt{profile:PROFILE,epoch:b.epoch,through_sequence:b.through_sequence});
 }}
 pub fn fail(&mut self){if self.active.take().is_some(){self.terminal=Some("INPUT_PHYSICAL_TERMINAL: accepted tick failed; full new load required; partial World is not rolled back".into());}}
}
