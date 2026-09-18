import {useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient, QueryClientProvider, useQuery, useQueryClient} from '@tanstack/react-query';
import {QRCodeSVG} from 'qrcode.react';
import {acknowledgeDocumentSaveReceipt,documentSaveReceipts,type DocumentSaveReceipt} from './native-document-saves';
import {ProfessionalProfileManager,type ProfessionalProfileForm} from './ProfessionalProfileManager';
import {ApiError, CaptureApi, explain, instructions, type ApprovedIdentitySummary, type Capture, type CaptureSide, type CardModel, type CaseDraft, type CaseDraftSummary, type CaseFieldLease, type DocumentGenerationRequest, type DocumentSummary, type Pairing, type ProfessionalProfile, type TemplateFieldDefinition, type TemplateSummary} from '@notario/api-client';
import {AppTheme, Brand, RoleIdentityPicker, RepeatableLegalField, ProfessionalProfileField, CardIllustration, DocumentModeOptions, useCaseCollaboration, Status, ProtectedImage, Button, IconButton, Dialog,
  DialogTitle, DialogContent, DialogActions, Alert, Tooltip, CircularProgress, ScanLine,
  Smartphone, Settings2, ShieldCheck, Plus, Upload, ChevronDown, ChevronRight, CircleHelp,
  Monitor, QrCode, ArrowUpRight, Check, RotateCcw, Trash2, Download, FileImage, Clock3, Wifi,
  Sun, Focus, Move, Maximize2, Layers3, X, Link2, RefreshCw, Eye, Copy,
  AlertCircle, LinearProgress} from '@notario/ui';

const client = new QueryClient({defaultOptions:{queries:{retry:1, refetchOnWindowFocus:true}}});
const UI_VERSION='0.8.0-alpha.2';
const API_VERSION=2;
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

export function StructuredDataReview({api,document,captures,onChanged,onContinue}:{api:CaptureApi;document:DocumentSummary;captures:Capture[];onChanged:()=>void;onContinue?:()=>void}) {
  const queryClient=useQueryClient();
  const extraction=useQuery({queryKey:['extraction',document.id],queryFn:()=>api.extraction(document.id),enabled:['review_required','approved'].includes(document.extraction_summary.status),retry:false,refetchInterval:4000});
  const [drafts,setDrafts]=useState<Record<string,string>>({});
  const [working,setWorking]=useState(false);
  const [message,setMessage]=useState('');
  const [viewerSide,setViewerSide]=useState<CaptureSide|null>(null);
  const [releaseOpen,setReleaseOpen]=useState(false);
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
  async function releaseImages(){setWorking(true);setMessage('');try{await api.releaseImages(document.id);setReleaseOpen(false);onChanged()}catch(error){setMessage(explain(error))}finally{setWorking(false)}}
  if(document.extraction_summary.status==='waiting_for_ocr'||document.extraction_summary.status==='extracting')return <div className="stage-empty extraction-wait"><CircularProgress size={26}/><h3>{document.extraction_summary.status==='extracting'?'Organizando los datos':'Preparando los datos de ambas caras'}</h3><p>La extracción continúa automáticamente. Después podrás revisar los 14 campos con las imágenes de referencia.</p></div>;
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
      <div className="review-header-main"><div><span className="review-kicker">CONTROL DE CALIDAD · {data.engine.template==='CNIE_MA_LEGACY'?'CNIE antigua':'CNIE 2020'}</span><strong>{isApproved?'Datos aprobados':'Revisión humana requerida'}</strong><small>{reviewed} de {total} campos revisados · {pendingFields?`${pendingFields} pendientes`:'revisión completa'}</small></div><span className={`review-pill ${data.status}`}>{isApproved?'Aprobado':'En revisión'}</span></div>
      <div className="review-progress"><LinearProgress variant="determinate" value={progress}/><span>{progress}% de campos revisados</span></div>
      <div className="review-header-actions"><Button size="small" variant="outlined" disabled={!nextPending||working||isApproved} endIcon={<ChevronRight size={14}/>} onClick={()=>nextPending&&focusField(nextPending)}>Siguiente pendiente</Button><Button size="small" startIcon={<Eye size={14}/>} onClick={()=>setViewerSide('front')}>Ver anverso</Button><Button size="small" startIcon={<Eye size={14}/>} onClick={()=>setViewerSide('back')}>Ver reverso</Button><span className="keyboard-tip">Ctrl + Enter confirma · Alt + ↓ avanza</span></div>
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
    <div className="approval-bar structured-approval-bar"><div className="approval-copy"><ShieldCheck size={15}/><span>{isApproved?`Revisión aprobada desde ${data.approved_by==='mobile'?'el móvil':'Windows'}; el siguiente paso es preparar el documento.`:'Puedes confirmar por categoría o aceptar todos los campos visibles en una sola acción.'}</span></div><div className="approval-actions"><Button variant="contained" disabled={working||isApproved} startIcon={<ShieldCheck size={14}/>} onClick={acceptAll}>{working?'Validando…':'Aceptar todo y aprobar'}</Button>{isApproved&&onContinue&&<Button variant="contained" endIcon={<ChevronRight size={14}/>} onClick={onContinue}>Continuar a documentos</Button>}<Button disabled={working||!isApproved} startIcon={<Download size={14}/>} onClick={exportJson}>Exportar JSON</Button><Button disabled={working||!isApproved} startIcon={<Copy size={14}/>} onClick={copyJson}>Copiar JSON</Button><Button color="warning" disabled={working||!isApproved} onClick={()=>setReleaseOpen(true)}>Conservar identidad y liberar imágenes</Button></div></div>
    <Dialog open={viewerSide!==null} onClose={()=>setViewerSide(null)} fullWidth maxWidth="lg"><DialogTitle>CNIE · {viewerSide==='back'?'Reverso':'Anverso'}</DialogTitle><DialogContent className="document-viewer">{viewerSide&&viewerCapture&&<ProtectedImage load={viewerImage} alt={`CNIE · ${viewerSide==='back'?'Reverso':'Anverso'}`}/>}</DialogContent><DialogActions><Button disabled={viewerSide==='front'} onClick={()=>setViewerSide('front')}>Anverso</Button><Button disabled={viewerSide==='back'} onClick={()=>setViewerSide('back')}>Reverso</Button><Button onClick={()=>setViewerSide(null)}>Cerrar</Button></DialogActions></Dialog>
    <Dialog open={releaseOpen} onClose={()=>setReleaseOpen(false)}><DialogTitle>Conservar solo la identidad aprobada</DialogTitle><DialogContent>Se eliminarán definitivamente las imágenes, rectificaciones, OCR y evidencias. La ficha revisada seguirá cifrada y disponible hasta un máximo de 24 horas para preparar documentos Word.</DialogContent><DialogActions><Button onClick={()=>setReleaseOpen(false)}>Cancelar</Button><Button color="warning" disabled={working} onClick={releaseImages}>Liberar imágenes</Button></DialogActions></Dialog>
  </div>;
}

function CaptureWorkflow({api,capture,document,captures,onChanged,onContinue,onRetry}:{api:CaptureApi;capture:Capture;document?:DocumentSummary;captures:Capture[];onChanged:()=>void;onContinue:()=>void;onRetry:(id:string)=>void}) {
  if(capture.result.status!=='success')return <div className="capture-gate"><CaptureImages api={api} capture={capture}/><Alert severity="warning">La comprobación local rechazó esta cara. Repite la captura antes de continuar.</Alert></div>;
  if(!document?.front_capture_id||!document.back_capture_id)return <div className="capture-gate"><CaptureImages api={api} capture={capture}/><div className="capture-next"><ShieldCheck size={18}/><div><strong>Imagen aceptada automáticamente</strong><p>Captura ahora el {document?.front_capture_id?'reverso':'anverso'} para preparar los datos.</p></div></div></div>;
  const documentCaptures=captures.filter(item=>item.document_id===document.id);
  const rejected=documentCaptures.filter(item=>item.result.status!=='success'||item.review==='retake');
  if(rejected.length)return <div className="capture-gate"><Alert severity="warning">El {rejected.map(item=>item.side==='front'?'anverso':'reverso').join(' y el ')} necesita otra fotografía. Selecciona esa cara y repite la captura.</Alert><CaptureImages api={api} capture={capture}/></div>;
  const unreadable=documentCaptures.filter(item=>['error','no_text'].includes(item.ocr_summary.status));
  if(unreadable.length)return <div className="capture-gate capture-attention"><Alert severity="warning">No se pudieron preparar los datos de {unreadable.map(item=>item.side==='front'?'anverso':'reverso').join(' y ')}. Puedes reintentar la lectura o repetir la fotografía.</Alert><div className="heading-actions">{unreadable.map(item=><Button key={item.id} size="small" startIcon={<RefreshCw size={13}/>} disabled={item.ocr_summary.attempts>=3} onClick={()=>onRetry(item.id)}>{item.ocr_summary.attempts>=3?'Límite de reintentos':'Reintentar '+(item.side==='front'?'anverso':'reverso')}</Button>)}</div><CaptureImages api={api} capture={capture}/></div>;
  if(document.extraction_summary.status==='attention')return <div className="capture-gate capture-attention"><Alert severity="error">{instructions[document.extraction_summary.error_code||'']||'No se pudieron reconocer ambas caras de forma segura. Comprueba el modelo y repite la captura.'}</Alert><CaptureImages api={api} capture={capture}/></div>;
  return <StructuredDataReview api={api} document={document} captures={captures} onChanged={onChanged} onContinue={onContinue}/>;
}

