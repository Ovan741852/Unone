import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CREDIT_NAME,
  CREDIT_TEXT,
  MUSIC_NAME,
  MUSIC_PATH,
  MUSIC_SHA256,
  PROFILE,
  COLLECTION,
  SCENE,
  STREAM_SERVER,
  TASK_PATH,
  TITLE,
  TOWN_URL,
  redactStatus,
  refreshBrowser,
  safeApiError,
  validateEncoderSettings,
  validateContext,
  validateDestination,
  validateScene,
} from './town-broadcast.mjs';

const fixture = () => ({
  sceneName: SCENE,
  sceneItems: [
    { sourceName: 'Town browser', sourceType: 'OBS_SOURCE_TYPE_INPUT', sceneItemEnabled: true, sceneItemTransform: { positionX: 0, positionY: 96, scaleX: 1, scaleY: 1, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0, boundsType: 'OBS_BOUNDS_NONE', boundsWidth: 0, boundsHeight: 0, width: 1920, height: 984 } },
    { sourceName: 'Task background', sourceType: 'OBS_SOURCE_TYPE_INPUT', sceneItemEnabled: true, sceneItemTransform: { positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0, boundsType: 'OBS_BOUNDS_NONE', boundsWidth: 0, boundsHeight: 0, width: 1920, height: 96 } },
    { sourceName: 'Broadcast title', sourceType: 'OBS_SOURCE_TYPE_INPUT', sceneItemEnabled: true, sceneItemTransform: { positionX: 24, positionY: 7, scaleX: 1, scaleY: 1, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0, boundsType: 'OBS_BOUNDS_NONE', boundsWidth: 0, boundsHeight: 0 } },
    { sourceName: 'Current task', sourceType: 'OBS_SOURCE_TYPE_INPUT', sceneItemEnabled: true, sceneItemTransform: { positionX: 24, positionY: 51, scaleX: 1, scaleY: 1, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0, boundsType: 'OBS_BOUNDS_NONE', boundsWidth: 0, boundsHeight: 0 } },
    { sourceName: MUSIC_NAME, sourceType: 'OBS_SOURCE_TYPE_INPUT', sceneItemEnabled: true, sceneItemTransform: { positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0, boundsType: 'OBS_BOUNDS_NONE', boundsWidth: 0, boundsHeight: 0 } },
    { sourceName: CREDIT_NAME, sourceType: 'OBS_SOURCE_TYPE_INPUT', sceneItemEnabled: true, sceneItemTransform: { positionX: 1070, positionY: 8, scaleX: 1, scaleY: 1, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0, boundsType: 'OBS_BOUNDS_NONE', boundsWidth: 0, boundsHeight: 0 } },
  ],
  inputs: {
    'Town browser': { inputKind: 'browser_source', settings: { url: TOWN_URL }, muted: true, sceneItemEnabled: true },
    'Task background': { inputKind: 'color_source', settings: { color: 0xff211a11 }, sceneItemEnabled: true },
    'Broadcast title': { inputKind: 'text_gdiplus_v3', settings: { text: TITLE }, sceneItemEnabled: true },
    'Current task': { inputKind: 'text_gdiplus_v3', settings: { read_from_file: true, file: TASK_PATH }, sceneItemEnabled: true },
    [MUSIC_NAME]: { inputKind: 'ffmpeg_source', settings: { local_file: MUSIC_PATH, is_local_file: true, looping: true }, muted: false, volumeDb: -24, monitorType: 'OBS_MONITORING_TYPE_NONE', sceneItemEnabled: true },
    [CREDIT_NAME]: { inputKind: 'text_gdiplus_v3', settings: { text: CREDIT_TEXT }, sceneItemEnabled: true },
  },
});

test('accepts the approved isolated scene', () => assert.equal(validateScene(fixture()), true));

test('rejects wrong profile or collection', () => {
  assert.throws(() => validateContext({ profileName: '無標題', collectionName: COLLECTION, programSceneName: SCENE, profiles: [PROFILE], collections: [COLLECTION] }), /Wrong OBS profile/);
  assert.throws(() => validateContext({ profileName: PROFILE, collectionName: '無標題', programSceneName: SCENE, profiles: [PROFILE], collections: [COLLECTION] }), /Wrong OBS scene collection/);
});

test('rejects unknown, nested, or malformed sources', () => {
  const unknown = fixture();
  unknown.sceneItems[0] = { sourceName: 'Desktop Capture', sourceType: 'OBS_SOURCE_TYPE_INPUT', sceneItemEnabled: true };
  assert.throws(() => validateScene(unknown), /Unknown or duplicate/);
  const nested = fixture();
  nested.sceneItems[0].isGroup = true;
  assert.throws(() => validateScene(nested), /Nested\/group/);
  const wrongUrl = fixture();
  wrongUrl.inputs['Town browser'].settings.url = 'file:///C:/secret.html';
  assert.throws(() => validateScene(wrongUrl), /Town browser URL/);
  const unmuted = fixture();
  unmuted.inputs['Town browser'].muted = false;
  assert.throws(() => validateScene(unmuted), /must be muted/);
  const globalMic = fixture();
  globalMic.allInputs = [...Object.entries(globalMic.inputs).map(([inputName, input]) => ({ ...input, inputName })), { inputName: 'Microphone', inputKind: 'wasapi_input_capture' }];
  assert.throws(() => validateScene(globalMic), /exactly six total OBS inputs/);
});

