//! Loopback companion panel for the actual native runtime. No second game VM.
use serde_json::{Value, json};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};
use unone_engine::{EngineRuntime, InputFrame, PreviewRequest, WorldSnapshot};

pub struct Pending {
    request: Value,
    reply: mpsc::SyncSender<Value>,
    deadline: Instant,
}
pub struct NativeTools {
    pending: mpsc::Receiver<Pending>,
    running: Arc<AtomicBool>,
    pub state: State,
}
impl Drop for NativeTools {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
    }
}
impl NativeTools {
    pub fn start(port: u16, proxy: winit::event_loop::EventLoopProxy<()>) -> anyhow::Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", port))?;
        listener.set_nonblocking(true)?;
        let address = listener.local_addr()?;
        let origin = format!("http://{address}");
        eprintln!("Unone native tools: {origin}/ (the panel controls this native process)");
        let (tx, pending) = mpsc::sync_channel::<Pending>(16);
        let running = Arc::new(AtomicBool::new(true));
        let alive = Arc::clone(&running);
        std::thread::spawn(move || {
            while alive.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((mut socket, _)) => {
                        let _ = serve(&mut socket, &origin, &tx, &proxy);
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(5))
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(Self {
            pending,
            running,
            state: State::default(),
        })
    }
    pub fn drain(
        &mut self,
        runtime: &mut EngineRuntime,
        mut capture: impl FnMut(
            &WorldSnapshot,
            crate::native_capture::CaptureRequest,
        ) -> Result<Value, String>,
    ) {
        for _ in 0..16 {
            let Ok(pending) = self.pending.try_recv() else {
                break;
            };
            let result = if Instant::now() > pending.deadline {
                failure("REQUEST_EXPIRED", "Native request expired before execution")
            } else if pending.request["method"] == "screenshot" {
                match serde_json::from_value::<crate::native_capture::CaptureRequest>(
                    pending.request,
                )
                .map_err(|e| e.to_string())
                .and_then(|request| capture(&runtime.observe(), request))
                {
                    Ok(value) => json!({"ok":true,"value":value,"diagnostics":[],"effects":[]}),
                    Err(message) => failure("CAPTURE_FAILED", &message),
                }
            } else {
                self.state.request(runtime, pending.request)
            };
            let _ = pending.reply.send(result);
        }
    }
}
fn respond(socket: &mut TcpStream, status: &str, mime: &str, body: &[u8]) -> std::io::Result<()> {
    write!(
        socket,
        "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n\r\n",
        body.len()
    )?;
    socket.write_all(body)
}
fn serve(
    socket: &mut TcpStream,
    origin: &str,
    tx: &mpsc::SyncSender<Pending>,
    proxy: &winit::event_loop::EventLoopProxy<()>,
) -> std::io::Result<()> {
    // Windows accepted sockets inherit the listener's nonblocking mode.
    socket.set_nonblocking(false)?;
    socket.set_read_timeout(Some(Duration::from_secs(3)))?;
    socket.set_write_timeout(Some(Duration::from_secs(3)))?;
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 4096];
    let split = loop {
        if bytes.len() > 16384 {
            return respond(
                socket,
                "413 Payload Too Large",
                "text/plain",
                b"Header limit",
            );
        }
        let n = socket.read(&mut chunk)?;
        if n == 0 {
            return Ok(());
        }
        bytes.extend_from_slice(&chunk[..n]);
        if let Some(pos) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
            break pos + 4;
        }
    };
    let header = String::from_utf8_lossy(&bytes[..split]).to_string();
    let mut lines = header.lines();
    let request = lines.next().unwrap_or("");
    let mut parts = request.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("");
    let headers: std::collections::BTreeMap<_, _> = lines
        .filter_map(|line| {
            line.split_once(':')
                .map(|(k, v)| (k.to_ascii_lowercase(), v.trim().to_string()))
        })
        .collect();
    if headers.get("host").map(String::as_str) != Some(origin.trim_start_matches("http://"))
        || headers.get("origin").is_some_and(|v| v != origin)
    {
        return respond(
            socket,
            "403 Forbidden",
            "text/plain",
            b"Loopback same-origin access only",
        );
    }
    if method == "GET" {
        let file: Option<(&str, &[u8])> = match path {
            "/" => Some((
                "text/html; charset=utf-8",
                include_bytes!("../../../web/developer/native.html"),
            )),
            "/native.js" => Some((
                "text/javascript",
                include_bytes!("../../../web/developer/native.js"),
            )),
            "/api.js" => Some((
                "text/javascript",
                include_bytes!("../../../web/developer/api.js"),
            )),
            "/panel.js" => Some((
                "text/javascript",
                include_bytes!("../../../web/developer/panel.js"),
            )),
            "/panel.css" => Some((
                "text/css",
                include_bytes!("../../../web/developer/panel.css"),
            )),
            _ => None,
        };
        return match file {
            Some((mime, data)) => respond(socket, "200 OK", mime, data),
            None => respond(socket, "404 Not Found", "text/plain", b"Not found"),
        };
    }
    if method != "POST"
        || path != "/request"
        || !headers
            .get("content-type")
            .is_some_and(|v| v.starts_with("application/json"))
        || headers.contains_key("transfer-encoding")
    {
        return respond(
            socket,
            "400 Bad Request",
            "text/plain",
            b"POST /request with JSON required",
        );
    }
    let length = headers
        .get("content-length")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    if length == 0 || length > 65536 {
        return respond(
            socket,
            "413 Payload Too Large",
            "text/plain",
            b"JSON body must be 1..65536 bytes",
        );
    }
    while bytes.len() < split + length {
        let n = socket.read(&mut chunk)?;
        if n == 0 {
            return Ok(());
        }
        bytes.extend_from_slice(&chunk[..n]);
    }
    let request = match serde_json::from_slice(&bytes[split..split + length]) {
        Ok(v) => v,
        Err(_) => return respond(socket, "400 Bad Request", "text/plain", b"Invalid JSON"),
    };
    let (reply, result) = mpsc::sync_channel(1);
    let deadline = Instant::now() + Duration::from_secs(3);
    if tx
        .try_send(Pending {
            request,
            reply,
            deadline,
        })
        .is_err()
    {
        return respond(
            socket,
            "503 Service Unavailable",
            "text/plain",
            b"Command queue full",
        );
    }
    let _ = proxy.send_event(());
    let result = result
        .recv_timeout(Duration::from_secs(4))
        .unwrap_or_else(|_| failure("NATIVE_UNAVAILABLE", "Native event loop is not responding"));
    respond(
        socket,
        "200 OK",
        "application/json",
        &serde_json::to_vec(&result).unwrap(),
    )
}
fn failure(code: &str, explanation: &str) -> Value {
    json!({"ok":false,"value":null,"diagnostics":[{"code":code,"explanation":explanation}],"effects":[]})
}

