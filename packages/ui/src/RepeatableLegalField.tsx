import {useId, type FocusEvent} from 'react';
import type {ApprovedIdentitySummary, TemplateFieldDefinition} from '@notario/api-client';
import {useUiLocale} from './locale';

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
  const {locale}=useUiLocale();
  const text=locale==='ar'?{relation:'صلة الإرث',recommended:'موصى به؛ لا يمنع المتابعة',hint:'إدخال واحد لكل وارث وبنفس الترتيب. أمثلة: ابن، بنت، زوجة، أخ.',assign:'عيّن الأشخاص أولاً لإكمال هذا الحقل.',unavailable:'الهوية غير متاحة',heir:'الوارث ',placeholder:'مثال: ابن، بنت، زوجة…'}:
    {relation:'Lien avec le défunt',recommended:'Recommandé, sans blocage',hint:'Une entrée par héritier, dans le même ordre. Exemples : fils, fille, épouse, frère.',assign:'Attribuez d’abord les personnes pour compléter ce champ.',unavailable:'Identité indisponible',heir:'Héritier ',placeholder:'Ex. : fils, fille, épouse…'};
  const isHeirRelation = field.key === 'heir_relation';
  const count = field.role ? Math.min(field.maximum_items, identityIds.length) : field.maximum_items;
  const crossesBoundary = (event: FocusEvent<HTMLElement>) => !event.currentTarget.contains(event.relatedTarget as Node | null);
  return <fieldset className="repeatable-legal-field" disabled={disabled} title={title}
    onFocusCapture={event => {if (crossesBoundary(event)) onFocus?.()}}
    onBlurCapture={event => {if (crossesBoundary(event)) onBlur?.()}}>
    <legend>{isHeirRelation ? text.relation : locale==='ar'?field.label_ar:field.label_fr}
      {field.required ? <span title={text.recommended}> · {text.recommended}</span> : ''}</legend>
    <small lang="ar" dir="rtl">{field.label_ar}</small>
    {isHeirRelation && <p className="role-picker-hint">{text.hint}</p>}
    {!count && <p>{text.assign}</p>}
    {Array.from({length: count}, (_, index) => {
      const identity = identities.find(item => item.id === identityIds[index]);
      const person = field.role ? identity ? `${identity.display_name_latin || identity.display_name_ar} · ${identity.national_id}` : text.unavailable : '';
      return <div className="case-linked-field" key={field.role ? identityIds[index] : index}>
        <label htmlFor={`${id}-${index}`}><span dir="auto">{isHeirRelation ? text.heir : ''}{index + 1}{person ? ` · ${person}` : ''}</span></label>
        <input id={`${id}-${index}`} aria-label={`${field.label_fr} ${index + 1}${person ? `: ${person}` : ''}`}
          dir={field.direction} value={value[index] || ''} maxLength={field.maximum_characters}
          placeholder={isHeirRelation ? text.placeholder : undefined}
          onChange={event => {
            const next = Array.from({length: count}, (_, item) => value[item] || '');
            next[index] = event.target.value;
            onChange(next);
          }}/>
      </div>;
    })}
  </fieldset>;
}
