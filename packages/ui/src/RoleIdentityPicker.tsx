import {useId, useState, type FocusEvent} from 'react';
import type {ApprovedIdentitySummary, TemplateRole} from '@notario/api-client';

interface Props {
  role: TemplateRole;
  identities: ApprovedIdentitySummary[];
  value: string[];
  onChange: (value: string[]) => void;
  locale?: 'es' | 'fr';
  disabled?: boolean;
  title?: string;
  onFocus?: () => void;
  onBlur?: () => void;
}

const messages = {
  es: {unassigned: 'Sin asignar', search: 'Buscar identidad', empty: 'No hay identidades aprobadas disponibles.',
    noMatches: 'Sin resultados para esta búsqueda.', selected: 'seleccionados', minimum: 'Mínimo', maximum: 'Máximo',
    remove: 'Quitar', unavailable: 'Identidad no disponible', fallback: 'Identidad aprobada',
    hint: 'Selecciona las personas en el orden en que aparecerán en el documento.'},
  fr: {unassigned: 'Non attribué', search: 'Rechercher une identité', empty: 'Aucune identité approuvée disponible.',
    noMatches: 'Aucun résultat pour cette recherche.', selected: 'sélectionnés', minimum: 'Minimum', maximum: 'Maximum',
    remove: 'Retirer', unavailable: 'Identité indisponible', fallback: 'Identité approuvée',
    hint: 'Sélectionnez les personnes dans leur ordre d’apparition dans le document.'},
};

function searchable(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim();
}

/** Keeps selection order explicit; moving focus inside the picker retains its field lease. */
export function RoleIdentityPicker({role, identities, value, onChange, locale = 'es', disabled,
  title, onFocus, onBlur}: Props) {
  const id = useId();
  const [search, setSearch] = useState('');
  const text = messages[locale];
  const label = locale === 'fr' ? role.label_fr || role.label_es : role.label_es;
  const name = (identity: ApprovedIdentitySummary) => identity.display_name_latin || identity.display_name_ar || text.fallback;
  const description = (identity: ApprovedIdentitySummary) => `${name(identity)} · ${identity.national_id}`;
  const index = new Map(identities.map(identity => [identity.id, identity]));
  const missing = value.filter(key => !index.has(key));
  const needle = searchable(search);
  const filtered = identities.filter(identity => searchable(`${identity.display_name_latin} ${identity.display_name_ar} ${identity.national_id}`).includes(needle));
  const crossesBoundary = (event: FocusEvent<HTMLElement>) => !event.currentTarget.contains(event.relatedTarget as Node | null);
  const remove = (key: string) => onChange(value.filter(item => item !== key));

  return <fieldset className="document-field role-identity-picker" disabled={disabled} title={title}
    onFocusCapture={event => {if (crossesBoundary(event)) onFocus?.()}}
    onBlurCapture={event => {if (crossesBoundary(event)) onBlur?.()}}>
    <legend>{label}</legend>
    {!role.repeatable ? <>
      <small id={`${id}-capacity`}>{role.minimum}–{role.maximum}</small>
      <select aria-label={label} aria-describedby={`${id}-capacity`} value={value[0] || ''}
        onChange={event => onChange(event.target.value ? [event.target.value] : [])}>
        <option value="">{text.unassigned}</option>
        {missing.map(key => <option key={key} value={key}>{text.unavailable}</option>)}
        {identities.map(identity => <option key={identity.id} value={identity.id}>{description(identity)}</option>)}
      </select>
      {!identities.length && <p className="role-picker-empty">{text.empty}</p>}
    </> : <>
      <small id={`${id}-capacity`} role="status">{value.length}/{role.maximum} {text.selected} · {text.minimum}: {role.minimum}</small>
      <p id={`${id}-hint`} className="role-picker-hint">{text.hint}</p>
      {value.length > 0 && <ol className="role-picker-selected" aria-label={label}>
        {value.map(key => <li key={key}><span dir="auto">{index.has(key) ? description(index.get(key)!) : text.unavailable}</span>
          <button type="button" aria-label={`${text.remove}: ${index.has(key) ? description(index.get(key)!) : text.unavailable}`}
            onClick={() => remove(key)}>{text.remove}</button></li>)}
      </ol>}
      {identities.length > 0 && <>
        <label className="role-picker-search" htmlFor={`${id}-search`}>{text.search}
          <input id={`${id}-search`} type="search" value={search} autoComplete="off"
            onChange={event => setSearch(event.target.value)}/>
        </label>
        <div className="role-picker-options" aria-describedby={`${id}-capacity ${id}-hint`}>
          {filtered.map(identity => <label key={identity.id} className="role-picker-option">
            <input type="checkbox" checked={value.includes(identity.id)}
              disabled={!value.includes(identity.id) && value.length >= role.maximum}
              onChange={event => {
                if (event.target.checked) {
                  if (!value.includes(identity.id) && value.length < role.maximum) onChange([...value, identity.id]);
                } else remove(identity.id);
              }}/>
            <span dir="auto">{description(identity)}</span>
          </label>)}
          {!filtered.length && <p className="role-picker-empty">{text.noMatches}</p>}
        </div>
      </>}
      {!identities.length && <p className="role-picker-empty">{text.empty}</p>}
      {value.length >= role.maximum && <small>{text.maximum}: {role.maximum}</small>}
    </>}
  </fieldset>;
}
