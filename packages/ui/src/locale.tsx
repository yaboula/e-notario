import {createContext, useContext, useEffect, useMemo, useState, type ReactNode} from 'react';

export type UiLocale = 'fr' | 'ar';
type LocaleState = {locale:UiLocale;setLocale:(value:UiLocale)=>void};
const LocaleContext=createContext<LocaleState|null>(null);

export function UiLocaleProvider({children,storageKey='notario.locale',titles}:{children:ReactNode;storageKey?:string;titles?:Record<UiLocale,string>}) {
  const [locale,setLocale]=useState<UiLocale>(()=>localStorage.getItem(storageKey)==='ar'?'ar':'fr');
  useEffect(()=>{
    localStorage.setItem(storageKey,locale);
    document.documentElement.lang=locale;
    document.documentElement.dir=locale==='ar'?'rtl':'ltr';
    if(titles)document.title=titles[locale];
  },[locale,storageKey,titles]);
  const value=useMemo(()=>({locale,setLocale}),[locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useUiLocale():LocaleState {
  return useContext(LocaleContext)??{locale:'fr',setLocale:()=>{}};
}
