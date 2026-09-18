export type DocumentSaveKind='case'|'document_request';
export type DocumentSaveReceipt={id:string;case_id:string;kind?:DocumentSaveKind;revision:number;
  path:string;created_at:number;expires_at:number;confirmed:boolean};

// The v1 native journal keeps its legacy IPC names and reference key. Its kind
// discriminator isolates complete dossiers from partial generation requests.
export async function documentSaveReceipts(kind:DocumentSaveKind):Promise<DocumentSaveReceipt[]>{
  const {invoke}=await import('@tauri-apps/api/core');
  const items=await invoke<DocumentSaveReceipt[]>('pending_case_save_receipts');
  return items.filter(item=>(item.kind||'case')===kind);
}
export async function acknowledgeDocumentSaveReceipt(id:string){
  const {invoke}=await import('@tauri-apps/api/core');
  return invoke<void>('acknowledge_case_save_receipt',{id});
}
