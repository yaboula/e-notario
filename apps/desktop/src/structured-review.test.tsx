// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AppTheme} from '@notario/ui';
import type {ApprovedIdentitySummary,Capture,CaptureApi,CaseDraft,DocumentExtraction,DocumentSummary,TemplateSummary} from '@notario/api-client';
import {DocumentCenter,DocumentModeCard,FullCaseCenter,StructuredDataReview} from './main';

const keys=['national_id','given_names_ar','given_names_latin','surname_ar','surname_latin','birth_date','birth_place_ar','birth_place_latin','expiry_date','sex','filiation_ar','filiation_latin','address_ar','address_latin'];
const extraction:DocumentExtraction={document_id:'11111111-1111-1111-1111-111111111111',revision:1,status:'review_required',approved_at:null,approved_by:null,engine:{template:'CNIE_MA_2020',version:'1.2.0'},warnings:[],reviews:{},fields:Object.fromEntries(keys.map((key,index)=>[key,{key,normalized_value:key.endsWith('_ar')?'اختبار':key==='birth_date'?'1990-01-01':key==='expiry_date'?'2030-01-01':key==='sex'?'F':'TEST',confidence:.96,required:true,source_side:index<10?'front':'back',warnings:[]}]))};
const document:DocumentSummary={id:extraction.document_id,created_at:new Date().toISOString(),source:'mobile',card_model:'CNIE_MA_2020',front_capture_id:null,back_capture_id:null,status:'data_review_required',extraction_summary:{status:'review_required',template:'CNIE_MA_2020',revision:1,field_count:14,reviewed_count:0,warning_count:0,latency_ms:2,error_code:null,approved_at:null,approved_by:null}};

afterEach(()=>cleanup());

describe('StructuredDataReview',()=>{
  it('uses the full-width 14-field workspace without the legacy evidence panel',async()=>{
    const api={extraction:vi.fn().mockResolvedValue(extraction)} as unknown as CaptureApi;
    const queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}});
    render(<AppTheme><QueryClientProvider client={queryClient}><StructuredDataReview api={api} document={document} captures={[]} onChanged={()=>{}}/></QueryClientProvider></AppTheme>);
    await screen.findByRole('textbox',{name:/Numéro national \(CIN\)/});
    expect(screen.getAllByRole('textbox')).toHaveLength(13);
    expect(screen.getByRole('combobox',{name:/^Sexe/})).toBeTruthy();
    expect(screen.queryByText('PREUVE SÉLECTIONNÉE')).toBeNull();
    expect(screen.getAllByRole('button',{name:'Confirmer la catégorie'})).toHaveLength(4);
    expect(screen.queryByRole('button',{name:'Confirmer'})).toBeNull();
    expect(screen.getByRole('button',{name:'Tout accepter et approuver'}).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button',{name:'Voir le recto'})).toBeTruthy();
    expect(screen.getByRole('button',{name:'Voir le verso'})).toBeTruthy();
    await waitFor(()=>expect(document.extraction_summary.field_count).toBe(14));
  });

  it('reloads a mobile confirmation when the shared revision changes',async()=>{
    const confirmed:DocumentExtraction={...extraction,revision:2,reviews:{national_id:{decision:'confirmed',value:'TEST',reviewed_by:'mobile',reviewed_at:new Date().toISOString()}}};
    const api={extraction:vi.fn().mockResolvedValueOnce(extraction).mockResolvedValue(confirmed)} as unknown as CaptureApi;
    const queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const view=(item:DocumentSummary)=><AppTheme><QueryClientProvider client={queryClient}><StructuredDataReview api={api} document={item} captures={[]} onChanged={()=>{}}/></QueryClientProvider></AppTheme>;
    const rendered=render(view(document));
    await screen.findByRole('textbox',{name:/Numéro national \(CIN\)/});
    const changed={...document,extraction_summary:{...document.extraction_summary,revision:2,reviewed_count:1}};
    rendered.rerender(view(changed));
    await waitFor(()=>expect(api.extraction).toHaveBeenCalledTimes(2));
    await waitFor(()=>expect(screen.getAllByText('Confirmé').length).toBeGreaterThan(0));
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
    await screen.findByRole('textbox',{name:/Numéro national \(CIN\)/});
    fireEvent.click(screen.getByRole('button',{name:'Voir le recto'}));
    await waitFor(()=>expect(image).toHaveBeenCalledTimes(1));
    rendered.rerender(tree({...withFront,extraction_summary:{...withFront.extraction_summary,reviewed_count:1}}));
    await waitFor(()=>expect(screen.getByRole('img',{name:'CNIE · Recto'})).toBeTruthy());
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
    await screen.findByRole('textbox',{name:/Numéro national \(CIN\)/});
    fireEvent.click(screen.getAllByRole('button',{name:'Confirmer la catégorie'})[0]);
    await waitFor(()=>expect(reviewExtraction).toHaveBeenCalledTimes(1));
    expect(Object.keys(reviewExtraction.mock.calls[0][2])).toEqual(identityKeys);
    fireEvent.click(screen.getByRole('button',{name:'Tout accepter et approuver'}));
    await waitFor(()=>expect(approveExtraction).toHaveBeenCalledWith(document.id,3));
    expect(Object.keys(reviewExtraction.mock.calls[1][2])).toHaveLength(14);
  });
});

