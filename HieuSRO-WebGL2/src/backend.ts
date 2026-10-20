/** HieuSRO TEST API: Render Free cold-starts must never be confused with bad credentials. */
export class BackendError extends Error {
  constructor(message:string,readonly retryable:boolean,readonly status:number|null=null) {
    super(message);
    this.name="BackendError";
  }
}
function transientStatus(code:number):boolean {return code===502||code===503||code===504||code===429;}
export async function requestBackend<T>(path:string, body?:object,signal?:AbortSignal):Promise<T> {
  let response:Response;
  try {
    response=await fetch(path,{
      method:body?"POST":"GET",
      credentials:"include",cache:"no-store",redirect:"error",
      signal,headers:{
        "X-OpenSRO-Protocol":"6",Accept:"application/json",
        ...(body?{"Content-Type":"application/json"}:{})
      },
      ...(body?{body:JSON.stringify(body)}:{})
    });
  }catch(error) {
    if(signal?.aborted)throw error;
    // On iOS Safari failed proxy handshakes can throw a generic DOMException.
    // Never surface the opaque English message as a supposed login failure.
    throw new BackendError("Không kết nối được backend TEST; dịch vụ Render có thể đang khởi động.",true);
  }
  if(!response.ok) {
    const retryable=transientStatus(response.status);
    throw new BackendError(retryable
      ? `Backend TEST chưa sẵn sàng (HTTP ${response.status}).`
      : `API báo lỗi HTTP ${response.status} tại ${path}.`,retryable,response.status);
  }
  const type=response.headers.get("content-type")?.toLowerCase()??"";
  if(!type.includes("application/json")) {
    // A proxy's HTML error page isn't an empty game-server catalogue.
    throw new BackendError("Backend trả nội dung không phải JSON.",!body,response.status);
  }
  try {return await response.json() as T;}
  catch {throw new BackendError("Dữ liệu từ backend không hợp lệ.",!body,response.status);}
}
