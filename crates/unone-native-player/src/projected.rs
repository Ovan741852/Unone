//! Official clip-space indexed-geometry transport; no game projection formula.
use std::{collections::BTreeMap,sync::Arc};
use unone_engine::ProjectedBatch;
use wgpu::util::DeviceExt;
use sha2::{Digest,Sha256};

struct Record {
    vertices:wgpu::Buffer,indices:wgpu::Buffer,vertex_capacity:usize,index_capacity:usize,
    count:u32,texture:Arc<wgpu::BindGroup>,revision:u64,order:i32,pipeline:usize,
    scissor:Option<unone_engine::ProjectedScissor>,
    material:wgpu::BindGroup,
    material_key:(bool,bool,bool,bool,u32,bool),
}
pub(crate) struct Projected {
    pipelines:[wgpu::RenderPipeline;4],records:BTreeMap<String,Record>,order:Vec<String>,
    material_layout:wgpu::BindGroupLayout,samplers:[wgpu::Sampler;4],
    pub uploaded:u64,pub triangles:u64,pub draws:u64,
}
// Core limits a world's live projected payload to 64 MiB. Keep some upload
// slack for changing geometry, but never retain every batch's historical peak.
const MAX_RETAINED_BYTES:usize=64*1024*1024;
fn retention_budget(active:usize)->usize {active.saturating_mul(2).max(4*1024*1024).min(MAX_RETAINED_BYTES)}
fn needs_compaction(active:usize,retained:usize)->bool {retained>retention_budget(active)}
pub(crate) fn ordered<'a>(batches:&'a BTreeMap<String,ProjectedBatch>)->Vec<(&'a String,&'a ProjectedBatch)> {
    let mut rows:Vec<_>=batches.iter().collect();rows.sort_by(|a,b|a.1.order.cmp(&b.1.order).then_with(||a.0.cmp(b.0)));rows
}
pub(crate) fn rows(batches:&BTreeMap<String,ProjectedBatch>)->Vec<serde_json::Value> {
    ordered(batches).iter().map(|(id,b)|{let mut row=serde_json::json!({"id":id,"kind":"projected","revision":b.revision,
        "texture":b.texture,"format":unone_engine::PROJECTED_FORMAT,"vertices":b.vertices.len()/40,"indices":b.indices.len()/4,
        "vertex_sha256":format!("{:x}",Sha256::digest(&b.vertices)),"index_sha256":format!("{:x}",Sha256::digest(&b.indices)),
        "order":b.order,"depth_test":b.depth_test,"depth_write":b.depth_write,"scissor":b.scissor,
        "color_mode":b.color_mode,"filter":b.filter,"sampling_space":b.sampling_space,"address_mode":b.address_mode,"alpha_cutoff":b.alpha_cutoff});
        if b.alpha_compare!=unone_engine::ProjectedAlphaCompare::GreaterEqual {row["alpha_compare"]=serde_json::json!(b.alpha_compare);}row}).collect()
}
fn material_params(batch:&ProjectedBatch)->[f32;8] {[batch.alpha_cutoff,if batch.color_mode==unone_engine::ProjectedColorMode::Encoded {1.}else{0.},
    if batch.sampling_space==unone_engine::ProjectedSamplingSpace::Encoded && batch.filter==unone_engine::ProjectedFilter::Linear {1.}else{0.},if batch.address_mode==unone_engine::ProjectedAddressMode::Repeat {1.}else{0.},
    if batch.alpha_compare==unone_engine::ProjectedAlphaCompare::Greater {1.}else{0.},0.,0.,0.]}
