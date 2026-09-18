// @vitest-environment jsdom
import {useState} from 'react';
import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {useCaseCollaboration} from '@notario/ui';
import {ApiError,type CaptureApi,type CaseDraft,type TemplateFieldDefinition} from '@notario/api-client';

afterEach(cleanup);
const fields:TemplateFieldDefinition[]=[{key:'heir_relation',label_fr:'Lien successoral',label_ar:'صلة الإرث',
  type:'arabic_text',required:false,direction:'rtl',repeatable:true,maximum_items:12,maximum_characters:160,role:'heir'}];
const initial:CaseDraft={id:'10000000-0000-4000-8000-000000000001',template_id:'ma.inheritance',template_version:'1.4.1',
  mode:'complete',status:'editing',revision:1,source:'desktop',field_count:1,assignment_count:2,
  created_at:new Date().toISOString(),updated_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),
  fields:{heir_relation:['relation A','relation B']},assignments:{heir:['person-A','person-B']}};

function fixture() {
  let server=structuredClone(initial);
  const onError=vi.fn();
  const patchCaseRole=vi.fn().mockImplementation(async(_id:string,role:string,value:string[])=>{
    const previous=server.assignments[role];
    const values=server.fields.heir_relation as string[];
    const byIdentity=new Map(previous.map((id,index)=>[id,values[index]]));
    server={...server,revision:server.revision+1,assignments:{heir:value},
      fields:{heir_relation:value.map(id=>byIdentity.get(id)||'')}};
    return structuredClone(server);
  });
  const patchCaseField=vi.fn().mockImplementation(async(_id:string,key:string,value:string[],_lease:string,_key:string,context:string[])=>{
    if(JSON.stringify(context)!==JSON.stringify(server.assignments.heir))throw new ApiError(409,'CASE_ASSIGNMENT_CONTEXT_CHANGED');
    server={...server,revision:server.revision+1,fields:{...server.fields,[key]:value}};
    return structuredClone(server);
  });
  const api={case:vi.fn().mockImplementation(async()=>structuredClone(server)),caseFieldLeases:vi.fn().mockResolvedValue([]),
    subscribe:vi.fn().mockReturnValue(()=>{}),acquireCaseFieldLease:vi.fn().mockImplementation(async(id:string,key:string)=>({
      case_id:id,field_key:key,actor_label:'Poste Windows',expires_at:Date.now()/1000+45,
      lease_token:`lease-token-for-${key}-long-enough`,owned_by_me:true})),
    releaseCaseFieldLease:vi.fn().mockResolvedValue({status:'released'}),patchCaseRole,patchCaseField} as unknown as CaptureApi;
  const hook=renderHook(()=>{
    const [draft,setDraft]=useState<CaseDraft|null>(structuredClone(initial));
    return {draft,collaboration:useCaseCollaboration({api,draft,setDraft,fields,onError})};
  });
  return {hook,api,onError,patchCaseRole,patchCaseField,setServer:(value:CaseDraft)=>{server=structuredClone(value)}};
}

describe('identity-linked legal field collaboration',()=>{
  it('remaps local edits immediately and saves a pending role before its legal field',async()=>{
    const {hook,api,patchCaseRole,patchCaseField}=fixture();
    await waitFor(()=>expect(api.case).toHaveBeenCalled());
    act(()=>hook.result.current.collaboration.editField('heir_relation',['relation A','edited B']));
    act(()=>hook.result.current.collaboration.editRole('heir',['person-B','person-A','person-C']));
    expect(hook.result.current.draft?.fields.heir_relation).toEqual(['edited B','relation A','']);
    await act(async()=>{await hook.result.current.collaboration.flush()});
    expect(patchCaseRole).toHaveBeenCalledTimes(1);
    expect(patchCaseField).toHaveBeenCalledWith(initial.id,'heir_relation',['edited B','relation A',''],
      expect.any(String),expect.any(String),['person-B','person-A','person-C']);
    expect(patchCaseRole.mock.invocationCallOrder[0]).toBeLessThan(patchCaseField.mock.invocationCallOrder[0]);
    expect(hook.result.current.draft?.fields.heir_relation).toEqual(['edited B','relation A','']);
    expect(hook.result.current.collaboration.unsaved).toBe(0);
  });

  it('rebases an unsaved legal field by identity when a remote role changes',async()=>{
    const {hook,api,setServer,patchCaseField}=fixture();
    await waitFor(()=>expect(api.case).toHaveBeenCalled());
    act(()=>hook.result.current.collaboration.editField('heir_relation',['local A','local B']));
    setServer({...initial,revision:2,assignments:{heir:['person-B','person-C']},fields:{heir_relation:['relation B','']}});
    await act(async()=>{await hook.result.current.collaboration.refresh()});
    expect(hook.result.current.draft?.fields.heir_relation).toEqual(['local B','']);
    await act(async()=>{await hook.result.current.collaboration.flush()});
    expect(patchCaseField).toHaveBeenCalledWith(initial.id,'heir_relation',['local B',''],
      expect.any(String),expect.any(String),['person-B','person-C']);
  });

  it('retains and remaps pending values after the server rejects an old assignment context',async()=>{
    const {hook,api,setServer,patchCaseField,onError}=fixture();
    await waitFor(()=>expect(api.case).toHaveBeenCalled());
    act(()=>hook.result.current.collaboration.editField('heir_relation',['local A','local B']));
    setServer({...initial,revision:2,assignments:{heir:['person-B','person-A']},fields:{heir_relation:['relation B','relation A']}});
    act(()=>hook.result.current.collaboration.bind('heir_relation').onBlur());
    await waitFor(()=>expect(onError).toHaveBeenCalled());
    expect(hook.result.current.draft?.fields.heir_relation).toEqual(['local B','local A']);
    expect(hook.result.current.collaboration.unsaved).toBe(1);
    await act(async()=>{await hook.result.current.collaboration.flush()});
    expect(patchCaseField.mock.calls[0][5]).toEqual(['person-A','person-B']);
    expect(patchCaseField.mock.calls[1][5]).toEqual(['person-B','person-A']);
    expect(hook.result.current.collaboration.unsaved).toBe(0);
  });

  it('remaps clean server fields to a newer locally pending role, even during an in-flight save',async()=>{
    const {hook,api,patchCaseRole}=fixture();
    await waitFor(()=>expect(api.case).toHaveBeenCalled());
    let resolve!:(value:CaseDraft)=>void;
    patchCaseRole.mockImplementationOnce(()=>new Promise<CaseDraft>(done=>{resolve=done}));
    act(()=>hook.result.current.collaboration.editRole('heir',['person-B','person-A']));
    act(()=>hook.result.current.collaboration.bind('role.heir').onBlur());
    await waitFor(()=>expect(patchCaseRole).toHaveBeenCalledTimes(1));
    act(()=>hook.result.current.collaboration.editRole('heir',['person-A']));
    await act(async()=>resolve({...initial,revision:2,assignments:{heir:['person-B','person-A']},
      fields:{heir_relation:['relation B','relation A']}}));
    expect(hook.result.current.draft?.assignments.heir).toEqual(['person-A']);
    expect(hook.result.current.draft?.fields.heir_relation).toEqual(['relation A']);
  });
});
