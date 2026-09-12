// Legacy landscape entry point. All layouts now share one implementation.
import {fitFormalUI} from './adaptive-ui.mjs';
export {fitFormalUI};
export function fitBattleHUD(snapshot,height){
 const tree=snapshot?.world?.ui??snapshot?.ui;
 return tree?.node==='battle:home'?fitFormalUI(snapshot,{width:height*16/9,height}):snapshot;
}
