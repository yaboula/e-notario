// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ApiError,CaptureApi} from '@notario/api-client';

afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()});
describe('startup compatibility',()=>{
  it('waits for a starting sidecar before exposing the workspace',async()=>{
    vi.useFakeTimers();
    const fetch=vi.fn().mockRejectedValueOnce(new TypeError('not listening yet')).mockResolvedValue({
      ok:true,json:async()=>({status:'ok',version:'0.8.0-alpha.2',api_version:2}),
    });
    vi.stubGlobal('fetch',fetch);
    const ready=new CaptureApi('http://127.0.0.1:8787','token').waitUntilCompatible('0.8.0-alpha.2',2);
    await vi.advanceTimersByTimeAsync(500);
    expect((await ready).version).toBe('0.8.0-alpha.2');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects an incompatible engine instead of retrying a mixed installation',async()=>{
    const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({status:'ok',version:'0.7.2',api_version:2})});
    vi.stubGlobal('fetch',fetch);
    await expect(new CaptureApi('','token').waitUntilCompatible('0.8.0-alpha.2',2))
      .rejects.toMatchObject({code:'SERVICE_VERSION_MISMATCH'} satisfies Partial<ApiError>);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('partial DOCX revision contract',()=>{
  it('pins generation and returns the server-confirmed revision',async()=>{
    const fetch=vi.fn().mockResolvedValue({ok:true,headers:new Headers({
      'Content-Disposition':'attachment; filename="herencia-20260916-120000.docx"',
      'X-eNotario-Document-Request-Revision':'4',
    }),blob:async()=>new Blob(['synthetic-docx'])});
    vi.stubGlobal('fetch',fetch);
    const output=await new CaptureApi('http://127.0.0.1:8787','token').generateDocument('synthetic-id',4);
    expect(output.revision).toBe(4);
    expect(output.name).toBe('herencia-20260916-120000.docx');
    expect(fetch.mock.calls[0][1]).toMatchObject({method:'POST',cache:'no-store',body:'{"revision":4}'});
  });
  it.each([null,'not-a-number','5'])('rejects a missing, invalid or mismatched revision (%s)',async raw=>{
    const headers=new Headers();if(raw!==null)headers.set('X-eNotario-Document-Request-Revision',raw);
    const blob=vi.fn();
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,headers,blob}));
    await expect(new CaptureApi('','token').generateDocument('synthetic-id',4))
      .rejects.toMatchObject({code:'DOCUMENT_REQUEST_STALE_REVISION'});
    expect(blob).not.toHaveBeenCalled();
  });
});
