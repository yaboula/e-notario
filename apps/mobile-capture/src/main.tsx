import {useCallback, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ApiError, CaptureApi, type ApprovedIdentitySummary, type CardCorners, type Capture, type CaptureSide, type CardModel, type CaseDraft, type CaseDraftSummary, type CaseFieldLease, type DocumentExtraction, type DocumentSummary, type ProfessionalProfile, type TemplateFieldDefinition, type TemplateSummary} from '@notario/api-client';
import {AppTheme, UiLocaleProvider, useUiLocale, Brand, RoleIdentityPicker, RepeatableLegalField, ProfessionalProfileField, Button, Alert, CircularProgress, ProtectedImage, CardIllustration, DocumentModeOptions, useCaseCollaboration, Dialog,
  DialogTitle, DialogContent, DialogActions, LinearProgress, AlertCircle, Eye,
  Smartphone, ShieldCheck, Camera, Upload, CheckCircle2, RotateCcw, Sun, Focus, Layers3, QrCode, ArrowRight, ChevronDown} from '@notario/ui';

import packageInfo from '../package.json';
import {capturePhoto, prepareCamera} from './camera';
import {CornerEditor, defaultCorners, validCorners} from './CornerEditor';
import {CameraGuide} from './CameraGuide';
import {ControlPairing} from './ControlPairing';

type Phase = 'pair' | 'ready' | 'camera' | 'preview' | 'sending' | 'result' | 'review' | 'documents' | 'fullDocuments';
const UI_VERSION=packageInfo.version;
const API_VERSION=2;

const REVIEW_GROUP_KEYS=[
  {key:'identity',keys:['national_id','given_names_ar','given_names_latin','surname_ar','surname_latin']},
  {key:'birth',keys:['birth_date','birth_place_ar','birth_place_latin']},
  {key:'document',keys:['expiry_date','sex']},
  {key:'family',keys:['filiation_ar','filiation_latin','address_ar','address_latin']},
];
const REVIEW_KEYS=REVIEW_GROUP_KEYS.flatMap(group=>group.keys);
const REVIEW_I18N={
  fr:{groups:{identity:'Identité',birth:'Naissance',document:'Document',family:'Filiation et domicile'},labels:{national_id:'Numéro national (CIN)',given_names_ar:'Prénom · arabe',given_names_latin:'Prénom · latin',surname_ar:'Nom · arabe',surname_latin:'Nom · latin',birth_date:'Date de naissance',birth_place_ar:'Lieu de naissance · arabe',birth_place_latin:'Lieu de naissance · latin',expiry_date:'Date d’expiration',sex:'Sexe',filiation_ar:'Filiation · arabe',filiation_latin:'Filiation · latin',address_ar:'Adresse · arabe',address_latin:'Adresse · latin'}},
  ar:{groups:{identity:'الهوية',birth:'الولادة',document:'الوثيقة',family:'النسب والعنوان'},labels:{national_id:'الرقم الوطني (CIN)',given_names_ar:'الاسم الشخصي · العربية',given_names_latin:'الاسم الشخصي · اللاتينية',surname_ar:'الاسم العائلي · العربية',surname_latin:'الاسم العائلي · اللاتينية',birth_date:'تاريخ الازدياد',birth_place_ar:'مكان الازدياد · العربية',birth_place_latin:'مكان الازدياد · اللاتينية',expiry_date:'تاريخ انتهاء الصلاحية',sex:'الجنس',filiation_ar:'النسب · العربية',filiation_latin:'النسب · اللاتينية',address_ar:'العنوان · العربية',address_latin:'العنوان · اللاتينية'}},
} as const;
function localized(locale:'fr'|'ar',fr:string,ar:string){return locale==='ar'?ar:fr}
function pendingChanges(count:number,locale:'fr'|'ar'){
  if(locale==='fr')return `${count} modification${count===1?'':'s'} en attente`;
  if(count===1)return 'تغيير واحد قيد الانتظار';
  if(count===2)return 'تغييران قيد الانتظار';
  return `${count} تغييرات قيد الانتظار`;
}
function unfinishedCases(count:number,locale:'fr'|'ar'){
  if(locale==='fr')return `Vous avez ${count} dossier${count===1?'':'s'} inachevé${count===1?'':'s'} sur ce PC, même sans identité encore attribuée.`;
  if(count===1)return 'لديك ملف واحد غير مكتمل على هذا الحاسوب، حتى دون تعيين هوية بعد.';
  if(count===2)return 'لديك ملفان غير مكتملين على هذا الحاسوب، حتى دون تعيين هوية بعد.';
  return `لديك ${count} ملفات غير مكتملة على هذا الحاسوب، حتى دون تعيين هوية بعد.`;
}
function templateTitle(item:TemplateSummary,locale:'fr'|'ar'){return locale==='ar'?item.title_ar:item.title_fr}
function explainLocalized(error:unknown,locale:'fr'|'ar'){
  if(error instanceof ApiError)return localized(locale,`L’opération n’a pas pu être terminée (${error.code}).`,`تعذر إكمال العملية (${error.code}).`);
  return localized(locale,'Impossible de se connecter au PC. Vérifiez la connexion et réessayez.','تعذر الاتصال بالحاسوب. تحقق من الاتصال وأعد المحاولة.');
}
function reviewValue(value:unknown){return Array.isArray(value)?value.join('\n'):value==null?'':String(value)}
function editableReviewValue(key:string,value:unknown){const output=reviewValue(value);return key==='sex'&&!['M','F'].includes(output.toUpperCase())?'':output}

