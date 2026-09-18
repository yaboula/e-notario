import {useState, type FormEvent} from 'react';
import type {ProfessionalProfile} from '@notario/api-client';
import {Button, IconButton, Trash2} from '@notario/ui';

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
    <summary><span>Perfiles profesionales</span><small>{activeCount} activo{activeCount===1?'':'s'} · {profiles.length} en total</small></summary>
    <div className="profile-manager-body">
      <p>Los nombres en árabe se insertan en el documento Word. Los perfiles permanecen en este puesto y no contienen datos de ninguna CNIE.</p>
      <form onSubmit={submit} className="profile-editor">
        <div className="case-field-grid">
          <label className="document-field"><span>Nombre en árabe <b aria-label="obligatorio">*</b></span><input dir="rtl" required maxLength={160} value={form.display_name_ar} onChange={event=>setForm(current=>({...current,display_name_ar:event.target.value}))}/></label>
          <label className="document-field"><span>Nombre en francés</span><input maxLength={160} value={form.display_name_fr} onChange={event=>setForm(current=>({...current,display_name_fr:event.target.value}))}/></label>
          <label className="document-field"><span>Función</span><input maxLength={160} value={form.function_fr} onChange={event=>setForm(current=>({...current,function_fr:event.target.value}))}/></label>
        </div>
        <div className="heading-actions"><Button type="submit" size="small" variant="contained" disabled={locked||!form.display_name_ar.trim()}>{editingId?'Guardar cambios':'Añadir perfil'}</Button>{editingId&&<Button type="button" size="small" disabled={locked} onClick={cancelEdit}>Cancelar</Button>}</div>
      </form>
      <div className="profile-list" aria-label="Perfiles profesionales guardados">
        {!profiles.length&&<div className="queue-empty">No hay perfiles guardados.</div>}
        {profiles.map(profile=><div className={`profile-list-item ${profile.active?'':'inactive'}`} key={profile.id}>
          <div><strong dir="rtl">{profile.display_name_ar}</strong><span>{profile.display_name_fr||'Sin nombre en francés'}{profile.function_fr?` · ${profile.function_fr}`:''}</span><small>{profile.active?'Activo':'Inactivo'}{profile.in_use?` · utilizado por ${profile.usage_count} expediente${profile.usage_count===1?'':'s'} conservado${profile.usage_count===1?'':'s'}`:''}</small></div>
          <div>
            <Button size="small" disabled={locked} onClick={()=>beginEdit(profile)}>Editar</Button>
            <Button size="small" disabled={locked||(profile.active&&profile.in_use)} title={profile.active&&profile.in_use?'Perfil utilizado por un expediente conservado':undefined} onClick={()=>void updateStatus(profile)}>{profile.active?'Desactivar':'Reactivar'}</Button>
            <IconButton size="small" aria-label={`Eliminar ${profile.display_name_fr||profile.display_name_ar}`} disabled={locked||profile.active||profile.in_use} title={profile.active?'Desactiva primero el perfil':profile.in_use?'Perfil utilizado por un expediente conservado':undefined} onClick={()=>void remove(profile)}><Trash2 size={14}/></IconButton>
          </div>
        </div>)}
      </div>
    </div>
  </details>;
}
