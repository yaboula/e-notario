import {useEffect, useState, type FocusEvent} from 'react';
import type {ProfessionalProfile} from '@notario/api-client';

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
  const known = profiles.some(profile => profile.id === value);
  const [direct, setDirect] = useState(Boolean(value) && !known);
  useEffect(() => {if (value && known) setDirect(false)}, [known, value]);
  const crossesBoundary = (event: FocusEvent<HTMLElement>) =>
    !event.currentTarget.contains(event.relatedTarget as Node | null);

  return <fieldset className="professional-profile-field" disabled={disabled} title={title}
    onFocusCapture={event => {if (crossesBoundary(event)) onFocus?.()}}
    onBlurCapture={event => {if (crossesBoundary(event)) onBlur?.()}}>
    <select aria-label="Origen del perfil profesional" value={direct ? DIRECT : value}
      onChange={event => {
        if (event.target.value === DIRECT) {setDirect(true); onChange('')}
        else {setDirect(false); onChange(event.target.value)}
      }}>
      <option value="">Selecciona un perfil frecuente</option>
      {profiles.map(profile => <option key={profile.id} value={profile.id}>
        {profile.display_name_fr ? `${profile.display_name_fr} · ${profile.display_name_ar}` : profile.display_name_ar}
        {profile.active ? '' : ' · inactivo — sustituir'}
      </option>)}
      <option value={DIRECT}>Escribir directamente</option>
    </select>
    {direct && <input aria-label="Nombre profesional para este documento" dir="rtl"
      autoFocus value={known ? '' : value} maxLength={maximumCharacters}
      placeholder="Escribe el nombre tal como debe aparecer en árabe"
      onChange={event => onChange(event.target.value)}/>}
  </fieldset>;
}
