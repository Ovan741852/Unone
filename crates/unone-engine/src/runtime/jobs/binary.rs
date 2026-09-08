//! UJB1: 12-byte framing, bounded JSON metadata, opaque payload bytes.
//! No byte array is ever converted into serde_json::Value on this path.
use super::{Jobs, MAX_BYTES, MAX_SOURCE, Reply, Work, err, execute};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, atomic::AtomicBool};

pub(super) const MAX_PACKET: usize = 2 * 1024 * 1024;
const MAX_METADATA: usize = 512 * 1024;

pub(super) fn packet(metadata: &impl Serialize, payload: &[u8]) -> Result<Vec<u8>, String> {
    let metadata = serde_json::to_vec(metadata).map_err(|e| e.to_string())?;
    let len = 12 + metadata.len() + payload.len();
    if metadata.len() > MAX_METADATA || len > MAX_PACKET {
        return Err(err("JOB_BINARY_LIMIT"));
    }
    let mut bytes = Vec::with_capacity(len);
    bytes.extend_from_slice(b"UJB1");
    bytes.extend_from_slice(&(metadata.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&metadata);
    bytes.extend_from_slice(payload);
    Ok(bytes)
}

pub(super) fn split(bytes: &[u8]) -> Result<(&[u8], &[u8]), String> {
    if bytes.len() < 12 || bytes.len() > MAX_PACKET || &bytes[..4] != b"UJB1" {
        return Err(err("JOB_BINARY_HEADER_INVALID"));
    }
    let metadata = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let payload = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
    if metadata > MAX_METADATA
        || metadata > bytes.len() - 12
        || payload != bytes.len() - 12 - metadata
    {
        return Err(err("JOB_BINARY_LENGTH_INVALID"));
    }
    Ok((&bytes[12..12 + metadata], &bytes[12 + metadata..]))
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    Drain {},
    Execute {
        id: String,
        path: String,
        source: String,
    },
    Complete {
        id: String,
        error: Option<String>,
        run_ms: f64,
    },
}

fn decode(bytes: &[u8]) -> Result<(Request, &[u8]), String> {
    let (metadata, payload) = split(bytes)?;
    let request = serde_json::from_slice(metadata)
        .map_err(|e| format!("JOB_BINARY_METADATA_INVALID: {e}"))?;
    Ok((request, payload))
}

pub(super) fn execute_binary(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let (request, input) = decode(bytes)?;
    let Request::Execute { id, path, source } = request else {
        return Err(err("JOB_BINARY_EXECUTE_REQUIRED"));
    };
    if id.len() > 64
        || path.len() > 256
        || source.is_empty()
        || source.len() > MAX_SOURCE
        || input.len() > MAX_BYTES
    {
        return Err(err("JOB_EXECUTE_LIMIT"));
    }
    let reply = execute(Work {
        id,
        path,
        source: source.into(),
        input: input.to_vec(),
        cancelled: Arc::new(AtomicBool::new(false)),
    });
    let (output, error) = match reply.output {
        Ok(output) => (output, None),
        Err(error) => (Vec::new(), Some(error)),
    };
    packet(
        &serde_json::json!({"kind":"complete","id":reply.id,"error":error,"run_ms":reply.run_ms}),
        &output,
    )
}

impl Jobs {
    pub fn binary(&mut self, bytes: &[u8]) -> Result<Vec<u8>, String> {
        self.alive()?;
        let (request, payload) = decode(bytes)?;
        match request {
            Request::Drain {} => {
                if !self.external || self.updating || !payload.is_empty() {
                    return Err(err("JOB_EXTERNAL_EXECUTOR_REQUIRED"));
                }
                let mut data = Vec::new();
                let mut tasks = Vec::new();
                // Serialize before taking the staged work: malformed/oversize
                // packets cannot silently consume a submission.
                for work in self.entries.values().filter_map(|e| e.work.as_ref()) {
                    tasks.push(serde_json::json!({"id":work.id,"source":&*work.source,"path":work.path,"offset":data.len(),"byte_length":work.input.len()}));
                    data.extend_from_slice(&work.input);
                }
                let output = packet(&serde_json::json!({"kind":"tasks","tasks":tasks}), &data)?;
                for entry in self.entries.values_mut() {
                    entry.work.take();
                }
                Ok(output)
            }
            Request::Complete { id, error, run_ms } => {
                if error.is_some() && !payload.is_empty() {
                    return Err(err("JOB_REPLY_INVALID"));
                }
                if payload.len() > MAX_BYTES {
                    return Err(err("JOB_REPLY_INVALID"));
                }
                let output = match error {
                    Some(error) => Err(error),
                    None => Ok(payload.to_vec()),
                };
                self.complete_external(Reply { id, output, run_ms })?;
                packet(&serde_json::json!({"kind":"accepted"}), &[])
            }
            Request::Execute { .. } => Err(err("JOB_BINARY_MANAGER_REQUEST_REQUIRED")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn framing_rejects_truncation_versions_lengths_and_unknown_metadata() {
        let bytes = packet(&serde_json::json!({"kind":"drain"}), &[]).unwrap();
        for end in 0..bytes.len() {
            assert!(split(&bytes[..end]).is_err());
        }
        let mut bad = bytes.clone();
        bad[3] = b'2';
        assert!(split(&bad).is_err());
        let mut bad = bytes.clone();
        bad[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(split(&bad).is_err());
        let mut bad = bytes.clone();
        bad.push(1);
        assert!(split(&bad).is_err());
        let unknown = packet(&serde_json::json!({"kind":"execute","id":"a","source":"return function(b)return b end","path":"test.luau","typo":1}), &[]).unwrap();
        assert!(
            execute_binary(&unknown)
                .unwrap_err()
                .contains("JOB_BINARY_METADATA_INVALID")
        );
    }
    #[test]
    fn binary_executor_preserves_every_byte_and_empty_buffer_and_error() {
        for length in [0, 1, 256, MAX_BYTES] {
            let input: Vec<_> = (0..length).map(|i| i as u8).collect();
            let request = packet(&serde_json::json!({"kind":"execute","id":"a","path":"copy.luau","source":"return function(b)return b end"}), &input).unwrap();
            let response = execute_binary(&request).unwrap();
            let (header, output) = split(&response).unwrap();
            assert_eq!(output, input);
            assert!(
                serde_json::from_slice::<serde_json::Value>(header).unwrap()["error"].is_null()
            );
        }
        let request = packet(&serde_json::json!({"kind":"execute","id":"a","path":"broken.luau","source":"return function(b)error('failure')end"}), &[]).unwrap();
        let response = execute_binary(&request).unwrap();
        let (header, output) = split(&response).unwrap();
        assert!(output.is_empty());
        assert!(std::str::from_utf8(header).unwrap().contains("broken.luau"));
        let request=packet(&serde_json::json!({"kind":"execute","id":"a","path":"unicode.luau","source":"return function(b)error(string.rep('中',2000))end"}),&[]).unwrap();
        let response = execute_binary(&request).unwrap();
        let (header, _) = split(&response).unwrap();
        let header: serde_json::Value = serde_json::from_slice(header).unwrap();
        assert!(header["error"].as_str().unwrap().len() <= 4096);
    }
}