export function MobileDocumentPreparation({api,documentId,open,onClose}:{api:CaptureApi;documentId:string;open:boolean;onClose:(imagesReleased?:boolean)=>void}){
  const {locale}=useUiLocale();
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
  const load=useCallback(async()=>{setLoading(true);try{const [catalog,workspace]=await Promise.all([api.templates(),api.workspace()]);setTemplates(catalog);setIdentities(workspace.approved_identities);setReleased(Boolean(workspace.approved_identities.find(item=>item.document_id===documentId)?.images_released));setTemplateId(current=>current||catalog[0]?.id||'')}catch(error){setMessage(explainLocalized(error,locale))}finally{setLoading(false)}},[api,documentId]);
  useEffect(()=>{if(open)void load()},[open,load]);
  const template=templates.find(item=>item.id===templateId)||templates[0];
  useEffect(()=>{if(template)setAssignments(current=>Object.fromEntries(template.roles.map(role=>[role.key,current[role.key]||[]])))},[template?.id]);
  const setRole=(role:string,values:string[])=>{setSubmitted(false);setAssignments(current=>({...current,[role]:values}))};
  const complete=template?.roles.every(role=>{const count=(assignments[role.key]||[]).length;return count>=role.minimum&&count<=role.maximum});
  async function submit(){if(!template)return;setLoading(true);setMessage('');try{await api.createDocumentRequest(template.id,template.version,assignments,requestKey.current);requestKey.current=crypto.randomUUID();setSubmitted(true);setMessage(localized(locale,'Demande envoyée à Windows. L’opérateur pourra la vérifier, l’enregistrer et l’ouvrir dans Word.','أُرسل الطلب إلى Windows. يمكن للمشغّل مراجعته وحفظه وفتحه في Word.'))}catch(error){setMessage(explainLocalized(error,locale))}finally{setLoading(false)}}
  async function release(){setLoading(true);setMessage('');try{await api.releaseImages(documentId);setReleased(true);setReleaseConfirm(false);await load();setMessage(localized(locale,'Images, OCR et preuves supprimés. L’identité approuvée reste chiffrée pendant 24 heures au maximum.','حُذفت الصور وبيانات OCR والأدلة. تبقى الهوية المعتمدة مشفرة لمدة أقصاها 24 ساعة.'))}catch(error){setMessage(explainLocalized(error,locale))}finally{setLoading(false)}}
  if(!open)return null;
  return <div className="mobile-document-screen"><div className="mobile-review-top"><button type="button" onClick={()=>onClose(released)} aria-label={localized(locale,'Retour aux données','العودة إلى البيانات')}>{locale==='ar'?'→':'←'}</button><div><span>{localized(locale,'DOCUMENT WORD','مستند WORD')}</span><strong>{localized(locale,'Remplissage partiel','ملء جزئي')}</strong></div></div><div className="mobile-document-preparation">{loading&&!templates.length?<div className="mobile-review-loading"><CircularProgress size={28}/></div>:<><Alert severity="info">{localized(locale,'Le mobile prépare la demande ; le fichier Word est généré et enregistré uniquement dans Windows.','يُعد الهاتف الطلب؛ ولا يتم إنشاء ملف Word وحفظه إلا في Windows.')}</Alert><label>{localized(locale,'Modèle','القالب')}<select value={template?.id||''} onChange={event=>{setTemplateId(event.target.value);setAssignments({});setSubmitted(false)}}>{templates.map(item=><option key={item.id} value={item.id}>{templateTitle(item,locale)}</option>)}</select></label>{template?.roles.map(role=><RoleIdentityPicker key={role.key} role={role} identities={identities} disabled={loading} value={assignments[role.key]||[]} onChange={values=>setRole(role.key,values)}/>)}{message&&<Alert severity={submitted||released?'success':'info'}>{message}</Alert>}<Button fullWidth variant="contained" disabled={!complete||loading||submitted} onClick={submit}>{submitted?localized(locale,'Demande envoyée','تم إرسال الطلب'):localized(locale,'Envoyer la demande à Windows','إرسال الطلب إلى Windows')}</Button><Button fullWidth color="warning" disabled={released||loading} onClick={()=>setReleaseConfirm(true)}>{released?localized(locale,'Images libérées','تم حذف الصور'):localized(locale,'Conserver l’identité et libérer les images','الاحتفاظ بالهوية وحذف الصور')}</Button><Button fullWidth onClick={()=>onClose(released)}>{released?localized(locale,'Retour à la capture','العودة إلى الالتقاط'):localized(locale,'Retour aux données','العودة إلى البيانات')}</Button></>}</div><Dialog open={releaseConfirm} onClose={()=>setReleaseConfirm(false)}><DialogTitle>{localized(locale,'Supprimer les images et l’OCR','حذف الصور وبيانات OCR')}</DialogTitle><DialogContent>{localized(locale,'Cette action est irréversible. Seules les 14 valeurs approuvées resteront chiffrées, pendant 24 heures au maximum.','هذا الإجراء غير قابل للتراجع. ستبقى القيم الأربع عشرة المعتمدة فقط مشفرة لمدة أقصاها 24 ساعة.')}</DialogContent><DialogActions><Button onClick={()=>setReleaseConfirm(false)}>{localized(locale,'Annuler','إلغاء')}</Button><Button color="warning" disabled={loading} onClick={release}>{localized(locale,'Confirmer et libérer','تأكيد الحذف')}</Button></DialogActions></Dialog></div>;
}

