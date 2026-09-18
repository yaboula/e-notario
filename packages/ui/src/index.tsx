import {useEffect, useState, type ReactNode} from 'react';
import {ThemeProvider, createTheme, CssBaseline, CircularProgress} from '@mui/material';
import {ScanLine, Check, RotateCcw, Clock3, AlertCircle} from 'lucide-react';
import '@fontsource-variable/inter';
import '@fontsource-variable/noto-sans-arabic';
import './styles.css';
export {RoleIdentityPicker} from './RoleIdentityPicker';
export {RepeatableLegalField} from './RepeatableLegalField';
export {ProfessionalProfileField} from './ProfessionalProfileField';

export {Button, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, Alert,
  Snackbar, Tooltip, Tabs, Tab, LinearProgress, CircularProgress, Chip} from '@mui/material';
export {ArrowUpRight, ArrowLeft, ArrowRight, Check, CheckCheck, Camera, ChevronDown, ChevronRight,
  CircleHelp, Clock3, Download, FileImage, Fingerprint, FolderOpen, ImagePlus, Layers3,
  Maximize2, Monitor, MoreHorizontal, PanelLeftClose, Plus, QrCode, RefreshCw, RotateCcw,
  ScanLine, Settings2, ShieldCheck, Smartphone, Trash2, Upload, Wifi, WifiOff, X, ZoomIn,
  ZoomOut, AlertCircle, CheckCircle2, Link2, Copy, Sun, Move, Focus, Eye, Info} from 'lucide-react';

const theme = createTheme({
  palette: {primary: {main: '#126456', dark: '#0b443b', contrastText: '#fff'},
    background: {default: '#f6f7f8', paper: '#fff'}, text: {primary: '#24332f', secondary: '#72807b'}},
  typography: {fontFamily: 'Inter Variable, Noto Sans Arabic Variable, sans-serif', fontSize: 13,
    button: {textTransform: 'none', fontWeight: 550}},
  shape: {borderRadius: 10},
  components: {
    MuiButton: {defaultProps: {disableElevation: true}, styleOverrides: {root: {minHeight: 40, paddingInline: 17}}},
    MuiDialog: {styleOverrides: {paper: {borderRadius: 18}}},
    MuiTab: {styleOverrides: {root: {textTransform: 'none', minHeight: 44}}},
    MuiTooltip: {defaultProps: {arrow: true}},
  },
});
export function AppTheme({children}: {children: ReactNode}) {return <ThemeProvider theme={theme}><CssBaseline/>{children}</ThemeProvider>}
export function Brand({compact = false}: {compact?: boolean}) {return <div className="brand"><span className="brand-mark"><ScanLine size={21}/></span><span>e-notario<span className="brand-period">.</span>{!compact && <small>WORKSPACE</small>}</span></div>}
export function Status({status, review}: {status?: string; review?: string}) {
  const accepted = review === 'accepted';
  const retake = review === 'retake' || (status && status !== 'success');
  return <span className={`status ${accepted ? 'status-green' : retake ? 'status-amber' : 'status-neutral'}`}>
    {accepted ? <Check size={12}/> : retake ? <RotateCcw size={12}/> : <Clock3 size={12}/>}
    {accepted ? 'Aceptada' : retake ? 'Repetir captura' : 'Por revisar'}
  </span>;
}
export function ProtectedImage({load, alt, className, onLoaded}: {load: (signal: AbortSignal) => Promise<Blob>; alt: string; className?: string; onLoaded?: () => void}) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); let objectUrl = '';
    setUrl(''); setFailed(false);
    load(controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => {if (!controller.signal.aborted) setFailed(true)});
    return () => {controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl)};
  }, [load]);
  if (failed) return <div className="image-loading"><AlertCircle size={22}/><span>No se pudo cargar la imagen.</span></div>;
  return url ? <img className={className} src={url} alt={alt} onLoad={onLoaded} onError={() => setFailed(true)}/> : <div className="image-loading"><CircularProgress size={22}/></div>;
}
export function CardIllustration() {return <div className="document-illustration" aria-hidden="true"><div className="illustration-card"><div className="illustration-top"><span/><i/></div><div className="illustration-content"><div className="illustration-photo"/><div className="illustration-lines"><i/><i/><i/><i/></div></div><div className="illustration-bottom"/></div><span className="corner c1"/><span className="corner c2"/><span className="corner c3"/><span className="corner c4"/></div>}
export function DocumentModeOptions({selected=false,selectedMode,onPartial,onComplete,compact=false}:{selected?:boolean;selectedMode?:'partial'|'complete'|null;onPartial:()=>void;onComplete?:()=>void;compact?:boolean}) {
  const partialSelected=selectedMode?selectedMode==='partial':selected;
  const completeSelected=selectedMode==='complete';
  return <div className={`document-mode-options ${compact?'compact':''}`}>
    <button type="button" className={`document-mode-option ${partialSelected?'selected':''}`} aria-pressed={partialSelected} onClick={onPartial}><strong>Relleno parcial</strong><span>Solo datos aprobados de CNIE. Los demás campos siguen editables en Word.</span><small>{partialSelected?'Seleccionado':'Disponible →'}</small></button>
    <button type="button" className={`document-mode-option ${completeSelected?'selected':onComplete?'':'disabled'}`} disabled={!onComplete} aria-disabled={!onComplete} aria-pressed={completeSelected} onClick={onComplete}><strong>Relleno completo</strong><span>Completa los datos jurídicos en e-notario antes de generar el Word.</span><small>{completeSelected?'Seleccionado':onComplete?'Disponible →':'No disponible'}</small></button>
  </div>;
}
export {useCaseCollaboration} from './useCaseCollaboration';
