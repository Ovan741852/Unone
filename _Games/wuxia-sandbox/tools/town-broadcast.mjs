// Local OBS control only. No desktop, microphone, account UI, or keys in output.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const PROFILE = 'WuxiaTown';
export const COLLECTION = 'WuxiaTown';
export const SCENE = 'WuxiaTown';
export const TOWN_URL = 'http://127.0.0.1:8088/';
export const STREAM_SERVER = 'rtmps://a.rtmps.youtube.com/live2';
export const MUSIC_PATH = join(ROOT, 'assets', 'audio', 'Guzheng City.mp3');
export const TASK_PATH = join(ROOT, 'tools', 'live-task.txt');
export const MUSIC_SHA256 = '7d117a43cad22ff05b32340f2bd331368c48342f503eab85b1e5c403043d4be6';
export const MUSIC_NAME = 'Licensed music';
export const CREDIT_NAME = 'Music attribution';
export const TITLE = 'NanoJev 打造武俠小世界  ·  開發實況';
export const CREDIT_TEXT = [
  'Music: Guzheng City — Kevin MacLeod (incompetech.com)',
  'CC BY 4.0 · https://creativecommons.org/licenses/by/4.0/',
  'Source: https://incompetech.com/music/royalty-free/ · looped -24 dB · no edits',
].join('\n');

export const SOURCE_NAMES = Object.freeze([
  'Town browser',
  'Task background',
  'Broadcast title',
  'Current task',
  MUSIC_NAME,
  CREDIT_NAME,
]);

const ENCODER_FIELDS = Object.freeze([
  ['Output', 'Mode'],
  ['AdvOut', 'ApplyServiceSettings'],
  ['AdvOut', 'Encoder'],
  ['AdvOut', 'AudioEncoder'],
  ['AdvOut', 'RecType'],
  ['AdvOut', 'RecEncoder'],
  ['AdvOut', 'RecAudioEncoder'],
  ['AdvOut', 'RecFormat2'],
  ['AdvOut', 'TrackIndex'],
  ['AdvOut', 'VodTrackIndex'],
  ['AdvOut', 'Track1Bitrate'],
  ['AdvOut', 'RecTracks'],
  ['AdvOut', 'StreamMultiTrackAudioMixes'],
  ['Audio', 'SampleRate'],
]);

const TEXT_KINDS = new Set(['text_gdiplus', 'text_gdiplus_v2', 'text_gdiplus_v3']);
const INPUT_SOURCE_TYPE = 'OBS_SOURCE_TYPE_INPUT';
const sourceKind = (name) => name === 'Town browser' ? 'browser_source'
  : name === 'Task background' ? 'color_source'
  : name === MUSIC_NAME ? 'ffmpeg_source' : 'text';
const kindMatches = (actual, expected) => actual === expected
  || (expected === 'color_source' && actual.startsWith('color_source_'))
  || (expected === 'text' && TEXT_KINDS.has(actual));
const LAYOUT = {
  'Town browser': { x: 0, y: 96, width: 1920, height: 984 },
  'Task background': { x: 0, y: 0, width: 1920, height: 96 },
  'Broadcast title': { x: 24, y: 7 },
  'Current task': { x: 24, y: 51 },
  [MUSIC_NAME]: { x: 0, y: 0 },
  [CREDIT_NAME]: { x: 1070, y: 8 },
};
const samePath = (left, right) => resolve(left || '') === resolve(right);
const hasText = (value, text) => typeof value === 'string' && value.includes(text);

function reject(message) {
  const error = new Error(message);
  error.publicSafe = true;
  throw error;
}

function check(condition, message) {
  if (!condition) reject(message);
}

export function safeApiError(requestType, code, _untrustedComment = '') {
  const error = new Error(`${requestType} failed (${Number.isFinite(Number(code)) ? Number(code) : 'unknown'})`);
  error.publicSafe = true;
  return error;
}

