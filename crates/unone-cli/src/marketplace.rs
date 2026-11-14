//! Marketplace search for `game find`: the Koncrate catalogue through the
//! Koncrate Viewer's local development endpoint. The Viewer holds the user's
//! sign-in and talks to the store; Unone never sees a token, sends only the
//! search text, and only to 127.0.0.1. Search only, never install or buy.
//!
//! Protocol (Koncrate-Editor docs/plugin-upload.md): describe `host.scout` for
//! the outer contract hash, describe `plugins.search` through it for the inner
//! hash, then call `plugins.search`; check the outer and the inner envelope.
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::time::Duration;

use serde_json::{Value, json};

#[derive(Debug)]
pub enum Search {
    Found { results: Vec<Value>, endpoint: String },
    /// `status` is not_connected, auth_required, unavailable or error.
    Failed { status: &'static str, detail: String },
}

fn failed(status: &'static str, detail: impl Into<String>) -> Search {
    Search::Failed { status, detail: detail.into() }
}

/// Search the catalogue for Unone plugins matching `query`.
pub fn search(endpoint_file: Option<&Path>, query: &str, limit: usize) -> Search {
    let Some(file) = endpoint_file else {
        return failed("not_connected", "No Koncrate Viewer endpoint is configured: APPDATA and UNONE_KONCRATE_ENDPOINT are unset.");
    };
    let Ok(text) = std::fs::read_to_string(file) else {
        return failed(
            "not_connected",
            format!("No Koncrate Viewer development endpoint at {}. Start the Viewer with --development-tools and sign in.", file.display()),
        );
    };
    let port = match port_of(&text) {
        Ok(port) => port,
        Err(error) => return failed("error", error),
    };
    match run(port, query, limit) {
        Ok(results) => Search::Found { results, endpoint: format!("127.0.0.1:{port}") },
        Err(failure) => failure,
    }
}

/// The port of a development-tools.json `url`. Loopback only: a file that
/// points elsewhere must not receive the search text.
fn port_of(text: &str) -> Result<u16, String> {
    let value: Value = serde_json::from_str(text).map_err(|error| format!("development-tools.json is not JSON: {error}"))?;
    let url = value["url"].as_str().ok_or("development-tools.json has no url")?;
    let port = url.strip_prefix("http://127.0.0.1:").ok_or_else(|| format!("refusing a non-loopback Koncrate endpoint: {url}"))?;
    port.trim_end_matches('/').parse().map_err(|_| format!("the Koncrate endpoint {url} has no port"))
}

fn run(port: u16, query: &str, limit: usize) -> Result<Vec<Value>, Search> {
    let outer = post(port, &json!({"action": "describe", "operation": "host.scout"}))?;
    let outer_hash = outer["value"]["contractHash"]
        .as_str()
        .ok_or_else(|| failed("error", "host.scout describe returned no contractHash"))?
        .to_string();
    let contract = scout(port, &outer_hash, json!({"action": "describe", "operation": "plugins.search"}))?;
    let inner_hash = contract["contractHash"]
        .as_str()
        .ok_or_else(|| failed("error", "plugins.search describe returned no contractHash"))?
        .to_string();
    let query: String = query.chars().take(2000).collect();
    let value = scout(
        port,
        &outer_hash,
        json!({"action": "call", "operation": "plugins.search", "contractHash": inner_hash, "arguments": {
            "query": query, "source": "marketplace", "frameworks": ["unone"], "limit": limit.clamp(1, 100)
        }}),
    )?;
    if value["sources"]["marketplace"] == "unavailable" {
        let message = value["recovery"]["message"].as_str().unwrap_or("the Koncrate catalogue did not answer");
        return Err(failed("unavailable", message));
    }
    Ok(value["results"].as_array().cloned().unwrap_or_default())
}

/// One call through the outer `host.scout` bridge; returns the inner value
/// after checking both envelopes.
fn scout(port: u16, outer_hash: &str, request: Value) -> Result<Value, Search> {
    let outer = post(port, &json!({"action": "call", "operation": "host.scout", "contractHash": outer_hash, "arguments": {"request": request}}))?;
    let inner = &outer["value"];
    if inner["ok"] != true {
        return Err(classify(inner));
    }
    Ok(inner["value"].clone())
}

fn classify(result: &Value) -> Search {
    let code = result["code"].as_str().unwrap_or("UNKNOWN");
    let message = result["message"].as_str().unwrap_or("no message");
    if code == "AUTH_REQUIRED" || result["status"] == 401 {
        failed("auth_required", "The Koncrate Viewer is running but not signed in; sign in there (Unone never handles the login).")
    } else if code == "PLUGIN_CATALOG_UNAVAILABLE" {
        failed("unavailable", message)
    } else {
        failed("error", format!("{code}: {message}"))
    }
}

/// POST to the Viewer's /scout route and check the outer envelope.
fn post(port: u16, body: &Value) -> Result<Value, Search> {
    let (_, value) = http_post(port, body).map_err(|error| {
        failed("not_connected", format!("The Koncrate Viewer at 127.0.0.1:{port} did not answer ({error}); start it with --development-tools."))
    })?;
    if value["ok"] != true {
        return Err(classify(&value));
    }
    Ok(value)
}

fn http_post(port: u16, body: &Value) -> Result<(u16, Value), String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(1500)).map_err(|error| error.to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(15))).map_err(|error| error.to_string())?;
    stream.set_write_timeout(Some(Duration::from_secs(5))).map_err(|error| error.to_string())?;
    let payload = serde_json::to_vec(body).map_err(|error| error.to_string())?;
    // The Viewer accepts only these exact headers from a native local client.
    let head = format!(
        "POST /scout HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nX-Koncrate-Development: 1\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        payload.len()
    );
    stream.write_all(head.as_bytes()).and_then(|()| stream.write_all(&payload)).map_err(|error| error.to_string())?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response).map_err(|error| error.to_string())?;
    parse_response(&response)
}

