'use strict';

const {
  recordFromLive,
  applyLearnedDurations,
  getProgramLearning,
  parseDurationMinutes,
  ensureInsightsCapabilities,
  startInsightsRecorder
} = require('../../lib/smart-wash-duration');
const smartPlanner = require('../../lib/energy-prices/planner');

const TURBO59_DRY_OPTIONS = ['NOT_SELECTED', 'DRYLEVEL_NORMAL'];
const FULL_DRY_OPTIONS = [
  'NOT_SELECTED','NO_DRYLEVEL','DRYLEVEL_NORMAL','DRYLEVEL_30','DRYLEVEL_60','DRYLEVEL_90','DRYLEVEL_120','DRYLEVEL_150','DRYLEVEL_ECO','DRYLEVEL_VERY','DRYLEVEL_IRON','DRYLEVEL_LOW','DRYLEVEL_ENERGY','DRYLEVEL_SPEED'
];
function device(homey,id){if(!id)throw new Error('Geen wasmachine geselecteerd in de widget.');return homey.app.getWasherDevice(id)}
function installPlannerBridge(homey){const app=homey?.app;if(!app||app._smartWashPlannerBridgeInstalled)return;app.calculateCheapestWashWindow=options=>smartPlanner.calculate(app,options);app._averagePriceForWindow=(slots,startMs,endMs)=>smartPlanner.averagePriceForWindow(slots,startMs,endMs);app._smartWashPlannerBridgeInstalled=true;app.log('Slim Wassen dynamisch herplannen actief: zelfde prijsprovider als de planner, vast 15 min voor start.')}

function installPlanStateBridge(d){
  if(!d||d._smartWashPlanStateBridgeInstalled||typeof d._handleWasherStateTransition!=='function')return;
  const original=d._handleWasherStateTransition.bind(d);
  d._handleWasherStateTransition=async currentRaw=>{
    await original(currentRaw);
    const current=String(currentRaw||'').toUpperCase();
    const plan=d.getStoreValue('smart_wash_plan');
    if(!plan||!['starting','started','running'].includes(plan.status))return;
    let next=null;
    const activeStates=['DETECTING','RUNNING','RINSING','SPINNING','DRYING','COOLDOWN','COOL_DOWN','RINSEHOLD','RINSE_HOLD','WASH_REFRESHING','REFRESHING','STEAMSOFTENING','STEAM_SOFTENING'];
    if(activeStates.includes(current)&&plan.status!=='running'){
      next={...plan,status:'running',runningAt:plan.runningAt||Date.now(),lastWasherState:current,lastError:null};
    }else if(activeStates.includes(current)&&plan.status==='running'&&plan.lastWasherState!==current){
      next={...plan,lastWasherState:current};
    }else if(current==='END'&&plan.status!=='completed'){
      const completedAt=Date.now();
      const actualStart=Number(plan.runningAt||plan.startedAt||plan.startingAt);
      next={...plan,status:'completed',completedAt,lastWasherState:current,lastError:null};
      if(Number.isFinite(actualStart)&&completedAt>actualStart)next.actualDurationMinutes=Math.max(1,Math.round((completedAt-actualStart)/60000));
    }else if(current==='ERROR'&&plan.status!=='failed'){
      next={...plan,status:'failed',failedAt:Date.now(),lastWasherState:current,lastError:d._lastError&&d._lastError!=='ERROR_NO'?String(d._lastError):'De wasmachine heeft een storing gemeld.'};
    }
    if(!next)return;
    await d.setStoreValue('smart_wash_plan',next);
    d.log(`Slim Wassen planstatus: ${plan.status} -> ${next.status}${next.lastWasherState?` (${next.lastWasherState})`:''}`);
    d.homey.api.realtime('smart_wash_plan_changed',{deviceId:typeof d.getId==='function'?d.getId():d.getData().id,plan:next}).catch(()=>{});
  };
  d._smartWashPlanStateBridgeInstalled=true;
  d.log('Slim Wassen dynamische planstatus actief: gepland -> gestart -> bezig -> gereed/mislukt.');
}