function validateTransform(name, input) {
  const transform = input.transform;
  const expected = LAYOUT[name];
  check(transform && typeof transform === 'object', `Missing transform for ${name}.`);
  check(transform.positionX === expected.x && transform.positionY === expected.y, `Unexpected transform position for ${name}.`);
  for (const field of ['cropLeft', 'cropRight', 'cropTop', 'cropBottom']) {
    if (transform[field] !== undefined) check(transform[field] === 0, `Cropped source refused: ${name}.`);
  }
  if (transform.scaleX !== undefined) check(transform.scaleX === 1 && transform.scaleY === 1, `Scaled source refused: ${name}.`);
  if (transform.rotation !== undefined) check(transform.rotation === 0, `Rotated source refused: ${name}.`);
  if (transform.boundsType !== undefined) check(transform.boundsType === 'OBS_BOUNDS_NONE', `Bounded source refused: ${name}.`);
  if (transform.boundsWidth !== undefined) check(transform.boundsWidth === 0 && transform.boundsHeight === 0, `Explicit bounds refused: ${name}.`);
  if (expected.width !== undefined) {
    if (transform.width !== undefined) check(transform.width === expected.width, `Unexpected width for ${name}.`);
    if (transform.sourceWidth !== undefined) check(transform.sourceWidth === expected.width, `Unexpected source width for ${name}.`);
  }
  if (expected.height !== undefined) {
    if (transform.height !== undefined) check(transform.height === expected.height, `Unexpected height for ${name}.`);
    if (transform.sourceHeight !== undefined) check(transform.sourceHeight === expected.height, `Unexpected source height for ${name}.`);
  }
  for (const field of ['width', 'height', 'sourceWidth', 'sourceHeight']) {
    if (transform[field] !== undefined) check(Number.isFinite(transform[field]) && transform[field] >= 0 && transform[field] <= 1920, `Invalid transform dimension for ${name}.`);
  }
}

export function validateContext({ profileName, collectionName, programSceneName, profiles = [], collections = [] }) {
  check(profiles.includes(PROFILE), 'WuxiaTown profile is missing; refusing to use the default profile.');
  check(collections.includes(COLLECTION), 'WuxiaTown scene collection is missing; refusing to use the default collection.');
  check(profileName === PROFILE, `Wrong OBS profile (${profileName || 'unknown'}); refusing to broadcast.`);
  check(collectionName === COLLECTION, `Wrong OBS scene collection (${collectionName || 'unknown'}); refusing to broadcast.`);
  check(programSceneName === SCENE, `Wrong program scene (${programSceneName || 'unknown'}); refusing to broadcast.`);
  return true;
}

export function validateDestination({ streamServiceType, streamServiceSettings = {} }, { requireKey = true } = {}) {
  check(streamServiceType === 'rtmp_custom', 'Stream destination is not the approved custom RTMPS service.');
  check(streamServiceSettings.server === STREAM_SERVER, 'Stream destination server is not the approved YouTube RTMPS endpoint.');
  if (requireKey) check(typeof streamServiceSettings.key === 'string' && streamServiceSettings.key.trim(), 'Stream key is empty; refusing to broadcast.');
  return true;
}