export function MobileFullCasePreparation({api,open,onClose}:{api:CaptureApi;open:boolean;onClose:()=>void}){
  const {locale}=useUiLocale();
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
  const statusLabels=locale==='ar'?{editing:'قيد الإعداد',final_review:'قيد المراجعة في Windows',completed:'محفوظ'}:{editing:'En préparation',final_review:'En révision dans Windows',completed:'Enregistré'};
  const remember=(value:CaseDraft)=>setCases(current=>[value,...current.filter(item=>item.id!==value.id)]);
  const currentTemplate=templates.find(item=>item.id===(draft?.template_id||templateId))||templates[0];
  const template=draft?(currentTemplate?.id===draft.template_id&&currentTemplate.version===draft.template_version
    ?currentTemplate:pinnedTemplate?.id===draft.template_id&&pinnedTemplate.version===draft.template_version?pinnedTemplate:undefined):currentTemplate;
  const incompleteRoles=template?.roles.filter(role=>{
    const count=draft?.assignments[role.key]?.length||0;
    return count<role.minimum||count>role.maximum;
  })||[];
  const collaboration=useCaseCollaboration({api,draft,setDraft,fields:template?.fields,onError:error=>setMessage(explainLocalized(error,locale))});
  useEffect(()=>{
    if(!draft||template)return;
    let disposed=false;
    void api.template(draft.template_id,draft.template_version)
      .then(value=>{if(!disposed)setPinnedTemplate(value)})
      .catch(error=>{if(!disposed)setMessage(explainLocalized(error,locale))});
    return()=>{disposed=true};
  },[api,draft?.template_id,draft?.template_version,Boolean(template)]);
  const load=useCallback(async()=>{setLoading(true);try{const [catalog,workspace,availableProfiles]=await Promise.all([api.templates(),api.workspace(),api.professionalProfiles()]);setTemplates(catalog);setIdentities(workspace.approved_identities);setProfiles(availableProfiles);setTemplateId(current=>current||catalog[0]?.id||'');const owned=workspace.case_drafts.filter(item=>item.mode==='complete');setCases(owned);const current=owned.find(item=>item.id===draftRef.current?.id)||owned.find(item=>item.status!=='completed');setDraft(current?await api.case(current.id):null)}catch(error){setMessage(explainLocalized(error,locale))}finally{setLoading(false)}},[api]);
  useEffect(()=>{if(open)void load()},[open,load]);
  useEffect(()=>{if(!open)return;let disposed=false;const refresh=()=>void api.professionalProfiles().then(values=>{if(!disposed)setProfiles(values)}).catch(()=>{});const unsubscribe=api.subscribe(refresh);return()=>{disposed=true;unsubscribe()}},[api,open]);
  async function create(){if(!template)return;setLoading(true);setMessage('');try{const created=await api.createCase(template.id,template.version,'complete',createKey.current);createKey.current=crypto.randomUUID();setDraft(created);remember(created);setMessage(localized(locale,'Dossier temporaire créé sur le PC.','تم إنشاء الملف المؤقت على الحاسوب.'),'success')}catch(error){setMessage(explainLocalized(error,locale))}finally{setLoading(false)}}
  async function selectCase(id:string){if(id===(draft?.id||''))return;setLoading(true);setMessage('');try{if(draft){const saved=await collaboration.flush();if(saved)remember(saved)}const next=id?await api.case(id):null;setDraft(next);setPinnedTemplate(null)}catch(error){setMessage(explainLocalized(error,locale))}finally{setLoading(false)}}
  function setRole(role:string,values:string[]){collaboration.editRole(role,values)}
  function setField(key:string,value:string|string[]){collaboration.editField(key,value)}
  function fieldControl(field:TemplateFieldDefinition){const value=draft?.fields[field.key];const binding=collaboration.bind(field.key);const common={...binding,disabled:loading||binding.disabled};if(field.repeatable)return <RepeatableLegalField field={field} value={Array.isArray(value)?value:[]} identities={identities} identityIds={field.role?draft?.assignments[field.role]:undefined} {...common} onChange={values=>setField(field.key,values)}/>;if(field.type==='professional_profile')return <ProfessionalProfileField {...common} profiles={profiles} value={typeof value==='string'?value:''} maximumCharacters={field.maximum_characters} onChange={next=>setField(field.key,next)}/>;return <input {...common} type={field.type==='date'?'date':'text'} inputMode={field.type==='number'?'numeric':undefined} dir={field.direction} value={typeof value==='string'?value:''} maxLength={field.maximum_characters} onChange={event=>setField(field.key,event.target.value)}/>}
  async function save(sendToWindows=false){if(!draft)return;setLoading(true);setMessage('');try{const saved=await collaboration.flush();if(!saved)return;if(sendToWindows){const reviewed=await api.beginCaseFinalReview(saved.id,saved.revision);setDraft(reviewed);remember(reviewed);setMessage(localized(locale,'Dossier envoyé à la révision finale dans Windows.','أُرسل الملف إلى المراجعة النهائية في Windows.'),'success')}else{setDraft(saved);remember(saved);setMessage(localized(locale,'Brouillon chiffré enregistré sur le PC.','حُفظت المسودة مشفرة على الحاسوب.'),'success')}}catch(error){setMessage(explainLocalized(error,locale))}finally{setLoading(false)}}
  async function closeCase(){setLoading(true);try{if(draft)await collaboration.flush();onClose()}catch(error){setMessage(explainLocalized(error,locale))}finally{setLoading(false)}}
  if(!open)return null;
  return <div className="mobile-document-screen">
    <div className="mobile-review-top"><button type="button" disabled={loading} onClick={()=>void closeCase()} aria-label={localized(locale,'Retour aux données','العودة إلى البيانات')}>{locale==='ar'?'→':'←'}</button><div><span>{localized(locale,'DOCUMENT WORD','مستند WORD')}</span><strong>{localized(locale,'Remplissage complet','ملء كامل')}</strong></div></div>
    <div className="mobile-document-preparation">
      {loading&&!templates.length?<div className="mobile-review-loading"><CircularProgress size={28}/></div>:<>
        {cases.length>0&&<label>{localized(locale,'Ouvrir un dossier','فتح ملف')}<select disabled={loading} value={draft?.id||''} onChange={event=>void selectCase(event.target.value)}>
          <option value="">{localized(locale,'Nouveau dossier','ملف جديد')}</option>
          {cases.map(item=>{const found=templates.find(value=>value.id===item.template_id);return <option key={item.id} value={item.id}>{found?templateTitle(found,locale):localized(locale,'Dossier','ملف')} · {item.id.slice(0,8)} · {statusLabels[item.status]}</option>})}
        </select></label>}
        {!draft?<>
          <Alert severity="info">{localized(locale,'Les données sont enregistrées chiffrées sur le PC. Le fichier Word sera généré uniquement dans Windows.','تُحفظ البيانات مشفرة على الحاسوب. لن يتم إنشاء ملف Word إلا في Windows.')}</Alert>
          {cases.some(item=>item.status!=='completed')&&<Alert severity="warning">{localized(locale,'Vous avez des dossiers inachevés. Vous pouvez les reprendre depuis le sélecteur ci-dessus.','لديك ملفات غير مكتملة. يمكنك استئنافها من القائمة أعلاه.')}</Alert>}
          <label>{localized(locale,'Modèle','القالب')}<select disabled={loading} value={template?.id||''} onChange={event=>{setTemplateId(event.target.value);createKey.current=crypto.randomUUID()}}>{templates.map(item=><option key={item.id} value={item.id}>{templateTitle(item,locale)}</option>)}</select></label>
          <Button fullWidth variant="contained" disabled={loading||!template} onClick={create}>{localized(locale,'Créer le dossier','إنشاء الملف')}</Button>
        </>:<>
          <small role="status">{draft.status!=='editing'?statusLabels[draft.status]:collaboration.saving?localized(locale,'Enregistrement sur le PC…','جارٍ الحفظ على الحاسوب…'):collaboration.unsaved?pendingChanges(collaboration.unsaved,locale):localized(locale,'Dossier à jour sur le PC','الملف محدث على الحاسوب')}</small>
          {draft.status==='final_review'&&<Alert severity="info">{localized(locale,'Le dossier est verrouillé pour la révision finale. Windows peut le vérifier, le rouvrir ou enregistrer le Word.','الملف مقفل للمراجعة النهائية. يمكن لـ Windows مراجعته أو إعادة فتحه أو حفظ ملف Word.')}</Alert>}
          {template?.roles.map(role=><RoleIdentityPicker key={role.key} role={role} identities={identities} {...collaboration.bind(`role.${role.key}`)} disabled={loading||collaboration.bind(`role.${role.key}`).disabled} value={draft.assignments[role.key]||[]} onChange={values=>setRole(role.key,values)}/>)}
          {template?.fields?.map(field=>field.repeatable?<div className="document-field" key={field.key}>{fieldControl(field)}</div>:<label key={field.key}><span>{locale==='ar'?field.label_ar:field.label_fr}{field.required?localized(locale,' · recommandé',' · موصى به'):''}</span>{fieldControl(field)}</label>)}
          {profiles.length===0&&template?.fields?.some(field=>field.type==='professional_profile')&&<Alert severity="info">{localized(locale,'Aucun profil fréquent. Vous pouvez saisir le nom directement pour ce document.','لا توجد ملفات مهنية متكررة. يمكنك كتابة الاسم مباشرة لهذه الوثيقة.')}</Alert>}
          {draft.status==='editing'&&incompleteRoles.length>0&&<Alert severity="info">{localized(locale,'Avant l’envoi à Windows, complétez les personnes de ces rôles : ','قبل الإرسال إلى Windows، أكمل الأشخاص في هذه الصفات: ')}{incompleteRoles.map(role=>locale==='ar'?role.label_ar:role.label_fr).join(', ')}. {localized(locale,'Vous pouvez enregistrer le brouillon entre-temps.','يمكنك حفظ المسودة في هذه الأثناء.')}</Alert>}
          <Button fullWidth variant="outlined" disabled={loading||draft.status!=='editing'} onClick={()=>void save(false)}>{localized(locale,'Enregistrer le brouillon','حفظ المسودة')}</Button>
          <Button fullWidth variant="contained" disabled={loading||draft.status!=='editing'||!template} onClick={()=>void save(true)}>{localized(locale,'Envoyer à la révision dans Windows','إرسال للمراجعة في Windows')}</Button>
        </>}
      </>}
      {message&&<Alert severity={severity}>{message}</Alert>}
      <Button fullWidth disabled={loading} onClick={()=>void closeCase()}>{localized(locale,'Retour','رجوع')}</Button>
    </div>
  </div>;
}