test('rejects wrong music, attribution, and destination', () => {
  const music = fixture();
  music.inputs[MUSIC_NAME].settings.local_file = 'C:/other.mp3';
  assert.throws(() => validateScene(music), /Music file/);
  const credit = fixture();
  credit.inputs[CREDIT_NAME].settings.text = 'unlicensed';
  assert.throws(() => validateScene(credit), /attribution/);
  assert.throws(() => validateDestination({ streamServiceType: 'rtmp_common', streamServiceSettings: { server: STREAM_SERVER, key: 'offline-test-key' } }), /custom RTMPS/);
  assert.throws(() => validateDestination({ streamServiceType: 'rtmp_custom', streamServiceSettings: { server: 'rtmp://other', key: 'offline-test-key' } }), /endpoint/);
  assert.throws(() => validateDestination({ streamServiceType: 'rtmp_custom', streamServiceSettings: { server: STREAM_SERVER, key: '' } }), /empty/);
});

test('redacted status never exposes a simulated key', () => {
  const key = 'offline-test-key-should-not-appear';
  const output = JSON.stringify(redactStatus({ profileName: PROFILE, collectionName: COLLECTION, programSceneName: SCENE, stream: { outputActive: false }, recording: { outputActive: false }, video: { outputWidth: 1920, outputHeight: 1080, fpsNumerator: 30, fpsDenominator: 1 }, inputs: [{ inputName: MUSIC_NAME, inputKind: 'ffmpeg_source' }], streamServiceSettings: { key } }));
  assert(!output.includes(key));
  assert.equal(MUSIC_SHA256.length, 64);
});

test('API error comments are never included in public errors', () => {
  const error = safeApiError('SetStreamServiceSettings', 400, 'stream key=offline-secret-should-not-appear');
  assert(!error.message.includes('offline-secret-should-not-appear'));
  assert.match(error.message, /SetStreamServiceSettings failed \(400\)/);
});

test('Advanced encoder settings require CBR 6000 and a two-second keyframe interval', () => {
  assert.equal(validateEncoderSettings({ rate_control: 'CBR', bitrate: 6000, keyint_sec: 2 }), true);
  assert.throws(() => validateEncoderSettings({ rate_control: 'CBR', bitrate: 6000, keyint_sec: 250 }), /CBR\/keyframe/);
});

test('refresh-browser preflights then refreshes only the approved browser source', async () => {
  const calls=[];
  const originalFetch=globalThis.fetch;
  let frame=0;globalThis.fetch=async url=>String(url).endsWith('/')?{ok:true,text:async()=>'<html>town</html>'}:{ok:true,json:async()=>({world:{frame:++frame}})};
  try {
    await refreshBrowser(async(method,params)=>{calls.push({method,params});const data=fixture();if(method==='GetProfileList')return{currentProfileName:PROFILE,profiles:[{profileName:PROFILE}]};if(method==='GetSceneCollectionList')return{currentSceneCollectionName:COLLECTION,sceneCollections:[{scName:COLLECTION}]};if(method==='GetCurrentProgramScene')return{currentProgramSceneName:SCENE};if(method==='GetSceneItemList')return{sceneItems:data.sceneItems};if(method==='GetInputList')return{inputs:Object.entries(data.inputs).map(([inputName,input])=>({...input,inputName}))};if(method==='GetInputSettings')return{inputSettings:data.inputs[params.inputName].settings};if(method==='GetInputMute')return{inputMuted:data.inputs[params.inputName].muted};if(method==='GetInputVolume')return{inputVolumeDb:-24};if(method==='GetInputAudioMonitorType')return{monitorType:'OBS_MONITORING_TYPE_NONE'};if(method==='GetStreamServiceSettings')return{streamServiceType:'rtmp_custom',streamServiceSettings:{server:STREAM_SERVER,key:''}};if(method==='GetVideoSettings')return{outputWidth:1920,outputHeight:1080,fpsNumerator:30,fpsDenominator:1};if(method==='PressInputPropertiesButton')return{};throw new Error(`unexpected ${method}`);});
  } finally { globalThis.fetch=originalFetch; }
  assert.deepEqual(calls.at(-1),{method:'PressInputPropertiesButton',params:{inputName:'Town browser',propertyName:'refreshnocache'}});
  assert.equal(calls.filter(call=>call.method==='PressInputPropertiesButton').length,1);
});
