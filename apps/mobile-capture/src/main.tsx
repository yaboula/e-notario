import {useCallback, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ApiError, CaptureApi, explain, instructions, type Capture, type CaptureSide, type DocumentExtraction, type DocumentSummary} from '@notario/api-client';
import {AppTheme, Brand, Button, Alert, CircularProgress, ProtectedImage, CardIllustration, Dialog,
  DialogTitle, DialogContent, DialogActions, LinearProgress, AlertCircle, Eye,
  Smartphone, ShieldCheck, Camera, Upload, CheckCircle2, RotateCcw, Sun, Focus, Layers3, QrCode, ArrowRight, ChevronDown} from '@notario/ui';

type Phase = 'pair' | 'ready' | 'camera' | 'preview' | 'sending' | 'result' | 'review';

const REVIEW_GROUPS=[
  {title:'Identidad',keys:['national_id','given_names_ar','given_names_latin','surname_ar','surname_latin']},
  {title:'Nacimiento',keys:['birth_date','birth_place_ar','birth_place_latin']},
  {title:'Documento',keys:['expiry_date','sex']},
  {title:'Filiación y domicilio',keys:['filiation_ar','filiation_latin','address_ar','address_latin']},
];
const REVIEW_LABELS:Record<string,string>={national_id:'Número nacional (CIN)',given_names_ar:'Nombre · árabe',given_names_latin:'Nombre · latino',surname_ar:'Apellidos · árabe',surname_latin:'Apellidos · latino',birth_date:'Fecha de nacimiento',birth_place_ar:'Lugar de nacimiento · árabe',birth_place_latin:'Lugar de nacimiento · latino',expiry_date:'Fecha de caducidad',sex:'Sexo',filiation_ar:'Filiación · árabe',filiation_latin:'Filiación · latino',address_ar:'Domicilio · árabe',address_latin:'Domicilio · latino'};
const REVIEW_KEYS=REVIEW_GROUPS.flatMap(group=>group.keys);
function reviewValue(value:unknown){return Array.isArray(value)?value.join('\n'):value==null?'':String(value)}
function editableReviewValue(key:string,value:unknown){const output=reviewValue(value);return key==='sex'&&!['M','F'].includes(output.toUpperCase())?'':output}

