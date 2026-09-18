// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {AppTheme} from '@notario/ui';
import type {CaptureApi,DocumentGenerationRequest,TemplateSummary} from '@notario/api-client';
import {DocumentCenter} from './main';
import type {DocumentSaveReceipt} from './native-document-saves';

const native=vi.hoisted(()=>({invoke:vi.fn(),save:vi.fn(),receipts:vi.fn(),acknowledge:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke}));
const template:TemplateSummary={schema_version:'enotario.document-template/v2',id:'ma.inheritance',
  version:'1.4.0',slug:'herencia',title_es:'Acta de herencia',title_ar:'إراثة',
  description_es:'Piloto',language:'ar-MA',roles:[]};
const item:DocumentGenerationRequest={id:'10000000-0000-0000-0000-000000000001',revision:4,
  template_id:template.id,template_version:template.version,assignments:{},warnings:[],
  source:'desktop',created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
const receipt:DocumentSaveReceipt={id:'20000000-0000-0000-0000-000000000002',case_id:item.id,
  kind:'document_request',revision:4,path:'C:\\Documents\\herencia-20260916-120000.docx',
  created_at:Date.now()/1000,expires_at:Date.now()/1000+86400,confirmed:true};

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

async function fixture({requests=[item]}:{requests?:DocumentGenerationRequest[]}={}){
  const generateDocument=vi.fn().mockResolvedValue({name:'herencia-20260916-120000.docx',revision:4,
    blob:{arrayBuffer:async()=>new Uint8Array([80,75,3,4]).buffer}});
  const completeDocumentRequest=vi.fn().mockResolvedValue({status:'deleted',reason:'saved'});
  const deleteDocumentRequest=vi.fn();
  const onChanged=vi.fn(),onNavigationBlockedChange=vi.fn();
  const api={templates:vi.fn().mockResolvedValue([template]),generateDocument,
    completeDocumentRequest,deleteDocumentRequest} as unknown as CaptureApi;
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<AppTheme><QueryClientProvider client={client}><DocumentCenter api={api} identities={[]}
    requests={requests} onChanged={onChanged} onNavigationBlockedChange={onNavigationBlockedChange}/>
  </QueryClientProvider></AppTheme>);
  if(requests.length){
    await screen.findByText('Acta de herencia');
    await waitFor(()=>expect(screen.getByRole('button',{name:'Guardar y abrir en Word'}).hasAttribute('disabled')).toBe(false));
  }
  return {generateDocument,completeDocumentRequest,deleteDocumentRequest,onChanged,onNavigationBlockedChange};
}