fn material_key(batch:&ProjectedBatch)->(bool,bool,bool,bool,u32,bool) {(batch.color_mode==unone_engine::ProjectedColorMode::Encoded,batch.filter==unone_engine::ProjectedFilter::Linear,batch.sampling_space==unone_engine::ProjectedSamplingSpace::Encoded,batch.address_mode==unone_engine::ProjectedAddressMode::Repeat,batch.alpha_cutoff.to_bits(),batch.alpha_compare==unone_engine::ProjectedAlphaCompare::Greater)}
impl Projected {
    pub fn retained_bytes(&self)->usize {self.records.values().map(|r|r.vertex_capacity+r.index_capacity).sum()}
    pub fn new(device:&wgpu::Device,format:wgpu::TextureFormat,texture_layout:&wgpu::BindGroupLayout)->Self {
        let shader=device.create_shader_module(wgpu::ShaderModuleDescriptor {label:Some("projected-passthrough"),
            source:wgpu::ShaderSource::Wgsl(include_str!("projected.wgsl").into())});
        let material_layout=device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {label:Some("projected-material-layout"),entries:&[
            wgpu::BindGroupLayoutEntry {binding:0,visibility:wgpu::ShaderStages::FRAGMENT,ty:wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),count:None},
            wgpu::BindGroupLayoutEntry {binding:1,visibility:wgpu::ShaderStages::FRAGMENT,ty:wgpu::BindingType::Buffer {ty:wgpu::BufferBindingType::Uniform,has_dynamic_offset:false,min_binding_size:wgpu::BufferSize::new(32)},count:None},
        ]});
        let samplers=std::array::from_fn(|i|{let filter=if i&1==0 {wgpu::FilterMode::Nearest}else{wgpu::FilterMode::Linear};
            let address=if i&2==0 {wgpu::AddressMode::ClampToEdge}else{wgpu::AddressMode::Repeat};
            device.create_sampler(&wgpu::SamplerDescriptor {label:Some("projected-filter"),mag_filter:filter,min_filter:filter,address_mode_u:address,address_mode_v:address,..Default::default()})});
        let layout=device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {label:Some("projected-layout"),
            bind_group_layouts:&[Some(texture_layout),Some(&material_layout)],immediate_size:0});
        let pipelines=std::array::from_fn(|bits|device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label:Some("projected-clip4-uv2-rgba4"),layout:Some(&layout),
            vertex:wgpu::VertexState {module:&shader,entry_point:Some("vs"),
                buffers:&[Some(wgpu::VertexBufferLayout {array_stride:40,step_mode:wgpu::VertexStepMode::Vertex,
                    attributes:&wgpu::vertex_attr_array![0=>Float32x4,1=>Float32x2,2=>Float32x4]})],compilation_options:Default::default()},
            fragment:Some(wgpu::FragmentState {module:&shader,entry_point:Some("fs"),targets:&[Some(wgpu::ColorTargetState {
                format,blend:None,write_mask:wgpu::ColorWrites::ALL})],compilation_options:Default::default()}),
            primitive:wgpu::PrimitiveState {cull_mode:None,..Default::default()},
            depth_stencil:Some(wgpu::DepthStencilState {format:wgpu::TextureFormat::Depth32Float,
                depth_write_enabled:Some(bits&2!=0),depth_compare:Some(if bits&1!=0 {wgpu::CompareFunction::Less} else {wgpu::CompareFunction::Always}),
                stencil:Default::default(),bias:Default::default()}),
            multisample:Default::default(),multiview_mask:None,cache:None,
        }));
        Self {pipelines,material_layout,samplers,records:BTreeMap::new(),order:Vec::new(),uploaded:0,triangles:0,draws:0}
    }
    fn material(&self,device:&wgpu::Device,batch:&ProjectedBatch)->wgpu::BindGroup {
        let params=device.create_buffer_init(&wgpu::util::BufferInitDescriptor {label:Some("projected-material"),
            contents:bytemuck::cast_slice(&material_params(batch)),usage:wgpu::BufferUsages::UNIFORM});
        let sampler=&self.samplers[usize::from(batch.filter==unone_engine::ProjectedFilter::Linear)|(usize::from(batch.address_mode==unone_engine::ProjectedAddressMode::Repeat)<<1)];
        device.create_bind_group(&wgpu::BindGroupDescriptor {label:Some("projected-material"),layout:&self.material_layout,entries:&[
            wgpu::BindGroupEntry {binding:0,resource:wgpu::BindingResource::Sampler(sampler)},
            wgpu::BindGroupEntry {binding:1,resource:params.as_entire_binding()},
        ]})
    }
    pub fn prepare(&mut self,device:&wgpu::Device,queue:&wgpu::Queue,textures:&BTreeMap<String,Arc<wgpu::BindGroup>>,batches:&BTreeMap<String,ProjectedBatch>)->Result<(),String> {
        self.uploaded=0;
        let ordering_changed=self.records.len()!=batches.len() || batches.iter().any(|(id,b)|self.records.get(id).is_none_or(|r|r.order!=b.order));
        self.records.retain(|id,_|batches.contains_key(id));
        if ordering_changed {
            self.order.clear();self.order.extend(batches.keys().cloned());
            self.order.sort_unstable_by(|a,b|batches[a].order.cmp(&batches[b].order).then_with(||a.cmp(b)));
        }
        let active:usize=batches.values().map(|b|b.vertices.len()+b.indices.len()).sum();
        let retained:usize=batches.iter().map(|(id,b)|self.records.get(id).map_or(b.vertices.len()+b.indices.len(),
            |r|r.vertex_capacity.max(b.vertices.len())+r.index_capacity.max(b.indices.len()))).sum();
        let compact=needs_compaction(active,retained);
        for (id,batch) in batches {
            if self.records.get(id).is_some_and(|r|r.revision==batch.revision
                && (!compact || (r.vertex_capacity==batch.vertices.len() && r.index_capacity==batch.indices.len()))) {continue;}
            let texture=textures.get(&batch.texture).ok_or_else(||format!("PROJECTED_TEXTURE_MISSING: {}",batch.texture))?.clone();
            let make=|bytes:&[u8],usage|device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label:Some("projected-packed-geometry"),contents:bytes,usage:usage|wgpu::BufferUsages::COPY_DST});
            let previous=self.records.remove(id);
            let mut record=if let Some(mut record)=previous {
                if record.vertex_capacity<batch.vertices.len() || (compact && record.vertex_capacity!=batch.vertices.len()) {
                    record.vertices=make(&batch.vertices,wgpu::BufferUsages::VERTEX);record.vertex_capacity=batch.vertices.len();
                } else {queue.write_buffer(&record.vertices,0,&batch.vertices);}
                if record.index_capacity<batch.indices.len() || (compact && record.index_capacity!=batch.indices.len()) {
                    record.indices=make(&batch.indices,wgpu::BufferUsages::INDEX);record.index_capacity=batch.indices.len();
                } else {queue.write_buffer(&record.indices,0,&batch.indices);}
                record
            } else {Record {
                vertices:make(&batch.vertices,wgpu::BufferUsages::VERTEX),indices:make(&batch.indices,wgpu::BufferUsages::INDEX),
                vertex_capacity:batch.vertices.len(),index_capacity:batch.indices.len(),count:0,texture:texture.clone(),revision:0,order:0,pipeline:0,scissor:None,material:self.material(device,batch),material_key:material_key(batch)}};
            self.uploaded+=(batch.vertices.len()+batch.indices.len()) as u64;
            record.count=(batch.indices.len()/4) as u32;record.texture=texture;record.revision=batch.revision;record.order=batch.order;
            record.pipeline=usize::from(batch.depth_test)|usize::from(batch.depth_write)<<1;
            record.scissor=batch.scissor.clone();
            let key=material_key(batch);if key!=record.material_key {record.material=self.material(device,batch);record.material_key=key;}
            self.records.insert(id.clone(),record);
        }Ok(())
    }
    pub fn draw(&mut self,encoder:&mut wgpu::CommandEncoder,view:&wgpu::TextureView,depth:&wgpu::TextureView,clear_depth:bool,width:u32,height:u32) {
        self.draws=0;self.triangles=0;if self.order.is_empty() {return;}
        let mut pass=encoder.begin_render_pass(&wgpu::RenderPassDescriptor {label:Some("projected-passthrough"),
            color_attachments:&[Some(wgpu::RenderPassColorAttachment {view,depth_slice:None,resolve_target:None,
                ops:wgpu::Operations {load:wgpu::LoadOp::Load,store:wgpu::StoreOp::Store}})],
            depth_stencil_attachment:Some(wgpu::RenderPassDepthStencilAttachment {view:depth,
                depth_ops:Some(wgpu::Operations {load:if clear_depth {wgpu::LoadOp::Clear(1.)} else {wgpu::LoadOp::Load},store:wgpu::StoreOp::Store}),stencil_ops:None}),
            timestamp_writes:None,occlusion_query_set:None,multiview_mask:None});
        for id in &self.order {let r=&self.records[id];
            let bounds=match &r.scissor {Some(s)=>s.intersection(width,height),None=>Some([0,0,width,height])};
            let Some([x,y,w,h])=bounds else {continue;};pass.set_scissor_rect(x,y,w,h);
            pass.set_pipeline(&self.pipelines[r.pipeline]);pass.set_bind_group(0,&*r.texture,&[]);
            pass.set_bind_group(1,&r.material,&[]);
            pass.set_vertex_buffer(0,r.vertices.slice(..));pass.set_index_buffer(r.indices.slice(..),wgpu::IndexFormat::Uint32);
            pass.draw_indexed(0..r.count,0,0..1);self.draws+=1;self.triangles+=u64::from(r.count)/3;
        }
    }
}

