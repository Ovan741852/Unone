//! Explicitly bounded refresh of a project's inlined canonical API contract.
use std::{fs::{self, File, OpenOptions}, io::{self, Write}, path::{Path, PathBuf}, sync::atomic::{AtomicU64, Ordering}};
use serde::Serialize;
use crate::{ActionSuggestion, Diagnostic, EngineResult};

const BEGIN: &str = "-- BEGIN UNONE API TYPES";
const END: &str = "-- END UNONE API TYPES";

#[derive(Debug, Serialize)]
pub struct ApiTypingsUpdateReport {
    pub script: String,
    pub path: String,
    pub changed: bool,
    pub bytes_before: usize,
    pub bytes_after: usize,
    pub begin_marker: &'static str,
    pub end_marker: &'static str,
}

/// The explicitly owned block used by both project init and type refresh.
/// No strict directive or game code belongs inside this generated block.
pub fn api_typings_block() -> String {
    let types=crate::api::typings().replace("\r\n","\n");
    format!("{BEGIN}\n{}\n{END}", types.trim())
}

/// Refresh exactly one explicitly marked block in an existing script. The
/// caller chooses the script; this function never guesses code boundaries.
pub fn update_api_typings(project_root: impl AsRef<Path>, script: &str) -> EngineResult<ApiTypingsUpdateReport> {
    let path = match crate::project::resolve_project_path(project_root.as_ref(), script) {
        Ok(path) => path,
        Err(error) => return EngineResult::failure(*error),
    };
    let before = match fs::read_to_string(&path) {
        Ok(source) => source,
        Err(error) => return EngineResult::failure(Diagnostic::error(
            "API_TYPINGS_SCRIPT_READ_FAILED", "Could not read the existing script for type refresh",
            format!("{}: {error}. --update-script requires an existing UTF-8 script; it does not create files or directories.",path.display()),
        )),
    };
    let after = match replace_block(&before) {
        Ok(after) => after,
        Err(reason) => {
            let mut error = Diagnostic::error("API_TYPINGS_MARKERS_INVALID", "The script must contain exactly one explicit Unone API type block", reason);
            error.facts = serde_json::json!({"script":script,"begin_marker":BEGIN,"end_marker":END,"changed":false});
            error.suggested_actions.push(ActionSuggestion {
                action:"mark_api_types".into(),
                description:format!("Manually place '{BEGIN}' and '{END}' on their own lines around only the engine API type declarations. Keep --!strict and game-owned types/code outside. This command does not infer or insert missing boundaries."),
                command:None,
            });
            return EngineResult::failure(error);
        }
    };
    let changed = before != after;
    if changed {
        let written = write_updated_script(&path,before.as_bytes(),after.as_bytes(),|file,bytes|file.write_all(bytes));
        if let Err(error) = written {
            return EngineResult::failure(Diagnostic::error(
                "API_TYPINGS_SCRIPT_WRITE_FAILED", "Could not write the refreshed script",
                format!("{}: {error}",path.display()),
            ));
        }
    }
    let mut result = EngineResult::success(ApiTypingsUpdateReport {
        script:script.into(), path:path.display().to_string(), changed,
        bytes_before:before.len(), bytes_after:after.len(), begin_marker:BEGIN, end_marker:END,
    });
    if changed { result.effects.push(format!("canonical API type block refreshed in {script}")); }
    result
}

static STAGING_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct StagingFile(PathBuf);
impl Drop for StagingFile {
    fn drop(&mut self) { let _=fs::remove_file(&self.0); }
}

// Write/sync the complete replacement beside the original, then publish once.
// The original remains untouched if writing, validation or replacement fails.
fn write_updated_script(
    path: &Path, before: &[u8], after: &[u8],
    write: impl FnOnce(&mut File,&[u8])->io::Result<()>,
) -> io::Result<()> {
    // Preserve a project-local symlink by replacing its canonical target.
    // resolve_project_path already checked this existing target is contained.
    let target=fs::canonicalize(path)?;
    let metadata=fs::metadata(&target)?;
    if !metadata.is_file() { return Err(io::Error::new(io::ErrorKind::InvalidInput,"The existing script is not a regular file.")); }
    if metadata.permissions().readonly() { return Err(io::Error::new(io::ErrorKind::PermissionDenied,"The existing script is read-only.")); }
    let parent=target.parent().ok_or_else(||io::Error::new(io::ErrorKind::InvalidInput,"The script has no parent directory."))?;
    let mut staged=None;
    for _ in 0..32 {
        let sequence=STAGING_SEQUENCE.fetch_add(1,Ordering::Relaxed);
        let candidate=parent.join(format!(".unone-api-types-{}-{sequence}.tmp",std::process::id()));
        match OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(file)=>{staged=Some((StagingFile(candidate),file));break;}
            Err(error) if error.kind()==io::ErrorKind::AlreadyExists=>continue,
            Err(error)=>return Err(error),
        }
    }
    let (staging,mut file)=staged.ok_or_else(||io::Error::new(io::ErrorKind::AlreadyExists,"Could not reserve an exclusive script staging file after 32 attempts."))?;
    write(&mut file,after)?;
    file.sync_all()?;
    drop(file);
    fs::set_permissions(&staging.0,metadata.permissions())?;
    // Refuse a missing or concurrently changed original, rather than creating
    // a replacement for a script the author removed or edited while staging.
    if fs::read(&target)? != before {
        return Err(io::Error::new(io::ErrorKind::WouldBlock,"The original script changed while refreshing; retry the operation."));
    }
    fs::rename(&staging.0,&target)?;
    Ok(())
}

