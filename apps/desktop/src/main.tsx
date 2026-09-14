import {useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient, QueryClientProvider, useQuery, useQueryClient} from '@tanstack/react-query';
import {QRCodeSVG} from 'qrcode.react';
import {ApiError, CaptureApi, explain, instructions, type Capture, type CaptureSide, type DocumentSummary, type Pairing} from '@notario/api-client';
import {AppTheme, Brand, CardIllustration, Status, ProtectedImage, Button, IconButton, Dialog,
  DialogTitle, DialogContent, DialogActions, Alert, Tooltip, CircularProgress, ScanLine,
  Smartphone, Settings2, ShieldCheck, Plus, Upload, ChevronDown, ChevronRight, CircleHelp,
  Monitor, QrCode, ArrowUpRight, Check, RotateCcw, Trash2, Download, FileImage, Clock3, Wifi,
  Sun, Focus, Move, Maximize2, Layers3, X, Link2, RefreshCw, Tabs, Tab, Eye, Copy,
  AlertCircle, LinearProgress} from '@notario/ui';

const client = new QueryClient({defaultOptions:{queries:{retry:1, refetchOnWindowFocus:true}}});
type Page = 'capture' | 'devices' | 'diagnostics';

function CaptureImages({api, capture}: {api: CaptureApi; capture: Capture}) {
  const original = useCallback((signal: AbortSignal) => api.image(capture.id, 'original', signal), [api, capture.id]);
  const rectified = useCallback((signal: AbortSignal) => api.image(capture.id, 'rectified', signal), [api, capture.id]);
  return <div className="inspection-grid"><div className="inspection-pane"><span className="inspection-label">ORIGINAL</span><ProtectedImage load={original} alt="Fotografía original de la tarjeta"/></div>
    <div className="inspection-pane"><span className="inspection-label">RECTIFICADA · 1600 × 1008</span>{capture.result.status === 'success' ? <ProtectedImage load={rectified} alt="Tarjeta rectificada para revisión"/> : <div className="stage-empty" style={{height:'100%',padding:25}}><RotateCcw size={30}/><h3>Hace falta otra captura</h3><p>{instructions[capture.result.rejection_codes[0]] || 'Comprueba la iluminación y muestra las cuatro esquinas.'}</p></div>}</div></div>;
}

const FIELD_GROUPS = [
  {title:'Identidad',keys:['national_id','given_names_ar','given_names_latin','surname_ar','surname_latin']},
  {title:'Nacimiento',keys:['birth_date','birth_place_ar','birth_place_latin']},
  {title:'Documento',keys:['expiry_date','sex']},
  {title:'Filiación y domicilio',keys:['filiation_ar','filiation_latin','address_ar','address_latin']},
];
const FIELD_LABELS:Record<string,string>={national_id:'Número nacional (CIN)',given_names_ar:'Nombre · árabe',given_names_latin:'Nombre · latino',surname_ar:'Apellidos · árabe',surname_latin:'Apellidos · latino',birth_date:'Fecha de nacimiento',birth_place_ar:'Lugar de nacimiento · árabe',birth_place_latin:'Lugar de nacimiento · latino',expiry_date:'Fecha de caducidad',sex:'Sexo',filiation_ar:'Filiación · árabe',filiation_latin:'Filiación · latino',address_ar:'Domicilio · árabe',address_latin:'Domicilio · latino'};
const EXTRACTION_WARNING_LABELS:Record<string,string>={
  EXTRACTION_LOW_CONFIDENCE:'Confianza OCR baja: comprueba el valor con la imagen.',
  EXTRACTION_DATA_CONFLICT:'El valor tiene un formato no válido o no coincide entre las dos caras.',
  EXTRACTION_SIDE_MISMATCH:'El CIN visible no coincide entre el anverso y el reverso.',
  EXTRACTION_REQUIRED_FIELD_MISSING:'Este campo obligatorio no se ha localizado.',
};
function warningText(code:string):string{return EXTRACTION_WARNING_LABELS[code]||code.replaceAll('_',' ').toLowerCase()}

function valueText(value:unknown):string {return Array.isArray(value)?value.join('\n'):value==null?'':String(value)}
function editableValue(key:string,value:unknown):string {const output=valueText(value);return key==='sex'&&!['M','F'].includes(output.toUpperCase())?'':output}

async function copySensitive(value:string) {
  await navigator.clipboard.writeText(value);
  setTimeout(async()=>{try{if(await navigator.clipboard.readText()===value)await navigator.clipboard.writeText('')}catch{}},60000);
}