export function validateScene({ sceneName, sceneItems, inputs, allInputs }) {
  check(sceneName === SCENE, 'Scene snapshot is not WuxiaTown.');
  check(Array.isArray(sceneItems) && sceneItems.length === SOURCE_NAMES.length, 'WuxiaTown must contain exactly six scene items.');
  const completeInputs = allInputs || Object.entries(inputs).map(([inputName, input]) => ({ ...input, inputName }));
  check(completeInputs.length === SOURCE_NAMES.length, 'WuxiaTown must contain exactly six total OBS inputs.');
  check(new Set(completeInputs.map(input => input.inputName)).size === SOURCE_NAMES.length
    && SOURCE_NAMES.every(name => completeInputs.some(input => input.inputName === name)), 'Unknown or missing global OBS input refused.');
  const expected = new Set(SOURCE_NAMES);
  const byName = new Map();
  for (const item of sceneItems) {
    check(item.sceneItemType !== 'OBS_SOURCE_TYPE_GROUP' && item.isGroup !== true, 'Nested/group scene source refused.');
    check(!item.sourceType || item.sourceType === INPUT_SOURCE_TYPE, 'Non-input scene source refused.');
    check(expected.has(item.sourceName) && !byName.has(item.sourceName), `Unknown or duplicate scene source: ${item.sourceName || 'unnamed'}.`);
    byName.set(item.sourceName, item);
  }
  check(byName.size === SOURCE_NAMES.length, 'WuxiaTown is missing an approved scene source.');

  for (const name of SOURCE_NAMES) {
    const input = inputs[name] && { ...inputs[name], transform: inputs[name].transform || byName.get(name).sceneItemTransform };
    check(input, `Missing OBS input: ${name}.`);
    const kind = input.unversionedInputKind || input.inputKind;
    const settings = input.settings || {};
    check(kindMatches(kind, sourceKind(name)), `Wrong source type for ${name}.`);
    check(input.sceneItemEnabled !== false, `Disabled scene source: ${name}.`);
    validateTransform(name, input);
    if (name === 'Town browser') {
      check(settings.url === TOWN_URL, 'Town browser URL is not the approved local town page.');
      check(!settings.css, 'Town browser has custom CSS; refusing to hide or alter the page.');
      check(input.muted === true, 'Town browser must be muted.');
    } else if (name === 'Task background') {
      check(settings.color === 0xff211a11, 'Task background color is not the approved banner color.');
    } else if (name === 'Broadcast title') {
      check(settings.text === TITLE, 'Broadcast title text is not approved.');
    } else if (name === 'Current task') {
      check(settings.read_from_file === true && samePath(settings.file, TASK_PATH), 'Current task must read only tools/live-task.txt.');
    } else if (name === MUSIC_NAME) {
      check(samePath(settings.local_file, MUSIC_PATH) && settings.is_local_file === true, 'Music file is not the approved local asset.');
      check(settings.looping === true, 'Approved music must loop.');
      check(input.muted === false, 'Approved music must be unmuted.');
      check(input.volumeDb === -24, 'Approved music must be set to -24 dB.');
      check(input.monitorType === 'OBS_MONITORING_TYPE_NONE', 'Music monitoring must be disabled.');
    } else if (name === CREDIT_NAME) {
      check(settings.text === CREDIT_TEXT, 'Music attribution text is incomplete or not approved.');
    }
  }
  const taskText = readFileSync(TASK_PATH, 'utf8').trim();
  check(taskText.length > 0 && !taskText.includes('\0') && taskText.length <= 400, 'Task banner file must contain short readable text.');
  return true;
}

export function redactStatus({ stream = {}, recording = {}, video = {}, profileName, collectionName, programSceneName, profiles = [], collections = [], inputs = [] }) {
  return {
    profile: profileName,
    collection: collectionName,
    programScene: programSceneName,
    availableProfiles: profiles,
    availableCollections: collections,
    stream: { outputActive: Boolean(stream.outputActive), outputBytes: Number(stream.outputBytes || 0), outputDuration: Number(stream.outputDuration || 0) },
    recording: { outputActive: Boolean(recording.outputActive), outputBytes: Number(recording.outputBytes || 0), outputDuration: Number(recording.outputDuration || 0) },
    video: { outputWidth: video.outputWidth, outputHeight: video.outputHeight, fpsNumerator: video.fpsNumerator, fpsDenominator: video.fpsDenominator },
    inputs: inputs.map(({ inputName, inputKind, unversionedInputKind }) => ({ inputName, inputKind, unversionedInputKind })),
  };
}

