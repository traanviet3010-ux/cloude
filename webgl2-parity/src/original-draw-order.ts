/**
 * Preserve the pinned original world/world.ts drawPhase + compareGroups
 * ordering when submitting original WorldGroups through WebGL2.
 * Scene authoring, geometry, terrain selection and material IDs are untouched.
 *
 * Original object material-set order is derived from first occurrence in
 * WorldScene.groups; blended groups keep their original stable sequence.
 */
import type {WorldGroup} from "@/engine/contracts/scene";

export function originalWorldDrawPhase(group:WorldGroup):number{
  const {material}=group;
  if(material.sky)return -1;
  if(material.lightmap)return 2;
  if(material.terrain)return material.blend?1:0;
  if(material.objectFade)return 3;
  return material.blend?4:3;
}
export function orderOriginalWorldGroups(
  groups:readonly WorldGroup[]
):WorldGroup[]{
  const seen=new Set<string>(),objectOrder=new Map<string,number>();
  for(const group of groups){
    if(!group.id||seen.has(group.id))
      throw Error("Original draw order requires unique WorldGroup IDs");
    seen.add(group.id);
    const key=group.materialOrder?.set??group.id;
    if(!objectOrder.has(key))objectOrder.set(key,objectOrder.size);
  }
  return [...groups].sort((a,b)=>{
    const phaseA=originalWorldDrawPhase(a),phaseB=originalWorldDrawPhase(b);
    if(phaseA!==phaseB)return phaseA-phaseB;
    if(phaseA===-1)return a.material.sky!-b.material.sky!;
    if(phaseA===1)
      return (a.material.order??0)-(b.material.order??0)||
        a.id.localeCompare(b.id);
    if(phaseA===3){
      const set=objectOrder.get(a.materialOrder?.set??a.id)!-
        objectOrder.get(b.materialOrder?.set??b.id)!;
      if(set)return set;
      const index=(a.materialOrder?.index??0)-(b.materialOrder?.index??0);
      if(index)return index;
    }
    return phaseA===4?0:a.id.localeCompare(b.id);
  });
}
export function orderOriginalGpuStageEntries<T extends {readonly id:string}>(
 groups:readonly WorldGroup[],entries:readonly T[]
):T[]{
 const sorted=orderOriginalWorldGroups(groups);
 const byId=new Map<string,T>();
 for(const entry of entries){
   if(byId.has(entry.id))
     throw Error("Duplicate original GPU staging group ID");
   byId.set(entry.id,entry);
 }
 if(byId.size!==groups.length)
   throw Error("Original stage draw list and WorldScene group count differ");
 return sorted.map(group=>{
   const entry=byId.get(group.id);
   if(!entry)throw Error("Original native GPU stage missing group: "+group.id);
   return entry;
 });
}