export function StructuredDataReview({api,document,captures,onChanged}:{api:CaptureApi;document:DocumentSummary;captures:Capture[];onChanged:()=>void}) {
  const queryClient=useQueryClient();
  const extraction=useQuery({queryKey:['extraction',document.id],queryFn:()=>api.extraction(document.id),enabled:['review_required','approved'].includes(document.extraction_summary.status),retry:false,refetchInterval:4000});
  const [drafts,setDrafts]=useState<Record<string,string>>({});
  const [working,setWorking]=useState(false);
  const [message,setMessage]=useState('');
  const [viewerSide,setViewerSide]=useState<CaptureSide|null>(null);
  const fieldRefs=useRef<Record<string,HTMLElement|null>>({});
  const serverValues=useRef<Record<string,string>>({});
  const data=extraction.data;
  const fieldKeys=useMemo(()=>FIELD_GROUPS.flatMap(group=>group.keys),[]);
  const viewerCaptureId=viewerSide==='front'?document.front_capture_id:document.back_capture_id;
  const viewerCapture=captures.find(item=>item.id===viewerCaptureId);
  const viewerImage=useCallback((signal:AbortSignal)=>viewerCapture?api.image(viewerCapture.id,'rectified',signal):Promise.reject(new Error('IMAGE_UNAVAILABLE')),[api,viewerCapture?.id]);

  useEffect(()=>{if(!data)return;setDrafts(current=>{const next={...current};const received:Record<string,string>={};Object.entries(data.fields).forEach(([key,field])=>{const value=editableValue(key,data.reviews[key]?.value??field.normalized_value);received[key]=value;const previous=serverValues.current[key];const locallyEdited=key in current&&previous!==undefined&&current[key]!==previous;if(!(key in current)||!locallyEdited)next[key]=value});serverValues.current=received;return next})},[data?.revision,data?.status]);
  useEffect(()=>{if(data&&(data.revision!==document.extraction_summary.revision||data.status!==document.extraction_summary.status))void extraction.refetch()},[data?.revision,data?.status,document.extraction_summary.revision,document.extraction_summary.status]);

  const focusField=(key:string)=>window.setTimeout(()=>{const element=fieldRefs.current[key];if(typeof element?.scrollIntoView==='function')element.scrollIntoView({block:'center',behavior:'smooth'});element?.focus()},0);
  const handleFailure=async(error:unknown)=>{
    if(error instanceof ApiError&&error.code==='EXTRACTION_STALE_REVISION'){
      await queryClient.invalidateQueries({queryKey:['extraction',document.id]});
      setMessage('Otro dispositivo actualizó esta revisión. Se han recargado los datos; tu borrador local no se ha enviado.');
    }else setMessage(explain(error));
  };
  async function saveFields(fields:Record<string,{decision:'confirmed'|'corrected'|'absent';value:unknown}>,success:string){
    if(!data||data.status==='approved')return;setWorking(true);setMessage('');
    try{const updated=await api.reviewExtraction(document.id,data.revision,fields);queryClient.setQueryData(['extraction',document.id],updated);onChanged();setMessage(success);const next=fieldKeys.find(key=>updated.fields[key]&&!updated.reviews[key]);if(next)focusField(next)}catch(error){await handleFailure(error)}finally{setWorking(false)}
  }
  function reviewPayload(keys:string[]){if(!data)return null;const fields:Record<string,{decision:'confirmed'|'corrected';value:unknown}>={};for(const key of keys){const field=data.fields[key];if(!field)continue;const value=(drafts[key]||'').trim();if(!value)return {missing:key,fields};const predicted=editableValue(key,field.normalized_value);const submitted=key.startsWith('filiation_')||key.startsWith('address_')?value.split('\n').map(line=>line.trim()).filter(Boolean):value;fields[key]={decision:value===predicted?'confirmed':'corrected',value:submitted}}return {missing:null,fields}}
  async function confirmSection(keys:string[]){const payload=reviewPayload(keys);if(!payload)return;if(payload.missing){setMessage(`Completa ${FIELD_LABELS[payload.missing]} antes de confirmar esta sección.`);focusField(payload.missing);return}await saveFields(payload.fields,`${keys.length} campos confirmados en esta sección.`)}
  async function acceptAll(){if(!data||data.status==='approved')return;const payload=reviewPayload(fieldKeys);if(!payload)return;if(payload.missing){setMessage(`Completa ${FIELD_LABELS[payload.missing]} antes de aprobar.`);focusField(payload.missing);return}setWorking(true);setMessage('');try{const reviewed=await api.reviewExtraction(document.id,data.revision,payload.fields);queryClient.setQueryData(['extraction',document.id],reviewed);const approved=await api.approveExtraction(document.id,reviewed.revision);queryClient.setQueryData(['extraction',document.id],approved);onChanged();setMessage('Todos los campos se han aceptado y los datos están aprobados.')}catch(error){await handleFailure(error)}finally{setWorking(false)}}
  async function exportJson(){setWorking(true);setMessage('');try{const blob=await api.exportExtraction(document.id);await download(blob,`cnie-${document.id.slice(0,8)}.json`)}catch(error){setMessage(explain(error))}finally{setWorking(false)}}
  async function copyJson(){setWorking(true);setMessage('');try{const blob=await api.exportExtraction(document.id);await copySensitive(await blob.text());setMessage('JSON aprobado copiado; el portapapeles se limpiará en 60 segundos.')}catch(error){setMessage(explain(error))}finally{setWorking(false)}}
  async function exportOcrJson(sideToExport:CaptureSide){
    const captureId=sideToExport==='front'?document.front_capture_id:document.back_capture_id;
    const source=captures.find(item=>item.id===captureId);
    if(!source||source.ocr_summary.status!=='success'){setMessage(`El OCR del ${sideToExport==='front'?'anverso':'reverso'} todavía no está completado.`);return}
    setWorking(true);setMessage('');
    try{const result=await api.ocr(source.id);await download(new Blob([JSON.stringify(result,null,2)],{type:'application/json;charset=utf-8'}),`ocr-${sideToExport}-${document.id.slice(0,8)}.json`);setMessage(`OCR del ${sideToExport==='front'?'anverso':'reverso'} exportado para diagnóstico.`)}catch(error){setMessage(explain(error))}finally{setWorking(false)}
  }

  if(document.extraction_summary.status==='waiting_for_ocr'||document.extraction_summary.status==='extracting')return <div className="stage-empty extraction-wait"><CircularProgress size={26}/><h3>{document.extraction_summary.status==='extracting'?'Estructurando los datos':'Esperando el OCR de ambas caras'}</h3><p>El motor local comenzará automáticamente y no realizará llamadas externas.</p></div>;
  if(document.extraction_summary.status==='attention')return <div className="extraction-attention"><Alert severity="warning">{instructions[document.extraction_summary.error_code||'']||'La extracción necesita atención.'}</Alert></div>;
  if(extraction.isPending)return <div className="stage-empty extraction-wait"><CircularProgress size={26}/><h3>Cargando datos estructurados</h3></div>;
  if(extraction.isError||!data)return <div className="extraction-attention"><Alert severity="error">{explain(extraction.error)}</Alert></div>;

  const total=fieldKeys.filter(key=>data.fields[key]).length;
  const reviewed=Object.keys(data.reviews).length;
  const pendingFields=Math.max(0,total-reviewed);
  const nextPending=fieldKeys.find(key=>data.fields[key]&&!data.reviews[key]);
  const progress=total?Math.round((reviewed/total)*100):100;
  const isApproved=data.status==='approved';
  return <div className="structured-review-workspace">
    <div className="review-header structured-review-header">
      <div className="review-header-main"><div><span className="review-kicker">CONTROL DE CALIDAD</span><strong>{isApproved?'Datos aprobados':'Revisión humana requerida'}</strong><small>{reviewed} de {total} campos revisados · {pendingFields?`${pendingFields} pendientes`:'revisión completa'}</small></div><span className={`review-pill ${data.status}`}>{isApproved?'Aprobado':'En revisión'}</span></div>
      <div className="review-progress"><LinearProgress variant="determinate" value={progress}/><span>{progress}% de campos revisados</span></div>
      <div className="review-header-actions"><Button size="small" variant="outlined" disabled={!nextPending||working||isApproved} endIcon={<ChevronRight size={14}/>} onClick={()=>nextPending&&focusField(nextPending)}>Siguiente pendiente</Button><Button size="small" startIcon={<Eye size={14}/>} onClick={()=>setViewerSide('front')}>Ver anverso</Button><Button size="small" startIcon={<Eye size={14}/>} onClick={()=>setViewerSide('back')}>Ver reverso</Button><span className="keyboard-tip">Ctrl + Enter confirma · Alt + ↓ avanza</span></div>
      <div className="review-diagnostic-actions" aria-label="Exportación OCR para diagnóstico"><span>Diagnóstico OCR disponible solo en Windows</span><Button size="small" variant="text" disabled={working||captures.every(item=>item.id!==document.front_capture_id||item.ocr_summary.status!=='success')} onClick={()=>exportOcrJson('front')}>OCR · anverso</Button><Button size="small" variant="text" disabled={working||captures.every(item=>item.id!==document.back_capture_id||item.ocr_summary.status!=='success')} onClick={()=>exportOcrJson('back')}>OCR · reverso</Button></div>
    </div>
    {data.warnings.length>0&&<Alert severity="warning" className="field-alert"><strong>Revisión reforzada necesaria.</strong><span> Comprueba individualmente los campos marcados antes de aprobar.</span></Alert>}
    <div className="structured-sections" role="region" aria-label="Campos para revisión">
      {FIELD_GROUPS.map(group=>{const groupKeys=group.keys.filter(key=>data.fields[key]);if(!groupKeys.length)return null;const groupReviewed=groupKeys.filter(key=>data.reviews[key]).length;return <section className="structured-section" key={group.title}>
        <div className="structured-section-head"><div><h3>{group.title}</h3><span>{groupReviewed} de {groupKeys.length} revisados</span></div>{!isApproved&&<Button size="small" variant="contained" disabled={working} onClick={()=>confirmSection(groupKeys)}>Confirmar categoría</Button>}</div>
        {groupKeys.map(key=>{const item=data.fields[key];const review=data.reviews[key];const rtl=key.endsWith('_ar');const decision=review?.decision;const activeWarnings=decision==='corrected'?[]:item.warnings;const stateClass=decision||(activeWarnings.length?'warning':'pending');const stateLabel=decision==='confirmed'?'Confirmado':decision==='corrected'?'Corregido':activeWarnings.length?'Revisar':'Pendiente';const multiline=key.startsWith('address')||key.startsWith('filiation');const onKeyDown=(event:KeyboardEvent)=>{if(event.ctrlKey&&event.key==='Enter'){event.preventDefault();void confirmSection(groupKeys)}if(event.altKey&&event.key==='ArrowDown'){event.preventDefault();if(nextPending)focusField(nextPending)}};return <div className={`field-row ${stateClass}`} key={key}>
          <div className="field-label"><div className="field-name"><label htmlFor={`field-${key}`}>{FIELD_LABELS[key]}<b>*</b></label><span className="field-source">{item.source_side==='back'?'REVERSO':'ANVERSO'}</span></div><span className={`field-state ${stateClass}`}>{stateLabel}</span></div>
          <div className="field-input-line">{key==='sex'?<select ref={node=>{fieldRefs.current[key]=node}} id={`field-${key}`} disabled={isApproved} value={drafts[key]||''} onKeyDown={onKeyDown} onChange={event=>setDrafts(current=>({...current,[key]:event.target.value}))}><option value="">Selecciona el sexo impreso</option><option value="F">F · Femenino</option><option value="M">M · Masculino</option></select>:multiline?<textarea ref={node=>{fieldRefs.current[key]=node}} id={`field-${key}`} dir={rtl?'rtl':'ltr'} readOnly={isApproved} value={drafts[key]||''} autoComplete="off" spellCheck={false} onKeyDown={onKeyDown} onChange={event=>setDrafts(current=>({...current,[key]:event.target.value}))}/>:<input ref={node=>{fieldRefs.current[key]=node}} id={`field-${key}`} dir={rtl?'rtl':'ltr'} readOnly={isApproved} value={drafts[key]||''} autoComplete="off" spellCheck={false} onKeyDown={onKeyDown} onChange={event=>setDrafts(current=>({...current,[key]:event.target.value}))}/>}<button type="button" className="field-copy" disabled={!drafts[key]} onClick={()=>void copySensitive(drafts[key]||'').then(()=>setMessage('Campo copiado; el portapapeles se limpiará en 60 segundos.')).catch(()=>setMessage('No se pudo copiar.'))} aria-label={`Copiar ${FIELD_LABELS[key]}`}><Copy size={13}/></button></div>
          {activeWarnings.length>0&&<div className="field-warning"><AlertCircle size={13}/><span>{activeWarnings.map(warningText).join(' ')}</span></div>}
          <div className="field-actions"><span className="field-confidence">{item.confidence==null?'Confianza no disponible':`${Math.round(item.confidence*100)} % confianza OCR`}</span></div>
        </div>})}
      </section>})}
    </div>
    {message&&<Alert severity={message.includes('aprobados')||message.includes('revisado')||message.includes('confirmados')||message.includes('copiado')?'success':'info'} className="review-message">{message}</Alert>}
    <div className="approval-bar structured-approval-bar"><div className="approval-copy"><ShieldCheck size={15}/><span>{isApproved?`Revisión aprobada desde ${data.approved_by==='mobile'?'el móvil':'Windows'}; el JSON ya puede exportarse.`:'Puedes confirmar por categoría o aceptar todos los campos visibles en una sola acción.'}</span></div><div className="approval-actions"><Button variant="contained" disabled={working||isApproved} startIcon={<ShieldCheck size={14}/>} onClick={acceptAll}>{working?'Validando…':'Aceptar todo y aprobar'}</Button><Button disabled={working||!isApproved} startIcon={<Download size={14}/>} onClick={exportJson}>Exportar JSON</Button><Button disabled={working||!isApproved} startIcon={<Copy size={14}/>} onClick={copyJson}>Copiar JSON</Button></div></div>
    <Dialog open={viewerSide!==null} onClose={()=>setViewerSide(null)} fullWidth maxWidth="lg"><DialogTitle>CNIE · {viewerSide==='back'?'Reverso':'Anverso'}</DialogTitle><DialogContent className="document-viewer">{viewerSide&&viewerCapture&&<ProtectedImage load={viewerImage} alt={`CNIE · ${viewerSide==='back'?'Reverso':'Anverso'}`}/>}</DialogContent><DialogActions><Button disabled={viewerSide==='front'} onClick={()=>setViewerSide('front')}>Anverso</Button><Button disabled={viewerSide==='back'} onClick={()=>setViewerSide('back')}>Reverso</Button><Button onClick={()=>setViewerSide(null)}>Cerrar</Button></DialogActions></Dialog>
  </div>;
}

