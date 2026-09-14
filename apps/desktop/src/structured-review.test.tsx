// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AppTheme} from '@notario/ui';
import type {Capture,CaptureApi,DocumentExtraction,DocumentSummary} from '@notario/api-client';
import {StructuredDataReview} from './main';

const keys=['national_id','given_names_ar','given_names_latin','surname_ar','surname_latin','birth_date','birth_place_ar','birth_place_latin','expiry_date','sex','filiation_ar','filiation_latin','address_ar','address_latin'];
const extraction:DocumentExtraction={document_id:'11111111-1111-1111-1111-111111111111',revision:1,status:'review_required',approved_at:null,approved_by:null,engine:{template:'CNIE_MA_2020',version:'1.2.0'},warnings:[],reviews:{},fields:Object.fromEntries(keys.map((key,index)=>[key,{key,normalized_value:key.endsWith('_ar')?'اختبار':key==='birth_date'?'1990-01-01':key==='expiry_date'?'2030-01-01':key==='sex'?'F':'TEST',confidence:.96,required:true,source_side:index<10?'front':'back',warnings:[]}]))};
const document:DocumentSummary={id:extraction.document_id,created_at:new Date().toISOString(),source:'mobile',front_capture_id:null,back_capture_id:null,status:'data_review_required',extraction_summary:{status:'review_required',template:'CNIE_MA_2020',revision:1,field_count:14,reviewed_count:0,warning_count:0,latency_ms:2,error_code:null,approved_at:null,approved_by:null}};

afterEach(()=>cleanup());

describe('StructuredDataReview',()=>{
  it('uses the full-width 14-field workspace without the legacy evidence panel',async()=>{
    const api={extraction:vi.fn().mockResolvedValue(extraction)} as unknown as CaptureApi;
    const queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}});
    render(<AppTheme><QueryClientProvider client={queryClient}><StructuredDataReview api={api} document={document} captures={[]} onChanged={()=>{}}/></QueryClientProvider></AppTheme>);
    await screen.findByRole('textbox',{name:/Número nacional \(CIN\)/});
    expect(screen.getAllByRole('textbox')).toHaveLength(13);
    expect(screen.getByRole('combobox',{name:/^Sexo/})).toBeTruthy();
    expect(screen.queryByText('EVIDENCIA SELECCIONADA')).toBeNull();
    expect(screen.getAllByRole('button',{name:'Confirmar categoría'})).toHaveLength(4);
    expect(screen.queryByRole('button',{name:'Confirmar'})).toBeNull();
    expect(screen.getByRole('button',{name:'Aceptar todo y aprobar'}).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button',{name:'Ver anverso'})).toBeTruthy();
    expect(screen.getByRole('button',{name:'Ver reverso'})).toBeTruthy();
    await waitFor(()=>expect(document.extraction_summary.field_count).toBe(14));
  });

  it('reloads a mobile confirmation when the shared revision changes',async()=>{
    const confirmed:DocumentExtraction={...extraction,revision:2,reviews:{national_id:{decision:'confirmed',value:'TEST',reviewed_by:'mobile',reviewed_at:new Date().toISOString()}}};
    const api={extraction:vi.fn().mockResolvedValueOnce(extraction).mockResolvedValue(confirmed)} as unknown as CaptureApi;
    const queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const view=(item:DocumentSummary)=><AppTheme><QueryClientProvider client={queryClient}><StructuredDataReview api={api} document={item} captures={[]} onChanged={()=>{}}/></QueryClientProvider></AppTheme>;
    const rendered=render(view(document));
    await screen.findByRole('textbox',{name:/Número nacional \(CIN\)/});
    const changed={...document,extraction_summary:{...document.extraction_summary,revision:2,reviewed_count:1}};
    rendered.rerender(view(changed));
    await waitFor(()=>expect(api.extraction).toHaveBeenCalledTimes(2));
    await waitFor(()=>expect(screen.getAllByText('Confirmado').length).toBeGreaterThan(0));
  });

  it('keeps the document image loaded across parent refreshes',async()=>{
    const image=vi.fn().mockResolvedValue(new Blob(['rectified'],{type:'image/jpeg'}));
    const api={extraction:vi.fn().mockResolvedValue(extraction),image} as unknown as CaptureApi;
    const queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const withFront={...document,front_capture_id:'front-capture'};
    const captures=[{id:'front-capture',ocr_summary:{status:'success'}} as Capture];
    const tree=(item:DocumentSummary)=><AppTheme><QueryClientProvider client={queryClient}><StructuredDataReview api={api} document={item} captures={captures} onChanged={()=>{}}/></QueryClientProvider></AppTheme>;
    const createObjectUrl=vi.fn().mockReturnValue('blob:rectified');
    const revokeObjectUrl=vi.fn();
    Object.defineProperty(URL,'createObjectURL',{configurable:true,value:createObjectUrl});
    Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:revokeObjectUrl});
    const rendered=render(tree(withFront));
    await screen.findByRole('textbox',{name:/Número nacional \(CIN\)/});
    fireEvent.click(screen.getByRole('button',{name:'Ver anverso'}));
    await waitFor(()=>expect(image).toHaveBeenCalledTimes(1));
    rendered.rerender(tree({...withFront,extraction_summary:{...withFront.extraction_summary,reviewed_count:1}}));
    await waitFor(()=>expect(screen.getByRole('img',{name:'CNIE · Anverso'})).toBeTruthy());
    expect(image).toHaveBeenCalledTimes(1);
  });

  it('confirms a whole category and can approve all fields in one action',async()=>{
    const allReviews=Object.fromEntries(keys.map(key=>[key,{decision:'confirmed' as const,value:extraction.fields[key].normalized_value,reviewed_by:'desktop',reviewed_at:new Date().toISOString()}]));
    const identityKeys=keys.slice(0,5);
    const identityReviewed={...extraction,revision:2,reviews:Object.fromEntries(identityKeys.map(key=>[key,allReviews[key]]))};
    const fullyReviewed={...extraction,revision:3,reviews:allReviews};
    const approved={...fullyReviewed,revision:4,status:'approved' as const,approved_by:'desktop',approved_at:new Date().toISOString()};
    const reviewExtraction=vi.fn().mockResolvedValueOnce(identityReviewed).mockResolvedValueOnce(fullyReviewed);
    const approveExtraction=vi.fn().mockResolvedValue(approved);
    const api={extraction:vi.fn().mockResolvedValue(extraction),reviewExtraction,approveExtraction} as unknown as CaptureApi;
    const queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}});
    render(<AppTheme><QueryClientProvider client={queryClient}><StructuredDataReview api={api} document={document} captures={[]} onChanged={()=>{}}/></QueryClientProvider></AppTheme>);
    await screen.findByRole('textbox',{name:/Número nacional \(CIN\)/});
    fireEvent.click(screen.getAllByRole('button',{name:'Confirmar categoría'})[0]);
    await waitFor(()=>expect(reviewExtraction).toHaveBeenCalledTimes(1));
    expect(Object.keys(reviewExtraction.mock.calls[0][2])).toEqual(identityKeys);
    fireEvent.click(screen.getByRole('button',{name:'Aceptar todo y aprobar'}));
    await waitFor(()=>expect(approveExtraction).toHaveBeenCalledWith(document.id,3));
    expect(Object.keys(reviewExtraction.mock.calls[1][2])).toHaveLength(14);
  });
});