export function MobileStructuredReview({api,document,captures,onClose,onReleasedExit}:{api:CaptureApi;document:DocumentSummary;captures:Capture[];onClose:()=>void;onReleasedExit?:()=>void}){
  const {locale}=useUiLocale();
  const reviewI18n=REVIEW_I18N[locale];
  const [data,setData]=useState<DocumentExtraction|null>(null);
  const [drafts,setDrafts]=useState<Record<string,string>>({});
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');
  const [viewerSide,setViewerSide]=useState<CaptureSide|null>(null);
  const [openSections,setOpenSections]=useState<Record<string,boolean>>({identity:true});
  const [documentMode,setDocumentMode]=useState<'partial'|'complete'|null>(null);
  const modeCard=useRef<HTMLDivElement|null>(null);
  const serverValues=useRef<Record<string,string>>({});
  const requestVersion=useRef(0);
  const acceptServerData=useCallback((next:DocumentExtraction)=>{setData(next);setDrafts(current=>{const values={...current};const received:Record<string,string>={};Object.entries(next.fields).forEach(([key,field])=>{const value=editableReviewValue(key,next.reviews[key]?.value??field.normalized_value);received[key]=value;const previous=serverValues.current[key];const locallyEdited=key in current&&previous!==undefined&&current[key]!==previous;if(!(key in current)||!locallyEdited)values[key]=value});serverValues.current=received;return values})},[]);
  const load=useCallback(async(silent=false)=>{const request=++requestVersion.current;if(!silent)setLoading(true);try{const next=await api.extraction(document.id);if(request===requestVersion.current)acceptServerData(next)}catch(error){if(request===requestVersion.current)setMessage(explainLocalized(error,locale))}finally{if(!silent&&request===requestVersion.current)setLoading(false)}},[acceptServerData,api,document.id]);
  useEffect(()=>{void load()},[load]);
  useEffect(()=>{if(!loading&&data&&(data.revision!==document.extraction_summary.revision||data.status!==document.extraction_summary.status))void load(true)},[data?.revision,data?.status,document.extraction_summary.revision,document.extraction_summary.status,loading,load]);
  const save=async(fields:Record<string,{decision:'confirmed'|'corrected'|'absent';value:unknown}>,success:string)=>{if(!data||data.status==='approved')return;requestVersion.current+=1;setLoading(true);setMessage('');try{const next=await api.reviewExtraction(document.id,data.revision,fields);acceptServerData(next);setMessage(success)}catch(error){if(error instanceof ApiError&&error.code==='EXTRACTION_STALE_REVISION'){await load();setMessage(localized(locale,'La révision a changé dans Windows. Les données ont été rechargées sans envoyer votre brouillon.','تغيّرت المراجعة في Windows. أُعيد تحميل البيانات دون إرسال مسودتك.'))}else setMessage(explainLocalized(error,locale))}finally{setLoading(false)}};
  const reviewPayload=(keys:string[])=>{if(!data)return null;const fields:Record<string,{decision:'confirmed'|'corrected';value:unknown}>={};for(const key of keys){const field=data.fields[key];if(!field)continue;const value=(drafts[key]||'').trim();if(!value)return {missing:key,fields};const predicted=editableReviewValue(key,field.normalized_value);const submitted=key.startsWith('filiation_')||key.startsWith('address_')?value.split('\n').map(line=>line.trim()).filter(Boolean):value;fields[key]={decision:value===predicted?'confirmed':'corrected',value:submitted}}return {missing:null,fields}};
  const confirmGroup=async(keys:string[])=>{const payload=reviewPayload(keys);if(!payload)return;if(payload.missing){setMessage(localized(locale,`Complétez ${reviewI18n.labels[payload.missing as keyof typeof reviewI18n.labels]} avant de confirmer cette catégorie.`,`أكمل ${reviewI18n.labels[payload.missing as keyof typeof reviewI18n.labels]} قبل تأكيد هذه الفئة.`));return}await save(payload.fields,localized(locale,`${keys.length} champs confirmés.`, `تم تأكيد ${keys.length} حقول.`))};
  const acceptAll=async()=>{if(!data||approved)return;const payload=reviewPayload(REVIEW_KEYS);if(!payload)return;if(payload.missing){setMessage(localized(locale,`Complétez ${reviewI18n.labels[payload.missing as keyof typeof reviewI18n.labels]} avant d’approuver.`,`أكمل ${reviewI18n.labels[payload.missing as keyof typeof reviewI18n.labels]} قبل الاعتماد.`));return}requestVersion.current+=1;setLoading(true);setMessage('');try{const reviewed=await api.reviewExtraction(document.id,data.revision,payload.fields);acceptServerData(reviewed);const next=await api.approveExtraction(document.id,reviewed.revision);acceptServerData(next);setMessage(localized(locale,'Données approuvées. Choisissez maintenant le mode de préparation du document.','تم اعتماد البيانات. اختر الآن طريقة إعداد الوثيقة.'));window.setTimeout(()=>modeCard.current?.scrollIntoView({block:'center',behavior:'smooth'}),100)}catch(error){if(error instanceof ApiError&&error.code==='EXTRACTION_STALE_REVISION'){await load();setMessage(localized(locale,'La révision a changé dans Windows. Vérifiez les données rechargées.','تغيّرت المراجعة في Windows. تحقق من البيانات المعاد تحميلها.'))}else setMessage(explainLocalized(error,locale))}finally{setLoading(false)}};
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
    <div className="mobile-review-top"><button type="button" onClick={onClose} aria-label={localized(locale,'Retour','رجوع')}>{locale==='ar'?'→':'←'}</button><div><span>{localized(locale,'RÉVISION DES DONNÉES','مراجعة البيانات')} · {data?.engine.template==='CNIE_MA_LEGACY'?localized(locale,'ancienne CNIE','البطاقة القديمة'):'CNIE 2020'}</span><strong>{approved?localized(locale,'Données approuvées','البيانات معتمدة'):localized(locale,'Vérifiez les 14 champs','تحقق من الحقول الأربعة عشر')}</strong></div><span className={approved?'approved':''}>{approved?localized(locale,'Approuvé','معتمد'):localized(locale,`${pending} en attente`,`${pending} قيد الانتظار`)}</span></div>
    <div className="mobile-review-progress"><LinearProgress variant="determinate" value={progress}/><small>{localized(locale,`${reviewed} sur ${total} vérifiés`,`${reviewed} من ${total} تمت مراجعتها`)}</small></div>
    <div className="mobile-review-images"><Button size="small" startIcon={<Eye size={14}/>} onClick={()=>setViewerSide('front')}>{localized(locale,'Voir le recto','عرض الوجه')}</Button><Button size="small" startIcon={<Eye size={14}/>} onClick={()=>setViewerSide('back')}>{localized(locale,'Voir le verso','عرض الظهر')}</Button></div>
    {message&&<Alert severity={message.includes('correctamente')||message.includes('confirmados')||message.includes('aprobados')?'success':'info'} onClose={()=>setMessage('')}>{message}</Alert>}
    {loading&&!data?<div className="mobile-review-loading"><CircularProgress size={28}/><span>{localized(locale,'Chargement de la révision…','جارٍ تحميل المراجعة…')}</span></div>:data&&<div className="mobile-review-sections">{REVIEW_GROUP_KEYS.map(group=>{const keys=group.keys.filter(key=>data.fields[key]);const count=keys.filter(key=>data.reviews[key]).length;const title=reviewI18n.groups[group.key as keyof typeof reviewI18n.groups];return <details className="mobile-review-section" key={group.key} open={Boolean(openSections[group.key])} onToggle={event=>{const open=event.currentTarget.open;setOpenSections(current=>current[group.key]===open?current:{...current,[group.key]:open})}}><summary><div><strong>{title}</strong><small>{localized(locale,`${count}/${keys.length} vérifiés`,`${count}/${keys.length} تمت مراجعتها`)}</small></div><ChevronDown size={17}/></summary><div className="mobile-review-section-body">{!approved&&<Button size="small" variant="contained" disabled={loading} onClick={()=>confirmGroup(keys)}>{localized(locale,'Confirmer la catégorie','تأكيد الفئة')}</Button>}{keys.map(key=>{const field=data.fields[key];const review=data.reviews[key];const rtl=key.endsWith('_ar');const multiline=key.startsWith('filiation')||key.startsWith('address');return <div className={`mobile-review-field ${review?.decision||(!field.warnings.length?'pending':'warning')}`} key={key}><div className="mobile-review-label"><label htmlFor={`mobile-${key}`}>{reviewI18n.labels[key as keyof typeof reviewI18n.labels]}</label><span>{review?.decision==='corrected'?localized(locale,'Corrigé','مصحح'):review?localized(locale,'Confirmé','مؤكد'):field.warnings.length?localized(locale,'À vérifier','يتطلب المراجعة'):localized(locale,'En attente','قيد الانتظار')}</span></div>{key==='sex'?<select id={`mobile-${key}`} disabled={approved} value={drafts[key]||''} onChange={event=>setDrafts(current=>({...current,[key]:event.target.value}))}><option value="">{localized(locale,'Sélectionnez le sexe imprimé','اختر الجنس المطبوع')}</option><option value="F">F · {localized(locale,'Féminin','أنثى')}</option><option value="M">M · {localized(locale,'Masculin','ذكر')}</option></select>:multiline?<textarea id={`mobile-${key}`} dir={rtl?'rtl':'ltr'} readOnly={approved} autoComplete="off" spellCheck={false} value={drafts[key]||''} onChange={event=>setDrafts(current=>({...current,[key]:event.target.value}))}/>:<input id={`mobile-${key}`} dir={rtl?'rtl':'ltr'} readOnly={approved} autoComplete="off" spellCheck={false} value={drafts[key]||''} onChange={event=>setDrafts(current=>({...current,[key]:event.target.value}))}/>}<div className="mobile-review-meta"><small>{field.source_side==='back'?localized(locale,'Verso','الظهر'):localized(locale,'Recto','الوجه')} · {field.confidence==null?localized(locale,'confiance indisponible','درجة الثقة غير متاحة'):`${Math.round(field.confidence*100)} %`}</small></div>{field.warnings.length>0&&!review&&<div className="mobile-review-warning"><AlertCircle size={13}/><span>{localized(locale,'Vérifiez cette valeur avant de confirmer la catégorie.','تحقق من هذه القيمة قبل تأكيد الفئة.')}</span></div>}</div>})}</div></details>})}</div>}
    <div className={`mobile-review-approval ${approved?'complete':''}`}><div><ShieldCheck size={15}/><span>{approved?localized(locale,'L’identité est approuvée. Choisissez le mode de préparation.','تم اعتماد الهوية. اختر طريقة الإعداد.'):localized(locale,'Vous pouvez confirmer par catégorie ou approuver tous les champs visibles.','يمكنك التأكيد حسب الفئة أو اعتماد جميع الحقول الظاهرة.')}</span></div>{!approved&&<Button fullWidth variant="contained" disabled={loading} onClick={acceptAll}>{loading?localized(locale,'Validation…','جارٍ الاعتماد…'):localized(locale,'Tout accepter et approuver','قبول الكل واعتماده')}</Button>}</div>
    {approved&&<div className="mobile-mode-card" ref={modeCard}><span className="eyebrow">{localized(locale,'ÉTAPE SUIVANTE','الخطوة التالية')}</span><h2>{localized(locale,'Préparez le document Word','إعداد مستند Word')}</h2><DocumentModeOptions compact onPartial={()=>setDocumentMode('partial')} onComplete={()=>setDocumentMode('complete')}/></div>}
    <Dialog open={viewerSide!==null} onClose={()=>setViewerSide(null)} fullScreen><DialogTitle>CNIE · {viewerSide==='back'?localized(locale,'Verso','الظهر'):localized(locale,'Recto','الوجه')}</DialogTitle><DialogContent className="mobile-document-viewer">{viewerSide&&viewerCapture&&<ProtectedImage load={viewerImage} alt={`CNIE · ${viewerSide==='back'?localized(locale,'Verso','الظهر'):localized(locale,'Recto','الوجه')}`}/>}</DialogContent><DialogActions><Button disabled={viewerSide==='front'} onClick={()=>setViewerSide('front')}>{localized(locale,'Recto','الوجه')}</Button><Button disabled={viewerSide==='back'} onClick={()=>setViewerSide('back')}>{localized(locale,'Verso','الظهر')}</Button><Button onClick={()=>setViewerSide(null)}>{localized(locale,'Fermer','إغلاق')}</Button></DialogActions></Dialog>
  </div>;
}