function OcrReview({api,capture,document,captures,onChanged}:{api:CaptureApi;capture:Capture;document?:DocumentSummary;captures:Capture[];onChanged:()=>void}) {
  const [tab, setTab] = useState(0);
  const [overlay, setOverlay] = useState(false);
  const ocr = useQuery({queryKey:['ocr',capture.id],queryFn:() => api.ocr(capture.id),
    enabled:capture.ocr_summary.status === 'success',retry:false});
  const words = ocr.data?.pages.flatMap(page => page.blocks.flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.words))) || [];
  const rectified = useCallback((signal: AbortSignal) => api.image(capture.id,'rectified',signal),[api,capture.id]);
  const exportOcr = (kind:'arabic'|'full'|'json') => {
    if (!ocr.data) return;
    const content = kind === 'json' ? JSON.stringify(ocr.data,null,2) : kind === 'arabic' ? ocr.data.arabic_text : ocr.data.full_text;
    download(new Blob([content],{type:kind === 'json'?'application/json;charset=utf-8':'text/plain;charset=utf-8'}),`ocr-${kind}-${capture.id.slice(0,8)}.${kind === 'json'?'json':'txt'}`);
  };
  const status = capture.ocr_summary;
  return <div className={`ocr-review ${tab===3?'structured-active':''}`}>
    <div className="ocr-tabs"><Tabs value={tab} onChange={(_,value) => setTab(value)}><Tab label="Imagen"/><Tab label="OCR árabe"/><Tab label="Texto completo"/><Tab label="Datos estructurados"/></Tabs>
      {tab === 0 && status.status === 'success' && <Button size="small" startIcon={<Eye size={14}/>} onClick={() => setOverlay(value => !value)}>{overlay?'Ocultar palabras':'Ver palabras'}</Button>}</div>
    {tab === 3 ? document?<StructuredDataReview api={api} document={document} captures={captures} onChanged={onChanged}/>:<div className="stage-empty extraction-wait"><Alert severity="info">Selecciona una CNIE de esta sesión.</Alert></div>
    : tab === 0 ? <div className="ocr-image-content"><CaptureImages api={api} capture={capture}/>{overlay && ocr.data && <div className="ocr-overlay-wrap"><ProtectedImage load={rectified} alt="Rectificada con geometría OCR"/><svg viewBox="0 0 1600 1008" preserveAspectRatio="none">{words.map((word,index) => <polygon key={index} points={word.bounding_box.map(point => point.join(',')).join(' ')} className={(word.confidence || 0) < .7 ? 'low' : ''}><title>{word.text} · {word.confidence == null?'sin confianza':`${Math.round(word.confidence*100)} %`}</title></polygon>)}</svg></div>}</div>
    : <div className="ocr-text-panel">{status.status === 'queued' || status.status === 'processing' ? <div className="stage-empty"><CircularProgress size={26}/><h3>{status.status === 'queued'?'OCR pendiente':'Reconociendo texto'}</h3><p>Puedes continuar capturando mientras Google Vision procesa esta imagen.</p></div>
      : status.status === 'error' || status.status === 'no_text' ? <Alert severity="warning">{instructions[status.error_code || ''] || 'El OCR necesita atención.'}</Alert>
      : status.status === 'not_started' || status.status === 'cancelled' ? <div className="stage-empty"><ShieldCheck size={27}/><h3>Esperando revisión humana</h3><p>El OCR comienza únicamente después de aceptar esta imagen.</p></div>
      : ocr.isPending ? <CircularProgress size={25}/> : ocr.isError ? <Alert severity="error">{explain(ocr.error)}</Alert>
      : <><div className="ocr-text-meta"><span>{status.character_count} caracteres</span><span>{ocr.data?.languages.join(' · ') || 'idioma no indicado'}</span><span>{status.mean_confidence == null?'confianza no disponible':`${Math.round(status.mean_confidence*100)} % confianza media`}</span></div><pre dir={tab === 1?'rtl':'auto'} className={tab === 1?'rtl-text':''}>{tab === 1 ? ocr.data?.arabic_text : ocr.data?.full_text}</pre><div className="heading-actions"><Button size="small" startIcon={<Download size={14}/>} onClick={() => exportOcr(tab === 1?'arabic':'full')}>Exportar UTF-8</Button><Button size="small" onClick={() => exportOcr('json')}>Exportar JSON normalizado</Button></div></>}</div>}
  </div>;
}