function fileSha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function nativeFrame() {
  let response;
  try {
    response = await fetch('http://127.0.0.1:55433/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'snapshot' }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    reject('Native town snapshot is unavailable.');
  }
  check(response.ok, 'Native town snapshot request failed.');
  let payload;
  try {
    payload = await response.json();
  } catch {
    reject('Native town snapshot was not valid JSON.');
  }
  const frame = payload?.value?.observation?.world?.frame ?? payload?.world?.frame;
  check(Number.isFinite(frame), 'Native town snapshot has no frame counter.');
  return frame;
}

async function verifyTownRuntime() {
  let response;
  try {
    response = await fetch(TOWN_URL, { signal: AbortSignal.timeout(4000) });
  } catch {
    reject('Town browser page is not readable.');
  }
  check(response.ok, 'Town browser page returned a non-success response.');
  const body = await response.text();
  check(body.length > 0, 'Town browser page is empty.');
  const firstFrame = await nativeFrame();
  await new Promise(resolveWait => setTimeout(resolveWait, 300));
  const secondFrame = await nativeFrame();
  check(secondFrame > firstFrame, 'Native town snapshot frame is not advancing.');
}

function hashBase64(value) {
  return createHash('sha256').update(value).digest('base64');
}

function loadObsConfig() {
  const path = join(process.env.APPDATA || '', 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');
  check(path && existsSync(path), 'OBS WebSocket config is unavailable.');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  check(config.auth_required && config.server_password && config.server_port, 'OBS must be running with authenticated control enabled.');
  return config;
}

function connect() {
  const config = loadObsConfig();
  const ws = new WebSocket(`ws://127.0.0.1:${config.server_port}`);
  const pending = new Map();
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolveReady, rejectReady) => { readyResolve = resolveReady; readyReject = rejectReady; });
  const startupTimer = setTimeout(() => readyReject(new Error('OBS connection timed out')), 10000);
  ws.addEventListener('error', () => readyReject(new Error('Cannot connect to the town OBS instance')));
  ws.addEventListener('close', () => {
    readyReject(new Error('OBS connection closed'));
    for (const request of pending.values()) request.reject(new Error('OBS connection closed'));
  });
  ws.addEventListener('message', event => {
    const { op, d } = JSON.parse(event.data);
    if (op === 0) {
      const authentication = d.authentication
        ? hashBase64(hashBase64(config.server_password + d.authentication.salt) + d.authentication.challenge) : undefined;
      ws.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, eventSubscriptions: 0, authentication } }));
    } else if (op === 2) readyResolve();
    else if (op === 7) {
      const request = pending.get(d.requestId);
      if (!request) return;
      pending.delete(d.requestId);
      if (d.requestStatus.result) request.resolve(d.responseData || {});
      else request.reject(safeApiError(d.requestType, d.requestStatus.code));
    }
  });
  function call(requestType, requestData = {}) {
    return new Promise((resolveCall, rejectCall) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => { pending.delete(requestId); rejectCall(new Error(`${requestType} timed out`)); }, 15000);
      pending.set(requestId, {
        resolve: value => { clearTimeout(timer); resolveCall(value); },
        reject: error => { clearTimeout(timer); rejectCall(error); },
      });
      ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });
  }
  return { ws, ready, startupTimer, call };
}

async function getContext(call) {
  const profiles = await call('GetProfileList');
  const collections = await call('GetSceneCollectionList');
  const currentScene = await call('GetCurrentProgramScene');
  return {
    profileName: profiles.currentProfileName,
    collectionName: collections.currentSceneCollectionName,
    programSceneName: currentScene.currentProgramSceneName,
    profiles: (profiles.profiles || []).map(item => typeof item === 'string' ? item : item.profileName),
    collections: (collections.sceneCollections || []).map(item => typeof item === 'string' ? item : item.scName),
  };
}

async function getEncoderParameters(call) {
  const result = {};
  for (const [parameterCategory, parameterName] of ENCODER_FIELDS) {
    const value = await call('GetProfileParameter', { parameterCategory, parameterName });
    result[`${parameterCategory}.${parameterName}`] = {
      value: value.parameterValue,
      defaultValue: value.defaultParameterValue,
    };
  }
  return result;
}

export function validateEncoderSettings(settings) {
  check(settings && settings.rate_control === 'CBR' && settings.bitrate === 6000 && settings.keyint_sec === 2, 'WuxiaTown streamEncoder.json is not the approved CBR/keyframe configuration.');
  return true;
}

