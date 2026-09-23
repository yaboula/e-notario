// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AppTheme} from '@notario/ui';
import type {ApprovedIdentitySummary,CaptureApi,CaseDraft,DocumentExtraction,DocumentSummary,TemplateSummary,Workspace} from '@notario/api-client';
import {MobileDocumentPreparation,MobileFullCasePreparation,MobileStructuredReview} from './main';

const keys=['national_id','given_names_ar','given_names_latin','surname_ar','surname_latin','birth_date','birth_place_ar','birth_place_latin','expiry_date','sex','filiation_ar','filiation_latin','address_ar','address_latin'];
const extraction:DocumentExtraction={document_id:'22222222-2222-2222-2222-222222222222',revision:1,status:'review_required',approved_at:null,approved_by:null,engine:{template:'CNIE_MA_2020',version:'1.2.0'},warnings:[],reviews:{},fields:Object.fromEntries(keys.map((key,index)=>[key,{key,normalized_value:key.endsWith('_ar')?'اختبار':key==='birth_date'?'1990-01-01':key==='expiry_date'?'2030-01-01':key==='sex'?'F':'TEST',confidence:.95,required:true,source_side:index<10?'front':'back',warnings:[]}]))};
const document:DocumentSummary={id:extraction.document_id,created_at:new Date().toISOString(),source:'mobile',card_model:'CNIE_MA_2020',front_capture_id:null,back_capture_id:null,status:'data_review_required',extraction_summary:{status:'review_required',template:'CNIE_MA_2020',revision:1,field_count:14,reviewed_count:0,warning_count:0,latency_ms:2,error_code:null,approved_at:null,approved_by:null}};

afterEach(cleanup);
describe('MobileStructuredReview',()=>{
  it('continues from approved data to both Word preparation modes',async()=>{
    const approved:DocumentExtraction={...extraction,status:'approved',approved_at:new Date().toISOString(),approved_by:'mobile'};
    const ready:DocumentSummary={...document,status:'ready',extraction_summary:{...document.extraction_summary,status:'approved'}};
    const workspace={approved_identities:[],document_generation_requests:[],case_drafts:[],documents:[],captures:[],connected_devices:1,processing:false,mobile_url:null,lan_mode:null,retention_minutes:60} satisfies Workspace;
    const api={extraction:vi.fn().mockResolvedValue(approved),templates:vi.fn().mockResolvedValue([]),workspace:vi.fn().mockResolvedValue(workspace)} as unknown as CaptureApi;
    render(<AppTheme><MobileStructuredReview api={api} document={ready} captures={[]} onClose={()=>{}}/></AppTheme>);
    const partial=await screen.findByRole('button',{name:/Remplissage partiel/});
    expect(screen.getByRole('button',{name:/Remplissage complet/}).hasAttribute('disabled')).toBe(false);
    fireEvent.click(partial);
    expect(await screen.findByText('Retour aux données')).toBeTruthy();
    expect(screen.queryByRole('button',{name:/Remplissage complet/})).toBeNull();
    fireEvent.click(screen.getByText('Retour aux données'));
    expect(await screen.findByRole('button',{name:/Remplissage partiel/})).toBeTruthy();
  });
  for(const width of [360,390,430])it(`renders the secure review flow at ${width}px`,async()=>{
    Object.defineProperty(window,'innerWidth',{configurable:true,value:width});
    const api={extraction:vi.fn().mockResolvedValue(extraction)} as unknown as CaptureApi;
    const {container}=render(<AppTheme><MobileStructuredReview api={api} document={document} captures={[]} onClose={()=>{}}/></AppTheme>);
    await screen.findByLabelText('Numéro national (CIN)');
    expect(container.querySelectorAll('input,textarea')).toHaveLength(13);
    expect(container.querySelectorAll('select')).toHaveLength(1);
    expect(screen.getByText('Vérifiez les 14 champs')).toBeTruthy();
    expect(screen.getByRole('button',{name:'Tout accepter et approuver'}).hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText('Exporter JSON')).toBeNull();
    expect(screen.queryByText('Texte complet')).toBeNull();
  });

  it('reloads a Windows confirmation when the shared revision changes',async()=>{
    const confirmed:DocumentExtraction={...extraction,revision:2,reviews:{national_id:{decision:'confirmed',value:'TEST',reviewed_by:'desktop',reviewed_at:new Date().toISOString()}}};
    const api={extraction:vi.fn().mockResolvedValueOnce(extraction).mockResolvedValue(confirmed)} as unknown as CaptureApi;
    const view=(item:DocumentSummary)=><AppTheme><MobileStructuredReview api={api} document={item} captures={[]} onClose={()=>{}}/></AppTheme>;
    const rendered=render(view(document));
    await screen.findByLabelText('Numéro national (CIN)');
    const changed={...document,extraction_summary:{...document.extraction_summary,revision:2,reviewed_count:1}};
    rendered.rerender(view(changed));
    await waitFor(()=>expect(api.extraction).toHaveBeenCalledTimes(2));
    await waitFor(()=>expect(screen.getAllByText('Confirmé').length).toBeGreaterThan(0));
  });
});