export function DocumentModeCard({mode,onSelect}:{mode:'partial'|'complete'|null;onSelect:(mode:'partial'|'complete')=>void}) {
  return <section className="document-mode-card surface" aria-label="Modo de preparación del documento">
    <div><span className="eyebrow">SIGUIENTE PASO</span><h2>Prepara el documento Word</h2><p>Elige cómo se rellenará el modelo. La identidad aprobada seguirá disponible durante esta sesión.</p></div>
    <DocumentModeOptions selectedMode={mode} onPartial={()=>onSelect('partial')} onComplete={()=>onSelect('complete')}/>
  </section>;
}

export function DocumentCenter({api,identities,requests,onChanged,active=false,onStart=()=>{},onNavigationBlockedChange}:{api:CaptureApi;identities:ApprovedIdentitySummary[];requests:DocumentGenerationRequest[];onChanged:()=>void;active?:boolean;onStart?:()=>void;onNavigationBlockedChange?:(blocked:boolean)=>void}) {
  const templates=useQuery({queryKey:['document-templates'],queryFn:()=>api.templates(),staleTime:60000});
  const [templateId,setTemplateId]=useState('');
  const [assignments,setAssignments]=useState<Record<string,string[]>>({});
  const [editing,setEditing]=useState<DocumentGenerationRequest|null>(null);
  const [working,setWorking]=useState<string|null>(null);
  const [message,setMessage]=useState('');
  const [savedPath,setSavedPath]=useState('');
  const [saveReceipts,setSaveReceipts]=useState<DocumentSaveReceipt[]>([]);
  const [pendingCompletion,setPendingCompletion]=useState<DocumentSaveReceipt|null>(null);
  const [receiptRecoveryReady,setReceiptRecoveryReady]=useState(!('__TAURI_INTERNALS__' in window));
  const mutationKey=useRef(crypto.randomUUID());
  const selectedTemplate=templates.data?.find(item=>item.id===templateId)||templates.data?.[0];
  useEffect(()=>{if(!templateId&&templates.data?.[0])setTemplateId(templates.data[0].id)},[templateId,templates.data]);
  useEffect(()=>{if(!selectedTemplate)return;setAssignments(current=>Object.fromEntries(selectedTemplate.roles.map(role=>[role.key,current[role.key]||[]])))},[selectedTemplate?.id]);
  useEffect(()=>{onNavigationBlockedChange?.(Boolean(working)||Boolean(pendingCompletion))},[working,pendingCompletion,onNavigationBlockedChange]);
  useEffect(()=>()=>onNavigationBlockedChange?.(false),[onNavigationBlockedChange]);
  useEffect(()=>{
    if(!('__TAURI_INTERNALS__' in window))return;
    let disposed=false;
    void documentSaveReceipts('document_request').then(items=>{if(!disposed){setSaveReceipts(items);setReceiptRecoveryReady(true)}})
      .catch(()=>{if(!disposed)setMessage('No se pudieron verificar los recibos de guardado protegidos. Reintenta antes de generar otro documento.')});
    return()=>{disposed=true};
  },[]);
  useEffect(()=>{
    if(!pendingCompletion)return;
    const protect=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};
    window.addEventListener('beforeunload',protect);
    return()=>window.removeEventListener('beforeunload',protect);
  },[pendingCompletion]);
  async function refreshSaveReceipts(){
    if(!('__TAURI_INTERNALS__' in window))return [] as DocumentSaveReceipt[];
    try{const items=await documentSaveReceipts('document_request');
      setSaveReceipts(items);setReceiptRecoveryReady(true);return items;
    }catch(error){setReceiptRecoveryReady(false);throw error}
  }
  async function retryReceiptRecovery(){setWorking('recovery');try{await refreshSaveReceipts();setMessage('Recibos de guardado verificados.')}catch(error){setMessage(explain(error))}finally{setWorking(null)}}
  async function finishSavedRequest(receipt:DocumentSaveReceipt){
    await api.completeDocumentRequest(receipt.case_id,receipt.revision,receipt.id);
    await acknowledgeDocumentSaveReceipt(receipt.id);
    setSaveReceipts(items=>items.filter(item=>item.id!==receipt.id));
    setPendingCompletion(null);onChanged();
  }
  async function retrySavedRequest(){
    if(!pendingCompletion)return;setWorking('recovery');
    try{await finishSavedRequest(pendingCompletion);setMessage('Documento guardado y solicitud retirada.')}catch(error){setMessage(`El archivo permanece guardado. ${explain(error)}`)}finally{setWorking(null)}
  }
  function recoverSavedRequest(receipt:DocumentSaveReceipt){
    if(!receipt.confirmed||working||pendingCompletion)return;
    setPendingCompletion(receipt);setSavedPath(receipt.path);
    setMessage('Guardado recuperado. Retira la solicitud sin generar ni guardar otro Word.');
  }
  async function discardSaveReceipt(receipt:DocumentSaveReceipt){
    if(working||pendingCompletion||!window.confirm('¿Retirar solo este recibo de recuperación? El archivo Word no se eliminará ni modificará y la solicitud permanecerá intacta.'))return;
    setWorking('recovery');try{await acknowledgeDocumentSaveReceipt(receipt.id);setSaveReceipts(items=>items.filter(item=>item.id!==receipt.id));setMessage('Recibo retirado. El Word y la solicitud permanecen intactos.')}catch(error){setMessage(explain(error))}finally{setWorking(null)}
  }
  function selectRole(role:string,values:string[]){setAssignments(current=>({...current,[role]:values}))}
  function beginEdit(item:DocumentGenerationRequest){if(working||pendingCompletion||saveReceipts.some(receipt=>receipt.case_id===item.id))return;onStart();setEditing(item);setTemplateId(item.template_id);setAssignments(item.assignments);setMessage('Editando la solicitud seleccionada.')}
  function resetDraft(){setEditing(null);setAssignments(Object.fromEntries((selectedTemplate?.roles||[]).map(role=>[role.key,[]])))}
  async function saveRequest(){if(!selectedTemplate)return;setWorking('request');setMessage('');try{if(editing)await api.updateDocumentRequest(editing.id,editing.revision,assignments,mutationKey.current);else await api.createDocumentRequest(selectedTemplate.id,selectedTemplate.version,assignments,mutationKey.current);mutationKey.current=crypto.randomUUID();resetDraft();onChanged();setMessage(editing?'Solicitud actualizada.':'Solicitud añadida a la bandeja.')}catch(error){setMessage(explain(error))}finally{setWorking(null)}}
  async function generate(item:DocumentGenerationRequest){
    if(working||pendingCompletion||!receiptRecoveryReady)return;
    setWorking(item.id);setMessage('');setSavedPath('');let physicallySaved=false;
    try{
      const receipts=await refreshSaveReceipts();
      if(receipts.some(receipt=>receipt.case_id===item.id)){setMessage('Esta solicitud ya tiene un recibo de guardado. Utiliza la recuperación o retira expresamente el recibo después de verificarlo.');return}
      const output=await api.generateDocument(item.id,item.revision);
      if('__TAURI_INTERNALS__' in window){
        const {invoke}=await import('@tauri-apps/api/core');
        const result=await invoke<{saved:boolean;path:string|null;opened:boolean;receipt_id:string|null}>('save_docx',{
          name:output.name,bytes:Array.from(new Uint8Array(await output.blob.arrayBuffer())),
          caseContext:{id:item.id,revision:output.revision,kind:'document_request'},
        });
        if(!result.saved){setMessage('Guardado cancelado. La solicitud permanece en la bandeja.');return}
        physicallySaved=true;setSavedPath(result.path||'');
        if(!result.receipt_id)throw new Error('No se recibió el recibo protegido del archivo guardado.');
        const timestamp=Date.now()/1000;
        const receipt:DocumentSaveReceipt={id:result.receipt_id,case_id:item.id,revision:output.revision,
          kind:'document_request',path:result.path||'',created_at:timestamp,expires_at:timestamp+86400,confirmed:true};
        setPendingCompletion(receipt);
        await finishSavedRequest(receipt);
        setMessage(result.opened?'Documento guardado y abierto en Word.':'El documento se guardó, pero Windows no pudo abrir la aplicación asociada.');
      }else{await download(output.blob,output.name);setMessage('Descarga iniciada. En la aplicación Windows la solicitud se retira tras confirmar el guardado.')}
    }catch(error){setMessage(physicallySaved?`El archivo ya está guardado. Falta retirar la solicitud o confirmar su recibo: ${explain(error)}`:explain(error));try{await refreshSaveReceipts()}catch{/* Preserve the original failure and the protected journal. */}}
    finally{setWorking(null)}
  }
  async function reveal(){if(!savedPath)return;try{const {invoke}=await import('@tauri-apps/api/core');await invoke('reveal_file',{path:savedPath})}catch(error){setMessage(explain(error))}}
  async function discard(item:DocumentGenerationRequest){if(working||pendingCompletion||saveReceipts.some(receipt=>receipt.case_id===item.id))return;setWorking(item.id);try{await api.deleteDocumentRequest(item.id);onChanged();setMessage('Solicitud eliminada.')}catch(error){setMessage(explain(error))}finally{setWorking(null)}}
  const complete=selectedTemplate?.roles.every(role=>{const count=(assignments[role.key]||[]).length;return count>=role.minimum&&count<=role.maximum});
  if(!active&&!editing&&!requests.length&&!saveReceipts.length&&!pendingCompletion&&!message&&!savedPath)return null;
  return <section className="document-center" aria-label="Generación de documentos Word">
    <div className="section-header"><div><h2>Documentos Word<span className="session-count">{requests.length}</span></h2><small>Plantillas verificadas · datos aprobados · edición posterior en Word</small></div></div>
    {!receiptRecoveryReady&&<Alert severity="warning" action={<Button disabled={Boolean(working)} onClick={()=>void retryReceiptRecovery()}>Reintentar verificación</Button>}>La generación está bloqueada hasta verificar los recibos de guardado.</Alert>}
    {saveReceipts.length>0&&<section className="surface document-composer" aria-label="Guardados parciales recuperables"><h3>Guardados recuperables</h3><p>Recibos protegidos durante 24 h. Recuperar no genera ni modifica el Word.</p>{saveReceipts.map(receipt=><div className="profile-list-item" key={receipt.id}><div><strong>{receipt.confirmed?'Archivo guardado confirmado':'Guardado no confirmado'}</strong><small>{new Date(receipt.created_at*1000).toLocaleString('es-ES')} · rev. {receipt.revision}</small></div><div><Button disabled={Boolean(working)||Boolean(pendingCompletion)||!receipt.confirmed} onClick={()=>recoverSavedRequest(receipt)}>Recuperar guardado</Button><Button color="warning" disabled={Boolean(working)||Boolean(pendingCompletion)} onClick={()=>void discardSaveReceipt(receipt)}>Retirar recibo</Button></div></div>)}</section>}
    <div className={`document-center-grid ${active||editing?'':'requests-only'}`}>
      {(active||editing)&&<div className="surface document-composer"><div className="rail-head"><h3>{editing?'Corregir asignaciones':'Preparar solicitud'}</h3><FileImage size={17}/></div>
        {templates.isError?<Alert severity="error">{explain(templates.error)}</Alert>:<><label className="document-field">Plantilla<select value={selectedTemplate?.id||''} disabled={Boolean(editing)} onChange={event=>{setTemplateId(event.target.value);setAssignments({})}}>{templates.data?.map(template=><option key={template.id} value={template.id}>{template.title_es} · {template.title_ar}</option>)}</select></label>
        {selectedTemplate&&<p className="document-template-description">{selectedTemplate.description_es}</p>}
        {selectedTemplate?.roles.map(role=><RoleIdentityPicker key={role.key} role={role} identities={identities} disabled={Boolean(working)||Boolean(pendingCompletion)} value={assignments[role.key]||[]} onChange={values=>selectRole(role.key,values)}/>)}
        {!identities.length&&<Alert severity="info">No hay identidades aprobadas. Puedes enviar la plantilla vacía y completar sus datos posteriormente en Word.</Alert>}
        <div className="heading-actions"><Button variant="contained" disabled={!complete||Boolean(working)||Boolean(pendingCompletion)} onClick={saveRequest}>{editing?'Guardar corrección':'Enviar a bandeja'}</Button>{editing&&<Button disabled={Boolean(working)||Boolean(pendingCompletion)} onClick={resetDraft}>Cancelar edición</Button>}</div></>}
      </div>}
      <div className="surface document-requests"><div className="rail-head"><h3>Bandeja de solicitudes</h3><span>{requests.length} pendientes</span></div>
        {!requests.length?<div className="queue-empty"><FileImage size={19}/>Las solicitudes preparadas en Windows o móvil aparecerán aquí.</div>:requests.map(item=>{const template=templates.data?.find(value=>value.id===item.template_id);return <article className="document-request" key={item.id}><div><strong>{template?.title_es||item.template_id}</strong><small>{item.source==='mobile'?'Preparada desde móvil':'Preparada en Windows'} · rev. {item.revision}</small></div>{item.warnings.includes('IDENTITY_ASSIGNED_TO_MULTIPLE_ROLES')&&<Alert severity="warning">La misma identidad aparece en roles diferentes.</Alert>}<div className="heading-actions"><Button size="small" disabled={Boolean(working)||Boolean(pendingCompletion)||saveReceipts.some(receipt=>receipt.case_id===item.id)} onClick={()=>beginEdit(item)}>Revisar asignaciones</Button><Button size="small" variant="contained" disabled={Boolean(working)||Boolean(pendingCompletion)||saveReceipts.some(receipt=>receipt.case_id===item.id)||!receiptRecoveryReady} onClick={()=>generate(item)}>{working===item.id?'Generando…':'Guardar y abrir en Word'}</Button><IconButton size="small" aria-label="Eliminar solicitud" disabled={Boolean(working)||Boolean(pendingCompletion)||saveReceipts.some(receipt=>receipt.case_id===item.id)||!receiptRecoveryReady} onClick={()=>discard(item)}><Trash2 size={15}/></IconButton></div></article>})}
      </div>
    </div>
    {message&&<Alert severity={message.includes('guardado y abierto')||message.includes('actualizada')||message.includes('añadida')?'success':'info'} action={<>{pendingCompletion&&<Button size="small" disabled={Boolean(working)} onClick={()=>void retrySavedRequest()}>Retirar solicitud guardada</Button>}{savedPath&&<Button size="small" onClick={reveal}>Mostrar en el Explorador</Button>}</>}>{message}</Alert>}
  </section>;
}