fn parse_response(bytes: &[u8]) -> Result<(u16, Value), String> {
    let split = bytes.windows(4).position(|window| window == b"\r\n\r\n").ok_or("incomplete HTTP response")?;
    let head = std::str::from_utf8(&bytes[..split]).map_err(|_| "non-UTF-8 HTTP headers")?;
    let mut lines = head.split("\r\n");
    let status = lines
        .next()
        .and_then(|line| line.split(' ').nth(1))
        .and_then(|code| code.parse().ok())
        .ok_or("bad HTTP status line")?;
    let chunked = lines.any(|line| {
        let line = line.to_ascii_lowercase();
        line.starts_with("transfer-encoding:") && line.contains("chunked")
    });
    let raw = &bytes[split + 4..];
    let body = if chunked { dechunk(raw)? } else { raw.to_vec() };
    let value = serde_json::from_slice(&body).map_err(|error| format!("the response is not JSON: {error}"))?;
    Ok((status, value))
}

fn dechunk(mut raw: &[u8]) -> Result<Vec<u8>, String> {
    let mut body = Vec::new();
    loop {
        let end = raw.windows(2).position(|window| window == b"\r\n").ok_or("bad chunk header")?;
        let size = std::str::from_utf8(&raw[..end])
            .ok()
            .and_then(|text| usize::from_str_radix(text.split(';').next().unwrap_or("").trim(), 16).ok())
            .ok_or("bad chunk size")?;
        raw = &raw[end + 2..];
        if size == 0 {
            return Ok(body);
        }
        if raw.len() < size + 2 {
            return Err("truncated chunk".into());
        }
        body.extend_from_slice(&raw[..size]);
        raw = &raw[size + 2..];
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn responses_decode_plain_and_chunked_bodies() {
        let plain = b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 11\r\n\r\n{\"ok\":true}";
        assert_eq!(parse_response(plain).unwrap(), (200, json!({"ok": true})));
        let chunked = b"HTTP/1.1 401 Unauthorized\r\nTransfer-Encoding: chunked\r\n\r\n5\r\n{\"ok\"\r\n7\r\n:false}\r\n0\r\n\r\n";
        assert_eq!(parse_response(chunked).unwrap(), (401, json!({"ok": false})));
        assert!(parse_response(b"HTTP/1.1 200 OK\r\n").is_err());
    }

    #[test]
    fn only_a_loopback_endpoint_is_accepted() {
        assert_eq!(port_of(r#"{"url":"http://127.0.0.1:5123"}"#), Ok(5123));
        assert!(port_of(r#"{"url":"http://example.com:5123"}"#).unwrap_err().contains("non-loopback"));
        assert!(port_of(r#"{"url":"http://127.0.0.1.evil.test:80"}"#).is_err());
        assert!(port_of("not json").is_err());
    }

    /// A stand-in Viewer answering the three calls of one search in order.
    fn viewer(replies: Vec<Value>) -> (u16, std::thread::JoinHandle<Vec<Value>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for reply in replies {
                let (mut stream, _) = listener.accept().unwrap();
                let mut buffer = vec![0; 65536];
                let mut read = 0;
                // Read headers and the declared body.
                loop {
                    read += stream.read(&mut buffer[read..]).unwrap();
                    let text = String::from_utf8_lossy(&buffer[..read]).to_string();
                    if let Some(split) = text.find("\r\n\r\n") {
                        let length: usize = text.lines().find_map(|line| line.strip_prefix("Content-Length: ")).unwrap().trim().parse().unwrap();
                        if read >= split + 4 + length {
                            assert!(text.contains("X-Koncrate-Development: 1") && text.contains(&format!("Host: 127.0.0.1:{port}")));
                            requests.push(serde_json::from_str(&text[split + 4..split + 4 + length]).unwrap());
                            break;
                        }
                    }
                }
                let body = reply.to_string();
                let chunked = format!("{:x}\r\n{body}\r\n0\r\n\r\n", body.len());
                write!(stream, "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n{chunked}").unwrap();
            }
            requests
        });
        (port, handle)
    }

    #[test]
    fn a_search_uses_both_contract_hashes_and_asks_only_for_unone_marketplace_plugins() {
        let outer = "a".repeat(64);
        let inner = "b".repeat(64);
        let (port, handle) = viewer(vec![
            json!({"ok": true, "value": {"id": "host.scout", "contractHash": outer}}),
            json!({"ok": true, "value": {"ok": true, "value": {"id": "plugins.search", "contractHash": inner}}}),
            json!({"ok": true, "value": {"ok": true, "value": {"results": [{"pluginId": "studio.crt", "name": "CRT"}], "sources": {"marketplace": "ok"}}}}),
        ]);
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("development-tools.json");
        std::fs::write(&file, format!(r#"{{"schema":"koncrate.developer.endpoint.v1","url":"http://127.0.0.1:{port}"}}"#)).unwrap();
        let Search::Found { results, .. } = search(Some(&file), "crt scanlines", 5) else { panic!("expected results") };
        assert_eq!(results[0]["pluginId"], "studio.crt");
        let requests = handle.join().unwrap();
        assert_eq!(requests[0], json!({"action": "describe", "operation": "host.scout"}));
        assert_eq!(requests[1]["contractHash"], json!(outer));
        assert_eq!(requests[1]["arguments"]["request"], json!({"action": "describe", "operation": "plugins.search"}));
        let call = &requests[2]["arguments"]["request"];
        assert_eq!((call["contractHash"].clone(), call["arguments"]["source"].clone()), (json!(inner), json!("marketplace")));
        assert_eq!(call["arguments"]["frameworks"], json!(["unone"]));
    }

    #[test]
    fn missing_viewer_and_missing_login_are_reported_not_guessed() {
        let directory = tempfile::tempdir().unwrap();
        let absent = directory.path().join("development-tools.json");
        assert!(matches!(search(Some(&absent), "fog", 5), Search::Failed { status: "not_connected", .. }));
        let (port, handle) = viewer(vec![json!({"ok": false, "status": 401, "code": "AUTH_REQUIRED", "message": "login"})]);
        std::fs::write(&absent, format!(r#"{{"url":"http://127.0.0.1:{port}"}}"#)).unwrap();
        assert!(matches!(search(Some(&absent), "fog", 5), Search::Failed { status: "auth_required", .. }));
        handle.join().unwrap();
    }
}
