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
        self.uploaded=0;self.records.retain(|id,_|batches.contains_key(id));
        self.order=ordered(batches).into_iter().map(|(id,_)|id.clone()).collect();
        for (id,batch) in batches {
            let texture=textures.get(&batch.texture).ok_or_else(||format!("PROJECTED_TEXTURE_MISSING: {}",batch.texture))?.clone();
            if self.records.get(id).is_some_and(|r|r.revision==batch.revision) {continue;}
            let make=|bytes:&[u8],usage|device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label:Some("projected-packed-geometry"),contents:bytes,usage:usage|wgpu::BufferUsages::COPY_DST});
            let mut record=self.records.remove(id).unwrap_or_else(||Record {
                vertices:make(&batch.vertices,wgpu::BufferUsages::VERTEX),indices:make(&batch.indices,wgpu::BufferUsages::INDEX),
                vertex_capacity:batch.vertices.len(),index_capacity:batch.indices.len(),count:0,texture:texture.clone(),revision:0,order:0,pipeline:0,scissor:None,material:self.material(device,batch),material_key:material_key(batch)});
            if record.vertex_capacity<batch.vertices.len() {record.vertices=make(&batch.vertices,wgpu::BufferUsages::VERTEX);record.vertex_capacity=batch.vertices.len();}
            else {queue.write_buffer(&record.vertices,0,&batch.vertices);}
            if record.index_capacity<batch.indices.len() {record.indices=make(&batch.indices,wgpu::BufferUsages::INDEX);record.index_capacity=batch.indices.len();}
            else {queue.write_buffer(&record.indices,0,&batch.indices);}
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
