// @vitest-environment jsdom
import {useState} from 'react';
import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {useCaseCollaboration} from '@notario/ui';
import type {CaptureApi,CaseDraft,CaseFieldLease,CaseFieldPatchResult} from '@notario/api-client';

const initial:CaseDraft={
  id:'10000000-0000-4000-8000-000000000001',template_id:'ma.marriage',template_version:'1.6.0',
  mode:'complete',status:'editing',revision:0,source:'desktop',field_count:2,assignment_count:0,
  created_at:new Date().toISOString(),updated_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),
  fields:{registry_number:'1',case_number:'2'},assignments:{},
};
function fixture(patch:ReturnType<typeof vi.fn>){
  const onError=vi.fn();
  const acquireCaseFieldLease=vi.fn().mockImplementation(async(id:string,key:string)=>({
    case_id:id,field_key:key,actor_label:'Poste Windows',expires_at:Date.now()/1000+45,
    lease_token:`lease-token-for-${key}-long-enough`,owned_by_me:true,
  }));
  const api={case:vi.fn().mockResolvedValue(initial),caseFieldLeases:vi.fn().mockResolvedValue([]),
    subscribe:vi.fn().mockReturnValue(()=>{}),acquireCaseFieldLease,patchCaseField:patch,
    releaseCaseFieldLease:vi.fn().mockResolvedValue({status:'released'})} as unknown as CaptureApi;
  const hook=renderHook(()=>{
    const [draft,setDraft]=useState<CaseDraft|null>(initial);
    const collaboration=useCaseCollaboration({api,draft,setDraft,onError});
    return {draft,collaboration};
  });
  return {hook,api,onError,acquireCaseFieldLease};
}
afterEach(()=>{cleanup();vi.useRealTimers()});