type SavedCaseReceipt=DocumentSaveReceipt;
const CASE_STATUS_LABEL:Record<CaseDraftSummary['status'],string>={editing:'En edición',final_review:'Revisión final',completed:'Completado'};

export function FullCaseCenter({api,identities,cases,onChanged,active,onNavigationBlockedChange}:{api:CaptureApi;identities:ApprovedIdentitySummary[];cases:CaseDraftSummary[];onChanged:()=>void;active:boolean;onNavigationBlockedChange?:(blocked:boolean)=>void}) {
  const queryClient=useQueryClient();
  const templates=useQuery({queryKey:['document-templates'],queryFn:()=>api.templates(),staleTime:60000});
  const profiles=useQuery({queryKey:['professional-profiles'],queryFn:()=>api.professionalProfiles(),staleTime:30000});
  const [templateId,setTemplateId]=useState('');
  const [draft,setDraft]=useState<CaseDraft|null>(null);
  const [working,setWorking]=useState(false);
  const [feedback,setFeedback]=useState<{message:string;severity:'success'|'info'|'warning'}>({message:'',severity:'info'});
  const {message,severity:messageSeverity}=feedback;
  function setMessage(message:string,severity:'success'|'info'|'warning'='info'){setFeedback({message,severity})}
  const [missing,setMissing]=useState<string[]>([]);
  const [savedPath,setSavedPath]=useState<string|null>(null);
  const [pendingCompletion,setPendingCompletion]=useState<{id:string;revision:number;receiptId?:string}|null>(null);
  const [saveReceipts,setSaveReceipts]=useState<SavedCaseReceipt[]>([]);
  const [receiptRecoveryReady,setReceiptRecoveryReady]=useState(!('__TAURI_INTERNALS__' in window));
  const profileCreateId=useRef(crypto.randomUUID());
  const currentTemplate=templates.data?.find(item=>item.id===(draft?.template_id||templateId))||templates.data?.[0];
  const pinnedTemplate=useQuery({queryKey:['document-template-version',draft?.template_id,draft?.template_version],
    queryFn:()=>api.template(draft!.template_id,draft!.template_version),
    enabled:Boolean(draft&&currentTemplate?.version!==draft.template_version),staleTime:Infinity});
  const selectedTemplate=draft?(currentTemplate?.id===draft.template_id&&currentTemplate.version===draft.template_version
    ?currentTemplate:pinnedTemplate.data):currentTemplate;
  const unfinishedCaseCount=cases.filter(item=>item.status!=='completed').length;
  const collaboration=useCaseCollaboration({api,draft,setDraft,fields:selectedTemplate?.fields,onChanged,onError:error=>setMessage(explain(error))});
  useEffect(()=>{onNavigationBlockedChange?.(working||Boolean(pendingCompletion)||Boolean(collaboration.unsaved)||Boolean(collaboration.saving))},[working,pendingCompletion,collaboration.unsaved,collaboration.saving,onNavigationBlockedChange]);
  useEffect(()=>()=>onNavigationBlockedChange?.(false),[onNavigationBlockedChange]);
  useEffect(()=>{
    if(!pendingCompletion)return;
    const protect=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};
    window.addEventListener('beforeunload',protect);
    return()=>window.removeEventListener('beforeunload',protect);
  },[pendingCompletion]);
  useEffect(()=>{if(!templateId&&templates.data?.[0])setTemplateId(templates.data[0].id)},[templateId,templates.data]);
  async function refreshSaveReceipts(){
    if(!('__TAURI_INTERNALS__' in window))return [] as SavedCaseReceipt[];
    try{const items=await documentSaveReceipts('case');
      setSaveReceipts(items);setReceiptRecoveryReady(true);return items;
    }catch(error){setReceiptRecoveryReady(false);throw error}
  }
  useEffect(()=>{
    if(!('__TAURI_INTERNALS__' in window))return;
    let disposed=false;
    void documentSaveReceipts('case')
      .then(items=>{if(!disposed){setSaveReceipts(items);setReceiptRecoveryReady(true)}})
      .catch(()=>{if(!disposed)setMessage('No se pudieron verificar los recibos de guardado protegidos. Reintenta antes de generar otro documento.')});
    return()=>{disposed=true};
  },[]);
  async function acknowledgeSaveReceipt(receiptId?:string){
    if(!receiptId)return;
    await acknowledgeDocumentSaveReceipt(receiptId);
    setSaveReceipts(items=>items.filter(item=>item.id!==receiptId));
  }
  async function recoverSavedCase(receipt:SavedCaseReceipt){
    if(!receipt.confirmed||working||pendingCompletion)return;
    setWorking(true);
    try{
      if(collaboration.unsaved||collaboration.saving)await collaboration.flush();
      const item=await api.case(receipt.case_id);
      if(!((item.status==='final_review'&&item.revision===receipt.revision)||
          (item.status==='completed'&&item.revision===receipt.revision+1))){
        setMessage('Este recibo corresponde a una revisión anterior. No se cerró ningún expediente y el archivo guardado permanece independiente.');return;
      }
      setDraft(item);setSavedPath(receipt.path);setMissing([]);
      setPendingCompletion({id:receipt.case_id,revision:receipt.revision,receiptId:receipt.id});
      setMessage('Guardado recuperado. Cierra el expediente sin generar ni guardar otro archivo.');
    }catch(error){setMessage(explain(error))}finally{setWorking(false)}
  }
  async function discardSaveReceipt(receipt:SavedCaseReceipt){
    if(working||pendingCompletion||!window.confirm('¿Retirar solamente este recibo de recuperación? El documento Word no se eliminará ni modificará.'))return;
    setWorking(true);try{await acknowledgeSaveReceipt(receipt.id);setMessage('Recibo retirado. El archivo Word permanece sin cambios.','success')}catch(error){setMessage(explain(error))}finally{setWorking(false)}
  }
  async function retryReceiptRecovery(){setWorking(true);try{await refreshSaveReceipts();setMessage('Recibos de guardado verificados.','success')}catch(error){setMessage(explain(error))}finally{setWorking(false)}}
  async function createCase(){if(!selectedTemplate)return;setWorking(true);setMessage('');try{const item=await api.createCase(selectedTemplate.id,selectedTemplate.version,'complete');setDraft(item);onChanged()}catch(error){setMessage(explain(error))}finally{setWorking(false)}}
  async function openCase(id:string){
    if(working||pendingCompletion)return;
    setWorking(true);
    try{
      if(collaboration.unsaved||collaboration.saving)await collaboration.flush();
      const next=id?await api.case(id):null;
      setDraft(next);setMissing([]);setSavedPath(null);setMessage('');
    }catch(error){setMessage(explain(error))}finally{setWorking(false)}
  }
  function setRole(role:string,values:string[]){collaboration.editRole(role,values)}
  function setField(key:string,value:string|string[]){collaboration.editField(key,value)}
  async function saveDraft():Promise<CaseDraft|null>{return collaboration.flush()}
  async function save(){setWorking(true);setMessage('');try{await saveDraft();setMessage('Borrador cifrado guardado.','success')}catch(error){setMessage(explain(error))}finally{setWorking(false)}}
  async function finalReview(){setWorking(true);setMessage('');try{const saved=await saveDraft();if(!saved)return;const reviewed=await api.beginCaseFinalReview(saved.id,saved.revision);setDraft(reviewed);const readiness=await api.caseReadiness(reviewed.id);setMissing(readiness.missing_fields);setMessage(readiness.missing_fields.length?'Revisión final abierta con campos pendientes.':'Revisión final preparada.')}catch(error){setMessage(explain(error))}finally{setWorking(false)}}
  async function reopen(){if(!draft)return;setWorking(true);try{const item=await api.reopenCase(draft.id,draft.revision);setDraft(item);setMissing([]);onChanged()}catch(error){setMessage(explain(error))}finally{setWorking(false)}}
  async function requestGeneration(){if(!draft||!receiptRecoveryReady)return;setWorking(true);try{const receipts=await refreshSaveReceipts();if(receipts.some(item=>item.case_id===draft.id)){setMessage('Ya existe un recibo de guardado para este expediente. Recupéralo o retíralo expresamente después de verificar el archivo.');return}const readiness=await api.caseReadiness(draft.id);setMissing(readiness.missing_fields);await generate(Boolean(readiness.missing_fields.length))}catch(error){setMessage(explain(error))}finally{setWorking(false)}}
  async function generate(confirmIncomplete:boolean){
    if(!draft||pendingCompletion)return;
    setWorking(true);setMessage('');setSavedPath(null);
    let physicallySaved=false;
    try {
      const output=await api.generateCase(draft.id,draft.revision,confirmIncomplete);
      if('__TAURI_INTERNALS__' in window){
        const {invoke}=await import('@tauri-apps/api/core');
        const result=await invoke<{saved:boolean;path:string|null;opened:boolean;receipt_id?:string}>('save_docx',{
          name:output.name,bytes:Array.from(new Uint8Array(await output.blob.arrayBuffer())),
          caseContext:{id:draft.id,revision:output.revision},
        });
        if(!result.saved){setMessage('Guardado cancelado. El expediente permanece en revisión final.');return}
        physicallySaved=true;setSavedPath(result.path);
        setPendingCompletion({id:draft.id,revision:output.revision,receiptId:result.receipt_id});
        const completed=await api.completeCase(draft.id,output.revision);
        await acknowledgeSaveReceipt(result.receipt_id);
        setDraft(completed);setPendingCompletion(null);onChanged();
        setMessage(result.opened?'Documento guardado y abierto en Word.':'Documento guardado, pero Windows no pudo abrir Word. El archivo sigue disponible.',result.opened?'success':'warning');
      }else{
        await download(output.blob,output.name);
        setMessage('Descarga iniciada. La validación final permanece disponible en Windows.');
      }
    }catch(error){setMessage(physicallySaved?`El archivo está guardado. Debes reintentar únicamente el cierre del expediente: ${explain(error)}`:explain(error));try{await refreshSaveReceipts()}catch{/* Keep the original failure visible; protected receipts remain available after restart. */}}
    finally{setWorking(false)}
  }
  async function finishSavedDocument(){if(!pendingCompletion)return;setWorking(true);try{const completed=await api.completeCase(pendingCompletion.id,pendingCompletion.revision);await acknowledgeSaveReceipt(pendingCompletion.receiptId);setDraft(completed);setPendingCompletion(null);onChanged();setMessage('Documento guardado y expediente cerrado.','success')}catch(error){setMessage(`El archivo sigue guardado. ${explain(error)}`)}finally{setWorking(false)}}
  async function revealSavedDocument(){if(!savedPath)return;try{const {invoke}=await import('@tauri-apps/api/core');await invoke('reveal_file',{path:savedPath})}catch{setMessage('El documento está guardado, pero no se pudo abrir el Explorador.')}}
  async function createProfile(form:ProfessionalProfileForm){setWorking(true);try{await api.createProfessionalProfile(form.display_name_ar,form.display_name_fr,form.function_fr,profileCreateId.current);profileCreateId.current=crypto.randomUUID();await queryClient.invalidateQueries({queryKey:['professional-profiles']});setMessage('Perfil profesional añadido.','success')}catch(error){setMessage(explain(error));throw error}finally{setWorking(false)}}
  async function updateProfile(profile:ProfessionalProfile){setWorking(true);try{await api.updateProfessionalProfile(profile);await queryClient.invalidateQueries({queryKey:['professional-profiles']});setMessage('Perfil profesional actualizado.','success')}catch(error){setMessage(explain(error));throw error}finally{setWorking(false)}}
  async function removeProfile(profile:ProfessionalProfile){if(!window.confirm(`¿Eliminar definitivamente el perfil «${profile.display_name_fr||profile.display_name_ar}»?`))return;setWorking(true);try{await api.deleteProfessionalProfile(profile.id);await queryClient.invalidateQueries({queryKey:['professional-profiles']});setMessage('Perfil eliminado.','success')}catch(error){setMessage(explain(error));throw error}finally{setWorking(false)}}
  function fieldControl(field:TemplateFieldDefinition){const value=draft?.fields[field.key];const common=collaboration.bind(field.key);if(field.repeatable)return <RepeatableLegalField field={field} value={Array.isArray(value)?value:[]} identities={identities} identityIds={field.role?draft?.assignments[field.role]:undefined} {...common} onChange={values=>setField(field.key,values)}/>;if(field.type==='professional_profile'){const selected=typeof value==='string'?value:'';const choices=(profiles.data||[]).filter(item=>item.active||item.id===selected);return <ProfessionalProfileField {...common} profiles={choices} value={selected} maximumCharacters={field.maximum_characters} onChange={next=>setField(field.key,next)}/>}return <input {...common} type={field.type==='date'?'date':'text'} inputMode={field.type==='number'?'numeric':undefined} dir={field.direction} value={typeof value==='string'?value:''} maxLength={field.maximum_characters} onChange={event=>setField(field.key,event.target.value)}/>}
  if(!active&&!draft&&!saveReceipts.length)return null;
