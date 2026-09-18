import {useId, type FocusEvent} from 'react';
import type {ApprovedIdentitySummary, TemplateFieldDefinition} from '@notario/api-client';

interface Props {
  field: TemplateFieldDefinition;
  value: string[];
  identityIds?: string[];
  identities: ApprovedIdentitySummary[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  title?: string;
  onFocus?: () => void;
  onBlur?: () => void;
}

export function RepeatableLegalField({field, value, identityIds = [], identities, onChange,
  disabled, title, onFocus, onBlur}: Props) {
  const id = useId();
  const isHeirRelation = field.key === 'heir_relation';
  const count = field.role ? Math.min(field.maximum_items, identityIds.length) : field.maximum_items;
  const crossesBoundary = (event: FocusEvent<HTMLElement>) => !event.currentTarget.contains(event.relatedTarget as Node | null);
  return <fieldset className="repeatable-legal-field" disabled={disabled} title={title}
    onFocusCapture={event => {if (crossesBoundary(event)) onFocus?.()}}
    onBlurCapture={event => {if (crossesBoundary(event)) onBlur?.()}}>
    <legend>{isHeirRelation ? 'Relación con el causante' : field.label_fr}
      {field.required ? <span title="Recomendado; no bloquea"> · recomendado</span> : ''}</legend>
    <small lang="ar" dir="rtl">{field.label_ar}</small>
    {isHeirRelation && <p className="role-picker-hint">Una entrada por heredero y en el mismo orden. Ejemplos: ابن، بنت، زوجة، أخ.</p>}
    {!count && <p>Asigna primero las personas para completar este campo.</p>}
    {Array.from({length: count}, (_, index) => {
      const identity = identities.find(item => item.id === identityIds[index]);
      const person = field.role ? identity ? `${identity.display_name_latin || identity.display_name_ar} · ${identity.national_id}` : 'Identidad no disponible' : '';
      return <div className="case-linked-field" key={field.role ? identityIds[index] : index}>
        <label htmlFor={`${id}-${index}`}><span dir="auto">{isHeirRelation ? 'Heredero ' : ''}{index + 1}{person ? ` · ${person}` : ''}</span></label>
        <input id={`${id}-${index}`} aria-label={`${field.label_fr} ${index + 1}${person ? `: ${person}` : ''}`}
          dir={field.direction} value={value[index] || ''} maxLength={field.maximum_characters}
          placeholder={isHeirRelation ? 'Ej.: ابن، بنت، زوجة…' : undefined}
          onChange={event => {
            const next = Array.from({length: count}, (_, item) => value[item] || '');
            next[index] = event.target.value;
            onChange(next);
          }}/>
      </div>;
    })}
  </fieldset>;
}