function ensureCourseOption(course,key,options,fallbackDefault=null){if(!course||!Array.isArray(course.function))return;let fn=course.function.find(x=>x?.value===key);if(!fn){fn={value:key,default:fallbackDefault,selectable:[...options]};course.function.push(fn);return}const existing=Array.isArray(fn.selectable)?fn.selectable:[];fn.selectable=[...new Set([...existing,...options])];if(fn.default===undefined||fn.default===null||fn.default==='')fn.default=fallbackDefault}
function patchWasherDryOptions(d){const courses=d?._courses;if(!courses||typeof courses!=='object')return;if(courses.TURBO59)ensureCourseOption(courses.TURBO59,'dryLevel',TURBO59_DRY_OPTIONS,'NOT_SELECTED');if(courses.WASHDRY)ensureCourseOption(courses.WASHDRY,'dryLevel',FULL_DRY_OPTIONS,'DRYLEVEL_NORMAL');if(courses.DRYONLY)ensureCourseOption(courses.DRYONLY,'dryLevel',FULL_DRY_OPTIONS,'DRYLEVEL_NORMAL')}
async function prepareDevice(d){patchWasherDryOptions(d);installPlanStateBridge(d);await ensureInsightsCapabilities(d);startInsightsRecorder(d);return d}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function enrichLive(d,live){const totalMinutes=parseDurationMinutes(live?.total||d.getCapabilityValue('lg_total'));const remainingMinutes=parseDurationMinutes(live?.remaining||d.getCapabilityValue('lg_remaining'));const progressPercent=Number.isFinite(totalMinutes)&&totalMinutes>0&&Number.isFinite(remainingMinutes)?Math.max(0,Math.min(100,Math.round(((totalMinutes-remainingMinutes)/totalMinutes)*100))):null;const programId=live?.currentProgramId||d._lastProgram||d.getStoreValue('selected_program_id')||null;const dryLevel=live?.liveOptions?.dryLevel||d?._lastWd?.dryLevel||'NOT_SELECTED';const learnedDuration=getProgramLearning(d,programId,{dryLevel});const plan=d.getStoreValue('smart_wash_plan')||null;const actualCycleDuration=Number(d.getCapabilityValue('lg_actual_cycle_duration'));return{...live,totalMinutes:Number.isFinite(totalMinutes)?totalMinutes:null,remainingMinutes:Number.isFinite(remainingMinutes)?remainingMinutes:null,progressPercent,learnedDuration,recentDurations:learnedDuration?.samples?.slice(-5).reverse().map(sample=>({minutes:Number(sample.minutes),actualMinutes:Number.isFinite(Number(sample.actualMinutes))?Number(sample.actualMinutes):null,at:sample.at||null,dryLevel:sample.dryLevel||dryLevel}))||[],actualCycleDuration:Number.isFinite(actualCycleDuration)?actualCycleDuration:null,planDurationMinutes:Number.isFinite(Number(plan?.durationMinutes))?Number(plan.durationMinutes):null,plannedAveragePrice:Number.isFinite(Number(plan?.averagePrice))?Number(plan.averagePrice):null,plannedPriceProvider:plan?.priceProvider||null}}
async function getReadyWidgetState(d){patchWasherDryOptions(d);let state=d.getWidgetState();if(Array.isArray(state?.programs)&&state.programs.length){const live=d.getWidgetLiveStatus();await recordFromLive(d,live).catch(()=>{});return{...applyLearnedDurations(d,state),...enrichLive(d,live)}}for(let i=0;i<6;i++){await sleep(250);patchWasherDryOptions(d);state=d.getWidgetState();if(Array.isArray(state?.programs)&&state.programs.length){const live=d.getWidgetLiveStatus();await recordFromLive(d,live).catch(()=>{});return{...applyLearnedDurations(d,state),...enrichLive(d,live)}}}await d.refreshThinQ2().catch(()=>{});patchWasherDryOptions(d);state=d.getWidgetState();const live=d.getWidgetLiveStatus();await recordFromLive(d,live).catch(()=>{});return{...applyLearnedDurations(d,state),...enrichLive(d,live)}}
module.exports={
 async getState({homey,query}){installPlannerBridge(homey);const d=await prepareDevice(device(homey,query.deviceId));return getReadyWidgetState(d)},
 async getLiveStatus({homey,query}){installPlannerBridge(homey);const d=await prepareDevice(device(homey,query.deviceId));const live=d.getWidgetLiveStatus();await recordFromLive(d,live).catch(()=>{});return enrichLive(d,live)},
 async previewPlan({homey,body}){installPlannerBridge(homey);const d=await prepareDevice(device(homey,body.deviceId));let result;try{result=await smartPlanner.calculate(homey.app,{earliestMs:body.earliestMs,deadlineMs:body.deadlineMs,durationMinutes:body.durationMinutes})}catch(err){homey.app.error(`Slim Wassen preview mislukt: ${err?.message||err}`);throw err}const durationMs=Number(result?.best?.durationMinutes||body.durationMinutes)*60000;const directStart=Number(result?.earliestStart)||smartPlanner.minimumPlanningStart(body.earliestMs);const directAveragePrice=smartPlanner.averagePriceForWindow(result.slots,directStart,directStart+durationMs);const smartAveragePrice=Number(result?.best?.averagePrice);const savingsPerKwh=Number.isFinite(directAveragePrice)&&Number.isFinite(smartAveragePrice)?Math.max(0,directAveragePrice-smartAveragePrice):null;return{...result,directAveragePrice,savingsPerKwh,savingsPercent:Number.isFinite(savingsPerKwh)&&directAveragePrice>0?Math.round((savingsPerKwh/directAveragePrice)*100):null,state:applyLearnedDurations(d,d.getWidgetState())}},
 async savePlan({homey,body}){installPlannerBridge(homey);const d=await prepareDevice(device(homey,body.deviceId));const minStart=smartPlanner.minimumPlanningStart();const requestedStart=Number(body?.plan?.startAt);if(!Number.isFinite(requestedStart)||requestedStart<minStart)throw new Error('De gekozen starttijd is verlopen. Bereken het plan opnieuw; een planning start minimaal 5 minuten vooruit op een kwartiergrens.');return d.setSmartWashPlan({...body.plan,autoReplan:true})},
 async cancelPlan({homey,query}){installPlannerBridge(homey);const d=await prepareDevice(device(homey,query.deviceId));return d.cancelSmartWashPlan()},
 async startNow({homey,body}){installPlannerBridge(homey);const d=await prepareDevice(device(homey,body.deviceId));if(d.getCapabilityValue('lg_remote_control')!==true)throw new Error('Remote Start is niet actief. Zet Remote Start eerst op de wasmachine aan.');homey.setTimeout(async()=>{try{const result=await d.startWasherSingleFlight(body.config||{},'smart-wash-widget');homey.api.realtime('smart_wash_start_result',{deviceId:body.deviceId,ok:result.accepted||result.duplicate,duplicate:!!result.duplicate,message:result.message}).catch(()=>{})}catch(err){d.error('Widget direct starten mislukt:',err);homey.api.realtime('smart_wash_start_result',{deviceId:body.deviceId,ok:false,message:String(err?.message||err)}).catch(()=>{})}},10);return{accepted:true,message:'Startopdracht geaccepteerd'}},
 async wake({homey,body}){installPlannerBridge(homey);const d=await prepareDevice(device(homey,body.deviceId));await d.wakeupWasher();return applyLearnedDurations(d,d.getWidgetState())}
};
