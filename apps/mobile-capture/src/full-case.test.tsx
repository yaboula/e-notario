// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AppTheme} from '@notario/ui';
import {ApiError,CaptureApi,type CaseDraft,type CaseFieldLease,type TemplateSummary,type Workspace} from '@notario/api-client';
import {App,MobileFullCasePreparation} from './main';

const template:TemplateSummary={schema_version:'enotario.document-template/v2',id:'ma.marriage',version:'1.6.0',slug:'matrimonio',
  title_es:'Acta de matrimonio',title_ar:'زواج',description_es:'Prueba sintética',language:'ar-MA',roles:[],
  fields:[{key:'registry_number',label_fr:'Registre',label_ar:'السجل',type:'text',required:false,direction:'ltr',repeatable:false,maximum_items:1,maximum_characters:30}]};
const first:CaseDraft={id:'10000000-0000-4000-8000-000000000001',template_id:template.id,template_version:template.version,
  mode:'complete',status:'editing',revision:0,source:'mobile',field_count:1,assignment_count:0,
  created_at:new Date().toISOString(),updated_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),fields:{registry_number:'FIRST'},assignments:{}};
const second:CaseDraft={...first,id:'10000000-0000-4000-8000-000000000002',fields:{registry_number:'SECOND'}};
function fixture(items:CaseDraft[]=[first,second],catalog:TemplateSummary[]=[template]) {
  const records=new Map([first,second,...items].map(item=>[item.id,item]));
  const workspace:Workspace={approved_identities:[],document_generation_requests:[],case_drafts:items,documents:[],captures:[],connected_devices:1,processing:false,mobile_url:null,lan_mode:null,retention_minutes:1440};
  const api={templates:vi.fn().mockResolvedValue(catalog),workspace:vi.fn().mockResolvedValue(workspace),professionalProfiles:vi.fn().mockResolvedValue([]),
    case:vi.fn().mockImplementation(async(id:string)=>records.get(id)),caseFieldLeases:vi.fn().mockResolvedValue([]),subscribe:vi.fn().mockReturnValue(()=>{}),
    createCase:vi.fn().mockResolvedValue(first),
    acquireCaseFieldLease:vi.fn().mockImplementation(async(id:string,key:string)=>({case_id:id,field_key:key,actor_label:'QA sintética',expires_at:Date.now()/1000+45,lease_token:'synthetic-lease-token',owned_by_me:true})),
    releaseCaseFieldLease:vi.fn().mockResolvedValue({status:'released'}),
    patchCaseField:vi.fn().mockImplementation(async(id:string,key:string,value:string)=>{const next={...records.get(id)!,revision:1,fields:{[key]:value}};records.set(id,next);return next}),
    beginCaseFinalReview:vi.fn().mockImplementation(async(id:string)=>({...records.get(id)!,status:'final_review',revision:2}))} as unknown as CaptureApi;
  const onClose=vi.fn();
  const view=(open=true)=><AppTheme><MobileFullCasePreparation api={api} open={open} onClose={onClose}/></AppTheme>;
  const rendered=render(view());
  return {api,onClose,rendered,view};
}
afterEach(()=>{cleanup();vi.restoreAllMocks();sessionStorage.clear()});
describe('Mobile full case recovery and safe transitions',()=>{
  it('saves pending values before selecting a different owned case',async()=>{
    const {api}=fixture();
    const field=await screen.findByLabelText(/Registre/);
    fireEvent.change(field,{target:{value:'UPDATED'}});
    fireEvent.change(screen.getByLabelText('Abrir un expediente'),{target:{value:second.id}});
    await waitFor(()=>expect((screen.getByLabelText(/Registre/) as HTMLInputElement).value).toBe('SECOND'));
    expect(api.patchCaseField).toHaveBeenCalledWith(first.id,'registry_number','UPDATED','synthetic-lease-token',expect.any(String));
    expect(api.releaseCaseFieldLease).toHaveBeenCalledWith(first.id,'registry_number','synthetic-lease-token');
  });
  it('keeps the current case and its unsaved value if saving fails during selection',async()=>{
    const {api}=fixture();
    vi.mocked(api.patchCaseField).mockRejectedValue(new ApiError(503,'TEMPORARY_STORAGE_WRITE_FAILED'));
    fireEvent.change(await screen.findByLabelText(/Registre/),{target:{value:'UNSAVED'}});
    fireEvent.change(screen.getByLabelText('Abrir un expediente'),{target:{value:second.id}});
    await screen.findByText(/No se pudo proteger y guardar/i);
    expect((screen.getByLabelText(/Registre/) as HTMLInputElement).value).toBe('UNSAVED');
    expect((screen.getByLabelText('Abrir un expediente') as HTMLSelectElement).value).toBe(first.id);
    expect(screen.getByRole('alert').className).not.toContain('MuiAlert-colorSuccess');
  });
  it('reuses a stable creation key after a lost response',async()=>{
    const {api}=fixture([]);
    vi.mocked(api.createCase).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(first);
    const create=await screen.findByRole('button',{name:'Crear expediente'});
    fireEvent.click(create);
    await waitFor(()=>expect(create.hasAttribute('disabled')).toBe(false));
    fireEvent.click(create);
    await screen.findByLabelText(/Registre/);
    expect(vi.mocked(api.createCase).mock.calls[0][3]).toBe(vi.mocked(api.createCase).mock.calls[1][3]);
    expect(vi.mocked(api.createCase).mock.calls[0][3]).toEqual(expect.any(String));
  });
  it('releases a delayed focus-only lease before closing',async()=>{
    const {api,onClose}=fixture([first]);
    let finish!:(value:CaseFieldLease)=>void;
    vi.mocked(api.acquireCaseFieldLease).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));
    fireEvent.focus(await screen.findByLabelText(/Registre/));
    fireEvent.click(screen.getByRole('button',{name:'Volver'}));
    expect(onClose).not.toHaveBeenCalled();
    await act(async()=>finish({case_id:first.id,field_key:'registry_number',actor_label:'QA',expires_at:Date.now()/1000+45,lease_token:'delayed-token',owned_by_me:true}));
    await waitFor(()=>expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.releaseCaseFieldLease).toHaveBeenCalledWith(first.id,'registry_number','delayed-token');
  });
  it('shows final-review status and prevents further editing after sending to Windows',async()=>{
    const {api}=fixture([first]);
    fireEvent.click(await screen.findByRole('button',{name:'Enviar a revisión en Windows'}));
    await screen.findByText(/El expediente está bloqueado/);
    expect(api.beginCaseFinalReview).toHaveBeenCalledWith(first.id,0);
    expect((screen.getByLabelText(/Registre/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole('button',{name:'Guardar borrador'}).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Expediente enviado a revisión final en Windows.').closest('[role="alert"]')?.className).toContain('MuiAlert-colorSuccess');
  });

  it('warns about an incomplete historical role without blocking final review',async()=>{
    const {api}=fixture([first],[{...template,roles:[{key:'husband',label_es:'Esposo',label_ar:'الزوج',minimum:1,maximum:1,repeatable:false}]}]);
    await screen.findByText(/Antes de enviar a Windows, completa/);
    const send=screen.getByRole('button',{name:'Enviar a revisión en Windows'});
    expect(send.hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button',{name:'Guardar borrador'}).hasAttribute('disabled')).toBe(false);
    fireEvent.click(send);
    await waitFor(()=>expect(api.beginCaseFinalReview).toHaveBeenCalled());
  });
  it('does not reopen a deleted draft when the screen opens again',async()=>{
    const {api,rendered,view}=fixture([first]);
    await screen.findByLabelText(/Registre/);
    rendered.rerender(view(false));
    const workspace=await api.workspace();
    vi.mocked(api.workspace).mockResolvedValue({...workspace,case_drafts:[]});
    rendered.rerender(view(true));
    await screen.findByRole('button',{name:'Crear expediente'});
    expect(screen.queryByLabelText(/Registre/)).toBeNull();
  });

  it('offers recovery from the main screen even when no approved identity remains',async()=>{
    sessionStorage.setItem('notario.mobile.token','synthetic-session-token');
    vi.spyOn(CaptureApi.prototype,'health').mockResolvedValue({status:'ok',version:'0.8.0-alpha.2',api_version:2});
    vi.spyOn(CaptureApi.prototype,'workspace').mockResolvedValue({approved_identities:[],document_generation_requests:[],case_drafts:[first],documents:[],captures:[],connected_devices:1,processing:false,mobile_url:null,lan_mode:null,retention_minutes:1440});
    vi.spyOn(CaptureApi.prototype,'templates').mockResolvedValue([template]);
    vi.spyOn(CaptureApi.prototype,'professionalProfiles').mockResolvedValue([]);
    vi.spyOn(CaptureApi.prototype,'case').mockResolvedValue(first);
    vi.spyOn(CaptureApi.prototype,'caseFieldLeases').mockResolvedValue([]);
    vi.spyOn(CaptureApi.prototype,'subscribe').mockReturnValue(()=>{});
    render(<AppTheme><App/></AppTheme>);
    fireEvent.click(await screen.findByRole('button',{name:'Abrir mis expedientes'}));
    expect(await screen.findByLabelText(/Registre/)).toBeTruthy();
    expect(screen.queryByRole('button',{name:'Abrir cámara'})).toBeNull();
  });
});
