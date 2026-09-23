import packageInfo from '../package.json';
import {ControlUnlock,type LocalControlAccess} from './ControlUnlock';
import type {ControlIdentity} from '@notario/control-client';
import {useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient, QueryClientProvider, useQuery, useQueryClient} from '@tanstack/react-query';
import {QRCodeSVG} from 'qrcode.react';
import {acknowledgeDocumentSaveReceipt,documentSaveReceipts,type DocumentSaveReceipt} from './native-document-saves';
import {ProfessionalProfileManager,type ProfessionalProfileForm} from './ProfessionalProfileManager';
import {ApiError, CaptureApi, type ApprovedIdentitySummary, type Capture, type CaptureSide, type CardModel, type CaseDraft, type CaseDraftSummary, type CaseFieldLease, type DocumentGenerationRequest, type DocumentSummary, type Pairing, type ProfessionalProfile, type TemplateFieldDefinition, type TemplateSummary} from '@notario/api-client';
import {AppTheme, UiLocaleProvider, useUiLocale, Brand, RoleIdentityPicker, RepeatableLegalField, ProfessionalProfileField, CardIllustration, DocumentModeOptions, useCaseCollaboration, Status, ProtectedImage, Button, IconButton, Dialog,
  DialogTitle, DialogContent, DialogActions, Alert, Tooltip, CircularProgress, ScanLine,
  Smartphone, Settings2, ShieldCheck, Plus, Upload, ChevronDown, ChevronRight, CircleHelp,
  Monitor, QrCode, ArrowUpRight, Check, RotateCcw, Trash2, Download, FileImage, Clock3, Wifi,
  Sun, Focus, Move, Maximize2, Layers3, X, Link2, RefreshCw, Eye, Copy,
  AlertCircle, LinearProgress} from '@notario/ui';

const client = new QueryClient({defaultOptions:{queries:{retry:1, refetchOnWindowFocus:true}}});
const UI_VERSION=packageInfo.version;
const API_VERSION=2;
const PAGE_TITLES={fr:'Valiris Desk · Capture de documents',ar:'Valiris Desk · التقاط الوثائق'};
type Page = 'capture' | 'devices' | 'diagnostics';
function localized(locale:'fr'|'ar',fr:string,ar:string){return locale==='ar'?ar:fr}
function unsavedChanges(count:number,locale:'fr'|'ar'){
  if(locale==='fr')return `${count} modification${count===1?'':'s'} non enregistrée${count===1?'':'s'}`;
  if(count===1)return 'تغيير واحد غير محفوظ';
  if(count===2)return 'تغييران غير محفوظين';
  return `${count} تغييرات غير محفوظة`;
}
function associatedDevices(count:number,locale:'fr'|'ar'){
  if(locale==='fr')return `${count} appareil${count===1?'':'s'} associé${count===1?'':'s'} à cette station.`;
  if(count===1)return 'جهاز واحد مرتبط بهذه المحطة.';
  if(count===2)return 'جهازان مرتبطان بهذه المحطة.';
  return `${count} أجهزة مرتبطة بهذه المحطة.`;
}
export function explainLocalized(error:unknown,locale:'fr'|'ar'){
  if(error instanceof ApiError)return localized(locale,`L’opération n’a pas pu être terminée (${error.code}).`,`تعذر إكمال العملية (${error.code}).`);
  const code=typeof error==='string'?error:error instanceof Error?error.message:'';
  if(code==='LAN_IP_INVALID')return localized(locale,'Saisissez une adresse IPv4 valide.','أدخل عنوان IPv4 صالحاً.');
  if(code==='LAN_IP_NOT_PRIVATE')return localized(locale,"L’adresse doit être l’IPv4 privée de ce PC sur le réseau du cabinet.",'يجب أن يكون العنوان هو IPv4 الخاص بهذا الحاسوب على شبكة المكتب.');
  if(code==='ENGINE_NOT_FOUND')return localized(locale,"Le moteur local installé est introuvable. Réinstallez Valiris Desk.",'تعذر العثور على المحرك المحلي المثبّت. أعد تثبيت Valiris Desk.');
  if(code.startsWith('LAN_'))return localized(locale,'Impossible de préparer la connexion mobile sécurisée. Vérifiez le réseau et réessayez.','تعذر إعداد اتصال الهاتف الآمن. تحقق من الشبكة وأعد المحاولة.');
  if(code==='DOCX_EXTENSION_REQUIRED')return localized(locale,'Conservez l’extension .docx du document.','احتفظ بامتداد ‎.docx للمستند.');
  if(code.startsWith('DOCX_'))return localized(locale,'Le document Word n’a pas pu être enregistré à l’emplacement choisi.','تعذر حفظ مستند Word في الموقع المختار.');
  if(code==='SAVED_FILE_NOT_FOUND')return localized(locale,"Le fichier enregistré n’est plus disponible à cet emplacement.",'لم يعد الملف المحفوظ متاحاً في هذا الموقع.');
  if(code==='REVEAL_FILE_FAILED')return localized(locale,"Le fichier est enregistré, mais l’Explorateur Windows n’a pas pu être ouvert.",'تم حفظ الملف، لكن تعذر فتح مستكشف Windows.');
  if(code.startsWith('SAVE_RECEIPT_'))return localized(locale,"Impossible de vérifier le reçu protégé de l’enregistrement. Réessayez avant de générer un autre document.",'تعذر التحقق من إيصال الحفظ المحمي. أعد المحاولة قبل إنشاء مستند آخر.');
  if(code.startsWith('EXPORT_'))return localized(locale,"Le fichier n’a pas pu être exporté à l’emplacement choisi.",'تعذر تصدير الملف إلى الموقع المختار.');
  return localized(locale,'Impossible de se connecter au service local. Vérifiez la connexion et réessayez.','تعذر الاتصال بالخدمة المحلية. تحقق من الاتصال وأعد المحاولة.');
}
function templateTitle(item:TemplateSummary,locale:'fr'|'ar'){return locale==='ar'?item.title_ar:item.title_fr}
function templateDescription(item:TemplateSummary,locale:'fr'|'ar'){
  return locale==='ar'?'قالب موثّق لإعداد المستند.':item.description_fr;
}

function CaptureImages({api, capture}: {api: CaptureApi; capture: Capture}) {
  const {locale}=useUiLocale();
  const original = useCallback((signal: AbortSignal) => api.image(capture.id, 'original', signal), [api, capture.id]);
  const rectified = useCallback((signal: AbortSignal) => api.image(capture.id, 'rectified', signal), [api, capture.id]);
  return <div className="inspection-grid"><div className="inspection-pane"><span className="inspection-label">{localized(locale,'ORIGINAL','الأصل')}</span><ProtectedImage load={original} alt={localized(locale,'Photo originale de la carte','الصورة الأصلية للبطاقة')}/></div>
    <div className="inspection-pane"><span className="inspection-label">{localized(locale,'RECTIFIÉE','مصححة')} · 1600 × 1008</span>{capture.result.status === 'success' ? <ProtectedImage load={rectified} alt={localized(locale,'Carte rectifiée pour révision','بطاقة مصححة للمراجعة')}/> : <div className="stage-empty" style={{height:'100%',padding:25}}><RotateCcw size={30}/><h3>{localized(locale,'Une nouvelle capture est nécessaire','يلزم التقاط جديد')}</h3><p>{localized(locale,`Vérifiez l’éclairage et montrez les quatre coins (${capture.result.rejection_codes[0]||'CAPTURE_INVALID'}).`,`تحقق من الإضاءة وأظهر الزوايا الأربع (${capture.result.rejection_codes[0]||'CAPTURE_INVALID'}).`)}</p></div>}</div></div>;
}

const FIELD_GROUP_KEYS = [
  {key:'identity',keys:['national_id','given_names_ar','given_names_latin','surname_ar','surname_latin']},
  {key:'birth',keys:['birth_date','birth_place_ar','birth_place_latin']},
  {key:'document',keys:['expiry_date','sex']},
  {key:'family',keys:['filiation_ar','filiation_latin','address_ar','address_latin']},
];
const FIELD_I18N={
  fr:{groups:{identity:'Identité',birth:'Naissance',document:'Document',family:'Filiation et domicile'},labels:{national_id:'Numéro national (CIN)',given_names_ar:'Prénom · arabe',given_names_latin:'Prénom · latin',surname_ar:'Nom · arabe',surname_latin:'Nom · latin',birth_date:'Date de naissance',birth_place_ar:'Lieu de naissance · arabe',birth_place_latin:'Lieu de naissance · latin',expiry_date:'Date d’expiration',sex:'Sexe',filiation_ar:'Filiation · arabe',filiation_latin:'Filiation · latin',address_ar:'Adresse · arabe',address_latin:'Adresse · latin'},warnings:{EXTRACTION_LOW_CONFIDENCE:'Confiance OCR faible : vérifiez la valeur avec l’image.',EXTRACTION_DATA_CONFLICT:'La valeur a un format invalide ou diffère entre les deux faces.',EXTRACTION_SIDE_MISMATCH:'Le CIN visible ne correspond pas entre le recto et le verso.',EXTRACTION_REQUIRED_FIELD_MISSING:'Ce champ obligatoire n’a pas été trouvé.'}},
  ar:{groups:{identity:'الهوية',birth:'الولادة',document:'الوثيقة',family:'النسب والعنوان'},labels:{national_id:'الرقم الوطني (CIN)',given_names_ar:'الاسم الشخصي · العربية',given_names_latin:'الاسم الشخصي · اللاتينية',surname_ar:'الاسم العائلي · العربية',surname_latin:'الاسم العائلي · اللاتينية',birth_date:'تاريخ الازدياد',birth_place_ar:'مكان الازدياد · العربية',birth_place_latin:'مكان الازدياد · اللاتينية',expiry_date:'تاريخ انتهاء الصلاحية',sex:'الجنس',filiation_ar:'النسب · العربية',filiation_latin:'النسب · اللاتينية',address_ar:'العنوان · العربية',address_latin:'العنوان · اللاتينية'},warnings:{EXTRACTION_LOW_CONFIDENCE:'ثقة OCR منخفضة: تحقق من القيمة مع الصورة.',EXTRACTION_DATA_CONFLICT:'تنسيق القيمة غير صالح أو تختلف بين الوجهين.',EXTRACTION_SIDE_MISMATCH:'رقم CIN الظاهر غير متطابق بين الوجه والظهر.',EXTRACTION_REQUIRED_FIELD_MISSING:'لم يتم العثور على هذا الحقل الإلزامي.'}},
} as const;

function valueText(value:unknown):string {return Array.isArray(value)?value.join('\n'):value==null?'':String(value)}
function editableValue(key:string,value:unknown):string {const output=valueText(value);return key==='sex'&&!['M','F'].includes(output.toUpperCase())?'':output}

async function copySensitive(value:string) {
  await navigator.clipboard.writeText(value);
  setTimeout(async()=>{try{if(await navigator.clipboard.readText()===value)await navigator.clipboard.writeText('')}catch{}},60000);
}

