// @vitest-environment jsdom
import packageInfo from '../package.json';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import {AppTheme} from '@notario/ui';
import {ApiError,CaptureApi,type Workspace} from '@notario/api-client';
import {afterEach,expect,it,vi} from 'vitest';
import {App} from './main';

afterEach(()=>{cleanup();vi.restoreAllMocks();sessionStorage.clear()});

it('removes mobile case access and the stored token when its session expires',async()=>{
  const workspace:Workspace={approved_identities:[],document_generation_requests:[],case_drafts:[],
    documents:[],captures:[],connected_devices:1,processing:false,mobile_url:null,
    lan_mode:null,retention_minutes:1440};
  const unsubscribe=vi.fn();
  vi.spyOn(CaptureApi.prototype,'health').mockResolvedValue({status:'ok',version:packageInfo.version,api_version:2});
  vi.spyOn(CaptureApi.prototype,'workspace').mockResolvedValue(workspace);
  vi.spyOn(CaptureApi.prototype,'subscribe').mockReturnValue(unsubscribe);
  sessionStorage.setItem('notario.mobile.token','synthetic-session');
  sessionStorage.setItem('notario.mobile.expires_at',String(Date.now()/1000+1.5));

  render(<AppTheme><App/></AppTheme>);
  await screen.findByRole('button',{name:'Ouvrir la caméra'});
  await waitFor(()=>expect(screen.getByText('Votre session mobile a expiré. Scannez un nouveau QR depuis Windows.')).toBeTruthy(),
    {timeout:4000});
  expect(screen.queryByRole('button',{name:'Ouvrir la caméra'})).toBeNull();
  expect(sessionStorage.getItem('notario.mobile.token')).toBeNull();
  expect(sessionStorage.getItem('notario.mobile.expires_at')).toBeNull();
  expect(unsubscribe).toHaveBeenCalled();
});

it('returns to pairing when the station rejects a restored session',async()=>{
  const workspace:Workspace={approved_identities:[],document_generation_requests:[],case_drafts:[],
    documents:[],captures:[],connected_devices:1,processing:false,mobile_url:null,
    lan_mode:null,retention_minutes:1440};
  vi.spyOn(CaptureApi.prototype,'health').mockResolvedValue({status:'ok',version:packageInfo.version,api_version:2});
  vi.spyOn(CaptureApi.prototype,'workspace').mockResolvedValueOnce(workspace)
    .mockRejectedValue(new ApiError(401,'CONTROL_SESSION_EXPIRED'));
  vi.spyOn(CaptureApi.prototype,'subscribe').mockReturnValue(()=>{});
  sessionStorage.setItem('notario.mobile.token','synthetic-session');
  sessionStorage.setItem('notario.mobile.expires_at',String(Date.now()/1000+3600));

  render(<AppTheme><App/></AppTheme>);
  await screen.findByRole('button',{name:'Ouvrir la caméra'});
  await waitFor(()=>expect(screen.getByText('Votre session mobile a expiré. Scannez un nouveau QR depuis Windows.')).toBeTruthy());
  expect(screen.queryByRole('button',{name:'Ouvrir la caméra'})).toBeNull();
  expect(sessionStorage.getItem('notario.mobile.token')).toBeNull();
});
