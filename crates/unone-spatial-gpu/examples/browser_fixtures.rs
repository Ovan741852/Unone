//! Emits independent geometry fixtures with authoritative CPU reference results.
use unone_engine::spatial::{execute_cpu,SpatialBatch,SpatialBody,SpatialQuery};
use serde_json::json;

fn body(id:u32,position:[f32;3],radius:f32)->SpatialBody {SpatialBody{id,position,radius,category:1,previous_position:None}}
fn nearest(point:[f32;3],max_distance:f32)->SpatialQuery {SpatialQuery::Nearest{point,max_distance,mask:u32::MAX,exclude_id:None}}
fn overlap(center:[f32;3],radius:f32)->SpatialQuery {SpatialQuery::OverlapSphere{center,radius,mask:u32::MAX,exclude_id:None}}
fn sweep(from:[f32;3],to:[f32;3],radius:f32)->SpatialQuery {SpatialQuery::SweepSphere{from,to,radius,mask:u32::MAX,exclude_id:None}}
fn main(){
 let mut moving=body(23,[0.,-5.,0.],0.5);moving.previous_position=Some([0.,5.,0.]);
 let mut category2=body(u32::MAX,[0.;3],0.5);category2.category=2;
 let mut batches=vec![
  ("nearest-sqrt-rounded-tie",SpatialBatch{version:32,bodies:vec![body(1,[1.,0.0003,0.],0.),body(2,[1.,0.,0.],0.)],queries:vec![nearest([0.;3],2.)]}),
  ("filter-tie-contact",SpatialBatch{version:123,bodies:vec![body(42,[2.,0.,0.],1.),body(7,[-2.,0.,0.],1.),moving,category2],queries:vec![nearest([0.;3],2.),SpatialQuery::Nearest{point:[0.;3],max_distance:2.,mask:1,exclude_id:None},SpatialQuery::Nearest{point:[0.;3],max_distance:2.,mask:1,exclude_id:Some(7)},overlap([0.;3],1.),sweep([-8.,0.,0.],[8.,0.,0.],0.5),sweep([0.;3],[0.;3],1.)]}),
  ("empty-bodies",SpatialBatch{version:0,bodies:vec![],queries:vec![nearest([0.;3],3e38),overlap([0.;3],0.),sweep([0.;3],[1.;3],1.)]}),
  ("empty-queries",SpatialBatch{version:5,bodies:vec![body(1,[0.;3],0.)],queries:vec![]}),
  ("sweep-boundaries",SpatialBatch{version:9,bodies:vec![body(1,[0.;3],1.)],queries:vec![sweep([-1e6,0.,0.],[1e6,0.,0.],0.),sweep([-100.,1.,0.],[100.,1.,0.],0.),sweep([-100.,1.01,0.],[100.,1.01,0.],0.),sweep([0.;3],[2.,0.,0.],0.),sweep([2.,0.,0.],[1.,0.,0.],0.)]}),
  ("overlap-64-sorted",SpatialBatch{version:1,bodies:(0..64).rev().map(|i|body(i,[0.;3],1.)).collect(),queries:vec![overlap([0.;3],0.)]}),
  ("overlap-overflow",SpatialBatch{version:1,bodies:(0..65).map(|i|body(i,[0.;3],1.)).collect(),queries:vec![overlap([0.;3],0.)]}),
  ("max-bodies",SpatialBatch{version:8,bodies:(0..65536).map(|i|body(i,[i as f32*10.,1e6,0.],0.)).collect(),queries:vec![nearest([0.,1e6,0.],1e6)]}),
  ("max-queries",SpatialBatch{version:8,bodies:vec![body(3,[0.;3],0.)],queries:vec![nearest([0.;3],0.);1024]}),
 ];
 let mut seed=0x4a71d18bu32;let mut next=||{seed=seed.wrapping_mul(1664525).wrapping_add(1013904223);((seed>>8) as f32/16777216.)*100.-50.};
 let bodies=(0..512).map(|i|{let position=[next(),next(),next()];let mut b=body(1000-i,position,0.25);b.previous_position=Some([position[0]-next()*0.01,position[1],position[2]]);b}).collect();
 let mut queries=vec![];for _ in 0..96 {let p=[next(),next(),next()];queries.extend([nearest(p,150.),overlap(p,8.),sweep(p,[p[0]+20.,p[1]+2.,p[2]],0.5)]);}
 batches.push(("seeded-geometry",SpatialBatch{version:u32::MAX,bodies,queries}));
 let fixtures:Vec<_>=batches.into_iter().map(|(name,batch)|{match execute_cpu(&batch){Ok(expected)=>json!({"name":name,"batch":batch,"expected":expected}),Err(error)=>json!({"name":name,"batch":batch,"error":error})}}).collect();
 println!("{}",serde_json::to_string(&fixtures).unwrap());
}