describe('useCaseCollaboration',()=>{
  it('preserves another locally edited field when a server patch arrives',async()=>{
    let resolvePatch!:(value:CaseFieldPatchResult)=>void;
    const patch=vi.fn().mockImplementation(()=>new Promise<CaseFieldPatchResult>(resolve=>{resolvePatch=resolve}));
    const {hook,api}=fixture(patch);
    await waitFor(()=>expect(api.case).toHaveBeenCalled());
    act(()=>hook.result.current.collaboration.editField('registry_number','42'));
    act(()=>hook.result.current.collaboration.bind('registry_number').onBlur());
    await waitFor(()=>expect(patch).toHaveBeenCalledTimes(1));
    act(()=>hook.result.current.collaboration.editField('case_number','LOCAL-PENDING'));
    await act(async()=>resolvePatch({...initial,revision:1,fields:{registry_number:'42',case_number:'REMOTE'},
      field_lease:{case_id:initial.id,field_key:'registry_number',actor_label:'Windows',expires_at:Date.now()/1000+45,owned_by_me:true}}));
    expect(hook.result.current.draft?.fields).toEqual({registry_number:'42',case_number:'LOCAL-PENDING'});
    expect(hook.result.current.collaboration.unsaved).toBe(1);
  });

  it('retains an unsaved local value after a network failure',async()=>{
    const patch=vi.fn().mockRejectedValue(new Error('offline'));
    const {hook,onError,api}=fixture(patch);
    await waitFor(()=>expect(api.case).toHaveBeenCalled());
    act(()=>hook.result.current.collaboration.editField('registry_number','UNSAVED'));
    act(()=>hook.result.current.collaboration.bind('registry_number').onBlur());
    await waitFor(()=>expect(onError).toHaveBeenCalled());
    expect(hook.result.current.draft?.fields.registry_number).toBe('UNSAVED');
    expect(hook.result.current.collaboration.unsaved).toBe(1);
  });

  it('renews a focused field before its 45-second lease expires',async()=>{
    vi.useFakeTimers();
    const {hook,acquireCaseFieldLease}=fixture(vi.fn());
    await act(async()=>{});
    await act(async()=>hook.result.current.collaboration.bind('registry_number').onFocus());
    expect(acquireCaseFieldLease).toHaveBeenCalledTimes(1);
    await act(async()=>vi.advanceTimersByTimeAsync(15000));
    expect(acquireCaseFieldLease).toHaveBeenCalledTimes(2);
  });

  it('shares a pending release between blur and explicit save',async()=>{
    const {hook,api,acquireCaseFieldLease,onError}=fixture(vi.fn());
    await waitFor(()=>expect(api.case).toHaveBeenCalled());
    let finishRelease!:()=>void;
    const release=vi.mocked(api.releaseCaseFieldLease);
    release.mockImplementation(()=>new Promise(resolve=>{finishRelease=()=>resolve({status:'released'})}));
    act(()=>hook.result.current.collaboration.bind('registry_number').onFocus());
    await waitFor(()=>expect(acquireCaseFieldLease).toHaveBeenCalledTimes(1));
    await act(async()=>{});
    act(()=>hook.result.current.collaboration.bind('registry_number').onBlur());
    await waitFor(()=>expect(release).toHaveBeenCalledTimes(1));
    let saved!:Promise<CaseDraft|null>;
    act(()=>{saved=hook.result.current.collaboration.flush()});
    await act(async()=>{});
    expect(release).toHaveBeenCalledTimes(1);
    await act(async()=>{finishRelease();await saved});
    expect(onError).not.toHaveBeenCalled();
  });

  it('waits for release before reacquiring a rapidly refocused field',async()=>{
    const {hook,api,acquireCaseFieldLease}=fixture(vi.fn());
    await waitFor(()=>expect(api.case).toHaveBeenCalled());
    let finishRelease!:()=>void;
    vi.mocked(api.releaseCaseFieldLease).mockImplementation(()=>new Promise(resolve=>{finishRelease=()=>resolve({status:'released'})}));
    act(()=>hook.result.current.collaboration.bind('registry_number').onFocus());
    await act(async()=>{});
    act(()=>hook.result.current.collaboration.bind('registry_number').onBlur());
    await waitFor(()=>expect(api.releaseCaseFieldLease).toHaveBeenCalledTimes(1));
    act(()=>hook.result.current.collaboration.bind('registry_number').onFocus());
    await act(async()=>{});
    expect(acquireCaseFieldLease).toHaveBeenCalledTimes(1);
    await act(async()=>finishRelease());
    await waitFor(()=>expect(acquireCaseFieldLease).toHaveBeenCalledTimes(2));
    expect(acquireCaseFieldLease.mock.calls[1][3]).toBeUndefined();
  });

  it.each(['blur','save'])('releases a delayed focus acquisition before %s finishes',async action=>{
    const {hook,api,acquireCaseFieldLease,onError}=fixture(vi.fn());
    await waitFor(()=>expect(api.case).toHaveBeenCalled());
    let finishAcquire!:(lease:CaseFieldLease)=>void;
    acquireCaseFieldLease.mockImplementationOnce(()=>new Promise(resolve=>{finishAcquire=resolve}));
    act(()=>hook.result.current.collaboration.bind('registry_number').onFocus());
    let saved:Promise<CaseDraft|null>|undefined;
    act(()=>{if(action==='blur')hook.result.current.collaboration.bind('registry_number').onBlur();
      else saved=hook.result.current.collaboration.flush()});
    await act(async()=>{});
    expect(api.releaseCaseFieldLease).not.toHaveBeenCalled();
    await act(async()=>{finishAcquire({case_id:initial.id,field_key:'registry_number',actor_label:'Windows',
      expires_at:Date.now()/1000+45,lease_token:'delayed-focus-lease-token',owned_by_me:true});
      if(saved)await saved});
    await waitFor(()=>expect(api.releaseCaseFieldLease).toHaveBeenCalledWith(initial.id,'registry_number','delayed-focus-lease-token'));
    expect(onError).not.toHaveBeenCalled();
  });

  it('releases a focus lease granted after the editor unmounts without reporting a stale error',async()=>{
    const {hook,api,acquireCaseFieldLease,onError}=fixture(vi.fn());
    await waitFor(()=>expect(api.case).toHaveBeenCalled());
    let finishAcquire!:(lease:CaseFieldLease)=>void;
    acquireCaseFieldLease.mockImplementationOnce(()=>new Promise(resolve=>{finishAcquire=resolve}));
    act(()=>hook.result.current.collaboration.bind('registry_number').onFocus());
    hook.unmount();
    await act(async()=>finishAcquire({case_id:initial.id,field_key:'registry_number',actor_label:'Windows',
      expires_at:Date.now()/1000+45,lease_token:'late-unmounted-focus-token',owned_by_me:true}));
    expect(api.releaseCaseFieldLease).toHaveBeenCalledWith(initial.id,'registry_number','late-unmounted-focus-token');
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not attach a stale acquisition when the same case is reopened',async()=>{
    const onError=vi.fn();
    let finishAcquire!:(value:CaseFieldLease)=>void;
    const api={case:vi.fn().mockImplementation(async(id:string)=>({...initial,id})),caseFieldLeases:vi.fn().mockResolvedValue([]),subscribe:vi.fn().mockReturnValue(()=>{}),
      acquireCaseFieldLease:vi.fn().mockImplementation(()=>new Promise(resolve=>{finishAcquire=resolve})),
      releaseCaseFieldLease:vi.fn().mockResolvedValue({status:'released'})} as unknown as CaptureApi;
    const hook=renderHook(({draft}:{draft:CaseDraft})=>useCaseCollaboration({api,draft,setDraft:vi.fn(),onError}),{initialProps:{draft:initial}});
    act(()=>hook.result.current.bind('registry_number').onFocus());
    hook.rerender({draft:{...initial,id:'10000000-0000-4000-8000-000000000002'}});
    hook.rerender({draft:initial});
    await act(async()=>finishAcquire({case_id:initial.id,field_key:'registry_number',actor_label:'Windows',expires_at:Date.now()/1000+45,lease_token:'old-editor-token',owned_by_me:true}));
    expect(api.releaseCaseFieldLease).toHaveBeenCalledWith(initial.id,'registry_number','old-editor-token');
    expect(hook.result.current.leases).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
  });
});
