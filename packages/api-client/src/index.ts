export type CaptureSide = 'front' | 'back';
export type CardCorners = [number, number][];
export interface CapturePreview {dimensions:[number,number];corners:CardCorners|null;guidance:'searching'|'closer'|'margin'|'lighting'|'ready'}
export type CardModel = 'CNIE_MA_2020' | 'CNIE_MA_LEGACY';
export type OcrState = 'not_started' | 'queued' | 'processing' | 'success' | 'no_text' | 'error' | 'cancelled';
export interface OcrSummary {
  status: OcrState; attempts: number; queued_at: string | null; started_at: string | null;
  completed_at: string | null; character_count: number; mean_confidence: number | null;
  latency_ms: number | null; error_code: string | null; retryable: boolean;
}
export interface OcrWord {text: string; confidence: number | null; bounding_box: [number,number][]; languages: string[]}
export interface OcrParagraph {text: string; confidence: number | null; bounding_box: [number,number][]; languages: string[]; words: OcrWord[]}
export interface OcrBlock {text: string; confidence: number | null; bounding_box: [number,number][]; block_type: string; paragraphs: OcrParagraph[]}
export interface OcrPage {width: number; height: number; confidence: number | null; blocks: OcrBlock[]}
export interface OcrResult {
  status: 'success' | 'no_text' | 'failed'; request_id: string; provider: string; region: 'eu';
  full_text: string; arabic_text: string; pages: OcrPage[]; languages: string[];
  metrics: Record<string, number | null>; error_code: string | null; retryable: boolean;
}
export interface DocumentSummary {
  id: string; created_at: string; source: 'desktop' | 'mobile';
  card_model: CardModel;
  front_capture_id: string | null; back_capture_id: string | null;
  status: 'capturing' | 'review_required' | 'ocr_pending' | 'data_review_required' | 'ready' | 'attention';
  extraction_summary: ExtractionSummary;
}
export type ExtractionState = 'waiting_for_ocr' | 'extracting' | 'review_required' | 'approved' | 'attention';
export interface ExtractionSummary {
  status: ExtractionState; template: string | null; revision: number; field_count: number;
  reviewed_count: number; warning_count: number; latency_ms: number | null;
  error_code: string | null; approved_at: string | null; approved_by: 'desktop' | 'mobile' | null;
}
export interface ReviewField {
  key: string; normalized_value: unknown; confidence: number | null; required: boolean;
  source_side: CaptureSide | null; warnings: string[];
}
export interface FieldReview {
  decision:'confirmed'|'corrected'|'absent'; value: unknown;
  reviewed_by:'desktop'|'mobile'; reviewed_at:string;
}
export interface DocumentExtraction {
    document_id:string; revision:number; status:ExtractionState; approved_at:string|null;
    approved_by:'desktop'|'mobile'|null; engine:{template:string|null;version:string};
    fields:Record<string,ReviewField>; warnings:string[]; reviews:Record<string,FieldReview>;
}
export interface Rectification {
  status: 'success' | 'recapture_required' | 'invalid_image' | 'model_error';
  request_id: string;
  original_dimensions: [number, number] | null;
  rectified_dimensions: [number, number] | null;
  corners: [number, number][] | null;
  detector_used: string | null;
  detector_iou: number | null;
  detector_corner_distance_ratio: number | null;
  quality_metrics: Record<string, unknown>;
  timings_ms: Record<string, number>;
  warnings: string[];
  rejection_codes: string[];
  opencv: {valid: boolean; score: number | null; corners?: CardCorners | null};
  docquadnet: {valid: boolean; score: number | null; corners?: CardCorners | null};
}
export interface Capture {
  id: string; document_id: string; side: CaptureSide; created_at: string; attempt: number; active: boolean;
  review: 'pending' | 'accepted' | 'retake'; source: 'desktop' | 'mobile'; result: Rectification; ocr_summary: OcrSummary;
}
export interface Workspace {
  storage_error?: string | null;
  documents: DocumentSummary[]; captures: Capture[]; connected_devices: number; processing: boolean;
  mobile_url: string | null; lan_mode: 'automatic' | 'manual' | 'managed' | null; retention_minutes: number;
  approved_identities: ApprovedIdentitySummary[]; document_generation_requests: DocumentGenerationRequest[];
  case_drafts: CaseDraftSummary[];
}
export type CaseMode = 'partial' | 'complete';
export type CaseStatus = 'editing' | 'final_review' | 'completed';
export interface CaseDraftSummary {
  id:string;template_id:string;template_version:string;mode:CaseMode;status:CaseStatus;revision:number;
  source:'desktop'|'mobile';field_count:number;assignment_count:number;
  created_at:string;updated_at:string;expires_at:string;
}
export interface CaseDraft extends CaseDraftSummary {
  fields:Record<string,string|string[]|null>;assignments:Record<string,string[]>;
}
export interface CaseReadiness {
  case_id:string;revision:number;missing_roles:string[];missing_fields:string[];
  ready:boolean;can_generate_with_confirmation:boolean;
}
export interface CaseFieldLease {
  case_id:string;field_key:string;actor_label:string;expires_at:number;lease_token?:string;owned_by_me?:boolean;
}
export interface CaseFieldPatchResult extends CaseDraft {field_lease:CaseFieldLease}
export interface ProfessionalProfile {
  id:string;display_name_ar:string;display_name_fr:string;function_fr:string;active:boolean;revision:number;
  created_at:string;updated_at:string;in_use:boolean;usage_count:number;
}
export interface TemplateRole {key:string;label_es:string;label_fr:string;label_ar:string;minimum:number;maximum:number;repeatable:boolean}
export interface TemplateFieldDefinition {
  key:string;label_fr:string;label_ar:string;type:'text'|'arabic_text'|'date'|'number'|'amount'|'professional_profile';
  required:boolean;direction:'ltr'|'rtl'|'auto';repeatable:boolean;maximum_items:number;maximum_characters:number;
  role?:string|null;
}
export interface TemplateSummary {
  schema_version:'enotario.document-template/v1'|'enotario.document-template/v2';id:string;version:string;slug:string;title_es:string;
  title_fr:string;title_ar:string;description_es:string;description_fr:string;language:string;roles:TemplateRole[];
  fields?:TemplateFieldDefinition[];
}
export interface ApprovedIdentitySummary {
  id:string;document_id:string;revision:number;source:'desktop'|'mobile';created_at:string;expires_at:string;
  images_released:boolean;display_name_ar:string;display_name_latin:string;national_id:string|null;
  card_template?:'CNIE_MA_2020'|'CNIE_MA_LEGACY';
}
export interface DocumentGenerationRequest {
  id:string;revision:number;template_id:string;template_version:string;assignments:Record<string,string[]>;
  source:'desktop'|'mobile';created_at:string;updated_at:string;warnings:string[];
}
export interface Pairing {url: string; expires_at: number}
export interface ServiceHealth {status:'ok';version:string;api_version:number;
  background?:{ocr_worker:'running'|'stopped';maintenance:'running'|'stopped';storage_error:string|null}}
