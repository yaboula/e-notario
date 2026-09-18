import {useCallback, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ApiError, CaptureApi, explain, instructions, type ApprovedIdentitySummary, type Capture, type CaptureSide, type CardModel, type CaseDraft, type CaseDraftSummary, type CaseFieldLease, type DocumentExtraction, type DocumentSummary, type ProfessionalProfile, type TemplateFieldDefinition, type TemplateSummary} from '@notario/api-client';
import {AppTheme, Brand, RoleIdentityPicker, RepeatableLegalField, ProfessionalProfileField, Button, Alert, CircularProgress, ProtectedImage, CardIllustration, DocumentModeOptions, useCaseCollaboration, Dialog,
  DialogTitle, DialogContent, DialogActions, LinearProgress, AlertCircle, Eye,
  Smartphone, ShieldCheck, Camera, Upload, CheckCircle2, RotateCcw, Sun, Focus, Layers3, QrCode, ArrowRight, ChevronDown} from '@notario/ui';

type Phase = 'pair' | 'ready' | 'camera' | 'preview' | 'sending' | 'result' | 'review' | 'documents' | 'fullDocuments';
const UI_VERSION='0.8.0-alpha.2';
const API_VERSION=2;

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

export function MobileDocumentPreparation({api,documentId,open,onClose}:{api:CaptureApi;documentId:string;open:boolean;onClose:(imagesReleased?:boolean)=>void}){
  const [templates,setTemplates]=useState<TemplateSummary[]>([]);
  const [identities,setIdentities]=useState<ApprovedIdentitySummary[]>([]);
  const [templateId,setTemplateId]=useState('');
  const [assignments,setAssignments]=useState<Record<string,string[]>>({});
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState('');
  const [releaseConfirm,setReleaseConfirm]=useState(false);
  const [released,setReleased]=useState(false);
  const [submitted,setSubmitted]=useState(false);
  const requestKey=useRef(crypto.randomUUID());
  const load=useCallback(async()=>{setLoading(true);try{const [catalog,workspace]=await Promise.all([api.templates(),api.workspace()]);setTemplates(catalog);setIdentities(workspace.approved_identities);setReleased(Boolean(workspace.approved_identities.find(item=>item.document_id===documentId)?.images_released));setTemplateId(current=>current||catalog[0]?.id||'')}catch(error){setMessage(explain(error))}finally{setLoading(false)}},[api,documentId]);
  useEffect(()=>{if(open)void load()},[open,load]);
  const template=templates.find(item=>item.id===templateId)||templates[0];
  useEffect(()=>{if(template)setAssignments(current=>Object.fromEntries(template.roles.map(role=>[role.key,current[role.key]||[]])))},[template?.id]);
  const setRole=(role:string,values:string[])=>{setSubmitted(false);setAssignments(current=>({...current,[role]:values}))};
  const complete=template?.roles.every(role=>{const count=(assignments[role.key]||[]).length;return count>=role.minimum&&count<=role.maximum});
  async function submit(){if(!template)return;setLoading(true);setMessage('');try{await api.createDocumentRequest(template.id,template.version,assignments,requestKey.current);requestKey.current=crypto.randomUUID();setSubmitted(true);setMessage('Solicitud enviada a Windows. El operador podrá revisarla, guardarla y abrirla en Word.')}catch(error){setMessage(explain(error))}finally{setLoading(false)}}
  async function release(){setLoading(true);setMessage('');try{await api.releaseImages(documentId);setReleased(true);setReleaseConfirm(false);await load();setMessage('Imágenes, OCR y evidencias eliminados. La identidad aprobada permanece cifrada hasta 24 horas.')}catch(error){setMessage(explain(error))}finally{setLoading(false)}}
  if(!open)return null;
  return <div className="mobile-document-screen"><div className="mobile-review-top"><button type="button" onClick={()=>onClose(released)} aria-label="Volver a datos">←</button><div><span>DOCUMENTO WORD</span><strong>Relleno parcial</strong></div></div><div className="mobile-document-preparation">{loading&&!templates.length?<div className="mobile-review-loading"><CircularProgress size={28}/></div>:<><Alert severity="info">El móvil prepara la solicitud; el archivo Word solo se genera y guarda en Windows.</Alert><label>Plantilla<select value={template?.id||''} onChange={event=>{setTemplateId(event.target.value);setAssignments({});setSubmitted(false)}}>{templates.map(item=><option key={item.id} value={item.id}>{item.title_es} · {item.title_ar}</option>)}</select></label>{template?.roles.map(role=><RoleIdentityPicker key={role.key} role={role} identities={identities} disabled={loading} value={assignments[role.key]||[]} onChange={values=>setRole(role.key,values)}/>)}{message&&<Alert severity={message.includes('enviada')||message.includes('eliminados')?'success':'info'}>{message}</Alert>}<Button fullWidth variant="contained" disabled={!complete||loading||submitted} onClick={submit}>{submitted?'Solicitud enviada':'Enviar solicitud a Windows'}</Button><Button fullWidth color="warning" disabled={released||loading} onClick={()=>setReleaseConfirm(true)}>{released?'Imágenes liberadas':'Conservar identidad y liberar imágenes'}</Button><Button fullWidth onClick={()=>onClose(released)}>{released?'Volver a captura':'Volver a los datos'}</Button></>}</div><Dialog open={releaseConfirm} onClose={()=>setReleaseConfirm(false)}><DialogTitle>Eliminar imágenes y OCR</DialogTitle><DialogContent>Esta acción es irreversible. Se conservarán cifrados únicamente los 14 valores aprobados, hasta un máximo de 24 horas.</DialogContent><DialogActions><Button onClick={()=>setReleaseConfirm(false)}>Cancelar</Button><Button color="warning" disabled={loading} onClick={release}>Confirmar y liberar</Button></DialogActions></Dialog></div>;
}