export function StructuredDataReview({api,document,captures,onChanged,onContinue}:{api:CaptureApi;document:DocumentSummary;captures:Capture[];onChanged:()=>void;onContinue?:()=>void}) {
  const {locale}=useUiLocale();
  const fieldI18n=FIELD_I18N[locale];
  const fieldGroups=FIELD_GROUP_KEYS.map(group=>({...group,title:fieldI18n.groups[group.key as keyof typeof fieldI18n.groups]}));
  const fieldLabel=(key:string)=>fieldI18n.labels[key as keyof typeof fieldI18n.labels]||key;
  const warningText=(code:string)=>fieldI18n.warnings[code as keyof typeof fieldI18n.warnings]||code.replaceAll('_',' ').toLowerCase();
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
  const fieldKeys=useMemo(()=>FIELD_GROUP_KEYS.flatMap(group=>group.keys),[]);
  const viewerCaptureId=viewerSide==='front'?document.front_capture_id:document.back_capture_id;
  const viewerCapture=captures.find(item=>item.id===viewerCaptureId);
  const viewerImage=useCallback((signal:AbortSignal)=>viewerCapture?api.image(viewerCapture.id,'rectified',signal):Promise.reject(new Error('IMAGE_UNAVAILABLE')),[api,viewerCapture?.id]);

  useEffect(()=>{if(!data)return;setDrafts(current=>{const next={...current};const received:Record<string,string>={};Object.entries(data.fields).forEach(([key,field])=>{const value=editableValue(key,data.reviews[key]?.value??field.normalized_value);received[key]=value;const previous=serverValues.current[key];const locallyEdited=key in current&&previous!==undefined&&current[key]!==previous;if(!(key in current)||!locallyEdited)next[key]=value});serverValues.current=received;return next})},[data?.revision,data?.status]);
  useEffect(()=>{if(data&&(data.revision!==document.extraction_summary.revision||data.status!==document.extraction_summary.status))void extraction.refetch()},[data?.revision,data?.status,document.extraction_summary.revision,document.extraction_summary.status]);

  const focusField=(key:string)=>window.setTimeout(()=>{const element=fieldRefs.current[key];if(typeof element?.scrollIntoView==='function')element.scrollIntoView({block:'center',behavior:'smooth'});element?.focus()},0);
  const handleFailure=async(error:unknown)=>{
    if(error instanceof ApiError&&error.code==='EXTRACTION_STALE_REVISION'){
      await queryClient.invalidateQueries({queryKey:['extraction',document.id]});
      setMessage(localized(locale,'Un autre appareil a mis à jour cette révision. Les données ont été rechargées sans envoyer votre brouillon local.','حدّث جهاز آخر هذه المراجعة. أُعيد تحميل البيانات دون إرسال مسودتك المحلية.'));
    }else setMessage(explainLocalized(error,locale));
  };
  async function saveFields(fields:Record<string,{decision:'confirmed'|'corrected'|'absent';value:unknown}>,success:string){
    if(!data||data.status==='approved')return;setWorking(true);setMessage('');
    try{const updated=await api.reviewExtraction(document.id,data.revision,fields);queryClient.setQueryData(['extraction',document.id],updated);onChanged();setMessage(success);const next=fieldKeys.find(key=>updated.fields[key]&&!updated.reviews[key]);if(next)focusField(next)}catch(error){await handleFailure(error)}finally{setWorking(false)}
  }
  function reviewPayload(keys:string[]){if(!data)return null;const fields:Record<string,{decision:'confirmed'|'corrected';value:unknown}>={};for(const key of keys){const field=data.fields[key];if(!field)continue;const value=(drafts[key]||'').trim();if(!value)return {missing:key,fields};const predicted=editableValue(key,field.normalized_value);const submitted=key.startsWith('filiation_')||key.startsWith('address_')?value.split('\n').map(line=>line.trim()).filter(Boolean):value;fields[key]={decision:value===predicted?'confirmed':'corrected',value:submitted}}return {missing:null,fields}}
  async function confirmSection(keys:string[]){const payload=reviewPayload(keys);if(!payload)return;if(payload.missing){setMessage(localized(locale,`Complétez ${fieldLabel(payload.missing)} avant de confirmer cette section.`,`أكمل ${fieldLabel(payload.missing)} قبل تأكيد هذا القسم.`));focusField(payload.missing);return}await saveFields(payload.fields,localized(locale,`${keys.length} champs confirmés dans cette section.`,`تم تأكيد ${keys.length} حقول في هذا القسم.`))}
  async function acceptAll(){if(!data||data.status==='approved')return;const payload=reviewPayload(fieldKeys);if(!payload)return;if(payload.missing){setMessage(localized(locale,`Complétez ${fieldLabel(payload.missing)} avant d’approuver.`,`أكمل ${fieldLabel(payload.missing)} قبل الاعتماد.`));focusField(payload.missing);return}setWorking(true);setMessage('');try{const reviewed=await api.reviewExtraction(document.id,data.revision,payload.fields);queryClient.setQueryData(['extraction',document.id],reviewed);const approved=await api.approveExtraction(document.id,reviewed.revision);queryClient.setQueryData(['extraction',document.id],approved);onChanged();setMessage(localized(locale,'Tous les champs ont été acceptés et les données sont approuvées.','تم قبول جميع الحقول واعتماد البيانات.'))}catch(error){await handleFailure(error)}finally{setWorking(false)}}
  async function exportJson(){setWorking(true);setMessage('');try{const blob=await api.exportExtraction(document.id);await download(blob,`cnie-${document.id.slice(0,8)}.json`)}catch(error){setMessage(explainLocalized(error,locale))}finally{setWorking(false)}}
  async function copyJson(){setWorking(true);setMessage('');try{const blob=await api.exportExtraction(document.id);await copySensitive(await blob.text());setMessage(localized(locale,'JSON approuvé copié ; le presse-papiers sera effacé dans 60 secondes.','تم نسخ JSON المعتمد؛ ستُمسح الحافظة خلال 60 ثانية.'))}catch(error){setMessage(explainLocalized(error,locale))}finally{setWorking(false)}}
  async function releaseImages(){setWorking(true);setMessage('');try{await api.releaseImages(document.id);setReleaseOpen(false);onChanged()}catch(error){setMessage(explainLocalized(error,locale))}finally{setWorking(false)}}
  if(document.extraction_summary.status==='waiting_for_ocr'||document.extraction_summary.status==='extracting')return <div className="stage-empty extraction-wait"><CircularProgress size={26}/><h3>{document.extraction_summary.status==='extracting'?localized(locale,'Organisation des données','جارٍ تنظيم البيانات'):localized(locale,'Préparation des données des deux faces','جارٍ إعداد بيانات الوجهين')}</h3><p>{localized(locale,'L’extraction continue automatiquement. Vous pourrez ensuite vérifier les 14 champs avec les images de référence.','يستمر الاستخراج تلقائياً. يمكنك بعد ذلك مراجعة الحقول الأربعة عشر مع الصور المرجعية.')}</p></div>;
  if(document.extraction_summary.status==='attention')return <div className="extraction-attention"><Alert severity="warning">{localized(locale,`L’extraction nécessite une intervention (${document.extraction_summary.error_code||'EXTRACTION_ATTENTION'}).`,`يتطلب الاستخراج تدخلاً (${document.extraction_summary.error_code||'EXTRACTION_ATTENTION'}).`)}</Alert></div>;
  if(extraction.isPending)return <div className="stage-empty extraction-wait"><CircularProgress size={26}/><h3>{localized(locale,'Chargement des données structurées','جارٍ تحميل البيانات المنظمة')}</h3></div>;
  if(extraction.isError||!data)return <div className="extraction-attention"><Alert severity="error">{explainLocalized(extraction.error,locale)}</Alert></div>;

  const total=fieldKeys.filter(key=>data.fields[key]).length;
  const reviewed=Object.keys(data.reviews).length;
  const pendingFields=Math.max(0,total-reviewed);
  const nextPending=fieldKeys.find(key=>data.fields[key]&&!data.reviews[key]);
  const progress=total?Math.round((reviewed/total)*100):100;
  const isApproved=data.status==='approved';
  return <div className="structured-review-workspace">
    <div className="review-header structured-review-header">
      <div className="review-header-main"><div><span className="review-kicker">{localized(locale,'CONTRÔLE QUALITÉ','مراقبة الجودة')} · {data.engine.template==='CNIE_MA_LEGACY'?localized(locale,'ancienne CNIE','البطاقة القديمة'):'CNIE 2020'}</span><strong>{isApproved?localized(locale,'Données approuvées','البيانات معتمدة'):localized(locale,'Révision humaine requise','مراجعة بشرية مطلوبة')}</strong><small>{localized(locale,`${reviewed} sur ${total} champs vérifiés · ${pendingFields?`${pendingFields} en attente`:'révision terminée'}`,`${reviewed} من ${total} حقول تمت مراجعتها · ${pendingFields?`${pendingFields} قيد الانتظار`:'اكتملت المراجعة'}`)}</small></div><span className={`review-pill ${data.status}`}>{isApproved?localized(locale,'Approuvé','معتمد'):localized(locale,'En révision','قيد المراجعة')}</span></div>
      <div className="review-progress"><LinearProgress variant="determinate" value={progress}/><span>{localized(locale,`${progress} % des champs vérifiés`,`${progress}٪ من الحقول تمت مراجعتها`)}</span></div>
      <div className="review-header-actions"><Button size="small" variant="outlined" disabled={!nextPending||working||isApproved} endIcon={<ChevronRight size={14}/>} onClick={()=>nextPending&&focusField(nextPending)}>{localized(locale,'Suivant en attente','الحقل التالي')}</Button><Button size="small" startIcon={<Eye size={14}/>} onClick={()=>setViewerSide('front')}>{localized(locale,'Voir le recto','عرض الوجه')}</Button><Button size="small" startIcon={<Eye size={14}/>} onClick={()=>setViewerSide('back')}>{localized(locale,'Voir le verso','عرض الظهر')}</Button><span className="keyboard-tip">{localized(locale,'Ctrl + Entrée confirme · Alt + ↓ avance','Ctrl + Enter للتأكيد · Alt + ↓ للتقدم')}</span></div>
    </div>
    {data.warnings.length>0&&<Alert severity="warning" className="field-alert"><strong>{localized(locale,'Vérification renforcée requise.','مراجعة معززة مطلوبة.')}</strong><span> {localized(locale,'Vérifiez chaque champ marqué avant d’approuver.','تحقق من كل حقل محدد قبل الاعتماد.')}</span></Alert>}
    <div className="structured-sections" role="region" aria-label={localized(locale,'Champs à vérifier','حقول للمراجعة')}>
      {fieldGroups.map(group=>{const groupKeys=group.keys.filter(key=>data.fields[key]);if(!groupKeys.length)return null;const groupReviewed=groupKeys.filter(key=>data.reviews[key]).length;return <section className="structured-section" key={group.title}>
        <div className="structured-section-head"><div><h3>{group.title}</h3><span>{localized(locale,`${groupReviewed} sur ${groupKeys.length} vérifiés`,`${groupReviewed} من ${groupKeys.length} تمت مراجعتها`)}</span></div>{!isApproved&&<Button size="small" variant="contained" disabled={working} onClick={()=>confirmSection(groupKeys)}>{localized(locale,'Confirmer la catégorie','تأكيد الفئة')}</Button>}</div>
        {groupKeys.map(key=>{const item=data.fields[key];const review=data.reviews[key];const rtl=key.endsWith('_ar');const decision=review?.decision;const activeWarnings=decision==='corrected'?[]:item.warnings;const stateClass=decision||(activeWarnings.length?'warning':'pending');const stateLabel=decision==='confirmed'?localized(locale,'Confirmé','مؤكد'):decision==='corrected'?localized(locale,'Corrigé','مصحح'):activeWarnings.length?localized(locale,'À vérifier','يتطلب المراجعة'):localized(locale,'En attente','قيد الانتظار');const multiline=key.startsWith('address')||key.startsWith('filiation');const onKeyDown=(event:KeyboardEvent)=>{if(event.ctrlKey&&event.key==='Enter'){event.preventDefault();void confirmSection(groupKeys)}if(event.altKey&&event.key==='ArrowDown'){event.preventDefault();if(nextPending)focusField(nextPending)}};return <div className={`field-row ${stateClass}`} key={key}>
          <div className="field-label"><div className="field-name"><label htmlFor={`field-${key}`}>{fieldLabel(key)}<b>*</b></label><span className="field-source">{item.source_side==='back'?localized(locale,'VERSO','الظهر'):localized(locale,'RECTO','الوجه')}</span></div><span className={`field-state ${stateClass}`}>{stateLabel}</span></div>
          <div className="field-input-line">{key==='sex'?<select ref={node=>{fieldRefs.current[key]=node}} id={`field-${key}`} disabled={isApproved} value={drafts[key]||''} onKeyDown={onKeyDown} onChange={event=>setDrafts(current=>({...current,[key]:event.target.value}))}><option value="">{localized(locale,'Sélectionnez le sexe imprimé','اختر الجنس المطبوع')}</option><option value="F">F · {localized(locale,'Féminin','أنثى')}</option><option value="M">M · {localized(locale,'Masculin','ذكر')}</option></select>:multiline?<textarea ref={node=>{fieldRefs.current[key]=node}} id={`field-${key}`} dir={rtl?'rtl':'ltr'} readOnly={isApproved} value={drafts[key]||''} autoComplete="off" spellCheck={false} onKeyDown={onKeyDown} onChange={event=>setDrafts(current=>({...current,[key]:event.target.value}))}/>:<input ref={node=>{fieldRefs.current[key]=node}} id={`field-${key}`} dir={rtl?'rtl':'ltr'} readOnly={isApproved} value={drafts[key]||''} autoComplete="off" spellCheck={false} onKeyDown={onKeyDown} onChange={event=>setDrafts(current=>({...current,[key]:event.target.value}))}/>}<button type="button" className="field-copy" disabled={!drafts[key]} onClick={()=>void copySensitive(drafts[key]||'').then(()=>setMessage(localized(locale,'Champ copié ; le presse-papiers sera effacé dans 60 secondes.','تم نسخ الحقل؛ ستُمسح الحافظة خلال 60 ثانية.'))).catch(()=>setMessage(localized(locale,'Impossible de copier.','تعذر النسخ.')))} aria-label={`${localized(locale,'Copier','نسخ')} ${fieldLabel(key)}`}><Copy size={13}/></button></div>
          {activeWarnings.length>0&&<div className="field-warning"><AlertCircle size={13}/><span>{activeWarnings.map(warningText).join(' ')}</span></div>}
          <div className="field-actions"><span className="field-confidence">{item.confidence==null?localized(locale,'Confiance indisponible','درجة الثقة غير متاحة'):localized(locale,`${Math.round(item.confidence*100)} % de confiance OCR`,`ثقة OCR بنسبة ${Math.round(item.confidence*100)}٪`)}</span></div>
        </div>})}
      </section>})}
    </div>
    {message&&<Alert severity={isApproved?'success':'info'} className="review-message">{message}</Alert>}
    <div className="approval-bar structured-approval-bar"><div className="approval-copy"><ShieldCheck size={15}/><span>{isApproved?localized(locale,`Révision approuvée depuis ${data.approved_by==='mobile'?'le mobile':'Windows'} ; l’étape suivante consiste à préparer le document.`,`تم اعتماد المراجعة من ${data.approved_by==='mobile'?'الهاتف':'Windows'}؛ الخطوة التالية إعداد الوثيقة.`):localized(locale,'Vous pouvez confirmer par catégorie ou accepter tous les champs visibles en une seule action.','يمكنك التأكيد حسب الفئة أو قبول جميع الحقول الظاهرة دفعة واحدة.')}</span></div><div className="approval-actions"><Button variant="contained" disabled={working||isApproved} startIcon={<ShieldCheck size={14}/>} onClick={acceptAll}>{working?localized(locale,'Validation…','جارٍ الاعتماد…'):localized(locale,'Tout accepter et approuver','قبول الكل واعتماده')}</Button>{isApproved&&onContinue&&<Button variant="contained" endIcon={<ChevronRight size={14}/>} onClick={onContinue}>{localized(locale,'Continuer vers les documents','المتابعة إلى الوثائق')}</Button>}<Button disabled={working||!isApproved} startIcon={<Download size={14}/>} onClick={exportJson}>{localized(locale,'Exporter JSON','تصدير JSON')}</Button><Button disabled={working||!isApproved} startIcon={<Copy size={14}/>} onClick={copyJson}>{localized(locale,'Copier JSON','نسخ JSON')}</Button><Button color="warning" disabled={working||!isApproved} onClick={()=>setReleaseOpen(true)}>{localized(locale,'Conserver l’identité et libérer les images','الاحتفاظ بالهوية وحذف الصور')}</Button></div></div>
    <Dialog open={viewerSide!==null} onClose={()=>setViewerSide(null)} fullWidth maxWidth="lg"><DialogTitle>CNIE · {viewerSide==='back'?localized(locale,'Verso','الظهر'):localized(locale,'Recto','الوجه')}</DialogTitle><DialogContent className="document-viewer">{viewerSide&&viewerCapture&&<ProtectedImage load={viewerImage} alt={`CNIE · ${viewerSide==='back'?localized(locale,'Verso','الظهر'):localized(locale,'Recto','الوجه')}`}/>}</DialogContent><DialogActions><Button disabled={viewerSide==='front'} onClick={()=>setViewerSide('front')}>{localized(locale,'Recto','الوجه')}</Button><Button disabled={viewerSide==='back'} onClick={()=>setViewerSide('back')}>{localized(locale,'Verso','الظهر')}</Button><Button onClick={()=>setViewerSide(null)}>{localized(locale,'Fermer','إغلاق')}</Button></DialogActions></Dialog>
    <Dialog open={releaseOpen} onClose={()=>setReleaseOpen(false)}><DialogTitle>{localized(locale,'Conserver uniquement l’identité approuvée','الاحتفاظ بالهوية المعتمدة فقط')}</DialogTitle><DialogContent>{localized(locale,'Les images, rectifications, OCR et preuves seront définitivement supprimés. La fiche vérifiée restera chiffrée et disponible pendant 24 heures au maximum pour préparer les documents Word.','ستُحذف الصور والتصحيحات وOCR والأدلة نهائياً. ستبقى البطاقة المراجعة مشفرة ومتاحة لمدة أقصاها 24 ساعة لإعداد مستندات Word.')}</DialogContent><DialogActions><Button onClick={()=>setReleaseOpen(false)}>{localized(locale,'Annuler','إلغاء')}</Button><Button color="warning" disabled={working} onClick={releaseImages}>{localized(locale,'Libérer les images','حذف الصور')}</Button></DialogActions></Dialog>
  </div>;
}

