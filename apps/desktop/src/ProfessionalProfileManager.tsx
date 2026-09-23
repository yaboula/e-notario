import {useState, type FormEvent} from 'react';
import type {ProfessionalProfile} from '@notario/api-client';
import {Button, IconButton, Trash2, useUiLocale} from '@notario/ui';

export interface ProfessionalProfileForm {
  display_name_ar:string;
  display_name_fr:string;
  function_fr:string;
}

interface Props {
  profiles:ProfessionalProfile[];
  disabled?:boolean;
  onCreate:(form:ProfessionalProfileForm)=>Promise<void>;
  onUpdate:(profile:ProfessionalProfile)=>Promise<void>;
  onDelete:(profile:ProfessionalProfile)=>Promise<void>;
}

const EMPTY:ProfessionalProfileForm={display_name_ar:'',display_name_fr:'',function_fr:''};

export function ProfessionalProfileManager({profiles,disabled=false,onCreate,onUpdate,onDelete}:Props) {
  const {locale}=useUiLocale();
  const t=locale==='ar'?{
    title:'الملفات المهنية',active:'نشط',activePlural:'نشطة',total:'المجموع',intro:'تُدرج الأسماء العربية في مستند Word. تبقى الملفات على هذا الجهاز ولا تحتوي على بيانات أية بطاقة وطنية.',
    arName:'الاسم بالعربية',required:'إلزامي',frName:'الاسم بالفرنسية',role:'الصفة',save:'حفظ التعديلات',add:'إضافة ملف',cancel:'إلغاء',saved:'الملفات المهنية المحفوظة',empty:'لا توجد ملفات محفوظة.',noFr:'لا يوجد اسم بالفرنسية',enabled:'نشط',disabled:'غير نشط',used:'مستخدم في',caseOne:'ملف محفوظ',caseMany:'ملفات محفوظة',edit:'تعديل',deactivate:'تعطيل',reactivate:'إعادة التفعيل',delete:'حذف',usedTitle:'هذا الملف مستخدم في ملف محفوظ',deactivateFirst:'عطّل الملف أولاً'
  }:{
    title:'Profils professionnels',active:'actif',activePlural:'actifs',total:'au total',intro:'Les noms en arabe sont insérés dans le document Word. Les profils restent sur ce poste et ne contiennent aucune donnée de CNIE.',
    arName:'Nom en arabe',required:'obligatoire',frName:'Nom en français',role:'Fonction',save:'Enregistrer les modifications',add:'Ajouter un profil',cancel:'Annuler',saved:'Profils professionnels enregistrés',empty:'Aucun profil enregistré.',noFr:'Sans nom en français',enabled:'Actif',disabled:'Inactif',used:'utilisé par',caseOne:'dossier conservé',caseMany:'dossiers conservés',edit:'Modifier',deactivate:'Désactiver',reactivate:'Réactiver',delete:'Supprimer',usedTitle:'Profil utilisé par un dossier conservé',deactivateFirst:'Désactivez d’abord le profil'
  };
  const [form,setForm]=useState<ProfessionalProfileForm>(EMPTY);
  const [editingId,setEditingId]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const locked=disabled||busy;
  const activeCount=profiles.filter(profile=>profile.active).length;

  function beginEdit(profile:ProfessionalProfile) {
    setEditingId(profile.id);
    setForm({display_name_ar:profile.display_name_ar,display_name_fr:profile.display_name_fr,
      function_fr:profile.function_fr});
  }
  function cancelEdit(){setEditingId(null);setForm(EMPTY)}
  async function submit(event:FormEvent) {
    event.preventDefault();
    if(locked||!form.display_name_ar.trim())return;
    setBusy(true);
    try{
      const current=profiles.find(profile=>profile.id===editingId);
      if(current)await onUpdate({...current,...form});
      else await onCreate(form);
      cancelEdit();
    }catch{/* The parent presents the API error and the form stays available for correction. */}
    finally{setBusy(false)}
  }
  async function updateStatus(profile:ProfessionalProfile) {
    if(locked)return;
    setBusy(true);try{await onUpdate({...profile,active:!profile.active})}catch{/* Parent owns the visible error. */}finally{setBusy(false)}
  }
  async function remove(profile:ProfessionalProfile) {
    if(locked)return;
    setBusy(true);try{await onDelete(profile)}catch{/* Parent owns the visible error. */}finally{setBusy(false)}
  }

  return <details className="professional-profile-manager">
    <summary><span>{t.title}</span><small>{activeCount} {activeCount===1?t.active:t.activePlural} · {profiles.length} {t.total}</small></summary>
    <div className="profile-manager-body">
      <p>{t.intro}</p>
      <form onSubmit={submit} className="profile-editor">
        <div className="case-field-grid">
          <label className="document-field"><span>{t.arName} <b aria-label={t.required}>*</b></span><input dir="rtl" required maxLength={160} value={form.display_name_ar} onChange={event=>setForm(current=>({...current,display_name_ar:event.target.value}))}/></label>
          <label className="document-field"><span>{t.frName}</span><input maxLength={160} value={form.display_name_fr} onChange={event=>setForm(current=>({...current,display_name_fr:event.target.value}))}/></label>
          <label className="document-field"><span>{t.role}</span><input maxLength={160} value={form.function_fr} onChange={event=>setForm(current=>({...current,function_fr:event.target.value}))}/></label>
        </div>
        <div className="heading-actions"><Button type="submit" size="small" variant="contained" disabled={locked||!form.display_name_ar.trim()}>{editingId?t.save:t.add}</Button>{editingId&&<Button type="button" size="small" disabled={locked} onClick={cancelEdit}>{t.cancel}</Button>}</div>
      </form>
      <div className="profile-list" aria-label={t.saved}>
        {!profiles.length&&<div className="queue-empty">{t.empty}</div>}
        {profiles.map(profile=><div className={`profile-list-item ${profile.active?'':'inactive'}`} key={profile.id}>
          <div><strong dir="rtl">{profile.display_name_ar}</strong><span>{profile.display_name_fr||t.noFr}{profile.function_fr?` · ${profile.function_fr}`:''}</span><small>{profile.active?t.enabled:t.disabled}{profile.in_use?` · ${t.used} ${profile.usage_count} ${profile.usage_count===1?t.caseOne:t.caseMany}`:''}</small></div>
          <div>
            <Button size="small" disabled={locked} onClick={()=>beginEdit(profile)}>{t.edit}</Button>
            <Button size="small" disabled={locked||(profile.active&&profile.in_use)} title={profile.active&&profile.in_use?t.usedTitle:undefined} onClick={()=>void updateStatus(profile)}>{profile.active?t.deactivate:t.reactivate}</Button>
            <IconButton size="small" aria-label={`${t.delete} ${profile.display_name_fr||profile.display_name_ar}`} disabled={locked||profile.active||profile.in_use} title={profile.active?t.deactivateFirst:profile.in_use?t.usedTitle:undefined} onClick={()=>void remove(profile)}><Trash2 size={14}/></IconButton>
          </div>
        </div>)}
      </div>
    </div>
  </details>;
}
