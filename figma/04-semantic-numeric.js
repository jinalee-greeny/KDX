// KDX — Semantic numeric tokens (spacing/size/border/comp) aliased to Scale/dimension.
// Run in Figma (use_figma) AFTER 02-scale-dimension.js and 03-semantic-color.js.
// 수치도 색과 동일하게 dimension 프리미티브에 별칭 → comp/pad·comp/gap은 다시 spacing에 별칭(2단).
const colls=await figma.variables.getLocalVariableCollectionsAsync();
const scale=colls.find(c=>c.name==='Scale');const sem=colls.find(c=>c.name==='Semantic');const lm=sem.modes[0].modeId;
let vars=await figma.variables.getLocalVariablesAsync();
const dimId=n=>{const v=vars.find(x=>x.name==='dimension/'+n&&x.variableCollectionId===scale.id);return v?v.id:null;};
let have=new Set(vars.filter(v=>v.variableCollectionId===sem.id).map(v=>v.name));
let n=0;
function aliasDim(name,d,scopes){if(have.has(name))return;const v=figma.variables.createVariable(name,sem,'FLOAT');v.setValueForMode(lm,{type:'VARIABLE_ALIAS',id:dimId(d)});v.scopes=scopes;v.setVariableCodeSyntax('WEB','var(--'+name.replace(/\//g,'-')+')');n++;}
const SP=[["0",0],["25",2],["50",4],["75",6],["100",8],["125",10],["150",12],["200",16],["250",20],["300",24],["400",32],["500",40],["600",48],["800",64]];
for(const [t,d] of SP) aliasDim('spacing/'+t,d,['GAP','WIDTH_HEIGHT']);
const SIZE=[["icon/xs",12],["icon/s",16],["icon/m",20],["icon/l",24],["icon/xl",32],["control/s",32],["control/m",40],["control/l",48],["avatar/s",24],["avatar/m",32],["avatar/l",48],["touch-target/min",48]];
for(const [t,d] of SIZE) aliasDim('size/'+t,d,['WIDTH_HEIGHT']);
const BD=[["hairline",1],["default",1],["strong",2]];
for(const [t,d] of BD) aliasDim('border/'+t,d,['STROKE_FLOAT']);
vars=await figma.variables.getLocalVariablesAsync();have=new Set(vars.filter(v=>v.variableCollectionId===sem.id).map(v=>v.name));
const spId=t=>{const v=vars.find(x=>x.name==='spacing/'+t&&x.variableCollectionId===sem.id);return v?v.id:null;};
function aliasSp(name,tok,scopes){if(have.has(name))return;const v=figma.variables.createVariable(name,sem,'FLOAT');v.setValueForMode(lm,{type:'VARIABLE_ALIAS',id:spId(tok)});v.scopes=scopes;v.setVariableCodeSyntax('WEB','var(--'+name.replace(/\//g,'-')+')');n++;}
const PAD=[["button-x","250"],["button-y","150"],["card","300"],["field-x","200"],["field-y","150"]];
for(const [k,t] of PAD) aliasSp('comp/pad/'+k,t,['GAP']);
const GP=[["xs","50"],["s","100"],["m","150"],["l","250"]];
for(const [k,t] of GP) aliasSp('comp/gap/'+k,t,['GAP']);
return {created:n};