#[derive(Default)]
pub struct State {
    pub dropped_steps: u64,
    pub paused: bool,
    pending_input: Option<InputFrame>,
    clear_input: bool,
    pub render_ms: Option<f64>,
    journal: Vec<Value>,
    sequence: u64,
}
impl State {
    pub fn tick(
        &mut self,
        runtime: &mut EngineRuntime,
    ) -> Result<WorldSnapshot, Box<unone_engine::Diagnostic>> {
        if let Some(frame) = self.pending_input.take() {
            self.clear_input = true;
            runtime.tick_with_input(&frame)
        } else if self.clear_input {
            self.clear_input = false;
            runtime.tick_with_input(&InputFrame::default())
        } else {
            runtime.tick()
        }
    }
    pub fn request(&mut self, runtime: &mut EngineRuntime, request: Value) -> Value {
        let method = request["method"].as_str().unwrap_or("");
        let allowed = match method {
            "profile.start" => vec!["method", "sampling"],
            "tools.invoke" => vec!["method", "id", "revision", "value"],
            "pause" => vec!["method", "paused"],
            "step" => vec!["method", "count"],
            "input" => vec!["method", "frame"],
            "bloom" => vec!["method", "enabled"],
            "memory.sample" => vec!["method", "label", "collect", "warmup"],
            "memory.report" | "memory.reset" => vec!["method"],
            "profile.stop" | "describe" | "snapshot" | "observations" | "hierarchy" | "console"
            | "network" | "jobs" | "profile" | "memory" | "tools.list" | "journal" => vec!["method"],
            _ => return failure("DEVELOPER_REQUEST_INVALID", "Unknown method; use describe"),
        };
        if !request
            .as_object()
            .is_some_and(|v| v.keys().all(|k| allowed.contains(&k.as_str())))
        {
            return failure("DEVELOPER_REQUEST_INVALID", "Unknown field");
        }
        let mutating = matches!(
            method,
            "profile.start" | "profile.stop" | "pause" | "step" | "input" | "tools.invoke" | "memory.sample" | "memory.reset"
        );
        let result = (|| -> anyhow::Result<Value> {
            let mut snapshot = || {
                runtime
                    .preview_request(PreviewRequest::Snapshot {})
                    .map_err(|e| anyhow::anyhow!("{}: {}", e.code, e.explanation))
            };
            Ok(match method {
                "describe" => {
                    json!({"version":1,"host":"native","methods":["jobs","profile.start","profile.stop","memory.sample","memory.report","memory.reset","screenshot","describe","snapshot","observations","hierarchy","console","network","profile","memory","tools.list","tools.invoke","pause","step","input","journal"],"unavailable":["instances.transport","bloom","js_heap","wasm_linear_memory","browser_network"],"semantics":"Same native runtime, between-tick commands. Lua callbacks are not transactional."})
                }
                "jobs" => json!({"runtime":runtime.jobs_report(),"host":{"backend":"native"},"note":"Timing does not affect next-tick delivery; source paths and job IDs join runtime traces."}),
                "snapshot" => snapshot()?,
                "observations" => {
                    let s = runtime.observe();
                    json!({"frame":s.frame,"observations":s.observations,"host":"native","paused":self.paused})
                }
                "tools.list" => runtime
                    .preview_request(PreviewRequest::Tools {})
                    .map_err(|e| anyhow::anyhow!(e.explanation))?["tools"]
                    .clone(),
                "hierarchy" => {
                    let s = runtime.observe();
                    json!({"entities":s.entities,"ui":s.ui,"note":"Flat runtime entity roots"})
                }
                "console" => json!({"game":snapshot()?["logs"],"browser":[],"retention":200}),
                "network" => {
                    json!({"resources":[],"note":"Browser ResourceTiming is not available in the native host."})
                }
                "profile" | "profile.start" | "profile.stop" => {
                    let command = match method {
                        "profile.start" => PreviewRequest::ProfileStart {
                            sampling: match request.get("sampling") {
                                None => false,
                                Some(v) => v
                                    .as_bool()
                                    .ok_or_else(|| anyhow::anyhow!("sampling must be boolean"))?,
                            },
                        },
                        "profile.stop" => PreviewRequest::ProfileStop {},
                        _ => PreviewRequest::Profile {},
                    };
                    let data = runtime
                        .preview_request(command)
                        .map_err(|e| anyhow::anyhow!("{}: {}", e.code, e.explanation))?;
                    json!({"host":"native","frame":data["counts_frame"],"runtime":data["performance"],"window":data["window"],"build":data["build"],"jobs":data["jobs"],"host_window":null,"publication":null,"renderer":{"render_ms":self.render_ms,"dropped_steps":self.dropped_steps},"paused":self.paused})
                }
                "memory" => {
                    json!({"host":"native","luau_used_bytes":runtime.preview_request(PreviewRequest::Profile {}).map_err(|e|anyhow::anyhow!(e.explanation))?["performance"]["luau_memory_bytes"],"wasm_linear_bytes":null,"js_heap":null,"note":"Native process RSS and GPU allocations are not currently instrumented; no browser memory is reported as native memory."})
                }
                "memory.sample" | "memory.report" | "memory.reset" => {
                    let mut value = request.clone();
                    value["method"] = json!(method.replace('.', "_"));
                    runtime.preview_request(serde_json::from_value(value)?).map_err(|e|anyhow::anyhow!(e.explanation))?
                }
                "journal" => json!({"events":self.journal}),
                "pause" => {
                    self.paused = request["paused"]
                        .as_bool()
                        .ok_or_else(|| anyhow::anyhow!("paused must be boolean"))?;
                    self.pending_input = None;
                    self.clear_input = true;
                    json!({"paused":self.paused})
                }
                "input" => {
                    let input: InputFrame = serde_json::from_value(request["frame"].clone())?;
                    input
                        .validate()
                        .map_err(|e| anyhow::anyhow!(e.explanation))?;
                    self.pending_input = Some(input);
                    json!({"queued":true})
                }
                "step" => {
                    anyhow::ensure!(self.paused, "PAUSE_REQUIRED: pause before stepping");
                    let count = if request.get("count").is_some() {
                        request["count"]
                            .as_u64()
                            .ok_or_else(|| anyhow::anyhow!("count must be an integer"))?
                    } else {
                        1
                    };
                    anyhow::ensure!((1..=120).contains(&count), "count must be 1..120");
                    for _ in 0..count {
                        self.tick(runtime)
                            .map_err(|e| anyhow::anyhow!(e.explanation))?;
                    }
                    runtime
                        .preview_request(PreviewRequest::Snapshot {})
                        .map_err(|e| anyhow::anyhow!(e.explanation))?["observation"]
                        .clone()
                }
                "tools.invoke" => {
                    let mut value = request.clone();
                    value["method"] = json!("invoke");
                    runtime
                        .preview_request(serde_json::from_value(value)?)
                        .map_err(|e| anyhow::anyhow!(e.explanation))?
                }
                "bloom" => {
                    anyhow::bail!("CAPABILITY_UNAVAILABLE: native preview has no Bloom renderer")
                }
                _ => unreachable!(),
            })
        })();
        let result = match result {
            Ok(value) => {
                json!({"ok":true,"value":value,"diagnostics":[],"effects":if mutating {vec![json!({"kind":"developer_operation","method":method})]}else{vec![]}})
            }
            Err(error) => {
                let mut result = failure("DEVELOPER_REQUEST_FAILED", &error.to_string());
                if mutating {
                    result["effects"] = json!([{"kind":"inspect_state_before_retry","reason":"A started operation may have partially changed game state"}]);
                }
                result
            }
        };
        if mutating || result["ok"] == false {
            self.sequence += 1;
            self.journal.push(json!({"sequence":self.sequence,"frame":runtime.observe().frame,"request":request,"ok":result["ok"],"diagnostics":result["diagnostics"]}));
            if self.journal.len() > 200 {
                self.journal.remove(0);
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn native_profile_windows_are_discoverable_and_do_not_tick() {
        let mut runtime = unone_engine::EngineRuntime::load_source(
            "profile",
            "main.luau",
            "return {start=function()end,update=function()end}",
            None,
        )
        .unwrap();
        let mut state = State::default();
        let description = state.request(&mut runtime, json!({"method":"describe"}));
        assert!(
            description["value"]["methods"]
                .as_array()
                .unwrap()
                .iter()
                .any(|m| m == "profile.start")
        );
        assert_eq!(
            state.request(
                &mut runtime,
                json!({"method":"profile.start","sampling":"yes"})
            )["ok"],
            false
        );
        assert_eq!(
            state.request(
                &mut runtime,
                json!({"method":"profile.start","sampling":false})
            )["ok"],
            true
        );
        assert_eq!(runtime.observe().frame, 0);
        runtime.tick().unwrap();
        let result = state.request(&mut runtime, json!({"method":"profile.stop"}));
        assert_eq!(result["ok"], true);
        assert_eq!(result["value"]["runtime"]["frames"], 1);
        assert_eq!(result["value"]["window"]["active"], false);
        assert!(result["value"].get("observation").is_none());
    }
    use super::*;
    #[test]
    fn native_panel_api_invokes_the_same_lua_registry_and_steps_exactly() {
        let source = include_str!("../../../tests/host-parity-project/main.luau");
        let project: Value = serde_json::from_str(include_str!(
            "../../../tests/host-parity-project/project.unone.json"
        ))
        .unwrap();
        let scene: Value = serde_json::from_str(include_str!(
            "../../../tests/host-parity-project/scene.json"
        ))
        .unwrap();
        let payload = json!({"config":project,"script":source,"scene":scene});
        let mut runtime = unone_engine::HostProject::parse(&serde_json::to_vec(&payload).unwrap())
            .unwrap()
            .into_runtime(42)
            .unwrap();
        let mut state = State::default();
        let tools = state.request(&mut runtime, json!({"method":"tools.list"}));
        let revision = tools["value"]["revision"].as_u64().unwrap();
        let result = state.request(
            &mut runtime,
            json!({"method":"tools.invoke","id":"fixture.bump","revision":revision}),
        );
        assert_eq!(result["ok"], true);
        assert_eq!(runtime.observe().observations["debug_bump"], 1);
        assert_eq!(runtime.observe().frame, 0);
        assert_eq!(
            state.request(&mut runtime, json!({"method":"step"}))["ok"],
            false
        );
        assert_eq!(
            state.request(&mut runtime, json!({"method":"pause","paused":true}))["ok"],
            true
        );
        assert_eq!(
            state.request(
                &mut runtime,
                json!({"method":"input","frame":{"actions":{"Drive":true}}})
            )["ok"],
            true
        );
        assert_eq!(
            state.request(&mut runtime, json!({"method":"step","count":3}))["ok"],
            true
        );
        assert_eq!(runtime.observe().frame, 3);
        assert_eq!(
            runtime.observe().entities["car"]
                .transform3d
                .as_ref()
                .unwrap()
                .position
                .z,
            1.0
        );
        assert_eq!(
            state.request(&mut runtime, json!({"method":"memory"}))["value"]["wasm_linear_bytes"],
            Value::Null
        );
        let sample = state.request(&mut runtime, json!({"method":"memory.sample","label":"idle"}));
        assert_eq!(sample["ok"],true);
        assert_eq!(sample["value"]["samples"][0]["collected"],false);
        assert_eq!(state.request(&mut runtime,json!({"method":"memory.sample","label":"idle","collect":"yes"}))["ok"],false);
        assert_eq!(state.request(&mut runtime,json!({"method":"memory.reset"}))["value"]["samples"],json!([]));
        assert_eq!(
            state.request(
                &mut runtime,
                json!({"method":"pause","paused":false,"typo":1})
            )["ok"],
            false
        );
    }
}