describe('partial Word protected saving',()=>{
  it('keeps the request when native saving is cancelled',async()=>{
    native.save.mockResolvedValue({saved:false,path:null,opened:false,receipt_id:null});
    const {completeDocumentRequest,deleteDocumentRequest}=await fixture();
    fireEvent.click(screen.getByRole('button',{name:'Guardar y abrir en Word'}));
    await screen.findByText('Guardado cancelado. La solicitud permanece en la bandeja.');
    expect(completeDocumentRequest).not.toHaveBeenCalled();
    expect(deleteDocumentRequest).not.toHaveBeenCalled();
    expect(native.acknowledge).not.toHaveBeenCalled();
  });

  it('retires exactly the generated revision only after saving and then acknowledges the receipt',async()=>{
    native.save.mockResolvedValue({saved:true,path:receipt.path,opened:true,receipt_id:receipt.id});
    const {generateDocument,completeDocumentRequest,deleteDocumentRequest,onChanged}=await fixture();
    fireEvent.click(screen.getByRole('button',{name:'Guardar y abrir en Word'}));
    await screen.findByText('Documento guardado y abierto en Word.');
    expect(generateDocument).toHaveBeenCalledWith(item.id,4);
    expect(native.invoke).toHaveBeenCalledWith('save_docx',{name:'herencia-20260916-120000.docx',
      bytes:[80,75,3,4],caseContext:{id:item.id,revision:4,kind:'document_request'}});
    expect(completeDocumentRequest).toHaveBeenCalledWith(item.id,4,receipt.id);
    expect(deleteDocumentRequest).not.toHaveBeenCalled();
    expect(native.acknowledge).toHaveBeenCalledWith(receipt.id);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('offers Explorer when the associated application cannot open the saved Word',async()=>{
    native.save.mockResolvedValue({saved:true,path:receipt.path,opened:false,receipt_id:receipt.id});
    await fixture();
    fireEvent.click(screen.getByRole('button',{name:'Guardar y abrir en Word'}));
    await screen.findByText('El documento se guardó, pero Windows no pudo abrir la aplicación asociada.');
    fireEvent.click(screen.getByRole('button',{name:'Mostrar en el Explorador'}));
    await waitFor(()=>expect(native.invoke).toHaveBeenLastCalledWith('reveal_file',{path:receipt.path}));
  });

  it('retries server closure with the same persisted key without generating or saving twice',async()=>{
    native.save.mockResolvedValue({saved:true,path:receipt.path,opened:true,receipt_id:receipt.id});
    const {generateDocument,completeDocumentRequest,onNavigationBlockedChange}=await fixture();
    completeDocumentRequest.mockRejectedValueOnce(new TypeError('response lost'));
    fireEvent.click(screen.getByRole('button',{name:'Guardar y abrir en Word'}));
    const retry=await screen.findByRole('button',{name:'Retirar solicitud guardada'});
    expect(screen.getByRole('button',{name:'Guardar y abrir en Word'}).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button',{name:'Revisar asignaciones'}).hasAttribute('disabled')).toBe(true);
    await waitFor(()=>expect(onNavigationBlockedChange).toHaveBeenLastCalledWith(true));
    const unload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    fireEvent.click(retry);
    await screen.findByText('Documento guardado y solicitud retirada.');
    expect(completeDocumentRequest.mock.calls).toEqual([[item.id,4,receipt.id],[item.id,4,receipt.id]]);
    expect(generateDocument).toHaveBeenCalledTimes(1);
    expect(native.save).toHaveBeenCalledTimes(1);
    await waitFor(()=>expect(onNavigationBlockedChange).toHaveBeenLastCalledWith(false));
  });

  it('recovers after restart even when the live inbox is empty',async()=>{
    native.receipts.mockResolvedValue([receipt]);
    const {generateDocument,completeDocumentRequest}=await fixture({requests:[]});
    fireEvent.click(await screen.findByRole('button',{name:'Recuperar guardado'}));
    fireEvent.click(await screen.findByRole('button',{name:'Retirar solicitud guardada'}));
    await screen.findByText('Documento guardado y solicitud retirada.');
    expect(completeDocumentRequest).toHaveBeenCalledWith(item.id,4,receipt.id);
    expect(native.acknowledge).toHaveBeenCalledWith(receipt.id);
    expect(generateDocument).not.toHaveBeenCalled();
    expect(native.save).not.toHaveBeenCalled();
  });

  it('never recovers an unconfirmed file or a receipt from the complete-case domain',async()=>{
    native.receipts.mockResolvedValue([{...receipt,confirmed:false},{...receipt,id:'case-receipt',kind:'case'}]);
    const {completeDocumentRequest}=await fixture({requests:[]});
    const recover=await screen.findByRole('button',{name:'Recuperar guardado'});
    expect(recover.hasAttribute('disabled')).toBe(true);
    expect(screen.getAllByRole('button',{name:'Recuperar guardado'})).toHaveLength(1);
    expect(completeDocumentRequest).not.toHaveBeenCalled();
  });

  it('keeps a stale receipt and the independent file when the request revision changed',async()=>{
    native.receipts.mockResolvedValue([receipt]);
    const {completeDocumentRequest}=await fixture({requests:[]});
    completeDocumentRequest.mockRejectedValue(new Error('DOCUMENT_REQUEST_STALE_REVISION'));
    fireEvent.click(await screen.findByRole('button',{name:'Recuperar guardado'}));
    fireEvent.click(await screen.findByRole('button',{name:'Retirar solicitud guardada'}));
    await screen.findByText(/El archivo permanece guardado/);
    expect(native.acknowledge).not.toHaveBeenCalled();
    expect(screen.getByRole('button',{name:'Retirar solicitud guardada'}).hasAttribute('disabled')).toBe(false);
  });

  it('requires successful protected-catalog verification before enabling generation',async()=>{
    native.receipts.mockRejectedValueOnce(new Error('DPAPI failure'));
    // Do not wait for the generation button to enable in this fixture.
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const generateDocument=vi.fn();
    const api={templates:vi.fn().mockResolvedValue([template]),generateDocument} as unknown as CaptureApi;
    render(<AppTheme><QueryClientProvider client={client}><DocumentCenter api={api} identities={[]}
      requests={[item]} onChanged={()=>{}}/></QueryClientProvider></AppTheme>);
    await screen.findByText('La generación está bloqueada hasta verificar los recibos de guardado.');
    expect(screen.getByRole('button',{name:'Guardar y abrir en Word'}).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Reintentar verificación'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Guardar y abrir en Word'}).hasAttribute('disabled')).toBe(false));
    expect(generateDocument).not.toHaveBeenCalled();
  });
});