function CaptureWorkflow({api,capture,document,captures,onChanged,onContinue,onRetry}:{api:CaptureApi;capture:Capture;document?:DocumentSummary;captures:Capture[];onChanged:()=>void;onContinue:()=>void;onRetry:(id:string)=>void}) {
  const {locale}=useUiLocale();
  const sideName=(side:CaptureSide)=>side==='front'?localized(locale,'recto','الوجه'):localized(locale,'verso','الظهر');
  if(capture.result.status!=='success')return <div className="capture-gate"><CaptureImages api={api} capture={capture}/><Alert severity="warning">{localized(locale,'La vérification locale a refusé cette face. Reprenez la capture avant de continuer.','رفض التحقق المحلي هذا الوجه. أعد الالتقاط قبل المتابعة.')}</Alert></div>;
  if(!document?.front_capture_id||!document.back_capture_id)return <div className="capture-gate"><CaptureImages api={api} capture={capture}/><div className="capture-next"><ShieldCheck size={18}/><div><strong>{localized(locale,'Image acceptée automatiquement','تم قبول الصورة تلقائياً')}</strong><p>{localized(locale,`Capturez maintenant le ${document?.front_capture_id?'verso':'recto'} pour préparer les données.`,`التقط الآن ${document?.front_capture_id?'الظهر':'الوجه'} لإعداد البيانات.`)}</p></div></div></div>;
  const documentCaptures=captures.filter(item=>item.document_id===document.id);
  const rejected=documentCaptures.filter(item=>item.result.status!=='success'||item.review==='retake');
  if(rejected.length)return <div className="capture-gate"><Alert severity="warning">{localized(locale,`${rejected.map(item=>sideName(item.side)).join(' et le ')} nécessite une nouvelle photo. Sélectionnez cette face et reprenez la capture.`,`${rejected.map(item=>sideName(item.side)).join(' و')} يحتاج إلى صورة جديدة. حدد هذا الوجه وأعد الالتقاط.`)}</Alert><CaptureImages api={api} capture={capture}/></div>;
  const unreadable=documentCaptures.filter(item=>['error','no_text'].includes(item.ocr_summary.status));
  if(unreadable.length)return <div className="capture-gate capture-attention"><Alert severity="warning">{localized(locale,`Les données du ${unreadable.map(item=>sideName(item.side)).join(' et du ')} n’ont pas pu être préparées. Réessayez la lecture ou reprenez la photo.`,`تعذر إعداد بيانات ${unreadable.map(item=>sideName(item.side)).join(' و')}. أعد محاولة القراءة أو التقاط الصورة.`)}</Alert><div className="heading-actions">{unreadable.map(item=><Button key={item.id} size="small" startIcon={<RefreshCw size={13}/>} disabled={item.ocr_summary.attempts>=3} onClick={()=>onRetry(item.id)}>{item.ocr_summary.attempts>=3?localized(locale,'Limite de tentatives','تم بلوغ حد المحاولات'):localized(locale,`Réessayer le ${sideName(item.side)}`,`إعادة محاولة ${sideName(item.side)}`)}</Button>)}</div><CaptureImages api={api} capture={capture}/></div>;
  if(document.extraction_summary.status==='attention')return <div className="capture-gate capture-attention"><Alert severity="error">{localized(locale,`Les deux faces n’ont pas pu être reconnues de manière sûre (${document.extraction_summary.error_code||'EXTRACTION_ATTENTION'}). Vérifiez le modèle et reprenez la capture.`,`تعذر التعرف على الوجهين بأمان (${document.extraction_summary.error_code||'EXTRACTION_ATTENTION'}). تحقق من النموذج وأعد الالتقاط.`)}</Alert><CaptureImages api={api} capture={capture}/></div>;
  return <StructuredDataReview api={api} document={document} captures={captures} onChanged={onChanged} onContinue={onContinue}/>;
}

export function DocumentModeCard({mode,onSelect}:{mode:'partial'|'complete'|null;onSelect:(mode:'partial'|'complete')=>void}) {
  const {locale}=useUiLocale();
  return <section className="document-mode-card surface" aria-label={localized(locale,'Mode de préparation du document','طريقة إعداد الوثيقة')}>
    <div><span className="eyebrow">{localized(locale,'ÉTAPE SUIVANTE','الخطوة التالية')}</span><h2>{localized(locale,'Préparez le document Word','إعداد مستند Word')}</h2><p>{localized(locale,'Choisissez comment remplir le modèle. L’identité approuvée restera disponible pendant cette session.','اختر كيفية ملء القالب. ستبقى الهوية المعتمدة متاحة خلال هذه الجلسة.')}</p></div>
    <DocumentModeOptions selectedMode={mode} onPartial={()=>onSelect('partial')} onComplete={()=>onSelect('complete')}/>
  </section>;
}

export function DocumentCenter({api,identities,requests,onChanged,active=false,onStart=()=>{},newWorkAllowed=true,onNavigationBlockedChange}:{api:CaptureApi;identities:ApprovedIdentitySummary[];requests:DocumentGenerationRequest[];onChanged:()=>void;active?:boolean;onStart?:()=>void;newWorkAllowed?:boolean;onNavigationBlockedChange?:(blocked:boolean)=>void}) {
  const {locale}=useUiLocale();
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
      .catch(()=>{if(!disposed)setMessage(localized(locale,'Impossible de vérifier les reçus d’enregistrement protégés. Réessayez avant de générer un autre document.','تعذر التحقق من إيصالات الحفظ المحمية. أعد المحاولة قبل إنشاء مستند آخر.'))});
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
  async function retryReceiptRecovery(){setWorking('recovery');try{await refreshSaveReceipts();setMessage(localized(locale,'Reçus d’enregistrement vérifiés.','تم التحقق من إيصالات الحفظ.'))}catch(error){setMessage(explainLocalized(error,locale))}finally{setWorking(null)}}
  async function finishSavedRequest(receipt:DocumentSaveReceipt){
    await api.completeDocumentRequest(receipt.case_id,receipt.revision,receipt.id);
    await acknowledgeDocumentSaveReceipt(receipt.id);
    setSaveReceipts(items=>items.filter(item=>item.id!==receipt.id));
    setPendingCompletion(null);onChanged();
  }
  async function retrySavedRequest(){
    if(!pendingCompletion)return;setWorking('recovery');
    try{await finishSavedRequest(pendingCompletion);setMessage(localized(locale,'Document enregistré et demande retirée.','تم حفظ المستند وسحب الطلب.'))}catch(error){setMessage(`${localized(locale,'Le fichier reste enregistré.','يبقى الملف محفوظاً.')} ${explainLocalized(error,locale)}`)}finally{setWorking(null)}
  }
  function recoverSavedRequest(receipt:DocumentSaveReceipt){
    if(!receipt.confirmed||working||pendingCompletion)return;
    setPendingCompletion(receipt);setSavedPath(receipt.path);
    setMessage(localized(locale,'Enregistrement récupéré. Retirez la demande sans générer ni enregistrer un autre fichier Word.','تمت استعادة الحفظ. اسحب الطلب دون إنشاء أو حفظ ملف Word آخر.'));
  }
  async function discardSaveReceipt(receipt:DocumentSaveReceipt){
    if(working||pendingCompletion||!window.confirm(localized(locale,'Retirer uniquement ce reçu de récupération ? Le fichier Word ne sera ni supprimé ni modifié et la demande restera intacte.','هل تريد سحب إيصال الاستعادة هذا فقط؟ لن يتم حذف ملف Word أو تعديله وسيبقى الطلب كما هو.')))return;
    setWorking('recovery');try{await acknowledgeDocumentSaveReceipt(receipt.id);setSaveReceipts(items=>items.filter(item=>item.id!==receipt.id));setMessage(localized(locale,'Reçu retiré. Le fichier Word et la demande restent intacts.','تم سحب الإيصال. بقي ملف Word والطلب دون تغيير.'))}catch(error){setMessage(explainLocalized(error,locale))}finally{setWorking(null)}
  }
  function selectRole(role:string,values:string[]){setAssignments(current=>({...current,[role]:values}))}
  function beginEdit(item:DocumentGenerationRequest){if(working||pendingCompletion||saveReceipts.some(receipt=>receipt.case_id===item.id))return;onStart();setEditing(item);setTemplateId(item.template_id);setAssignments(item.assignments);setMessage(localized(locale,'Modification de la demande sélectionnée.','جارٍ تعديل الطلب المحدد.'))}
  function resetDraft(){setEditing(null);setAssignments(Object.fromEntries((selectedTemplate?.roles||[]).map(role=>[role.key,[]])))}
  async function saveRequest(){if(!selectedTemplate)return;setWorking('request');setMessage('');try{if(editing)await api.updateDocumentRequest(editing.id,editing.revision,assignments,mutationKey.current);else await api.createDocumentRequest(selectedTemplate.id,selectedTemplate.version,assignments,mutationKey.current);mutationKey.current=crypto.randomUUID();resetDraft();onChanged();setMessage(editing?localized(locale,'Demande mise à jour.','تم تحديث الطلب.'):localized(locale,'Demande ajoutée à la file.','تمت إضافة الطلب إلى القائمة.'))}catch(error){setMessage(explainLocalized(error,locale))}finally{setWorking(null)}}
  async function generate(item:DocumentGenerationRequest){
    if(working||pendingCompletion||!receiptRecoveryReady)return;
    setWorking(item.id);setMessage('');setSavedPath('');let physicallySaved=false;
    try{
      const receipts=await refreshSaveReceipts();
      if(receipts.some(receipt=>receipt.case_id===item.id)){setMessage(localized(locale,'Cette demande possède déjà un reçu d’enregistrement. Utilisez la récupération ou retirez explicitement le reçu après l’avoir vérifié.','لهذا الطلب إيصال حفظ موجود بالفعل. استخدم الاستعادة أو اسحب الإيصال صراحة بعد التحقق منه.'));return}
      const output=await api.generateDocument(item.id,item.revision);
      if('__TAURI_INTERNALS__' in window){
        const {invoke}=await import('@tauri-apps/api/core');
        const result=await invoke<{saved:boolean;path:string|null;opened:boolean;receipt_id:string|null}>('save_docx',{
          name:output.name,bytes:Array.from(new Uint8Array(await output.blob.arrayBuffer())),
          caseContext:{id:item.id,revision:output.revision,kind:'document_request'},
        });
        if(!result.saved){setMessage(localized(locale,'Enregistrement annulé. La demande reste dans la file.','تم إلغاء الحفظ. يبقى الطلب في القائمة.'));return}
        physicallySaved=true;setSavedPath(result.path||'');
        if(!result.receipt_id)throw new Error(localized(locale,'Le reçu protégé du fichier enregistré n’a pas été reçu.','لم يتم استلام الإيصال المحمي للملف المحفوظ.'));
        const timestamp=Date.now()/1000;
        const receipt:DocumentSaveReceipt={id:result.receipt_id,case_id:item.id,revision:output.revision,
          kind:'document_request',path:result.path||'',created_at:timestamp,expires_at:timestamp+86400,confirmed:true};
        setPendingCompletion(receipt);
        await finishSavedRequest(receipt);
        setMessage(result.opened?localized(locale,'Document enregistré et ouvert dans Word.','تم حفظ المستند وفتحه في Word.'):localized(locale,'Le document a été enregistré, mais Windows n’a pas pu ouvrir l’application associée.','تم حفظ المستند، لكن تعذر على Windows فتح التطبيق المرتبط.'));
      }else{await download(output.blob,output.name);setMessage(localized(locale,'Téléchargement lancé. Dans l’application Windows, la demande est retirée après confirmation de l’enregistrement.','بدأ التنزيل. في تطبيق Windows يُسحب الطلب بعد تأكيد الحفظ.'))}
    }catch(error){setMessage(physicallySaved?`${localized(locale,'Le fichier est déjà enregistré. Il reste à retirer la demande ou à confirmer son reçu :','الملف محفوظ بالفعل. بقي سحب الطلب أو تأكيد إيصال الحفظ:')} ${explainLocalized(error,locale)}`:explainLocalized(error,locale));try{await refreshSaveReceipts()}catch{/* Preserve the original failure and the protected journal. */}}
    finally{setWorking(null)}
  }
  async function reveal(){if(!savedPath)return;try{const {invoke}=await import('@tauri-apps/api/core');await invoke('reveal_file',{path:savedPath})}catch(error){setMessage(explainLocalized(error,locale))}}
  async function discard(item:DocumentGenerationRequest){if(working||pendingCompletion||saveReceipts.some(receipt=>receipt.case_id===item.id))return;setWorking(item.id);try{await api.deleteDocumentRequest(item.id);onChanged();setMessage(localized(locale,'Demande supprimée.','تم حذف الطلب.'))}catch(error){setMessage(explainLocalized(error,locale))}finally{setWorking(null)}}
  const complete=selectedTemplate?.roles.every(role=>{const count=(assignments[role.key]||[]).length;return count>=role.minimum&&count<=role.maximum});
  if(!active&&!editing&&!requests.length&&!saveReceipts.length&&!pendingCompletion&&!message&&!savedPath)return null;
  return <section className="document-center" aria-label={localized(locale,'Génération de documents Word','إنشاء مستندات Word')}>
    <div className="section-header"><div><h2>{localized(locale,'Documents Word','مستندات Word')}<span className="session-count">{requests.length}</span></h2><small>{localized(locale,'Modèles vérifiés · données approuvées · modification ultérieure dans Word','قوالب موثقة · بيانات معتمدة · تعديل لاحق في Word')}</small></div></div>
    {!receiptRecoveryReady&&<Alert severity="warning" action={<Button disabled={Boolean(working)} onClick={()=>void retryReceiptRecovery()}>{localized(locale,'Réessayer la vérification','إعادة التحقق')}</Button>}>{localized(locale,'La génération reste bloquée jusqu’à la vérification des reçus d’enregistrement.','يبقى الإنشاء محظوراً حتى يتم التحقق من إيصالات الحفظ.')}</Alert>}
    {saveReceipts.length>0&&<section className="surface document-composer" aria-label={localized(locale,'Enregistrements partiels récupérables','عمليات حفظ جزئية قابلة للاستعادة')}><h3>{localized(locale,'Enregistrements récupérables','عمليات حفظ قابلة للاستعادة')}</h3><p>{localized(locale,'Reçus protégés pendant 24 h. La récupération ne génère ni ne modifie le fichier Word.','إيصالات محمية لمدة 24 ساعة. لا تؤدي الاستعادة إلى إنشاء ملف Word أو تعديله.')}</p>{saveReceipts.map(receipt=><div className="profile-list-item" key={receipt.id}><div><strong>{receipt.confirmed?localized(locale,'Fichier enregistré confirmé','تم تأكيد حفظ الملف'):localized(locale,'Enregistrement non confirmé','حفظ غير مؤكد')}</strong><small>{new Date(receipt.created_at*1000).toLocaleString(locale==='ar'?'ar-MA':'fr-MA')} · rev. {receipt.revision}</small></div><div><Button disabled={Boolean(working)||Boolean(pendingCompletion)||!receipt.confirmed} onClick={()=>recoverSavedRequest(receipt)}>{localized(locale,'Récupérer','استعادة الحفظ')}</Button><Button color="warning" disabled={Boolean(working)||Boolean(pendingCompletion)} onClick={()=>void discardSaveReceipt(receipt)}>{localized(locale,'Retirer le reçu','سحب الإيصال')}</Button></div></div>)}</section>}
    <div className={`document-center-grid ${active||editing?'':'requests-only'}`}>
      {(active||editing)&&<div className="surface document-composer"><div className="rail-head"><h3>{editing?localized(locale,'Corriger les attributions','تصحيح التعيينات'):localized(locale,'Préparer la demande','إعداد الطلب')}</h3><FileImage size={17}/></div>
        {templates.isError?<Alert severity="error">{explainLocalized(templates.error,locale)}</Alert>:<><label className="document-field">{localized(locale,'Modèle','القالب')}<select value={selectedTemplate?.id||''} disabled={Boolean(editing)} onChange={event=>{setTemplateId(event.target.value);setAssignments({})}}>{templates.data?.map(template=><option key={template.id} value={template.id}>{templateTitle(template,locale)}</option>)}</select></label>
        {selectedTemplate&&<p className="document-template-description">{templateDescription(selectedTemplate,locale)}</p>}
        {selectedTemplate?.roles.map(role=><RoleIdentityPicker key={role.key} role={role} identities={identities} disabled={Boolean(working)||Boolean(pendingCompletion)} value={assignments[role.key]||[]} onChange={values=>selectRole(role.key,values)}/>)}
        {!identities.length&&<Alert severity="info">{localized(locale,'Aucune identité approuvée. Vous pouvez envoyer le modèle vide et compléter ses données plus tard dans Word.','لا توجد هويات معتمدة. يمكنك إرسال القالب فارغاً وإكمال بياناته لاحقاً في Word.')}</Alert>}
        {!newWorkAllowed&&!editing&&<Alert severity="warning">{localized(locale,'L’autorisation permet seulement de terminer les demandes existantes.','يسمح الترخيص فقط بإنهاء الطلبات الموجودة.')}</Alert>}
        <div className="heading-actions"><Button variant="contained" disabled={!complete||Boolean(working)||Boolean(pendingCompletion)||(!editing&&!newWorkAllowed)} onClick={saveRequest}>{editing?localized(locale,'Enregistrer la correction','حفظ التصحيح'):localized(locale,'Envoyer à la file','إرسال إلى القائمة')}</Button>{editing&&<Button disabled={Boolean(working)||Boolean(pendingCompletion)} onClick={resetDraft}>{localized(locale,'Annuler la modification','إلغاء التعديل')}</Button>}</div></>}
      </div>}
      <div className="surface document-requests"><div className="rail-head"><h3>{localized(locale,'File des demandes','قائمة الطلبات')}</h3><span>{requests.length} {localized(locale,'en attente','قيد الانتظار')}</span></div>
        {!requests.length?<div className="queue-empty"><FileImage size={19}/>{localized(locale,'Les demandes préparées dans Windows ou sur mobile apparaîtront ici.','ستظهر هنا الطلبات المعدة في Windows أو الهاتف.')}</div>:requests.map(item=>{const template=templates.data?.find(value=>value.id===item.template_id);return <article className="document-request" key={item.id}><div><strong>{template?templateTitle(template,locale):item.template_id}</strong><small>{item.source==='mobile'?localized(locale,'Préparée sur mobile','أُعد على الهاتف'):localized(locale,'Préparée dans Windows','أُعد في Windows')} · rev. {item.revision}</small></div>{item.warnings.includes('IDENTITY_ASSIGNED_TO_MULTIPLE_ROLES')&&<Alert severity="warning">{localized(locale,'La même identité est attribuée à plusieurs rôles.','الهوية نفسها معيّنة لأدوار مختلفة.')}</Alert>}<div className="heading-actions"><Button size="small" disabled={Boolean(working)||Boolean(pendingCompletion)||saveReceipts.some(receipt=>receipt.case_id===item.id)} onClick={()=>beginEdit(item)}>{localized(locale,'Vérifier les attributions','مراجعة التعيينات')}</Button><Button size="small" variant="contained" disabled={Boolean(working)||Boolean(pendingCompletion)||saveReceipts.some(receipt=>receipt.case_id===item.id)||!receiptRecoveryReady} onClick={()=>generate(item)}>{working===item.id?localized(locale,'Génération…','جارٍ الإنشاء…'):localized(locale,'Enregistrer et ouvrir dans Word','حفظ وفتح في Word')}</Button><IconButton size="small" aria-label={localized(locale,'Supprimer la demande','حذف الطلب')} disabled={Boolean(working)||Boolean(pendingCompletion)||saveReceipts.some(receipt=>receipt.case_id===item.id)||!receiptRecoveryReady} onClick={()=>discard(item)}><Trash2 size={15}/></IconButton></div></article>})}
      </div>
    </div>
    {message&&<Alert severity="info" action={<>{pendingCompletion&&<Button size="small" disabled={Boolean(working)} onClick={()=>void retrySavedRequest()}>{localized(locale,'Retirer la demande enregistrée','سحب الطلب المحفوظ')}</Button>}{savedPath&&<Button size="small" onClick={reveal}>{localized(locale,'Afficher dans l’Explorateur','إظهار في المستكشف')}</Button>}</>}>{message}</Alert>}
  </section>;
}