export function MobileStructuredReview({api,document,captures,onClose}:{api:CaptureApi;document:DocumentSummary;captures:Capture[];onClose:()=>void}){
  const [data,setData]=useState<DocumentExtraction|null>(null);
  const [drafts,setDrafts]=useState<Record<string,string>>({});
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');
  const [viewerSide,setViewerSide]=useState<CaptureSide|null>(null);
  const [openSections,setOpenSections]=useState<Record<string,boolean>>({'Identidad':true});
  const serverValues=useRef<Record<string,string>>({});
  const requestVersion=useRef(0);
  const acceptServerData=useCallback((next:DocumentExtraction)=>{setData(next);setDrafts(current=>{const values={...current};const received:Record<string,string>={};Object.entries(next.fields).forEach(([key,field])=>{const value=editableReviewValue(key,next.reviews[key]?.value??field.normalized_value);received[key]=value;const previous=serverValues.current[key];const locallyEdited=key in current&&previous!==undefined&&current[key]!==previous;if(!(key in current)||!locallyEdited)values[key]=value});serverValues.current=received;return values})},[]);
  const load=useCallback(async(silent=false)=>{const request=++requestVersion.current;if(!silent)setLoading(true);try{const next=await api.extraction(document.id);if(request===requestVersion.current)acceptServerData(next)}catch(error){if(request===requestVersion.current)setMessage(explain(error))}finally{if(!silent&&request===requestVersion.current)setLoading(false)}},[acceptServerData,api,document.id]);
  useEffect(()=>{void load()},[load]);
  useEffect(()=>{if(!loading&&data&&(data.revision!==document.extraction_summary.revision||data.status!==document.extraction_summary.status))void load(true)},[data?.revision,data?.status,document.extraction_summary.revision,document.extraction_summary.status,loading,load]);
  const save=async(fields:Record<string,{decision:'confirmed'|'corrected'|'absent';value:unknown}>,success:string)=>{if(!data||data.status==='approved')return;requestVersion.current+=1;setLoading(true);setMessage('');try{const next=await api.reviewExtraction(document.id,data.revision,fields);acceptServerData(next);setMessage(success)}catch(error){if(error instanceof ApiError&&error.code==='EXTRACTION_STALE_REVISION'){await load();setMessage('La revisión cambió en Windows. Se han recargado los datos sin enviar tu borrador.')}else setMessage(explain(error))}finally{setLoading(false)}};
  const reviewPayload=(keys:string[])=>{if(!data)return null;const fields:Record<string,{decision:'confirmed'|'corrected';value:unknown}>={};for(const key of keys){const field=data.fields[key];if(!field)continue;const value=(drafts[key]||'').trim();if(!value)return {missing:key,fields};const predicted=editableReviewValue(key,field.normalized_value);const submitted=key.startsWith('filiation_')||key.startsWith('address_')?value.split('\n').map(line=>line.trim()).filter(Boolean):value;fields[key]={decision:value===predicted?'confirmed':'corrected',value:submitted}}return {missing:null,fields}};
  const confirmGroup=async(keys:string[])=>{const payload=reviewPayload(keys);if(!payload)return;if(payload.missing){setMessage(`Completa ${REVIEW_LABELS[payload.missing]} antes de confirmar esta categoría.`);return}await save(payload.fields,`${keys.length} campos confirmados.`)};
  const acceptAll=async()=>{if(!data||approved)return;const payload=reviewPayload(REVIEW_KEYS);if(!payload)return;if(payload.missing){setMessage(`Completa ${REVIEW_LABELS[payload.missing]} antes de aprobar.`);return}requestVersion.current+=1;setLoading(true);setMessage('');try{const reviewed=await api.reviewExtraction(document.id,data.revision,payload.fields);acceptServerData(reviewed);const next=await api.approveExtraction(document.id,reviewed.revision);acceptServerData(next);setMessage('Todos los campos se han aceptado. La exportación está disponible en Windows.')}catch(error){if(error instanceof ApiError&&error.code==='EXTRACTION_STALE_REVISION'){await load();setMessage('La revisión cambió en Windows. Comprueba los datos recargados.')}else setMessage(explain(error))}finally{setLoading(false)}};
  const total=data?REVIEW_KEYS.filter(key=>data.fields[key]).length:14;
  const reviewed=data?Object.keys(data.reviews).length:0;
  const pending=Math.max(0,total-reviewed);
  const progress=total?Math.round(reviewed/total*100):0;
  const approved=data?.status==='approved';
  const viewerId=viewerSide==='front'?document.front_capture_id:document.back_capture_id;
  const viewerCapture=captures.find(item=>item.id===viewerId);
  const viewerImage=useCallback((signal:AbortSignal)=>viewerCapture?api.image(viewerCapture.id,'rectified',signal):Promise.reject(new Error('IMAGE_UNAVAILABLE')),[api,viewerCapture?.id]);
  return <div className="mobile-review-page">
    <div className="mobile-review-top"><button type="button" onClick={onClose} aria-label="Volver">←</button><div><span>REVISIÓN DE DATOS</span><strong>{approved?'Datos aprobados':'Comprueba los 14 campos'}</strong></div><span className={approved?'approved':''}>{approved?'Aprobado':`${pending} pendientes`}</span></div>
    <div className="mobile-review-progress"><LinearProgress variant="determinate" value={progress}/><small>{reviewed} de {total} revisados</small></div>
    <div className="mobile-review-images"><Button size="small" startIcon={<Eye size={14}/>} onClick={()=>setViewerSide('front')}>Ver anverso</Button><Button size="small" startIcon={<Eye size={14}/>} onClick={()=>setViewerSide('back')}>Ver reverso</Button></div>
    {message&&<Alert severity={message.includes('correctamente')||message.includes('confirmados')||message.includes('aprobados')?'success':'info'} onClose={()=>setMessage('')}>{message}</Alert>}
    {loading&&!data?<div className="mobile-review-loading"><CircularProgress size={28}/><span>Cargando revisión…</span></div>:data&&<div className="mobile-review-sections">{REVIEW_GROUPS.map(group=>{const keys=group.keys.filter(key=>data.fields[key]);const count=keys.filter(key=>data.reviews[key]).length;return <details className="mobile-review-section" key={group.title} open={Boolean(openSections[group.title])} onToggle={event=>{const open=event.currentTarget.open;setOpenSections(current=>current[group.title]===open?current:{...current,[group.title]:open})}}><summary><div><strong>{group.title}</strong><small>{count}/{keys.length} revisados</small></div><ChevronDown size={17}/></summary><div className="mobile-review-section-body">{!approved&&<Button size="small" variant="contained" disabled={loading} onClick={()=>confirmGroup(keys)}>Confirmar categoría</Button>}{keys.map(key=>{const field=data.fields[key];const review=data.reviews[key];const rtl=key.endsWith('_ar');const multiline=key.startsWith('filiation')||key.startsWith('address');return <div className={`mobile-review-field ${review?.decision||(!field.warnings.length?'pending':'warning')}`} key={key}><div className="mobile-review-label"><label htmlFor={`mobile-${key}`}>{REVIEW_LABELS[key]}</label><span>{review?.decision==='corrected'?'Corregido':review?'Confirmado':field.warnings.length?'Revisar':'Pendiente'}</span></div>{key==='sex'?<select id={`mobile-${key}`} disabled={approved} value={drafts[key]||''} onChange={event=>setDrafts(current=>({...current,[key]:event.target.value}))}><option value="">Selecciona el sexo impreso</option><option value="F">F · Femenino</option><option value="M">M · Masculino</option></select>:multiline?<textarea id={`mobile-${key}`} dir={rtl?'rtl':'ltr'} readOnly={approved} autoComplete="off" spellCheck={false} value={drafts[key]||''} onChange={event=>setDrafts(current=>({...current,[key]:event.target.value}))}/>:<input id={`mobile-${key}`} dir={rtl?'rtl':'ltr'} readOnly={approved} autoComplete="off" spellCheck={false} value={drafts[key]||''} onChange={event=>setDrafts(current=>({...current,[key]:event.target.value}))}/>}<div className="mobile-review-meta"><small>{field.source_side==='back'?'Reverso':'Anverso'} · {field.confidence==null?'confianza no disponible':`${Math.round(field.confidence*100)} %`}</small></div>{field.warnings.length>0&&!review&&<div className="mobile-review-warning"><AlertCircle size={13}/><span>Comprueba este valor antes de confirmar la categoría.</span></div>}</div>})}</div></details>})}</div>}
    <div className="mobile-review-approval"><div><ShieldCheck size={15}/><span>{approved?'Revisión cerrada. Exporta desde Windows.':'Puedes confirmar por categoría o aprobar todos los campos visibles.'}</span></div><Button fullWidth variant="contained" disabled={loading||approved} onClick={acceptAll}>{approved?'Datos aprobados':loading?'Validando…':'Aceptar todo y aprobar'}</Button></div>
    <Dialog open={viewerSide!==null} onClose={()=>setViewerSide(null)} fullScreen><DialogTitle>CNIE · {viewerSide==='back'?'Reverso':'Anverso'}</DialogTitle><DialogContent className="mobile-document-viewer">{viewerSide&&viewerCapture&&<ProtectedImage load={viewerImage} alt={`CNIE · ${viewerSide}`}/>}</DialogContent><DialogActions><Button disabled={viewerSide==='front'} onClick={()=>setViewerSide('front')}>Anverso</Button><Button disabled={viewerSide==='back'} onClick={()=>setViewerSide('back')}>Reverso</Button><Button onClick={()=>setViewerSide(null)}>Cerrar</Button></DialogActions></Dialog>
  </div>;
}

