import {defineConfig, loadEnv} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({mode}) => {
  const env=loadEnv(mode,'.','');
  const supabaseOrigin=validatedSupabaseOrigin(env.VITE_SUPABASE_URL);
  const connectSources=["'self'",...(supabaseOrigin?[supabaseOrigin]:[])].join(' ');
  const securityHeaders=[
    '/*',
    `  Content-Security-Policy: default-src 'self'; connect-src ${connectSources}; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '  Referrer-Policy: no-referrer',
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: DENY',
    '',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
    '/',
    '  Cache-Control: no-store',
    '',
    '/index.html',
    '  Cache-Control: no-store',
    '',
    '/accept-invite',
    '  Cache-Control: no-store',
    '',
    '/recover',
    '  Cache-Control: no-store',
    ''
  ].join('\n');

  return {plugins:[
    react(),
    {
      name:'valiris-desk-cloudflare-pages',
      generateBundle(){
        this.emitFile({type:'asset',fileName:'_redirects',source:'/* /index.html 200\n'});
        this.emitFile({type:'asset',fileName:'_headers',source:securityHeaders});
      }
    }
  ]};
});

function validatedSupabaseOrigin(value:string|undefined){
  if(!value)return null;
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash||!/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)){
      throw new Error('invalid');
    }
    return url.origin;
  }catch{
    throw new Error('VITE_SUPABASE_URL must be an HTTPS project URL at *.supabase.co');
  }
}