function readTownEncoderJson() {
  const path = join(process.env.APPDATA || '', 'obs-studio', 'basic', 'profiles', PROFILE, 'streamEncoder.json');
  check(existsSync(path), 'WuxiaTown streamEncoder.json is missing.');
  let settings;
  try {
    settings = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    reject('WuxiaTown streamEncoder.json is not valid JSON.');
  }
  validateEncoderSettings(settings);
  return settings;
}

async function setProfileParameter(call, parameterCategory, parameterName, parameterValue) {
  await call('SetProfileParameter', { parameterCategory, parameterName, parameterValue });
  const result = await call('GetProfileParameter', { parameterCategory, parameterName });
  check(result.parameterValue === parameterValue, `OBS did not apply ${parameterCategory}.${parameterName}.`);
}

async function configureAdvancedEncoder(call) {
  await assertNoOutput(call);
  const context = await selectWuxiaContext(call);
  readTownEncoderJson();
  const current = await getEncoderParameters(call);
  const currentAudio = current['AdvOut.AudioEncoder'].value || current['AdvOut.AudioEncoder'].defaultValue;
  const currentRecAudio = current['AdvOut.RecAudioEncoder'].value || current['AdvOut.RecAudioEncoder'].defaultValue;
  check(currentAudio === 'ffmpeg_aac' && currentRecAudio === 'ffmpeg_aac', 'WuxiaTown does not expose the approved FFmpeg AAC encoder.');
  const updates = [
    ['Output', 'Mode', 'Advanced'],
    ['AdvOut', 'ApplyServiceSettings', 'true'],
    ['AdvOut', 'Encoder', 'obs_nvenc_h264_tex'],
    ['AdvOut', 'AudioEncoder', 'ffmpeg_aac'],
    ['AdvOut', 'RecEncoder', 'none'],
    ['AdvOut', 'RecAudioEncoder', 'ffmpeg_aac'],
    ['AdvOut', 'TrackIndex', '1'],
    ['AdvOut', 'Track1Bitrate', '160'],
    ['AdvOut', 'StreamMultiTrackAudioMixes', '1'],
    ['Audio', 'SampleRate', '48000'],
  ];
  for (const update of updates) await setProfileParameter(call, ...update);

  const otherProfile = context.profiles.find(name => name !== PROFILE);
  check(otherProfile, 'No second OBS profile is available for a safe WuxiaTown reload.');
  await call('SetCurrentProfile', { profileName: otherProfile });
  await call('SetCurrentProfile', { profileName: PROFILE });
  await call('SetCurrentSceneCollection', { sceneCollectionName: COLLECTION });
  const reloaded = await getContext(call);
  validateContext(reloaded);
  const applied = await getEncoderParameters(call);
  check(applied['Output.Mode'].value === 'Advanced'
    && applied['AdvOut.ApplyServiceSettings'].value === 'true'
    && applied['AdvOut.Encoder'].value === 'obs_nvenc_h264_tex'
    && applied['AdvOut.AudioEncoder'].value === 'ffmpeg_aac'
    && applied['AdvOut.Track1Bitrate'].value === '160'
    && applied['Audio.SampleRate'].value === '48000', 'WuxiaTown Advanced NVENC/AAC settings did not survive profile reload.');
}

async function assertNoOutput(call) {
  const [stream, recording] = await Promise.all([call('GetStreamStatus'), call('GetRecordStatus')]);
  check(!stream.outputActive && !recording.outputActive, 'OBS stream or recording is active; refusing to change the isolated setup.');
  return { stream, recording };
}

async function selectWuxiaContext(call) {
  const context = await getContext(call);
  validateContext(context);
  return context;
}

async function prepareContext(call) {
  await assertNoOutput(call);
  let context = await getContext(call);
  check(context.profiles.includes(PROFILE), 'WuxiaTown profile is missing; refusing to change the default profile.');
  check(context.collections.includes(COLLECTION), 'WuxiaTown scene collection is missing; refusing to change the default collection.');
  if (context.profileName !== PROFILE) await call('SetCurrentProfile', { profileName: PROFILE });
  context = await getContext(call);
  if (context.collectionName !== COLLECTION) await call('SetCurrentSceneCollection', { sceneCollectionName: COLLECTION });
  context = await getContext(call);
  validateContext(context);
  return context;
}