function App() {
  const [api, setApi] = useState<CaptureApi | null>(null);
  const [phase, setPhase] = useState<Phase>('pair');
  const [side, setSide] = useState<CaptureSide>('front');
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState('');
  const [result, setResult] = useState<Capture | null>(null);
  const [documentId, setDocumentId] = useState<string | undefined>();
  const [documentInfo,setDocumentInfo]=useState<DocumentSummary|null>(null);
  const [documentCaptures,setDocumentCaptures]=useState<Capture[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pairStarted = useRef(false);
  const uploadKey = useRef(crypto.randomUUID());
  const mounted = useRef(true);

  function stopCamera() {stream.current?.getTracks().forEach(track => track.stop());stream.current = null}
  useEffect(() => {mounted.current = true;return () => {mounted.current = false;stopCamera()}}, []);
  useEffect(() => {
    if (!photo) {setPreview('');return}
    const url = URL.createObjectURL(photo); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  useEffect(() => {
    if (pairStarted.current) return;
    pairStarted.current = true;
    const params = new URLSearchParams(location.hash.slice(1));
    const code = params.get('pair');
    if (code) history.replaceState(null,'',location.pathname);
    async function connect() {
      setConnecting(true);
      try {
        const service = new CaptureApi('', '');
        let token = sessionStorage.getItem('notario.mobile.token');
        if (code) {const paired = await service.pair(code);token = paired.token;sessionStorage.setItem('notario.mobile.token', token)}
        if (token) {service.token = token;await service.workspace();setApi(service);setPhase('ready')}
      } catch (e) {sessionStorage.removeItem('notario.mobile.token');setError(explain(e))}
      finally {setConnecting(false)}
    }
    void connect();
  }, []);
  useEffect(() => {
    if (phase === 'camera' && video.current && stream.current) {
      video.current.srcObject = stream.current;
      video.current.play().catch(() => setError('Toca la vista previa para activar la cámara.'));
    }
  }, [phase]);
  useEffect(() => {
    const onHide = () => {if (document.hidden && stream.current) {stopCamera();setPhase('ready')}};
    document.addEventListener('visibilitychange',onHide);return () => document.removeEventListener('visibilitychange',onHide);
  }, []);
  useEffect(() => {
    if (!api || !['result','review'].includes(phase) || !result) return;
    const refresh = () => api.workspace().then(ws => {const updated = ws.captures.find(c => c.id === result.id);if(updated)setResult(updated);const current=ws.documents.find(item=>item.id===result.document_id);if(current){setDocumentInfo(current);setDocumentCaptures(ws.captures.filter(item=>item.document_id===current.id))}}).catch(e => setError(explain(e)));
    const timer = setInterval(refresh,4000);
    const unsubscribe = api.subscribe(refresh);
    return () => {clearInterval(timer);unsubscribe()};
  }, [api, phase, result?.id]);

  async function openCamera() {
    setError('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('Abre la dirección HTTPS de la oficina y confía en su certificado para activar la cámara.');return;
    }
    try {
      stopCamera();
      const media = await navigator.mediaDevices.getUserMedia({audio:false, video:{
        facingMode:{ideal:'environment'},width:{ideal:4096},height:{ideal:3072}
      }});
      if (!mounted.current) {media.getTracks().forEach(track => track.stop());return}
      stream.current = media;setPhase('camera');
    } catch {setError('No se pudo abrir la cámara. Permite su acceso en el navegador o selecciona una fotografía.')}
  }
  function selectPhoto(file?: Blob) {
    if (!file) return;
    if (!['image/jpeg','image/png'].includes(file.type)) {setError('Usa una fotografía JPEG o PNG. HEIC no está admitido.');return}
    if (file.size > 20 * 1024 * 1024) {setError('La fotografía no debe superar 20 MB.');return}
    stopCamera();setPhoto(file);uploadKey.current = crypto.randomUUID();setError('');setPhase('preview');
  }
  async function takePhoto() {
    if (!video.current?.videoWidth) {setError('La cámara todavía se está preparando.');return}
    const canvas = document.createElement('canvas');
    canvas.width = video.current.videoWidth;canvas.height = video.current.videoHeight;
    if (Math.min(canvas.width,canvas.height) < 1200) {
      setError('La vista de cámara tiene poca resolución. Usa «Seleccionar fotografía» para obtener la captura completa.');return;
    }
    const context = canvas.getContext('2d');
    context?.drawImage(video.current,0,0);
    canvas.toBlob(blob => blob ? selectPhoto(blob) : setError('No se pudo capturar la imagen. Inténtalo de nuevo.'),'image/jpeg',0.96);
  }
  async function send() {
    if (!api || !photo || phase === 'sending') return;
    setPhase('sending');setError('');
    try {const capture = await api.upload(photo,side,uploadKey.current,documentId);setDocumentId(capture.document_id);setResult(capture);setDocumentCaptures(current=>[...current.filter(item=>item.id!==capture.id),capture]);setPhoto(null);setPhase('result')}
    catch (e) {setError(explain(e));setPhase('preview')}
  }
  const loadResult = useCallback((signal: AbortSignal) => api!.image(result!.id,'rectified',signal), [api,result?.id]);
  const good = result?.result.status === 'success' && result.review !== 'retake';
  const reset = (keepDocument = false) => {stopCamera();setPhoto(null);setResult(null);setError('');setPhase('ready');if (!keepDocument){setDocumentId(undefined);setDocumentInfo(null);setDocumentCaptures([])}if (input.current) input.current.value = ''};
  const ocrLabel = result?.ocr_summary.status === 'success' ? 'OCR completado en la estación.'
    : result?.ocr_summary.status === 'processing' ? 'OCR en proceso en la estación.'
    : result?.ocr_summary.status === 'queued' ? 'OCR pendiente en la cola.'
    : result?.ocr_summary.status === 'error' || result?.ocr_summary.status === 'no_text' ? 'El OCR necesita atención del operador.'
    : 'Pendiente de aceptación por el operador.';

  return <div className="mobile-shell"><header className="mobile-header"><Brand compact/><small>{api ? 'OFICINA CONECTADA' : 'CAPTURA MÓVIL'}</small></header><main className="mobile-content">
    {phase!=='review'&&<div className="mobile-steps" aria-label="Progreso"><span className="active"/><span className={['camera','preview','sending','result'].includes(phase) ? 'active' : ''}/><span className={phase === 'result' ? 'active' : ''}/></div>}
    {error && <Alert severity="warning" className="error-banner" onClose={() => setError('')}>{error}</Alert>}
    {phase === 'pair' ? <div className="mobile-panel"><div className="connection-hero">{connecting ? <CircularProgress size={32}/> : <QrCode size={41}/>}</div><div className="eyebrow">DE TU MÓVIL A TU OFICINA</div><h1>{connecting ? 'Conectando con tu PC…' : 'Todo empieza con un QR.'}</h1><p>En e-notario para Windows, pulsa «Conectar móvil» y escanea el código con la cámara de tu teléfono.</p><p style={{marginTop:18}}>Conecta ambos dispositivos a la misma red de la oficina.</p></div> : phase==='review'&&api&&documentInfo?<MobileStructuredReview api={api} document={documentInfo} captures={documentCaptures} onClose={()=>setPhase('result')}/>:phase === 'result' && result ? <><div className="eyebrow">CAPTURA RECIBIDA</div><h1>{good ? result.review === 'accepted' ? 'Imagen aceptada.' : 'Lista para revisar.' : 'Vamos a mejorarla.'}</h1><p className="mobile-lead">{good ? 'La fotografía está protegida en tu PC. Cuando terminen ambas caras podrás revisar aquí los datos estructurados.' : 'La captura necesita otra fotografía. Sigue la indicación y vuelve a intentarlo.'}</p><section className="mobile-result"><h2>{good ? <CheckCircle2 size={19}/> : <RotateCcw size={19}/>}CNIE · {result.side === 'front' ? 'Anverso' : 'Reverso'}</h2>{good ? <><p>{ocrLabel}</p><ProtectedImage load={loadResult} alt="Tarjeta rectificada"/></> : <p>{result.review === 'retake' ? 'El operador ha solicitado repetir esta fotografía.' : instructions[result.result.rejection_codes[0]] || 'Coloca la tarjeta completa sobre un fondo contrastante y mejora la iluminación.'}</p>}</section><div className="mobile-actions" style={{marginTop:24}}>{documentInfo&&['data_review_required','ready'].includes(documentInfo.status)&&<Button variant="contained" startIcon={<ShieldCheck size={18}/>} onClick={()=>setPhase('review')}>{documentInfo.status==='ready'?'Ver datos aprobados':'Revisar datos'}</Button>}<Button variant={documentInfo&&['data_review_required','ready'].includes(documentInfo.status)?'outlined':'contained'} startIcon={good ? <Camera size={18}/> : <RotateCcw size={18}/>} onClick={() => {reset(true);if (good) setSide(side === 'front' ? 'back' : 'front')}}>{good ? 'Capturar la otra cara' : 'Repetir captura'}</Button><Button onClick={() => reset(false)}>Nueva tarjeta</Button></div></> : <>
      <div className="eyebrow">CAPTURA DEL DOCUMENTO</div><h1>{phase === 'preview' ? 'Un último vistazo.' : phase === 'sending' ? 'Enviando a tu oficina…' : 'Acerca. Encuadra. Captura.'}</h1><p className="mobile-lead">{phase === 'preview' ? 'Comprueba que el texto está nítido y no hay reflejos.' : 'Una sola tarjeta, las cuatro esquinas visibles y luz suave.'}</p>
      <div className="side-toggle" style={{width:'fit-content'}}>{(['front','back'] as const).map(value => <button key={value} className={side === value ? 'selected' : ''} disabled={phase === 'sending'} onClick={() => setSide(value)} aria-pressed={side === value}>{value === 'front' ? 'Anverso' : 'Reverso'}</button>)}</div>
      <div className="camera-surface">{phase === 'camera' ? <><video ref={video} autoPlay playsInline muted onClick={() => video.current?.play()}/><div className="camera-guide"/></> : phase === 'preview' || phase === 'sending' ? <><img src={preview} alt="Fotografía antes de enviarla" style={{objectFit:'contain'}}/>{phase === 'sending' && <div className="camera-intro"><CircularProgress size={35}/></div>}</> : <div className="camera-intro"><CardIllustration/><p>Coloca la CNIE sobre una superficie mate.</p></div>}</div>
      <div className="mobile-actions">{phase === 'ready' ? <Button variant="contained" startIcon={<Camera size={18}/>} onClick={openCamera}>Abrir cámara</Button> : phase === 'camera' ? <button className="capture-button" aria-label="Tomar fotografía" onClick={takePhoto}><Camera size={25}/></button> : <><Button variant="contained" startIcon={<ArrowRight size={18}/>} disabled={phase === 'sending'} onClick={send}>{phase === 'sending' ? 'Procesando…' : 'Enviar al PC'}</Button><Button disabled={phase === 'sending'} onClick={() => reset()}>Volver a capturar</Button></>}
      {(phase === 'ready' || phase === 'camera') && <Button startIcon={<Upload size={15}/>} onClick={() => input.current?.click()}>Seleccionar fotografía</Button>}</div>
      <div className="mobile-protocol"><span><Focus size={13}/>4 esquinas</span><span><Sun size={13}/>Sin reflejos</span><span><Layers3 size={13}/>Fondo mate</span></div>
    </>}
    <input ref={input} className="hidden-input" type="file" accept="image/jpeg,image/png" capture="environment" aria-label="Seleccionar fotografía de la CNIE" onChange={e => selectPhoto(e.target.files?.[0])}/>
  </main><footer className="mobile-footer"><ShieldCheck size={13}/>Conexión de oficina · Datos temporales durante 60 minutos</footer></div>;
}
const root=document.getElementById('root');
if(root)createRoot(root).render(<AppTheme><App/></AppTheme>);
