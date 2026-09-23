// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AppTheme} from '@notario/ui';
import {ApiError,type CaptureApi} from '@notario/api-client';
import type {ControlIdentity} from '@notario/control-client';
import {afterEach,expect,it,vi} from 'vitest';
import {App} from './main';

afterEach(cleanup);

it('hides the workspace and stops polling after the signed finishing window',()=>{
  const workspace=vi.fn();
  const subscribe=vi.fn();
  const onLock=vi.fn();
  const api={workspace,subscribe} as unknown as CaptureApi;
  const identity:ControlIdentity={user_id:'operator',organization_id:'office',
    organization_name:'Cabinet',role:'operator',platform_admin:false,mfa_required:false};
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});

  render(<AppTheme><QueryClientProvider client={client}><App api={api} version="pilot"
    controlIdentity={identity} controlAccess={{email:'operator@example.test',
      new_work_until:0,finish_until:Math.floor(Date.now()/1000)-1,
      expires_at:Math.floor(Date.now()/1000)-1}} onLock={onLock}/>
  </QueryClientProvider></AppTheme>);

  expect(screen.getByText('L’autorisation de ce poste a expiré.')).toBeTruthy();
  expect(screen.queryByText('De la CNIE au document Word.')).toBeNull();
  expect(workspace).not.toHaveBeenCalled();
  expect(subscribe).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Se connecter pour renouveler'}));
  expect(onLock).toHaveBeenCalledOnce();
});

it('offers offline reauthentication when only the personal session expires',()=>{
  const workspace=vi.fn();
  const subscribe=vi.fn();
  const onLock=vi.fn();
  const api={workspace,subscribe} as unknown as CaptureApi;
  const identity:ControlIdentity={user_id:'operator',organization_id:'office',
    organization_name:'Cabinet',role:'operator',platform_admin:false,mfa_required:false};
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});

  render(<AppTheme><QueryClientProvider client={client}><App api={api} version="pilot"
    controlIdentity={identity} controlAccess={{email:'operator@example.test',
      new_work_until:Math.floor(Date.now()/1000)+86400,
      finish_until:Math.floor(Date.now()/1000)+172800,
      expires_at:Math.floor(Date.now()/1000)-1}} onLock={onLock}/>
  </QueryClientProvider></AppTheme>);

  expect(screen.getByText('Votre session a expiré ou a été interrompue.')).toBeTruthy();
  expect(screen.getByText(/mode hors ligne reste disponible/)).toBeTruthy();
  expect(workspace).not.toHaveBeenCalled();
  expect(subscribe).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Se reconnecter'}));
  expect(onLock).toHaveBeenCalledOnce();
});

it('hides cached work when the station rejects a session before its deadline',async()=>{
  const workspace=vi.fn().mockRejectedValue(new ApiError(401,'CONTROL_SESSION_EXPIRED'));
  const api={workspace,subscribe:vi.fn().mockReturnValue(()=>{})} as unknown as CaptureApi;
  const identity:ControlIdentity={user_id:'operator',organization_id:'office',
    organization_name:'Cabinet',role:'operator',platform_admin:false,mfa_required:false};
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});

  render(<AppTheme><QueryClientProvider client={client}><App api={api} version="pilot"
    controlIdentity={identity} controlAccess={{email:'operator@example.test',
      new_work_until:Math.floor(Date.now()/1000)+86400,
      finish_until:Math.floor(Date.now()/1000)+172800,
      expires_at:Math.floor(Date.now()/1000)+3600}} onLock={()=>{}}/>
  </QueryClientProvider></AppTheme>);

  expect(await screen.findByText('Votre session a expiré ou a été interrompue.')).toBeTruthy();
  expect(screen.queryByText('De la CNIE au document Word.')).toBeNull();
  expect(workspace).toHaveBeenCalledOnce();
});
