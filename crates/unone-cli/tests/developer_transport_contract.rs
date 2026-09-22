use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::Path,
    process::{Child, ChildStdin, Command, Stdio},
    sync::mpsc::{self, Receiver},
    time::Duration,
};

struct Connection {
    child: Child,
    input: ChildStdin,
    output: Receiver<String>,
    mcp: bool,
    request_id: u64,
}

impl Connection {
    fn start(project: &Path, mcp: bool) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_game"))
            .arg("--project")
            .arg(project)
            .arg(if mcp { "mcp" } else { "session" })
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let input = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (sender, output) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                if sender.send(line.unwrap()).is_err() {
                    break;
                }
            }
        });
        let mut connection = Self {
            child,
            input,
            output,
            mcp,
            request_id: 1,
        };
        if mcp {
            connection.send(json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
                "protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"developer-test","version":"1"}
            }}));
            assert_eq!(connection.read()["result"]["protocolVersion"], "2025-11-25");
            connection.send(json!({"jsonrpc":"2.0","method":"notifications/initialized"}));
        }
        connection
    }
    fn send(&mut self, value: Value) {
        writeln!(self.input, "{value}").unwrap();
        self.input.flush().unwrap();
    }
    fn read(&self) -> Value {
        let line = self
            .output
            .recv_timeout(Duration::from_secs(20))
            .expect("server response must arrive without EOF or a new input");
        serde_json::from_str(&line).unwrap()
    }
    fn call(&mut self, request: Value) -> Value {
        self.request_id += 1;
        if self.mcp {
            self.send(json!({"jsonrpc":"2.0","id":self.request_id,"method":"tools/call","params":{"name":"unone_session","arguments":request}}));
            let response = self.read();
            assert_eq!(response["id"], self.request_id);
            serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap())
                .unwrap()
        } else {
            self.send(request);
            self.read()
        }
    }
}
impl Drop for Connection {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn exercise(mcp: bool) {
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join("project.unone.json"),
        r#"{"name":"TransportTest","entry_script":"main.luau","main_scene":"scene.json"}"#,
    )
    .unwrap();
    fs::write(
        dir.path().join("scene.json"),
        r#"{"entities":[{"id":"player","name":"Player"}]}"#,
    )
    .unwrap();
    fs::write(
        dir.path().join("main.luau"),
        r#"--!strict
local Game = {}
function Game.start(api: any) end
function Game.update(api: any, dt: number)
    if api.input.isDown("Right") then
        local p = api.entity.getPosition("player")
        api.entity.setPosition("player", { x = p.x + 1, y = p.y })
    end
end
return Game
"#,
    )
    .unwrap();
    let mut connection = Connection::start(dir.path(), mcp);
    let opened = connection.call(json!({"command":"open"}));
    assert_eq!(opened["ok"], true, "{opened}");
    let session = opened["value"]["session"].clone();
    let stepped = connection.call(json!({"command":"step","session":session,"expected_revision":0,"frames":2,"input":{"actions":{"Right":true}}}));
    assert_eq!(
        stepped["value"]["snapshot"]["entities"]["player"]["transform"]["x"], 2.0,
        "{stepped}"
    );
    let edit = json!({"selector":{"kind":"entity","id":"player"},"change":{"op":"set_position","position":{"x":9,"y":0}}});
    let preview = connection.call(json!({"command":"enact","session":session,"expected_revision":2,"dry_run":true,"operations":[edit]}));
    assert_eq!(preview["value"]["revision"], 2);
    let applied = connection.call(
        json!({"command":"enact","session":session,"expected_revision":2,"operations":[edit]}),
    );
    assert_eq!(applied["value"]["revision"], 3);
    let stale = connection.call(json!({"command":"step","session":session,"expected_revision":2}));
    assert_eq!(stale["diagnostics"][0]["code"], "REVISION_CONFLICT");
    let watched = connection.call(json!({"command":"watch","session":session,"after":opened["value"]["cursor"],"selector":{"kind":"entity","id":"player"},"paths":["/transform/x"]}));
    assert_eq!(watched["value"]["current"]["snapshot"]["/transform/x"], 9.0);
    let recording = connection.call(json!({"command":"recording","session":session}));
    let replay = connection.call(json!({"command":"replay","recording":recording["value"]}));
    assert_eq!(replay["value"]["identical"], true, "{replay}");
    let perf = connection.call(json!({"command":"perf","session":session}));
    assert_eq!(perf["value"]["performance"]["frames"], 2);
    let diagnosis = connection.call(json!({"command":"diagnose","session":session,"limit":5}));
    assert_eq!(diagnosis["ok"], true, "{diagnosis}");
    assert_eq!(diagnosis["value"]["capabilities"]["read_only"], true);
    assert_eq!(diagnosis["value"]["execution"]["luau_execution"], "interpreter");
    assert_eq!(diagnosis["value"]["revision"], 3);
    let closed = connection.call(json!({"command":"close","session":session}));
    assert_eq!(closed["value"]["closed"], true);
    let absent = connection.call(json!({"command":"snapshot","session":session}));
    assert_eq!(absent["diagnostics"][0]["code"], "SESSION_REQUIRED");
}

#[test]
fn jsonl_transport_flushes_each_response_and_keeps_the_session_alive() {
    exercise(false);
}

#[test]
fn mcp_transport_preserves_the_same_session_across_tool_calls() {
    exercise(true);
}