type SavedCaseReceipt=DocumentSaveReceipt;

export function FullCaseCenter({api,identities,cases,onChanged,active,newWorkAllowed=true,onNavigationBlockedChange}:{api:CaptureApi;identities:ApprovedIdentitySummary[];cases:CaseDraftSummary[];onChanged:()=>void;active:boolean;newWorkAllowed?:boolean;onNavigationBlockedChange?:(blocked:boolean)=>void}) {
  const {locale}=useUiLocale();
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
  const caseStatus=(status:CaseDraftSummary['status'])=>({
    editing:localized(locale,'En cours de modification','قيد التعديل'),
    final_review:localized(locale,'Révision finale','المراجعة النهائية'),
    completed:localized(locale,'Terminé','مكتمل'),
  })[status];
  const collaboration=useCaseCollaboration({api,draft,setDraft,fields:selectedTemplate?.fields,onChanged,onError:error=>setMessage(explainLocalized(error,locale))});
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
      .catch(()=>{if(!disposed)setMessage(localized(locale,'Impossible de vérifier les reçus d’enregistrement protégés. Réessayez avant de générer un autre document.','تعذر التحقق من إيصالات الحفظ المحمية. أعد المحاولة قبل إنشاء مستند آخر.'))});
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
        setMessage(localized(locale,'Ce reçu correspond à une révision antérieure. Aucun dossier n’a été fermé et le fichier enregistré reste indépendant.','هذا الإيصال يخص مراجعة سابقة. لم يُغلق أي ملف ويبقى الملف المحفوظ مستقلاً.'));return;
      }
      setDraft(item);setSavedPath(receipt.path);setMissing([]);
      setPendingCompletion({id:receipt.case_id,revision:receipt.revision,receiptId:receipt.id});
      setMessage(localized(locale,'Enregistrement récupéré. Fermez le dossier sans générer ni enregistrer un autre fichier.','تمت استعادة الحفظ. أغلق الملف دون إنشاء أو حفظ ملف آخر.'));
    }catch(error){setMessage(explainLocalized(error,locale))}finally{setWorking(false)}
  }
  async function discardSaveReceipt(receipt:SavedCaseReceipt){
    if(working||pendingCompletion||!window.confirm(localized(locale,'Retirer uniquement ce reçu de récupération ? Le document Word ne sera ni supprimé ni modifié.','هل تريد سحب إيصال الاستعادة هذا فقط؟ لن يتم حذف مستند Word أو تعديله.')))return;
    setWorking(true);try{await acknowledgeSaveReceipt(receipt.id);setMessage(localized(locale,'Reçu retiré. Le fichier Word reste inchangé.','تم سحب الإيصال. بقي ملف Word دون تغيير.'),'success')}catch(error){setMessage(explainLocalized(error,locale))}finally{setWorking(false)}
  }
  async function retryReceiptRecovery(){setWorking(true);try{await refreshSaveReceipts();setMessage(localized(locale,'Reçus d’enregistrement vérifiés.','تم التحقق من إيصالات الحفظ.'),'success')}catch(error){setMessage(explainLocalized(error,locale))}finally{setWorking(false)}}
  async function createCase(){if(!selectedTemplate)return;setWorking(true);setMessage('');try{const item=await api.createCase(selectedTemplate.id,selectedTemplate.version,'complete');setDraft(item);onChanged()}catch(error){setMessage(explainLocalized(error,locale))}finally{setWorking(false)}}
  async function openCase(id:string){
    if(working||pendingCompletion)return;
    setWorking(true);
    try{
      if(collaboration.unsaved||collaboration.saving)await collaboration.flush();
      const next=id?await api.case(id):null;
      setDraft(next);setMissing([]);setSavedPath(null);setMessage('');
    }catch(error){setMessage(explainLocalized(error,locale))}finally{setWorking(false)}
  }
  function setRole(role:string,values:string[]){collaboration.editRole(role,values)}
  function setField(key:string,value:string|string[]){collaboration.editField(key,value)}
  async function saveDraft():Promise<CaseDraft|null>{return collaboration.flush()}
  async function save(){setWorking(true);setMessage('');try{await saveDraft();setMessage(localized(locale,'Brouillon chiffré enregistré.','تم حفظ المسودة المشفرة.'),'success')}catch(error){setMessage(explainLocalized(error,locale))}finally{setWorking(false)}}
  async function finalReview(){setWorking(true);setMessage('');try{const saved=await saveDraft();if(!saved)return;const reviewed=await api.beginCaseFinalReview(saved.id,saved.revision);setDraft(reviewed);const readiness=await api.caseReadiness(reviewed.id);setMissing(readiness.missing_fields);setMessage(readiness.missing_fields.length?localized(locale,'Révision finale ouverte avec des champs en attente.','فُتحت المراجعة النهائية مع حقول معلّقة.'):localized(locale,'Révision finale prête.','المراجعة النهائية جاهزة.'))}catch(error){setMessage(explainLocalized(error,locale))}finally{setWorking(false)}}
  async function reopen(){if(!draft)return;setWorking(true);try{const item=await api.reopenCase(draft.id,draft.revision);setDraft(item);setMissing([]);onChanged()}catch(error){setMessage(explainLocalized(error,locale))}finally{setWorking(false)}}
  async function requestGeneration(){if(!draft||!receiptRecoveryReady)return;setWorking(true);try{const receipts=await refreshSaveReceipts();if(receipts.some(item=>item.case_id===draft.id)){setMessage(localized(locale,'Un reçu d’enregistrement existe déjà pour ce dossier. Récupérez-le ou retirez-le explicitement après avoir vérifié le fichier.','يوجد بالفعل إيصال حفظ لهذا الملف. استعده أو اسحبه صراحة بعد التحقق من الملف.'));return}const readiness=await api.caseReadiness(draft.id);setMissing(readiness.missing_fields);await generate(Boolean(readiness.missing_fields.length))}catch(error){setMessage(explainLocalized(error,locale))}finally{setWorking(false)}}
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
        if(!result.saved){setMessage(localized(locale,'Enregistrement annulé. Le dossier reste en révision finale.','تم إلغاء الحفظ. يبقى الملف في المراجعة النهائية.'));return}
        physicallySaved=true;setSavedPath(result.path);
        setPendingCompletion({id:draft.id,revision:output.revision,receiptId:result.receipt_id});
        const completed=await api.completeCase(draft.id,output.revision);
        await acknowledgeSaveReceipt(result.receipt_id);
        setDraft(completed);setPendingCompletion(null);onChanged();
        setMessage(result.opened?localized(locale,'Document enregistré et ouvert dans Word.','تم حفظ المستند وفتحه في Word.'):localized(locale,'Document enregistré, mais Windows n’a pas pu ouvrir Word. Le fichier reste disponible.','تم حفظ المستند، لكن تعذر على Windows فتح Word. يبقى الملف متاحاً.'),result.opened?'success':'warning');
      }else{
        await download(output.blob,output.name);
        setMessage(localized(locale,'Téléchargement lancé. La validation finale reste disponible dans Windows.','بدأ التنزيل. يظل الاعتماد النهائي متاحاً في Windows.'));
      }
    }catch(error){setMessage(physicallySaved?`${localized(locale,'Le fichier est enregistré. Réessayez uniquement la fermeture du dossier :','الملف محفوظ. أعد محاولة إغلاق الملف فقط:')} ${explainLocalized(error,locale)}`:explainLocalized(error,locale));try{await refreshSaveReceipts()}catch{/* Keep the original failure visible; protected receipts remain available after restart. */}}
    finally{setWorking(false)}
  }
  async function finishSavedDocument(){if(!pendingCompletion)return;setWorking(true);try{const completed=await api.completeCase(pendingCompletion.id,pendingCompletion.revision);await acknowledgeSaveReceipt(pendingCompletion.receiptId);setDraft(completed);setPendingCompletion(null);onChanged();setMessage(localized(locale,'Document enregistré et dossier fermé.','تم حفظ المستند وإغلاق الملف.'),'success')}catch(error){setMessage(`${localized(locale,'Le fichier reste enregistré.','يبقى الملف محفوظاً.')} ${explainLocalized(error,locale)}`)}finally{setWorking(false)}}
  async function revealSavedDocument(){if(!savedPath)return;try{const {invoke}=await import('@tauri-apps/api/core');await invoke('reveal_file',{path:savedPath})}catch{setMessage(localized(locale,'Le document est enregistré, mais l’Explorateur n’a pas pu être ouvert.','المستند محفوظ، لكن تعذر فتح المستكشف.'))}}
  async function createProfile(form:ProfessionalProfileForm){setWorking(true);try{await api.createProfessionalProfile(form.display_name_ar,form.display_name_fr,form.function_fr,profileCreateId.current);profileCreateId.current=crypto.randomUUID();await queryClient.invalidateQueries({queryKey:['professional-profiles']});setMessage(localized(locale,'Profil professionnel ajouté.','تمت إضافة الملف المهني.'),'success')}catch(error){setMessage(explainLocalized(error,locale));throw error}finally{setWorking(false)}}
  async function updateProfile(profile:ProfessionalProfile){setWorking(true);try{await api.updateProfessionalProfile(profile);await queryClient.invalidateQueries({queryKey:['professional-profiles']});setMessage(localized(locale,'Profil professionnel mis à jour.','تم تحديث الملف المهني.'),'success')}catch(error){setMessage(explainLocalized(error,locale));throw error}finally{setWorking(false)}}
  async function removeProfile(profile:ProfessionalProfile){if(!window.confirm(localized(locale,`Supprimer définitivement le profil « ${profile.display_name_fr||profile.display_name_ar} » ?`,`هل تريد حذف الملف «${profile.display_name_ar||profile.display_name_fr}» نهائياً؟`)))return;setWorking(true);try{await api.deleteProfessionalProfile(profile.id);await queryClient.invalidateQueries({queryKey:['professional-profiles']});setMessage(localized(locale,'Profil supprimé.','تم حذف الملف.'),'success')}catch(error){setMessage(explainLocalized(error,locale));throw error}finally{setWorking(false)}}
  function fieldControl(field:TemplateFieldDefinition){const value=draft?.fields[field.key];const common=collaboration.bind(field.key);if(field.repeatable)return <RepeatableLegalField field={field} value={Array.isArray(value)?value:[]} identities={identities} identityIds={field.role?draft?.assignments[field.role]:undefined} {...common} onChange={values=>setField(field.key,values)}/>;if(field.type==='professional_profile'){const selected=typeof value==='string'?value:'';const choices=(profiles.data||[]).filter(item=>item.active||item.id===selected);return <ProfessionalProfileField {...common} profiles={choices} value={selected} maximumCharacters={field.maximum_characters} onChange={next=>setField(field.key,next)}/>}return <input {...common} type={field.type==='date'?'date':'text'} inputMode={field.type==='number'?'numeric':undefined} dir={field.direction} value={typeof value==='string'?value:''} maxLength={field.maximum_characters} onChange={event=>setField(field.key,event.target.value)}/>}
  if(!active&&!draft&&!saveReceipts.length)return null;