export function App() {
  const {locale,setLocale}=useUiLocale();
  const [api, setApi] = useState<CaptureApi | null>(null);
  const [sessionExpiresAt,setSessionExpiresAt]=useState<number|null>(null);
  const [phase, setPhase] = useState<Phase>('pair');
  const [side, setSide] = useState<CaptureSide>('front');
  const [cardModel,setCardModel]=useState<CardModel>('CNIE_MA_2020');
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [pendingPairCode,setPendingPairCode]=useState('');
  const [pendingControl,setPendingControl]=useState(false);
  const [operatorName,setOperatorName]=useState('');
  const [deviceName,setDeviceName]=useState(locale==='ar'?'هاتف محمول':'Téléphone mobile');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState('');
  const [corners,setCorners]=useState<CardCorners|null>(null);
  const [capturing,setCapturing]=useState(false);
  const captureBusy=useRef(false);
  const cornerDraft=useRef<CardCorners|null>(null);
  const photoRevision=useRef(0);
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
  const sessionRevision=useRef(0);

  function stopCamera() {stream.current?.getTracks().forEach(track => track.stop());stream.current = null}
  function closeMobileSession() {
    sessionRevision.current++;
    stopCamera();photoRevision.current++;
    sessionStorage.removeItem('notario.mobile.token');
    sessionStorage.removeItem('notario.mobile.expires_at');
    setApi(null);setSessionExpiresAt(null);setPhase('pair');
    setPhoto(null);setCorners(null);cornerDraft.current=null;setCapturing(false);
    setResult(null);setDocumentId(undefined);setDocumentInfo(null);setDocumentCaptures([]);
    setAvailableIdentity(null);setAvailableCases([]);setPendingPairCode('');setPendingControl(false);
    setError(localized(locale,'Votre session mobile a expiré. Scannez un nouveau QR depuis Windows.','انتهت جلسة الهاتف. امسح رمز QR جديداً من Windows.'));
    if(input.current)input.current.value='';
  }
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
        if (token) {const storedExpiry=Number(sessionStorage.getItem('notario.mobile.expires_at'));if(storedExpiry>0&&storedExpiry<=Date.now()/1000){closeMobileSession();return}service.token = token;const health=await service.health();if(health.api_version!==API_VERSION||health.version!==UI_VERSION)throw new Error('VERSION_MISMATCH');const workspace=await service.workspace();setAvailableIdentity(workspace.approved_identities[0]||null);setAvailableCases(workspace.case_drafts.filter(item=>item.mode==='complete'&&item.status!=='completed'));setSessionExpiresAt(storedExpiry>0?storedExpiry:null);setApi(service);setPhase('ready')}
      } catch (e) {sessionStorage.removeItem('notario.mobile.token');setError(explainLocalized(e,locale))}
      finally {setConnecting(false)}
    }
    if(code){setPendingPairCode(code);setPendingControl(params.get('control')==='1')}else void connectExisting();
  }, []);
  async function completePairing(account?:{email:string;password:string;deviceName:string}){if(!pendingPairCode||(!account&&(!operatorName.trim()||!deviceName.trim())))return;setConnecting(true);setError('');try{const service=new CaptureApi('','');const paired=await service.pair(pendingPairCode,account?localized(locale,'Compte du cabinet','حساب المكتب'):operatorName.trim(),account?.deviceName||deviceName.trim(),account?{email:account.email,password:account.password}:undefined);service.token=paired.token;const health=await service.health();if(health.api_version!==API_VERSION||health.version!==UI_VERSION)throw new Error('VERSION_MISMATCH');const workspace=await service.workspace();sessionStorage.setItem('notario.mobile.token',paired.token);sessionStorage.setItem('notario.mobile.expires_at',String(paired.expires_at));setAvailableIdentity(workspace.approved_identities[0]||null);setAvailableCases(workspace.case_drafts.filter(item=>item.mode==='complete'&&item.status!=='completed'));setSessionExpiresAt(paired.expires_at);setApi(service);setPendingPairCode('');setPhase('ready')}catch(value){setError(value instanceof Error&&value.message==='VERSION_MISMATCH'?localized(locale,'Cette page mobile appartient à une autre version. Fermez cet onglet puis scannez à nouveau le QR.','صفحة الهاتف تخص إصداراً آخر. أغلق هذه الصفحة ثم امسح رمز QR من جديد.'):explainLocalized(value,locale))}finally{setConnecting(false)}}
  useEffect(()=>{if(!api||!sessionExpiresAt)return;const delay=sessionExpiresAt*1000-Date.now();if(delay<=0){closeMobileSession();return}const timer=window.setTimeout(closeMobileSession,delay);return()=>window.clearTimeout(timer)},[api,sessionExpiresAt,locale]);
  useEffect(() => {
    if (phase === 'camera' && video.current && stream.current) {
      video.current.srcObject = stream.current;
      video.current.play().catch(() => setError(localized(locale,'Touchez l’aperçu pour activer la caméra.','المس المعاينة لتشغيل الكاميرا.')));
    }
  }, [phase]);
  useEffect(() => {
    const onHide = () => {if (document.hidden && stream.current) {stopCamera();setPhase('ready')}};
    document.addEventListener('visibilitychange',onHide);return () => document.removeEventListener('visibilitychange',onHide);
  }, []);
  useEffect(() => {
    if (!api || !['result','review'].includes(phase) || !result) return;
    const revision=sessionRevision.current;
    const refresh = () => api.workspace().then(ws => {if(revision!==sessionRevision.current)return;setAvailableIdentity(ws.approved_identities[0]||null);setAvailableCases(ws.case_drafts.filter(item=>item.mode==='complete'&&item.status!=='completed'));const updated = ws.captures.find(c => c.id === result.id);if(updated)setResult(updated);const current=ws.documents.find(item=>item.id===result.document_id);if(current){setDocumentInfo(current);setDocumentCaptures(ws.captures.filter(item=>item.document_id===current.id))}}).catch(e => {if(revision!==sessionRevision.current)return;if(e instanceof ApiError&&e.status===401)closeMobileSession();else setError(explainLocalized(e,locale))});
    const timer = setInterval(refresh,4000);
    const unsubscribe = api.subscribe(refresh);
    return () => {clearInterval(timer);unsubscribe()};
  }, [api, phase, result?.id,locale]);
  useEffect(()=>{if(!api||!['ready','documents','fullDocuments'].includes(phase))return;const revision=sessionRevision.current;const refresh=()=>api.workspace().then(ws=>{if(revision!==sessionRevision.current)return;setAvailableIdentity(ws.approved_identities[0]||null);setAvailableCases(ws.case_drafts.filter(item=>item.mode==='complete'&&item.status!=='completed'))}).catch(e=>{if(revision===sessionRevision.current&&e instanceof ApiError&&e.status===401)closeMobileSession()});void refresh();const timer=setInterval(refresh,4000);const unsubscribe=api.subscribe(refresh);return()=>{clearInterval(timer);unsubscribe()}},[api,phase,locale]);
  useEffect(()=>{if(phase==='result'&&documentInfo?.status==='data_review_required')setPhase('review')},[phase,documentInfo?.status]);
  useEffect(()=>{if(phase==='documents'&&!availableIdentity)setPhase('ready')},[phase,availableIdentity?.id]);

  async function openCamera() {
    setError('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(localized(locale,'Ouvrez l’adresse HTTPS du cabinet et acceptez son certificat pour activer la caméra.','افتح عنوان HTTPS للمكتب ووثّق شهادته لتشغيل الكاميرا.'));return;
    }
    try {
      stopCamera();
      const media = await navigator.mediaDevices.getUserMedia({audio:false, video:{
        facingMode:{ideal:'environment'},width:{ideal:4096},height:{ideal:3072}
      }});
      if (!mounted.current) {media.getTracks().forEach(track => track.stop());return}
      stream.current = media;
      await prepareCamera(media.getVideoTracks()[0]);
      if(!mounted.current||stream.current!==media){media.getTracks().forEach(track=>track.stop());return}
      setPhase('camera');
    } catch {setError(localized(locale,'Impossible d’ouvrir la caméra. Autorisez son accès dans le navigateur ou sélectionnez une photo.','تعذر فتح الكاميرا. اسمح بالوصول إليها في المتصفح أو اختر صورة.'))}
  }
  function selectPhoto(file?: Blob) {
    if (!file) return;
    if (!['image/jpeg','image/png'].includes(file.type)) {setError(localized(locale,'Utilisez une photo JPEG ou PNG. Le format HEIC n’est pas accepté.','استخدم صورة JPEG أو PNG. صيغة HEIC غير مدعومة.'));return}
    if (file.size > 20 * 1024 * 1024) {setError(localized(locale,'La photo ne doit pas dépasser 20 Mo.','يجب ألا يتجاوز حجم الصورة 20 ميغابايت.'));return}
    setCorners(cornerDraft.current);cornerDraft.current=null;
    stopCamera();setPhoto(file);uploadKey.current = crypto.randomUUID();setError('');setPhase('preview');
  }
  async function takePhoto() {
    if(captureBusy.current)return;
    const media=stream.current, view=video.current;
    if(!view||!media){setError(localized(locale,'La caméra est encore en cours de préparation.','لا تزال الكاميرا قيد الإعداد.'));return}
    captureBusy.current=true;setCapturing(true);setError('');
    try {
      const blob=await capturePhoto(view,media.getVideoTracks()[0]);
      if(mounted.current&&stream.current===media)selectPhoto(blob);
    } catch(value) {
      if(mounted.current&&stream.current===media)setError(value instanceof Error&&value.message==='CAMERA_LOW_RESOLUTION'
        ?localized(locale,'Cette caméra fournit un aperçu de faible résolution. Utilisez « Sélectionner une photo » pour obtenir l’image complète.','توفر هذه الكاميرا معاينة منخفضة الدقة. استخدم «اختيار صورة» للحصول على الصورة الكاملة.')
        :localized(locale,'Impossible de prendre la photo. Attendez que l’image soit nette ou utilisez « Sélectionner une photo ».','تعذر التقاط الصورة. انتظر حتى تتضح الصورة أو استخدم «اختيار صورة».'));
    } finally {captureBusy.current=false;if(mounted.current)setCapturing(false)}
  }
  async function correctCapture() {
    if(!api||!result||capturing)return;
    const revision=photoRevision.current;
    setCapturing(true);setError('');
    try {
      const blob=await api.image(result.id,'original',new AbortController().signal);
      if(!mounted.current||photoRevision.current!==revision)return;
      const candidate=result.result.corners||result.result.docquadnet.corners||result.result.opencv.corners;
      const size=result.result.original_dimensions;
      const proposal=candidate&&size?candidate.map(([x,y])=>[Math.max(0,Math.min(1,x/(size[0]-1))),Math.max(0,Math.min(1,y/(size[1]-1)))] as [number,number]):defaultCorners;
      setSide(result.side);
      cornerDraft.current=validCorners(proposal)?proposal:defaultCorners;
      selectPhoto(blob);
    } catch(value) {if(mounted.current&&photoRevision.current===revision)setError(explainLocalized(value,locale))}
    finally {if(mounted.current&&photoRevision.current===revision)setCapturing(false)}
  }
  function changeCorners(value:CardCorners|null) {setCorners(value);uploadKey.current=crypto.randomUUID()}
  async function send() {
    if (!api || !photo || phase === 'sending' || (corners&&!validCorners(corners))) return;
    const revision=sessionRevision.current;
    setPhase('sending');setError('');
    try {const capture = await api.upload(photo,side,uploadKey.current,documentId,documentInfo?.card_model||cardModel,corners||undefined);if(revision!==sessionRevision.current)return;setDocumentId(capture.document_id);setResult(capture);setDocumentCaptures(current=>[...current.filter(item=>item.id!==capture.id),capture]);setPhoto(null);setPhase('result');void api.workspace().then(workspace=>{if(revision!==sessionRevision.current)return;setDocumentInfo(workspace.documents.find(item=>item.id===capture.document_id)||null);setDocumentCaptures(workspace.captures.filter(item=>item.document_id===capture.document_id))}).catch(()=>{})}
    catch (e) {if(revision!==sessionRevision.current)return;if(e instanceof ApiError&&e.status===401){closeMobileSession();return}setError(explainLocalized(e,locale));setPhase('preview')}
  }
  const loadResult = useCallback((signal: AbortSignal) => api!.image(result!.id,'rectified',signal), [api,result?.id]);
  const good = result?.result.status === 'success' && result.review !== 'retake';
  const reset = (keepDocument = false, newCard = false) => {photoRevision.current++;setCapturing(false);stopCamera();setPhoto(null);setCorners(null);cornerDraft.current=null;setResult(null);setError('');setPhase('ready');if (!keepDocument){setDocumentId(undefined);setDocumentInfo(null);setDocumentCaptures([]);if(newCard){setSide('front');setCardModel('CNIE_MA_2020')}}if (input.current) input.current.value = ''};
  const ocrLabel = result?.ocr_summary.status === 'success' ? localized(locale,'Lecture terminée sur la station.','اكتملت القراءة على الجهاز.')
    : result?.ocr_summary.status === 'processing' ? localized(locale,'Préparation des données sur la station.','جارٍ إعداد البيانات على الجهاز.')
    : result?.ocr_summary.status === 'queued' ? localized(locale,'La lecture est en attente.','القراءة في قائمة الانتظار.')
    : result?.ocr_summary.status === 'error' || result?.ocr_summary.status === 'no_text' ? localized(locale,'Les données n’ont pas pu être préparées ; prévenez l’opérateur.','تعذر إعداد البيانات؛ أخبر المشغّل.')
    : localized(locale,'La station prépare automatiquement les données.','يُعد الجهاز البيانات تلقائياً.');

  return <div className="mobile-shell"><header className="mobile-header"><Brand compact/><small>{api?localized(locale,'CABINET CONNECTÉ','متصل بالمكتب'):localized(locale,'CAPTURE MOBILE','التقاط عبر الهاتف')}</small><select aria-label={localized(locale,'Langue','اللغة')} value={locale} onChange={event=>setLocale(event.target.value as 'fr'|'ar')}><option value="fr">FR</option><option value="ar">ع</option></select></header><main className="mobile-content">
    {!['review','documents','fullDocuments'].includes(phase)&&<div className="mobile-steps" aria-label={localized(locale,'Progression','التقدم')}><span className="active"/><span className={['camera','preview','sending','result'].includes(phase) ? 'active' : ''}/><span className={phase === 'result' ? 'active' : ''}/></div>}
    {error && <Alert severity="warning" className="error-banner" onClose={() => setError('')}>{error}</Alert>}
    {documentInfo?.status==='attention'&&documentInfo.extraction_summary.error_code&&<Alert severity="error" className="error-banner">{localized(locale,`Une vérification est nécessaire avant de continuer (${documentInfo.extraction_summary.error_code}).`,`يلزم التحقق قبل المتابعة (${documentInfo.extraction_summary.error_code}).`)}</Alert>}
    {phase === 'pair' ? pendingControl&&pendingPairCode ? <ControlPairing connecting={connecting} onSubmit={(email,password,name)=>completePairing({email,password,deviceName:name})}/> : <div className="mobile-panel"><div className="connection-hero">{connecting ? <CircularProgress size={32}/> : <QrCode size={41}/>} </div><div className="eyebrow">{localized(locale,'DU MOBILE AU CABINET','من الهاتف إلى المكتب')}</div><h1>{connecting ? localized(locale,'Connexion au PC…','جارٍ الاتصال بالحاسوب…') : pendingPairCode ? localized(locale,'Identifiez cette session.','عرّف هذه الجلسة.') : localized(locale,'Tout commence par un QR.','كل شيء يبدأ برمز QR.')}</h1>{pendingPairCode&&!connecting?<div className="pair-identity-form"><label>{localized(locale,'Nom temporaire de l’opérateur','الاسم المؤقت للمشغّل')}<input autoComplete="name" maxLength={48} value={operatorName} onChange={event=>setOperatorName(event.target.value)} placeholder={localized(locale,'Ex. Sara','مثال: سارة')}/></label><label>{localized(locale,'Nom de l’appareil','اسم الجهاز')}<input maxLength={48} value={deviceName} onChange={event=>setDeviceName(event.target.value)} placeholder={localized(locale,'Ex. Téléphone de l’accueil','مثال: هاتف الاستقبال')}/></label><Button fullWidth variant="contained" disabled={!operatorName.trim()||!deviceName.trim()} onClick={()=>void completePairing()}>{localized(locale,'Autoriser cet appareil','السماح لهذا الجهاز')}</Button></div>:<><p>{localized(locale,'Dans Valiris Desk pour Windows, choisissez « Connecter un mobile » puis scannez le QR.','في Valiris Desk لنظام Windows، اختر «توصيل هاتف» ثم امسح رمز QR.')}</p><p style={{marginTop:18}}>{localized(locale,'Connectez les deux appareils au même réseau du cabinet.','صِل الجهازين بشبكة المكتب نفسها.')}</p></>}</div> : phase==='documents'&&api&&availableIdentity?<MobileDocumentPreparation api={api} documentId={availableIdentity.document_id} open onClose={()=>setPhase('ready')}/>:phase==='fullDocuments'&&api?<MobileFullCasePreparation api={api} open onClose={()=>setPhase('ready')}/>:phase==='review'&&api&&documentInfo?<MobileStructuredReview api={api} document={documentInfo} captures={documentCaptures} onClose={()=>setPhase('result')} onReleasedExit={()=>reset(false,true)}/>:phase === 'result' && result ? <><div className="eyebrow">{localized(locale,'CAPTURE REÇUE','تم استلام الالتقاط')}</div><h1>{good ? result.review === 'accepted' ? localized(locale,'Image acceptée.','تم قبول الصورة.') : localized(locale,'Prête à vérifier.','جاهزة للمراجعة.') : localized(locale,'Améliorons-la.','لنحسّنها.')}</h1><p className="mobile-lead">{good ? localized(locale,'La photo est protégée sur votre PC. Une fois les deux faces terminées, vous pourrez vérifier ici les données structurées.','الصورة محمية على حاسوبك. بعد إكمال الوجهين يمكنك مراجعة البيانات المنظمة هنا.') : localized(locale,'Vérifiez l’indication. Si la carte est complète, vous pouvez ajuster les bords sur cette photo.','تحقق من الإرشاد. إذا كانت البطاقة كاملة، يمكنك ضبط الحواف على هذه الصورة.')}</p><section className="mobile-result"><h2>{good ? <CheckCircle2 size={19}/> : <RotateCcw size={19}/>}CNIE · {result.side === 'front' ? localized(locale,'Recto','الوجه') : localized(locale,'Verso','الظهر')}</h2>{good ? <><p>{ocrLabel}</p><ProtectedImage load={loadResult} alt={localized(locale,'Carte rectifiée','البطاقة المصححة')}/></> : <p>{localized(locale,`La capture doit être reprise (${result.result.rejection_codes[0]||'CAPTURE_INVALID'}). Placez la carte entière sur un fond contrasté avec une lumière uniforme.`,`يجب إعادة الالتقاط (${result.result.rejection_codes[0]||'CAPTURE_INVALID'}). ضع البطاقة كاملة على خلفية متباينة وإضاءة متجانسة.`)}</p>}</section><div className="mobile-actions" style={{marginTop:24}}>{!good&&result.result.original_dimensions&&<Button variant="outlined" disabled={capturing} onClick={()=>void correctCapture()}>{capturing?localized(locale,'Ouverture de la photo…','جارٍ فتح الصورة…'):localized(locale,'Ajuster les bords','ضبط الحواف')}</Button>}{documentInfo&&['data_review_required','ready'].includes(documentInfo.status)&&<Button variant="contained" startIcon={<ShieldCheck size={18}/>} onClick={()=>setPhase('review')}>{documentInfo.status==='ready'?localized(locale,'Voir les données approuvées','عرض البيانات المعتمدة'):localized(locale,'Vérifier les données','مراجعة البيانات')}</Button>}<Button variant={documentInfo&&['data_review_required','ready'].includes(documentInfo.status)?'outlined':'contained'} startIcon={good ? <Camera size={18}/> : <RotateCcw size={18}/>} onClick={() => {reset(true);if (good) setSide(side === 'front' ? 'back' : 'front')}}>{good ? localized(locale,'Capturer l’autre face','التقاط الوجه الآخر') : localized(locale,'Reprendre la capture','إعادة الالتقاط')}</Button><Button onClick={() => reset(false,true)}>{localized(locale,'Nouvelle carte','بطاقة جديدة')}</Button></div></> : <>
       <div className="eyebrow">{localized(locale,'CAPTURE DU DOCUMENT','التقاط الوثيقة')}</div><h1>{phase === 'preview' ? localized(locale,'Un dernier regard.','نظرة أخيرة.') : phase === 'sending' ? localized(locale,'Envoi au cabinet…','جارٍ الإرسال إلى المكتب…') : localized(locale,'Approchez. Cadrez. Capturez.','قرّب. أطّر. التقط.')}</h1><p className="mobile-lead">{phase === 'preview' ? localized(locale,'Vérifiez la netteté et les reflets. Une face valide sera acceptée automatiquement puis traitée par l’OCR européen.','تحقق من الوضوح والانعكاسات. سيُقبل الوجه الصحيح تلقائياً ثم يُعالج عبر OCR الأوروبي.') : localized(locale,'Une seule carte, les quatre coins visibles et une lumière douce.','بطاقة واحدة، والزوايا الأربع ظاهرة، وإضاءة ناعمة.')}</p>
      <label className="mobile-card-model" htmlFor="mobile-card-model">{localized(locale,'Modèle de carte','نموذج البطاقة')}<select id="mobile-card-model" value={documentInfo?.card_model||cardModel} disabled={!!documentId||phase==='sending'} onChange={event=>setCardModel(event.target.value as CardModel)}><option value="CNIE_MA_2020">CNIE 2020 · {localized(locale,'par défaut','افتراضي')}</option><option value="CNIE_MA_LEGACY">{localized(locale,'Ancienne CNIE','البطاقة الوطنية القديمة')}</option></select>{documentId&&<small>{localized(locale,'Fixé pour les deux faces. Appuyez sur « Nouvelle carte » pour le changer.','ثابت للوجهين. اضغط «بطاقة جديدة» لتغييره.')}</small>}</label>
      <div className="side-toggle" style={{width:'fit-content'}}>{(['front','back'] as const).map(value => <button key={value} className={side === value ? 'selected' : ''} disabled={phase === 'sending'} onClick={() => setSide(value)} aria-pressed={side === value}>{value === 'front' ? localized(locale,'Recto','الوجه') : localized(locale,'Verso','الظهر')}</button>)}</div>
      <div className="camera-surface">{phase === 'camera' ? <><video ref={video} autoPlay playsInline muted style={{objectFit:"contain"}} onClick={() => video.current?.play()}/>{api&&<CameraGuide api={api} video={video} paused={capturing}/>}</> : phase === 'preview' || phase === 'sending' ? <>{preview?(corners?<CornerEditor src={preview} corners={corners} onChange={changeCorners} disabled={phase==='sending'}/>:<img src={preview} alt={localized(locale,'Photo avant envoi','الصورة قبل الإرسال')} style={{objectFit:'contain'}}/>):<CircularProgress size={30}/>}{phase === 'sending' && <div className="camera-intro"><CircularProgress size={35}/></div>}</> : <div className="camera-intro"><CardIllustration/><p>{localized(locale,'Placez la CNIE sur une surface mate.','ضع البطاقة الوطنية على سطح غير لامع.')}</p></div>}</div>
       {phase==='preview'&&<><p className="mobile-caption">{corners?localized(locale,'Faites glisser chaque point jusqu’au coin extérieur de la carte. Conservez tout le contenu.','اسحب كل نقطة إلى الزاوية الخارجية للبطاقة مع الحفاظ على كامل المحتوى.'):localized(locale,'Vérifiez que les quatre coins et le texte sont entièrement visibles.','تحقق من ظهور الزوايا الأربع والنص كاملاً.')}</p>{corners&&!validCorners(corners)&&<Alert severity="warning">{localized(locale,'Les coins se croisent ou sont trop proches. Ajustez les points avant l’envoi.','الزوايا متقاطعة أو متقاربة جداً. اضبط النقاط قبل الإرسال.')}</Alert>}<Button variant="outlined" onClick={()=>changeCorners(corners?null:defaultCorners)}>{corners?localized(locale,'Utiliser la détection automatique','استخدام الاكتشاف التلقائي'):localized(locale,'Ajuster les bords','ضبط الحواف')}</Button></>}
       {phase==='camera'&&<p className="mobile-caption" aria-live="polite">{capturing?localized(locale,'Prise de la photo…','جارٍ التقاط الصورة…'):localized(locale,'Laissez une marge autour des quatre coins et attendez que le texte soit net.','اترك هامشاً حول الزوايا الأربع وانتظر حتى يصبح النص واضحاً.')}</p>}
       <div className="mobile-actions">{phase === 'ready' ? <Button variant="contained" startIcon={<Camera size={18}/>} onClick={openCamera}>{localized(locale,'Ouvrir la caméra','فتح الكاميرا')}</Button> : phase === 'camera' ? <button className="capture-button" aria-label={localized(locale,'Prendre la photo','التقاط الصورة')} disabled={capturing} onClick={takePhoto}>{capturing?<CircularProgress size={25}/>:<Camera size={25}/>}</button> : <><Button variant="contained" startIcon={<ArrowRight size={18}/>} disabled={phase === 'sending'||!!(corners&&!validCorners(corners))} onClick={send}>{phase === 'sending' ? localized(locale,'Traitement…','جارٍ المعالجة…') : localized(locale,'Envoyer au PC','إرسال إلى الحاسوب')}</Button><Button disabled={phase === 'sending'} onClick={() => reset(!!documentId)}>{localized(locale,'Reprendre la capture','إعادة الالتقاط')}</Button></>}
       {(phase === 'ready' || phase === 'camera') && <Button startIcon={<Upload size={15}/>} onClick={() => input.current?.click()}>{localized(locale,'Sélectionner une photo','اختيار صورة')}</Button>}</div>
       {phase==='ready'&&availableIdentity&&<div className="mobile-mode-card mobile-recovery-card"><span className="eyebrow">{localized(locale,'IDENTITÉ CONSERVÉE','هوية محفوظة')}</span><h2>{localized(locale,'Continuez avec Word','تابع باستخدام Word')}</h2><p>{localized(locale,'Votre identité approuvée reste disponible jusqu’à','تبقى هويتك المعتمدة متاحة حتى')} {new Date(availableIdentity.expires_at).toLocaleTimeString(locale==='ar'?'ar-MA':'fr-MA',{hour:'2-digit',minute:'2-digit'})}.</p><DocumentModeOptions compact onPartial={()=>setPhase('documents')} onComplete={()=>setPhase('fullDocuments')}/></div>}
       {phase==='ready'&&availableCases.length>0&&<div className="mobile-mode-card mobile-recovery-card"><span className="eyebrow">{localized(locale,'DOSSIERS CONSERVÉS','ملفات محفوظة')}</span><h2>{localized(locale,'Reprenez votre travail','استئناف العمل')}</h2><p>{unfinishedCases(availableCases.length,locale)}</p><Button fullWidth variant="outlined" onClick={()=>setPhase('fullDocuments')}>{localized(locale,'Ouvrir mes dossiers','فتح ملفاتي')}</Button></div>}
      <div className="mobile-protocol"><span><Focus size={13}/>{localized(locale,'4 coins','4 زوايا')}</span><span><Sun size={13}/>{localized(locale,'Sans reflets','دون انعكاسات')}</span><span><Layers3 size={13}/>{localized(locale,'Fond mat','خلفية غير لامعة')}</span></div>
    </>}
    <input ref={input} className="hidden-input" type="file" accept="image/jpeg,image/png" capture="environment" aria-label={localized(locale,'Sélectionner une photo de la CNIE','اختيار صورة للبطاقة الوطنية')} onChange={e => selectPhoto(e.target.files?.[0])}/>
  </main><footer className="mobile-footer"><ShieldCheck size={13}/>{localized(locale,'Connexion au cabinet · Données temporaires chiffrées · 24 h maximum','اتصال بالمكتب · بيانات مؤقتة مشفرة · 24 ساعة كحد أقصى')}</footer></div>;
}
const root=document.getElementById('root');
if(root)createRoot(root).render(<AppTheme><UiLocaleProvider storageKey="notario.mobile.locale" titles={{fr:'Valiris Desk · Capture mobile',ar:'Valiris Desk · التقاط عبر الهاتف'}}><App/></UiLocaleProvider></AppTheme>);