export class ApiError extends Error {
  constructor(public status: number, public code: string, public details?:Record<string,unknown>) {super(code)}
}
export class CaptureApi {
  constructor(public base: string, public token: string) {}
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.base}/api${path}`, {
      ...init, cache: 'no-store', headers: {...init.headers, Authorization: `Bearer ${this.token}`},
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const detail=error.detail;
      if(detail&&typeof detail==='object'&&typeof detail.code==='string')throw new ApiError(response.status,detail.code,detail);
      throw new ApiError(response.status, typeof detail === 'string' ? detail : 'REQUEST_FAILED');
    }
    return response.json() as Promise<T>;
  }
  workspace() {return this.request<Workspace>('/workspace')}
  capturePreview(file:Blob,signal?:AbortSignal) {return this.request<CapturePreview>('/capture-preview',{method:'POST',headers:{'Content-Type':file.type},body:file,signal})}
  health() {return this.request<ServiceHealth>('/health')}
  async waitUntilCompatible(uiVersion:string,apiVersion:number,timeoutMs=30000) {
    const deadline=Date.now()+timeoutMs;
    do {
      try {
        const health=await this.request<ServiceHealth>('/health',{signal:AbortSignal.timeout(2000)});
        if(health.api_version!==apiVersion||health.version!==uiVersion)throw new ApiError(409,'SERVICE_VERSION_MISMATCH');
        return health;
      } catch(error) {
        if(error instanceof ApiError&&error.code==='SERVICE_VERSION_MISMATCH')throw error;
        if(Date.now()>=deadline)break;
        await new Promise(resolve=>setTimeout(resolve,400));
      }
    } while(Date.now()<deadline);
    throw new ApiError(503,'SERVICE_STARTUP_TIMEOUT');
  }
  cases() {return this.request<CaseDraftSummary[]>('/cases')}
  case(id:string) {return this.request<CaseDraft>(`/cases/${id}`)}
  createCase(templateId:string,templateVersion:string,mode:CaseMode,key=crypto.randomUUID()) {
    return this.request<CaseDraft>('/cases',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({template_id:templateId,template_version:templateVersion,mode})});
  }
  updateCase(id:string,revision:number,fields:Record<string,string|string[]|null>|undefined,assignments:Record<string,string[]>|undefined,key=crypto.randomUUID()) {
    return this.request<CaseDraft>(`/cases/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({revision,fields,assignments})});
  }
  beginCaseFinalReview(id:string,revision:number) {return this.request<CaseDraft>(`/cases/${id}/final-review`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision})})}
  reopenCase(id:string,revision:number) {return this.request<CaseDraft>(`/cases/${id}/reopen`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision})})}
  caseReadiness(id:string) {return this.request<CaseReadiness>(`/cases/${id}/readiness`)}
  caseFieldLeases(id:string) {return this.request<CaseFieldLease[]>(`/cases/${id}/field-leases`)}
  acquireCaseFieldLease(id:string,fieldKey:string,actorLabel:string,leaseToken?:string) {return this.request<CaseFieldLease>(`/cases/${id}/field-leases`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({field_key:fieldKey,actor_label:actorLabel,lease_token:leaseToken})})}
  releaseCaseFieldLease(id:string,fieldKey:string,leaseToken:string) {return this.request(`/cases/${id}/field-leases`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({field_key:fieldKey,lease_token:leaseToken})})}
  patchCaseField(id:string,fieldKey:string,value:string|string[]|null,leaseToken:string,key=crypto.randomUUID(),assignmentContext?:string[]) {return this.request<CaseFieldPatchResult>(`/cases/${id}/fields/${encodeURIComponent(fieldKey)}`,{method:'PATCH',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({value,lease_token:leaseToken,assignment_context:assignmentContext})})}
  patchCaseRole(id:string,roleKey:string,value:string[],leaseToken:string,key=crypto.randomUUID()) {return this.request<CaseFieldPatchResult>(`/cases/${id}/assignments/${encodeURIComponent(roleKey)}`,{method:'PATCH',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({value,lease_token:leaseToken})})}
  async generateCase(id:string,revision:number,confirmIncomplete=false) {
    const response=await fetch(`${this.base}/api/cases/${id}/generate`,{method:'POST',cache:'no-store',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:JSON.stringify({revision,confirm_incomplete:confirmIncomplete})});
    if(!response.ok){const error=await response.json().catch(()=>({}));const detail=error.detail;if(detail&&typeof detail==='object'&&typeof detail.code==='string')throw new ApiError(response.status,detail.code,detail);throw new ApiError(response.status,typeof detail==='string'?detail:'DOCUMENT_GENERATION_FAILED')}
    const disposition=response.headers.get('Content-Disposition')||'';
    const name=/filename="([^"]+)"/.exec(disposition)?.[1]||`document-${new Date().toISOString().replace(/[-:T]/g,'').slice(0,15)}.docx`;
    return {blob:await response.blob(),name,revision:Number(response.headers.get('X-eNotario-Case-Revision')||revision)};
  }
  completeCase(id:string,revision:number) {return this.request<CaseDraft>(`/cases/${id}/complete`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision})})}
  deleteCase(id:string) {return this.request(`/cases/${id}`,{method:'DELETE'})}
  clearTemporaryData() {return this.request<{status:'cleared';deleted:Record<string,number>}>('/temporary-data',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmation:'CLEAR_TEMPORARY_DATA'})})}
  professionalProfiles() {return this.request<ProfessionalProfile[]>('/professional-profiles')}
  createProfessionalProfile(displayNameAr:string,displayNameFr:string,functionFr:string,profileId=crypto.randomUUID()) {return this.request<ProfessionalProfile>('/professional-profiles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:profileId,display_name_ar:displayNameAr,display_name_fr:displayNameFr,function_fr:functionFr})})}
  updateProfessionalProfile(profile:ProfessionalProfile) {return this.request<ProfessionalProfile>(`/professional-profiles/${profile.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({display_name_ar:profile.display_name_ar,display_name_fr:profile.display_name_fr,function_fr:profile.function_fr,active:profile.active,revision:profile.revision})})}
  deleteProfessionalProfile(id:string) {return this.request(`/professional-profiles/${id}`,{method:'DELETE'})}
  templates() {return this.request<TemplateSummary[]>('/document-templates')}
  template(id:string,version:string) {return this.request<TemplateSummary>(`/document-templates/${encodeURIComponent(id)}?version=${encodeURIComponent(version)}`)}
  pairing() {return this.request<Pairing>('/pairing', {method: 'POST'})}
  disconnect() {return this.request('/pairing', {method: 'DELETE'})}
  pair(code:string,operatorName='Opérateur mobile',deviceName='Appareil mobile',account?:{email:string;password:string}) {return this.request<{token:string;expires_at:number;actor_label:string}>('/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,operator_name:operatorName,device_name:deviceName,...account})})}
  upload(file: Blob, side: CaptureSide, key = crypto.randomUUID(), documentId?: string, cardModel: CardModel = 'CNIE_MA_2020', corners?: CardCorners) {
    const query = new URLSearchParams({side,card_model:cardModel}); if (documentId) query.set('document_id', documentId);
    return this.request<Capture>(`/captures?${query}`, {method: 'POST', headers: {'Content-Type': file.type, 'Idempotency-Key': key,...(corners?{'X-Document-Corners':JSON.stringify({corners})}:{})}, body: file});
  }
  review(id: string, decision: 'accepted' | 'retake') {return this.request<Capture>(`/captures/${id}/review`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({decision})})}
  delete(id: string) {return this.request(`/captures/${id}`, {method: 'DELETE'})}
  ocr(id: string) {return this.request<OcrResult>(`/captures/${id}/ocr`)}
  retryOcr(id: string) {return this.request<Capture>(`/captures/${id}/ocr/retry`, {method:'POST'})}
  extraction(id:string) {return this.request<DocumentExtraction>(`/documents/${id}/extraction`)}
  reviewExtraction(id:string, revision:number, fields:Record<string,{decision:'confirmed'|'corrected'|'absent';value:unknown}>) {
    return this.request<DocumentExtraction>(`/documents/${id}/extraction/review`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,fields})});
  }
  approveExtraction(id:string, revision:number) {return this.request<DocumentExtraction>(`/documents/${id}/extraction/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision})})}
  releaseImages(id:string) {return this.request<ApprovedIdentitySummary>(`/documents/${id}/release-images`,{method:'POST'})}
  createDocumentRequest(templateId:string,templateVersion:string,assignments:Record<string,string[]>,key=crypto.randomUUID()) {
    return this.request<DocumentGenerationRequest>('/document-generation-requests',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({template_id:templateId,template_version:templateVersion,assignments})});
  }
  updateDocumentRequest(id:string,revision:number,assignments:Record<string,string[]>,key=crypto.randomUUID()) {
    return this.request<DocumentGenerationRequest>(`/document-generation-requests/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({revision,assignments})});
  }
  deleteDocumentRequest(id:string,key=crypto.randomUUID()) {return this.request(`/document-generation-requests/${id}`,{method:'DELETE',headers:{'Idempotency-Key':key}})}
  completeDocumentRequest(id:string,revision:number,key:string) {return this.request(`/document-generation-requests/${id}/complete`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({revision})})}
  async generateDocument(id:string,revision?:number) {
    const response=await fetch(`${this.base}/api/document-generation-requests/${id}/generate`,{method:'POST',cache:'no-store',headers:{Authorization:`Bearer ${this.token}`,...(revision!==undefined?{'Content-Type':'application/json'}:{})},...(revision!==undefined?{body:JSON.stringify({revision})}:{})});
    if(!response.ok){const error=await response.json().catch(()=>({}));throw new ApiError(response.status,typeof error.detail==='string'?error.detail:'DOCUMENT_GENERATION_FAILED')}
    const disposition=response.headers.get('Content-Disposition')||'';
    const name=/filename="([^"]+)"/.exec(disposition)?.[1]||`document-${new Date().toISOString().replace(/[-:T]/g,'').slice(0,15)}.docx`;
    const rawRevision=response.headers.get('X-eNotario-Document-Request-Revision');
    const generatedRevision=rawRevision===null?NaN:Number(rawRevision);
    if(!Number.isSafeInteger(generatedRevision)||generatedRevision<0||(revision!==undefined&&generatedRevision!==revision))throw new ApiError(409,'DOCUMENT_REQUEST_STALE_REVISION');
    return {blob:await response.blob(),name,revision:generatedRevision};
  }
  async exportExtraction(id:string) {
    const response=await fetch(`${this.base}/api/documents/${id}/export`,{cache:'no-store',headers:{Authorization:`Bearer ${this.token}`}});
    if(!response.ok){const error=await response.json().catch(()=>({}));throw new ApiError(response.status,typeof error.detail==='string'?error.detail:'REQUEST_FAILED')}
    return response.blob();
  }
  ocrConfig() {return this.request<{configured:boolean;project_id:string|null;client_email:string|null;region:'eu';endpoint:string;limits:OcrUsage}>('/ocr/config')}
  importCredential(content: string) {return this.request('/ocr/config/credential',{method:'PUT',headers:{'Content-Type':'application/json'},body:content})}
  testOcr() {return this.request<{status:string;region:string;latency_ms:number|null}>('/ocr/config/test',{method:'POST'})}
  deleteCredential() {return this.request('/ocr/config/credential',{method:'DELETE'})}
  ocrUsage() {return this.request<OcrUsage>('/ocr/usage')}
  async image(id: string, variant: 'original' | 'rectified', signal?: AbortSignal) {
    const response = await fetch(`${this.base}/api/captures/${id}/${variant}`, {signal, cache: 'no-store', headers: {Authorization: `Bearer ${this.token}`}});
    if (!response.ok) throw new ApiError(response.status, 'IMAGE_UNAVAILABLE');
    return response.blob();
  }
  subscribe(changed: () => void) {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const connect = () => {
      const url = new URL(`${this.base || location.origin}/api/events`);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(url);
      socket.onopen = () => socket?.send(JSON.stringify({token: this.token}));
      socket.onmessage = changed;
      socket.onclose = () => {if (!stopped) retry = setTimeout(connect, 3000)};
    };
    connect();
    const heartbeat = setInterval(() => {if (socket?.readyState === WebSocket.OPEN) socket.send('ping')}, 20000);
    return () => {stopped = true; clearTimeout(retry); clearInterval(heartbeat); socket?.close()};
  }
}
export interface OcrUsage {daily_limit:number;monthly_limit:number;used_today:number;used_month:number}
