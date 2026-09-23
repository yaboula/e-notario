// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {ProfessionalProfile} from '@notario/api-client';
import {ProfessionalProfileManager} from './ProfessionalProfileManager';

afterEach(cleanup);

const profile:ProfessionalProfile={
  id:'profile-1',display_name_ar:'العدل الأول',display_name_fr:'Premier adoul',function_fr:'Adoul',
  active:true,revision:3,created_at:'2026-09-16T10:00:00Z',updated_at:'2026-09-16T10:00:00Z',
  in_use:false,usage_count:0,
};

function openManager(){fireEvent.click(screen.getByText('Profils professionnels'))}

describe('professional profile manager',()=>{
  it('creates a profile only after an Arabic name is supplied',async()=>{
    const create=vi.fn().mockResolvedValue(undefined);
    render(<ProfessionalProfileManager profiles={[]} onCreate={create} onUpdate={vi.fn()} onDelete={vi.fn()}/>);
    openManager();
    const submit=screen.getByRole('button',{name:'Ajouter un profil'});
    expect(submit).toHaveProperty('disabled',true);
    fireEvent.change(screen.getByLabelText(/Nom en arabe/),{target:{value:'عدل جديد'}});
    fireEvent.change(screen.getByLabelText('Nom en français'),{target:{value:'Nouvel adoul'}});
    fireEvent.click(submit);
    await waitFor(()=>expect(create).toHaveBeenCalledWith({
      display_name_ar:'عدل جديد',display_name_fr:'Nouvel adoul',function_fr:'',
    }));
  });

  it('edits names without losing the profile identity or revision',async()=>{
    const update=vi.fn().mockResolvedValue(undefined);
    render(<ProfessionalProfileManager profiles={[profile]} onCreate={vi.fn()} onUpdate={update} onDelete={vi.fn()}/>);
    openManager();
    fireEvent.click(screen.getByRole('button',{name:'Modifier'}));
    fireEvent.change(screen.getByLabelText('Nom en français'),{target:{value:'Nom corrigé'}});
    fireEvent.click(screen.getByRole('button',{name:'Enregistrer les modifications'}));
    await waitFor(()=>expect(update).toHaveBeenCalledWith({...profile,display_name_fr:'Nom corrigé'}));
  });

  it('prevents destructive actions while an active case uses the profile',()=>{
    const used={...profile,in_use:true,usage_count:2};
    render(<ProfessionalProfileManager profiles={[used]} onCreate={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()}/>);
    openManager();
    expect(screen.getByText(/utilisé par 2 dossiers conservés/)).toBeTruthy();
    expect(screen.getByRole('button',{name:'Désactiver'})).toHaveProperty('disabled',true);
    expect(screen.getByRole('button',{name:/Supprimer/})).toHaveProperty('disabled',true);
  });

  it('only enables permanent deletion for an unused inactive profile',async()=>{
    const remove=vi.fn().mockResolvedValue(undefined);
    const inactive={...profile,active:false};
    render(<ProfessionalProfileManager profiles={[inactive]} onCreate={vi.fn()} onUpdate={vi.fn()} onDelete={remove}/>);
    openManager();
    const button=screen.getByRole('button',{name:/Supprimer/});
    expect(button).toHaveProperty('disabled',false);
    fireEvent.click(button);
    await waitFor(()=>expect(remove).toHaveBeenCalledWith(inactive));
  });
});