return <section className="document-center full-case-center" aria-label={localized(locale,'Dossier à remplissage complet','ملف التعبئة الكاملة')}><div className="section-header"><div><h2>{localized(locale,'Remplissage complet','التعبئة الكاملة')}<span className="session-count">{cases.length}</span></h2><small>{localized(locale,'Brouillons chiffrés · conservation maximale 24 h · génération dans Windows','مسودات مشفرة · حفظ لمدة 24 ساعة كحد أقصى · إنشاء في Windows')}</small></div>{cases.length>0&&<select aria-label={localized(locale,'Ouvrir un dossier','فتح ملف')} disabled={working||Boolean(pendingCompletion)} value={draft?.id||''} onChange={event=>void openCase(event.target.value)}><option value="">{localized(locale,'Nouveau dossier','ملف جديد')}</option>{cases.map(item=><option key={item.id} value={item.id}>{item.template_id} · {caseStatus(item.status)} · {new Date(item.updated_at).toLocaleTimeString(locale==='ar'?'ar-MA':'fr-MA',{hour:'2-digit',minute:'2-digit'})}</option>)}</select>}</div>
    {saveReceipts.length>0&&<section className="surface document-composer" aria-label={localized(locale,'Enregistrements récupérables','عمليات حفظ قابلة للاستعادة')}><h3>{localized(locale,'Enregistrements récupérables','عمليات حفظ قابلة للاستعادة')}</h3><p>{localized(locale,'Ces reçus protégés expirent après 24 heures. La récupération ne génère ni ne modifie aucun fichier Word.','تنتهي صلاحية هذه الإيصالات المحمية بعد 24 ساعة. لا تؤدي الاستعادة إلى إنشاء أي ملف Word أو تعديله.')}</p>{saveReceipts.map(receipt=><div className="profile-list-item" key={receipt.id}><div><strong>{receipt.confirmed?localized(locale,'Fichier enregistré confirmé','تم تأكيد حفظ الملف'):localized(locale,'Enregistrement non confirmé','حفظ غير مؤكد')}</strong><small>{new Date(receipt.created_at*1000).toLocaleString(locale==='ar'?'ar-MA':'fr-MA')} · rev. {receipt.revision}</small></div><div><Button disabled={working||Boolean(pendingCompletion)||!receipt.confirmed} onClick={()=>void recoverSavedCase(receipt)}>{localized(locale,'Récupérer le dossier','استعادة الملف')}</Button><Button color="warning" disabled={working||Boolean(pendingCompletion)} onClick={()=>void discardSaveReceipt(receipt)}>{localized(locale,'Retirer le reçu','سحب الإيصال')}</Button></div></div>)}</section>}
    {!receiptRecoveryReady&&<Alert severity="warning" action={<Button disabled={working} onClick={()=>void retryReceiptRecovery()}>{localized(locale,'Réessayer','إعادة المحاولة')}</Button>}>{localized(locale,'La génération reste bloquée jusqu’à la vérification des reçus d’enregistrement.','يبقى الإنشاء محظوراً حتى يتم التحقق من إيصالات الحفظ.')}</Alert>}
    {!draft?<div className="surface document-composer">{unfinishedCaseCount>0&&<Alert severity="info">{localized(locale,`${unfinishedCaseCount} dossier${unfinishedCaseCount===1?'':'s'} reste${unfinishedCaseCount===1?'':'nt'} à terminer. Ouvrez-le${unfinishedCaseCount===1?'':'s'} depuis le sélecteur avant d’en créer un autre.`,`${unfinishedCaseCount} ملف قيد الإنجاز. افتحه من القائمة قبل إنشاء ملف آخر.`)}</Alert>}{!newWorkAllowed&&<Alert severity="warning">{localized(locale,'L’autorisation permet seulement d’ouvrir et de terminer les dossiers existants.','يسمح الترخيص فقط بفتح الملفات الموجودة وإنهائها.')}</Alert>}<label className="document-field">{localized(locale,'Modèle','القالب')}<select value={selectedTemplate?.id||''} onChange={event=>setTemplateId(event.target.value)}>{templates.data?.map(template=><option key={template.id} value={template.id}>{templateTitle(template,locale)}</option>)}</select></label>{selectedTemplate&&<p className="document-template-description">{templateDescription(selectedTemplate,locale)}</p>}<Button variant="contained" disabled={working||!selectedTemplate||!newWorkAllowed} onClick={createCase}>{unfinishedCaseCount?localized(locale,'Créer un autre dossier temporaire','إنشاء ملف مؤقت آخر'):localized(locale,'Créer un dossier temporaire','إنشاء ملف مؤقت')}</Button></div>:<div className="surface document-composer"><div className="rail-head"><h3>{selectedTemplate&&templateTitle(selectedTemplate,locale)}</h3><span>rev. {draft.revision} · {caseStatus(draft.status)} · {collaboration.saving?localized(locale,'enregistrement…','جارٍ الحفظ…'):collaboration.unsaved?unsavedChanges(collaboration.unsaved,locale):localized(locale,'à jour','محدّث')}</span></div>
      {selectedTemplate?.roles.map(role=><RoleIdentityPicker key={role.key} role={role} identities={identities} {...collaboration.bind(`role.${role.key}`)} value={draft.assignments[role.key]||[]} onChange={values=>setRole(role.key,values)}/>)}
      <div className="case-field-grid">{selectedTemplate?.fields?.map(field=>field.repeatable?<div className="document-field" key={field.key}>{fieldControl(field)}</div>:<label className={`document-field ${field.direction==='rtl'?'rtl-field':''}`} key={field.key}><span>{locale==='ar'?field.label_ar:field.label_fr}{field.required&&<b aria-label={localized(locale,'recommandé','موصى به')} title={localized(locale,'Recommandé ; non bloquant','موصى به؛ لا يمنع المتابعة')}> · {localized(locale,'recommandé','موصى به')}</b>}</span>{fieldControl(field)}</label>)}</div>
      {missing.length>0&&<Alert severity="warning">{localized(locale,'Champs en attente :','الحقول المعلّقة:')} {missing.map(key=>{const field=selectedTemplate?.fields?.find(item=>item.key===key);return field?(locale==='ar'?field.label_ar:field.label_fr):key}).join(', ')}.</Alert>}
      <div className="heading-actions">{draft.status==='editing'?<><Button variant="outlined" disabled={working} onClick={save}>{localized(locale,'Enregistrer le brouillon','حفظ المسودة')}</Button><Button variant="contained" disabled={working} onClick={finalReview}>{localized(locale,'Ouvrir la révision finale','فتح المراجعة النهائية')}</Button></>:<><Button disabled={working||Boolean(pendingCompletion)} onClick={reopen}>{localized(locale,'Continuer la modification','متابعة التعديل')}</Button>{draft.status==='final_review'&&<Button variant="contained" disabled={working||Boolean(pendingCompletion)||!receiptRecoveryReady||saveReceipts.some(item=>item.case_id===draft.id)} onClick={requestGeneration}>{localized(locale,'Enregistrer et ouvrir dans Word','حفظ وفتح في Word')}</Button>}</>}</div></div>}
    {selectedTemplate?.fields?.some(field=>field.type==='professional_profile')&&<ProfessionalProfileManager profiles={profiles.data||[]} disabled={working} onCreate={createProfile} onUpdate={updateProfile} onDelete={removeProfile}/>}
    {message&&<Alert severity={messageSeverity} action={<>{pendingCompletion&&<Button size="small" disabled={working} onClick={()=>void finishSavedDocument()}>{localized(locale,'Fermer le dossier enregistré','إغلاق الملف المحفوظ')}</Button>}{savedPath&&<Button size="small" onClick={()=>void revealSavedDocument()}>{localized(locale,'Afficher dans l’Explorateur','إظهار في المستكشف')}</Button>}</>}>{message}</Alert>}
  </section>;
}