#[cfg(test)] mod tests {
    use super::*;
    #[test]
    #[ignore="requires a native GPU; run explicitly on a verified host"]
    fn gpu_rotating_batches_compact_and_unchanged_frames_do_not_upload() {
        pollster::block_on(async {
            let adapter=wgpu::Instance::default().request_adapter(&wgpu::RequestAdapterOptions::default()).await.unwrap();
            let (device,queue)=adapter.request_device(&wgpu::DeviceDescriptor::default()).await.unwrap();
            let layout=device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {label:None,entries:&[
                wgpu::BindGroupLayoutEntry {binding:0,visibility:wgpu::ShaderStages::FRAGMENT,
                    ty:wgpu::BindingType::Texture {sample_type:wgpu::TextureSampleType::Float {filterable:true},view_dimension:wgpu::TextureViewDimension::D2,multisampled:false},count:None},
            ]});
            let texture=device.create_texture(&wgpu::TextureDescriptor {label:None,size:wgpu::Extent3d {width:1,height:1,depth_or_array_layers:1},mip_level_count:1,sample_count:1,
                dimension:wgpu::TextureDimension::D2,format:wgpu::TextureFormat::Rgba8Unorm,usage:wgpu::TextureUsages::TEXTURE_BINDING,view_formats:&[]});
            let view=texture.create_view(&Default::default());
            let textures=BTreeMap::from([("t".into(),Arc::new(device.create_bind_group(&wgpu::BindGroupDescriptor {label:None,layout:&layout,
                entries:&[wgpu::BindGroupEntry {binding:0,resource:wgpu::BindingResource::TextureView(&view)}]})))]);
            let packed:Vec<u8>=[0f32,0.,0.5,1.,0.,1.,1.,1.,1.,1.].into_iter().flat_map(f32::to_le_bytes).collect();
            let make=|count,revision| {let mut b=ProjectedBatch::new("t".into(),packed.repeat(count),[0u32,1,2].into_iter().flat_map(u32::to_le_bytes).collect(),0,true,true).unwrap();b.revision=revision;b};
            let small=make(3,1);let mut large=make(100_000,2);
            let mut batches:BTreeMap<String,ProjectedBatch>=(0..32).map(|n|(n.to_string(),small.clone())).collect();
            let mut projected=Projected::new(&device,wgpu::TextureFormat::Rgba8Unorm,&layout);
            let mut peak=0;
            for id in 0..32 {
                if id>0 {let mut b=small.clone();b.revision=id*2+1;batches.insert((id-1).to_string(),b);}
                large.revision=id*2+2;batches.insert(id.to_string(),large.clone());
                projected.prepare(&device,&queue,&textures,&batches).unwrap();
                let active=batches.values().map(|b|b.vertices.len()+b.indices.len()).sum();
                let retained:usize=projected.records.values().map(|r|(r.vertices.size()+r.indices.size()) as usize).sum();
                assert_eq!(retained,projected.retained_bytes());assert!(retained<=retention_budget(active));peak=peak.max(retained);
                projected.prepare(&device,&queue,&textures,&batches).unwrap();assert_eq!(projected.uploaded,0);
                let submission=queue.submit([]);device.poll(wgpu::PollType::Wait {submission_index:Some(submission),timeout:Some(std::time::Duration::from_secs(10))}).unwrap();
            }
            projected.prepare(&device,&queue,&textures,&BTreeMap::new()).unwrap();assert_eq!(projected.retained_bytes(),0);assert!(projected.order.is_empty());
            println!("PROJECTED_BUFFER_STRESS adapter={:?} peak_retained_bytes={peak} final_retained_bytes=0",adapter.get_info());
        });
    }
    #[test] fn rotating_large_batches_cannot_accumulate_historical_peaks() {
        let mut capacities=[132usize;256];
        for large_id in 0..256 {
            let mut requested=[132usize;256];requested[large_id]=16*1024*1024;
            let active=requested.iter().sum();
            let retained=capacities.iter().zip(requested).map(|(old,new)|(*old).max(new)).sum();
            let compact=needs_compaction(active,retained);
            for (old,new) in capacities.iter_mut().zip(requested) {*old=if compact {new}else{(*old).max(new)};}
            assert!(capacities.iter().sum::<usize>()<=retention_budget(active));
        }
        // Keep headroom under ordinary count fluctuations; no shrink/grow loop.
        assert!(!needs_compaction(8*1024*1024,12*1024*1024));
        assert!(needs_compaction(132,16*1024*1024));
        assert_eq!(retention_budget(MAX_RETAINED_BYTES),MAX_RETAINED_BYTES);
    }
    #[test] fn ordering_and_evidence_use_exact_core_payloads() {
        let mut vertices=Vec::new();for _ in 0..3 {for n in [0f32,0.,0.5,1.,0.,1.,1.,1.,1.,1.] {vertices.extend_from_slice(&n.to_le_bytes());}}
        let indices=[0u32,1,2].into_iter().flat_map(u32::to_le_bytes).collect::<Vec<_>>();
        let make=|order|ProjectedBatch::new("t".into(),vertices.clone(),indices.clone(),order,true,true).unwrap();
        let batches=BTreeMap::from([("z".into(),make(0)),("a".into(),make(-1))]);
        assert_eq!(ordered(&batches).iter().map(|(id,_)|id.as_str()).collect::<Vec<_>>(),vec!["a","z"]);
        let evidence=rows(&batches);assert_eq!(evidence[0]["vertices"],3);assert_eq!(evidence[0]["vertex_sha256"],format!("{:x}",Sha256::digest(&vertices)));
        let b=make(0).with_material(unone_engine::ProjectedColorMode::Encoded,unone_engine::ProjectedFilter::Linear,127./255.).unwrap();
        assert_eq!(material_params(&b),[127./255.,1.,0.,0.,0.,0.,0.,0.]);
        assert_eq!(bytemuck::cast_slice::<f32,u8>(&material_params(&b)).len(),32);
        let b=b.with_sampling_space(unone_engine::ProjectedSamplingSpace::Encoded).with_address_mode(unone_engine::ProjectedAddressMode::Repeat);
        assert_eq!(material_params(&b),[127./255.,1.,1.,1.,0.,0.,0.,0.]);
        let old_key=material_key(&b);
        let b=b.with_alpha_compare(unone_engine::ProjectedAlphaCompare::Greater);
        assert_ne!(old_key,material_key(&b));assert_eq!(material_params(&b),[127./255.,1.,1.,1.,1.,0.,0.,0.]);
        assert_eq!(rows(&BTreeMap::from([("strict".into(),b)]))[0]["alpha_compare"],"greater");
    }
}