function App({api, version}: {api: CaptureApi; version: string}) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState<Page>('capture');
  const [side, setSide] = useState<CaptureSide>('front');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [pairOpen, setPairOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [lanIp, setLanIp] = useState('');
  const [lanConfigured, setLanConfigured] = useState(false);
  const [now, setNow] = useState(Date.now());
  const input = useRef<HTMLInputElement>(null);
  const credentialInput = useRef<HTMLInputElement>(null);
  const workspace = useQuery({queryKey:['workspace'], queryFn:() => api.workspace(), refetchInterval:4000});
  const model = useQuery({queryKey:['model'], queryFn:() => api.request<Record<string, unknown>>('/model'), enabled:page === 'diagnostics'});
  const ocrConfig = useQuery({queryKey:['ocr-config'], queryFn:() => api.ocrConfig(), enabled:page === 'diagnostics'});
  const captures = (workspace.data?.captures || []).filter(capture => capture.active);
  const documents = workspace.data?.documents || [];
  const selected = captures.find(c => c.id === selectedId) || null;
  const selectedDocument = documents.find(document => document.id === selected?.document_id);
  const pending = captures.filter(c => c.review === 'pending').length;
  const refresh = useCallback(() => {void queryClient.invalidateQueries({queryKey:['workspace']});void queryClient.invalidateQueries({queryKey:['extraction']})}, [queryClient]);
  useEffect(() => api.subscribe(refresh), [api, refresh]);
  useEffect(() => {const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer)}, []);

  async function action(task: () => Promise<unknown>) {
    setBusy(true); setError(''); setNotice('');
    try {await task(); refresh()} catch (e) {setError(explain(e))} finally {setBusy(false)}
  }
  async function startPairing() {
    setPairOpen(true); setPairing(null);
    if (!workspace.data?.mobile_url) return;
    await action(async () => setPairing(await api.pairing()));
  }
  async function upload(file?: File) {
    if (!file) return;
    await action(async () => {const item = await api.upload(file, side, crypto.randomUUID(), selected?.document_id); setSelectedId(item.id); setPage('capture')});
    if (input.current) input.current.value = '';
  }
  async function importCredential(file?: File) {
    if (!file) return;
    if (file.size > 64 * 1024) {setError('La credencial supera el máximo de 64 KiB.');return}
    await action(async () => {await api.importCredential(await file.text());await queryClient.invalidateQueries({queryKey:['ocr-config']});setNotice('Credencial validada y cifrada para este usuario de Windows.')});
    if (credentialInput.current) credentialInput.current.value = '';
  }
  async function downloadImage() {
    if (!selected) return;
    await action(async () => {
      const blob = await api.image(selected.id, 'rectified');
      download(blob, `cnie-${selected.id.slice(0,8)}.jpg`);
    });
  }
  async function configureLan() {
    if (!('__TAURI_INTERNALS__' in window)) {
      setError('La configuración integrada está disponible en la aplicación Windows instalada.');
      return;
    }
    setBusy(true); setError(''); setLanConfigured(false);
    try {
      const {invoke} = await import('@tauri-apps/api/core');
      await invoke('configure_lan', {ip: lanIp.trim()});
      setLanConfigured(true);
    } catch (e) { setError(explain(e)); } finally { setBusy(false); }
  }
  async function restartApp() {
    const {invoke} = await import('@tauri-apps/api/core');
    await invoke('restart_app');
  }
  const deviceCount = workspace.data?.connected_devices || 0;
  return <div className="app-shell">
    <aside className="sidebar"><Brand/>
      <div className="workspace-switch"><span className="square-icon"><Monitor size={15}/></span><span>Oficina local<small>Espacio de trabajo</small></span><ChevronDown size={12}/></div>
      <p className="nav-label">ESPACIO DE TRABAJO</p>
      <nav aria-label="Navegación principal">
        <button className={`nav-item ${page === 'capture' ? 'active' : ''}`} onClick={() => setPage('capture')} aria-label="Captura de documentos"><ScanLine size={17}/><span>Captura de documentos</span>{pending > 0 && <b className="count">{pending}</b>}</button>
        <button className={`nav-item ${page === 'devices' ? 'active' : ''}`} onClick={() => setPage('devices')} aria-label="Dispositivos"><Smartphone size={17}/><span>Dispositivos</span></button>
      </nav>
      <hr className="sidebar-separator"/><p className="nav-label">ADMINISTRACIÓN</p>
      <button className={`nav-item ${page === 'diagnostics' ? 'active' : ''}`} onClick={() => setPage('diagnostics')} aria-label="Diagnóstico del motor"><Settings2 size={17}/><span>Diagnóstico del motor</span></button>
      <button className="nav-item" onClick={() => setHelpOpen(true)} aria-label="Guía de captura"><CircleHelp size={17}/><span>Guía de captura</span></button>
      <div className="sidebar-bottom"><div className="local-note"><strong><ShieldCheck size={14}/>Flujo controlado</strong><p>La geometría se procesa localmente; solo la imagen aceptada se envía a Vision UE.</p></div>
        <div className="operator"><div className="operator-avatar">OP</div><div>Operador local<small>Estación de captura</small></div></div></div>
    </aside>
    <main className="workspace-main"><header className="topbar"><div className="breadcrumb"><Monitor size={13}/><span>Espacio de trabajo</span><ChevronRight size={12}/><span>{page === 'capture' ? 'Captura de documentos' : page === 'devices' ? 'Dispositivos' : 'Diagnóstico'}</span></div>
      <div className="topbar-end"><span className={`connection-dot ${workspace.isError ? 'offline' : ''}`}>{workspace.isError ? 'Sin conexión al servicio' : workspace.isPending ? 'Conectando' : 'Servicio local conectado'}</span><Tooltip title="Guía de captura"><IconButton size="small" onClick={() => setHelpOpen(true)} aria-label="Abrir ayuda"><CircleHelp size={17}/></IconButton></Tooltip></div></header>
      <div className="content">
        <div className="page-heading"><div><div className="eyebrow">CENTRO DE CAPTURA</div><h1>{page === 'capture' ? 'Cada documento, bien capturado.' : page === 'devices' ? 'Conecta tu cámara.' : 'Un motor, a la vista.'}</h1><p>{page === 'capture' ? 'Captura, revisa y prepara tu CNIE desde un solo lugar.' : page === 'devices' ? 'Empareja los móviles de la oficina con esta estación.' : 'Estado real del modelo y de la última rectificación.'}</p></div>
          {page === 'capture' && <div className="heading-actions"><Button variant="outlined" startIcon={<Upload size={15}/>} onClick={() => input.current?.click()} disabled={busy}>Importar imagen</Button><Button variant="contained" startIcon={<Plus size={16}/>} onClick={startPairing} disabled={busy}>Nueva captura</Button></div>}</div>
        <input ref={input} className="hidden-input" type="file" accept="image/jpeg,image/png" aria-label="Seleccionar fotografía" onChange={e => upload(e.target.files?.[0])}/>
        <input ref={credentialInput} className="hidden-input" type="file" accept="application/json,.json" aria-label="Importar credencial Google" onChange={e => importCredential(e.target.files?.[0])}/>
        {(error || workspace.isError) && <Alert className="error-banner" severity="error" onClose={() => setError('')}>{error || explain(workspace.error)}</Alert>}
        {notice && <Alert className="error-banner" severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
        {page === 'capture' ? <>
          <section className="workflow-strip surface" aria-label="Progreso de captura"><div className={`workflow-step ${!selected ? 'current' : ''}`}><span className="step-num">01</span>Captura</div><span className="workflow-line"/><div className={`workflow-step ${selected && selected.review !== 'accepted' ? 'current' : ''}`}><span className="step-num">02</span>Revisión imagen</div><span className="workflow-line"/><div className={`workflow-step ${selected?.review === 'accepted' && !['success','error','no_text'].includes(selected.ocr_summary.status) ? 'current' : ''}`}><span className="step-num">03</span>OCR UE</div><span className="workflow-line"/><div className={`workflow-step ${selectedDocument?.status === 'data_review_required' ? 'current' : ''}`}><span className="step-num">04</span>Revisión datos</div><span className="workflow-line"/><div className={`workflow-step ${selectedDocument?.status === 'ready' ? 'current' : ''}`}><span className="step-num">05</span>Aprobada</div></section>
          <div className="workspace-grid"><section className="surface station" aria-label="Estación de revisión">
            <div className="station-toolbar"><h2><ScanLine size={15}/>Estación de captura</h2><div className="toolbar-meta">CNIE marroquí<span>·</span>ID-1</div></div>
            <div className="canvas-stage">{busy ? <div className="stage-empty"><CircularProgress size={28}/><h3>Preparando tu captura</h3><p>Estamos comprobando la imagen en este equipo.</p></div> : selected ? <OcrReview api={api} capture={selected} document={selectedDocument} captures={captures} onChanged={refresh}/> : <><div className="stage-empty"><CardIllustration/><h3>Tu próximo documento empieza aquí</h3><p>Conecta tu móvil para tomar una fotografía o importa una imagen desde este equipo.</p></div><span className="stage-caption"><ShieldCheck size={12}/>Las imágenes, el OCR y los datos caducan tras 60 minutos</span></>}</div>
            <div className="station-foot"><div className="side-toggle" aria-label="Cara del documento">{(['front','back'] as const).map(value => <button key={value} className={(selected?.side || side) === value ? 'selected' : ''} aria-pressed={(selected?.side || side) === value} onClick={() => {setSide(value);const id=value==='front'?selectedDocument?.front_capture_id:selectedDocument?.back_capture_id;if(id)setSelectedId(id)}}>{value === 'front' ? 'Anverso' : 'Reverso'}</button>)}</div><span>{selected ? <Status status={selected.result.status} review={selected.review}/> : <><FileImage size={12}/>JPEG o PNG · hasta 20 MB</>}</span>{selected && <Tooltip title="Ampliar comparación"><IconButton size="small" onClick={() => setFullscreen(true)} aria-label="Ampliar comparación"><Maximize2 size={15}/></IconButton></Tooltip>}</div>
            {selected && <div className="review-toolbar"><Button size="small" startIcon={<Check size={14}/>} variant="contained" disabled={busy || selected.result.status !== 'success' || selected.review === 'accepted'} onClick={() => action(() => api.review(selected.id, 'accepted'))}>Aceptar imagen e iniciar OCR</Button><Button size="small" startIcon={<RotateCcw size={13}/>} disabled={busy} onClick={() => action(() => api.review(selected.id,'retake'))}>Repetir</Button>{['error','no_text'].includes(selected.ocr_summary.status) && <Button size="small" startIcon={<RefreshCw size={13}/>} disabled={busy || selected.ocr_summary.attempts >= 3} onClick={() => action(() => api.retryOcr(selected.id))}>Reintentar OCR</Button>}<span className="spacer"/><Tooltip title="Exportar imagen rectificada"><span><IconButton size="small" disabled={busy || selected.result.status !== 'success'} onClick={downloadImage} aria-label="Exportar imagen"><Download size={16}/></IconButton></span></Tooltip><Tooltip title="Eliminar captura"><IconButton size="small" onClick={() => setDeleteOpen(true)} aria-label="Eliminar captura"><Trash2 size={15}/></IconButton></Tooltip></div>}
          </section><aside className="right-rail">
            <section className="rail-card surface"><div className="rail-head"><h2>Captura desde tu móvil</h2><Smartphone size={16}/></div><p>Una cámara. Un QR. Tu documento llega directamente a esta estación.</p><div className="pair-visual"><div className="phone-symbol"><QrCode size={20}/></div><div className="pair-line"/><div className="pair-copy">{deviceCount ? `${deviceCount} móvil conectado` : 'Conexión de oficina'}<small>{deviceCount ? 'Preparado para recibir capturas' : 'Sin cables ni instalaciones'}</small></div></div><Button fullWidth variant="outlined" startIcon={<QrCode size={15}/>} onClick={startPairing}>Conectar móvil</Button></section>
            <section className="rail-card surface"><div className="rail-head"><h2>Una buena captura</h2><Sun size={15}/></div><ul className="checklist"><li><Focus size={15}/><span><strong>Cuatro esquinas visibles</strong>Deja un pequeño margen alrededor.</span></li><li><Sun size={15}/><span><strong>Luz suave, sin reflejos</strong>Evita el flash y las sombras directas.</span></li><li><Layers3 size={15}/><span><strong>Fondo mate y uniforme</strong>Una sola tarjeta, sin objetos encima.</span></li></ul></section>
          </aside></div>
          <section className="session-section"><div className="section-header"><h2>CNIE de esta sesión<span className="session-count">{documents.length}</span></h2><small>Imágenes, OCR y datos en memoria · 60 min</small></div><div className="surface"><div className="queue-head document-head"><span>Documento</span><span>Anverso</span><span>Reverso</span><span>Estado</span></div>{documents.length === 0 ? <div className="queue-empty"><FileImage size={19}/>{workspace.isPending ? 'Conectando con tu estación…' : 'Tus documentos aparecerán aquí con sus dos caras.'}</div> : documents.map(document => {const front=captures.find(c=>c.id===document.front_capture_id);const back=captures.find(c=>c.id===document.back_capture_id);const chosen=front||back;const label={capturing:'Falta una cara',review_required:'Por revisar',ocr_pending:'OCR pendiente',data_review_required:'Revisar datos',ready:'Aprobada',attention:'Atención'}[document.status];return <button key={document.id} className={`queue-row document-row ${selected?.document_id === document.id ? 'is-selected' : ''}`} onClick={() => chosen && setSelectedId(chosen.id)}><span className="queue-name"><FileImage size={16}/>CNIE · {document.id.slice(0,8)}</span><span className={`face-indicator ${front?.ocr_summary.status === 'success'?'done':''}`}>{front?front.ocr_summary.status==='success'?'OCR listo':front.review==='accepted'?'OCR pendiente':'Capturado':'Pendiente'}</span><span className={`face-indicator ${back?.ocr_summary.status === 'success'?'done':''}`}>{back?back.ocr_summary.status==='success'?'OCR listo':back.review==='accepted'?'OCR pendiente':'Capturado':'Pendiente'}</span><span className={`document-status ${document.status}`}>{label}</span></button>})}</div></section>
        </> : page === 'devices' ? <section className="connection-page surface"><div className="rail-head"><h2>Dispositivos de captura</h2><Wifi size={20}/></div><p>{deviceCount ? `${deviceCount} dispositivo(s) emparejado(s) con esta estación.` : 'Todavía no hay un móvil emparejado.'} El QR dura dos minutos y se puede utilizar una sola vez.</p><p>El móvil debe estar conectado a la misma red de la oficina. La sesión dura hasta cuatro horas.</p><div className="heading-actions"><Button variant="contained" startIcon={<QrCode size={16}/>} onClick={startPairing}>Generar QR</Button><Button disabled={!deviceCount || busy} onClick={() => action(() => api.disconnect())}>Desconectar móviles</Button></div>{workspace.data?.mobile_url ? <><Alert severity="success" style={{marginTop:20}}>{workspace.data.lan_mode === 'automatic' ? 'Dirección detectada y protegida automáticamente.' : workspace.data.lan_mode === 'managed' ? 'Dirección administrada por la configuración de TI.' : 'Dirección manual activa y protegida.'}</Alert><p>Dirección activa: <code>{workspace.data.mobile_url}</code></p></> : <div className="lan-setup"><h3>No se pudo elegir la red automáticamente</h3><p>Esto puede ocurrir cuando hay varias tarjetas de red, una VPN o ninguna conexión activa. Como respaldo, introduce la IPv4 privada y estable de la red de oficina.</p><div className="lan-form"><input className="lan-input" value={lanIp} onChange={e => setLanIp(e.target.value)} placeholder="Ej. 192.168.0.107" inputMode="numeric" aria-label="IPv4 privada del PC"/><Button variant="outlined" disabled={busy || !lanIp.trim()} onClick={configureLan}>{busy ? 'Configurando…' : 'Usar dirección manual'}</Button></div>{lanConfigured && <Alert className="lan-success" severity="success" action={<Button size="small" onClick={restartApp}>Reiniciar ahora</Button>}>Certificado creado. Reinicia e-notario para activar la cámara móvil.</Alert>}</div>}</section> : <div className="diagnostic-grid"><section className="connection-page surface"><div className="rail-head"><h2>Google Cloud Vision · UE</h2><ShieldCheck size={19}/></div>{ocrConfig.isPending?<CircularProgress size={24}/>:ocrConfig.isError?<Alert severity="error">{explain(ocrConfig.error)}</Alert>:<><Alert severity={ocrConfig.data?.configured?'success':'warning'}>{ocrConfig.data?.configured?'Credencial cifrada con Windows DPAPI para este usuario.':'OCR sin configurar. Importa la cuenta de servicio dedicada.'}</Alert>{ocrConfig.data?.configured&&<dl><div className="metric-pair"><dt>Proyecto</dt><dd>{ocrConfig.data.project_id}</dd></div><div className="metric-pair"><dt>Cuenta</dt><dd>{ocrConfig.data.client_email}</dd></div><div className="metric-pair"><dt>Región</dt><dd>eu · endpoint europeo</dd></div><div className="metric-pair"><dt>Uso hoy</dt><dd>{ocrConfig.data.limits.used_today} / {ocrConfig.data.limits.daily_limit}</dd></div><div className="metric-pair"><dt>Uso mensual</dt><dd>{ocrConfig.data.limits.used_month} / {ocrConfig.data.limits.monthly_limit}</dd></div></dl>}<div className="heading-actions diagnostic-actions"><Button variant="contained" startIcon={<Upload size={14}/>} onClick={()=>credentialInput.current?.click()}>{ocrConfig.data?.configured?'Sustituir credencial':'Importar credencial Google'}</Button><Button disabled={!ocrConfig.data?.configured||busy} onClick={()=>action(()=>api.testOcr())}>Probar conexión</Button><Button color="error" disabled={!ocrConfig.data?.configured||busy} onClick={()=>action(async()=>{await api.deleteCredential();await queryClient.invalidateQueries({queryKey:['ocr-config']})})}>Eliminar credencial</Button></div><p>El JSON original no se elimina. TI debe retirarlo mediante su procedimiento seguro.</p></>}</section><section className="connection-page surface"><h2>Modelo local · ONNX Runtime</h2><p>La Fase 1 permanece congelada. Estos datos proceden del motor instalado.</p>{model.isPending ? <CircularProgress size={24}/> : model.isError ? <Alert severity="error">{explain(model.error)}</Alert> : <pre className="model-json">{JSON.stringify(model.data,null,2)}</pre>}</section><section className="rail-card surface"><h2>Captura seleccionada</h2>{selected ? <><dl>{Object.entries(selected.result.timings_ms).map(([name,value]) => <div className="metric-pair" key={name}><dt>{name.replaceAll('_',' ')}</dt><dd>{value.toFixed(1)} ms</dd></div>)}</dl><p>Coincidencia de detectores: {selected.result.detector_iou == null ? 'No disponible' : `${(selected.result.detector_iou * 100).toFixed(1)} % IoU`}</p>{selected.result.rejection_codes.map(code => <p className="code-note" key={code}>{instructions[code] || code}</p>)}<Button size="small" startIcon={<Download size={14}/>} onClick={() => download(new Blob([JSON.stringify(selected,null,2)],{type:'application/json'}),`diagnostico-${selected.id.slice(0,8)}.json`)}>Exportar diagnóstico</Button></> : <p style={{marginTop:15}}>Selecciona una captura para consultar sus métricas y tiempos.</p>}</section></div>}
        <footer className="footer-note"><span><ShieldCheck size={12}/>Revisión humana de imagen y datos · Retención 60 min</span><span>e-notario {version}<span>·</span>Captura, OCR y extracción local</span></footer>
      </div>
    </main>
    <Dialog open={pairOpen} onClose={() => setPairOpen(false)} fullWidth maxWidth="xs"><DialogTitle>Conectar un móvil</DialogTitle><DialogContent><div className="qr-container">{pairing && pairing.expires_at * 1000 > now ? <><QRCodeSVG value={pairing.url} size={208} level="M"/><p>Escanea este QR con la cámara del móvil, conectado a la red de la oficina.</p><span className="status status-green"><Clock3 size={12}/>Caduca en {Math.max(0,Math.ceil(pairing.expires_at - now/1000))} s</span></> : !workspace.data?.mobile_url ? <><Link2 size={36}/><p>Primero activa HTTPS desde la sección «Dispositivos». El servicio debe presentar un certificado de confianza al móvil.</p><Button onClick={() => {setPairOpen(false);setPage('devices')}}>Abrir configuración</Button><p>La guía de instalación explica cómo confiar en la CA pública y abrir el puerto de captura.</p></> : busy ? <CircularProgress size={30}/> : <><Clock3 size={32}/><p>Genera un QR nuevo para iniciar el emparejamiento.</p><Button onClick={startPairing}>Generar QR</Button></>}</div></DialogContent><DialogActions><Button onClick={() => setPairOpen(false)}>Cerrar</Button></DialogActions></Dialog>
    <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} fullWidth maxWidth="sm"><DialogTitle>Una captura que conserva cada detalle</DialogTitle><DialogContent><p className="mobile-lead">Coloca una sola CNIE sobre un fondo mate, uniforme y contrastante. Mantén visibles las cuatro esquinas, sin dedos, y usa luz difusa.</p><ul className="checklist"><li><Check size={16}/><span>La tarjeta debe ocupar aproximadamente del 50 % al 90 % del encuadre.</span></li><li><Check size={16}/><span>Su lado corto debe medir al menos 1.000 píxeles en la fotografía.</span></li><li><Check size={16}/><span>Revisa anverso y reverso por separado. Exporta las imágenes que necesites antes de cerrar.</span></li><li><ShieldCheck size={16}/><span>Las capturas se mantienen en memoria durante 60 minutos. Cerrar el servicio las descarta.</span></li></ul></DialogContent><DialogActions><Button onClick={() => setHelpOpen(false)}>Entendido</Button></DialogActions></Dialog>
    <Dialog open={fullscreen && !!selected} onClose={() => setFullscreen(false)} fullWidth maxWidth="lg"><DialogTitle>Revisión del documento</DialogTitle><DialogContent>{selected && <CaptureImages api={api} capture={selected}/>}</DialogContent><DialogActions><Button onClick={() => setFullscreen(false)}>Cerrar</Button></DialogActions></Dialog>
    <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)}><DialogTitle>Eliminar esta captura</DialogTitle><DialogContent>Se descartarán la fotografía y su rectificación de esta sesión. Esta acción no se puede deshacer.</DialogContent><DialogActions><Button onClick={() => setDeleteOpen(false)}>Cancelar</Button><Button color="error" disabled={busy} onClick={() => action(async () => {if (selected) await api.delete(selected.id); setSelectedId(null); setDeleteOpen(false)})}>Eliminar captura</Button></DialogActions></Dialog>
  </div>;
}