export function App({api, version, controlIdentity, controlAccess, onLock}: {api: CaptureApi; version: string;
  controlIdentity?:ControlIdentity|null;controlAccess?:LocalControlAccess|null;onLock?:()=>void}) {
  const {locale,setLocale}=useUiLocale();
  const controlMode = !!controlIdentity;
  const canManage = !controlMode || controlIdentity.role==='holder';
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
  const [sessionRejected,setSessionRejected]=useState(false);
  const finishExpired = !!controlAccess && now >= controlAccess.finish_until*1000;
  const sessionExpired = !!controlAccess && now >= controlAccess.expires_at*1000;
  const accessExpired = finishExpired || sessionExpired || sessionRejected;
  const newWorkAllowed = !controlMode || !controlAccess || now < controlAccess.new_work_until*1000;
  const accountRole = controlIdentity?.role==='holder'
    ? localized(locale,'Titulaire','صاحب المكتب')
    : localized(locale,'Opérateur','مشغّل');
  const [documentMode,setDocumentMode]=useState<'partial'|'complete'|null>(null);
  const [caseNavigationBlocked,setCaseNavigationBlocked]=useState(false);
  const [partialNavigationBlocked,setPartialNavigationBlocked]=useState(false);
  const [temporarySessionEpoch,setTemporarySessionEpoch]=useState(0);
  const documentCard=useRef<HTMLElement|null>(null);
  const input = useRef<HTMLInputElement>(null);
  const credentialInput = useRef<HTMLInputElement>(null);
  const workspace = useQuery({queryKey:['workspace'], queryFn:() => api.workspace(),
    enabled:!accessExpired, refetchInterval:accessExpired?false:4000,
    retry:(attempt,error)=>!(error instanceof ApiError&&error.status===401)&&attempt<1});
  const model = useQuery({queryKey:['model'], queryFn:() => api.request<Record<string, unknown>>('/model'),
    enabled:!accessExpired&&page === 'diagnostics'});
  const ocrConfig = useQuery({queryKey:['ocr-config'], queryFn:() => api.ocrConfig(),
    enabled:!accessExpired&&page === 'diagnostics'&&canManage});
  const captures = (workspace.data?.captures || []).filter(capture => capture.active);
  const documents = workspace.data?.documents || [];
  const selected = captures.find(c => c.id === selectedId) || null;
  const selectedDocument = documents.find(document => document.id === selected?.document_id);
  const pending = documents.filter(document=>['attention','data_review_required'].includes(document.status)).length;
  const refresh = useCallback(() => {void queryClient.invalidateQueries({queryKey:['workspace']});void queryClient.invalidateQueries({queryKey:['extraction']});void queryClient.invalidateQueries({queryKey:['professional-profiles']})}, [queryClient]);
  useEffect(()=>{if(controlMode&&workspace.error instanceof ApiError&&workspace.error.status===401)
    setSessionRejected(true)},[controlMode,workspace.error]);
  useEffect(() => accessExpired?undefined:api.subscribe(refresh), [api, refresh, accessExpired]);
  useEffect(() => {const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer)}, []);
  function continueToDocuments(){window.setTimeout(()=>documentCard.current?.scrollIntoView({block:'start',behavior:'smooth'}),100)}

  async function action(task: () => Promise<unknown>) {
    setBusy(true); setError(''); setNotice('');
    try {await task(); refresh()} catch (e) {setError(explainLocalized(e,locale))} finally {setBusy(false)}
  }
  async function startPairing() {
    if (!newWorkAllowed) return;
    setPairOpen(true); setPairing(null);
    if (!workspace.data?.mobile_url) return;
    await action(async () => setPairing(await api.pairing()));
  }
  async function upload(file?: File) {
    if (!file || !newWorkAllowed) return;
    await action(async () => {const item = await api.upload(file, side, crypto.randomUUID(), selected?.document_id, selectedDocument?.card_model||cardModel); setSelectedId(item.id); setPage('capture')});
    if (input.current) input.current.value = '';
  }
  async function importCredential(file?: File) {
    if (!file) return;
    if (file.size > 64 * 1024) {setError(localized(locale,'Le fichier d’identification dépasse la limite de 64 Kio.','يتجاوز ملف بيانات الاعتماد الحد الأقصى البالغ 64 كيلوبايت.'));return}
    await action(async () => {await api.importCredential(await file.text());await queryClient.invalidateQueries({queryKey:['ocr-config']});setNotice(localized(locale,'Identifiants validés et chiffrés pour cet utilisateur Windows.','تم التحقق من بيانات الاعتماد وتشفيرها لمستخدم Windows هذا.'))});
    if (credentialInput.current) credentialInput.current.value = '';
  }
  async function downloadImage() {
    if (!selected) return;
    await action(async () => {
      const blob = await api.image(selected.id, 'rectified');
      await download(blob, `cnie-${selected.id.slice(0,8)}.jpg`);
    });
  }
  async function configureLan() {
    if (!('__TAURI_INTERNALS__' in window)) {
      setError(localized(locale,'La configuration intégrée est disponible dans l’application Windows installée.','الإعداد المدمج متاح في تطبيق Windows المثبت.'));
      return;
    }
    setBusy(true); setError(''); setLanConfigured(false);
    try {
      const {invoke} = await import('@tauri-apps/api/core');
      await invoke('configure_lan', {ip: lanIp.trim()});
      setLanConfigured(true);
    } catch (e) { setError(explainLocalized(e,locale)); } finally { setBusy(false); }
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
      setNotice(localized(locale,'Les données temporaires, dossiers et connexions mobiles ont été supprimés en toute sécurité.','تم حذف البيانات المؤقتة والملفات واتصالات الهاتف بأمان.'));
    });
  }
  const deviceCount = workspace.data?.connected_devices || 0;
  if (accessExpired) return <div className="unlock-screen"><div className="unlock-card surface"><Brand/>
    <h1>{finishExpired?localized(locale,'L’autorisation de ce poste a expiré.','انتهت صلاحية ترخيص هذا الجهاز.'):localized(locale,'Votre session a expiré ou a été interrompue.','انتهت جلستك أو تم إيقافها.')}</h1>
    <p>{finishExpired?localized(locale,'La période de finalisation est terminée. Connectez-vous en ligne pour renouveler votre accès avant de poursuivre.','انتهت فترة إتمام العمل. اتصل بالإنترنت وجدّد دخولك قبل المتابعة.'):localized(locale,'Reconnectez-vous avec votre compte personnel. Le mode hors ligne reste disponible tant que l’autorisation du poste est valide.','سجل الدخول من جديد بحسابك الشخصي. يبقى الدخول دون إنترنت متاحاً ما دام ترخيص الجهاز سارياً.')}</p>
    {onLock&&<Button variant="contained" onClick={onLock}>{finishExpired?localized(locale,'Se connecter pour renouveler','تسجيل الدخول لتجديد الترخيص'):localized(locale,'Se reconnecter','إعادة تسجيل الدخول')}</Button>}
  </div></div>;
  return <div className="app-shell">
    <aside className="sidebar"><Brand/>
      <div className="workspace-switch"><span className="square-icon"><Monitor size={15}/></span><span>{controlIdentity?.organization_name||localized(locale,'Cabinet local','المكتب المحلي')}<small>{localized(locale,'Espace de travail','مساحة العمل')}</small></span><ChevronDown size={12}/></div>
      <p className="nav-label">{localized(locale,'ESPACE DE TRAVAIL','مساحة العمل')}</p>
      <nav aria-label={localized(locale,'Navigation principale','التنقل الرئيسي')}>
        <button className={`nav-item ${page === 'capture' ? 'active' : ''}`} onClick={() => setPage('capture')} aria-label={localized(locale,'Travail CNIE et documents','العمل على البطاقة والوثائق')}><ScanLine size={17}/><span>{localized(locale,'CNIE et documents','البطاقة والوثائق')}</span>{pending > 0 && <b className="count">{pending}</b>}</button>
        <button className={`nav-item ${page === 'devices' ? 'active' : ''}`} disabled={(caseNavigationBlocked||partialNavigationBlocked)} title={(caseNavigationBlocked||partialNavigationBlocked)?localized(locale,'Terminez l’enregistrement du dossier avant de changer d’écran.','أكمل حفظ الملف قبل تغيير الشاشة.'):undefined} onClick={() => setPage('devices')} aria-label={localized(locale,'Appareils','الأجهزة')}><Smartphone size={17}/><span>{localized(locale,'Appareils','الأجهزة')}</span></button>
      </nav>
      <hr className="sidebar-separator"/><p className="nav-label">{localized(locale,'ADMINISTRATION','الإدارة')}</p>
      {canManage&&<button className={`nav-item ${page === 'diagnostics' ? 'active' : ''}`} disabled={(caseNavigationBlocked||partialNavigationBlocked)} title={(caseNavigationBlocked||partialNavigationBlocked)?localized(locale,'Terminez l’enregistrement du dossier avant de changer d’écran.','أكمل حفظ الملف قبل تغيير الشاشة.'):undefined} onClick={() => setPage('diagnostics')} aria-label={localized(locale,'Diagnostic du moteur','تشخيص المحرك')}><Settings2 size={17}/><span>{localized(locale,'Diagnostic du moteur','تشخيص المحرك')}</span></button>}
      <button className="nav-item" onClick={() => setHelpOpen(true)} aria-label={localized(locale,'Guide de capture','دليل الالتقاط')}><CircleHelp size={17}/><span>{localized(locale,'Guide de capture','دليل الالتقاط')}</span></button>
      <div className="sidebar-bottom"><div className="local-note"><strong><ShieldCheck size={14}/>{localized(locale,'Flux contrôlé','مسار مضبوط')}</strong><p>{localized(locale,'Une image valide passe automatiquement à Vision UE. Les 14 données exigent toujours une confirmation humaine.','تُرسل الصورة الصالحة تلقائياً إلى Vision EU. وتتطلب البيانات الأربع عشرة دائماً تأكيداً بشرياً.')}</p></div>
        <div className="operator"><div className="operator-avatar">{controlIdentity?.role==='holder'?'TI':'OP'}</div><div><span dir={controlAccess?.email?'ltr':undefined}>{controlAccess?.email||localized(locale,'Opérateur local','المشغّل المحلي')}</span><small>{controlMode?accountRole:localized(locale,'Station de capture','محطة الالتقاط')}</small></div></div></div>
    </aside>
    <main className="workspace-main"><header className="topbar"><div className="breadcrumb"><Monitor size={13}/><span>{localized(locale,'Espace de travail','مساحة العمل')}</span><ChevronRight size={12}/><span>{page === 'capture' ? localized(locale,'CNIE et documents','البطاقة والوثائق') : page === 'devices' ? localized(locale,'Appareils','الأجهزة') : localized(locale,'Diagnostic','التشخيص')}</span></div>
      <div className="topbar-end"><select aria-label={locale==='ar'?'اللغة':'Langue'} value={locale} onChange={event=>setLocale(event.target.value as 'fr'|'ar')}><option value="fr">Français</option><option value="ar">العربية</option></select><span className={`connection-dot ${workspace.isError ? 'offline' : ''}`}>{workspace.isError ? localized(locale,'Service hors connexion','الخدمة غير متصلة') : workspace.isPending ? localized(locale,'Connexion…','جارٍ الاتصال…') : localized(locale,'Service local connecté','الخدمة المحلية متصلة')}</span>{onLock&&<Button size="small" onClick={onLock}>{locale==='ar'?'تسجيل الخروج':'Se déconnecter'}</Button>}<Tooltip title={localized(locale,'Guide de capture','دليل الالتقاط')}><IconButton size="small" onClick={() => setHelpOpen(true)} aria-label={localized(locale,'Ouvrir l’aide','فتح المساعدة')}><CircleHelp size={17}/></IconButton></Tooltip></div></header>
      <div className="content">
        <div className="page-heading"><div><div className="eyebrow">{localized(locale,'FLUX DE TRAVAIL','مسار العمل')}</div><h1>{page === 'capture' ? localized(locale,'De la CNIE au document Word.','من البطاقة الوطنية إلى مستند Word.') : page === 'devices' ? localized(locale,'Connectez votre caméra.','وصّل كاميرتك.') : localized(locale,'Le moteur en toute transparence.','المحرك بكل وضوح.')}</h1><p>{page === 'capture' ? localized(locale,'Capturez les deux faces, confirmez les données et préparez le document depuis cet écran.','التقط الوجهين وأكد البيانات وأعد الوثيقة من هذه الشاشة.') : page === 'devices' ? localized(locale,'Associez les téléphones du cabinet à cette station.','اربط هواتف المكتب بهذه المحطة.') : localized(locale,'État réel du modèle et de la dernière rectification.','الحالة الفعلية للنموذج وآخر تصحيح.')}</p></div>
          {page === 'capture' && <div className="heading-actions"><Button variant="outlined" startIcon={<Upload size={15}/>} onClick={() => input.current?.click()} disabled={busy||!newWorkAllowed}>{localized(locale,'Importer une image','استيراد صورة')}</Button><Button variant="contained" startIcon={<Plus size={16}/>} onClick={startPairing} disabled={busy||!newWorkAllowed}>{localized(locale,'Nouvelle capture','التقاط جديد')}</Button></div>}</div>
        <input ref={input} className="hidden-input" type="file" accept="image/jpeg,image/png" disabled={!newWorkAllowed} aria-label={localized(locale,'Sélectionner une photo','اختيار صورة')} onChange={e => upload(e.target.files?.[0])}/>
        <input ref={credentialInput} className="hidden-input" type="file" accept="application/json,.json" aria-label={localized(locale,'Importer les identifiants Google','استيراد بيانات اعتماد Google')} onChange={e => importCredential(e.target.files?.[0])}/>
        {(error || workspace.isError) && <Alert className="error-banner" severity="error" onClose={() => setError('')}>{error || explainLocalized(workspace.error,locale)}</Alert>}
        {workspace.data?.storage_error && <Alert className="error-banner" severity="error">{localized(locale,'Le stockage temporaire nécessite une intervention.','يتطلب التخزين المؤقت تدخلاً.')} ({workspace.data.storage_error}) {localized(locale,'L’OCR reprendra dès que la session pourra de nouveau être enregistrée.','سيُستأنف OCR عند إمكانية حفظ الجلسة من جديد.')}</Alert>}
        {controlAccess&&!newWorkAllowed&&<Alert className="error-banner" severity="warning">{localized(locale,`La période de nouveau travail est terminée. Vous pouvez réviser et enregistrer les dossiers existants jusqu’au ${new Date(controlAccess.finish_until*1000).toLocaleString('fr-MA')}.`,`انتهت مدة بدء العمل الجديد. يمكنك مراجعة الملفات الموجودة وحفظها حتى ${new Date(controlAccess.finish_until*1000).toLocaleString('ar-MA')}.`)}</Alert>}
        {notice && <Alert className="error-banner" severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
        {page === 'capture' ? <>
          <section className="workflow-strip surface" aria-label={localized(locale,'Progression du document','تقدم الوثيقة')}><div className={`workflow-step ${!selected||selectedDocument?.status==='capturing'||selectedDocument?.status==='attention'?'current':''}`}><span className="step-num">01</span>{localized(locale,'Capturer la CNIE','التقاط البطاقة')}</div><span className="workflow-line"/><div className={`workflow-step ${selectedDocument?.status==='ocr_pending'||selectedDocument?.status==='data_review_required'?'current':''}`}><span className="step-num">02</span>{localized(locale,'Confirmer les données','تأكيد البيانات')}</div><span className="workflow-line"/><div className={`workflow-step ${selectedDocument?.status==='ready'||documentMode==='partial'?'current':''}`}><span className="step-num">03</span>{localized(locale,'Préparer Word','إعداد Word')}</div></section>
          <div className="workspace-grid"><section className="surface station" aria-label={localized(locale,'Station de révision','محطة المراجعة')}>
            <div className="station-toolbar"><h2><ScanLine size={15}/>{localized(locale,'Station de capture','محطة الالتقاط')}</h2><div className="toolbar-meta">{localized(locale,'CNIE marocaine','البطاقة الوطنية المغربية')}<span>·</span>ID-1</div></div>
            <div className="card-model-bar"><label htmlFor="desktop-card-model">{localized(locale,'Modèle de carte','نموذج البطاقة')}<select id="desktop-card-model" value={selectedDocument?.card_model||cardModel} disabled={!!selectedDocument||busy} onChange={event=>setCardModel(event.target.value as CardModel)}><option value="CNIE_MA_2020">CNIE 2020 · {localized(locale,'par défaut','افتراضي')}</option><option value="CNIE_MA_LEGACY">{localized(locale,'Ancienne CNIE','البطاقة الوطنية القديمة')}</option></select></label>{selectedDocument&&<Button size="small" onClick={()=>{setSelectedId(null);setSide('front');setCardModel('CNIE_MA_2020')}}>{localized(locale,'Nouvelle CNIE','بطاقة جديدة')}</Button>}</div>
            <div className="canvas-stage">{busy ? <div className="stage-empty"><CircularProgress size={28}/><h3>{localized(locale,'Préparation de votre capture','جارٍ إعداد الالتقاط')}</h3><p>{localized(locale,'Vérification de l’image sur cet appareil.','جارٍ التحقق من الصورة على هذا الجهاز.')}</p></div> : selected ? <CaptureWorkflow api={api} capture={selected} document={selectedDocument} captures={captures} onChanged={refresh} onContinue={continueToDocuments} onRetry={id=>void action(()=>api.retryOcr(id))}/> : <><div className="stage-empty"><CardIllustration/><h3>{localized(locale,'Votre prochain document commence ici','وثيقتك التالية تبدأ هنا')}</h3><p>{localized(locale,'Connectez votre téléphone pour prendre une photo ou importez une image depuis cet appareil.','وصّل هاتفك لالتقاط صورة أو استورد صورة من هذا الجهاز.')}</p></div><span className="stage-caption"><ShieldCheck size={12}/>{localized(locale,'Images et données temporaires chiffrées · 24 h maximum','صور وبيانات مؤقتة مشفرة · 24 ساعة كحد أقصى')}</span></>}</div>
            <div className="station-foot"><div className="side-toggle" aria-label={localized(locale,'Face du document','وجه الوثيقة')}>{(['front','back'] as const).map(value => <button key={value} className={(selected?.side || side) === value ? 'selected' : ''} aria-pressed={(selected?.side || side) === value} onClick={() => {setSide(value);const id=value==='front'?selectedDocument?.front_capture_id:selectedDocument?.back_capture_id;if(id)setSelectedId(id)}}>{value === 'front' ? localized(locale,'Recto','الوجه') : localized(locale,'Verso','الظهر')}</button>)}</div><span>{selected ? <Status status={selected.result.status} review={selected.review}/> : <><FileImage size={12}/>{localized(locale,'JPEG ou PNG · 20 Mo maximum','JPEG أو PNG · 20 ميغابايت كحد أقصى')}</>}</span>{selected && <Tooltip title={localized(locale,'Agrandir la comparaison','تكبير المقارنة')}><IconButton size="small" onClick={() => setFullscreen(true)} aria-label={localized(locale,'Agrandir la comparaison','تكبير المقارنة')}><Maximize2 size={15}/></IconButton></Tooltip>}</div>
            {selected && <div className="review-toolbar"><Button size="small" startIcon={<RotateCcw size={13}/>} disabled={busy} onClick={() => action(() => api.review(selected.id,'retake'))}>{localized(locale,'Reprendre cette face','إعادة هذا الوجه')}</Button><span className="spacer"/><Tooltip title={localized(locale,'Exporter l’image rectifiée','تصدير الصورة المصححة')}><span><IconButton size="small" disabled={busy || selected.result.status !== 'success'} onClick={downloadImage} aria-label={localized(locale,'Exporter l’image','تصدير الصورة')}><Download size={16}/></IconButton></span></Tooltip><Tooltip title={localized(locale,'Supprimer la capture','حذف الالتقاط')}><IconButton size="small" onClick={() => setDeleteOpen(true)} aria-label={localized(locale,'Supprimer la capture','حذف الالتقاط')}><Trash2 size={15}/></IconButton></Tooltip></div>}
          </section><aside className="right-rail">
            <section className="rail-card surface"><div className="rail-head"><h2>{localized(locale,'Capture depuis votre mobile','التقاط من الهاتف')}</h2><Smartphone size={16}/></div><p>{localized(locale,'Une caméra. Un QR. Votre document arrive directement sur cette station.','كاميرا واحدة ورمز QR واحد، وتصل وثيقتك مباشرة إلى هذه المحطة.')}</p><div className="pair-visual"><div className="phone-symbol"><QrCode size={20}/></div><div className="pair-line"/><div className="pair-copy">{deviceCount ? localized(locale,`${deviceCount} mobile connecté`,`${deviceCount} هاتف متصل`) : localized(locale,'Connexion du cabinet','اتصال المكتب')}<small>{deviceCount ? localized(locale,'Prêt à recevoir les captures','جاهز لاستقبال الالتقاطات') : localized(locale,'Sans câble ni installation','دون أسلاك أو تثبيت')}</small></div></div><Button fullWidth variant="outlined" startIcon={<QrCode size={15}/>} disabled={!newWorkAllowed} onClick={startPairing}>{localized(locale,'Connecter un mobile','توصيل هاتف')}</Button></section>
            <section className="rail-card surface"><div className="rail-head"><h2>{localized(locale,'Une bonne capture','التقاط جيد')}</h2><Sun size={15}/></div><ul className="checklist"><li><Focus size={15}/><span><strong>{localized(locale,'Quatre coins visibles','الزوايا الأربع ظاهرة')}</strong>{localized(locale,'Laissez une petite marge autour.','اترك هامشاً صغيراً حولها.')}</span></li><li><Sun size={15}/><span><strong>{localized(locale,'Lumière douce, sans reflets','إضاءة ناعمة دون انعكاسات')}</strong>{localized(locale,'Évitez le flash et les ombres directes.','تجنب الفلاش والظلال المباشرة.')}</span></li><li><Layers3 size={15}/><span><strong>{localized(locale,'Fond mat et uniforme','خلفية غير لامعة ومتجانسة')}</strong>{localized(locale,'Une seule carte, sans objet posé dessus.','بطاقة واحدة دون أشياء فوقها.')}</span></li></ul></section>
          </aside></div>
          <div ref={node=>{documentCard.current=node}}>{Boolean(workspace.data?.approved_identities.length||workspace.data?.document_generation_requests.length||workspace.data?.case_drafts.length)&&<DocumentModeCard mode={documentMode} onSelect={setDocumentMode}/>}<DocumentCenter key={`partial-${temporarySessionEpoch}`} onNavigationBlockedChange={setPartialNavigationBlocked} api={api} identities={workspace.data?.approved_identities||[]} requests={workspace.data?.document_generation_requests||[]} onChanged={refresh} active={documentMode==='partial'} onStart={()=>setDocumentMode('partial')} newWorkAllowed={newWorkAllowed}/><FullCaseCenter key={`complete-${temporarySessionEpoch}`} onNavigationBlockedChange={setCaseNavigationBlocked} api={api} identities={workspace.data?.approved_identities||[]} cases={workspace.data?.case_drafts||[]} onChanged={refresh} active={documentMode==='complete'} newWorkAllowed={newWorkAllowed}/></div>
          <section className="session-section"><div className="section-header"><div><h2>{localized(locale,'CNIE de cette session','بطاقات هذه الجلسة')}<span className="session-count">{documents.length}</span></h2><small>{localized(locale,'Images, OCR et données temporaires','الصور وOCR والبيانات المؤقتة')}</small></div>{canManage&&<Button size="small" color="warning" startIcon={<Trash2 size={14}/>} disabled={busy||!(documents.length||workspace.data?.approved_identities.length||workspace.data?.document_generation_requests.length||workspace.data?.case_drafts.length)} onClick={()=>setClearOpen(true)}>{localized(locale,'Nettoyer la session','مسح الجلسة')}</Button>}</div><div className="surface"><div className="queue-head document-head"><span>{localized(locale,'Document','الوثيقة')}</span><span>{localized(locale,'Recto','الوجه')}</span><span>{localized(locale,'Verso','الظهر')}</span><span>{localized(locale,'État','الحالة')}</span></div>{documents.length === 0 ? <div className="queue-empty"><FileImage size={19}/>{workspace.isPending ? localized(locale,'Connexion à votre station…','جارٍ الاتصال بمحطتك…') : localized(locale,'Vos documents apparaîtront ici avec leurs deux faces.','ستظهر وثائقك هنا بوجهيها.')}</div> : documents.map(document => {const front=captures.find(c=>c.id===document.front_capture_id);const back=captures.find(c=>c.id===document.back_capture_id);const chosen=front||back;const labels=locale==='ar'?{capturing:'ينقص وجه',review_required:'إعادة وجه',ocr_pending:'معالجة البيانات',data_review_required:'مراجعة البيانات',ready:'معتمدة',attention:'تتطلب الانتباه'}:{capturing:'Une face manque',review_required:'Reprendre une face',ocr_pending:'Traitement des données',data_review_required:'Vérifier les données',ready:'Approuvée',attention:'Attention'};const label=labels[document.status];const face=(capture:Capture|undefined)=>capture?capture.ocr_summary.status==='success'?localized(locale,'Lue','مقروءة'):capture.review==='accepted'?localized(locale,'Traitement','قيد المعالجة'):localized(locale,'Capturée','ملتَقطة'):localized(locale,'En attente','قيد الانتظار');return <button key={document.id} className={`queue-row document-row ${selected?.document_id === document.id ? 'is-selected' : ''}`} onClick={() => chosen && setSelectedId(chosen.id)}><span className="queue-name"><FileImage size={16}/>CNIE · {document.id.slice(0,8)}</span><span className={`face-indicator ${front?.ocr_summary.status === 'success'?'done':''}`}>{face(front)}</span><span className={`face-indicator ${back?.ocr_summary.status === 'success'?'done':''}`}>{face(back)}</span><span className={`document-status ${document.status}`}>{label}</span></button>})}</div></section>
        </> : page === 'devices' ? <section className="connection-page surface"><div className="rail-head"><h2>{localized(locale,'Appareils de capture','أجهزة الالتقاط')}</h2><Wifi size={20}/></div><p>{deviceCount ? associatedDevices(deviceCount,locale) : localized(locale,'Aucun mobile n’est encore associé.','لا يوجد هاتف مرتبط بعد.')} {localized(locale,'Le QR reste valable deux minutes et ne peut être utilisé qu’une fois.','يبقى رمز QR صالحاً لدقيقتين ويُستخدم مرة واحدة فقط.')}</p><p>{localized(locale,'Le mobile doit être connecté au même réseau du cabinet. La session dure jusqu’à quatre heures.','يجب أن يكون الهاتف متصلاً بشبكة المكتب نفسها. تدوم الجلسة حتى أربع ساعات.')}</p><div className="heading-actions"><Button variant="contained" startIcon={<QrCode size={16}/>} disabled={!newWorkAllowed} onClick={startPairing}>{localized(locale,'Générer un QR','إنشاء رمز QR')}</Button><Button disabled={!deviceCount || busy} onClick={() => action(() => api.disconnect())}>{localized(locale,'Déconnecter les mobiles','فصل الهواتف')}</Button></div>{workspace.data?.mobile_url ? <><Alert severity="success" style={{marginTop:20}}>{workspace.data.lan_mode === 'automatic' ? localized(locale,'Adresse détectée et protégée automatiquement.','تم اكتشاف العنوان وحمايته تلقائياً.') : workspace.data.lan_mode === 'managed' ? localized(locale,'Adresse gérée par la configuration informatique.','العنوان مُدار عبر إعدادات تقنية المعلومات.') : localized(locale,'Adresse manuelle active et protégée.','العنوان اليدوي نشط ومحمي.')}</Alert><p>{localized(locale,'Adresse active :','العنوان النشط:')} <code>{workspace.data.mobile_url}</code></p></> : canManage ? <div className="lan-setup"><h3>{localized(locale,'Le réseau n’a pas pu être sélectionné automatiquement','تعذر اختيار الشبكة تلقائياً')}</h3><p>{localized(locale,'Cela peut arriver avec plusieurs cartes réseau, un VPN ou aucune connexion active. Saisissez alors l’IPv4 privée et stable du réseau du cabinet.','قد يحدث ذلك عند وجود عدة بطاقات شبكة أو VPN أو عدم وجود اتصال نشط. أدخل عنوان IPv4 الخاص والثابت لشبكة المكتب.')}</p><div className="lan-form"><input className="lan-input" value={lanIp} onChange={e => setLanIp(e.target.value)} placeholder={localized(locale,'Ex. 192.168.0.107','مثال: 192.168.0.107')} inputMode="numeric" aria-label={localized(locale,'IPv4 privée du PC','عنوان IPv4 الخاص بالحاسوب')}/><Button variant="outlined" disabled={busy || !lanIp.trim()} onClick={configureLan}>{busy ? localized(locale,'Configuration…','جارٍ الإعداد…') : localized(locale,'Utiliser l’adresse manuelle','استخدام العنوان اليدوي')}</Button></div>{lanConfigured && <Alert className="lan-success" severity="success" action={<Button size="small" onClick={restartApp}>{localized(locale,'Redémarrer maintenant','إعادة التشغيل الآن')}</Button>}>{localized(locale,'Certificat créé. Redémarrez Valiris Desk pour activer la caméra mobile.','تم إنشاء الشهادة. أعد تشغيل Valiris Desk لتفعيل كاميرا الهاتف.')}</Alert>}</div> : <Alert severity="warning" style={{marginTop:20}}>{localized(locale,'Demandez au titulaire de configurer la connexion mobile de cette station.','اطلب من صاحب المكتب إعداد اتصال الهاتف لهذه المحطة.')}</Alert>}</section> : <div className="diagnostic-grid"><section className="connection-page surface"><div className="rail-head"><h2>{localized(locale,'Google Cloud Vision · UE','Google Cloud Vision · الاتحاد الأوروبي')}</h2><ShieldCheck size={19}/></div>{ocrConfig.isPending?<CircularProgress size={24}/>:ocrConfig.isError?<Alert severity="error">{explainLocalized(ocrConfig.error,locale)}</Alert>:<><Alert severity={ocrConfig.data?.configured?'success':'warning'}>{ocrConfig.data?.configured?localized(locale,'Identifiants chiffrés avec Windows DPAPI pour cet utilisateur.','بيانات الاعتماد مشفرة عبر Windows DPAPI لهذا المستخدم.'):localized(locale,'OCR non configuré. Importez le compte de service dédié.','لم يتم إعداد OCR. استورد حساب الخدمة المخصص.')}</Alert>{ocrConfig.data?.configured&&<dl><div className="metric-pair"><dt>{localized(locale,'Projet','المشروع')}</dt><dd>{ocrConfig.data.project_id}</dd></div><div className="metric-pair"><dt>{localized(locale,'Compte','الحساب')}</dt><dd>{ocrConfig.data.client_email}</dd></div><div className="metric-pair"><dt>{localized(locale,'Région','المنطقة')}</dt><dd>{localized(locale,'eu · point de terminaison européen','eu · نقطة نهاية أوروبية')}</dd></div><div className="metric-pair"><dt>{localized(locale,'Utilisation aujourd’hui','استخدام اليوم')}</dt><dd>{ocrConfig.data.limits.used_today} / {ocrConfig.data.limits.daily_limit}</dd></div><div className="metric-pair"><dt>{localized(locale,'Utilisation mensuelle','الاستخدام الشهري')}</dt><dd>{ocrConfig.data.limits.used_month} / {ocrConfig.data.limits.monthly_limit}</dd></div></dl>}<div className="heading-actions diagnostic-actions"><Button variant="contained" startIcon={<Upload size={14}/>} onClick={()=>credentialInput.current?.click()}>{ocrConfig.data?.configured?localized(locale,'Remplacer les identifiants','استبدال بيانات الاعتماد'):localized(locale,'Importer les identifiants Google','استيراد بيانات اعتماد Google')}</Button><Button disabled={!ocrConfig.data?.configured||busy} onClick={()=>action(()=>api.testOcr())}>{localized(locale,'Tester la connexion','اختبار الاتصال')}</Button><Button color="error" disabled={!ocrConfig.data?.configured||busy} onClick={()=>action(async()=>{await api.deleteCredential();await queryClient.invalidateQueries({queryKey:['ocr-config']})})}>{localized(locale,'Supprimer les identifiants','حذف بيانات الاعتماد')}</Button></div><p>{localized(locale,'Le fichier JSON original n’est pas supprimé. Le service informatique doit le retirer selon sa procédure sécurisée.','لا يُحذف ملف JSON الأصلي. يجب على قسم تقنية المعلومات إزالته وفق إجراءاته الآمنة.')}</p></>}</section><section className="connection-page surface"><h2>{localized(locale,'Modèle local · ONNX Runtime','النموذج المحلي · ONNX Runtime')}</h2><p>{localized(locale,'La Phase 1 reste figée. Ces données proviennent du moteur installé.','تبقى المرحلة الأولى مجمدة. تأتي هذه البيانات من المحرك المثبت.')}</p>{model.isPending ? <CircularProgress size={24}/> : model.isError ? <Alert severity="error">{explainLocalized(model.error,locale)}</Alert> : <pre className="model-json" dir="ltr">{JSON.stringify(model.data,null,2)}</pre>}</section><section className="rail-card surface"><h2>{localized(locale,'Capture sélectionnée','الالتقاط المحدد')}</h2>{selected ? <><dl>{Object.entries(selected.result.timings_ms).map(([name,value]) => <div className="metric-pair" key={name}><dt>{name.replaceAll('_',' ')}</dt><dd>{value.toFixed(1)} ms</dd></div>)}</dl><p>{localized(locale,'Concordance des détecteurs :','تطابق الكواشف:')} {selected.result.detector_iou == null ? localized(locale,'Indisponible','غير متاح') : `${(selected.result.detector_iou * 100).toFixed(1)} % IoU`}</p>{selected.result.rejection_codes.map(code => <p className="code-note" key={code}>{code}</p>)}<Button size="small" startIcon={<Download size={14}/>} onClick={() => void action(()=>download(new Blob([JSON.stringify(selected,null,2)],{type:'application/json'}),`diagnostic-${selected.id.slice(0,8)}.json`))}>{localized(locale,'Exporter le diagnostic','تصدير التشخيص')}</Button></> : <p style={{marginTop:15}}>{localized(locale,'Sélectionnez une capture pour consulter ses métriques et ses temps.','حدد التقاطاً لعرض مقاييسه وأوقاته.')}</p>}</section></div>}
        <footer className="footer-note"><span><ShieldCheck size={12}/>{localized(locale,'Image validée localement · données chiffrées · 24 h maximum','صورة متحقق منها محلياً · بيانات مشفرة · 24 ساعة كحد أقصى')}</span><span>Valiris Desk {version}<span>·</span>{localized(locale,'Capture, OCR et extraction locale','التقاط وOCR واستخراج محلي')}</span></footer>
      </div>
    </main>
    <Dialog open={pairOpen} onClose={() => setPairOpen(false)} fullWidth maxWidth="xs"><DialogTitle>{localized(locale,'Connecter un mobile','توصيل هاتف')}</DialogTitle><DialogContent><div className="qr-container">{pairing && pairing.expires_at * 1000 > now ? <><QRCodeSVG value={pairing.url} size={208} level="M"/><p>{localized(locale,'Scannez ce QR avec la caméra du mobile connecté au réseau du cabinet.','امسح رمز QR بكاميرا الهاتف المتصل بشبكة المكتب.')}</p><span className="status status-green"><Clock3 size={12}/>{localized(locale,'Expire dans','ينتهي خلال')} {Math.max(0,Math.ceil(pairing.expires_at - now/1000))} s</span></> : !workspace.data?.mobile_url ? <><Link2 size={36}/><p>{canManage?localized(locale,'Activez d’abord HTTPS dans la section « Appareils ». Le service doit présenter un certificat approuvé au mobile.','فعّل HTTPS أولاً من قسم «الأجهزة». يجب أن تقدم الخدمة شهادة موثوقة للهاتف.'):localized(locale,'Le titulaire doit d’abord configurer la connexion mobile de cette station.','يجب على صاحب المكتب إعداد اتصال الهاتف لهذه المحطة أولاً.')}</p>{canManage&&<><Button onClick={() => {setPairOpen(false);setPage('devices')}}>{localized(locale,'Ouvrir la configuration','فتح الإعدادات')}</Button><p>{localized(locale,'Le guide d’installation explique comment approuver l’autorité publique et ouvrir le port de capture.','يوضح دليل التثبيت كيفية الوثوق بسلطة الشهادات العامة وفتح منفذ الالتقاط.')}</p></>}</> : busy ? <CircularProgress size={30}/> : <><Clock3 size={32}/><p>{localized(locale,'Générez un nouveau QR pour commencer l’association.','أنشئ رمز QR جديداً لبدء الربط.')}</p><Button onClick={startPairing}>{localized(locale,'Générer un QR','إنشاء رمز QR')}</Button></>}</div></DialogContent><DialogActions><Button onClick={() => setPairOpen(false)}>{localized(locale,'Fermer','إغلاق')}</Button></DialogActions></Dialog>
    <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} fullWidth maxWidth="sm"><DialogTitle>{localized(locale,'Une capture qui préserve chaque détail','التقاط يحافظ على كل التفاصيل')}</DialogTitle><DialogContent><p className="mobile-lead">{localized(locale,'Placez une seule CNIE sur un fond mat, uniforme et contrasté. Gardez les quatre coins visibles, sans doigts, avec une lumière diffuse.','ضع بطاقة واحدة على خلفية غير لامعة ومتجانسة ومتباينة. أبق الزوايا الأربع ظاهرة دون أصابع واستخدم إضاءة منتشرة.')}</p><ul className="checklist"><li><Check size={16}/><span>{localized(locale,'La carte doit occuper environ 50 % à 90 % du cadre.','يجب أن تشغل البطاقة نحو 50٪ إلى 90٪ من الإطار.')}</span></li><li><Check size={16}/><span>{localized(locale,'Son petit côté doit mesurer au moins 1 000 pixels sur la photo.','يجب ألا يقل ضلعها القصير عن 1000 بكسل في الصورة.')}</span></li><li><Check size={16}/><span>{localized(locale,'Vérifiez séparément le recto et le verso. Exportez les images nécessaires avant de fermer.','راجع الوجه والظهر كلٌ على حدة. صدّر الصور المطلوبة قبل الإغلاق.')}</span></li><li><ShieldCheck size={16}/><span>{localized(locale,'Les captures restent chiffrées pendant 24 heures au maximum et peuvent reprendre après redémarrage. « Nettoyer la session » les supprime immédiatement.','تبقى الالتقاطات مشفرة حتى 24 ساعة ويمكن استئنافها بعد إعادة التشغيل. يحذفها «مسح الجلسة» فوراً.')}</span></li></ul></DialogContent><DialogActions><Button onClick={() => setHelpOpen(false)}>{localized(locale,'Compris','فهمت')}</Button></DialogActions></Dialog>
    <Dialog open={fullscreen && !!selected} onClose={() => setFullscreen(false)} fullWidth maxWidth="lg"><DialogTitle>{localized(locale,'Révision du document','مراجعة الوثيقة')}</DialogTitle><DialogContent>{selected && <CaptureImages api={api} capture={selected}/>}</DialogContent><DialogActions><Button onClick={() => setFullscreen(false)}>{localized(locale,'Fermer','إغلاق')}</Button></DialogActions></Dialog>
    <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)}><DialogTitle>{localized(locale,'Supprimer cette capture','حذف هذا الالتقاط')}</DialogTitle><DialogContent>{localized(locale,'La photo et sa rectification seront supprimées de cette session. Cette action est irréversible.','ستُحذف الصورة وتصحيحها من هذه الجلسة. لا يمكن التراجع عن هذا الإجراء.')}</DialogContent><DialogActions><Button onClick={() => setDeleteOpen(false)}>{localized(locale,'Annuler','إلغاء')}</Button><Button color="error" disabled={busy} onClick={() => action(async () => {if (selected) await api.delete(selected.id); setSelectedId(null); setDeleteOpen(false)})}>{localized(locale,'Supprimer la capture','حذف الالتقاط')}</Button></DialogActions></Dialog>
    <Dialog open={clearOpen} onClose={() => !busy&&setClearOpen(false)}><DialogTitle>{localized(locale,'Nettoyer toutes les données temporaires','مسح جميع البيانات المؤقتة')}</DialogTitle><DialogContent>{localized(locale,'Les dossiers temporaires, images, OCR, identités approuvées, demandes Word et connexions mobiles seront supprimés. Les modèles, profils, préférences et identifiants Vision resteront inchangés. Cette action est irréversible.','ستُحذف الملفات المؤقتة والصور وOCR والهويات المعتمدة وطلبات Word واتصالات الهاتف. لن تتغير القوالب والملفات المهنية والتفضيلات وبيانات اعتماد Vision. لا يمكن التراجع عن هذا الإجراء.')}</DialogContent><DialogActions><Button disabled={busy} onClick={()=>setClearOpen(false)}>{localized(locale,'Annuler','إلغاء')}</Button><Button color="error" variant="contained" disabled={busy} onClick={clearTemporaryData}>{busy?localized(locale,'Suppression…','جارٍ الحذف…'):localized(locale,'Supprimer les données temporaires','حذف البيانات المؤقتة')}</Button></DialogActions></Dialog>
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