describe('DocumentCenter',()=>{
  it('offers partial fill while keeping full fill inaccessible',()=>{
    const onSelect=vi.fn();
    render(<AppTheme><DocumentModeCard mode={null} onSelect={onSelect}/></AppTheme>);
    const partial=screen.getByRole('button',{name:/Remplissage partiel/});
    const full=screen.getByRole('button',{name:/Remplissage complet/});
    expect(partial.hasAttribute('disabled')).toBe(false);
    expect(full.hasAttribute('disabled')).toBe(false);
    fireEvent.click(partial);
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.click(full);
    expect(onSelect).toHaveBeenLastCalledWith('complete');
  });
  it('creates a version-pinned marriage request from approved identities',async()=>{
    const template:TemplateSummary={schema_version:'enotario.document-template/v1',id:'ma.marriage',version:'1.1.0',slug:'matrimonio',title_es:'Acta de matrimonio',title_fr:'Acte de mariage',title_ar:'زواج',description_es:'Piloto',description_fr:'Modèle pilote',language:'ar-MA',roles:[{key:'husband',label_es:'Esposo',label_fr:'Époux',label_ar:'الزوج',minimum:1,maximum:1,repeatable:false},{key:'wife',label_es:'Esposa',label_fr:'Épouse',label_ar:'الزوجة',minimum:1,maximum:1,repeatable:false},{key:'wife_father',label_es:'Padre de la esposa',label_fr:'Père de l’épouse',label_ar:'والد الزوجة',minimum:1,maximum:1,repeatable:false}]};
    const identities:ApprovedIdentitySummary[]=[1,2,3].map(index=>({id:`00000000-0000-0000-0000-00000000000${index}`,document_id:`doc-${index}`,revision:1,source:'desktop',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),images_released:true,display_name_ar:`شخص ${index}`,display_name_latin:`PERSON ${index}`,national_id:`AA00000${index}`}));
    const createDocumentRequest=vi.fn().mockResolvedValue({});
    const api={templates:vi.fn().mockResolvedValue([template]),createDocumentRequest} as unknown as CaptureApi;
    const queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}});
    render(<AppTheme><QueryClientProvider client={queryClient}><DocumentCenter api={api} identities={identities} requests={[]} onChanged={()=>{}} active/></QueryClientProvider></AppTheme>);
    const husband=await screen.findByRole('combobox',{name:/Époux/});
    const wife=await screen.findByRole('combobox',{name:/Épouse/});
    const wifeFather=await screen.findByRole('combobox',{name:/Père de l’épouse/});
    fireEvent.change(husband,{target:{value:identities[0].id}});
    fireEvent.change(wife,{target:{value:identities[1].id}});
    fireEvent.change(wifeFather,{target:{value:identities[2].id}});
    fireEvent.click(screen.getByRole('button',{name:'Envoyer à la file'}));
    await waitFor(()=>expect(createDocumentRequest).toHaveBeenCalledWith('ma.marriage','1.1.0',{husband:[identities[0].id],wife:[identities[1].id],wife_father:[identities[2].id]},expect.any(String)));
  });
});