return <section className="document-center full-case-center" aria-label="Expediente de relleno completo"><div className="section-header"><div><h2>Relleno completo<span className="session-count">{cases.length}</span></h2><small>Borradores cifrados · conservación máxima 24 h · generación en Windows</small></div>{cases.length>0&&<select aria-label="Abrir un expediente" disabled={working||Boolean(pendingCompletion)} value={draft?.id||''} onChange={event=>void openCase(event.target.value)}><option value="">Nuevo expediente</option>{cases.map(item=><option key={item.id} value={item.id}>{item.template_id} · {CASE_STATUS_LABEL[item.status]} · {new Date(item.updated_at).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}</option>)}</select>}</div>
    {saveReceipts.length>0&&<section className="surface document-composer" aria-label="Guardados recuperables"><h3>Guardados recuperables</h3><p>Estos recibos protegidos caducan después de 24 horas. La recuperación no genera ni modifica ningún archivo Word.</p>{saveReceipts.map(receipt=><div className="profile-list-item" key={receipt.id}><div><strong>{receipt.confirmed?'Archivo guardado confirmado':'Guardado no confirmado'}</strong><small>{new Date(receipt.created_at*1000).toLocaleString('es-ES')} · rev. {receipt.revision}</small></div><div><Button disabled={working||Boolean(pendingCompletion)||!receipt.confirmed} onClick={()=>void recoverSavedCase(receipt)}>Recuperar expediente</Button><Button color="warning" disabled={working||Boolean(pendingCompletion)} onClick={()=>void discardSaveReceipt(receipt)}>Retirar recibo</Button></div></div>)}</section>}
    {!receiptRecoveryReady&&<Alert severity="warning" action={<Button disabled={working} onClick={()=>void retryReceiptRecovery()}>Reintentar</Button>}>La generación permanece bloqueada hasta verificar los recibos de guardado.</Alert>}
    {!draft?<div className="surface document-composer">{unfinishedCaseCount>0&&<Alert severity="info">Hay {unfinishedCaseCount} expediente{unfinishedCaseCount===1?'':'s'} sin finalizar. Puedes abrirlo{unfinishedCaseCount===1?'':'s'} desde el selector superior antes de crear otro.</Alert>}<label className="document-field">Plantilla<select value={selectedTemplate?.id||''} onChange={event=>setTemplateId(event.target.value)}>{templates.data?.map(template=><option key={template.id} value={template.id}>{template.title_es} · {template.title_ar}</option>)}</select></label>{selectedTemplate&&<p className="document-template-description">{selectedTemplate.description_es}</p>}<Button variant="contained" disabled={working||!selectedTemplate} onClick={createCase}>{unfinishedCaseCount?'Crear otro expediente temporal':'Crear expediente temporal'}</Button></div>:<div className="surface document-composer"><div className="rail-head"><h3>{selectedTemplate?.title_es}</h3><span>rev. {draft.revision} · {CASE_STATUS_LABEL[draft.status]} · {collaboration.saving?'guardando…':collaboration.unsaved?`${collaboration.unsaved} cambio(s) sin guardar`:'actualizado'}</span></div>
      {selectedTemplate?.roles.map(role=><RoleIdentityPicker key={role.key} role={role} identities={identities} locale="es" {...collaboration.bind(`role.${role.key}`)} value={draft.assignments[role.key]||[]} onChange={values=>setRole(role.key,values)}/>)}
      <div className="case-field-grid">{selectedTemplate?.fields?.map(field=>field.repeatable?<div className="document-field" key={field.key}>{fieldControl(field)}</div>:<label className={`document-field ${field.direction==='rtl'?'rtl-field':''}`} key={field.key}><span>{field.label_fr}{field.required&&<b aria-label="recomendado" title="Recomendado; no bloquea"> · recomendado</b>}<small lang="ar" dir="rtl">{field.label_ar}</small></span>{fieldControl(field)}</label>)}</div>
      {missing.length>0&&<Alert severity="warning">Campos pendientes: {missing.map(key=>selectedTemplate?.fields?.find(field=>field.key===key)?.label_fr||key).join(', ')}.</Alert>}
      <div className="heading-actions">{draft.status==='editing'?<><Button variant="outlined" disabled={working} onClick={save}>Guardar borrador</Button><Button variant="contained" disabled={working} onClick={finalReview}>Abrir revisión final</Button></>:<><Button disabled={working||Boolean(pendingCompletion)} onClick={reopen}>Continuar editando</Button>{draft.status==='final_review'&&<Button variant="contained" disabled={working||Boolean(pendingCompletion)||!receiptRecoveryReady||saveReceipts.some(item=>item.case_id===draft.id)} onClick={requestGeneration}>Guardar y abrir en Word</Button>}</>}</div></div>}
    {selectedTemplate?.fields?.some(field=>field.type==='professional_profile')&&<ProfessionalProfileManager profiles={profiles.data||[]} disabled={working} onCreate={createProfile} onUpdate={updateProfile} onDelete={removeProfile}/>}
    {message&&<Alert severity={messageSeverity} action={<>{pendingCompletion&&<Button size="small" disabled={working} onClick={()=>void finishSavedDocument()}>Cerrar expediente guardado</Button>}{savedPath&&<Button size="small" onClick={()=>void revealSavedDocument()}>Mostrar en el Explorador</Button>}</>}>{message}</Alert>}
  </section>;
}

