// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {AppTheme} from '@notario/ui';
import {CaptureApi, type Capture, type Workspace} from '@notario/api-client';
import packageInfo from '../package.json';
import {capturePhoto} from './camera';
import {CornerEditor, defaultCorners, validCorners} from './CornerEditor';
import {App} from './main';

afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();sessionStorage.clear()});

describe('photographic capture',()=>{
  it('uses the camera photo even when the video preview has low resolution',async()=>{
    const photo=new Blob(['native-camera-photo'],{type:'image/jpeg'});
    const takePhoto=vi.fn().mockResolvedValue(photo);
    const caps=vi.fn().mockResolvedValue({imageWidth:{max:4032},imageHeight:{max:3024}});
    vi.stubGlobal('ImageCapture',class {getPhotoCapabilities=caps;takePhoto=takePhoto});
    const video={videoWidth:1280,videoHeight:720,readyState:2} as HTMLVideoElement;
    expect(await capturePhoto(video,{} as MediaStreamTrack)).toBe(photo);
    expect(takePhoto).toHaveBeenCalledWith({imageWidth:4032,imageHeight:3024});
  });
  it('falls back to the full video frame when photographic capture fails',async()=>{
    vi.stubGlobal('ImageCapture',class {takePhoto=vi.fn().mockRejectedValue(new Error('unsupported'))});
    const photo=new Blob(['full-frame'],{type:'image/jpeg'}),draw=vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:draw} as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(function(this:HTMLCanvasElement,callback){
      expect([this.width,this.height]).toEqual([2400,1800]);callback(photo);
    });
    const video={videoWidth:2400,videoHeight:1800,readyState:2} as HTMLVideoElement;
    expect(await capturePhoto(video,{} as MediaStreamTrack)).toBe(photo);
    expect(draw).toHaveBeenCalledWith(video,0,0);
  });
  it('keeps the resolution check on browsers without photographic capture',async()=>{
    vi.stubGlobal('ImageCapture',undefined);
    await expect(capturePhoto({videoWidth:1280,videoHeight:720,readyState:2} as HTMLVideoElement,{} as MediaStreamTrack)).rejects.toThrow('CAMERA_LOW_RESOLUTION');
  });
});

it('allows keyboard adjustment and detects crossed corners',()=>{
  const change=vi.fn();
  render(<CornerEditor src="blob:local-only" corners={defaultCorners} onChange={change}/>);
  fireEvent.keyDown(screen.getByRole('button',{name:'Coin supérieur gauche'}),{key:'ArrowRight'});
  expect(change.mock.calls[0][0][0][0]).toBeCloseTo(.122);
  expect(validCorners(defaultCorners)).toBe(true);
  expect(validCorners([defaultCorners[0],defaultCorners[2],defaultCorners[1],defaultCorners[3]])).toBe(false);
});

it('includes corner selection in the authenticated upload without modifying the original',async()=>{
  const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({})});vi.stubGlobal('fetch',fetch);
  const original=new Blob(['original'],{type:'image/png'});
  await new CaptureApi('','local-token').upload(original,'back',crypto.randomUUID(),'doc','CNIE_MA_LEGACY',defaultCorners);
  const [url,options]=fetch.mock.calls[0];
  expect(url).toContain('card_model=CNIE_MA_LEGACY');expect(options.body).toBe(original);
  expect(options.headers['X-Document-Corners']).toBe(JSON.stringify({corners:defaultCorners}));
});

it('recovers a rejected mobile capture from its protected original and reuses its document',async()=>{
  sessionStorage.setItem('notario.mobile.token','local-review-token');
  vi.stubGlobal('URL',class extends URL {static createObjectURL=vi.fn(()=> 'blob:local-preview');static revokeObjectURL=vi.fn()});
  vi.spyOn(CaptureApi.prototype,'health').mockResolvedValue({status:'ok',version:packageInfo.version,api_version:2});
  const workspace={storage_error:null,documents:[],captures:[],connected_devices:1,processing:false,mobile_url:null,lan_mode:null,retention_minutes:1440,approved_identities:[],document_generation_requests:[],case_drafts:[]} as Workspace;
  vi.spyOn(CaptureApi.prototype,'workspace').mockResolvedValue(workspace);
  vi.spyOn(CaptureApi.prototype,'subscribe').mockReturnValue(()=>{});
  const rejected={id:'capture',document_id:'document',side:'front',source:'mobile',active:true,review:'retake',attempt:1,
    result:{status:'recapture_required',original_dimensions:[2400,1800],corners:null,opencv:{valid:false,score:null},docquadnet:{valid:false,score:null},rejection_codes:['NO_DOCUMENT_QUADRILATERAL']},
    ocr_summary:{status:'not_started'}} as Capture;
  const upload=vi.spyOn(CaptureApi.prototype,'upload').mockResolvedValue(rejected);
  const original=new Blob(['protected-original'],{type:'image/jpeg'});
  const image=vi.spyOn(CaptureApi.prototype,'image').mockResolvedValue(original);
  render(<AppTheme><App/></AppTheme>);
  await screen.findByRole('button',{name:'Ouvrir la caméra'});
  fireEvent.change(screen.getByLabelText('Sélectionner une photo de la CNIE'),{target:{files:[new File(['first'],'first.jpg',{type:'image/jpeg'})]}});
  fireEvent.click(screen.getByRole('button',{name:'Envoyer au PC'}));
  fireEvent.click(await screen.findByRole('button',{name:'Ajuster les bords'}));
  await screen.findByRole('button',{name:'Utiliser la détection automatique'});
  expect(image).toHaveBeenCalledWith('capture','original',expect.any(AbortSignal));
  fireEvent.click(screen.getByRole('button',{name:'Envoyer au PC'}));
  await waitFor(()=>expect(upload).toHaveBeenCalledTimes(2));
  expect(upload.mock.calls[1][0]).toBe(original);
  expect(upload.mock.calls[1][3]).toBe('document');
  expect(upload.mock.calls[1][5]).toEqual(defaultCorners);
  // A late original download must not reopen the previous card after reset.
  let finish:(blob:Blob)=>void=()=>{};
  image.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));
  fireEvent.click(await screen.findByRole('button',{name:'Ajuster les bords'}));
  await waitFor(()=>expect(image).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button',{name:'Nouvelle carte'}));
  finish(original);
  await screen.findByRole('button',{name:'Ouvrir la caméra'});
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Utiliser la détection automatique'})).toBeNull());
});