async function getScene(call) {
  const [{ currentProgramSceneName }, { sceneItems }, { inputs }] = await Promise.all([
    call('GetCurrentProgramScene'),
    call('GetSceneItemList', { sceneName: SCENE }),
    call('GetInputList'),
  ]);
  const inputByName = new Map(inputs.map(input => [input.inputName, input]));
  const details = {};
  for (const item of sceneItems) {
    if (!SOURCE_NAMES.includes(item.sourceName)) continue;
    const input = inputByName.get(item.sourceName);
    if (!input) continue;
    const settings = await call('GetInputSettings', { inputName: item.sourceName });
    const audioSource = item.sourceName === 'Town browser' || item.sourceName === MUSIC_NAME;
    const mute = audioSource ? await call('GetInputMute', { inputName: item.sourceName }) : undefined;
    const detail = { ...input, settings: settings.inputSettings || {}, sceneItemEnabled: item.sceneItemEnabled, transform: item.sceneItemTransform };
    if (audioSource) detail.muted = mute.inputMuted;
    if (item.sourceName === MUSIC_NAME) {
      const [volume, monitor] = await Promise.all([
        call('GetInputVolume', { inputName: MUSIC_NAME }),
        call('GetInputAudioMonitorType', { inputName: MUSIC_NAME }),
      ]);
      detail.volumeDb = volume.inputVolumeDb;
      detail.monitorType = monitor.monitorType;
    }
    details[item.sourceName] = detail;
  }
  return { sceneName: currentProgramSceneName, sceneItems, inputs: details, allInputs: inputs };
}

async function verifyScene(call) {
  const snapshot = await getScene(call);
  validateScene(snapshot);
  return snapshot;
}

function sourceSettings() {
  return [
    ['Town browser', 'browser_source', { url: TOWN_URL, width: 1920, height: 984, fps: 30, fps_custom: true, reroute_audio: true, shutdown: false }, { positionX: 0, positionY: 96, alignment: 5 }],
    ['Task background', 'color_source', { color: 0xff211a11, width: 1920, height: 96 }, { positionX: 0, positionY: 0, alignment: 5 }],
    ['Broadcast title', null, { text: TITLE, font: { face: 'Microsoft JhengHei', size: 30, flags: 1 }, color: 0xffe3eae5, outline: false }, { positionX: 24, positionY: 7, alignment: 5 }],
    ['Current task', null, { read_from_file: true, file: TASK_PATH, font: { face: 'Microsoft JhengHei', size: 25, flags: 0 }, color: 0xffb5d9a5, outline: false }, { positionX: 24, positionY: 51, alignment: 5 }],
    [MUSIC_NAME, 'ffmpeg_source', { local_file: MUSIC_PATH, is_local_file: true, looping: true, restart_on_activate: true, close_when_inactive: false }, { positionX: 0, positionY: 0, alignment: 5 }],
    [CREDIT_NAME, null, { text: CREDIT_TEXT, font: { face: 'Arial', size: 16, flags: 0 }, color: 0xffdce6e0, outline: false }, { positionX: 1070, positionY: 8, alignment: 5 }],
  ];
}

