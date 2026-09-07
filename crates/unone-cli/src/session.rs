use std::{
    io::{self, BufRead, Write},
    path::Path,
    process::ExitCode,
};

use anyhow::Result;
use unone_engine::{DeveloperProtocol, Diagnostic, EngineResult, developer_request_schema};

/// Newline-delimited request/reply transport. stdout contains JSON only.
pub fn serve(project: &Path, schema: bool) -> Result<ExitCode> {
    let stdout = io::stdout();
    let mut output = stdout.lock();
    if schema {
        serde_json::to_writer_pretty(&mut output, &developer_request_schema())?;
        output.write_all(b"\n")?;
        return Ok(ExitCode::SUCCESS);
    }
    let stdin = io::stdin();
    let mut protocol = DeveloperProtocol::default();
    for line in stdin.lock().lines() {
        let line = line?;
        let line = line.trim_start_matches('\u{feff}');
        if line.trim().is_empty() {
            continue;
        }
        let result = match serde_json::from_str(line) {
            Ok(request) => protocol.execute_json(project, request),
            Err(detail) => EngineResult::failure(Diagnostic::error(
                "DEVELOPER_REQUEST_INVALID",
                "Expected a JSON request",
                detail.to_string(),
            )),
        };
        serde_json::to_writer(&mut output, &result)?;
        output.write_all(b"\n")?;
        output.flush()?;
    }
    Ok(ExitCode::SUCCESS)
}
