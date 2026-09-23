import {useEffect, useState, type FocusEvent} from 'react';
import type {ProfessionalProfile} from '@notario/api-client';
import {useUiLocale} from './locale';

interface Props {
  profiles: ProfessionalProfile[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  title?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  maximumCharacters?: number;
}

const DIRECT = '__direct__';

export function ProfessionalProfileField({profiles, value, onChange, disabled, title,
  onFocus, onBlur, maximumCharacters = 160}: Props) {
  const {locale}=useUiLocale();
  const text=locale==='ar'?{source:'مصدر الملف المهني',select:'اختر ملفاً متكرراً',inactive:'غير نشط — استبدله',direct:'الكتابة مباشرة',name:'الاسم المهني لهذه الوثيقة',placeholder:'اكتب الاسم كما يجب أن يظهر بالعربية'}:
    {source:'Origine du profil professionnel',select:'Sélectionner un profil fréquent',inactive:'inactif — à remplacer',direct:'Saisir directement',name:'Nom professionnel pour ce document',placeholder:'Saisissez le nom tel qu’il doit apparaître en arabe'};
  const known = profiles.some(profile => profile.id === value);
  const [direct, setDirect] = useState(Boolean(value) && !known);
  useEffect(() => {if (value && known) setDirect(false)}, [known, value]);
  const crossesBoundary = (event: FocusEvent<HTMLElement>) =>
    !event.currentTarget.contains(event.relatedTarget as Node | null);

  return <fieldset className="professional-profile-field" disabled={disabled} title={title}
    onFocusCapture={event => {if (crossesBoundary(event)) onFocus?.()}}
    onBlurCapture={event => {if (crossesBoundary(event)) onBlur?.()}}>
    <select aria-label={text.source} value={direct ? DIRECT : value}
      onChange={event => {
        if (event.target.value === DIRECT) {setDirect(true); onChange('')}
        else {setDirect(false); onChange(event.target.value)}
      }}>
      <option value="">{text.select}</option>
      {profiles.map(profile => <option key={profile.id} value={profile.id}>
        {profile.display_name_fr ? `${profile.display_name_fr} · ${profile.display_name_ar}` : profile.display_name_ar}
        {profile.active ? '' : ` · ${text.inactive}`}
      </option>)}
      <option value={DIRECT}>{text.direct}</option>
    </select>
    {direct && <input aria-label={text.name} dir="rtl"
      autoFocus value={known ? '' : value} maxLength={maximumCharacters}
      placeholder={text.placeholder}
      onChange={event => onChange(event.target.value)}/>}
  </fieldset>;
}