describe('FullCaseCenter',()=>{
  it('creates an encrypted complete case from a v2 template and exposes legal fields',async()=>{
    const template:TemplateSummary={schema_version:'enotario.document-template/v2',id:'ma.marriage',version:'1.6.0',slug:'matrimonio',title_es:'Acta de matrimonio',title_fr:'Acte de mariage',title_ar:'زواج',description_es:'Piloto',description_fr:'Acte complet',language:'ar-MA',roles:[{key:'husband',label_es:'Esposo',label_fr:'Époux',label_ar:'الزوج',minimum:1,maximum:1,repeatable:false}],fields:[{key:'registry_date',label_fr:"Date d’enregistrement",label_ar:'تاريخ التسجيل',type:'date',required:true,direction:'ltr',repeatable:false,maximum_items:1,maximum_characters:10}]};
    const created:CaseDraft={id:'10000000-0000-0000-0000-000000000001',template_id:template.id,template_version:template.version,mode:'complete',status:'editing',revision:0,source:'desktop',field_count:0,assignment_count:0,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),fields:{},assignments:{}};
    const createCase=vi.fn().mockResolvedValue(created);
    const acquireCaseFieldLease=vi.fn().mockResolvedValue({case_id:created.id,field_key:'registry_date',actor_label:'Poste Windows',expires_at:Date.now()/1000+45,lease_token:'lease-token-long-enough-for-test',owned_by_me:true});
    const patchCaseField=vi.fn().mockImplementation(async(_id:string,_key:string,value:string)=>({...created,revision:1,fields:{registry_date:value},field_lease:{case_id:created.id,field_key:'registry_date',actor_label:'Poste Windows',expires_at:Date.now()/1000+45,lease_token:'lease-token-long-enough-for-test'}}));
    const api={templates:vi.fn().mockResolvedValue([template]),professionalProfiles:vi.fn().mockResolvedValue([]),createCase,case:vi.fn().mockResolvedValue(created),subscribe:vi.fn().mockReturnValue(()=>{}),caseFieldLeases:vi.fn().mockResolvedValue([]),acquireCaseFieldLease,patchCaseField,releaseCaseFieldLease:vi.fn().mockResolvedValue({status:'released'})} as unknown as CaptureApi;
    const queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}});
    render(<AppTheme><QueryClientProvider client={queryClient}><FullCaseCenter api={api} identities={[]} cases={[]} onChanged={()=>{}} active/></QueryClientProvider></AppTheme>);
    await screen.findByText('Acte complet');
    fireEvent.click(screen.getByRole('button',{name:'Créer un dossier temporaire'}));
    await waitFor(()=>expect(createCase).toHaveBeenCalledWith('ma.marriage','1.6.0','complete'));
    const date=await screen.findByLabelText(/Date d’enregistrement/);
    fireEvent.focus(date);
    await waitFor(()=>expect(acquireCaseFieldLease).toHaveBeenCalled());
    fireEvent.change(date,{target:{value:'2026-09-16'}});
    fireEvent.blur(date);
    await waitFor(()=>expect(patchCaseField).toHaveBeenCalledWith(created.id,'registry_date','2026-09-16','lease-token-long-enough-for-test',expect.any(String)));
    expect(screen.getByText('Brouillons chiffrés · conservation maximale 24 h · génération dans Windows')).toBeTruthy();
  });
});
