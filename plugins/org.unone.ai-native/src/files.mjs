import { realpath, open } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export class AuditError extends Error {
  constructor(code, field, message, expected, actual, fix) {
    super(message);
    Object.assign(this, { code, field, expected, actual, fix });
  }
}
export function invalid(field, message, expected, actual, fix) {
  throw new AuditError('AUDIT_INVALID', field, message, expected, actual, fix);
}
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function keys(value, allowed, field) {
  if (!object(value)) invalid(field, 'Expected a JSON object.', 'object', typeof value, 'Supply the object from ai_native.init.');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`${field}.${key}`, 'Unknown field; it was not silently ignored.', allowed, key, 'Remove the field or query ai_native.catalog for the supported contract.');
}
export function text(value, field, max = 4000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /^(todo|tbd|n\/?a|pending|待填|未填|\.{3})$/i.test(value.trim())) {
    invalid(field, 'A concrete, non-placeholder answer is required.', `1–${max} characters`, typeof value === 'string' ? value.slice(0,80) : typeof value, 'Write the observed answer, or state the exact reason this item could not be verified.');
  }
}
export function list(value, field, max, min = 0) {
  if (!Array.isArray(value) || value.length < min || value.length > max) invalid(field, 'Array size is outside the contract.', `${min}–${max} items`, Array.isArray(value) ? value.length : typeof value, 'Supply a bounded array; split oversized audits by tool or scenario.');
}
export function relativePath(value, field = 'path') {
  text(value, field, 512);
  if (path.isAbsolute(value) || path.win32.isAbsolute(value) || value.includes('\\') || value.includes(':') || value.split('/').some(p => !p || p === '..' || p === '.') || value.includes('\0')) {
    throw new AuditError('AUDIT_PATH_OUTSIDE_ROOT', field, 'Only normalized project-relative paths are accepted.', 'relative/path with no traversal, drive or backslash', value, 'Keep the evidence inside the explicitly selected project and use a forward-slash relative path.');
  }
  return value;
}
export function within(root, absolute) {
  const rel = path.relative(root, absolute);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
export async function readProjectFile(root, relative, maxBytes = 2 * 1024 * 1024) {
  relativePath(relative);
  let handle;
  try {
    const resolvedRoot = await realpath(root);
    const resolved = await realpath(path.resolve(resolvedRoot, relative));
    if (!within(resolvedRoot, resolved)) throw new AuditError('AUDIT_PATH_OUTSIDE_ROOT', 'path', 'The evidence symlink resolves outside the selected project.', 'file within project', relative, 'Copy only the approved evidence into the selected project; do not follow external symlinks.');
    handle = await open(resolved, 'r');
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > maxBytes) throw new AuditError('AUDIT_FILE_LIMIT', 'path', 'Evidence must be a bounded regular file.', `regular file <= ${maxBytes} bytes`, { path: relative, bytes: stats.size }, 'Select a smaller text artifact or split the transcript.');
    // A bounded read also handles a concurrently growing file without allocating unbounded memory.
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length <= maxBytes) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maxBytes) throw new AuditError('AUDIT_FILE_LIMIT', 'path', 'Evidence grew beyond the read limit.', maxBytes, relative, 'Capture an immutable, smaller artifact and retry.');
    const bytes = buffer.subarray(0, length);
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { path: relative, sha256: sha256(bytes), bytes: length, lines: content.split('\n').length, content };
  } catch (error) {
    if (error instanceof AuditError) throw error;
    throw new AuditError('AUDIT_FILE_UNAVAILABLE', 'path', 'Cannot read the selected UTF-8 evidence file.', 'readable project-relative UTF-8 file', { path: relative, reason: error.code ?? error.name }, 'Check the selected root, file existence, encoding and permissions; do not substitute an unrelated artifact.');
  } finally { await handle?.close(); }
}
export async function readJson(root, relative) {
  const file = await readProjectFile(root, relative);
  try { return JSON.parse(file.content); }
  catch { throw new AuditError('AUDIT_JSON_INVALID', 'path', 'The selected artifact is not valid JSON.', 'one JSON document', relative, 'Fix the JSON syntax without changing its observed evidence.'); }
}
export async function snapshot(root, paths) {
  list(paths, 'paths', 64, 1);
  if (new Set(paths).size !== paths.length) invalid('paths', 'Duplicate snapshot paths.', 'unique paths', paths, 'List each selected source file once.');
  const files = [];
  for (const p of paths) { const { content, ...meta } = await readProjectFile(root, p); files.push(meta); }
  return { algorithm: 'sha256', files, fingerprint: fingerprint(files), scope: 'Only the explicitly listed files; not a complete repository attestation.' };
}
export function fingerprint(files) {
  return sha256(JSON.stringify(files.map(({ path, sha256 }) => ({ path, sha256 })).sort((a,b) => a.path.localeCompare(b.path))));
}
