// @vitest-environment jsdom
import {useState} from 'react';
import {cleanup, fireEvent, render, screen, within} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {RoleIdentityPicker} from '@notario/ui';
import type {ApprovedIdentitySummary, TemplateRole} from '@notario/api-client';

afterEach(cleanup);
const role: TemplateRole = {key:'heir',label_es:'Heredero',label_fr:'Héritier',label_ar:'وارث',minimum:1,maximum:12,repeatable:true};
const identities: ApprovedIdentitySummary[] = Array.from({length:13},(_,index)=>({
  id:`identity-${index+1}`,document_id:`document-${index+1}`,revision:1,source:'desktop',
  created_at:'2026-09-16T12:00:00Z',expires_at:'2026-09-17T12:00:00Z',
  display_name_latin:index===0?'YAHYÁ ABOULAFIYA':`Person ${index+1}`,
  display_name_ar:index===0?'يَحْيَى أبو العافية':'',national_id:`TEST${index+1}`,images_released:true,
}));
function Fixture({initial=[]}:{initial?:string[]}) {
  const [value,setValue]=useState(initial);
  return <><RoleIdentityPicker role={role} identities={identities} value={value} onChange={setValue}/>
    <output data-testid="selection">{value.join(',')}</output></>;
}

describe('professional role identity picker',()=>{
  it('does not preselect an identity and shows the requirement',()=>{
    render(<Fixture/>);
    expect(screen.getByRole('group',{name:'Heredero'})).toBeTruthy();
    expect(within(screen.getByRole('group',{name:'Heredero'})).getByRole('status').textContent).toContain('0/12 seleccionados · Mínimo: 1');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getAllByRole('checkbox').every(input=>!(input as HTMLInputElement).checked)).toBe(true);
  });

  it('preserves selection order instead of catalog order and removes only the chosen person',()=>{
    render(<Fixture/>);
    fireEvent.click(screen.getByRole('checkbox',{name:'Person 3 · TEST3'}));
    fireEvent.click(screen.getByRole('checkbox',{name:'YAHYÁ ABOULAFIYA · TEST1'}));
    expect(screen.getByTestId('selection').textContent).toBe('identity-3,identity-1');
    expect(screen.getAllByRole('listitem').map(item=>item.textContent)).toEqual([
      'Person 3 · TEST3Quitar','YAHYÁ ABOULAFIYA · TEST1Quitar']);
    fireEvent.click(screen.getByRole('button',{name:'Quitar: Person 3 · TEST3'}));
    expect(screen.getByTestId('selection').textContent).toBe('identity-1');
  });

  it('caps selection at twelve while keeping deselection available',()=>{
    render(<Fixture initial={identities.slice(0,12).map(identity=>identity.id)}/>);
    const extra=screen.getByRole('checkbox',{name:'Person 13 · TEST13'}) as HTMLInputElement;
    expect(extra.disabled).toBe(true);
    fireEvent.click(extra);
    expect(screen.getByTestId('selection').textContent?.split(',')).toHaveLength(12);
    fireEvent.click(screen.getByRole('checkbox',{name:'Person 12 · TEST12'}));
    expect(extra.disabled).toBe(false);
    fireEvent.click(extra);
    expect(screen.getByTestId('selection').textContent?.split(',')).toHaveLength(12);
    expect(screen.getByTestId('selection').textContent).toContain('identity-13');
  });

  it('searches Latin accents, Arabic diacritics and card numbers without changing the selection',()=>{
    render(<Fixture initial={['identity-3']}/>);
    const search=screen.getByRole('searchbox',{name:'Buscar identidad'});
    for(const query of ['yahya','يحيى','TEST1']) {
      fireEvent.change(search,{target:{value:query}});
      expect(screen.getByRole('checkbox',{name:'YAHYÁ ABOULAFIYA · TEST1'})).toBeTruthy();
      expect(screen.getByTestId('selection').textContent).toBe('identity-3');
    }
    fireEvent.change(search,{target:{value:'absent'}});
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText('Sin resultados para esta búsqueda.')).toBeTruthy();
  });

  it('allows removing an unavailable selection without revealing technical identifiers',()=>{
    const changed=vi.fn();
    render(<RoleIdentityPicker role={role} identities={[]} value={['private-owner-reference']} onChange={changed}/>);
    expect(screen.getByText('No hay identidades aprobadas disponibles.')).toBeTruthy();
    expect(screen.queryByText('private-owner-reference')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Quitar: Identidad no disponible'}));
    expect(changed).toHaveBeenCalledWith([]);
  });

  it('retains a lease while focus moves inside and releases when it leaves',()=>{
    const focus=vi.fn(),blur=vi.fn();
    render(<><RoleIdentityPicker role={role} identities={identities} value={['identity-1']}
      onChange={()=>{}} onFocus={focus} onBlur={blur}/><button>Outside</button></>);
    const search=screen.getByRole('searchbox'),checkbox=screen.getByRole('checkbox',{name:'Person 2 · TEST2'});
    search.focus();
    checkbox.focus();
    screen.getByRole('button',{name:'Quitar: YAHYÁ ABOULAFIYA · TEST1'}).focus();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(blur).not.toHaveBeenCalled();
    screen.getByRole('button',{name:'Outside'}).focus();
    expect(blur).toHaveBeenCalledTimes(1);
  });

  it('disables all controls for a foreign lease and renders French labels',()=>{
    render(<RoleIdentityPicker role={role} identities={identities} value={['identity-1']} onChange={()=>{}}
      locale="fr" disabled title="Modification en cours : Poste Windows"/>);
    const group=screen.getByRole('group',{name:'Héritier'}) as HTMLFieldSetElement;
    expect(group.disabled).toBe(true);
    for(const element of group.querySelectorAll('input,button,select')) expect(element.matches(':disabled')).toBe(true);
    expect(screen.getByRole('searchbox',{name:'Rechercher une identité'})).toBeTruthy();
  });

  it('retains a normal labelled selector for single-person roles',()=>{
    const changed=vi.fn();
    render(<RoleIdentityPicker role={{...role,repeatable:false,maximum:1}} identities={identities}
      value={[]} onChange={changed}/>);
    fireEvent.change(screen.getByRole('combobox',{name:'Heredero'}),{target:{value:'identity-2'}});
    expect(changed).toHaveBeenCalledWith(['identity-2']);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
