import {useEffect, useState, type RefObject} from 'react';
import {type CaptureApi, type CapturePreview} from '@notario/api-client';
import {useUiLocale} from '@notario/ui';

const messages={
  fr:{searching:'Montrez les quatre coins sur un fond contrasté.',closer:'Rapprochez légèrement la caméra.',margin:'Laissez une marge autour de la carte.',lighting:'Cherchez un éclairage plus uniforme.',ready:'Contour détecté. Vérifiez la mise au point et prenez la photo.'},
  ar:{searching:'أظهر الزوايا الأربع على خلفية متباينة.',closer:'قرّب الكاميرا قليلاً.',margin:'اترك هامشاً حول البطاقة.',lighting:'استخدم إضاءة أكثر تجانساً.',ready:'تم اكتشاف المحيط. تحقق من التركيز والتقط الصورة.'},
};

export function CameraGuide({api,video,paused}:{api:CaptureApi;video:RefObject<HTMLVideoElement|null>;paused:boolean}) {
  const {locale}=useUiLocale();
  const [preview,setPreview]=useState<CapturePreview|null>(null);
  useEffect(()=>{
    if(paused)return;
    let cancelled=false, timer:ReturnType<typeof setTimeout>;
    const controller=new AbortController();
    const canvas=document.createElement('canvas');
    async function update() {
      try {
        const view=video.current;
        if(view&&view.readyState>=2&&view.videoWidth) {
          const scale=Math.min(1,640/Math.max(view.videoWidth,view.videoHeight));
          canvas.width=Math.round(view.videoWidth*scale);canvas.height=Math.round(view.videoHeight*scale);
          const context=canvas.getContext('2d');
          if(context) {
            context.drawImage(view,0,0,canvas.width,canvas.height);
            const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',.8));
            if(blob&&!cancelled) {
              const request=new AbortController();
              const abort=()=>request.abort();controller.signal.addEventListener('abort',abort,{once:true});
              const timeout=setTimeout(abort,2500);
              try {
                const next=await api.capturePreview(blob,request.signal);
                if(!cancelled)setPreview(next);
              } finally {clearTimeout(timeout);controller.signal.removeEventListener('abort',abort)}
            }
          }
        }
      } catch {if(!cancelled)setPreview(null)}
      if(!cancelled)timer=setTimeout(()=>void update(),900);
    }
    void update();
    return()=>{cancelled=true;clearTimeout(timer);controller.abort()};
  },[api,video,paused]);
  const width=preview?.dimensions[0]||640,height=preview?.dimensions[1]||480;
  return <div className="live-camera-guide">
    {preview?.corners&&<svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-label={locale==='ar'?'محيط البطاقة المكتشف':'Contour détecté de la carte'}><polygon points={preview.corners.map(([x,y])=>`${x*(width-1)},${y*(height-1)}`).join(' ')} fill="none" stroke={preview.guidance==='ready'?'#54dc89':'#ffad61'} strokeWidth={Math.max(width,height)*.004}/></svg>}
    <p role="status">{paused?(locale==='ar'?'جارٍ التقاط الصورة…':'Prise de la photo…'):preview?messages[locale][preview.guidance]:(locale==='ar'?'اترك الزوايا الأربع ظاهرة وانتظر حتى يصبح النص واضحاً.':'Laissez les quatre coins visibles et attendez que le texte soit net.')}</p>
  </div>;
}
