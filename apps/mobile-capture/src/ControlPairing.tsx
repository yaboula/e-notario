import {useEffect, useState, type FormEvent} from 'react';
import {Button, CircularProgress, QrCode, useUiLocale} from '@notario/ui';

const words={
  fr:{title:'Identifiez votre compte',intro:'Le QR de la station et votre compte personnel sont nécessaires.',
    email:'Adresse e-mail',password:'Mot de passe',device:'Nom du téléphone',
    connect:'Connecter ce téléphone',busy:'Vérification…',
    helper:'Utilisez le compte déjà activé sur ce poste Windows.'},
  ar:{title:'التحقق من حسابك',intro:'يلزم رمز الجهاز وحسابك الشخصي معاً.',
    email:'البريد الإلكتروني',password:'كلمة المرور',device:'اسم الهاتف',
    connect:'ربط هذا الهاتف',busy:'جارٍ التحقق…',
    helper:'استخدم الحساب الذي فُعّل مسبقاً على جهاز ويندوز هذا.'},
} as const;

export function ControlPairing({connecting,onSubmit}:{connecting:boolean;
  onSubmit:(email:string,password:string,deviceName:string)=>Promise<void>}) {
  const {locale}=useUiLocale();
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [device,setDevice]=useState(()=>locale==='ar'?'هاتف محمول':'Téléphone mobile');
  const t=words[locale];
  useEffect(()=>setDevice(current=>current==='Téléphone mobile'||current==='هاتف محمول'
    ?locale==='ar'?'هاتف محمول':'Téléphone mobile':current),[locale]);
  async function submit(event:FormEvent){event.preventDefault();await onSubmit(email.trim(),password,device.trim());setPassword('')}
  return <section className="mobile-panel" lang={locale} dir={locale==='ar'?'rtl':'ltr'}>
    <div className="connection-hero">{connecting?<CircularProgress size={32}/>:<QrCode size={41}/>}</div>
    <h1>{t.title}</h1><p>{t.intro}</p>
    <form className="pair-identity-form" onSubmit={event=>void submit(event)}>
      <label>{t.email}<input type="email" autoComplete="username" required value={email} onChange={event=>setEmail(event.target.value)}/></label>
      <label>{t.password}<input type="password" autoComplete="current-password" required value={password} onChange={event=>setPassword(event.target.value)}/></label>
      <label>{t.device}<input maxLength={48} required value={device} onChange={event=>setDevice(event.target.value)}/></label>
      <Button fullWidth variant="contained" type="submit" disabled={connecting||!device.trim()}>{connecting?t.busy:t.connect}</Button>
    </form><p>{t.helper}</p>
  </section>;
}
