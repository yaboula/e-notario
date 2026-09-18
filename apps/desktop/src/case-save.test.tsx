// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {AppTheme} from '@notario/ui';
import type {CaptureApi,CaseDraft,TemplateSummary} from '@notario/api-client';
import {FullCaseCenter} from './main';

const native=vi.hoisted(()=>({invoke:vi.fn(),save:vi.fn(),receipts:vi.fn(),acknowledge:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>native);

const template:TemplateSummary={schema_version:'enotario.document-template/v2',
  id:'ma.marriage',version:'1.6.0',slug:'matrimonio',title_es:'Matrimonio',
  title_fr:'Acte de mariage',title_ar:'زواج',description_es:'Piloto',language:'ar-MA',
  roles:[],fields:[]};
const draft:CaseDraft={id:'10000000-0000-0000-0000-000000000001',
  template_id:template.id,template_version:template.version,mode:'complete',
  status:'final_review',revision:3,source:'desktop',field_count:0,assignment_count:0,
  created_at:new Date().toISOString(),updated_at:new Date().toISOString(),
  expires_at:new Date(Date.now()+86400000).toISOString(),fields:{},assignments:{}};
const savedPath='C:\\Documents\\matrimonio-20260916-120000.docx';

beforeEach(()=>{
  native.invoke.mockReset();native.save.mockReset();native.receipts.mockReset();native.acknowledge.mockReset();
  native.receipts.mockResolvedValue([]);native.acknowledge.mockResolvedValue(undefined);
  native.invoke.mockImplementation((command:string,args?:{id:string})=>{
    if(command==='pending_case_save_receipts')return native.receipts();
    if(command==='save_docx')return native.save();
    if(command==='acknowledge_case_save_receipt')return native.acknowledge(args?.id);
    return Promise.resolve(undefined);
  });
  Object.defineProperty(window,'__TAURI_INTERNALS__',{configurable:true,value:{}});
});
afterEach(()=>{cleanup();delete (window as unknown as Record<string,unknown>).__TAURI_INTERNALS__});

async function openFixture({open=true,item=draft}:{open?:boolean;item?:CaseDraft}={}){
  const generateCase=vi.fn().mockResolvedValue({revision:3,name:'matrimonio-20260916-120000.docx',
    blob:{arrayBuffer:async()=>new Uint8Array([80,75,3,4]).buffer}});
  const completeCase=vi.fn().mockResolvedValue({...draft,status:'completed',revision:4});
  const caseFn=vi.fn().mockResolvedValue(item);
  const onNavigationBlockedChange=vi.fn();
  const api={templates:vi.fn().mockResolvedValue([template]),
    professionalProfiles:vi.fn().mockResolvedValue([]),case:caseFn,
    subscribe:vi.fn().mockReturnValue(()=>{}),caseFieldLeases:vi.fn().mockResolvedValue([]),
    caseReadiness:vi.fn().mockResolvedValue({missing_fields:[]}),generateCase,completeCase} as unknown as CaptureApi;
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<AppTheme><QueryClientProvider client={client}><FullCaseCenter api={api}
    identities={[]} cases={[draft]} onChanged={()=>{}} onNavigationBlockedChange={onNavigationBlockedChange} active/></QueryClientProvider></AppTheme>);
  await screen.findByText('Piloto');
  if(open){
    fireEvent.change(screen.getByRole('combobox',{name:'Abrir un expediente'}),{target:{value:draft.id}});
    await screen.findByRole('button',{name:'Guardar y abrir en Word'});
  }
  return {generateCase,completeCase,caseFn,onNavigationBlockedChange};
}

describe('complete case native saving',()=>{
  it('offers reopening unfinished cases before creating another draft',async()=>{
    await openFixture({open:false});
    expect(screen.getByText(/Hay 1 expediente sin finalizar/)).toBeTruthy();
    expect(screen.getByRole('button',{name:'Crear otro expediente temporal'})).toBeTruthy();
    expect(screen.getByRole('option',{name:/ma.marriage · Revisión final/})).toBeTruthy();
    expect(screen.getByRole('combobox',{name:'Abrir un expediente'})).toHaveProperty('value','');
  });

  it('keeps final review intact when the native save dialog is cancelled',async()=>{
    native.save.mockResolvedValue({saved:false,path:null,opened:false});
    const {completeCase}=await openFixture();
    fireEvent.click(screen.getByRole('button',{name:'Guardar y abrir en Word'}));
    const notice=await screen.findByText('Guardado cancelado. El expediente permanece en revisión final.');
    expect(notice.closest('[role="alert"]')?.className).toContain('MuiAlert-colorInfo');
    expect(completeCase).not.toHaveBeenCalled();
    expect(screen.getByRole('button',{name:'Guardar y abrir en Word'}).hasAttribute('disabled')).toBe(false);
  });

  it('completes the case only after native saving confirms success',async()=>{
    native.save.mockResolvedValue({saved:true,path:savedPath,opened:true,receipt_id:'receipt-1'});
    const {completeCase}=await openFixture();
    fireEvent.click(screen.getByRole('button',{name:'Guardar y abrir en Word'}));
    const notice=await screen.findByText('Documento guardado y abierto en Word.');
    expect(notice.closest('[role="alert"]')?.className).toContain('MuiAlert-colorSuccess');
    expect(native.invoke).toHaveBeenCalledWith('save_docx',{
      name:'matrimonio-20260916-120000.docx',bytes:[80,75,3,4],caseContext:{id:draft.id,revision:3}});
    expect(completeCase).toHaveBeenCalledWith(draft.id,3);
    expect(native.acknowledge).toHaveBeenCalledWith('receipt-1');
    expect(screen.queryByRole('button',{name:'Guardar y abrir en Word'})).toBeNull();
  });

  it('preserves the saved file and offers Explorer when the associated application fails',async()=>{
    native.save.mockResolvedValue({saved:true,path:savedPath,opened:false,receipt_id:'receipt-1'});
    const {completeCase}=await openFixture();
    fireEvent.click(screen.getByRole('button',{name:'Guardar y abrir en Word'}));
    const notice=await screen.findByText('Documento guardado, pero Windows no pudo abrir Word. El archivo sigue disponible.');
    expect(notice.closest('[role="alert"]')?.className).toContain('MuiAlert-colorWarning');
    expect(completeCase).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'Mostrar en el Explorador'}));
    await waitFor(()=>expect(native.invoke).toHaveBeenLastCalledWith('reveal_file',{path:savedPath}));
  });

  it('retries closure without saving twice and prevents switching away while closure is pending',async()=>{
    native.save.mockResolvedValue({saved:true,path:savedPath,opened:true,receipt_id:'receipt-1'});
    const {completeCase,generateCase,onNavigationBlockedChange}=await openFixture();
    completeCase.mockRejectedValueOnce(new TypeError('connection lost'));
    fireEvent.click(screen.getByRole('button',{name:'Guardar y abrir en Word'}));
    const retry=await screen.findByRole('button',{name:'Cerrar expediente guardado'});
    expect(screen.getByRole('combobox',{name:'Abrir un expediente'}).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button',{name:'Guardar y abrir en Word'}).hasAttribute('disabled')).toBe(true);
    await waitFor(()=>expect(onNavigationBlockedChange).toHaveBeenLastCalledWith(true));
    const unload=new Event('beforeunload',{cancelable:true});
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    fireEvent.click(retry);
    await screen.findByText('Documento guardado y expediente cerrado.');
    expect(completeCase).toHaveBeenCalledTimes(2);
    expect(generateCase).toHaveBeenCalledTimes(1);
    expect(native.save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('combobox',{name:'Abrir un expediente'}).hasAttribute('disabled')).toBe(false);
    await waitFor(()=>expect(onNavigationBlockedChange).toHaveBeenLastCalledWith(false));
  });

  it('recovers a protected receipt after restart without generating or saving a document',async()=>{
    native.receipts.mockResolvedValue([{id:'receipt-restarted',case_id:draft.id,revision:3,
      path:savedPath,created_at:Date.now()/1000,expires_at:Date.now()/1000+86400,confirmed:true}]);
    const {completeCase,generateCase}=await openFixture({open:false});
    fireEvent.click(await screen.findByRole('button',{name:'Recuperar expediente'}));
    fireEvent.click(await screen.findByRole('button',{name:'Cerrar expediente guardado'}));
    await screen.findByText('Documento guardado y expediente cerrado.');
    expect(completeCase).toHaveBeenCalledWith(draft.id,3);
    expect(native.acknowledge).toHaveBeenCalledWith('receipt-restarted');
    expect(generateCase).not.toHaveBeenCalled();
    expect(native.save).not.toHaveBeenCalled();
    expect(screen.queryByRole('region',{name:'Guardados recuperables'})).toBeNull();
  });

  it('does not close a case from an unconfirmed receipt',async()=>{
    const receipt={id:'receipt-unconfirmed',case_id:draft.id,revision:3,path:savedPath,
      created_at:Date.now()/1000,expires_at:Date.now()/1000+86400,confirmed:false};
    native.receipts.mockResolvedValue([receipt]);
    const {completeCase}=await openFixture({open:false,item:{...draft,status:'editing',revision:5}});
    const button=await screen.findByRole('button',{name:'Recuperar expediente'});
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(completeCase).not.toHaveBeenCalled();
    expect(native.acknowledge).not.toHaveBeenCalled();
  });

  it('rejects a confirmed receipt from an obsolete case revision without removing it',async()=>{
    native.receipts.mockResolvedValue([{id:'receipt-stale',case_id:draft.id,revision:3,path:savedPath,
      created_at:Date.now()/1000,expires_at:Date.now()/1000+86400,confirmed:true}]);
    const {completeCase}=await openFixture({open:false,item:{...draft,status:'editing',revision:5}});
    fireEvent.click(await screen.findByRole('button',{name:'Recuperar expediente'}));
    await screen.findByText('Este recibo corresponde a una revisión anterior. No se cerró ningún expediente y el archivo guardado permanece independiente.');
    expect(completeCase).not.toHaveBeenCalled();
    expect(native.acknowledge).not.toHaveBeenCalled();
  });

  it('blocks generation until protected receipt verification succeeds',async()=>{
    native.receipts.mockRejectedValueOnce(new Error('DPAPI failure'));
    const {generateCase}=await openFixture();
    const generate=screen.getByRole('button',{name:'Guardar y abrir en Word'});
    await screen.findByText('La generación permanece bloqueada hasta verificar los recibos de guardado.');
    expect(generate.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Reintentar'}));
    await waitFor(()=>expect(generate.hasAttribute('disabled')).toBe(false));
    expect(generateCase).not.toHaveBeenCalled();
  });

  it('does not announce receipt verification failure as a successful save',async()=>{
    native.receipts.mockRejectedValueOnce(new Error('DPAPI failure'));
    await openFixture({open:false});
    const notice=await screen.findByText('No se pudieron verificar los recibos de guardado protegidos. Reintenta antes de generar otro documento.');
    expect(notice.closest('[role="alert"]')?.className).toContain('MuiAlert-colorInfo');
    expect(screen.getByRole('button',{name:'Reintentar'})).toBeTruthy();
  });

  it('retains the receipt when server closure succeeded but local acknowledgement fails',async()=>{
    native.save.mockResolvedValue({saved:true,path:savedPath,opened:true,receipt_id:'receipt-1'});
    native.acknowledge.mockRejectedValueOnce(new Error('protected store temporarily unavailable'));
    const {completeCase}=await openFixture();
    fireEvent.click(screen.getByRole('button',{name:'Guardar y abrir en Word'}));
    fireEvent.click(await screen.findByRole('button',{name:'Cerrar expediente guardado'}));
    await screen.findByText('Documento guardado y expediente cerrado.');
    expect(completeCase).toHaveBeenCalledTimes(2);
    expect(native.acknowledge).toHaveBeenCalledTimes(2);
    expect(native.save).toHaveBeenCalledTimes(1);
  });
});