function App({api, version}: {api: CaptureApi; version: string}) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState<Page>('capture');
  const [side, setSide] = useState<CaptureSide>('front');
  const [cardModel,setCardModel]=useState<CardModel>('CNIE_MA_2020');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [pairOpen, setPairOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [lanIp, setLanIp] = useState('');
  const [lanConfigured, setLanConfigured] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [documentMode,setDocumentMode]=useState<'partial'|'complete'|null>(null);
  const [caseNavigationBlocked,setCaseNavigationBlocked]=useState(false);
  const [partialNavigationBlocked,setPartialNavigationBlocked]=useState(false);
  const [temporarySessionEpoch,setTemporarySessionEpoch]=useState(0);
  const documentCard=useRef<HTMLElement|null>(null);
  const input = useRef<HTMLInputElement>(null);
  const credentialInput = useRef<HTMLInputElement>(null);
  const workspace = useQuery({queryKey:['workspace'], queryFn:() => api.workspace(), refetchInterval:4000});
  const model = useQuery({queryKey:['model'], queryFn:() => api.request<Record<string, unknown>>('/model'), enabled:page === 'diagnostics'});
  const ocrConfig = useQuery({queryKey:['ocr-config'], queryFn:() => api.ocrConfig(), enabled:page === 'diagnostics'});
  const captures = (workspace.data?.captures || []).filter(capture => capture.active);
  const documents = workspace.data?.documents || [];
  const selected = captures.find(c => c.id === selectedId) || null;
  const selectedDocument = documents.find(document => document.id === selected?.document_id);
  const pending = documents.filter(document=>['attention','data_review_required'].includes(document.status)).length;
  const refresh = useCallback(() => {void queryClient.invalidateQueries({queryKey:['workspace']});void queryClient.invalidateQueries({queryKey:['extraction']});void queryClient.invalidateQueries({queryKey:['professional-profiles']})}, [queryClient]);
  useEffect(() => api.subscribe(refresh), [api, refresh]);
  useEffect(() => {const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer)}, []);
  function continueToDocuments(){window.setTimeout(()=>documentCard.current?.scrollIntoView({block:'start',behavior:'smooth'}),100)}

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
    await action(async () => {const item = await api.upload(file, side, crypto.randomUUID(), selected?.document_id, selectedDocument?.card_model||cardModel); setSelectedId(item.id); setPage('capture')});
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
  async function clearTemporaryData() {
    await action(async () => {
      if('__TAURI_INTERNALS__' in window){
        const {invoke}=await import('@tauri-apps/api/core');
        await invoke('clear_case_save_receipts');
      }
      await api.clearTemporaryData();
      setTemporarySessionEpoch(value=>value+1);
      setSelectedId(null); setDocumentMode(null); setPairing(null); setClearOpen(false);
      setNotice('Los datos temporales, expedientes y conexiones móviles se eliminaron de forma segura.');
    });
  }
  const deviceCount = workspace.data?.connected_devices || 0;
  return <div className="app-shell">
    <aside className="sidebar"><Brand/>
      <div className="workspace-switch"><span className="square-icon"><Monitor size={15}/></span><span>Oficina local<small>Espacio de trabajo</small></span><ChevronDown size={12}/></div>
      <p className="nav-label">ESPACIO DE TRABAJO</p>
      <nav aria-label="Navegación principal">
        <button className={`nav-item ${page === 'capture' ? 'active' : ''}`} onClick={() => setPage('capture')} aria-label="Trabajo con CNIE y documentos"><ScanLine size={17}/><span>CNIE y documentos</span>{pending > 0 && <b className="count">{pending}</b>}</button>
        <button className={`nav-item ${page === 'devices' ? 'active' : ''}`} disabled={(caseNavigationBlocked||partialNavigationBlocked)} title={(caseNavigationBlocked||partialNavigationBlocked)?'Termine el guardado del expediente antes de cambiar de pantalla.':undefined} onClick={() => setPage('devices')} aria-label="Dispositivos"><Smartphone size={17}/><span>Dispositivos</span></button>
      </nav>
      <hr className="sidebar-separator"/><p className="nav-label">ADMINISTRACIÓN</p>
      <button className={`nav-item ${page === 'diagnostics' ? 'active' : ''}`} disabled={(caseNavigationBlocked||partialNavigationBlocked)} title={(caseNavigationBlocked||partialNavigationBlocked)?'Termine el guardado del expediente antes de cambiar de pantalla.':undefined} onClick={() => setPage('diagnostics')} aria-label="Diagnóstico del motor"><Settings2 size={17}/><span>Diagnóstico del motor</span></button>
      <button className="nav-item" onClick={() => setHelpOpen(true)} aria-label="Guía de captura"><CircleHelp size={17}/><span>Guía de captura</span></button>
      <div className="sidebar-bottom"><div className="local-note"><strong><ShieldCheck size={14}/>Flujo controlado</strong><p>Una imagen válida pasa automáticamente a Vision UE. Los 14 datos siempre requieren confirmación humana.</p></div>
        <div className="operator"><div className="operator-avatar">OP</div><div>Operador local<small>Estación de captura</small></div></div></div>
    </aside>
    <main className="workspace-main"><header className="topbar"><div className="breadcrumb"><Monitor size={13}/><span>Espacio de trabajo</span><ChevronRight size={12}/><span>{page === 'capture' ? 'CNIE y documentos' : page === 'devices' ? 'Dispositivos' : 'Diagnóstico'}</span></div>
      <div className="topbar-end"><span className={`connection-dot ${workspace.isError ? 'offline' : ''}`}>{workspace.isError ? 'Sin conexión al servicio' : workspace.isPending ? 'Conectando' : 'Servicio local conectado'}</span><Tooltip title="Guía de captura"><IconButton size="small" onClick={() => setHelpOpen(true)} aria-label="Abrir ayuda"><CircleHelp size={17}/></IconButton></Tooltip></div></header>
      <div className="content">
        <div className="page-heading"><div><div className="eyebrow">FLUJO DE TRABAJO</div><h1>{page === 'capture' ? 'De la CNIE al documento Word.' : page === 'devices' ? 'Conecta tu cámara.' : 'Un motor, a la vista.'}</h1><p>{page === 'capture' ? 'Captura ambas caras, confirma los datos y prepara el documento sin salir de esta pantalla.' : page === 'devices' ? 'Empareja los móviles de la oficina con esta estación.' : 'Estado real del modelo y de la última rectificación.'}</p></div>
          {page === 'capture' && <div className="heading-actions"><Button variant="outlined" startIcon={<Upload size={15}/>} onClick={() => input.current?.click()} disabled={busy}>Importar imagen</Button><Button variant="contained" startIcon={<Plus size={16}/>} onClick={startPairing} disabled={busy}>Nueva captura</Button></div>}</div>
        <input ref={input} className="hidden-input" type="file" accept="image/jpeg,image/png" aria-label="Seleccionar fotografía" onChange={e => upload(e.target.files?.[0])}/>
        <input ref={credentialInput} className="hidden-input" type="file" accept="application/json,.json" aria-label="Importar credencial Google" onChange={e => importCredential(e.target.files?.[0])}/>
        {(error || workspace.isError) && <Alert className="error-banner" severity="error" onClose={() => setError('')}>{error || explain(workspace.error)}</Alert>}
        {workspace.data?.storage_error && <Alert className="error-banner" severity="error">{instructions[workspace.data.storage_error] || workspace.data.storage_error} El OCR se reanudará cuando vuelva a ser posible guardar la sesión.</Alert>}
        {notice && <Alert className="error-banner" severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
        {page === 'capture' ? <>
          <section className="workflow-strip surface" aria-label="Progreso del documento"><div className={`workflow-step ${!selected||selectedDocument?.status==='capturing'||selectedDocument?.status==='attention'?'current':''}`}><span className="step-num">01</span>Capturar CNIE</div><span className="workflow-line"/><div className={`workflow-step ${selectedDocument?.status==='ocr_pending'||selectedDocument?.status==='data_review_required'?'current':''}`}><span className="step-num">02</span>Confirmar datos</div><span className="workflow-line"/><div className={`workflow-step ${selectedDocument?.status==='ready'||documentMode==='partial'?'current':''}`}><span className="step-num">03</span>Preparar Word</div></section>
          <div className="workspace-grid"><section className="surface station" aria-label="Estación de revisión">
            <div className="station-toolbar"><h2><ScanLine size={15}/>Estación de captura</h2><div className="toolbar-meta">CNIE marroquí<span>·</span>ID-1</div></div>
            <div className="card-model-bar"><label htmlFor="desktop-card-model">Modelo de tarjeta<select id="desktop-card-model" value={selectedDocument?.card_model||cardModel} disabled={!!selectedDocument||busy} onChange={event=>setCardModel(event.target.value as CardModel)}><option value="CNIE_MA_2020">CNIE 2020 · predeterminado</option><option value="CNIE_MA_LEGACY">CNIE antigua</option></select></label>{selectedDocument&&<Button size="small" onClick={()=>{setSelectedId(null);setSide('front');setCardModel('CNIE_MA_2020')}}>Nueva CNIE</Button>}</div>
            <div className="canvas-stage">{busy ? <div className="stage-empty"><CircularProgress size={28}/><h3>Preparando tu captura</h3><p>Estamos comprobando la imagen en este equipo.</p></div> : selected ? <CaptureWorkflow api={api} capture={selected} document={selectedDocument} captures={captures} onChanged={refresh} onContinue={continueToDocuments} onRetry={id=>void action(()=>api.retryOcr(id))}/> : <><div className="stage-empty"><CardIllustration/><h3>Tu próximo documento empieza aquí</h3><p>Conecta tu móvil para tomar una fotografía o importa una imagen desde este equipo.</p></div><span className="stage-caption"><ShieldCheck size={12}/>Imágenes y datos temporales cifrados · máximo 24 h</span></>}</div>
            <div className="station-foot"><div className="side-toggle" aria-label="Cara del documento">{(['front','back'] as const).map(value => <button key={value} className={(selected?.side || side) === value ? 'selected' : ''} aria-pressed={(selected?.side || side) === value} onClick={() => {setSide(value);const id=value==='front'?selectedDocument?.front_capture_id:selectedDocument?.back_capture_id;if(id)setSelectedId(id)}}>{value === 'front' ? 'Anverso' : 'Reverso'}</button>)}</div><span>{selected ? <Status status={selected.result.status} review={selected.review}/> : <><FileImage size={12}/>JPEG o PNG · hasta 20 MB</>}</span>{selected && <Tooltip title="Ampliar comparación"><IconButton size="small" onClick={() => setFullscreen(true)} aria-label="Ampliar comparación"><Maximize2 size={15}/></IconButton></Tooltip>}</div>
            {selected && <div className="review-toolbar"><Button size="small" startIcon={<RotateCcw size={13}/>} disabled={busy} onClick={() => action(() => api.review(selected.id,'retake'))}>Repetir esta cara</Button><span className="spacer"/><Tooltip title="Exportar imagen rectificada"><span><IconButton size="small" disabled={busy || selected.result.status !== 'success'} onClick={downloadImage} aria-label="Exportar imagen"><Download size={16}/></IconButton></span></Tooltip><Tooltip title="Eliminar captura"><IconButton size="small" onClick={() => setDeleteOpen(true)} aria-label="Eliminar captura"><Trash2 size={15}/></IconButton></Tooltip></div>}
          </section><aside className="right-rail">
            <section className="rail-card surface"><div className="rail-head"><h2>Captura desde tu móvil</h2><Smartphone size={16}/></div><p>Una cámara. Un QR. Tu documento llega directamente a esta estación.</p><div className="pair-visual"><div className="phone-symbol"><QrCode size={20}/></div><div className="pair-line"/><div className="pair-copy">{deviceCount ? `${deviceCount} móvil conectado` : 'Conexión de oficina'}<small>{deviceCount ? 'Preparado para recibir capturas' : 'Sin cables ni instalaciones'}</small></div></div><Button fullWidth variant="outlined" startIcon={<QrCode size={15}/>} onClick={startPairing}>Conectar móvil</Button></section>
            <section className="rail-card surface"><div className="rail-head"><h2>Una buena captura</h2><Sun size={15}/></div><ul className="checklist"><li><Focus size={15}/><span><strong>Cuatro esquinas visibles</strong>Deja un pequeño margen alrededor.</span></li><li><Sun size={15}/><span><strong>Luz suave, sin reflejos</strong>Evita el flash y las sombras directas.</span></li><li><Layers3 size={15}/><span><strong>Fondo mate y uniforme</strong>Una sola tarjeta, sin objetos encima.</span></li></ul></section>
          </aside></div>
          <div ref={node=>{documentCard.current=node}}>{Boolean(workspace.data?.approved_identities.length||workspace.data?.document_generation_requests.length||workspace.data?.case_drafts.length)&&<DocumentModeCard mode={documentMode} onSelect={setDocumentMode}/>}<DocumentCenter key={`partial-${temporarySessionEpoch}`} onNavigationBlockedChange={setPartialNavigationBlocked} api={api} identities={workspace.data?.approved_identities||[]} requests={workspace.data?.document_generation_requests||[]} onChanged={refresh} active={documentMode==='partial'} onStart={()=>setDocumentMode('partial')}/><FullCaseCenter key={`complete-${temporarySessionEpoch}`} onNavigationBlockedChange={setCaseNavigationBlocked} api={api} identities={workspace.data?.approved_identities||[]} cases={workspace.data?.case_drafts||[]} onChanged={refresh} active={documentMode==='complete'}/></div>
          <section className="session-section"><div className="section-header"><div><h2>CNIE de esta sesión<span className="session-count">{documents.length}</span></h2><small>Imágenes, OCR y datos temporales</small></div><Button size="small" color="warning" startIcon={<Trash2 size={14}/>} disabled={busy||!(documents.length||workspace.data?.approved_identities.length||workspace.data?.document_generation_requests.length||workspace.data?.case_drafts.length)} onClick={()=>setClearOpen(true)}>Limpiar sesión</Button></div><div className="surface"><div className="queue-head document-head"><span>Documento</span><span>Anverso</span><span>Reverso</span><span>Estado</span></div>{documents.length === 0 ? <div className="queue-empty"><FileImage size={19}/>{workspace.isPending ? 'Conectando con tu estación…' : 'Tus documentos aparecerán aquí con sus dos caras.'}</div> : documents.map(document => {const front=captures.find(c=>c.id===document.front_capture_id);const back=captures.find(c=>c.id===document.back_capture_id);const chosen=front||back;const label={capturing:'Falta una cara',review_required:'Repetir cara',ocr_pending:'Procesando datos',data_review_required:'Revisar datos',ready:'Aprobada',attention:'Atención'}[document.status];return <button key={document.id} className={`queue-row document-row ${selected?.document_id === document.id ? 'is-selected' : ''}`} onClick={() => chosen && setSelectedId(chosen.id)}><span className="queue-name"><FileImage size={16}/>CNIE · {document.id.slice(0,8)}</span><span className={`face-indicator ${front?.ocr_summary.status === 'success'?'done':''}`}>{front?front.ocr_summary.status==='success'?'Leída':front.review==='accepted'?'Procesando':'Capturado':'Pendiente'}</span><span className={`face-indicator ${back?.ocr_summary.status === 'success'?'done':''}`}>{back?back.ocr_summary.status==='success'?'Leída':back.review==='accepted'?'Procesando':'Capturado':'Pendiente'}</span><span className={`document-status ${document.status}`}>{label}</span></button>})}</div></section>
        </> : page === 'devices' ? <section className="connection-page surface"><div className="rail-head"><h2>Dispositivos de captura</h2><Wifi size={20}/></div><p>{deviceCount ? `${deviceCount} dispositivo(s) emparejado(s) con esta estación.` : 'Todavía no hay un móvil emparejado.'} El QR dura dos minutos y se puede utilizar una sola vez.</p><p>El móvil debe estar conectado a la misma red de la oficina. La sesión dura hasta cuatro horas.</p><div className="heading-actions"><Button variant="contained" startIcon={<QrCode size={16}/>} onClick={startPairing}>Generar QR</Button><Button disabled={!deviceCount || busy} onClick={() => action(() => api.disconnect())}>Desconectar móviles</Button></div>{workspace.data?.mobile_url ? <><Alert severity="success" style={{marginTop:20}}>{workspace.data.lan_mode === 'automatic' ? 'Dirección detectada y protegida automáticamente.' : workspace.data.lan_mode === 'managed' ? 'Dirección administrada por la configuración de TI.' : 'Dirección manual activa y protegida.'}</Alert><p>Dirección activa: <code>{workspace.data.mobile_url}</code></p></> : <div className="lan-setup"><h3>No se pudo elegir la red automáticamente</h3><p>Esto puede ocurrir cuando hay varias tarjetas de red, una VPN o ninguna conexión activa. Como respaldo, introduce la IPv4 privada y estable de la red de oficina.</p><div className="lan-form"><input className="lan-input" value={lanIp} onChange={e => setLanIp(e.target.value)} placeholder="Ej. 192.168.0.107" inputMode="numeric" aria-label="IPv4 privada del PC"/><Button variant="outlined" disabled={busy || !lanIp.trim()} onClick={configureLan}>{busy ? 'Configurando…' : 'Usar dirección manual'}</Button></div>{lanConfigured && <Alert className="lan-success" severity="success" action={<Button size="small" onClick={restartApp}>Reiniciar ahora</Button>}>Certificado creado. Reinicia e-notario para activar la cámara móvil.</Alert>}</div>}</section> : <div className="diagnostic-grid"><section className="connection-page surface"><div className="rail-head"><h2>Google Cloud Vision · UE</h2><ShieldCheck size={19}/></div>{ocrConfig.isPending?<CircularProgress size={24}/>:ocrConfig.isError?<Alert severity="error">{explain(ocrConfig.error)}</Alert>:<><Alert severity={ocrConfig.data?.configured?'success':'warning'}>{ocrConfig.data?.configured?'Credencial cifrada con Windows DPAPI para este usuario.':'OCR sin configurar. Importa la cuenta de servicio dedicada.'}</Alert>{ocrConfig.data?.configured&&<dl><div className="metric-pair"><dt>Proyecto</dt><dd>{ocrConfig.data.project_id}</dd></div><div className="metric-pair"><dt>Cuenta</dt><dd>{ocrConfig.data.client_email}</dd></div><div className="metric-pair"><dt>Región</dt><dd>eu · endpoint europeo</dd></div><div className="metric-pair"><dt>Uso hoy</dt><dd>{ocrConfig.data.limits.used_today} / {ocrConfig.data.limits.daily_limit}</dd></div><div className="metric-pair"><dt>Uso mensual</dt><dd>{ocrConfig.data.limits.used_month} / {ocrConfig.data.limits.monthly_limit}</dd></div></dl>}<div className="heading-actions diagnostic-actions"><Button variant="contained" startIcon={<Upload size={14}/>} onClick={()=>credentialInput.current?.click()}>{ocrConfig.data?.configured?'Sustituir credencial':'Importar credencial Google'}</Button><Button disabled={!ocrConfig.data?.configured||busy} onClick={()=>action(()=>api.testOcr())}>Probar conexión</Button><Button color="error" disabled={!ocrConfig.data?.configured||busy} onClick={()=>action(async()=>{await api.deleteCredential();await queryClient.invalidateQueries({queryKey:['ocr-config']})})}>Eliminar credencial</Button></div><p>El JSON original no se elimina. TI debe retirarlo mediante su procedimiento seguro.</p></>}</section><section className="connection-page surface"><h2>Modelo local · ONNX Runtime</h2><p>La Fase 1 permanece congelada. Estos datos proceden del motor instalado.</p>{model.isPending ? <CircularProgress size={24}/> : model.isError ? <Alert severity="error">{explain(model.error)}</Alert> : <pre className="model-json">{JSON.stringify(model.data,null,2)}</pre>}</section><section className="rail-card surface"><h2>Captura seleccionada</h2>{selected ? <><dl>{Object.entries(selected.result.timings_ms).map(([name,value]) => <div className="metric-pair" key={name}><dt>{name.replaceAll('_',' ')}</dt><dd>{value.toFixed(1)} ms</dd></div>)}</dl><p>Coincidencia de detectores: {selected.result.detector_iou == null ? 'No disponible' : `${(selected.result.detector_iou * 100).toFixed(1)} % IoU`}</p>{selected.result.rejection_codes.map(code => <p className="code-note" key={code}>{instructions[code] || code}</p>)}<Button size="small" startIcon={<Download size={14}/>} onClick={() => download(new Blob([JSON.stringify(selected,null,2)],{type:'application/json'}),`diagnostico-${selected.id.slice(0,8)}.json`)}>Exportar diagnóstico</Button></> : <p style={{marginTop:15}}>Selecciona una captura para consultar sus métricas y tiempos.</p>}</section></div>}
        <footer className="footer-note"><span><ShieldCheck size={12}/>Imagen validada localmente · datos cifrados · máximo 24 h</span><span>e-notario {version}<span>·</span>Captura, OCR y extracción local</span></footer>
      </div>
    </main>
    <Dialog open={pairOpen} onClose={() => setPairOpen(false)} fullWidth maxWidth="xs"><DialogTitle>Conectar un móvil</DialogTitle><DialogContent><div className="qr-container">{pairing && pairing.expires_at * 1000 > now ? <><QRCodeSVG value={pairing.url} size={208} level="M"/><p>Escanea este QR con la cámara del móvil, conectado a la red de la oficina.</p><span className="status status-green"><Clock3 size={12}/>Caduca en {Math.max(0,Math.ceil(pairing.expires_at - now/1000))} s</span></> : !workspace.data?.mobile_url ? <><Link2 size={36}/><p>Primero activa HTTPS desde la sección «Dispositivos». El servicio debe presentar un certificado de confianza al móvil.</p><Button onClick={() => {setPairOpen(false);setPage('devices')}}>Abrir configuración</Button><p>La guía de instalación explica cómo confiar en la CA pública y abrir el puerto de captura.</p></> : busy ? <CircularProgress size={30}/> : <><Clock3 size={32}/><p>Genera un QR nuevo para iniciar el emparejamiento.</p><Button onClick={startPairing}>Generar QR</Button></>}</div></DialogContent><DialogActions><Button onClick={() => setPairOpen(false)}>Cerrar</Button></DialogActions></Dialog>
    <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} fullWidth maxWidth="sm"><DialogTitle>Una captura que conserva cada detalle</DialogTitle><DialogContent><p className="mobile-lead">Coloca una sola CNIE sobre un fondo mate, uniforme y contrastante. Mantén visibles las cuatro esquinas, sin dedos, y usa luz difusa.</p><ul className="checklist"><li><Check size={16}/><span>La tarjeta debe ocupar aproximadamente del 50 % al 90 % del encuadre.</span></li><li><Check size={16}/><span>Su lado corto debe medir al menos 1.000 píxeles en la fotografía.</span></li><li><Check size={16}/><span>Revisa anverso y reverso por separado. Exporta las imágenes que necesites antes de cerrar.</span></li><li><ShieldCheck size={16}/><span>Las capturas se conservan cifradas hasta 24 horas y pueden reanudarse tras reiniciar. «Limpiar sesión» las elimina de inmediato.</span></li></ul></DialogContent><DialogActions><Button onClick={() => setHelpOpen(false)}>Entendido</Button></DialogActions></Dialog>
    <Dialog open={fullscreen && !!selected} onClose={() => setFullscreen(false)} fullWidth maxWidth="lg"><DialogTitle>Revisión del documento</DialogTitle><DialogContent>{selected && <CaptureImages api={api} capture={selected}/>}</DialogContent><DialogActions><Button onClick={() => setFullscreen(false)}>Cerrar</Button></DialogActions></Dialog>
    <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)}><DialogTitle>Eliminar esta captura</DialogTitle><DialogContent>Se descartarán la fotografía y su rectificación de esta sesión. Esta acción no se puede deshacer.</DialogContent><DialogActions><Button onClick={() => setDeleteOpen(false)}>Cancelar</Button><Button color="error" disabled={busy} onClick={() => action(async () => {if (selected) await api.delete(selected.id); setSelectedId(null); setDeleteOpen(false)})}>Eliminar captura</Button></DialogActions></Dialog>
    <Dialog open={clearOpen} onClose={() => !busy&&setClearOpen(false)}><DialogTitle>Limpiar todos los datos temporales</DialogTitle><DialogContent>Se eliminarán expedientes temporales, imágenes, OCR, identidades aprobadas, solicitudes Word y conexiones móviles. Las plantillas, perfiles, preferencias y la credencial de Vision no se modificarán. Esta acción no se puede deshacer.</DialogContent><DialogActions><Button disabled={busy} onClick={()=>setClearOpen(false)}>Cancelar</Button><Button color="error" variant="contained" disabled={busy} onClick={clearTemporaryData}>{busy?'Eliminando…':'Eliminar datos temporales'}</Button></DialogActions></Dialog>
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
  const [version, setVersion] = useState(UI_VERSION);
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState('');
  useEffect(() => {
    async function initialize() {
      if ('__TAURI_INTERNALS__' in window) {
        const {invoke} = await import('@tauri-apps/api/core');
        const {getVersion} = await import('@tauri-apps/api/app');
        const boot = await invoke<{token:string; base:string}>('bootstrap');
        setVersion(await getVersion());
        const service=new CaptureApi(boot.base,boot.token);await service.waitUntilCompatible(UI_VERSION,API_VERSION);setApi(service);
      } else {
        const hash = new URLSearchParams(location.hash.slice(1));
        const token = hash.get('token') || sessionStorage.getItem('notario.desktop.token');
        if (hash.has('token')) history.replaceState(null,'',location.pathname);
        if (token) {sessionStorage.setItem('notario.desktop.token',token);const service=new CaptureApi('',token);await service.waitUntilCompatible(UI_VERSION,API_VERSION);setApi(service)}
      }
      setReady(true);
    }
    initialize().catch(error => {setStartupError(error instanceof ApiError?explain(error):'No se pudo iniciar el servicio local. Revisa la instalación.');setReady(true)});
  },[]);
  return <AppTheme>{api ? <QueryClientProvider client={client}><App api={api} version={version}/></QueryClientProvider> : <div className="unlock-screen"><div className="unlock-card surface"><Brand/><h1>{ready ? 'Tu estación, preparada.' : 'Iniciando la estación…'}</h1><p>{startupError || 'Abre e-notario desde su lanzador para iniciar una sesión local autenticada.'}</p>{ready && <code className="dialog-code">python -m cnie_capture serve --open</code>}</div></div>}</AppTheme>;
}

const root=document.getElementById('root');
if(root)createRoot(root).render(<Root/>);
