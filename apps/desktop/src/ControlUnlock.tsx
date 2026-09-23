import {useEffect, useMemo, useState, type FormEvent} from 'react';
import {createClient} from '@supabase/supabase-js';
import {ControlClient, type ControlIdentity} from '@notario/control-client';
import {useUiLocale} from '@notario/ui';
import './control-unlock.css';

type StationState = {public_key:string;station_id:string|null;organization_id:string|null};
export type LocalControlAccess = {email:string;new_work_until:number;finish_until:number;expires_at:number};
type LocalLogin = LocalControlAccess & {token:string;user_id:string;role:'holder'|'operator'};
const copy = {
  fr:{title:'Accès au poste',lead:'Connectez-vous avec votre compte personnel du cabinet.',
    online:'Connexion en ligne',offline:'Connexion hors ligne',email:'Adresse e-mail',password:'Mot de passe',
    submit:'Ouvrir mon espace',busy:'Vérification…',language:'Langue',station:'Nom de ce poste',
    stationDefault:'Poste Windows 1',
    mfa:'Code de vérification',mfaLead:'Saisissez le code de votre application d’authentification.',
    enroll:'Configurer le second facteur',scan:'Scannez ce code QR avec votre application d’authentification.',
    mfaQr:'Code QR de configuration TOTP',
    secret:'Clé manuelle',verify:'Vérifier',error:'Impossible de vous connecter. Vérifiez vos identifiants, votre licence et la connexion.',
    offlineError:'Accès hors ligne refusé. Vérifiez votre mot de passe et la durée de l’autorisation.',
    stationError:'Ce poste appartient à un autre cabinet.',holderRequired:'Le titulaire doit activer ce poste avant la première utilisation.',
    cloudMissing:'La connexion en ligne n’est pas encore configurée sur ce poste.',
    offlineHelp:'Le mode hors ligne fonctionne uniquement après une première connexion sur ce poste.',
    license:'Autorisation locale valable au maximum sept jours.',fr:'Français',ar:'العربية'},
  ar:{title:'الدخول إلى جهاز العمل',lead:'سجل الدخول بحسابك الشخصي في المكتب.',
    online:'تسجيل الدخول عبر الإنترنت',offline:'تسجيل الدخول دون إنترنت',email:'البريد الإلكتروني',password:'كلمة المرور',
    submit:'فتح مساحة العمل',busy:'جارٍ التحقق…',language:'اللغة',station:'اسم هذا الجهاز',
    stationDefault:'جهاز Windows 1',
    mfa:'رمز التحقق',mfaLead:'أدخل الرمز من تطبيق المصادقة.',
    enroll:'إعداد عامل التحقق الثاني',scan:'امسح رمز الاستجابة السريعة بتطبيق المصادقة.',
    mfaQr:'رمز الاستجابة السريعة لإعداد المصادقة',
    secret:'المفتاح اليدوي',verify:'تحقق',error:'تعذر تسجيل الدخول. تحقق من بياناتك والترخيص والاتصال.',
    offlineError:'رُفض الدخول دون إنترنت. تحقق من كلمة المرور ومدة الترخيص.',
    stationError:'هذا الجهاز تابع لمكتب آخر.',holderRequired:'يجب على صاحب المكتب تفعيل هذا الجهاز أولاً.',
    cloudMissing:'لم يُضبط الاتصال عبر الإنترنت على هذا الجهاز بعد.',
    offlineHelp:'يعمل الوضع دون إنترنت بعد تسجيل الدخول لأول مرة على هذا الجهاز.',
    license:'الترخيص المحلي صالح لمدة أقصاها سبعة أيام.',fr:'Français',ar:'العربية'},
} as const;

const cloudUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishable = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const cloudReady = !!cloudUrl && /^https:\/\//.test(cloudUrl) && !!publishable;
const auth = cloudReady ? createClient(cloudUrl!, publishable!, {
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false},
}) : null;
const control = cloudReady ? new ControlClient(`${cloudUrl}/functions/v1/control-v1`,
  async () => (await auth!.auth.getSession()).data.session?.access_token ?? null,publishable!) : null;

