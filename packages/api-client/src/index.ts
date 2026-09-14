export type CaptureSide = 'front' | 'back';
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
  documents: DocumentSummary[]; captures: Capture[]; connected_devices: number; processing: boolean;
  mobile_url: string | null; lan_mode: 'automatic' | 'manual' | 'managed' | null; retention_minutes: number;
}
export interface Pairing {url: string; expires_at: number}
export class ApiError extends Error {
  constructor(public status: number, public code: string) {super(code)}
}
export class CaptureApi {
  constructor(public base: string, public token: string) {}
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.base}/api${path}`, {
      ...init, cache: 'no-store', headers: {...init.headers, Authorization: `Bearer ${this.token}`},
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(response.status, typeof error.detail === 'string' ? error.detail : 'REQUEST_FAILED');
    }
    return response.json() as Promise<T>;
  }
  workspace() {return this.request<Workspace>('/workspace')}
  pairing() {return this.request<Pairing>('/pairing', {method: 'POST'})}
  disconnect() {return this.request('/pairing', {method: 'DELETE'})}
  pair(code: string) {return this.request<{token: string; expires_at: number}>('/pair', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code})})}
  upload(file: Blob, side: CaptureSide, key = crypto.randomUUID(), documentId?: string) {
    const query = new URLSearchParams({side}); if (documentId) query.set('document_id', documentId);
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
  PAIRING_EXPIRED: 'Este QR ya se utilizó o ha caducado. Genera otro desde el PC.',
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
  OCR_RATE_LIMITED: 'Google está limitando temporalmente las solicitudes. Reintenta manualmente más tarde.',
  OCR_TIMEOUT: 'Google Vision no respondió a tiempo. Puedes reintentar el OCR.',
  OCR_PROVIDER_UNAVAILABLE: 'Google Vision no está disponible temporalmente. Puedes reintentar el OCR.',
  OCR_INVALID_RESPONSE: 'Google devolvió una respuesta no válida. Contacta con el responsable.',
  OCR_NO_TEXT: 'No se detectó texto. Revisa la imagen y repite la captura si es necesario.',
  OCR_MAX_ATTEMPTS_REACHED: 'Se alcanzaron los tres intentos permitidos para esta captura.',
  OCR_RETRY_NOT_ALLOWED: 'El OCR no se puede reintentar en el estado actual.',
  EXTRACTION_RESULT_NOT_AVAILABLE: 'Los datos estarán disponibles cuando termine el OCR de ambas caras.',
  EXTRACTION_UNSUPPORTED_LAYOUT: 'Esta versión de la CNIE no está soportada. Comprueba que sea el modelo actual.',
  EXTRACTION_SIDE_MISMATCH: 'El anverso y el reverso no parecen pertenecer a la misma CNIE.',
  EXTRACTION_REQUIRED_FIELD_MISSING: 'Falta un campo obligatorio. Corrígelo desde la imagen o repite la captura.',
  EXTRACTION_LOW_CONFIDENCE: 'Revisa cuidadosamente este campo antes de confirmarlo.',
  EXTRACTION_DATA_CONFLICT: 'Hay datos incompatibles o con un formato no válido.',
  EXTRACTION_REVIEW_INCOMPLETE: 'Confirma o corrige todos los campos obligatorios antes de aprobar.',
  EXTRACTION_STALE_REVISION: 'La captura cambió durante la revisión. Vuelve a cargar los datos.',
  EXTRACTION_FAILED: 'No se pudieron estructurar los datos. Revisa el diagnóstico o repite la captura.',
};
export interface OcrUsage {daily_limit:number;monthly_limit:number;used_today:number;used_month:number}
export function explain(error: unknown): string {
  if (error instanceof ApiError) return instructions[error.code] || `No se pudo completar la operación (${error.code}).`;
  return 'No se pudo conectar con el PC. Comprueba la conexión e inténtalo de nuevo.';
}