function StartupScreen({ready,error}:{ready:boolean;error:unknown}){
  const {locale}=useUiLocale();
  return <div className="unlock-screen"><div className="unlock-card surface"><Brand/><h1>{ready?localized(locale,'Votre poste est prêt.','محطتك جاهزة.'):localized(locale,'Démarrage du poste…','جارٍ تشغيل المحطة…')}</h1><p>{error?explainLocalized(error,locale):localized(locale,'Ouvrez Valiris Desk depuis son lanceur pour démarrer une session locale authentifiée.','افتح Valiris Desk من مشغّله لبدء جلسة محلية موثّقة.')}</p>{ready&&<code className="dialog-code">python -m cnie_capture serve --open</code>}</div></div>;
}

function Root() {
  const [api, setApi] = useState<CaptureApi | null>(null);
  const [controlBoot,setControlBoot] = useState<{base:string;token:string}|null>(null);
  const [controlToken,setControlToken] = useState<string|null>(null);
  const [controlIdentity,setControlIdentity] = useState<ControlIdentity|null>(null);
  const [controlAccess,setControlAccess] = useState<LocalControlAccess|null>(null);
  const [version, setVersion] = useState(UI_VERSION);
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState<unknown>(null);
  useEffect(() => {
    async function initialize() {
      if ('__TAURI_INTERNALS__' in window) {
        const {invoke} = await import('@tauri-apps/api/core');
        const {getVersion} = await import('@tauri-apps/api/app');
        const boot = await invoke<{token:string; base:string;control_required:boolean}>('bootstrap');
        setVersion(await getVersion());
        if(boot.control_required){setControlBoot({base:boot.base,token:boot.token});}
        else {const service=new CaptureApi(boot.base,boot.token);await service.waitUntilCompatible(UI_VERSION,API_VERSION);setApi(service);}
      } else {
        const hash = new URLSearchParams(location.hash.slice(1));
        const token = hash.get('token') || sessionStorage.getItem('notario.desktop.token');
        if (hash.has('token')) history.replaceState(null,'',location.pathname);
        if (token) {sessionStorage.setItem('notario.desktop.token',token);const service=new CaptureApi('',token);await service.waitUntilCompatible(UI_VERSION,API_VERSION);setApi(service)}
      }
      setReady(true);
    }
    initialize().catch(error => {setStartupError(error);setReady(true)});
  },[]);
  async function unlock(token:string,identity:ControlIdentity,access:LocalControlAccess){
    if(!controlBoot)throw new Error('CONTROL_NOT_READY');
    const service=new CaptureApi(controlBoot.base,token);
    await service.waitUntilCompatible(UI_VERSION,API_VERSION);
    client.clear();setControlToken(token);setControlIdentity(identity);setControlAccess(access);setApi(service);
  }
  async function lock(){
    if(controlBoot&&controlToken){try{await fetch(`${controlBoot.base}/api/control/session`,{
      method:'DELETE',headers:{Authorization:`Bearer ${controlToken}`},cache:'no-store',credentials:'omit'});}catch{}}
    client.clear();setApi(null);setControlToken(null);setControlIdentity(null);setControlAccess(null);
  }
  return <AppTheme><UiLocaleProvider storageKey="notario.control.locale" titles={PAGE_TITLES}>{api ? <QueryClientProvider client={client}><App api={api} version={version} controlIdentity={controlIdentity} controlAccess={controlAccess} onLock={controlBoot?()=>{void lock()}:undefined}/></QueryClientProvider> : controlBoot ? <ControlUnlock base={controlBoot.base} bootstrapToken={controlBoot.token} version={version} onUnlocked={unlock}/> : <StartupScreen ready={ready} error={startupError}/>}</UiLocaleProvider></AppTheme>;
}

const root=document.getElementById('root');
if(root)createRoot(root).render(<Root/>);