async function ensureSources(call) {
  check(fileSha256(MUSIC_PATH) === MUSIC_SHA256, 'Approved music SHA256 does not match; refusing to use the file.');
  const { inputKinds } = await call('GetInputKindList');
  const textKind = inputKinds.find(kind => kind.startsWith('text_gdiplus'));
  const colorKind = inputKinds.find(kind => kind === 'color_source' || kind.startsWith('color_source_'));
  check(textKind && inputKinds.includes('browser_source') && colorKind && inputKinds.includes('ffmpeg_source'), 'Required OBS built-in sources are unavailable.');
  const [{ sceneItems }, { inputs }] = await Promise.all([
    call('GetSceneItemList', { sceneName: SCENE }),
    call('GetInputList'),
  ]);
  const expected = new Set(SOURCE_NAMES);
  for (const item of sceneItems) {
    check(expected.has(item.sourceName) && item.isGroup !== true && item.sourceType !== 'OBS_SOURCE_TYPE_GROUP', `Unknown or nested WuxiaTown source: ${item.sourceName || 'unnamed'}.`);
  }
  const inputByName = new Map(inputs.map(input => [input.inputName, input]));
  const sceneByName = new Map(sceneItems.map(item => [item.sourceName, item]));
  for (const [name, configuredKind, settings, transform] of sourceSettings()) {
    const inputKind = configuredKind === 'color_source' ? colorKind : configuredKind || textKind;
    const existing = inputByName.get(name);
    if (existing) {
      const kind = existing.unversionedInputKind || existing.inputKind;
      check(kindMatches(kind, configuredKind || 'text'), `Wrong source type for ${name}; refusing to replace it.`);
      check(sceneByName.has(name), `Approved input ${name} exists outside WuxiaTown; refusing to move it automatically.`);
      await call('SetInputSettings', { inputName: name, inputSettings: settings, overlay: false });
      const { sceneItemId } = await call('GetSceneItemId', { sceneName: SCENE, sourceName: name });
      await call('SetSceneItemTransform', { sceneName: SCENE, sceneItemId, sceneItemTransform: transform });
      await call('SetSceneItemEnabled', { sceneName: SCENE, sceneItemId, sceneItemEnabled: true });
    } else {
      const { sceneItemId } = await call('CreateInput', { sceneName: SCENE, inputName: name, inputKind, inputSettings: settings, sceneItemEnabled: true });
      await call('SetSceneItemTransform', { sceneName: SCENE, sceneItemId, sceneItemTransform: transform });
    }
  }
  await call('SetInputMute', { inputName: 'Town browser', inputMuted: true });
  await call('SetInputMute', { inputName: MUSIC_NAME, inputMuted: false });
  await call('SetInputVolume', { inputName: MUSIC_NAME, inputVolumeDb: -24 });
  await call('SetInputAudioMonitorType', { inputName: MUSIC_NAME, monitorType: 'OBS_MONITORING_TYPE_NONE' });
  await call('SetCurrentProgramScene', { sceneName: SCENE });
}

async function configureDestination(call) {
  const current = await call('GetStreamServiceSettings');
  const settings = current.streamServiceSettings || {};
  check(typeof settings.key === 'string' && settings.key.trim(), 'Existing stream key is empty; refusing to create or change a destination.');
  if (current.streamServiceType !== 'rtmp_custom' || settings.server !== STREAM_SERVER) {
    await call('SetStreamServiceSettings', {
      streamServiceType: 'rtmp_custom',
      streamServiceSettings: { server: STREAM_SERVER, key: settings.key },
    });
  }
}

async function preflight(call, { requireDestination = true } = {}) {
  const context = await selectWuxiaContext(call);
  const scene = await verifyScene(call);
  check(fileSha256(MUSIC_PATH) === MUSIC_SHA256, 'Approved music SHA256 does not match; refusing to use the file.');
  await verifyTownRuntime();
  const destination = await call('GetStreamServiceSettings');
  validateDestination(destination, { requireKey: requireDestination });
  const video = await call('GetVideoSettings');
  check(video.outputWidth === 1920 && video.outputHeight === 1080, 'OBS output must be 1920x1080.');
  check(video.fpsNumerator / video.fpsDenominator === 30, 'OBS output must be 30 fps.');
  return { context, scene, video };
}

export async function refreshBrowser(call) {
  await preflight(call, { requireDestination: false });
  await call('PressInputPropertiesButton', { inputName: 'Town browser', propertyName: 'refreshnocache' });
}

async function waitFor(call, predicate, message, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await call();
    if (predicate(value)) return value;
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  reject(message);
}

