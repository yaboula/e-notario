import {useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction} from 'react';
import {ApiError, type CaptureApi, type CaseDraft, type CaseFieldLease, type TemplateFieldDefinition} from '@notario/api-client';
import {useUiLocale} from './locale';

type Value = string | string[] | null;
interface Options {
  api:CaptureApi;
  draft:CaseDraft|null;
  setDraft:Dispatch<SetStateAction<CaseDraft|null>>;
  onChanged?:()=>void;
  onError:(error:unknown)=>void;
  fields?:TemplateFieldDefinition[];
}
const equal=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);
const read=(draft:CaseDraft,key:string):Value=>key.startsWith('role.')
  ? draft.assignments[key.slice(5)]||[] : draft.fields[key]??null;

/** One collaboration implementation for desktop and mobile, with no browser persistence. */
export function useCaseCollaboration({api,draft,setDraft,onChanged,onError,fields:definitions=[]}:Options) {
  const {locale}=useUiLocale();
  const current=useRef(draft);
  current.current=draft;
  const lifecycle=useRef(0);
  const callbacks=useRef({setDraft,onChanged,onError});
  callbacks.current={setDraft,onChanged,onError};
  const dirty=useRef(new Set<string>());
  const focused=useRef(new Set<string>());
  const tokens=useRef(new Map<string,string>());
  const timers=useRef(new Map<string,ReturnType<typeof setTimeout>>());
  const acquisitions=useRef(new Map<string,Promise<CaseFieldLease>>());
  const releases=useRef(new Map<string,Promise<void>>());
  const operations=useRef(new Map<string,Promise<void>>());
  const fieldDefinitions=useRef(definitions);
  fieldDefinitions.current=definitions;
  const assignmentContexts=useRef(new Map<string,string[]>());
  const saveKeyRef=useRef<(key:string)=>Promise<void>>(async()=>{});
  const [leases,setLeases]=useState<CaseFieldLease[]>([]);
  const [activity,setActivity]=useState({saving:0,unsaved:0});
  const caseId=draft?.id;

  const reportActivity=useCallback(()=>setActivity({saving:operations.current.size,unsaved:dirty.current.size}),[]);
  const merge=useCallback((server:CaseDraft)=>{
    callbacks.current.setDraft(local=>{
      if(!local||local.id!==server.id||server.revision<local.revision)return local;
      const fields={...server.fields};
      const assignments={...server.assignments};
      for(const key of dirty.current)if(key.startsWith('role.'))
        assignments[key.slice(5)]=local.assignments[key.slice(5)]||[];
      for(const definition of fieldDefinitions.current) {
        const values=server.fields[definition.key];
        if(!definition.role||!Array.isArray(values))continue;
        const oldIds=server.assignments[definition.role]||[];
        const byIdentity=new Map(oldIds.map((id,index)=>[id,values[index]||'']));
        fields[definition.key]=(assignments[definition.role]||[]).map(id=>byIdentity.get(id)||'');
      }
      for(const key of dirty.current) {
        if(key.startsWith('role.'))assignments[key.slice(5)]=local.assignments[key.slice(5)]||[];
        else {
          const definition=fieldDefinitions.current.find(field=>field.key===key);
          const value=local.fields[key]??null;
          if(definition?.role&&Array.isArray(value)) {
            const previous=assignmentContexts.current.get(key)||local.assignments[definition.role]||[];
            const next=assignments[definition.role]||[];
            const values=new Map(previous.map((id,index)=>[id,value[index]||'']));
            fields[key]=next.map(id=>values.get(id)||'');
            assignmentContexts.current.set(key,[...next]);
          } else fields[key]=value;
        }
      }
      const next={...server,fields,assignments};
      current.current=next;
      return next;
    });
  },[]);
  const refresh=useCallback(async()=>{
    if(!caseId)return;
    const generation=lifecycle.current;
    const [server,locks]=await Promise.all([api.case(caseId),api.caseFieldLeases(caseId)]);
    if(current.current?.id!==caseId||lifecycle.current!==generation)return;
    setLeases(locks);
    merge(server);
  },[api,caseId,merge]);

  const acquire=useCallback((key:string):Promise<CaseFieldLease>=>{
    if(!caseId)return Promise.reject(new Error('CASE_NOT_FOUND'));
    const generation=lifecycle.current;
    const begin=():Promise<CaseFieldLease>=>{
      if(current.current?.id!==caseId||lifecycle.current!==generation)return Promise.reject(new Error('CASE_CHANGED'));
      const pending=acquisitions.current.get(key);
      if(pending)return pending;
      const request=api.acquireCaseFieldLease(caseId,key,'Session',tokens.current.get(key))
        .then(async lease=>{
          if(!lease.lease_token)throw new Error('CASE_FIELD_LEASE_INVALID');
          if(current.current?.id!==caseId||lifecycle.current!==generation) {
            // The server may grant focus after the screen has already closed.
            await api.releaseCaseFieldLease(caseId,key,lease.lease_token).catch(()=>{});
            throw new Error('CASE_CHANGED');
          }
          tokens.current.set(key,lease.lease_token);
          setLeases(values=>[...values.filter(item=>item.field_key!==key),lease]);
          return lease;
        }).finally(()=>{if(acquisitions.current.get(key)===request)acquisitions.current.delete(key)});
      acquisitions.current.set(key,request);
      return request;
    };
    const releasing=releases.current.get(key);
    return releasing?releasing.then(begin):begin();
  },[api,caseId]);

  const release=useCallback((key:string):Promise<void>=>{
    const pending=releases.current.get(key);
    if(pending)return pending;
    const request=(async()=>{
      // A blur may precede the response to focus acquisition. Do not leak that lease.
      const acquiring=acquisitions.current.get(key);
      if(acquiring)await acquiring;
      const token=tokens.current.get(key);
      if(!caseId||current.current?.id!==caseId||!token)return;
      try {await api.releaseCaseFieldLease(caseId,key,token)}
      catch(error) {if(!(error instanceof ApiError&&['CASE_FIELD_LEASE_EXPIRED','CASE_NOT_FOUND'].includes(error.code)))throw error}
      if(current.current?.id!==caseId)return;
      if(tokens.current.get(key)===token)tokens.current.delete(key);
      setLeases(values=>values.filter(item=>item.field_key!==key));
    })().finally(()=>{if(releases.current.get(key)===request)releases.current.delete(key)});
    releases.current.set(key,request);
    return request;
  },[api,caseId]);

  const saveKey=useCallback((key:string):Promise<void>=>{
    const previous=operations.current.get(key)||Promise.resolve();
    const operation=previous.catch(()=>{}).then(async()=>{
      if(!caseId||current.current?.id!==caseId||!dirty.current.has(key))return;
      const definition=fieldDefinitions.current.find(field=>field.key===key);
      if(definition?.role&&dirty.current.has(`role.${definition.role}`))
        await saveKeyRef.current(`role.${definition.role}`);
      if(current.current?.id!==caseId||!dirty.current.has(key))return;
      const value=read(current.current,key);
      const submitted=Array.isArray(value)?[...value]:value;
      const context=definition?.role?[...(assignmentContexts.current.get(key)||current.current.assignments[definition.role]||[])]:undefined;
      const mutationKey=crypto.randomUUID();
      let lease=await acquire(key);
      const patch=()=>key.startsWith('role.')
        ? api.patchCaseRole(caseId,key.slice(5),submitted as string[],lease.lease_token!,mutationKey)
        : context?api.patchCaseField(caseId,key,submitted,lease.lease_token!,mutationKey,context)
          :api.patchCaseField(caseId,key,submitted,lease.lease_token!,mutationKey);
      let server:CaseDraft;
      try {server=await patch()}
      catch(error) {
        if(error instanceof ApiError&&error.code==='CASE_ASSIGNMENT_CONTEXT_CHANGED') {
          await refresh();
          throw error;
        }
        if(!(error instanceof ApiError&&error.code==='CASE_FIELD_LEASE_EXPIRED'))throw error;
        tokens.current.delete(key);
        lease=await acquire(key);
        server=await patch();
      }
      if(current.current?.id!==caseId)return;
      if(equal(read(current.current,key),submitted)&&(!definition?.role||
        equal(assignmentContexts.current.get(key)||current.current.assignments[definition.role]||[],context))) {
        dirty.current.delete(key);
        assignmentContexts.current.delete(key);
      }
      merge(server);
      callbacks.current.onChanged?.();
    }).finally(()=>{
      if(operations.current.get(key)===operation)operations.current.delete(key);
      reportActivity();
    });
    operations.current.set(key,operation);
    reportActivity();
    return operation;
  },[api,caseId,acquire,merge,refresh,reportActivity]);
  saveKeyRef.current=saveKey;

  const edit=useCallback((key:string,value:Value)=>{
    if(!caseId||current.current?.status!=='editing')return;
    dirty.current.add(key);
    callbacks.current.setDraft(local=>{
      if(!local||local.id!==caseId)return local;
      let next=key.startsWith('role.')
        ? {...local,assignments:{...local.assignments,[key.slice(5)]:value as string[]}}
        : {...local,fields:{...local.fields,[key]:value}};
      if(key.startsWith('role.')) {
        const role=key.slice(5),newIds=value as string[];
        const updatedFields={...next.fields};
        for(const definition of fieldDefinitions.current.filter(field=>field.role===role)) {
          const previous=local.fields[definition.key];
          if(!Array.isArray(previous))continue;
          const oldIds=assignmentContexts.current.get(definition.key)||local.assignments[role]||[];
          const byIdentity=new Map(oldIds.map((id,index)=>[id,previous[index]||'']));
          updatedFields[definition.key]=newIds.map(id=>byIdentity.get(id)||'');
          if(dirty.current.has(definition.key))assignmentContexts.current.set(definition.key,[...newIds]);
        }
        next={...next,fields:updatedFields};
      } else {
        const definition=fieldDefinitions.current.find(field=>field.key===key);
        if(definition?.role)assignmentContexts.current.set(key,[...(local.assignments[definition.role]||[])]);
      }
      current.current=next;
      return next;
    });
    const old=timers.current.get(key);
    if(old)clearTimeout(old);
    timers.current.set(key,setTimeout(()=>{
      timers.current.delete(key);
      void saveKey(key).catch(error=>callbacks.current.onError(error));
    },650));
    reportActivity();
  },[caseId,saveKey,reportActivity]);

  const focus=useCallback((key:string)=>{
    const generation=lifecycle.current;
    focused.current.add(key);
    void acquire(key).catch(error=>{
      if(lifecycle.current!==generation||current.current?.id!==caseId)return;
      callbacks.current.onError(error);void refresh().catch(()=>{});
    });
  },[acquire,refresh,caseId]);
  const blur=useCallback((key:string)=>{
    focused.current.delete(key);
    const timer=timers.current.get(key);
    if(timer){clearTimeout(timer);timers.current.delete(key)}
    void saveKey(key).then(()=>{
      if(!focused.current.has(key)&&!dirty.current.has(key))return release(key);
    }).catch(error=>callbacks.current.onError(error));
  },[saveKey,release]);

  const flush=useCallback(async():Promise<CaseDraft|null>=>{
    for(const timer of timers.current.values())clearTimeout(timer);
    timers.current.clear();
    await Promise.all([...dirty.current].map(saveKey));
    await Promise.all([...operations.current.values()]);
    await Promise.all([...acquisitions.current.values()]);
    focused.current.clear();
    await Promise.all([...tokens.current.keys()].map(release));
    if(!caseId)return null;
    const server=await api.case(caseId);
    merge(server);
    return server;
  },[api,caseId,saveKey,release,merge]);

  useEffect(()=>{
    const generation=++lifecycle.current;
    current.current=draft;
    dirty.current.clear();focused.current.clear();tokens.current.clear();
    assignmentContexts.current.clear();
    acquisitions.current.clear();releases.current.clear();operations.current.clear();setLeases([]);reportActivity();
    if(!caseId)return;
    const update=()=>void refresh().catch(error=>callbacks.current.onError(error));
    update();
    const unsubscribe=api.subscribe(update);
    const poll=setInterval(update,5000);
    const renew=setInterval(()=>{
      for(const key of focused.current)void acquire(key).catch(error=>callbacks.current.onError(error));
      for(const key of dirty.current)void saveKey(key).catch(error=>callbacks.current.onError(error));
    },15000);
    return ()=>{
      if(lifecycle.current===generation)lifecycle.current++;
      unsubscribe();clearInterval(poll);clearInterval(renew);
      for(const timer of timers.current.values())clearTimeout(timer);
      timers.current.clear();
      for(const [key,token] of tokens.current)void api.releaseCaseFieldLease(caseId,key,token).catch(()=>{});
      if(current.current?.id===caseId)current.current=null;
    };
  },[api,caseId,refresh,acquire,saveKey,reportActivity]);

  useEffect(()=>{
    const protect=(event:BeforeUnloadEvent)=>{if(dirty.current.size){event.preventDefault();event.returnValue=''}};
    window.addEventListener('beforeunload',protect);
    return ()=>window.removeEventListener('beforeunload',protect);
  },[]);

  const bind=(key:string)=>{
    const foreign=leases.find(item=>item.field_key===key&&!item.owned_by_me);
    return {
      disabled:draft?.status!=='editing'||Boolean(foreign),
      title:foreign?`${locale==='ar'?'جارٍ التحرير بواسطة':'Modification en cours par'} : ${foreign.actor_label}`:undefined,
      onFocus:()=>focus(key),onBlur:()=>blur(key),
    };
  };
  return {bind,editField:edit,editRole:(role:string,value:string[])=>edit(`role.${role}`,value),flush,refresh,...activity,leases};
}
