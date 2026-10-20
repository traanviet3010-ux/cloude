/** Native OpenSRO protocol 6 roster/creation through the real HieuSRO Agent.
 * This module NEVER simulates a character or persists an auth token.
 */
export interface CharacterRow {
  name:string;
  id?:number;
  level?:number;
}
export type CreateOptions={name:string;race:"CH"|"EU";gender:"MAN"|"WOMAN"};
export function makeNativeDraft(options:CreateOptions,divisionId:string) {
  const name=options.name.trim();
  if(!/^[A-Za-z][A-Za-z0-9]{1,11}$/.test(name)) {
    throw Error("Tên nhân vật TEST phải có 2–12 ký tự Latin hoặc số, bắt đầu bằng chữ.");
  }
  if(!divisionId || divisionId.length>128)throw Error("Máy chủ nhân vật không hợp lệ.");
  const figure=options.race==="CH" ? (options.gender==="MAN"?"NOBLEBOY":"NOBLEGIRL") : "NOBLE";
  // Native character-create.ts: CH weapon 1 = sword, EU weapon 2 = sword;
  // both accept protector index 1 (heavy armor).
  return {
    divisionId,characterName:name,
    modelCodename:`CHAR_${options.race}_${options.gender}_${figure}`,
    heightIndex:2,volumeIndex:2,
    weaponIndex:options.race==="CH"?1:2,
    protectorIndex:1,armorSelected:true,weaponSelected:true
  };
}
async function nativeRequest<T>(path:string,token:string,body?:object):Promise<T> {
  if(!token)throw Error("Chưa đăng nhập tài khoản TEST.");
  const response=await fetch(path,{
    method:body?"POST":"GET",
    headers:{
      Authorization:`Bearer ${token}`,
      "X-OpenSRO-Protocol":"6",
      Accept:"application/json",
      ...(body?{"Content-Type":"application/json"}:{})
    },
    credentials:"omit",redirect:"error",cache:"no-store",
    ...(body?{body:JSON.stringify(body)}:{})
  });
  if(!response.ok)throw Error(response.status===503 || response.status===502
    ? "GameWorld TEST chưa sẵn sàng, hãy thử lại sau."
    : `Yêu cầu nhân vật thất bại (HTTP ${response.status}).`);
  const mime=response.headers.get("content-type")??"";
  if(!mime.toLowerCase().includes("json"))throw Error("Máy chủ không trả JSON hợp lệ.");
  return await response.json() as T;
}
type NativeResult={nativeResult?:number;nativeErrorCode?:number;character?:CharacterRow;characters?:CharacterRow[]};
export async function fetchRoster(token:string):Promise<CharacterRow[]> {
  const body=await nativeRequest<NativeResult>("/api/character/list",token);
  if(body.nativeResult!==1 || !Array.isArray(body.characters))throw Error("Danh sách nhân vật không đúng giao thức.");
  return body.characters.filter((c):c is CharacterRow=>!!c&&typeof c.name==="string");
}
export async function createNativeCharacter(token:string,divisionId:string,options:CreateOptions):Promise<CharacterRow> {
  const draft=makeNativeDraft(options,divisionId);
  const check=await nativeRequest<NativeResult>("/api/character/name-overlap",token,{
    divisionId,characterName:draft.characterName
  });
  if(check.nativeResult!==1)throw Error(check.nativeErrorCode===17
    ? "Tên nhân vật đã có người sử dụng."
    : `Tên nhân vật không hợp lệ (mã ${check.nativeErrorCode??"?"}).`);
  const result=await nativeRequest<NativeResult>("/api/character/create",token,draft);
  if(result.nativeResult!==1 || !result.character || result.character.name!==draft.characterName){
    throw Error(`Không tạo được nhân vật (mã ${result.nativeErrorCode??"?"}).`);
  }
  return result.character;
}