describe('MobileFullCasePreparation',()=>{
  it('creates a complete case on the PC and shows the legal fields',async()=>{
    const template:TemplateSummary={schema_version:'enotario.document-template/v2',id:'ma.marriage',version:'1.6.0',slug:'matrimonio',title_es:'Acta de matrimonio',title_fr:'Acte de mariage',title_ar:'زواج',description_es:'Piloto',description_fr:'Acte complet',language:'ar-MA',roles:[],fields:[{key:'registry_date',label_fr:"Date d’enregistrement",label_ar:'تاريخ التسجيل',type:'date',required:true,direction:'ltr',repeatable:false,maximum_items:1,maximum_characters:10}]};
    const created:CaseDraft={id:'10000000-0000-0000-0000-000000000001',template_id:template.id,template_version:template.version,mode:'complete',status:'editing',revision:0,source:'mobile',field_count:0,assignment_count:0,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),fields:{},assignments:{}};
    const workspace={approved_identities:[],document_generation_requests:[],case_drafts:[],documents:[],captures:[],connected_devices:1,processing:false,mobile_url:null,lan_mode:null,retention_minutes:60} satisfies Workspace;
    const createCase=vi.fn().mockResolvedValue(created);
    const api={templates:vi.fn().mockResolvedValue([template]),workspace:vi.fn().mockResolvedValue(workspace),professionalProfiles:vi.fn().mockResolvedValue([]),createCase,case:vi.fn().mockResolvedValue(created),caseFieldLeases:vi.fn().mockResolvedValue([]),subscribe:vi.fn().mockReturnValue(()=>{})} as unknown as CaptureApi;
    render(<AppTheme><MobileFullCasePreparation api={api} open onClose={()=>{}}/></AppTheme>);
    await screen.findByRole('option',{name:/Acte de mariage/});
    expect(screen.getByText(/fichier Word sera généré uniquement dans Windows/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Créer le dossier'}));
    await waitFor(()=>expect(createCase).toHaveBeenCalledWith('ma.marriage','1.6.0','complete',expect.any(String)));
    expect(await screen.findByLabelText(/Date d’enregistrement/)).toBeTruthy();
  });
});

describe('MobileDocumentPreparation',()=>{
  it('does not return to deleted images when using a conserved identity',async()=>{
    const identity:ApprovedIdentitySummary={id:'33333333-3333-3333-3333-333333333333',document_id:document.id,revision:1,source:'mobile',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),images_released:true,display_name_ar:'شخص تجريبي',display_name_latin:'TEST PERSON',national_id:'AA123456'};
    const workspace={approved_identities:[identity],document_generation_requests:[],case_drafts:[],documents:[],captures:[],connected_devices:1,processing:false,mobile_url:null,lan_mode:null,retention_minutes:60} satisfies Workspace;
    const onClose=vi.fn();
    const api={templates:vi.fn().mockResolvedValue([]),workspace:vi.fn().mockResolvedValue(workspace)} as unknown as CaptureApi;
    render(<AppTheme><MobileDocumentPreparation api={api} documentId={document.id} open onClose={onClose}/></AppTheme>);
    const release=await screen.findByRole('button',{name:'Images libérées'});
    expect(release.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Retour à la capture'}));
    expect(onClose).toHaveBeenCalledWith(true);
  });
  it('uses only identities returned by the owner workspace and sends a request to Windows',async()=>{
    const template:TemplateSummary={schema_version:'enotario.document-template/v1',id:'ma.inheritance',version:'1.1.0',slug:'herencia',title_es:'Acta de herencia',title_fr:'Acte d’hérédité',title_ar:'إراثة',description_es:'Piloto',description_fr:'Pilote',language:'ar-MA',roles:[{key:'applicant',label_es:'Solicitante',label_fr:'Demandeur',label_ar:'طالب الشهادة',minimum:0,maximum:1,repeatable:false},{key:'heir',label_es:'Heredero',label_fr:'Héritier',label_ar:'الوارث',minimum:1,maximum:12,repeatable:true},{key:'witness',label_es:'Testigo',label_fr:'Témoin',label_ar:'الشاهد',minimum:0,maximum:12,repeatable:true}]};
    const identity:ApprovedIdentitySummary={id:'33333333-3333-3333-3333-333333333333',document_id:document.id,revision:1,source:'mobile',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),images_released:false,display_name_ar:'شخص تجريبي',display_name_latin:'TEST PERSON',national_id:'AA123456'};
    const workspace={approved_identities:[identity],document_generation_requests:[],case_drafts:[],documents:[],captures:[],connected_devices:1,processing:false,mobile_url:null,lan_mode:null,retention_minutes:60} satisfies Workspace;
    const createDocumentRequest=vi.fn().mockResolvedValue({});
    const api={templates:vi.fn().mockResolvedValue([template]),workspace:vi.fn().mockResolvedValue(workspace),createDocumentRequest} as unknown as CaptureApi;
    render(<AppTheme><MobileDocumentPreparation api={api} documentId={document.id} open onClose={()=>{}}/></AppTheme>);
    const heirs=await screen.findByRole('group',{name:'Héritier'});
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(within(heirs).getAllByRole('checkbox')).toHaveLength(1);
    fireEvent.click(within(heirs).getByRole('checkbox',{name:'TEST PERSON · AA123456'}));
    fireEvent.click(screen.getByRole('button',{name:'Envoyer la demande à Windows'}));
    await waitFor(()=>expect(createDocumentRequest).toHaveBeenCalledWith('ma.inheritance','1.1.0',{applicant:[],heir:[identity.id],witness:[]},expect.any(String)));
    expect(screen.queryByText(/identité étrangère/i)).toBeNull();
  });
});
