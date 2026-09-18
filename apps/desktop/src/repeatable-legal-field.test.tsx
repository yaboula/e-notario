// @vitest-environment jsdom
import {useState} from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {RepeatableLegalField} from '@notario/ui';
import type {ApprovedIdentitySummary,TemplateFieldDefinition} from '@notario/api-client';

afterEach(cleanup);
const field:TemplateFieldDefinition={key:'heir_relation',label_fr:'Lien successoral',label_ar:'صلة الإرث',
  type:'arabic_text',required:false,direction:'rtl',repeatable:true,maximum_items:12,maximum_characters:160,role:'heir'};
const identities:ApprovedIdentitySummary[]=[
  {id:'person-a',document_id:'document-a',revision:1,source:'desktop',created_at:'2026-09-16T12:00:00Z',
    expires_at:'2026-09-17T12:00:00Z',display_name_latin:'PERSON A',display_name_ar:'الشخص أ',national_id:'TESTA',images_released:true},
  {id:'person-b',document_id:'document-b',revision:1,source:'desktop',created_at:'2026-09-16T12:00:00Z',
    expires_at:'2026-09-17T12:00:00Z',display_name_latin:'PERSON B',display_name_ar:'الشخص ب',national_id:'TESTB',images_released:true},
];

function Fixture({initial=[]}:{initial?:string[]}) {
  const [value,setValue]=useState(initial);
  return <><RepeatableLegalField field={field} identities={identities} identityIds={['person-a','person-b']}
    value={value} onChange={setValue}/><output data-testid="values">{JSON.stringify(value)}</output></>;
}

describe('identity-linked repeatable legal field',()=>{
  it('does not render orphan inputs before people are assigned',()=>{
    render(<RepeatableLegalField field={field} identities={identities} identityIds={[]} value={[]} onChange={()=>{}}/>);
    expect(screen.getByRole('group',{name:'Relación con el causante'})).toBeTruthy();
    expect(screen.getByText('Asigna primero las personas para completar este campo.')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('labels each value with its person and preserves empty preceding positions',()=>{
    render(<Fixture/>);
    const second=screen.getByRole('textbox',{name:'Lien successoral 2: PERSON B · TESTB'});
    fireEvent.change(second,{target:{value:'بنت'}});
    expect(screen.getByTestId('values').textContent).toBe('["","بنت"]');
    expect(screen.getByText('Heredero 1 · PERSON A · TESTA')).toBeTruthy();
    expect(screen.getByText('Heredero 2 · PERSON B · TESTB')).toBeTruthy();
  });

  it('does not expose a missing identity identifier and keeps the slot editable',()=>{
    render(<RepeatableLegalField field={field} identities={[]} identityIds={['private-identity-reference']}
      value={['ابن']} onChange={()=>{}}/>);
    expect(screen.queryByText('private-identity-reference')).toBeNull();
    expect(screen.getByRole('textbox',{name:'Lien successoral 1: Identidad no disponible'})).toHaveProperty('value','ابن');
  });

  it('keeps one collaboration lease while focus moves between people',()=>{
    const focus=vi.fn(),blur=vi.fn();
    render(<><RepeatableLegalField field={field} identities={identities} identityIds={['person-a','person-b']}
      value={['','']} onChange={()=>{}} onFocus={focus} onBlur={blur}/><button>Outside</button></>);
    screen.getByRole('textbox',{name:/Lien successoral 1/}).focus();
    screen.getByRole('textbox',{name:/Lien successoral 2/}).focus();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(blur).not.toHaveBeenCalled();
    screen.getByRole('button',{name:'Outside'}).focus();
    expect(blur).toHaveBeenCalledTimes(1);
  });

  it('disables the entire group when another device owns its lease',()=>{
    render(<RepeatableLegalField field={field} identities={identities} identityIds={['person-a']}
      value={['']} onChange={()=>{}} disabled title="Modification en cours : Mobile"/>);
    const group=screen.getByRole('group',{name:'Relación con el causante'}) as HTMLFieldSetElement;
    expect(group.disabled).toBe(true);
    expect(screen.getByRole('textbox').matches(':disabled')).toBe(true);
  });
});
