export type CaptureSide = 'front' | 'back';
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
  opencv: {valid: boolean; score: number | null};
  docquadnet: {valid: boolean; score: number | null};
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
export interface TemplateRole {key:string;label_es:string;label_fr?:string;label_ar:string;minimum:number;maximum:number;repeatable:boolean}
export interface TemplateFieldDefinition {
  key:string;label_fr:string;label_ar:string;type:'text'|'arabic_text'|'date'|'number'|'amount'|'professional_profile';
  required:boolean;direction:'ltr'|'rtl'|'auto';repeatable:boolean;maximum_items:number;maximum_characters:number;
  role?:string|null;
}
export interface TemplateSummary {
  schema_version:'enotario.document-template/v1'|'enotario.document-template/v2';id:string;version:string;slug:string;title_es:string;
  title_fr?:string;title_ar:string;description_es:string;description_fr?:string;language:string;roles:TemplateRole[];
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
    const name=/filename="([^"]+)"/.exec(disposition)?.[1]||`documento-${new Date().toISOString().replace(/[-:T]/g,'').slice(0,15)}.docx`;
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
  pair(code:string,operatorName='Opérateur mobile',deviceName='Appareil mobile') {return this.request<{token:string;expires_at:number;actor_label:string}>('/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,operator_name:operatorName,device_name:deviceName})})}
  upload(file: Blob, side: CaptureSide, key = crypto.randomUUID(), documentId?: string, cardModel: CardModel = 'CNIE_MA_2020') {
    const query = new URLSearchParams({side,card_model:cardModel}); if (documentId) query.set('document_id', documentId);
    return this.request<Capture>(`/captures?${query}`, {method: 'POST', headers: {'Content-Type': file.type, 'Idempotency-Key': key}, body: file});
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
    const name=/filename="([^"]+)"/.exec(disposition)?.[1]||`documento-${new Date().toISOString().replace(/[-:T]/g,'').slice(0,15)}.docx`;
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
export const instructions: Record<string, string> = {
  SESSION_EXPIRED: 'La sesión ha caducado. Vuelve a conectar el dispositivo.',
  AUTH_REQUIRED: 'Abre esta ventana desde el lanzador de e-notario.',
  SERVICE_VERSION_MISMATCH: 'La interfaz y el motor pertenecen a versiones diferentes. Instala la misma versión completa.',
  SERVICE_STARTUP_TIMEOUT: 'El motor local no inició a tiempo. Cierra e-notario y comprueba la instalación.',
  PAIRING_EXPIRED: 'Este QR ya se utilizó o ha caducado. Genera otro desde el PC.',
  PAIRING_ACTOR_REQUIRED: 'Indica el nombre temporal del operador y del dispositivo.',
  LAN_HTTPS_NOT_CONFIGURED: 'Configura la conexión HTTPS de oficina para conectar un móvil.',
  PROCESSOR_BUSY: 'Hay una captura en proceso. Espera unos segundos y vuelve a enviar.',
  IMAGE_TOO_LARGE: 'La fotografía supera el límite disponible. Usa JPEG de hasta 20 MB o elimina capturas.',
  JPEG_OR_PNG_REQUIRED: 'Usa una imagen JPEG o PNG. HEIC todavía no está admitido.',
  CAPTURE_LIMIT_DELETE_FIRST: 'La sesión está llena. Exporta y elimina capturas antes de continuar.',
  NO_DOCUMENT_QUADRILATERAL: 'Coloca la tarjeta completa sobre un fondo mate y contrastante.',
  INSUFFICIENT_CARD_RESOLUTION: 'Acerca la cámara y usa una fotografía de mayor resolución.',
  CARD_TOO_SMALL_IN_FRAME: 'Acerca la cámara: la tarjeta debe ocupar más espacio.',
  CARD_TOO_CLOSE_TO_FRAME: 'Aleja ligeramente la cámara y deja margen alrededor.',
  CORNERS_TOO_CLOSE_TO_IMAGE_BORDER: 'Deja visibles las cuatro esquinas, con margen alrededor.',
  INSUFFICIENT_EDGE_SUPPORT: 'Mejora la iluminación y el contraste del fondo.',
  WEAK_CORNER_EVIDENCE: 'Deja las cuatro esquinas completamente visibles y acerca ligeramente la cámara.',
  AMBIGUOUS_CORNER_EVIDENCE: 'Retira otros objetos rectangulares y deja una sola tarjeta en el encuadre.',
  MODEL_MASK_DISAGREEMENT: 'Usa un fondo uniforme y comprueba que ningún objeto toque o solape la tarjeta.',
  DETECTOR_DISAGREEMENT: 'Repite la fotografía con la tarjeta más frontal y el fondo despejado.',
  EXCESSIVE_GLARE: 'Evita reflejos. Desactiva el flash y cambia ligeramente el ángulo.',
  IMAGE_TOO_DARK: 'Añade luz difusa sobre la tarjeta.', IMAGE_TOO_BRIGHT: 'Reduce la luz directa sobre la tarjeta.',
  MODEL_UNAVAILABLE: 'El motor necesita atención en el PC. Contacta con el responsable.',
  PROCESSING_FAILED: 'No se pudo procesar la fotografía. Reintenta o contacta con el responsable.',
  IMAGE_DECODE_FAILED: 'El archivo no se puede leer. Vuelve a tomar la fotografía.',
  OCR_NOT_CONFIGURED: 'Importa una credencial de Google Vision desde Diagnóstico antes de reintentar.',
  OCR_CREDENTIAL_INVALID: 'La credencial no es una cuenta de servicio válida de Google.',
  OCR_AUTH_FAILED: 'Google rechazó la autenticación. Sustituye la credencial.',
  OCR_PERMISSION_DENIED: 'La cuenta no tiene permiso para Vision API en la región UE.',
  OCR_QUOTA_EXCEEDED: 'La cuota configurada en Google Cloud se ha agotado.',
  OCR_LOCAL_LIMIT_REACHED: 'Se alcanzó el límite local diario o mensual. Contacta con TI.',
  OCR_USAGE_READ_FAILED: 'No se puede verificar el consumo OCR. Contacta con TI para recuperar el contador; no lo reinicies a cero.',
  OCR_USAGE_WRITE_FAILED: 'No se pudo guardar el consumo OCR. Comprueba el almacenamiento y reintenta; no se ha enviado la imagen.',
  CARD_TOO_BLURRY: 'La tarjeta está desenfocada. Estabiliza la cámara, enfoca el texto y repite la captura.',
  OCR_RATE_LIMITED: 'Google está limitando temporalmente las solicitudes. Reintenta manualmente más tarde.',
  OCR_TIMEOUT: 'Google Vision no respondió a tiempo. Puedes reintentar el OCR.',
  OCR_PROVIDER_UNAVAILABLE: 'Google Vision no está disponible temporalmente. Puedes reintentar el OCR.',
  OCR_INVALID_RESPONSE: 'Google devolvió una respuesta no válida. Contacta con el responsable.',
  OCR_NO_TEXT: 'No se detectó texto. Revisa la imagen y repite la captura si es necesario.',
  OCR_MAX_ATTEMPTS_REACHED: 'Se alcanzaron los tres intentos permitidos para esta captura.',
  OCR_RETRY_NOT_ALLOWED: 'El OCR no se puede reintentar en el estado actual.',
  TEMPORARY_STORAGE_WRITE_FAILED: 'No se pudo proteger y guardar la sesión en disco. No cierres la aplicación; comprueba el almacenamiento y reintenta la operación.',
  EXTRACTION_RESULT_NOT_AVAILABLE: 'Los datos estarán disponibles cuando termine el OCR de ambas caras.',
  EXTRACTION_UNSUPPORTED_LAYOUT: 'No se pudo reconocer de forma segura el modelo de CNIE. Revisa ambas caras o repite la captura.',
  EXTRACTION_CARD_MODEL_MISMATCH: 'El modelo detectado no coincide con el elegido. Comprueba ambas caras y comienza una CNIE nueva con el modelo correcto.',
  DOCUMENT_CARD_MODEL_LOCKED: 'El modelo de esta CNIE ya está fijado. Para cambiarlo, comienza una CNIE nueva.',
  CASE_STALE_REVISION: 'El expediente cambió en otro dispositivo. Recarga los datos antes de continuar.',
  CASE_NOT_EDITABLE: 'El expediente está en revisión final y no admite cambios.',
  CASE_FIELD_LOCKED: 'Este campo está siendo editado en el otro dispositivo. Se habilitará al terminar o al caducar el bloqueo.',
  CASE_ASSIGNMENT_CONTEXT_CHANGED: 'Las personas asignadas han cambiado. Se ha recargado el expediente; revisa los datos asociados y vuelve a guardar.',
  CASE_FIELD_LEASE_EXPIRED: 'El turno de edición de este campo ha caducado. Vuelve a seleccionarlo para continuar.',
  CASE_FIELD_LEASE_INVALID: 'El campo pertenece ahora a otra sesión de edición. Recarga el expediente.',
  CASE_EDITORS_ACTIVE: 'Hay campos en edición. Guarda y termina la edición antes de abrir la revisión final.',
  CASE_FIELDS_REQUIRE_COMPLETE_MODE: 'Los campos jurídicos solo se guardan en el modo de relleno completo.',
  CASE_LIMIT: 'Se alcanzó el límite de expedientes temporales. Finaliza o elimina uno antes de continuar.',
  CASE_STORAGE_DECRYPT_FAILED: 'No se pudo abrir el expediente cifrado. Contacta con el responsable antes de crear más trabajo.',
  CASE_INCOMPLETE: 'Faltan campos jurídicos. Revisa la lista y confirma expresamente si quieres generar el Word incompleto.',
  CASE_NOT_IN_FINAL_REVIEW: 'Abre la revisión final del expediente antes de generar el documento.',
  PROFESSIONAL_PROFILE_INVALID: 'Selecciona un perfil activo o escribe directamente el nombre profesional.',
  PROFILE_STALE_REVISION: 'El perfil profesional cambió. Recarga antes de guardar.',
  PROFILE_IN_USE: 'Este perfil se utiliza en un expediente conservado. Sustitúyelo allí o elimina el expediente antes de desactivarlo o borrarlo.',
  PROFILE_DELETE_REQUIRES_INACTIVE: 'Desactiva el perfil antes de eliminarlo definitivamente.',
  PROFILE_STORAGE_WRITE_FAILED: 'No se pudo guardar el catálogo profesional de forma segura. No se aplicó ningún cambio.',
  PROFILE_INVALID: 'Revisa los datos del perfil profesional.',
  PROFILE_LIMIT: 'Se alcanzó el límite de 64 perfiles profesionales.',
  EXTRACTION_MIXED_LAYOUT: 'Las dos caras parecen corresponder a modelos de CNIE diferentes. Comprueba que pertenecen a la misma tarjeta.',
  EXTRACTION_SIDE_MISMATCH: 'El anverso y el reverso no parecen pertenecer a la misma CNIE.',
  EXTRACTION_REQUIRED_FIELD_MISSING: 'Falta un campo obligatorio. Corrígelo desde la imagen o repite la captura.',
  EXTRACTION_LOW_CONFIDENCE: 'Revisa cuidadosamente este campo antes de confirmarlo.',
  EXTRACTION_DATA_CONFLICT: 'Hay datos incompatibles o con un formato no válido.',
  EXTRACTION_REVIEW_INCOMPLETE: 'Confirma o corrige todos los campos obligatorios antes de aprobar.',
  EXTRACTION_STALE_REVISION: 'La captura cambió durante la revisión. Vuelve a cargar los datos.',
  EXTRACTION_FAILED: 'No se pudieron estructurar los datos. Revisa el diagnóstico o repite la captura.',
  APPROVED_IDENTITY_LIMIT: 'Se alcanzó el límite de 64 identidades temporales. Genera o elimina solicitudes y espera a que caduquen las que ya no uses.',
  APPROVED_IDENTITY_REQUIRED: 'Primero aprueba todos los datos de esta identidad.',
  APPROVED_IDENTITY_EXPIRED: 'Una identidad asignada ha caducado o fue sustituida. Revisa la solicitud.',
  APPROVED_IDENTITY_FORBIDDEN: 'El móvil solo puede utilizar identidades de su propia sesión.',
  DOCUMENT_TEMPLATE_NOT_FOUND: 'La plantilla solicitada no está instalada.',
  DOCUMENT_TEMPLATE_VERSION_MISMATCH: 'La solicitud está fijada a otra versión de la plantilla.',
  DOCUMENT_TEMPLATE_INTEGRITY_FAILED: 'La plantilla instalada no supera la verificación de integridad.',
  DOCUMENT_TEMPLATE_INVALID: 'La plantilla instalada contiene elementos no permitidos.',
  DOCUMENT_ROLE_INVALID: 'Revisa los roles y la cantidad de identidades asignadas.',
  DOCUMENT_REQUEST_NOT_FOUND: 'La solicitud ya no existe o no pertenece a esta sesión.',
  DOCUMENT_REQUEST_LIMIT: 'Se alcanzó el límite de 64 solicitudes temporales.',
  DOCUMENT_REQUEST_STALE_REVISION: 'La solicitud cambió en otra ventana. Recarga y vuelve a intentarlo.',
  DOCUMENT_TEMPLATE_VALUE_TOO_LONG: 'Un valor revisado supera el espacio declarado por la plantilla.',
  DOCUMENT_TEMPLATE_BINDING_MISSING: 'Falta un valor aprobado necesario para esta plantilla.',
  DOCUMENT_GENERATION_FAILED: 'No se pudo generar el documento Word.',
};
export interface OcrUsage {daily_limit:number;monthly_limit:number;used_today:number;used_month:number}
export function explain(error: unknown): string {
  if (error instanceof ApiError) return instructions[error.code] || `No se pudo completar la operación (${error.code}).`;
  return 'No se pudo conectar con el PC. Comprueba la conexión e inténtalo de nuevo.';
}
