import {useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {createClient, isAuthError, type Session} from '@supabase/supabase-js';
import {ControlClient, ControlError, type ControlIdentity, type Entitlement,
  type Member, type Organization, type Station} from '@notario/control-client';
import {translate, type Locale} from './i18n';
import './style.css';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const authRoutePath = ['/accept-invite','/recover'].includes(window.location.pathname);
const initialCallbackToken = new URLSearchParams(window.location.hash.slice(1)).get('access_token');
const initialAuthCallback = !!initialCallbackToken || new URLSearchParams(window.location.search).has('code');
const configured = !!url && /^https:\/\//.test(url) && !!key;
const auth = configured ? createClient(url!, key!, {
  auth: {autoRefreshToken:true, persistSession:true, detectSessionInUrl:true},
}) : null;
const control = configured ? new ControlClient(`${url}/functions/v1/control-v1`,
  async () => (await auth!.auth.getSession()).data.session?.access_token ?? null, key!) : null;

type Section = 'overview' | 'members' | 'stations' | 'billing' | 'platform';
type GrantFlow = 'none' | 'enroll' | 'challenge';
type Message = {text: string; good: boolean} | null;

function errorLabel(error: unknown, t: (key: string) => string): string {
  if (error instanceof ControlError) {
    const names: Record<string,string> = {
      CONTROL_FORBIDDEN:'errorForbidden', CONTROL_MFA_REQUIRED:'errorForbidden',
      CONTROL_STATION_LIMIT:'errorStationLimit', CONTROL_MEMBER_CONFLICT:'errorMemberConflict',
      CONTROL_INVITE_FAILED:'errorInvite', CONTROL_ENTITLEMENT_INACTIVE:'errorExpired',
    };
    return t(names[error.code] ?? (error.status === 409 ? 'errorConflict' : 'errorGeneric'));
  }
  if (isAuthError(error)) {
    return t(error.code === 'weak_password' || error.code === 'same_password'
      ? 'errorPassword' : 'errorAuth');
  }
  return t('errorGeneric');
}

function Panel({title, children}: {title:string; children:ReactNode}) {
  return <section className="panel"><h2>{title}</h2>{children}</section>;
}

function memberStatus(member: Member): 'active' | 'pendingInvite' | 'inactive' {
  if (!member.active) return 'inactive';
  return member.invitation_pending ? 'pendingInvite' : 'active';
}

function memberBadgeClass(member: Member): string {
  const status = memberStatus(member);
  return status === 'active' ? 'badge' : `badge ${status === 'inactive' ? 'muted' : 'pending'}`;
}

function App() {
  const [locale,setLocale] = useState<Locale>(() => localStorage.getItem('control-locale') === 'ar' ? 'ar' : 'fr');
  const t = useCallback((name:string) => translate(locale,name),[locale]);
  const [session,setSession] = useState<Session|null>(null);
  const [linkAuthenticated,setLinkAuthenticated] = useState(false);
  const [ready,setReady] = useState(false);
  const [profile,setProfile] = useState<ControlIdentity|null>(null);
  const [mfa,setMfa] = useState<GrantFlow>('none');
  const [factor,setFactor] = useState('');
  const [qr,setQr] = useState('');
  const [secret,setSecret] = useState('');
  const [code,setCode] = useState('');
  const [section,setSection] = useState<Section>('overview');
  const [entitlement,setEntitlement] = useState<Entitlement|null>(null);
  const [members,setMembers] = useState<Member[]>([]);
  const [stations,setStations] = useState<Station[]>([]);
  const [organizations,setOrganizations] = useState<Organization[]>([]);
  const [holders,setHolders] = useState<Member[]>([]);
  const [message,setMessage] = useState<Message>(null);
  const [busy,setBusy] = useState(false);
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [passwordConfirmation,setPasswordConfirmation] = useState('');
  const [resetMode,setResetMode] = useState(() => window.location.pathname === '/recover');
  const [inviteEmail,setInviteEmail] = useState('');
  const [officeName,setOfficeName] = useState('');
  const [newLimit,setNewLimit] = useState(1);
  const [newEnd,setNewEnd] = useState(() => new Date(Date.now()+365*86400000).toISOString().slice(0,10));
  const [selectedOffice,setSelectedOffice] = useState('');
  const [suspended,setSuspended] = useState(false);
  const acceptingInvite = authRoutePath;

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    document.title = locale === 'ar' ? 'Valiris Desk · الفضاء المهني' : 'Valiris Desk · Espace professionnel';
    localStorage.setItem('control-locale',locale);
  },[locale]);

  useEffect(() => {
    if (!auth) {setReady(true); return;}
    void auth.auth.getSession().then(({data}) => {
      setSession(data.session);
      setLinkAuthenticated(current => current || (!!initialCallbackToken && data.session?.access_token === initialCallbackToken));
      setReady(true);
    });
    const {data:{subscription}} = auth.auth.onAuthStateChange((event,next) => {
      setSession(next);
      if (initialAuthCallback && (event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY')) {
        setLinkAuthenticated(true);
      }
    });
    return () => subscription.unsubscribe();
  },[]);

  const load = useCallback(async () => {
    if (!session || !auth || !control || acceptingInvite) return;
    try {
      const [who,aal] = await Promise.all([control.me(),auth.auth.mfa.getAuthenticatorAssuranceLevel()]);
      if (aal.error || !aal.data) throw aal.error ?? new Error('MFA_UNAVAILABLE');
      setProfile(who);
      if ((who.role === 'holder' || who.platform_admin) && aal.data.currentLevel !== 'aal2') {
        const {data,error} = await auth.auth.mfa.listFactors();
        if (error) throw error;
        const verified = data.totp.find(item => item.status === 'verified');
        if (verified) setFactor(verified.id);
        setMfa(verified ? 'challenge' : 'enroll');
        return;
      }
      setMfa('none');
      const tasks: Promise<unknown>[] = [];
      if (who.organization_id) {
        tasks.push(control.entitlement().then(setEntitlement));
        if (who.role === 'holder') {
          tasks.push(control.stations().then(result => setStations(result.stations)));
          tasks.push(control.members().then(result => setMembers(result.members)));
        }
      }
      if (who.platform_admin) tasks.push(control.organizations().then(result => setOrganizations(result.organizations)));
      await Promise.all(tasks);
    } catch (error) {setMessage({text:errorLabel(error,t),good:false});}
  },[session?.access_token,acceptingInvite,t]);

  useEffect(() => {void load();},[load]);
  const selected = useMemo(() => organizations.find(item => item.id === selectedOffice),[organizations,selectedOffice]);
  useEffect(() => {
    if (!selectedOffice || !control || !profile?.platform_admin || mfa !== 'none') return;
    let current = true;
    setHolders([]);
    void control.holders(selectedOffice).then(result=>{if(current)setHolders(result.members)})
      .catch(error=>{if(current)setMessage({text:errorLabel(error,t),good:false})});
    return () => {current=false};
  },[selectedOffice,profile?.platform_admin,mfa,t]);
  useEffect(() => {
    if (!selected) return;
    setNewLimit(selected.control_entitlements?.station_limit ?? 1);
    setNewEnd(selected.control_entitlements?.ends_at.slice(0,10) ?? newEnd);
    setSuspended(selected.control_entitlements?.suspended ?? false);
  },[selected?.id]);

  async function run(action:() => Promise<unknown>, success='success') {
    setBusy(true); setMessage(null);
    try {await action(); setMessage({text:t(success),good:true}); await load();
      if (selectedOffice && profile?.platform_admin) {
        const result = await control!.holders(selectedOffice); setHolders(result.members);
      }
    }
    catch(error) {setMessage({text:errorLabel(error,t),good:false});}
    finally {setBusy(false);}
  }

  async function signIn(event:FormEvent) {
    event.preventDefault();
    await run(async () => {
      const {error} = await auth!.auth.signInWithPassword({email:email.trim(),password});
      if (error) throw error;
      setPassword('');
    });
  }
  async function sendReset(event:FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage(null);
    try {
      const {error} = await auth!.auth.resetPasswordForEmail(email.trim(),
        {redirectTo:`${window.location.origin}/recover`});
      if (error) throw error;
      setMessage({text:t('resetSent'),good:true});
    } catch (error) {setMessage({text:errorLabel(error,t),good:false});}
    finally {setBusy(false);}
  }
  async function accept(event:FormEvent) {
    event.preventDefault();
    if (password !== passwordConfirmation) {
      setMessage({text:t('passwordMismatch'),good:false});
      return;
    }
    await run(async () => {
      const {error} = await auth!.auth.updateUser({password});
      if (error) throw error;
      setPassword(''); setPasswordConfirmation('');
      window.history.replaceState(null,'','/');
      window.location.reload();
    });
  }
  async function enroll() {
    await run(async () => {
      const listed = await auth!.auth.mfa.listFactors();
      if (listed.error) throw listed.error;
      for (const stale of listed.data.all.filter(item => item.factor_type === 'totp' && item.status === 'unverified')) {
        const removed = await auth!.auth.mfa.unenroll({factorId:stale.id});
        if (removed.error) throw removed.error;
      }
      const {data,error} = await auth!.auth.mfa.enroll({factorType:'totp',friendlyName:'Valiris Desk'});
      if (error) throw error;
      setFactor(data.id);
      setQr(data.totp.qr_code);
      setSecret(data.totp.secret);
    });
  }
  async function verify(event:FormEvent) {
    event.preventDefault();
    await run(async () => {
      const {error} = await auth!.auth.mfa.challengeAndVerify({factorId:factor,code:code.trim()});
      if (error) throw error;
      setCode(''); setQr(''); setSecret('');
      const {data} = await auth!.auth.getSession();
      setSession(data.session);
    });
  }
  async function signOut() {
    await auth!.auth.signOut();
    setProfile(null); setEntitlement(null); setMembers([]); setStations([]); setOrganizations([]); setHolders([]);
    setFactor(''); setQr(''); setSecret(''); setMfa('none');
    setMessage(null);
  }
  function date(value:string | null | undefined) {
    return value ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar-MA' : 'fr-MA',
      {dateStyle:'medium'}).format(new Date(value)) : '—';
  }
  function entitlementDate(value:string | null | undefined) {
    return value ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar-MA' : 'fr-MA',
      {dateStyle:'medium',timeZone:'UTC'}).format(new Date(value)) : '—';
  }
  function endDate(value:string) {return new Date(`${value}T23:59:59Z`).toISOString();}

  const header = <header className="topbar"><div className="brand"><span className="brand-mark">VD</span><div><strong>Valiris Desk</strong><small>{t('title')}</small></div></div><div className="top-actions"><label htmlFor="locale">{t('language')}</label><select id="locale" value={locale} onChange={event => setLocale(event.target.value as Locale)}><option value="fr">{t('french')}</option><option value="ar">{t('arabic')}</option></select>{session && <button className="text-button" onClick={() => void signOut()}>{t('signout')}</button>}</div></header>;

  if (!configured) return <><div className="shell">{header}<Panel title={t('title')}><p>{t('configMissing')}</p></Panel></div></>;
  if (!ready) return <><div className="shell">{header}<p>{t('loading')}</p></div></>;
  if (window.location.pathname === '/accept-invite' && !linkAuthenticated) return <div className="shell">{header}<main className="auth-card"><div className="eyebrow">Valiris Desk</div><h1>{t('inviteSetup')}</h1><p className="notice error">{t('inviteLinkInvalid')}</p><a className="text-button link-button" href="/">{t('signin')}</a></main></div>;
  if (!session || (window.location.pathname === '/recover' && !linkAuthenticated)) return <div className="shell">{header}<main className="auth-card"><div className="eyebrow">Valiris Desk</div><h1>{t(resetMode?'recoverTitle':'signin')}</h1><form onSubmit={resetMode?sendReset:signIn}><label>{t('email')}<input type="email" autoComplete="username" required value={email} onChange={event=>setEmail(event.target.value)}/></label>{!resetMode && <label>{t('password')}<input type="password" autoComplete="current-password" required value={password} onChange={event=>setPassword(event.target.value)}/></label>}<button className="primary" disabled={busy}>{busy?t('loading'):t(resetMode?'sendReset':'continue')}</button></form><button className="text-button link-button" onClick={()=>{setResetMode(!resetMode);setMessage(null)}}>{t(resetMode?'signin':'forgotPassword')}</button><p className="hint">{t('resetHelp')}</p>{message && <p className={message.good?'notice good':'notice error'}>{message.text}</p>}</main></div>;
  if (acceptingInvite) return <div className="shell">{header}<main className="auth-card"><div className="eyebrow">Valiris Desk</div><h1>{t(window.location.pathname==='/recover'?'recoverTitle':'inviteSetup')}</h1><p>{t('inviteHint')}</p><form onSubmit={accept}><label>{t('newPassword')}<input type="password" minLength={12} autoComplete="new-password" required value={password} onChange={event=>setPassword(event.target.value)}/></label><label>{t('confirmPassword')}<input type="password" minLength={12} autoComplete="new-password" required value={passwordConfirmation} onChange={event=>setPasswordConfirmation(event.target.value)}/></label><button className="primary" disabled={busy}>{t('setPassword')}</button></form>{message && <p className={message.good?'notice good':'notice error'}>{message.text}</p>}</main></div>;
  if (mfa !== 'none') return <div className="shell">{header}<main className="auth-card"><div className="eyebrow">Valiris Desk</div><h1>{t('mfaTitle')}</h1>{mfa === 'enroll' ? <><p>{t('mfaEnrollHelp')}</p>{!qr && <button className="primary" disabled={busy} onClick={() => void enroll()}>{t('mfaEnroll')}</button>}{qr && <><img className="totp-qr" src={qr} alt={t('mfaQr')}/><p className="secret"><strong>{t('mfaSecret')}:</strong> <code dir="ltr">{secret}</code></p></>}</> : <p>{t('mfaChallengeHelp')}</p>}{factor && <form onSubmit={verify}><label>{t('code')}<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required value={code} onChange={event=>setCode(event.target.value)}/></label><button className="primary" disabled={busy}>{t('verify')}</button></form>}{message && <p className={message.good?'notice good':'notice error'}>{message.text}</p>}</main></div>;

  const canManage = profile?.role === 'holder';
  const nav:Section[] = ['overview',...(canManage?['members','stations']:[]),'billing',...(profile?.platform_admin?['platform']:[])] as Section[];
  return <div className="shell">{header}<div className="layout"><nav className="nav" aria-label={t('title')}>{nav.map(item=><button key={item} className={section===item?'selected':''} onClick={()=>{setSection(item);setMessage(null)}}>{t(item)}</button>)}</nav><main className="content"><div className="page-head"><span className="eyebrow">Valiris Desk / {t(section)}</span><h1>{t(section)}</h1>{profile?.organization_id && <p>{t('role')}: {t(profile.role==='holder'?'roleHolder':'roleOperator')}</p>}</div>{message && <p role="status" className={message.good?'notice good':'notice error'}>{message.text}</p>}
  {section==='overview' && <div className="cards">
    <Panel title={t('office')}><p>{profile?.organization_name ?? t('noOrganization')}</p></Panel>
    <Panel title={t('account')}><p dir="ltr">{session.user.email}</p><p>{t('role')}: {profile?.role?t(profile.role==='holder'?'roleHolder':'roleOperator'):t('platform')}</p></Panel>
    <Panel title={t('confidentiality')}><p>{t('temporaryNote')}</p></Panel>
  </div>}
  {section==='billing' && <Panel title={t('billing')}>{entitlement?<div className="stats"><div><small>{t('stationCount')}</small><strong>{canManage?`${stations.filter(item=>item.active).length} / `:''}{entitlement.station_limit}</strong></div><div><small>{t('licenseEnd')}</small><strong>{entitlementDate(entitlement.ends_at)}</strong></div><div><small>{t('status')}</small><strong>{t(entitlement.suspended?'suspended':Date.parse(entitlement.ends_at)<=Date.now()?'expired':'valid')}</strong></div></div>:<p>{t('noOrganization')}</p>}</Panel>}
  {section==='members' && canManage && <Panel title={t('members')}><div className="table-wrap"><table><thead><tr><th>{t('email')}</th><th>{t('role')}</th><th>{t('status')}</th><th>{t('actions')}</th></tr></thead><tbody>{members.map(item=><tr key={item.user_id}><td dir="ltr">{item.email??item.user_id}</td><td>{t(item.role==='holder'?'roleHolder':'roleOperator')}</td><td><span className={memberBadgeClass(item)}>{t(memberStatus(item))}</span></td><td>{item.role==='operator' && (item.active?<button className="small danger" disabled={busy} onClick={()=>{if(window.confirm(t('revokeConfirm')))void run(()=>control!.revokeOperator(item.user_id))}}>{t('revoke')}</button>:<button className="small" disabled={busy} onClick={()=>void run(()=>control!.restoreOperator(item.user_id))}>{t('restore')}</button>)}</td></tr>)}</tbody></table></div>{!members.length && <p>{t('noItems')}</p>}<form className="inline-form" onSubmit={event=>{event.preventDefault();void run(async()=>{await control!.inviteOperator(inviteEmail.trim());setInviteEmail('')},'inviteSent')}}><label>{t('inviteOperator')}<input type="email" required value={inviteEmail} onChange={event=>setInviteEmail(event.target.value)} placeholder={t('email')}/></label><button className="primary" disabled={busy}>{t('invite')}</button></form></Panel>}
  {section==='stations' && canManage && <Panel title={t('stations')}><p className="hint">{t('stationHelp')}</p><div className="table-wrap"><table><thead><tr><th>{t('stationName')}</th><th>{t('status')}</th><th>{t('lastSeen')}</th><th>{t('actions')}</th></tr></thead><tbody>{stations.map(item=><tr key={item.id}><td>{item.label}</td><td><span className={item.active?'badge':'badge muted'}>{t(item.active?'active':'inactive')}</span></td><td>{date(item.last_seen_at)}</td><td>{item.active && <button className="small danger" disabled={busy} onClick={()=>{if(window.confirm(t('deactivateConfirm')))void run(()=>control!.deactivateStation(item.id))}}>{t('deactivate')}</button>}</td></tr>)}</tbody></table></div>{!stations.length && <p>{t('noItems')}</p>}</Panel>}
  {section==='platform' && profile?.platform_admin && <>
    <Panel title={t('createOffice')}><form className="grid-form" onSubmit={event=>{event.preventDefault();void run(async()=>{const created=await control!.createOrganization(officeName.trim(),newLimit,endDate(newEnd));setOfficeName('');setSelectedOffice(created.id)})}}>
      <label>{t('officeName')}<input required minLength={2} maxLength={160} value={officeName} onChange={event=>setOfficeName(event.target.value)}/></label>
      <label>{t('stationCount')}<input type="number" min={1} max={3} required value={newLimit} onChange={event=>setNewLimit(Number(event.target.value))}/></label>
      <label>{t('licenseEnd')}<input type="date" required value={newEnd} onChange={event=>setNewEnd(event.target.value)}/></label>
      <button className="primary" disabled={busy}>{t('create')}</button>
    </form></Panel>
    <Panel title={t('platformOffices')}>
      <div className="office-list">{organizations.map(item=><button key={item.id} className={selectedOffice===item.id?'office-item selected':'office-item'} onClick={()=>setSelectedOffice(item.id)}><strong>{item.name}</strong><small>{entitlementDate(item.control_entitlements?.ends_at)}</small></button>)}</div>
      {!organizations.length && <p>{t('noItems')}</p>}
      {selected && <div className="office-editor"><h3>{selected.name}</h3>
        <div className="table-wrap"><table><thead><tr><th>{t('email')}</th><th>{t('status')}</th><th>{t('actions')}</th></tr></thead><tbody>{holders.map(item=><tr key={item.user_id}><td dir="ltr">{item.email??item.user_id}</td><td><span className={memberBadgeClass(item)}>{t(memberStatus(item))}</span></td><td>{item.active?<button className="small danger" disabled={busy} onClick={()=>{if(window.confirm(t('revokeConfirm')))void run(()=>control!.revokeHolder(selected.id,item.user_id))}}>{t('revoke')}</button>:<button className="small" disabled={busy} onClick={()=>void run(()=>control!.restoreHolder(selected.id,item.user_id))}>{t('restore')}</button>}</td></tr>)}</tbody></table></div>
        <form className="inline-form" onSubmit={event=>{event.preventDefault();void run(async()=>{await control!.inviteHolder(selected.id,inviteEmail.trim());setInviteEmail('')},'inviteSent')}}><label>{t('holderEmail')}<input type="email" required value={inviteEmail} onChange={event=>setInviteEmail(event.target.value)}/></label><button className="primary" disabled={busy}>{t('inviteHolder')}</button></form>
        <h3>{t('extend')}</h3><form className="grid-form" onSubmit={event=>{event.preventDefault();void run(()=>control!.updateEntitlement(selected.id,newLimit,endDate(newEnd),suspended))}}><label>{t('stationCount')}<input type="number" min={1} max={3} required value={newLimit} onChange={event=>setNewLimit(Number(event.target.value))}/></label><label>{t('licenseEnd')}<input type="date" required value={newEnd} onChange={event=>setNewEnd(event.target.value)}/></label><label className="checkbox"><input type="checkbox" checked={suspended} onChange={event=>setSuspended(event.target.checked)}/>{t('suspension')}</label><button className="primary" disabled={busy}>{t('saveEntitlement')}</button></form>
      </div>}
    </Panel>
  </>}
  </main></div></div>;
}

createRoot(document.getElementById('root')!).render(<App/>);
