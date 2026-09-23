type PhotoCamera = {
  getPhotoCapabilities?: () => Promise<{imageWidth?: {max:number};imageHeight?: {max:number}}>;
  takePhoto: (settings?: {imageWidth?:number;imageHeight?:number}) => Promise<Blob>;
};
type PhotoConstructor = new (track:MediaStreamTrack) => PhotoCamera;

export async function prepareCamera(track:MediaStreamTrack) {
  const capabilities=track.getCapabilities?.() as MediaTrackCapabilities & {focusMode?:string[];exposureMode?:string[]};
  const settings:Record<string,string>={};
  if(capabilities?.focusMode?.includes('continuous'))settings.focusMode='continuous';
  if(capabilities?.exposureMode?.includes('continuous'))settings.exposureMode='continuous';
  if(Object.keys(settings).length)await track.applyConstraints({advanced:[settings]} as MediaTrackConstraints).catch(()=>{});
}

export async function capturePhoto(video:HTMLVideoElement,track:MediaStreamTrack):Promise<Blob> {
  const Photo=(globalThis as typeof globalThis & {ImageCapture?:PhotoConstructor}).ImageCapture;
  if(Photo) {
    try {
      const camera=new Photo(track);
      const caps=await camera.getPhotoCapabilities?.().catch(()=>undefined);
      // Request photographic resolution without cropping or changing camera zoom.
      const width=caps?.imageWidth?.max, height=caps?.imageHeight?.max;
      const settings=width&&height&&width*height<=50_000_000?{imageWidth:width,imageHeight:height}:undefined;
      const photo=await camera.takePhoto(settings).catch(()=>camera.takePhoto());
      if(['image/jpeg','image/png'].includes(photo.type)&&photo.size>0&&photo.size<=20*1024*1024)return photo;
    } catch { /* Browsers can expose ImageCapture without supporting this camera. */ }
  }
  // Preserve the entire video frame on browsers without photographic capture.
  if(!video.videoWidth||video.readyState<2)throw new Error('CAMERA_NOT_READY');
  if(Math.min(video.videoWidth,video.videoHeight)<1200)throw new Error('CAMERA_LOW_RESOLUTION');
  const canvas=document.createElement('canvas');
  canvas.width=video.videoWidth;canvas.height=video.videoHeight;
  const context=canvas.getContext('2d');
  if(!context)throw new Error('CAMERA_CAPTURE_FAILED');
  context.drawImage(video,0,0);
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('CAMERA_CAPTURE_FAILED')),'image/jpeg',0.96));
}