export function MobileFullCasePreparation({api,open,onClose}:{api:CaptureApi;open:boolean;onClose:()=>void}){
  const [templates,setTemplates]=useState<TemplateSummary[]>([]);
  const [identities,setIdentities]=useState<ApprovedIdentitySummary[]>([]);
  const [profiles,setProfiles]=useState<ProfessionalProfile[]>([]);
  const [templateId,setTemplateId]=useState('');
  const [draft,setDraft]=useState<CaseDraft|null>(null);
  const [cases,setCases]=useState<CaseDraftSummary[]>([]);
  const draftRef=useRef(draft);
  draftRef.current=draft;
  const createKey=useRef(crypto.randomUUID());
  const [pinnedTemplate,setPinnedTemplate]=useState<TemplateSummary|null>(null);
  const [loading,setLoading]=useState(false);
  const [feedback,setFeedback]=useState<{message:string;severity:'success'|'info'|'warning'}>({message:'',severity:'info'});
  const {message,severity}=feedback;
  function setMessage(message:string,severity:'success'|'info'|'warning'='info'){setFeedback({message,severity})}
  const statusLabels={editing:'En preparación',final_review:'En revisión en Windows',completed:'Guardado'};
  const remember=(value:CaseDraft)=>setCases(current=>[value,...current.filter(item=>item.id!==value.id)]);
  const currentTemplate=templates.find(item=>item.id===(draft?.template_id||templateId))||templates[0];
  const template=draft?(currentTemplate?.id===draft.template_id&&currentTemplate.version===draft.template_version
    ?currentTemplate:pinnedTemplate?.id===draft.template_id&&pinnedTemplate.version===draft.template_version?pinnedTemplate:undefined):currentTemplate;
  const incompleteRoles=template?.roles.filter(role=>{
    const count=draft?.assignments[role.key]?.length||0;
    return count<role.minimum||count>role.maximum;
  })||[];
  const collaboration=useCaseCollaboration({api,draft,setDraft,fields:template?.fields,onError:error=>setMessage(explain(error))});
  useEffect(()=>{
    if(!draft||template)return;
    let disposed=false;
    void api.template(draft.template_id,draft.template_version)
      .then(value=>{if(!disposed)setPinnedTemplate(value)})
      .catch(error=>{if(!disposed)setMessage(explain(error))});
    return()=>{disposed=true};
  },[api,draft?.template_id,draft?.template_version,Boolean(template)]);
  const load=useCallback(async()=>{setLoading(true);try{const [catalog,workspace,availableProfiles]=await Promise.all([api.templates(),api.workspace(),api.professionalProfiles()]);setTemplates(catalog);setIdentities(workspace.approved_identities);setProfiles(availableProfiles);setTemplateId(current=>current||catalog[0]?.id||'');const owned=workspace.case_drafts.filter(item=>item.mode==='complete');setCases(owned);const current=owned.find(item=>item.id===draftRef.current?.id)||owned.find(item=>item.status!=='completed');setDraft(current?await api.case(current.id):null)}catch(error){setMessage(explain(error))}finally{setLoading(false)}},[api]);
  useEffect(()=>{if(open)void load()},[open,load]);
  useEffect(()=>{if(!open)return;let disposed=false;const refresh=()=>void api.professionalProfiles().then(values=>{if(!disposed)setProfiles(values)}).catch(()=>{});const unsubscribe=api.subscribe(refresh);return()=>{disposed=true;unsubscribe()}},[api,open]);
  async function create(){if(!template)return;setLoading(true);setMessage('');try{const created=await api.createCase(template.id,template.version,'complete',createKey.current);createKey.current=crypto.randomUUID();setDraft(created);remember(created);setMessage('Expediente temporal creado en el PC.','success')}catch(error){setMessage(explain(error))}finally{setLoading(false)}}
  async function selectCase(id:string){if(id===(draft?.id||''))return;setLoading(true);setMessage('');try{if(draft){const saved=await collaboration.flush();if(saved)remember(saved)}const next=id?await api.case(id):null;setDraft(next);setPinnedTemplate(null)}catch(error){setMessage(explain(error))}finally{setLoading(false)}}
  function setRole(role:string,values:string[]){collaboration.editRole(role,values)}
  function setField(key:string,value:string|string[]){collaboration.editField(key,value)}
  function fieldControl(field:TemplateFieldDefinition){const value=draft?.fields[field.key];const binding=collaboration.bind(field.key);const common={...binding,disabled:loading||binding.disabled};if(field.repeatable)return <RepeatableLegalField field={field} value={Array.isArray(value)?value:[]} identities={identities} identityIds={field.role?draft?.assignments[field.role]:undefined} {...common} onChange={values=>setField(field.key,values)}/>;if(field.type==='professional_profile')return <ProfessionalProfileField {...common} profiles={profiles} value={typeof value==='string'?value:''} maximumCharacters={field.maximum_characters} onChange={next=>setField(field.key,next)}/>;return <input {...common} type={field.type==='date'?'date':'text'} inputMode={field.type==='number'?'numeric':undefined} dir={field.direction} value={typeof value==='string'?value:''} maxLength={field.maximum_characters} onChange={event=>setField(field.key,event.target.value)}/>}
  async function save(sendToWindows=false){if(!draft)return;setLoading(true);setMessage('');try{const saved=await collaboration.flush();if(!saved)return;if(sendToWindows){const reviewed=await api.beginCaseFinalReview(saved.id,saved.revision);setDraft(reviewed);remember(reviewed);setMessage('Expediente enviado a revisión final en Windows.','success')}else{setDraft(saved);remember(saved);setMessage('Borrador cifrado guardado en el PC.','success')}}catch(error){setMessage(explain(error))}finally{setLoading(false)}}
  async function closeCase(){setLoading(true);try{if(draft)await collaboration.flush();onClose()}catch(error){setMessage(explain(error))}finally{setLoading(false)}}
  if(!open)return null;
  return <div className="mobile-document-screen">
    <div className="mobile-review-top"><button type="button" disabled={loading} onClick={()=>void closeCase()} aria-label="Volver a datos">←</button><div><span>DOCUMENTO WORD</span><strong>Relleno completo</strong></div></div>
    <div className="mobile-document-preparation">
      {loading&&!templates.length?<div className="mobile-review-loading"><CircularProgress size={28}/></div>:<>
        {cases.length>0&&<label>Abrir un expediente<select disabled={loading} value={draft?.id||''} onChange={event=>void selectCase(event.target.value)}>
          <option value="">Nuevo expediente</option>
          {cases.map(item=><option key={item.id} value={item.id}>{templates.find(value=>value.id===item.template_id)?.title_es||'Expediente'} · {item.id.slice(0,8)} · {statusLabels[item.status]}</option>)}
        </select></label>}
        {!draft?<>
          <Alert severity="info">Los datos se guardan cifrados en el PC. El archivo Word se generará únicamente en Windows.</Alert>
          {cases.some(item=>item.status!=='completed')&&<Alert severity="warning">Tienes expedientes sin finalizar. Puedes recuperarlos desde el selector superior.</Alert>}
          <label>Plantilla<select disabled={loading} value={template?.id||''} onChange={event=>{setTemplateId(event.target.value);createKey.current=crypto.randomUUID()}}>{templates.map(item=><option key={item.id} value={item.id}>{item.title_es} · {item.title_ar}</option>)}</select></label>
          <Button fullWidth variant="contained" disabled={loading||!template} onClick={create}>Crear expediente</Button>
        </>:<>
          <small role="status">{draft.status!=='editing'?statusLabels[draft.status]:collaboration.saving?'Guardando en el PC…':collaboration.unsaved?`${collaboration.unsaved} cambio(s) pendiente(s)`:'Expediente actualizado en el PC'}</small>
          {draft.status==='final_review'&&<Alert severity="info">El expediente está bloqueado para la revisión final. Windows puede revisarlo, reabrirlo o guardar el Word.</Alert>}
          {template?.roles.map(role=><RoleIdentityPicker key={role.key} role={role} identities={identities} locale="es" {...collaboration.bind(`role.${role.key}`)} disabled={loading||collaboration.bind(`role.${role.key}`).disabled} value={draft.assignments[role.key]||[]} onChange={values=>setRole(role.key,values)}/>)}
          {template?.fields?.map(field=>field.repeatable?<div className="document-field" key={field.key}>{fieldControl(field)}</div>:<label key={field.key}><span>{field.label_fr}{field.required?' · recomendado':''}</span><small lang="ar" dir="rtl">{field.label_ar}</small>{fieldControl(field)}</label>)}
          {profiles.length===0&&template?.fields?.some(field=>field.type==='professional_profile')&&<Alert severity="info">No hay perfiles frecuentes. Puedes escribir el nombre directamente para este documento.</Alert>}
          {draft.status==='editing'&&incompleteRoles.length>0&&<Alert severity="info">Antes de enviar a Windows, completa las personas de estos roles: {incompleteRoles.map(role=>role.label_es).join(', ')}. Puedes guardar el borrador mientras tanto.</Alert>}
          <Button fullWidth variant="outlined" disabled={loading||draft.status!=='editing'} onClick={()=>void save(false)}>Guardar borrador</Button>
          <Button fullWidth variant="contained" disabled={loading||draft.status!=='editing'||!template} onClick={()=>void save(true)}>Enviar a revisión en Windows</Button>
        </>}
      </>}
      {message&&<Alert severity={severity}>{message}</Alert>}
      <Button fullWidth disabled={loading} onClick={()=>void closeCase()}>Volver</Button>
    </div>
  </div>;
}

