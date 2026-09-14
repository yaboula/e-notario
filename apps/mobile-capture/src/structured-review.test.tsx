// @vitest-environment jsdom
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AppTheme} from '@notario/ui';
import type {CaptureApi,DocumentExtraction,DocumentSummary} from '@notario/api-client';
import {MobileStructuredReview} from './main';

const keys=['national_id','given_names_ar','given_names_latin','surname_ar','surname_latin','birth_date','birth_place_ar','birth_place_latin','expiry_date','sex','filiation_ar','filiation_latin','address_ar','address_latin'];
const extraction:DocumentExtraction={document_id:'22222222-2222-2222-2222-222222222222',revision:1,status:'review_required',approved_at:null,approved_by:null,engine:{template:'CNIE_MA_2020',version:'1.2.0'},warnings:[],reviews:{},fields:Object.fromEntries(keys.map((key,index)=>[key,{key,normalized_value:key.endsWith('_ar')?'اختبار':key==='birth_date'?'1990-01-01':key==='expiry_date'?'2030-01-01':key==='sex'?'F':'TEST',confidence:.95,required:true,source_side:index<10?'front':'back',warnings:[]}]))};
const document:DocumentSummary={id:extraction.document_id,created_at:new Date().toISOString(),source:'mobile',front_capture_id:null,back_capture_id:null,status:'data_review_required',extraction_summary:{status:'review_required',template:'CNIE_MA_2020',revision:1,field_count:14,reviewed_count:0,warning_count:0,latency_ms:2,error_code:null,approved_at:null,approved_by:null}};

afterEach(cleanup);
describe('MobileStructuredReview',()=>{
  for(const width of [360,390,430])it(`renders the secure review flow at ${width}px`,async()=>{
    Object.defineProperty(window,'innerWidth',{configurable:true,value:width});
    const api={extraction:vi.fn().mockResolvedValue(extraction)} as unknown as CaptureApi;
    const {container}=render(<AppTheme><MobileStructuredReview api={api} document={document} captures={[]} onClose={()=>{}}/></AppTheme>);
    await screen.findByLabelText('Número nacional (CIN)');
    expect(container.querySelectorAll('input,textarea')).toHaveLength(13);
    expect(container.querySelectorAll('select')).toHaveLength(1);
    expect(screen.getByText('Comprueba los 14 campos')).toBeTruthy();
    expect(screen.getByRole('button',{name:'Aceptar todo y aprobar'}).hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText('Exportar JSON')).toBeNull();
    expect(screen.queryByText('Texto completo')).toBeNull();
  });

  it('reloads a Windows confirmation when the shared revision changes',async()=>{
    const confirmed:DocumentExtraction={...extraction,revision:2,reviews:{national_id:{decision:'confirmed',value:'TEST',reviewed_by:'desktop',reviewed_at:new Date().toISOString()}}};
    const api={extraction:vi.fn().mockResolvedValueOnce(extraction).mockResolvedValue(confirmed)} as unknown as CaptureApi;
    const view=(item:DocumentSummary)=><AppTheme><MobileStructuredReview api={api} document={item} captures={[]} onClose={()=>{}}/></AppTheme>;
    const rendered=render(view(document));
    await screen.findByLabelText('Número nacional (CIN)');
    const changed={...document,extraction_summary:{...document.extraction_summary,revision:2,reviewed_count:1}};
    rendered.rerender(view(changed));
    await waitFor(()=>expect(api.extraction).toHaveBeenCalledTimes(2));
    await waitFor(()=>expect(screen.getAllByText('Confirmado').length).toBeGreaterThan(0));
  });
});