async function run(command, argv) {
  if (command === 'self-test') {
    validateDestination({ streamServiceType: 'rtmp_custom', streamServiceSettings: { server: STREAM_SERVER, key: 'offline-test-key' } });
    return console.log('Broadcast helper self-test passed.');
  }
  const { ws, ready, startupTimer, call } = connect();
  try {
    await ready;
    clearTimeout(startupTimer);
    if (command === 'status') {
      const [context, stream, recording, video, inputResult] = await Promise.all([
        getContext(call), call('GetStreamStatus'), call('GetRecordStatus'), call('GetVideoSettings'), call('GetInputList'),
      ]);
      return console.log(JSON.stringify(redactStatus({ ...context, stream, recording, video, inputs: inputResult.inputs || [] }), null, 2));
    }
    if (command === 'encoder-status') {
      await selectWuxiaContext(call);
      return console.log(JSON.stringify(await getEncoderParameters(call), null, 2));
    }
    if (command === 'configure-encoder') {
      await configureAdvancedEncoder(call);
      return console.log('WuxiaTown Advanced NVENC H264/AAC encoder settings applied and profile reloaded.');
    }
    if (command === 'prepare' || command === 'configure') {
      await prepareContext(call);
      await configureDestination(call);
      await ensureSources(call);
      await preflight(call);
      return console.log('Prepared isolated WuxiaTown profile/collection; six approved sources and custom RTMPS destination verified.');
    }
    if (command === 'preflight') {
      await preflight(call);
      return console.log('Preflight passed: WuxiaTown, approved sources/audio, 1920x1080/30, and custom RTMPS destination.');
    }
    if (command === 'refresh-browser') {
      await refreshBrowser(call);
      return console.log('Approved Town browser source refreshed without changing OBS output or context.');
    }
    if (command === 'screenshot') {
      await preflight(call, { requireDestination: false });
      const { imageData } = await call('GetSourceScreenshot', { sourceName: SCENE, imageFormat: 'png', imageWidth: 1920 });
      const output = join(ROOT, '.runtime', 'town-broadcast-preview.png');
      writeFileSync(output, Buffer.from(imageData.split(',')[1], 'base64'));
      return console.log(output);
    }
    if (command === 'record') {
      await assertNoOutput(call);
      await preflight(call, { requireDestination: false });
      check(!(await call('GetRecordStatus')).outputActive, 'Recording is already active.');
      await call('StartRecord');
      await waitFor(() => call('GetRecordStatus'), value => value.outputActive === true, 'OBS did not become active for local recording.');
      return console.log('Local recording started; public streaming was not started.');
    }
    if (command === 'stop-record') {
      if ((await call('GetRecordStatus')).outputActive) await call('StopRecord');
      await waitFor(() => call('GetRecordStatus'), value => value.outputActive === false, 'OBS recording did not stop.');
      return console.log('Local recording stopped.');
    }
    if (command === 'stream') {
      check(argv.includes('--confirmed-public'), 'Explicit public-broadcast confirmation required.');
      await assertNoOutput(call);
      await preflight(call);
      await call('StartStream');
      const first = await waitFor(() => call('GetStreamStatus'), value => value.outputActive === true, 'OBS did not become active for public streaming.');
      await new Promise(resolveWait => setTimeout(resolveWait, 1000));
      const second = await call('GetStreamStatus');
      check(second.outputActive === true
        && Number(second.outputBytes || 0) > Number(first.outputBytes || 0)
        && Number(second.outputDuration || 0) > Number(first.outputDuration || 0), 'OBS stream bytes/duration did not increase.');
      return console.log('Public stream started and OBS reported active output.');
    }
    if (command === 'stop-stream') {
      if ((await call('GetStreamStatus')).outputActive) await call('StopStream');
      await waitFor(() => call('GetStreamStatus'), value => value.outputActive === false, 'OBS stream did not stop.');
      return console.log('Stream stopped.');
    }
    reject(`Unknown command: ${command}`);
  } finally {
    clearTimeout(startupTimer);
    ws.close();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const [command = 'status', ...argv] = process.argv.slice(2);
  run(command, argv).catch(error => {
    console.error(`Broadcast refused: ${error.message.replace(/key|password|secret/gi, 'credential')}`);
    process.exitCode = 1;
  });
}
