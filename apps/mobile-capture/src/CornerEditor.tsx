import {useRef, useState, type PointerEvent} from 'react';
import type {CardCorners} from '@notario/api-client';
import {useUiLocale} from '@notario/ui';

export const defaultCorners:CardCorners=[[.12,.18],[.88,.18],[.88,.82],[.12,.82]];
const labels={fr:['supérieur gauche','supérieur droit','inférieur droit','inférieur gauche'],ar:['العلوية اليسرى','العلوية اليمنى','السفلية اليمنى','السفلية اليسرى']};

export function validCorners(corners:CardCorners) {
  if(corners.length!==4||corners.some(point=>point.some(value=>!Number.isFinite(value)||value<0||value>1)))return false;
  const crosses=corners.map((a,i)=>{
    const b=corners[(i+1)%4],c=corners[(i+2)%4];
    return (b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
  });
  return crosses.every(value=>value>0.0001)||crosses.every(value=>value<-.0001);
}

export function CornerEditor({src,corners,onChange,disabled=false}:{src:string;corners:CardCorners;onChange:(corners:CardCorners)=>void;disabled?:boolean}) {
  const {locale}=useUiLocale();
  const svg=useRef<SVGSVGElement>(null);
  const drag=useRef<number|null>(null);
  const [size,setSize]=useState<[number,number]>([1000,750]);
  const radius=Math.max(...size)*.035;
  function move(event:PointerEvent<SVGSVGElement>) {
    if(disabled||drag.current===null||!svg.current)return;
    const matrix=svg.current.getScreenCTM();
    if(!matrix)return;
    const point=svg.current.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
    const mapped=point.matrixTransform(matrix.inverse());
    const next=corners.map(point=>[...point] as [number,number]);
    next[drag.current]=[Math.max(0,Math.min(1,mapped.x/size[0])),Math.max(0,Math.min(1,mapped.y/size[1]))];
    onChange(next);
  }
  return <div className="corner-editor">
    <img src={src} alt={locale==='ar'?'الصورة الأصلية لضبط الحواف':'Photo originale pour ajuster les bords'} onLoad={event=>setSize([event.currentTarget.naturalWidth,event.currentTarget.naturalHeight])}/>
    <svg ref={svg} viewBox={`0 0 ${size[0]} ${size[1]}`} preserveAspectRatio="xMidYMid meet" aria-label={locale==='ar'?'ضبط الزوايا الأربع':'Ajuster les quatre coins'} onPointerMove={move} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}>
      <polygon points={corners.map(([x,y])=>`${x*size[0]},${y*size[1]}`).join(' ')} fill="rgba(34,197,94,.10)" stroke={validCorners(corners)?'#54dc89':'#ffad61'} strokeWidth={radius*.15}/>
      {corners.map(([x,y],index)=><g key={index} role="button" aria-label={`${locale==='ar'?'الزاوية':'Coin'} ${labels[locale][index]}`} aria-disabled={disabled} tabIndex={disabled?-1:0}
        onPointerDown={event=>{if(disabled)return;event.preventDefault();drag.current=index;svg.current?.setPointerCapture(event.pointerId)}}
        onKeyDown={event=>{
          const delta:Record<string,[number,number]>={ArrowLeft:[-.002,0],ArrowRight:[.002,0],ArrowUp:[0,-.002],ArrowDown:[0,.002]};
          if(disabled||!delta[event.key])return;event.preventDefault();
          const next=corners.map(point=>[...point] as [number,number]);
          next[index]=[Math.max(0,Math.min(1,x+delta[event.key][0])),Math.max(0,Math.min(1,y+delta[event.key][1]))];onChange(next);
        }}>
        <circle cx={x*size[0]} cy={y*size[1]} r={radius*2} fill="transparent"/>
        <circle cx={x*size[0]} cy={y*size[1]} r={radius*.55} fill="#fff" stroke="#22884d" strokeWidth={radius*.12}/>
      </g>)}
    </svg>
  </div>;
}