async function download(blob: Blob, name: string) {
  if ('__TAURI_INTERNALS__' in window) {
    const {invoke} = await import('@tauri-apps/api/core');
    await invoke('export_file',{name,bytes:Array.from(new Uint8Array(await blob.arrayBuffer()))});
  } else {
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
}

function Root() {
  const [api, setApi] = useState<CaptureApi | null>(null);
  const [version, setVersion] = useState('0.6.1');
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState('');
  useEffect(() => {
    async function initialize() {
      if ('__TAURI_INTERNALS__' in window) {
        const {invoke} = await import('@tauri-apps/api/core');
        const {getVersion} = await import('@tauri-apps/api/app');
        const boot = await invoke<{token:string; base:string}>('bootstrap');
        setVersion(await getVersion());
        setApi(new CaptureApi(boot.base,boot.token));
      } else {
        const hash = new URLSearchParams(location.hash.slice(1));
        const token = hash.get('token') || sessionStorage.getItem('notario.desktop.token');
        if (hash.has('token')) history.replaceState(null,'',location.pathname);
        if (token) {sessionStorage.setItem('notario.desktop.token',token);setApi(new CaptureApi('',token))}
      }
      setReady(true);
    }
    initialize().catch(() => {setStartupError('No se pudo iniciar el servicio local. Revisa la instalación.');setReady(true)});
  },[]);
  return <AppTheme>{api ? <QueryClientProvider client={client}><App api={api} version={version}/></QueryClientProvider> : <div className="unlock-screen"><div className="unlock-card surface"><Brand/><h1>{ready ? 'Tu estación, preparada.' : 'Iniciando la estación…'}</h1><p>{startupError || 'Abre e-notario desde su lanzador para iniciar una sesión local autenticada.'}</p>{ready && <code className="dialog-code">python -m cnie_capture serve --open</code>}</div></div>}</AppTheme>;
}

const root=document.getElementById('root');
if(root)createRoot(root).render(<Root/>);