export function MobileStructuredReview({api,document,captures,onClose,onReleasedExit}:{api:CaptureApi;document:DocumentSummary;captures:Capture[];onClose:()=>void;onReleasedExit?:()=>void}){
  const [data,setData]=useState<DocumentExtraction|null>(null);
  const [drafts,setDrafts]=useState<Record<string,string>>({});
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');
  const [viewerSide,setViewerSide]=useState<CaptureSide|null>(null);
  const [openSections,setOpenSections]=useState<Record<string,boolean>>({'Identidad':true});
  const [documentMode,setDocumentMode]=useState<'partial'|'complete'|null>(null);
  const modeCard=useRef<HTMLDivElement|null>(null);
  const serverValues=useRef<Record<string,string>>({});
  const requestVersion=useRef(0);
  const acceptServerData=useCallback((next:DocumentExtraction)=>{setData(next);setDrafts(current=>{const values={...current};const received:Record<string,string>={};Object.entries(next.fields).forEach(([key,field])=>{const value=editableReviewValue(key,next.reviews[key]?.value??field.normalized_value);received[key]=value;const previous=serverValues.current[key];const locallyEdited=key in current&&previous!==undefined&&current[key]!==previous;if(!(key in current)||!locallyEdited)values[key]=value});serverValues.current=received;return values})},[]);
  const load=useCallback(async(silent=false)=>{const request=++requestVersion.current;if(!silent)setLoading(true);try{const next=await api.extraction(document.id);if(request===requestVersion.current)acceptServerData(next)}catch(error){if(request===requestVersion.current)setMessage(explain(error))}finally{if(!silent&&request===requestVersion.current)setLoading(false)}},[acceptServerData,api,document.id]);
  useEffect(()=>{void load()},[load]);
  useEffect(()=>{if(!loading&&data&&(data.revision!==document.extraction_summary.revision||data.status!==document.extraction_summary.status))void load(true)},[data?.revision,data?.status,document.extraction_summary.revision,document.extraction_summary.status,loading,load]);
  const save=async(fields:Record<string,{decision:'confirmed'|'corrected'|'absent';value:unknown}>,success:string)=>{if(!data||data.status==='approved')return;requestVersion.current+=1;setLoading(true);setMessage('');try{const next=await api.reviewExtraction(document.id,data.revision,fields);acceptServerData(next);setMessage(success)}catch(error){if(error instanceof ApiError&&error.code==='EXTRACTION_STALE_REVISION'){await load();setMessage('La revisión cambió en Windows. Se han recargado los datos sin enviar tu borrador.')}else setMessage(explain(error))}finally{setLoading(false)}};
  const reviewPayload=(keys:string[])=>{if(!data)return null;const fields:Record<string,{decision:'confirmed'|'corrected';value:unknown}>={};for(const key of keys){const field=data.fields[key];if(!field)continue;const value=(drafts[key]||'').trim();if(!value)return {missing:key,fields};const predicted=editableReviewValue(key,field.normalized_value);const submitted=key.startsWith('filiation_')||key.startsWith('address_')?value.split('\n').map(line=>line.trim()).filter(Boolean):value;fields[key]={decision:value===predicted?'confirmed':'corrected',value:submitted}}return {missing:null,fields}};
  const confirmGroup=async(keys:string[])=>{const payload=reviewPayload(keys);if(!payload)return;if(payload.missing){setMessage(`Completa ${REVIEW_LABELS[payload.missing]} antes de confirmar esta categoría.`);return}await save(payload.fields,`${keys.length} campos confirmados.`)};
  const acceptAll=async()=>{if(!data||approved)return;const payload=reviewPayload(REVIEW_KEYS);if(!payload)return;if(payload.missing){setMessage(`Completa ${REVIEW_LABELS[payload.missing]} antes de aprobar.`);return}requestVersion.current+=1;setLoading(true);setMessage('');try{const reviewed=await api.reviewExtraction(document.id,data.revision,payload.fields);acceptServerData(reviewed);const next=await api.approveExtraction(document.id,reviewed.revision);acceptServerData(next);setMessage('Datos aprobados. Continúa con el modo de preparación del documento.');window.setTimeout(()=>modeCard.current?.scrollIntoView({block:'center',behavior:'smooth'}),100)}catch(error){if(error instanceof ApiError&&error.code==='EXTRACTION_STALE_REVISION'){await load();setMessage('La revisión cambió en Windows. Comprueba los datos recargados.')}else setMessage(explain(error))}finally{setLoading(false)}};
  const total=data?REVIEW_KEYS.filter(key=>data.fields[key]).length:14;
  const reviewed=data?Object.keys(data.reviews).length:0;
  const pending=Math.max(0,total-reviewed);
  const progress=total?Math.round(reviewed/total*100):0;
  const approved=data?.status==='approved';
  const viewerId=viewerSide==='front'?document.front_capture_id:document.back_capture_id;
  const viewerCapture=captures.find(item=>item.id===viewerId);
  const viewerImage=useCallback((signal:AbortSignal)=>viewerCapture?api.image(viewerCapture.id,'rectified',signal):Promise.reject(new Error('IMAGE_UNAVAILABLE')),[api,viewerCapture?.id]);
  if(documentMode==='partial')return <MobileDocumentPreparation api={api} documentId={document.id} open onClose={released=>{if(released&&onReleasedExit)onReleasedExit();else setDocumentMode(null)}}/>;
  if(documentMode==='complete')return <MobileFullCasePreparation api={api} open onClose={()=>setDocumentMode(null)}/>;
  return <div className="mobile-review-page">
    <div className="mobile-review-top"><button type="button" onClick={onClose} aria-label="Volver">←</button><div><span>REVISIÓN DE DATOS · {data?.engine.template==='CNIE_MA_LEGACY'?'CNIE antigua':'CNIE 2020'}</span><strong>{approved?'Datos aprobados':'Comprueba los 14 campos'}</strong></div><span className={approved?'approved':''}>{approved?'Aprobado':`${pending} pendientes`}</span></div>
    <div className="mobile-review-progress"><LinearProgress variant="determinate" value={progress}/><small>{reviewed} de {total} revisados</small></div>
    <div className="mobile-review-images"><Button size="small" startIcon={<Eye size={14}/>} onClick={()=>setViewerSide('front')}>Ver anverso</Button><Button size="small" startIcon={<Eye size={14}/>} onClick={()=>setViewerSide('back')}>Ver reverso</Button></div>
    {message&&<Alert severity={message.includes('correctamente')||message.includes('confirmados')||message.includes('aprobados')?'success':'info'} onClose={()=>setMessage('')}>{message}</Alert>}
    {loading&&!data?<div className="mobile-review-loading"><CircularProgress size={28}/><span>Cargando revisión…</span></div>:data&&<div className="mobile-review-sections">{REVIEW_GROUPS.map(group=>{const keys=group.keys.filter(key=>data.fields[key]);const count=keys.filter(key=>data.reviews[key]).length;return <details className="mobile-review-section" key={group.title} open={Boolean(openSections[group.title])} onToggle={event=>{const open=event.currentTarget.open;setOpenSections(current=>current[group.title]===open?current:{...current,[group.title]:open})}}><summary><div><strong>{group.title}</strong><small>{count}/{keys.length} revisados</small></div><ChevronDown size={17}/></summary><div className="mobile-review-section-body">{!approved&&<Button size="small" variant="contained" disabled={loading} onClick={()=>confirmGroup(keys)}>Confirmar categoría</Button>}{keys.map(key=>{const field=data.fields[key];const review=data.reviews[key];const rtl=key.endsWith('_ar');const multiline=key.startsWith('filiation')||key.startsWith('address');return <div className={`mobile-review-field ${review?.decision||(!field.warnings.length?'pending':'warning')}`} key={key}><div className="mobile-review-label"><label htmlFor={`mobile-${key}`}>{REVIEW_LABELS[key]}</label><span>{review?.decision==='corrected'?'Corregido':review?'Confirmado':field.warnings.length?'Revisar':'Pendiente'}</span></div>{key==='sex'?<select id={`mobile-${key}`} disabled={approved} value={drafts[key]||''} onChange={event=>setDrafts(current=>({...current,[key]:event.target.value}))}><option value="">Selecciona el sexo impreso</option><option value="F">F · Femenino</option><option value="M">M · Masculino</option></select>:multiline?<textarea id={`mobile-${key}`} dir={rtl?'rtl':'ltr'} readOnly={approved} autoComplete="off" spellCheck={false} value={drafts[key]||''} onChange={event=>setDrafts(current=>({...current,[key]:event.target.value}))}/>:<input id={`mobile-${key}`} dir={rtl?'rtl':'ltr'} readOnly={approved} autoComplete="off" spellCheck={false} value={drafts[key]||''} onChange={event=>setDrafts(current=>({...current,[key]:event.target.value}))}/>}<div className="mobile-review-meta"><small>{field.source_side==='back'?'Reverso':'Anverso'} · {field.confidence==null?'confianza no disponible':`${Math.round(field.confidence*100)} %`}</small></div>{field.warnings.length>0&&!review&&<div className="mobile-review-warning"><AlertCircle size={13}/><span>Comprueba este valor antes de confirmar la categoría.</span></div>}</div>})}</div></details>})}</div>}
    <div className={`mobile-review-approval ${approved?'complete':''}`}><div><ShieldCheck size={15}/><span>{approved?'La identidad está aprobada. Elige el modo de preparación.':'Puedes confirmar por categoría o aprobar todos los campos visibles.'}</span></div>{!approved&&<Button fullWidth variant="contained" disabled={loading} onClick={acceptAll}>{loading?'Validando…':'Aceptar todo y aprobar'}</Button>}</div>
    {approved&&<div className="mobile-mode-card" ref={modeCard}><span className="eyebrow">SIGUIENTE PASO</span><h2>Prepara el documento Word</h2><DocumentModeOptions compact onPartial={()=>setDocumentMode('partial')} onComplete={()=>setDocumentMode('complete')}/></div>}
    <Dialog open={viewerSide!==null} onClose={()=>setViewerSide(null)} fullScreen><DialogTitle>CNIE · {viewerSide==='back'?'Reverso':'Anverso'}</DialogTitle><DialogContent className="mobile-document-viewer">{viewerSide&&viewerCapture&&<ProtectedImage load={viewerImage} alt={`CNIE · ${viewerSide}`}/>}</DialogContent><DialogActions><Button disabled={viewerSide==='front'} onClick={()=>setViewerSide('front')}>Anverso</Button><Button disabled={viewerSide==='back'} onClick={()=>setViewerSide('back')}>Reverso</Button><Button onClick={()=>setViewerSide(null)}>Cerrar</Button></DialogActions></Dialog>
  </div>;
}