export function ControlUnlock({base,bootstrapToken,version,onUnlocked}:{base:string;bootstrapToken:string;
  version:string;onUnlocked:(token:string,identity:ControlIdentity,access:LocalControlAccess)=>Promise<void>}) {
  const {locale,setLocale}=useUiLocale();
  const t = copy[locale];
  const [station,setStation] = useState<StationState|null>(null);
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [stationLabel,setStationLabel] = useState<string>(copy[locale].stationDefault);
  const [mode,setMode] = useState<'online'|'offline'>('online');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [identity,setIdentity] = useState<ControlIdentity|null>(null);
  const [mfaFactor,setMfaFactor] = useState('');
  const [mfaCode,setMfaCode] = useState('');
  const [qr,setQr] = useState('');
  const [secret,setSecret] = useState('');
  const [mfaStep,setMfaStep] = useState<'none'|'enroll'|'challenge'>('none');
  const heading = useMemo(()=>mfaStep==='none'?t.title:t.mfa,[mfaStep,t]);

  useEffect(() => {
    setStationLabel(current => current === copy.fr.stationDefault || current === copy.ar.stationDefault
      ? t.stationDefault : current);
  },[t.stationDefault]);

  async function local<T>(path:string,method='GET',payload?:object):Promise<T> {
    const response = await fetch(`${base}${path}`,{method,
      headers:{Authorization:`Bearer ${bootstrapToken}`,...(payload?{'Content-Type':'application/json'}:{})},
      body:payload?JSON.stringify(payload):undefined,cache:'no-store',credentials:'omit'});
    const data:unknown = await response.json();
    if (!response.ok) throw new Error(typeof data==='object'&&data!==null&&'detail' in data?
      String(data.detail):'LOCAL_CONTROL_FAILED');
    return data as T;
  }
  useEffect(()=>{
    let cancelled=false;
    void (async()=>{
      for(let attempt=0;attempt<20;attempt+=1){
        try{
          const loaded=await local<StationState>('/api/control/station');
          if(!cancelled){setStation(loaded);setError('');}
          return;
        }catch{
          if(cancelled)return;
          if(attempt===19){setError(t.error);return;}
          await new Promise(resolve=>setTimeout(resolve,250));
        }
      }
    })();
    return()=>{cancelled=true};
  },[base,bootstrapToken,t.error]);

  async function finishOnline(who:ControlIdentity) {
    if (!control || !auth || !station || !who.organization_id) throw new Error('CLOUD_UNAVAILABLE');
    if (station.organization_id && station.organization_id !== who.organization_id) {
      setError(t.stationError); return;
    }
    let stationId = station.station_id;
    if (!stationId) {
      if (who.role !== 'holder') {setError(t.holderRequired);return;}
      const created = await control.activateStation(stationLabel.trim(),station.public_key);
      await local('/api/control/station/bind','POST',{
        station_id:created.id,organization_id:who.organization_id});
      stationId = created.id;
      setStation({...station,station_id:stationId,organization_id:who.organization_id});
    }
    const challenge = await control.challenge(stationId);
    const signed = await local<{signature:string}>('/api/control/station/sign','POST',{
      user_id:who.user_id,challenge_id:challenge.challenge_id,nonce:challenge.nonce});
    const grant = await control.lease(stationId,challenge.challenge_id,challenge.nonce,
      signed.signature,version);
    const session = await local<LocalLogin>('/api/control/session/online','POST',{
      grant_token:grant.token,email:email.trim(),password});
    setPassword('');
    await auth.auth.signOut({scope:'local'});
    await onUnlocked(session.token,who,session);
  }

  async function signIn(event:FormEvent) {
    event.preventDefault(); setBusy(true);setError('');
    try {
      if (mode==='offline') {
        const session = await local<LocalLogin>('/api/control/session/offline','POST',{
          email:email.trim(),password});
        setPassword('');
        await onUnlocked(session.token,{user_id:session.user_id,role:session.role,
          organization_id:station?.organization_id??null,organization_name:null,
          platform_admin:false,mfa_required:false},session);
        return;
      }
      if (!auth || !control) {setError(t.cloudMissing);return;}
      const signed = await auth.auth.signInWithPassword({email:email.trim(),password});
      if (signed.error) throw signed.error;
      const who = await control.me();
      if (!who.organization_id) throw new Error('NO_ORGANIZATION');
      setIdentity(who);
      if (who.role==='holder') {
        const aal = await auth.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal.error || !aal.data) throw aal.error??new Error('MFA_UNAVAILABLE');
        if (aal.data.currentLevel!=='aal2') {
          const factors = await auth.auth.mfa.listFactors();
          if (factors.error) throw factors.error;
          const verified = factors.data.totp.find(item=>item.status==='verified');
          if (verified) {setMfaFactor(verified.id);setMfaStep('challenge');}
          else setMfaStep('enroll');
          return;
        }
      }
      await finishOnline(who);
    } catch {setError(mode==='offline'?t.offlineError:t.error);}
    finally {setBusy(false);}
  }

  async function enroll() {
    if (!auth) return;
    setBusy(true);setError('');
    try {
      const result = await auth.auth.mfa.enroll({factorType:'totp',friendlyName:'Valiris Desk'});
      if (result.error) throw result.error;
      setMfaFactor(result.data.id);setQr(result.data.totp.qr_code);
      setSecret(result.data.totp.secret);
    } catch {setError(t.error);} finally {setBusy(false);}
  }
  async function verifyMfa(event:FormEvent) {
    event.preventDefault();if (!auth||!identity) return;
    setBusy(true);setError('');
    try {
      const result = await auth.auth.mfa.challengeAndVerify({factorId:mfaFactor,code:mfaCode.trim()});
      if (result.error) throw result.error;
      setMfaCode('');
      await finishOnline(identity);
    } catch {setError(t.error);} finally {setBusy(false);}
  }
  return <main className="control-unlock" dir={locale==='ar'?'rtl':'ltr'} lang={locale}>
    <div className="control-unlock-card"><div className="control-unlock-top"><strong>Valiris Desk</strong><label>{t.language}<select value={locale} onChange={event=>setLocale(event.target.value as 'fr'|'ar')}><option value="fr">{t.fr}</option><option value="ar">{t.ar}</option></select></label></div>
      <h1>{heading}</h1><p>{mfaStep==='none'?t.lead:t.mfaLead}</p>
      {mfaStep==='none'?<><div className="control-unlock-modes"><button className={mode==='online'?'selected':''} onClick={()=>{setMode('online');setError('')}}>{t.online}</button><button className={mode==='offline'?'selected':''} onClick={()=>{setMode('offline');setError('')}}>{t.offline}</button></div>
        <form onSubmit={signIn}><label>{t.email}<input type="email" required autoComplete="username" value={email} onChange={event=>setEmail(event.target.value)}/></label><label>{t.password}<input type="password" required minLength={mode==='online'?12:1} autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)}/></label>{mode==='online'&&!station?.station_id&&<label>{t.station}<input required maxLength={80} value={stationLabel} onChange={event=>setStationLabel(event.target.value)}/></label>}<button type="submit" className="control-primary" disabled={busy||!station}>{busy?t.busy:t.submit}</button></form>
        <small>{mode==='offline'?t.offlineHelp:t.license}</small></>:<>{mfaStep==='enroll'&&!mfaFactor&&<button className="control-primary" disabled={busy} onClick={()=>void enroll()}>{t.enroll}</button>}{qr&&<><p>{t.scan}</p><img className="control-qr" src={qr} alt={t.mfaQr}/><p>{t.secret}: <code dir="ltr">{secret}</code></p></>}<form onSubmit={verifyMfa}><label>{t.mfa}<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={mfaCode} onChange={event=>setMfaCode(event.target.value)}/></label><button type="submit" className="control-primary" disabled={busy||!mfaFactor}>{busy?t.busy:t.verify}</button></form></>}
      {error&&<p role="alert" className="control-error">{error}</p>}
    </div>
  </main>;
}