fn replace_block(source: &str) -> Result<String, String> {
    let mut begins = Vec::new();
    let mut ends = Vec::new();
    let mut offset = 0;
    let mut newline = "\n";
    for segment in source.split_inclusive('\n') {
        let line = segment.strip_suffix('\n').unwrap_or(segment);
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.contains(BEGIN) || line.contains(END) {
            if line == BEGIN {
                begins.push(offset);
                if segment.ends_with("\r\n") { newline = "\r\n"; }
            } else if line == END {
                ends.push(offset + line.len());
            } else {
                return Err(format!("An embedded or indented marker occurs at byte {offset}. Both markers must occupy their own complete lines with no indentation or extra text. No file was written."));
            }
        }
        offset += segment.len();
    }
    if begins.len()!=1 || ends.len()!=1 {
        return Err(format!("Found {} begin marker(s) and {} end marker(s); exactly one ordered pair is required. Missing, duplicate or unclosed blocks are not modified.",begins.len(),ends.len()));
    }
    let (start,end)=(begins[0],ends[0]);
    if start >= end {
        return Err("The end marker precedes the begin marker. Correct the explicit block boundaries before refreshing; no file was written.".into());
    }
    let canonical = api_typings_block().replace('\n',newline);
    let mut updated = String::with_capacity(source.len() + canonical.len());
    updated.push_str(&source[..start]);
    updated.push_str(&canonical);
    updated.push_str(&source[end..]);
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_replacement_preserves_unicode_crlf_and_every_outside_byte() {
        let prefix="\u{feff}--!strict\r\n-- 星際導航\r\n";
        let suffix="\r\n\r\nlocal label='中文 → 🚀'\r\nreturn label";
        let before=format!("{prefix}{BEGIN}\r\nexport type EngineApi = any\r\n{END}{suffix}");
        let after=replace_block(&before).unwrap();
        let expected=format!("{prefix}{}{suffix}",api_typings_block().replace('\n',"\r\n"));
        assert_eq!(after.as_bytes(),expected.as_bytes());
        assert_eq!(replace_block(&after).unwrap(),after);
        assert!(!after.replace("\r\n","").contains('\n'));
    }

    #[test]
    fn invalid_markers_are_never_guessed_or_partially_replaced() {
        for source in [
            "--!strict\nexport type EngineApi=any".to_string(),
            format!("{BEGIN}\ntype X=number"),
            format!("{END}\n{BEGIN}"),
            format!("{BEGIN}\n{BEGIN}\n{END}"),
            format!("{BEGIN}\n{END}\n{END}"),
            format!(" {BEGIN}\n{END}"),
            format!("local text='{BEGIN}'\n{END}"),
            format!("{BEGIN} -- extra\n{END}"),
            format!("{BEGIN}\n{END}\n-- mention {BEGIN}"),
        ] { assert!(replace_block(&source).is_err(),"accepted {source:?}"); }
    }

    #[test]
    fn partial_staging_write_never_truncates_original_and_cleans_up() {
        let directory=tempfile::tempdir().unwrap();
        let path=directory.path().join("main.luau");
        let original=b"--!strict\nlocal game='preserve all gameplay'\nreturn game";
        fs::write(&path,original).unwrap();
        let error=write_updated_script(&path,original,b"complete replacement",|file,bytes|{
            file.write_all(&bytes[..5])?;
            Err(io::Error::other("simulated full disk after partial staging write"))
        }).unwrap_err();
        assert!(error.to_string().contains("simulated full disk"));
        assert_eq!(fs::read(&path).unwrap(),original);
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(),1);
    }

    #[test]
    fn staging_refuses_a_missing_or_concurrently_changed_original() {
        let directory=tempfile::tempdir().unwrap();
        let path=directory.path().join("main.luau");
        for remove in [false,true] {
            fs::write(&path,b"original").unwrap();
            let result=write_updated_script(&path,b"original",b"replacement",|file,bytes|{
                file.write_all(bytes)?;
                if remove {fs::remove_file(&path)} else {fs::write(&path,b"author's newer edit")}
            });
            assert!(result.is_err());
            if remove {assert!(!path.exists());} else {assert_eq!(fs::read(&path).unwrap(),b"author's newer edit");}
            assert_eq!(fs::read_dir(directory.path()).unwrap().count(),usize::from(!remove));
        }
    }
}