export function App() {
  const [api, setApi] = useState<CaptureApi | null>(null);
  const [phase, setPhase] = useState<Phase>('pair');
  const [side, setSide] = useState<CaptureSide>('front');
  const [cardModel,setCardModel]=useState<CardModel>('CNIE_MA_2020');
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [pendingPairCode,setPendingPairCode]=useState('');
  const [operatorName,setOperatorName]=useState('');
  const [deviceName,setDeviceName]=useState('Teléfono móvil');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState('');
  const [result, setResult] = useState<Capture | null>(null);
  const [documentId, setDocumentId] = useState<string | undefined>();
  const [documentInfo,setDocumentInfo]=useState<DocumentSummary|null>(null);
  const [documentCaptures,setDocumentCaptures]=useState<Capture[]>([]);
  const [availableIdentity,setAvailableIdentity]=useState<ApprovedIdentitySummary|null>(null);
  const [availableCases,setAvailableCases]=useState<CaseDraftSummary[]>([]);
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
    async function connectExisting() {
      setConnecting(true);
      try {
        const service = new CaptureApi('', '');
        const token = sessionStorage.getItem('notario.mobile.token');
        if (token) {service.token = token;const health=await service.health();if(health.api_version!==API_VERSION||health.version!==UI_VERSION)throw new Error('VERSION_MISMATCH');const workspace=await service.workspace();setAvailableIdentity(workspace.approved_identities[0]||null);setAvailableCases(workspace.case_drafts.filter(item=>item.mode==='complete'&&item.status!=='completed'));setApi(service);setPhase('ready')}
      } catch (e) {sessionStorage.removeItem('notario.mobile.token');setError(explain(e))}
      finally {setConnecting(false)}
    }
    if(code)setPendingPairCode(code);else void connectExisting();
  }, []);
  async function completePairing(){if(!pendingPairCode||!operatorName.trim()||!deviceName.trim())return;setConnecting(true);setError('');try{const service=new CaptureApi('','');const paired=await service.pair(pendingPairCode,operatorName.trim(),deviceName.trim());sessionStorage.setItem('notario.mobile.token',paired.token);service.token=paired.token;const health=await service.health();if(health.api_version!==API_VERSION||health.version!==UI_VERSION)throw new Error('VERSION_MISMATCH');const workspace=await service.workspace();setAvailableIdentity(workspace.approved_identities[0]||null);setAvailableCases(workspace.case_drafts.filter(item=>item.mode==='complete'&&item.status!=='completed'));setApi(service);setPendingPairCode('');setPhase('ready')}catch(value){setError(value instanceof Error&&value.message==='VERSION_MISMATCH'?'La página móvil pertenece a otra versión. Cierra esta pestaña y vuelve a escanear el QR.':explain(value))}finally{setConnecting(false)}}
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
    const refresh = () => api.workspace().then(ws => {setAvailableIdentity(ws.approved_identities[0]||null);setAvailableCases(ws.case_drafts.filter(item=>item.mode==='complete'&&item.status!=='completed'));const updated = ws.captures.find(c => c.id === result.id);if(updated)setResult(updated);const current=ws.documents.find(item=>item.id===result.document_id);if(current){setDocumentInfo(current);setDocumentCaptures(ws.captures.filter(item=>item.document_id===current.id))}}).catch(e => setError(explain(e)));
    const timer = setInterval(refresh,4000);
    const unsubscribe = api.subscribe(refresh);
    return () => {clearInterval(timer);unsubscribe()};
  }, [api, phase, result?.id]);
  useEffect(()=>{if(!api||!['ready','documents','fullDocuments'].includes(phase))return;const refresh=()=>api.workspace().then(ws=>{setAvailableIdentity(ws.approved_identities[0]||null);setAvailableCases(ws.case_drafts.filter(item=>item.mode==='complete'&&item.status!=='completed'))}).catch(()=>{});void refresh();const timer=setInterval(refresh,4000);const unsubscribe=api.subscribe(refresh);return()=>{clearInterval(timer);unsubscribe()}},[api,phase]);
  useEffect(()=>{if(phase==='result'&&documentInfo?.status==='data_review_required')setPhase('review')},[phase,documentInfo?.status]);
  useEffect(()=>{if(phase==='documents'&&!availableIdentity)setPhase('ready')},[phase,availableIdentity?.id]);

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
    try {const capture = await api.upload(photo,side,uploadKey.current,documentId,documentInfo?.card_model||cardModel);setDocumentId(capture.document_id);setResult(capture);setDocumentCaptures(current=>[...current.filter(item=>item.id!==capture.id),capture]);setPhoto(null);setPhase('result');void api.workspace().then(workspace=>{setDocumentInfo(workspace.documents.find(item=>item.id===capture.document_id)||null);setDocumentCaptures(workspace.captures.filter(item=>item.document_id===capture.document_id))}).catch(()=>{})}
    catch (e) {setError(explain(e));setPhase('preview')}
  }
  const loadResult = useCallback((signal: AbortSignal) => api!.image(result!.id,'rectified',signal), [api,result?.id]);
  const good = result?.result.status === 'success' && result.review !== 'retake';
  const reset = (keepDocument = false, newCard = false) => {stopCamera();setPhoto(null);setResult(null);setError('');setPhase('ready');if (!keepDocument){setDocumentId(undefined);setDocumentInfo(null);setDocumentCaptures([]);if(newCard){setSide('front');setCardModel('CNIE_MA_2020')}}if (input.current) input.current.value = ''};
  const ocrLabel = result?.ocr_summary.status === 'success' ? 'Lectura completada en la estación.'
    : result?.ocr_summary.status === 'processing' ? 'Preparando los datos en la estación.'
    : result?.ocr_summary.status === 'queued' ? 'La lectura está en cola.'
    : result?.ocr_summary.status === 'error' || result?.ocr_summary.status === 'no_text' ? 'No se pudieron preparar los datos; avisa al operador.'
    : 'La estación prepara los datos automáticamente.';

  return <div className="mobile-shell"><header className="mobile-header"><Brand compact/><small>{api ? 'OFICINA CONECTADA' : 'CAPTURA MÓVIL'}</small></header><main className="mobile-content">
    {!['review','documents','fullDocuments'].includes(phase)&&<div className="mobile-steps" aria-label="Progreso"><span className="active"/><span className={['camera','preview','sending','result'].includes(phase) ? 'active' : ''}/><span className={phase === 'result' ? 'active' : ''}/></div>}
    {error && <Alert severity="warning" className="error-banner" onClose={() => setError('')}>{error}</Alert>}
    {documentInfo?.status==='attention'&&documentInfo.extraction_summary.error_code&&<Alert severity="error" className="error-banner">{instructions[documentInfo.extraction_summary.error_code]||'Comprueba ambas caras y el modelo elegido antes de continuar.'}</Alert>}
    {phase === 'pair' ? <div className="mobile-panel"><div className="connection-hero">{connecting ? <CircularProgress size={32}/> : <QrCode size={41}/>} </div><div className="eyebrow">DEL MÓVIL A TU OFICINA</div><h1>{connecting ? 'Conectando con el PC…' : pendingPairCode ? 'Identifica esta sesión.' : 'Todo empieza con un QR.'}</h1>{pendingPairCode&&!connecting?<div className="pair-identity-form"><label>Nombre temporal del operador<input autoComplete="name" maxLength={48} value={operatorName} onChange={event=>setOperatorName(event.target.value)} placeholder="Ej. Sara"/></label><label>Nombre del dispositivo<input maxLength={48} value={deviceName} onChange={event=>setDeviceName(event.target.value)} placeholder="Ej. Teléfono de recepción"/></label><Button fullWidth variant="contained" disabled={!operatorName.trim()||!deviceName.trim()} onClick={()=>void completePairing()}>Autorizar este dispositivo</Button></div>:<><p>En e-notario para Windows, elige «Conectar móvil» y escanea el código.</p><p style={{marginTop:18}}>Conecta ambos dispositivos a la misma red de la oficina.</p></>}</div> : phase==='documents'&&api&&availableIdentity?<MobileDocumentPreparation api={api} documentId={availableIdentity.document_id} open onClose={()=>setPhase('ready')}/>:phase==='fullDocuments'&&api?<MobileFullCasePreparation api={api} open onClose={()=>setPhase('ready')}/>:phase==='review'&&api&&documentInfo?<MobileStructuredReview api={api} document={documentInfo} captures={documentCaptures} onClose={()=>setPhase('result')} onReleasedExit={()=>reset(false,true)}/>:phase === 'result' && result ? <><div className="eyebrow">CAPTURA RECIBIDA</div><h1>{good ? result.review === 'accepted' ? 'Imagen aceptada.' : 'Lista para revisar.' : 'Vamos a mejorarla.'}</h1><p className="mobile-lead">{good ? 'La fotografía está protegida en tu PC. Cuando terminen ambas caras podrás revisar aquí los datos estructurados.' : 'La captura necesita otra fotografía. Sigue la indicación y vuelve a intentarlo.'}</p><section className="mobile-result"><h2>{good ? <CheckCircle2 size={19}/> : <RotateCcw size={19}/>}CNIE · {result.side === 'front' ? 'Anverso' : 'Reverso'}</h2>{good ? <><p>{ocrLabel}</p><ProtectedImage load={loadResult} alt="Tarjeta rectificada"/></> : <p>{result.review === 'retake' ? 'La comprobación local rechazó esta fotografía.' : instructions[result.result.rejection_codes[0]] || 'Coloca la tarjeta completa sobre un fondo contrastante y mejora la iluminación.'}</p>}</section><div className="mobile-actions" style={{marginTop:24}}>{documentInfo&&['data_review_required','ready'].includes(documentInfo.status)&&<Button variant="contained" startIcon={<ShieldCheck size={18}/>} onClick={()=>setPhase('review')}>{documentInfo.status==='ready'?'Ver datos aprobados':'Revisar datos'}</Button>}<Button variant={documentInfo&&['data_review_required','ready'].includes(documentInfo.status)?'outlined':'contained'} startIcon={good ? <Camera size={18}/> : <RotateCcw size={18}/>} onClick={() => {reset(true);if (good) setSide(side === 'front' ? 'back' : 'front')}}>{good ? 'Capturar la otra cara' : 'Repetir captura'}</Button><Button onClick={() => reset(false,true)}>Nueva tarjeta</Button></div></> : <>
       <div className="eyebrow">CAPTURA DEL DOCUMENTO</div><h1>{phase === 'preview' ? 'Un último vistazo.' : phase === 'sending' ? 'Enviando a tu oficina…' : 'Acerca. Encuadra. Captura.'}</h1><p className="mobile-lead">{phase === 'preview' ? 'Comprueba nitidez y reflejos. Una cara válida se aceptará automáticamente y pasará al OCR europeo antes de confirmar los datos.' : 'Una sola tarjeta, las cuatro esquinas visibles y luz suave.'}</p>
      <label className="mobile-card-model" htmlFor="mobile-card-model">Modelo de tarjeta<select id="mobile-card-model" value={documentInfo?.card_model||cardModel} disabled={!!documentId||phase==='sending'} onChange={event=>setCardModel(event.target.value as CardModel)}><option value="CNIE_MA_2020">CNIE 2020 · predeterminado</option><option value="CNIE_MA_LEGACY">CNIE antigua</option></select>{documentId&&<small>Fijado para las dos caras. Pulsa «Nueva tarjeta» para cambiarlo.</small>}</label>
      <div className="side-toggle" style={{width:'fit-content'}}>{(['front','back'] as const).map(value => <button key={value} className={side === value ? 'selected' : ''} disabled={phase === 'sending'} onClick={() => setSide(value)} aria-pressed={side === value}>{value === 'front' ? 'Anverso' : 'Reverso'}</button>)}</div>
      <div className="camera-surface">{phase === 'camera' ? <><video ref={video} autoPlay playsInline muted onClick={() => video.current?.play()}/><div className="camera-guide"/></> : phase === 'preview' || phase === 'sending' ? <><img src={preview} alt="Fotografía antes de enviarla" style={{objectFit:'contain'}}/>{phase === 'sending' && <div className="camera-intro"><CircularProgress size={35}/></div>}</> : <div className="camera-intro"><CardIllustration/><p>Coloca la CNIE sobre una superficie mate.</p></div>}</div>
       <div className="mobile-actions">{phase === 'ready' ? <Button variant="contained" startIcon={<Camera size={18}/>} onClick={openCamera}>Abrir cámara</Button> : phase === 'camera' ? <button className="capture-button" aria-label="Tomar fotografía" onClick={takePhoto}><Camera size={25}/></button> : <><Button variant="contained" startIcon={<ArrowRight size={18}/>} disabled={phase === 'sending'} onClick={send}>{phase === 'sending' ? 'Procesando…' : 'Enviar al PC'}</Button><Button disabled={phase === 'sending'} onClick={() => reset(!!documentId)}>Volver a capturar</Button></>}
       {(phase === 'ready' || phase === 'camera') && <Button startIcon={<Upload size={15}/>} onClick={() => input.current?.click()}>Seleccionar fotografía</Button>}</div>
       {phase==='ready'&&availableIdentity&&<div className="mobile-mode-card mobile-recovery-card"><span className="eyebrow">IDENTIDAD CONSERVADA</span><h2>Continúa con Word</h2><p>Tu identidad aprobada sigue disponible hasta {new Date(availableIdentity.expires_at).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}.</p><DocumentModeOptions compact onPartial={()=>setPhase('documents')} onComplete={()=>setPhase('fullDocuments')}/></div>}
       {phase==='ready'&&availableCases.length>0&&<div className="mobile-mode-card mobile-recovery-card"><span className="eyebrow">EXPEDIENTES CONSERVADOS</span><h2>Recupera tu trabajo</h2><p>Tienes {availableCases.length} expediente(s) sin finalizar en este PC, aunque todavía no hayas asignado una identidad.</p><Button fullWidth variant="outlined" onClick={()=>setPhase('fullDocuments')}>Abrir mis expedientes</Button></div>}
      <div className="mobile-protocol"><span><Focus size={13}/>4 esquinas</span><span><Sun size={13}/>Sin reflejos</span><span><Layers3 size={13}/>Fondo mate</span></div>
    </>}
    <input ref={input} className="hidden-input" type="file" accept="image/jpeg,image/png" capture="environment" aria-label="Seleccionar fotografía de la CNIE" onChange={e => selectPhoto(e.target.files?.[0])}/>
  </main><footer className="mobile-footer"><ShieldCheck size={13}/>Conexión de oficina · Datos temporales cifrados · máximo 24 h</footer></div>;
}
const root=document.getElementById('root');
if(root)createRoot(root).render(<AppTheme><App/></AppTheme>);
