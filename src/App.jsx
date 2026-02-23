import { useState, useEffect, useCallback } from "react";

/* ═══════════════════════════════════════════════════════════
   BLACK-SCHOLES ENGINE
═══════════════════════════════════════════════════════════ */
function erf(x) {
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const sign=x<0?-1:1; x=Math.abs(x);
  const t=1/(1+p*x);
  const y=1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return sign*y;
}
function normCDF(x){return 0.5*(1+erf(x/Math.sqrt(2)));}
function normPDF(x){return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI);}

function bsPrice(S,K,T,r,sigma,type){
  if(T<=0.0001)return type==="call"?Math.max(S-K,0):Math.max(K-S,0);
  const d1=(Math.log(S/K)+(r+0.5*sigma*sigma)*T)/(sigma*Math.sqrt(T));
  const d2=d1-sigma*Math.sqrt(T);
  if(type==="call")return S*normCDF(d1)-K*Math.exp(-r*T)*normCDF(d2);
  return K*Math.exp(-r*T)*normCDF(-d2)-S*normCDF(-d1);
}

function bsGreeks(S,K,T,r,sigma,type){
  if(T<=0.0001){return{delta:type==="call"?(S>=K?1:0):(S<=K?-1:0),gamma:0,theta:0,vega:0};}
  const d1=(Math.log(S/K)+(r+0.5*sigma*sigma)*T)/(sigma*Math.sqrt(T));
  const d2=d1-sigma*Math.sqrt(T);
  const gamma=normPDF(d1)/(S*sigma*Math.sqrt(T));
  const vega=S*normPDF(d1)*Math.sqrt(T)/100;
  let delta,theta;
  if(type==="call"){
    delta=normCDF(d1);
    theta=(-S*normPDF(d1)*sigma/(2*Math.sqrt(T))-r*K*Math.exp(-r*T)*normCDF(d2))/365;
  } else {
    delta=normCDF(d1)-1;
    theta=(-S*normPDF(d1)*sigma/(2*Math.sqrt(T))+r*K*Math.exp(-r*T)*normCDF(-d2))/365;
  }
  return{delta,gamma,theta,vega};
}

/* ═══════════════════════════════════════════════════════════
   STRATEGY LIBRARY
═══════════════════════════════════════════════════════════ */
const STRATEGIES = {
  "Covered Call":{
    desc:"Own 100 shares and sell an OTM call. Generates income but caps upside.",
    risk:"low",view:"neutral-bullish",volView:"low",
    legs:[{type:"call",action:"sell",offset:0.05,qty:1}],requiresStock:true,
    explain:"You already own the stock. By selling a call above the current price you collect premium immediately. If the stock stays below the strike you keep the premium. If it rises above, your shares are called away at the strike — capping your profit. Best in sideways or mildly bullish markets.",
    maxLoss:"Stock falls to zero minus premium received",
    assignmentRisk:"HIGH — short call may be exercised early if deep ITM, especially before dividends.",
    earlyExercise:"American-style short calls are at risk of early assignment. Monitor closely if the call goes deep ITM or near ex-dividend date.",
    marginNote:"Covered by stock position. No additional margin typically required.",
    warnings:["Assignment risk on short call","Upside capped at strike price","Stock can still fall significantly"]
  },
  "Protective Put":{
    desc:"Own 100 shares and buy a put for downside insurance.",
    risk:"low",view:"bullish",volView:"high",
    legs:[{type:"put",action:"buy",offset:-0.05,qty:1}],requiresStock:true,
    explain:"Think of this as buying insurance on your stock. The put gives you the right to sell at the strike price, limiting losses if the stock drops. You pay a premium for this protection. Works best when you're bullish but want a safety net.",
    maxLoss:"Strike price minus stock purchase price minus premium paid",
    assignmentRisk:"NONE — you own the put, no assignment risk.",
    earlyExercise:"As a put buyer, you choose whether to exercise. No early assignment risk.",
    marginNote:"No margin required. Full premium paid upfront.",
    warnings:["Premium cost reduces overall return","Put expires worthless if stock rises strongly"]
  },
  "Bull Call Spread":{
    desc:"Buy a lower strike call, sell a higher strike call. Capped profit, capped loss.",
    risk:"medium",view:"bullish",volView:"any",
    legs:[{type:"call",action:"buy",offset:0,qty:1},{type:"call",action:"sell",offset:0.05,qty:1}],
    explain:"You buy a call near the money and sell one further OTM to offset cost. Max profit is the difference between strikes minus net premium. Max loss is just the net premium paid. A defined-risk, lower-cost alternative to buying a call outright.",
    maxLoss:"Net premium paid",
    assignmentRisk:"MEDIUM — short call can be assigned if ITM at expiry.",
    earlyExercise:"Short leg may be assigned early. Ensure long leg is in place to cover.",
    marginNote:"Spread margin: difference between strikes less net credit.",
    warnings:["Profit capped at short strike","Early assignment possible on short leg"]
  },
  "Bear Put Spread":{
    desc:"Buy a higher strike put, sell a lower strike put. Bearish, defined risk.",
    risk:"medium",view:"bearish",volView:"any",
    legs:[{type:"put",action:"buy",offset:0,qty:1},{type:"put",action:"sell",offset:-0.05,qty:1}],
    explain:"You buy a put near the money and sell one further OTM to reduce cost. Profits when the stock falls. Max profit is the spread width minus net premium. Max loss is the net premium paid.",
    maxLoss:"Net premium paid",
    assignmentRisk:"MEDIUM — short put can be assigned if ITM.",
    earlyExercise:"Short put at risk of early assignment, especially deep ITM.",
    marginNote:"Spread margin required.",
    warnings:["Profit limited to spread width","Assignment risk on short put"]
  },
  "Bull Put Spread":{
    desc:"Sell a higher strike put, buy a lower strike put. Collect premium, bullish.",
    risk:"medium",view:"neutral-bullish",volView:"low",
    legs:[{type:"put",action:"sell",offset:0,qty:1},{type:"put",action:"buy",offset:-0.05,qty:1}],
    explain:"A credit spread — you collect premium upfront. Profit if the stock stays above the short put strike. Max profit is the premium collected. Max loss is the spread width minus premium. Great for income in a bullish or neutral market.",
    maxLoss:"Spread width minus premium received",
    assignmentRisk:"HIGH — short put assignment means buying stock at strike price.",
    earlyExercise:"Short put can be exercised early. Be prepared to buy stock at strike.",
    marginNote:"Margin required equal to max loss of the spread.",
    warnings:["Assigned stock if short put goes ITM","Max loss exceeds premium received"]
  },
  "Bear Call Spread":{
    desc:"Sell a lower strike call, buy a higher strike call. Bearish credit spread.",
    risk:"medium",view:"bearish",volView:"low",
    legs:[{type:"call",action:"sell",offset:0,qty:1},{type:"call",action:"buy",offset:0.05,qty:1}],
    explain:"You sell a call near the money and buy one further OTM. You collect net premium. Profit if stock stays below the short call strike. Max loss is capped at the spread width minus premium.",
    maxLoss:"Spread width minus premium received",
    assignmentRisk:"HIGH — short call assigned means selling stock at strike.",
    earlyExercise:"Short call at risk of early assignment before dividends.",
    marginNote:"Margin required equal to max loss of the spread.",
    warnings:["Assignment on short call","Loss if stock rallies above short strike"]
  },
  "Straddle":{
    desc:"Buy a call and put at the same strike. Profits from large moves either way.",
    risk:"high",view:"volatile",volView:"high",
    legs:[{type:"call",action:"buy",offset:0,qty:1},{type:"put",action:"buy",offset:0,qty:1}],
    explain:"You are betting on a big move — direction does not matter. You pay premium for both a call and put at the same strike. If the stock moves far enough in either direction, one leg profits more than both premiums cost. Best before earnings, FDA decisions, or major events.",
    maxLoss:"Total premium paid (if stock does not move)",
    assignmentRisk:"NONE — you own both options.",
    earlyExercise:"No early assignment risk as both legs are long.",
    marginNote:"Full debit paid upfront. No additional margin.",
    warnings:["Heavy theta decay — time is your enemy","Needs large move to profit","IV crush after events can destroy value"]
  },
  "Strangle":{
    desc:"Buy OTM call and OTM put. Cheaper than straddle, needs bigger move.",
    risk:"high",view:"volatile",volView:"high",
    legs:[{type:"call",action:"buy",offset:0.05,qty:1},{type:"put",action:"buy",offset:-0.05,qty:1}],
    explain:"Similar to a straddle but both options are out-of-the-money, making it cheaper. You need a bigger price move to profit. The trade-off is a lower cost basis.",
    maxLoss:"Total premium paid",
    assignmentRisk:"NONE — long options only.",
    earlyExercise:"No early assignment risk.",
    marginNote:"Full debit paid upfront.",
    warnings:["Needs very large move to be profitable","Theta decay accelerates near expiry","IV crush risk"]
  },
  "Butterfly":{
    desc:"Buy 2 outer strikes, sell 2 middle. Low risk, profits if stock stays flat.",
    risk:"low",view:"neutral",volView:"low",
    legs:[{type:"call",action:"buy",offset:-0.05,qty:1},{type:"call",action:"sell",offset:0,qty:2},{type:"call",action:"buy",offset:0.05,qty:1}],
    explain:"A neutral strategy combining a bull and bear spread. Profit most if the stock lands exactly at the middle strike at expiry. Very low risk (max loss is net debit). The perfect trade if you think the stock goes nowhere.",
    maxLoss:"Net premium paid",
    assignmentRisk:"MEDIUM — short middle strikes can be assigned.",
    earlyExercise:"Middle short legs at risk of assignment.",
    marginNote:"Limited margin due to hedged structure.",
    warnings:["Profit window is narrow","Short legs carry assignment risk","Low reward relative to complexity"]
  },
  "Collar":{
    desc:"Own stock + buy protective put + sell covered call. Defines a profit/loss range.",
    risk:"low",view:"neutral",volView:"any",
    legs:[{type:"put",action:"buy",offset:-0.05,qty:1},{type:"call",action:"sell",offset:0.05,qty:1}],requiresStock:true,
    explain:"A collar locks in a price range for your stock. The put protects against downside. The call caps upside. The short call premium often offsets the put cost, making this low or zero net cost. Popular for protecting large stock positions.",
    maxLoss:"Stock price minus put strike minus net premium",
    assignmentRisk:"HIGH — short call may be exercised, requiring stock delivery.",
    earlyExercise:"Short call assignment means selling stock at strike price early.",
    marginNote:"Covered by stock position. No additional margin typically.",
    warnings:["Upside capped at call strike","Short call assignment risk","Downside only protected to put strike"]
  },
};

const RISK_COL={low:"#10b981",medium:"#f59e0b",high:"#ef4444"};
const RISK_BG={low:"rgba(16,185,129,0.1)",medium:"rgba(245,158,11,0.1)",high:"rgba(239,68,68,0.1)"};

/* ═══════════════════════════════════════════════════════════
   DESIGN TOKENS
═══════════════════════════════════════════════════════════ */
const C={
  bg:"#050810",surface:"#0c1220",surfaceHover:"#111827",
  border:"#1a2535",borderAccent:"#243044",
  accent:"#00d4ff",accentDim:"rgba(0,212,255,0.07)",accentBorder:"rgba(0,212,255,0.2)",
  green:"#10b981",red:"#f43f5e",amber:"#f59e0b",
  text:"#e2e8f0",textMid:"#94a3b8",textDim:"#4a5568",
  mono:"'IBM Plex Mono','Fira Code',monospace",
  sans:"'DM Sans',system-ui,sans-serif",
};

const s={
  root:{minHeight:"100vh",background:C.bg,fontFamily:C.sans,color:C.text,overflowX:"hidden"},
  card:{background:C.surface,borderRadius:12,border:`1px solid ${C.border}`},
  label:{color:C.textDim,fontSize:11,textTransform:"uppercase",letterSpacing:2,fontWeight:600,fontFamily:C.mono,display:"block"},
  btn:{background:`linear-gradient(135deg,#0284c7,${C.accent})`,border:"none",borderRadius:8,padding:"11px 22px",color:"#001a22",fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:C.sans},
  btnSm:{background:`linear-gradient(135deg,#0284c7,${C.accent})`,border:"none",borderRadius:6,padding:"7px 14px",color:"#001a22",fontWeight:700,fontSize:12,cursor:"pointer"},
  btnGhost:{background:"transparent",border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 20px",color:C.textMid,fontWeight:500,fontSize:14,cursor:"pointer",fontFamily:C.sans},
};

/* ═══════════════════════════════════════════════════════════
   SHARED UI
═══════════════════════════════════════════════════════════ */
function Warn({icon="⚠",color="amber",children,style={}}){
  const cols={
    amber:{bg:"rgba(245,158,11,0.07)",b:"rgba(245,158,11,0.2)",c:"#fde68a",ic:C.amber,t:"Warning"},
    red:{bg:"rgba(244,63,94,0.07)",b:"rgba(244,63,94,0.2)",c:"#fca5a5",ic:C.red,t:"Risk Alert"},
    blue:{bg:C.accentDim,b:C.accentBorder,c:"#bae6fd",ic:C.accent,t:"Info"},
  };
  const x=cols[color]||cols.amber;
  return(
    <div style={{background:x.bg,border:`1px solid ${x.b}`,borderRadius:8,padding:"11px 13px",...style}}>
      <div style={{color:x.ic,fontWeight:700,fontSize:10,fontFamily:C.mono,marginBottom:3,textTransform:"uppercase",letterSpacing:1}}>{icon} {x.t}</div>
      <div style={{color:x.c,fontSize:12,lineHeight:1.6}}>{children}</div>
    </div>
  );
}

function Stat({label,value,sub,color}){
  return(
    <div style={{...s.card,padding:"14px 16px"}}>
      <div style={{...s.label,marginBottom:5}}>{label}</div>
      <div style={{fontWeight:700,fontSize:18,fontFamily:C.mono,color:color||C.text}}>{value}</div>
      {sub&&<div style={{color:C.textDim,fontSize:10,marginTop:2}}>{sub}</div>}
    </div>
  );
}

function Slider({label,value,min,max,step,fmt,onChange,ac}){
  return(
    <div style={{marginBottom:15}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
        <span style={s.label}>{label}</span>
        <span style={{fontFamily:C.mono,fontSize:12,fontWeight:700,color:ac||C.accent}}>{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e=>onChange(+e.target.value)} style={{width:"100%",accentColor:ac||C.accent,cursor:"pointer"}}/>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PAYOFF CHART
═══════════════════════════════════════════════════════════ */
function PayoffChart({legs,spot,sigma,dte,r}){
  const Tv=dte/365;
  const pts=Array.from({length:101},(_,i)=>{
    const sv=spot*0.55+spot*0.9*(i/100);
    const pnl=legs.reduce((acc,l)=>{
      const sign=l.action==="buy"?1:-1;
      const qty=l.qty||1;
      const intr=l.type==="call"?Math.max(sv-l.strike,0):Math.max(l.strike-sv,0);
      const prem=bsPrice(spot,l.strike,Tv,r,sigma,l.type);
      return acc+sign*qty*(intr-prem)*100;
    },0);
    return{sv:+sv.toFixed(2),pnl:+pnl.toFixed(2)};
  });

  const W=540,H=200,pad={l:48,r:24,t:22,b:30};
  const xMin=pts[0].sv,xMax=pts[pts.length-1].sv;
  const allPnl=pts.map(p=>p.pnl);
  const yRaw={min:Math.min(...allPnl),max:Math.max(...allPnl)};
  const yPad=(yRaw.max-yRaw.min)*0.15||60;
  const yMin=yRaw.min-yPad, yMax=yRaw.max+yPad;
  const xS=v=>pad.l+(v-xMin)/(xMax-xMin)*(W-pad.l-pad.r);
  const yS=v=>H-pad.b-(v-yMin)/(yMax-yMin)*(H-pad.t-pad.b);
  const z0=yS(0);
  const fullPath=pts.map((p,i)=>`${i===0?"M":"L"}${xS(p.sv).toFixed(1)},${yS(p.pnl).toFixed(1)}`).join(" ");

  const bes=[];
  for(let i=1;i<pts.length;i++){
    if((pts[i-1].pnl<0&&pts[i].pnl>=0)||(pts[i-1].pnl>=0&&pts[i].pnl<0)){
      bes.push(((pts[i-1].sv+pts[i].sv)/2).toFixed(1));
    }
  }

  return(
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"auto",display:"block"}}>
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={C.accent}/><stop offset="100%" stopColor="#818cf8"/>
          </linearGradient>
        </defs>
        {[0.25,0.5,0.75].map(f=>(
          <line key={f} x1={pad.l} y1={H-pad.b-(f*(H-pad.t-pad.b))} x2={W-pad.r} y2={H-pad.b-(f*(H-pad.t-pad.b))}
            stroke={C.border} strokeWidth="1" strokeDasharray="3,5"/>
        ))}
        <line x1={pad.l} y1={z0} x2={W-pad.r} y2={z0} stroke={C.borderAccent} strokeWidth="1.5"/>
        <path d={`${fullPath} L${xS(xMax).toFixed(1)},${z0} L${xS(xMin).toFixed(1)},${z0} Z`}
          fill={C.green} fillOpacity="0.08" style={{clipPath:`inset(0 0 ${(z0/H*100).toFixed(1)}% 0)`}}/>
        <path d={`${fullPath} L${xS(xMax).toFixed(1)},${z0} L${xS(xMin).toFixed(1)},${z0} Z`}
          fill={C.red} fillOpacity="0.1" style={{clipPath:`inset(${(z0/H*100).toFixed(1)}% 0 0 0)`}}/>
        <path d={fullPath} fill="none" stroke="url(#lg)" strokeWidth="2.5"/>
        <line x1={xS(spot)} y1={pad.t} x2={xS(spot)} y2={H-pad.b} stroke={C.textDim} strokeWidth="1" strokeDasharray="4,4"/>
        <text x={xS(spot)} y={H-4} textAnchor="middle" fill={C.textDim} fontSize="8" fontFamily={C.mono}>SPOT</text>
        {bes.map((be,i)=>(
          <g key={i}>
            <line x1={xS(+be)} y1={pad.t} x2={xS(+be)} y2={H-pad.b} stroke={C.amber} strokeWidth="1" strokeDasharray="3,4"/>
            <circle cx={xS(+be)} cy={z0} r="3" fill={C.amber}/>
            <text x={xS(+be)} y={pad.t-4} textAnchor="middle" fill={C.amber} fontSize="8" fontFamily={C.mono}>BE ${be}</text>
          </g>
        ))}
        {[yMin,0,yMax].map(v=>(
          <text key={v} x={pad.l-4} y={yS(v)+3} textAnchor="end" fill={C.textDim} fontSize="8" fontFamily={C.mono}>
            {v>=0?"+":""}{Math.abs(v)>=1000?(v/1000).toFixed(1)+"k":v.toFixed(0)}
          </text>
        ))}
      </svg>
      <div style={{display:"flex",justifyContent:"space-between",padding:"4px 4px 0",marginTop:4}}>
        <span style={{fontFamily:C.mono,fontSize:10,color:C.textDim}}>Max Loss: <strong style={{color:C.red}}>${Math.abs(Math.min(...allPnl)).toFixed(0)}</strong></span>
        <span style={{fontFamily:C.mono,fontSize:10,color:C.textDim}}>Breakeven{bes.length>1?"s":""}: <strong style={{color:C.amber}}>{bes.length?bes.map(b=>"$"+b).join(", "):"N/A"}</strong></span>
        <span style={{fontFamily:C.mono,fontSize:10,color:C.textDim}}>Max Profit: <strong style={{color:C.green}}>${Math.max(...allPnl).toFixed(0)}</strong></span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   NAV
═══════════════════════════════════════════════════════════ */
function Nav({screen,setScreen,posCount}){
  const items=[{id:"home",label:"Home"},{id:"builder",label:"Builder"},{id:"lab",label:"Vol Lab"},{id:"dashboard",label:"Dashboard"}];
  return(
    <div style={{borderBottom:`1px solid ${C.border}`,background:"rgba(5,8,16,0.95)",backdropFilter:"blur(12px)",position:"sticky",top:0,zIndex:200}}>
      <div style={{maxWidth:1100,margin:"0 auto",padding:"0 24px",display:"flex",justifyContent:"space-between",alignItems:"center",height:54}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:26,height:26,borderRadius:7,background:`linear-gradient(135deg,#0284c7,${C.accent})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>⚡</div>
          <span style={{fontWeight:800,fontSize:15,fontFamily:C.mono,color:C.accent,letterSpacing:-1}}>OptionsIQ</span>
        </div>
        <div style={{display:"flex",gap:2}}>
          {items.map(n=>(
            <button key={n.id} onClick={()=>setScreen(n.id)}
              style={{padding:"6px 14px",borderRadius:6,border:"none",cursor:"pointer",fontSize:13,fontWeight:500,fontFamily:C.sans,
                background:screen===n.id?C.borderAccent:"transparent",color:screen===n.id?C.text:C.textMid,transition:"all 0.15s",position:"relative"}}>
              {n.label}
              {n.id==="dashboard"&&posCount>0&&<span style={{position:"absolute",top:5,right:7,width:5,height:5,borderRadius:"50%",background:C.accent}}/>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   ONBOARDING
═══════════════════════════════════════════════════════════ */
function Onboarding({onDone}){
  const [step,setStep]=useState(0);
  const [profile,setProfile]=useState({experience:"",objective:"",tolerance:""});
  const steps=[
    {key:"experience",title:"Trading Experience",sub:"How familiar are you with options?",
      opts:[{v:"beginner",label:"Beginner",d:"New to options — learning the basics"},{v:"intermediate",label:"Intermediate",d:"Have traded options, understand basic strategies"},{v:"advanced",label:"Advanced",d:"Regular options trader, comfortable with multi-leg strategies"}]},
    {key:"objective",title:"Your Objective",sub:"What are you primarily looking to achieve?",
      opts:[{v:"income",label:"Generate Income",d:"Collect premium by selling options regularly"},{v:"protection",label:"Protect Holdings",d:"Hedge existing stock positions against downside"},{v:"speculation",label:"Speculate",d:"Take directional or volatility bets for return"}]},
    {key:"tolerance",title:"Risk Tolerance",sub:"How much loss can you comfortably absorb?",
      opts:[{v:"low",label:"Conservative",d:"Protect capital — defined-risk strategies only"},{v:"medium",label:"Moderate",d:"Accept some volatility for improved returns"},{v:"high",label:"Aggressive",d:"Maximise return potential, accept larger drawdowns"}]},
  ];
  const cur=steps[step];
  const done=profile[cur.key]!=="";
  return(
    <div style={{...s.root,display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh"}}>
      <div style={{maxWidth:460,width:"100%",padding:"0 24px"}}>
        <div style={{display:"flex",gap:6,marginBottom:40}}>
          {steps.map((_,i)=>(
            <div key={i} style={{flex:1,height:3,borderRadius:2,background:i<step?C.accent:i===step?"rgba(0,212,255,0.35)":C.border,transition:"background 0.4s"}}/>
          ))}
        </div>
        <div style={{...s.label,marginBottom:6}}>Step {step+1} of {steps.length}</div>
        <h2 style={{fontSize:25,fontWeight:700,margin:"0 0 4px",letterSpacing:-0.5}}>{cur.title}</h2>
        <p style={{color:C.textMid,margin:"0 0 26px",fontSize:14}}>{cur.sub}</p>
        <div style={{display:"flex",flexDirection:"column",gap:9,marginBottom:26}}>
          {cur.opts.map(o=>(
            <button key={o.v} onClick={()=>setProfile(p=>({...p,[cur.key]:o.v}))}
              style={{...s.card,border:`1.5px solid ${profile[cur.key]===o.v?C.accent:C.border}`,background:profile[cur.key]===o.v?C.accentDim:C.surface,textAlign:"left",cursor:"pointer",padding:"15px 17px",transition:"all 0.15s"}}>
              <div style={{fontWeight:600,color:C.text,marginBottom:2,fontSize:14}}>{o.label}</div>
              <div style={{color:C.textMid,fontSize:12,lineHeight:1.4}}>{o.d}</div>
            </button>
          ))}
        </div>
        <div style={{display:"flex",gap:10}}>
          {step>0&&<button style={{...s.btnGhost,flex:1}} onClick={()=>setStep(x=>x-1)}>← Back</button>}
          <button disabled={!done} style={{...s.btn,flex:2,opacity:done?1:0.4}}
            onClick={()=>step<steps.length-1?setStep(x=>x+1):onDone(profile)}>
            {step<steps.length-1?"Continue →":"Enter Platform →"}
          </button>
        </div>
        <div style={{marginTop:18}}>
          <Warn icon="🔒" color="blue">Your profile determines which strategies are recommended and triggers appropriate risk disclosures. Built-in safety by design.</Warn>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   HOME — STRATEGY RECOMMENDER
═══════════════════════════════════════════════════════════ */
function Home({profile,setSelectedStrategy,setScreen}){
  const [view,setView]=useState("");
  const [volView,setVolView]=useState("");
  const [showLib,setShowLib]=useState(false);

  const recs=Object.entries(STRATEGIES)
    .filter(([,st])=>{
      if(!view||!volView)return false;
      const vm=st.view===view||st.view==="any"||(view==="neutral-bullish"&&["neutral","neutral-bullish","bullish"].includes(st.view));
      const vv=st.volView===volView||st.volView==="any";
      return vm&&vv;
    })
    .map(([name,st])=>({name,...st}));

  const viewOpts=[
    {v:"bullish",label:"Bullish ↑",col:C.green},{v:"bearish",label:"Bearish ↓",col:C.red},
    {v:"neutral",label:"Neutral →",col:C.textMid},{v:"volatile",label:"High Vol ⚡",col:C.amber}
  ];
  const volOpts=[
    {v:"high",label:"IV Rising",sub:"Favour long vega (buying options)",col:C.amber},
    {v:"low",label:"IV Falling / Low",sub:"Favour short vega (selling premium)",col:"#818cf8"}
  ];

  return(
    <div style={{maxWidth:1100,margin:"0 auto",padding:"40px 24px"}}>
      <div style={{marginBottom:36}}>
        <p style={{...s.label,color:C.accent,marginBottom:7}}>Strategy Recommender</p>
        <h1 style={{fontSize:28,fontWeight:800,margin:"0 0 7px",letterSpacing:-1}}>What is your market view?</h1>
        <p style={{color:C.textMid,fontSize:14,margin:0}}>Select your directional and volatility outlook to get matched strategies with full rationale.</p>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:30}}>
        <div style={{...s.card,padding:"18px"}}>
          <div style={{...s.label,marginBottom:12}}>Directional View</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {viewOpts.map(o=>(
              <button key={o.v} onClick={()=>setView(v=>v===o.v?"":o.v)}
                style={{padding:"13px",borderRadius:8,border:`1.5px solid ${view===o.v?o.col:C.border}`,
                  background:view===o.v?`${o.col}15`:C.surfaceHover,
                  color:view===o.v?o.col:C.textMid,fontWeight:600,fontSize:13,cursor:"pointer",transition:"all 0.15s"}}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{...s.card,padding:"18px"}}>
          <div style={{...s.label,marginBottom:12}}>Volatility View</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {volOpts.map(o=>(
              <button key={o.v} onClick={()=>setVolView(v=>v===o.v?"":o.v)}
                style={{padding:"13px",borderRadius:8,border:`1.5px solid ${volView===o.v?o.col:C.border}`,
                  background:volView===o.v?`${o.col}15`:C.surfaceHover,
                  color:volView===o.v?o.col:C.textMid,fontWeight:700,fontSize:12,cursor:"pointer",transition:"all 0.15s"}}>
                {o.label}
                <div style={{fontSize:10,marginTop:3,fontWeight:400,color:C.textDim}}>{o.sub}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {view&&volView&&(
        <div style={{marginBottom:30}}>
          <div style={{...s.label,color:C.accent,marginBottom:14}}>
            {recs.length} recommended strateg{recs.length!==1?"ies":"y"} for {view} + {volView} IV
          </div>
          {recs.length===0?(
            <Warn icon="ℹ" color="blue">No exact match for this combination. Adjust your view or browse the full library below.</Warn>
          ):(
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:12}}>
              {recs.map(st=>(
                <div key={st.name} style={{...s.card,padding:"18px",border:`1px solid ${C.borderAccent}`,cursor:"pointer"}}
                  onMouseEnter={e=>e.currentTarget.style.borderColor=C.accentBorder}
                  onMouseLeave={e=>e.currentTarget.style.borderColor=C.borderAccent}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                    <div style={{fontWeight:700,fontSize:15}}>{st.name}</div>
                    <span style={{fontSize:10,fontWeight:700,fontFamily:C.mono,padding:"2px 8px",borderRadius:100,background:RISK_BG[st.risk],color:RISK_COL[st.risk]}}>{st.risk}</span>
                  </div>
                  <p style={{color:C.textMid,fontSize:12,lineHeight:1.6,margin:"0 0 6px"}}>{st.explain.slice(0,160)}…</p>
                  <div style={{color:C.textDim,fontSize:11,marginBottom:12}}>Max loss: {st.maxLoss}</div>
                  <button style={s.btnSm} onClick={()=>{setSelectedStrategy(st.name);setScreen("builder");}}>Build this →</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <button onClick={()=>setShowLib(v=>!v)} style={{...s.btnGhost,marginBottom:14,fontSize:13}}>
          {showLib?"Hide":"Browse"} Full Strategy Library ({Object.keys(STRATEGIES).length} strategies)
        </button>
        {showLib&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:8}}>
            {Object.entries(STRATEGIES).map(([name,st])=>(
              <button key={name} onClick={()=>{setSelectedStrategy(name);setScreen("builder");}}
                style={{...s.card,padding:"13px 15px",textAlign:"left",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,border:`1px solid ${C.border}`}}>
                <div>
                  <div style={{fontWeight:600,fontSize:13,marginBottom:2}}>{name}</div>
                  <div style={{color:C.textDim,fontSize:11}}>{st.desc.slice(0,50)}…</div>
                </div>
                <span style={{fontSize:10,fontWeight:700,fontFamily:C.mono,padding:"2px 8px",borderRadius:100,background:RISK_BG[st.risk],color:RISK_COL[st.risk],flexShrink:0}}>{st.risk}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   BUILDER
═══════════════════════════════════════════════════════════ */
function Builder({selectedStrategy,setSelectedStrategy,params,setParams,setScreen,addPosition}){
  const [explainMode,setExplainMode]=useState(false);
  const [tab,setTab]=useState("payoff");
  const [qty,setQty]=useState(1);
  const [orderType,setOrderType]=useState("market");
  const [limitPrice,setLimitPrice]=useState("");

  const st=STRATEGIES[selectedStrategy];
  const Tv=params.dte/365;

  const legs=st.legs.map((l,i)=>({...l,strike:+(params.spot*(1+l.offset)).toFixed(2),id:i}));

  const calc=legs.map(l=>{
    const sign=l.action==="buy"?1:-1;
    const qty_=l.qty||1;
    const mp=bsPrice(params.spot,l.strike,Tv,params.r,params.sigma,l.type);
    const g=bsGreeks(params.spot,l.strike,Tv,params.r,params.sigma,l.type);
    return{...l,mp,sign,
      delta:g.delta*sign*qty_,gamma:g.gamma*sign*qty_,
      theta:g.theta*sign*qty_,vega:g.vega*sign*qty_};
  });

  const net={
    premium:calc.reduce((a,b)=>a+b.sign*(b.qty||1)*b.mp,0),
    delta:calc.reduce((a,b)=>a+b.delta,0),
    gamma:calc.reduce((a,b)=>a+b.gamma,0),
    theta:calc.reduce((a,b)=>a+b.theta,0),
    vega:calc.reduce((a,b)=>a+b.vega,0),
  };
  const netCost=net.premium*100*qty;

  const scenarios=[-20,-10,-5,0,5,10,20].map(pct=>{
    const s2=params.spot*(1+pct/100);
    const newT=Math.max(Tv-7/365,0.0001);
    const calc_=(sigma_)=>legs.reduce((acc,l)=>{
      const sign=l.action==="buy"?1:-1;
      return acc+sign*(l.qty||1)*(bsPrice(s2,l.strike,newT,params.r,sigma_,l.type)-bsPrice(params.spot,l.strike,Tv,params.r,params.sigma,l.type))*100*qty;
    },0);
    return{pct,base:+calc_(params.sigma).toFixed(2),volUp:+calc_(params.sigma*1.2).toFixed(2),volDown:+calc_(params.sigma*0.8).toFixed(2)};
  });

  const hasShort=st.legs.some(l=>l.action==="sell");
  const maxLossScenario=Math.min(...scenarios.map(x=>Math.min(x.base,x.volDown)));
  const marginRequired=hasShort?Math.abs(maxLossScenario)*1.2:0;

  const getBreakevens=()=>{
    const pts=Array.from({length:201},(_,i)=>{
      const sv=params.spot*0.55+params.spot*0.9*(i/200);
      const pnl=legs.reduce((acc,l)=>{
        const sign=l.action==="buy"?1:-1;
        const intr=l.type==="call"?Math.max(sv-l.strike,0):Math.max(l.strike-sv,0);
        return acc+sign*(l.qty||1)*(intr-bsPrice(params.spot,l.strike,Tv,params.r,params.sigma,l.type))*100;
      },0);
      return{sv,pnl};
    });
    const bes=[];
    for(let i=1;i<pts.length;i++){
      if((pts[i-1].pnl<0&&pts[i].pnl>=0)||(pts[i-1].pnl>=0&&pts[i].pnl<0)){
        bes.push(((pts[i-1].sv+pts[i].sv)/2).toFixed(2));
      }
    }
    return bes;
  };

  const handleConfirm=()=>{
    const expDate=new Date(Date.now()+params.dte*86400000);
    addPosition({
      id:Date.now(),strategy:selectedStrategy,spot:params.spot,sigma:params.sigma,
      dte:params.dte,qty,legs,net,netCost,
      date:new Date().toLocaleDateString("en-GB"),
      expiry:expDate.toLocaleDateString("en-GB"),
      pnl:0,orderType,
    });
    setScreen("dashboard");
  };

  const tabs=["payoff","greeks","scenarios","assignment"];

  return(
    <div style={{maxWidth:1100,margin:"0 auto",padding:"30px 24px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <button onClick={()=>setScreen("home")} style={{...s.btnGhost,padding:"7px 12px",fontSize:12}}>← Back</button>
          <div>
            <h2 style={{fontSize:21,fontWeight:700,margin:0,letterSpacing:-0.5}}>{selectedStrategy}</h2>
            <div style={{display:"flex",gap:7,marginTop:4}}>
              <span style={{fontSize:10,fontWeight:700,fontFamily:C.mono,padding:"2px 8px",borderRadius:100,background:RISK_BG[st.risk],color:RISK_COL[st.risk]}}>{st.risk} risk</span>
              <span style={{fontSize:10,fontWeight:700,fontFamily:C.mono,padding:"2px 8px",borderRadius:100,background:C.accentDim,color:C.accent,border:`1px solid ${C.accentBorder}`}}>{st.view}</span>
              <span style={{fontSize:10,fontWeight:700,fontFamily:C.mono,padding:"2px 8px",borderRadius:100,background:"rgba(129,140,248,0.1)",color:"#818cf8",border:"1px solid rgba(129,140,248,0.2)"}}>IV {st.volView}</span>
            </div>
          </div>
        </div>
        <button onClick={()=>setExplainMode(v=>!v)}
          style={{...s.btnGhost,fontSize:12,border:`1px solid ${explainMode?C.accent:C.border}`,color:explainMode?C.accent:C.textMid}}>
          📚 {explainMode?"Hide":"Show"} Explain Mode
        </button>
      </div>

      {explainMode&&(
        <div style={{...s.card,border:`1px solid ${C.accentBorder}`,padding:"18px",marginBottom:18,background:C.accentDim}}>
          <div style={{...s.label,color:C.accent,marginBottom:9}}>Strategy Explainer</div>
          <p style={{color:C.text,fontSize:13,lineHeight:1.75,margin:"0 0 14px"}}>{st.explain}</p>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
            <div style={{background:C.surface,borderRadius:8,padding:"12px"}}>
              <div style={{...s.label,marginBottom:4}}>Max Loss</div>
              <div style={{color:C.red,fontSize:12,lineHeight:1.5}}>{st.maxLoss}</div>
            </div>
            <div style={{background:C.surface,borderRadius:8,padding:"12px"}}>
              <div style={{...s.label,marginBottom:4}}>Assignment Risk</div>
              <div style={{color:C.amber,fontSize:12,lineHeight:1.5}}>{st.assignmentRisk.split("—")[0]}</div>
            </div>
            <div style={{background:C.surface,borderRadius:8,padding:"12px"}}>
              <div style={{...s.label,marginBottom:4}}>Margin</div>
              <div style={{color:C.textMid,fontSize:12,lineHeight:1.5}}>{st.marginNote}</div>
            </div>
          </div>
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"330px 1fr",gap:18}}>
        {/* LEFT */}
        <div>
          <div style={{...s.card,padding:"18px",marginBottom:14}}>
            <div style={{...s.label,marginBottom:11}}>Strategy</div>
            <select value={selectedStrategy} onChange={e=>setSelectedStrategy(e.target.value)}
              style={{width:"100%",background:C.surfaceHover,border:`1px solid ${C.border}`,borderRadius:7,padding:"9px 11px",color:C.text,fontSize:13,outline:"none",fontFamily:C.sans,marginBottom:14}}>
              {Object.keys(STRATEGIES).map(x=><option key={x}>{x}</option>)}
            </select>
            <div style={{...s.label,marginBottom:11}}>Market Parameters</div>
            <Slider label="Underlying Price" value={params.spot} min={20} max={500} step={0.5}
              fmt={v=>"$"+v.toFixed(2)} onChange={v=>setParams(p=>({...p,spot:v}))}/>
            <Slider label="Implied Volatility" value={params.sigma} min={0.05} max={1.5} step={0.01}
              fmt={v=>(v*100).toFixed(0)+"%"} onChange={v=>setParams(p=>({...p,sigma:v}))} ac={C.amber}/>
            <Slider label="Days to Expiry" value={params.dte} min={1} max={365} step={1}
              fmt={v=>v+"d"} onChange={v=>setParams(p=>({...p,dte:v}))} ac="#818cf8"/>
            <Slider label="Risk-Free Rate" value={params.r} min={0} max={0.12} step={0.001}
              fmt={v=>(v*100).toFixed(1)+"%"} onChange={v=>setParams(p=>({...p,r:v}))} ac={C.green}/>
          </div>

          <div style={{...s.card,padding:"16px",marginBottom:14}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
              <div>
                <div style={{...s.label,marginBottom:7}}>Contracts</div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <button onClick={()=>setQty(q=>Math.max(1,q-1))} style={{...s.btnGhost,padding:"5px 11px",fontSize:16,lineHeight:1}}>−</button>
                  <span style={{fontFamily:C.mono,fontWeight:700,fontSize:16,color:C.accent,minWidth:22,textAlign:"center"}}>{qty}</span>
                  <button onClick={()=>setQty(q=>q+1)} style={{...s.btnGhost,padding:"5px 11px",fontSize:16,lineHeight:1}}>+</button>
                </div>
              </div>
              <div>
                <div style={{...s.label,marginBottom:7}}>Order Type</div>
                <select value={orderType} onChange={e=>setOrderType(e.target.value)}
                  style={{width:"100%",background:C.surfaceHover,border:`1px solid ${C.border}`,borderRadius:7,padding:"7px 10px",color:C.text,fontSize:12,outline:"none"}}>
                  <option value="market">Market</option>
                  <option value="limit">Limit</option>
                  <option value="mid">Mid-Point</option>
                </select>
              </div>
            </div>
            {orderType==="limit"&&(
              <div style={{marginBottom:10}}>
                <div style={{...s.label,marginBottom:6}}>Limit Price</div>
                <input type="number" step="0.01" value={limitPrice||(Math.abs(netCost).toFixed(2))}
                  onChange={e=>setLimitPrice(e.target.value)}
                  style={{width:"100%",background:C.surfaceHover,border:`1px solid ${C.accentBorder}`,borderRadius:7,padding:"8px 11px",color:C.accent,fontSize:13,outline:"none",fontFamily:C.mono,boxSizing:"border-box"}}/>
              </div>
            )}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"11px 12px",background:"rgba(0,212,255,0.04)",borderRadius:7,border:`1px solid ${C.accentBorder}`}}>
              <div>
                <div style={{...s.label,marginBottom:2}}>Net Position Cost</div>
                <div style={{color:C.textDim,fontSize:10,fontFamily:C.mono}}>{qty}×100×${Math.abs(net.premium).toFixed(3)}</div>
              </div>
              <div style={{fontFamily:C.mono,fontWeight:700,fontSize:17,color:net.premium<0?C.red:C.green}}>
                {net.premium<0?"Pay ":"Recv "}${Math.abs(netCost).toFixed(2)}
              </div>
            </div>
            {marginRequired>0&&(
              <div style={{marginTop:10,padding:"9px 11px",background:"rgba(245,158,11,0.06)",borderRadius:7,border:"1px solid rgba(245,158,11,0.2)"}}>
                <div style={{...s.label,color:C.amber,marginBottom:2}}>Est. Margin / Collateral</div>
                <div style={{fontFamily:C.mono,color:C.amber,fontWeight:700,fontSize:15}}>${marginRequired.toFixed(0)}</div>
                <div style={{color:"#fde68a",fontSize:10,marginTop:2}}>For short leg(s). Contact broker for exact requirement.</div>
              </div>
            )}
          </div>

          {/* Volatility context box */}
          <div style={{...s.card,padding:"14px",marginBottom:14}}>
            <div style={{...s.label,marginBottom:8}}>Volatility Context</div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <span style={{color:C.textMid,fontSize:12}}>Implied Vol (input)</span>
              <span style={{fontFamily:C.mono,fontSize:12,color:C.amber,fontWeight:700}}>{(params.sigma*100).toFixed(0)}%</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <span style={{color:C.textMid,fontSize:12}}>Historical Vol (est.)</span>
              <span style={{fontFamily:C.mono,fontSize:12,color:C.text}}>{(params.sigma*0.82*100).toFixed(0)}%</span>
            </div>
            <div style={{height:3,borderRadius:2,background:C.border,marginBottom:8}}>
              <div style={{height:"100%",width:`${Math.min(params.sigma/1.5*100,100)}%`,background:`linear-gradient(90deg,${C.green},${C.amber},${C.red})`,borderRadius:2}}/>
            </div>
            <div style={{color:C.textDim,fontSize:10,lineHeight:1.55}}>
              IV/HV ratio: {(params.sigma/(params.sigma*0.82)).toFixed(2)}x — {params.sigma>params.sigma*0.82*1.1?"Options appear rich. Selling premium may have an edge.":"Options appear fair to cheap. Buying vol may have an edge."} Note: real markets exhibit a vol smile/skew — OTM puts often trade at higher IV.
            </div>
          </div>

          {/* Warnings */}
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
            {st.risk==="high"&&<Warn icon="⚠" color="red">High-risk strategy: substantial or unlimited loss potential. Only proceed if you fully understand the maximum downside.</Warn>}
            {net.theta<-0.05&&<Warn icon="⏱" color="amber">Time decay: this position loses ~${Math.abs(net.theta*100*qty).toFixed(2)}/day. Every day that passes reduces value.</Warn>}
            {st.assignmentRisk?.startsWith("HIGH")&&<Warn icon="📋" color="amber">Assignment risk: {st.assignmentRisk}</Warn>}
            {st.warnings.slice(0,2).map((w,i)=><Warn key={i} icon="•" color="amber">{w}</Warn>)}
          </div>
        </div>

        {/* RIGHT */}
        <div>
          <div style={{display:"flex",gap:3,marginBottom:14,background:C.surface,padding:3,borderRadius:8,width:"fit-content",border:`1px solid ${C.border}`}}>
            {tabs.map(t=>(
              <button key={t} onClick={()=>setTab(t)}
                style={{padding:"7px 14px",borderRadius:6,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:C.sans,
                  background:tab===t?C.borderAccent:"transparent",
                  color:tab===t?C.text:C.textMid,transition:"all 0.15s",textTransform:"capitalize"}}>
                {t}
              </button>
            ))}
          </div>

          {tab==="payoff"&&(
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div style={{...s.card,padding:"18px"}}>
                <div style={{...s.label,marginBottom:13}}>Payoff at Expiry ({qty} contract{qty>1?"s":""})</div>
                <PayoffChart legs={legs.map(l=>({...l,qty:(l.qty||1)*qty}))} spot={params.spot} sigma={params.sigma} dte={params.dte} r={params.r}/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
                <Stat label="Breakeven(s)" value={getBreakevens().length?getBreakevens().map(b=>"$"+b).join(", "):"N/A"} color={C.amber}/>
                <Stat label="Net Premium" value={(net.premium<0?"Pay ":"Recv ")+"$"+Math.abs(netCost).toFixed(2)} color={net.premium<0?C.red:C.green} sub={qty+" contract"+(qty>1?"s":"")}/>
                <Stat label="Margin Est." value={marginRequired>0?"$"+marginRequired.toFixed(0):"None"} color={marginRequired>0?C.amber:C.green} sub={marginRequired>0?"Collateral required":"No margin needed"}/>
              </div>
              <div style={{...s.card,padding:"16px"}}>
                <div style={{...s.label,marginBottom:11}}>Legs Summary</div>
                {legs.map((l,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 11px",background:C.surfaceHover,borderRadius:7,marginBottom:6,border:`1px solid ${l.action==="buy"?"rgba(0,212,255,0.15)":"rgba(244,63,94,0.15)"}`}}>
                    <div>
                      <span style={{color:l.action==="buy"?C.accent:C.red,fontWeight:700,fontSize:12,fontFamily:C.mono}}>{l.action.toUpperCase()}</span>
                      <span style={{color:C.text,fontWeight:600,fontSize:13,marginLeft:8}}>{l.type.toUpperCase()} @ ${l.strike}</span>
                    </div>
                    <span style={{color:C.textMid,fontSize:12,fontFamily:C.mono}}>Mkt ${bsPrice(params.spot,l.strike,Tv,params.r,params.sigma,l.type).toFixed(3)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab==="greeks"&&(
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {[
                  {sym:"Δ",label:"Net Delta",val:net.delta,desc:`P&L change per $1 move. ${net.delta>0?"Long":"Short"} delta — ${net.delta>0?"benefits from upward moves.":"benefits from downward moves."} Net $${Math.abs(net.delta*100*qty).toFixed(2)} per $1 move.`},
                  {sym:"Γ",label:"Net Gamma",val:net.gamma,desc:`Rate of delta change. ${net.gamma>0?"Long":"Short"} gamma. High magnitude means delta shifts rapidly. Accelerates gains (or losses) as spot moves.`},
                  {sym:"Θ",label:"Net Theta",val:net.theta,desc:`Daily time decay. You ${net.theta<0?"LOSE":"GAIN"} $${Math.abs(net.theta*100*qty).toFixed(2)}/day as time passes. ${net.theta<0?"Time is working against you.":"Time is working in your favour."}`},
                  {sym:"V",label:"Net Vega",val:net.vega,desc:`IV sensitivity. $${Math.abs(net.vega*100*qty).toFixed(2)} change per 1% IV move. ${net.vega>0?"Benefits from rising volatility.":"Hurt by rising volatility — short vega position."}`},
                ].map(g=>(
                  <div key={g.sym} style={{...s.card,padding:"17px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:9}}>
                      <span style={{fontFamily:C.mono,fontSize:22,fontWeight:700,color:C.textDim}}>{g.sym}</span>
                      <span style={{fontFamily:C.mono,fontWeight:700,fontSize:19,color:g.val<0?C.red:g.val>0?C.green:C.textMid}}>
                        {g.val>0?"+":""}{g.val.toFixed(4)}
                      </span>
                    </div>
                    <div style={{fontWeight:600,fontSize:13,marginBottom:5}}>{g.label}</div>
                    <div style={{color:C.textDim,fontSize:11,lineHeight:1.6}}>{g.desc}</div>
                  </div>
                ))}
              </div>
              <div style={{...s.card,padding:"16px"}}>
                <div style={{...s.label,marginBottom:11}}>Greeks Aggregation — By Leg</div>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontFamily:C.mono,fontSize:11}}>
                    <thead>
                      <tr>
                        {["Type","Strike","Action","Qty","Market Price","Δ Delta","Γ Gamma","Θ Theta","V Vega"].map(h=>(
                          <th key={h} style={{padding:"6px 8px",textAlign:"left",borderBottom:`1px solid ${C.border}`,color:C.textDim,fontWeight:600,whiteSpace:"nowrap"}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {calc.map((l,i)=>(
                        <tr key={i} style={{borderBottom:`1px solid ${C.border}`}}>
                          <td style={{padding:"7px 8px",color:C.textMid}}>{l.type.toUpperCase()}</td>
                          <td style={{padding:"7px 8px",color:C.text}}>${l.strike}</td>
                          <td style={{padding:"7px 8px",color:l.action==="buy"?C.accent:C.red,fontWeight:700}}>{l.action.toUpperCase()}</td>
                          <td style={{padding:"7px 8px",color:C.textMid}}>{(l.qty||1)*qty}</td>
                          <td style={{padding:"7px 8px",color:C.text}}>${l.mp.toFixed(3)}</td>
                          <td style={{padding:"7px 8px",color:l.delta<0?C.red:C.green}}>{l.delta>0?"+":""}{l.delta.toFixed(3)}</td>
                          <td style={{padding:"7px 8px",color:C.textMid}}>{l.gamma.toFixed(5)}</td>
                          <td style={{padding:"7px 8px",color:l.theta<0?C.red:C.green}}>{l.theta.toFixed(4)}</td>
                          <td style={{padding:"7px 8px",color:l.vega>0?C.green:C.red}}>{l.vega>0?"+":""}{l.vega.toFixed(4)}</td>
                        </tr>
                      ))}
                      <tr style={{borderTop:`2px solid ${C.borderAccent}`,fontWeight:700}}>
                        <td colSpan={5} style={{padding:"7px 8px",color:C.textMid}}>NET AGGREGATE</td>
                        <td style={{padding:"7px 8px",color:net.delta<0?C.red:C.green}}>{net.delta>0?"+":""}{net.delta.toFixed(3)}</td>
                        <td style={{padding:"7px 8px"}}>{net.gamma.toFixed(5)}</td>
                        <td style={{padding:"7px 8px",color:net.theta<0?C.red:C.green}}>{net.theta.toFixed(4)}</td>
                        <td style={{padding:"7px 8px",color:net.vega>0?C.green:C.red}}>{net.vega>0?"+":""}{net.vega.toFixed(4)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p style={{color:C.textDim,fontSize:10,marginTop:8}}>Leg Greeks aggregate by simple summation (sign-adjusted for buy/sell). Real portfolio Greeks should account for correlation and path dependency.</p>
              </div>
            </div>
          )}

          {tab==="scenarios"&&(
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div style={{...s.card,padding:"18px"}}>
                <div style={{...s.label,marginBottom:4}}>Scenario Stress Test — 7-Day P&L</div>
                <p style={{color:C.textDim,fontSize:11,marginBottom:14}}>Three IV scenarios: Base (unchanged), IV +20%, IV -20%. Assumes 7 calendar days pass and position is re-priced using Black-Scholes.</p>
                <div style={{display:"grid",gridTemplateColumns:"60px 1fr 72px 72px 72px",gap:6,marginBottom:6}}>
                  {["Move","","Base","IV+20%","IV-20%"].map((h,i)=>(
                    <div key={i} style={{...s.label,fontSize:9,textAlign:i>=2?"center":"left"}}>{h}</div>
                  ))}
                </div>
                {scenarios.map(({pct,base,volUp,volDown})=>{
                  const maxA=Math.max(...scenarios.flatMap(x=>[Math.abs(x.base),Math.abs(x.volUp),Math.abs(x.volDown)]))||1;
                  const barW=Math.abs(base)/maxA*100;
                  return(
                    <div key={pct} style={{display:"grid",gridTemplateColumns:"60px 1fr 72px 72px 72px",gap:6,alignItems:"center",marginBottom:5}}>
                      <span style={{fontFamily:C.mono,fontSize:11,color:C.textMid}}>{pct>0?"+":""}{pct}%</span>
                      <div style={{height:20,background:C.surfaceHover,borderRadius:3,overflow:"hidden",position:"relative"}}>
                        <div style={{position:"absolute",left:base>=0?"50%":"auto",right:base<0?"50%":"auto",
                          width:`${barW/2}%`,height:"100%",background:base>=0?`${C.green}45`:`${C.red}45`,borderRadius:2}}/>
                        <div style={{position:"absolute",left:"50%",top:0,width:1,height:"100%",background:C.border}}/>
                      </div>
                      {[base,volUp,volDown].map((v,i)=>(
                        <span key={i} style={{fontFamily:C.mono,fontSize:11,color:v>=0?C.green:C.red,textAlign:"center"}}>
                          {v>=0?"+":""}{v.toFixed(0)}
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
              <Warn icon="ℹ" color="blue">
                Real results will differ due to vol skew, bid-ask spreads, and liquidity. IV crush after binary events (earnings, FDA) can significantly erode value even when the stock moves in your direction.
              </Warn>
              <div style={{...s.card,padding:"16px"}}>
                <div style={{...s.label,marginBottom:8}}>Concentration Check</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                  {[
                    {label:"Max Scenario Loss",value:"$"+Math.abs(Math.min(...scenarios.flatMap(x=>[x.base,x.volDown]))).toFixed(0),col:C.red},
                    {label:"Best Scenario Gain",value:"$"+Math.max(...scenarios.flatMap(x=>[x.base,x.volUp])).toFixed(0),col:C.green},
                    {label:"Risk/Reward",value:(Math.max(...scenarios.flatMap(x=>[x.base,x.volUp]))/Math.max(1,Math.abs(Math.min(...scenarios.flatMap(x=>[x.base,x.volDown]))))).toFixed(2)+"x",col:C.accent},
                  ].map(x=>(
                    <div key={x.label} style={{background:C.surfaceHover,borderRadius:8,padding:"10px 12px",textAlign:"center"}}>
                      <div style={{...s.label,fontSize:9,marginBottom:4}}>{x.label}</div>
                      <div style={{fontFamily:C.mono,fontWeight:700,fontSize:15,color:x.col}}>{x.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab==="assignment"&&(
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div style={{...s.card,padding:"18px"}}>
                <div style={{...s.label,marginBottom:11}}>Assignment & Early Exercise Risk</div>
                <p style={{color:C.textMid,fontSize:13,lineHeight:1.7,margin:"0 0 14px"}}>{st.earlyExercise}</p>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
                  <div style={{background:C.surfaceHover,borderRadius:8,padding:"13px"}}>
                    <div style={{...s.label,marginBottom:5,color:C.accent}}>Assignment Level</div>
                    <div style={{fontWeight:700,fontSize:15,color:st.assignmentRisk.startsWith("HIGH")?C.red:st.assignmentRisk.startsWith("MEDIUM")?C.amber:C.green,marginBottom:4}}>
                      {st.assignmentRisk.split("—")[0].trim()}
                    </div>
                    <div style={{color:C.textDim,fontSize:11}}>{st.assignmentRisk.split("—")[1]?.trim()}</div>
                  </div>
                  <div style={{background:C.surfaceHover,borderRadius:8,padding:"13px"}}>
                    <div style={{...s.label,marginBottom:5,color:C.amber}}>Margin / Collateral</div>
                    <div style={{color:C.text,fontSize:12,lineHeight:1.5}}>{st.marginNote}</div>
                  </div>
                </div>
                {hasShort?(
                  <Warn icon="⚠" color="red">Short legs can be assigned at any time before expiry (American-style options). Monitor ITM short positions closely — especially near ex-dividend dates. If assigned on a short call, you must deliver shares. If assigned on a short put, you must purchase shares.</Warn>
                ):(
                  <Warn icon="✓" color="blue">Long-only strategy — no assignment risk. You are the holder of all options and can choose to exercise, sell, or let expire.</Warn>
                )}
              </div>
              <div style={{...s.card,padding:"16px"}}>
                <div style={{...s.label,marginBottom:9}}>What happens if assigned?</div>
                <div style={{color:C.textMid,fontSize:12,lineHeight:1.75}}>
                  {st.legs.some(l=>l.action==="sell"&&l.type==="call")&&
                    <p style={{margin:"0 0 8px"}}>• <strong style={{color:C.text}}>Short Call assigned:</strong> You must sell 100 shares per contract at the strike price. If uncovered (naked), you must first buy shares at market price — potentially an unlimited loss.</p>}
                  {st.legs.some(l=>l.action==="sell"&&l.type==="put")&&
                    <p style={{margin:"0 0 8px"}}>• <strong style={{color:C.text}}>Short Put assigned:</strong> You must buy 100 shares per contract at the strike price, regardless of current market price. Ensure capital or margin is available.</p>}
                  {!hasShort&&
                    <p style={{margin:0}}>No short legs — no assignment risk. You control all exercise decisions.</p>}
                </div>
              </div>
            </div>
          )}

          <div style={{display:"flex",gap:10,marginTop:14}}>
            <button onClick={()=>setScreen("home")} style={{...s.btnGhost,flex:1}}>Cancel</button>
            <button onClick={handleConfirm} style={{...s.btn,flex:2,padding:"13px",fontSize:14}}>
              ✓ Confirm Paper Trade ({orderType})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   VOLATILITY LAB
═══════════════════════════════════════════════════════════ */
function VolLab(){
  const [p,setP]=useState({spot:100,strike:100,sigma:0.25,dte:30,r:0.05,type:"call",action:"buy"});
  const Tv=p.dte/365;
  const price=bsPrice(p.spot,p.strike,Tv,p.r,p.sigma,p.type);
  const g=bsGreeks(p.spot,p.strike,Tv,p.r,p.sigma,p.type);
  const sign=p.action==="buy"?1:-1;

  // Simulated vol smile
  const smilePoints=Array.from({length:11},(_,i)=>{
    const k=p.spot*(0.75+i*0.05);
    const m=k/p.spot;
    const iv=p.sigma*(1+0.18*(1-m)**2+0.04*(m>1?-0.5:1)*(1-m));
    return{k:+k.toFixed(1),iv:+(iv*100).toFixed(1)};
  });

  return(
    <div style={{maxWidth:1100,margin:"0 auto",padding:"32px 24px"}}>
      <div style={{marginBottom:26}}>
        <p style={{...s.label,color:C.accent,marginBottom:6}}>Interactive Tool</p>
        <h2 style={{fontSize:23,fontWeight:700,margin:"0 0 6px",letterSpacing:-0.5}}>Volatility & Greeks Visual Lab</h2>
        <p style={{color:C.textMid,fontSize:14,margin:0}}>Adjust any parameter in real-time to see how price and Greeks respond. Explore IV smile and the impact of time decay.</p>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"290px 1fr",gap:18}}>
        <div style={{...s.card,padding:"18px",height:"fit-content"}}>
          <div style={{...s.label,marginBottom:12}}>Single Option Controls</div>
          <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
            {["call","put"].map(t=>(
              <button key={t} onClick={()=>setP(x=>({...x,type:t}))}
                style={{flex:1,padding:"8px",borderRadius:6,border:`1.5px solid ${p.type===t?(t==="call"?C.accent:C.red):C.border}`,
                  background:p.type===t?(t==="call"?C.accentDim:"rgba(244,63,94,0.08)"):"transparent",
                  color:p.type===t?(t==="call"?C.accent:C.red):C.textMid,fontWeight:700,fontSize:12,cursor:"pointer"}}>
                {t.toUpperCase()}
              </button>
            ))}
            {["buy","sell"].map(a=>(
              <button key={a} onClick={()=>setP(x=>({...x,action:a}))}
                style={{flex:1,padding:"8px",borderRadius:6,border:`1.5px solid ${p.action===a?C.green:C.border}`,
                  background:p.action===a?"rgba(16,185,129,0.1)":"transparent",
                  color:p.action===a?C.green:C.textMid,fontWeight:700,fontSize:12,cursor:"pointer"}}>
                {a.toUpperCase()}
              </button>
            ))}
          </div>
          <Slider label="Spot Price" value={p.spot} min={20} max={300} step={0.5} fmt={v=>"$"+v.toFixed(2)} onChange={v=>setP(x=>({...x,spot:v}))}/>
          <Slider label="Strike Price" value={p.strike} min={p.spot*0.6} max={p.spot*1.4} step={0.5} fmt={v=>"$"+v.toFixed(2)} onChange={v=>setP(x=>({...x,strike:v}))} ac="#818cf8"/>
          <Slider label="Implied Volatility" value={p.sigma} min={0.05} max={1.5} step={0.01} fmt={v=>(v*100).toFixed(0)+"%"} onChange={v=>setP(x=>({...x,sigma:v}))} ac={C.amber}/>
          <Slider label="Days to Expiry" value={p.dte} min={1} max={365} step={1} fmt={v=>v+"d"} onChange={v=>setP(x=>({...x,dte:v}))} ac="#a78bfa"/>
          <Slider label="Risk-Free Rate" value={p.r} min={0} max={0.12} step={0.001} fmt={v=>(v*100).toFixed(1)+"%"} onChange={v=>setP(x=>({...x,r:v}))} ac={C.green}/>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:9}}>
            <Stat label="Option Price" value={"$"+price.toFixed(3)} color={C.accent} sub={p.action+" "+p.type}/>
            <Stat label="Delta Δ" value={(g.delta*sign>0?"+":"")+(g.delta*sign).toFixed(4)} color={g.delta*sign>=0?C.green:C.red} sub="Per $1 move"/>
            <Stat label="Gamma Γ" value={g.gamma.toFixed(5)} sub="Delta rate of change"/>
            <Stat label="Theta Θ" value={(g.theta*sign).toFixed(4)} color={g.theta*sign<0?C.red:C.green} sub="$/day decay"/>
            <Stat label="Vega V" value={(g.vega*sign).toFixed(4)} color={g.vega*sign>0?C.green:C.red} sub="Per 1% IV move"/>
          </div>

          <div style={{...s.card,padding:"18px"}}>
            <div style={{...s.label,marginBottom:13}}>Payoff at Expiry</div>
            <PayoffChart legs={[{...p,offset:0,qty:1}]} spot={p.spot} sigma={p.sigma} dte={p.dte} r={p.r}/>
          </div>

          <div style={{...s.card,padding:"18px"}}>
            <div style={{...s.label,marginBottom:4}}>Simulated Volatility Smile / Skew</div>
            <p style={{color:C.textDim,fontSize:10,marginBottom:14}}>In real markets, OTM puts often trade at higher IV than ATM or OTM calls — creating a skew. This visualises the concept for the current spot price. Your selected strike is highlighted.</p>
            <div style={{display:"flex",alignItems:"flex-end",gap:3,height:80}}>
              {smilePoints.map((pt,i)=>{
                const sel=Math.abs(pt.k-p.strike)<p.spot*0.035;
                const maxIv=Math.max(...smilePoints.map(x=>x.iv));
                const minIv=Math.min(...smilePoints.map(x=>x.iv));
                const barH=minIv===maxIv?40:(pt.iv-minIv)/(maxIv-minIv)*55+12;
                return(
                  <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                    <span style={{fontFamily:C.mono,fontSize:7,color:sel?C.accent:C.textDim}}>{pt.iv}%</span>
                    <div style={{width:"100%",height:barH,borderRadius:"2px 2px 0 0",background:sel?C.accent:`${C.amber}55`,border:sel?`1px solid ${C.accent}`:"none"}}/>
                    <span style={{fontFamily:C.mono,fontSize:6,color:sel?C.accent:C.textDim,transform:"rotate(-45deg)",transformOrigin:"top center",marginTop:4}}>${pt.k}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════════════════════ */
function Dashboard({positions,setScreen}){
  const [pnls,setPnls]=useState(()=>Object.fromEntries(positions.map(p=>[p.id,0])));

  useEffect(()=>{
    setPnls(prev=>{
      const next={...prev};
      positions.forEach(p=>{if(!(p.id in next))next[p.id]=0;});
      return next;
    });
  },[positions]);

  useEffect(()=>{
    const t=setInterval(()=>{
      setPnls(prev=>Object.fromEntries(Object.entries(prev).map(([id,v])=>[id,+(v+(Math.random()*24-12)).toFixed(2)])));
    },2500);
    return()=>clearInterval(t);
  },[]);

  const totalPnl=Object.values(pnls).reduce((a,b)=>a+b,0);
  const aggDelta=positions.reduce((a,p)=>a+p.net.delta*(p.qty||1),0);
  const aggTheta=positions.reduce((a,p)=>a+p.net.theta*(p.qty||1),0);
  const aggVega=positions.reduce((a,p)=>a+p.net.vega*(p.qty||1),0);

  const now=new Date();
  const getDaysLeft=expiry=>{
    const [d,m,y]=expiry.split("/").map(Number);
    return Math.ceil((new Date(y,m-1,d)-now)/86400000);
  };

  const expiryGroups={};
  positions.forEach(p=>{
    if(!expiryGroups[p.expiry])expiryGroups[p.expiry]=[];
    expiryGroups[p.expiry].push(p);
  });
  const sortedExpiries=Object.keys(expiryGroups).sort((a,b)=>getDaysLeft(a)-getDaysLeft(b));

  return(
    <div style={{maxWidth:1100,margin:"0 auto",padding:"32px 24px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:26}}>
        <div>
          <p style={{...s.label,color:C.accent,marginBottom:6}}>Paper Portfolio</p>
          <h2 style={{fontSize:23,fontWeight:700,margin:0,letterSpacing:-0.5}}>Positions Dashboard</h2>
        </div>
        <button onClick={()=>setScreen("home")} style={s.btn}>+ New Strategy</button>
      </div>

      {positions.length===0?(
        <div style={{...s.card,padding:"60px",textAlign:"center",border:`1px dashed ${C.border}`}}>
          <div style={{fontSize:44,marginBottom:14}}>📊</div>
          <div style={{color:C.textMid,fontSize:15,marginBottom:20}}>No positions yet. Paper trade your first strategy to get started.</div>
          <button onClick={()=>setScreen("home")} style={s.btn}>Browse Strategies →</button>
        </div>
      ):(
        <>
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:18}}>
            <Stat label="Total P&L" value={(totalPnl>=0?"+$":"-$")+Math.abs(totalPnl).toFixed(2)} color={totalPnl>=0?C.green:C.red} sub="Unrealized"/>
            <Stat label="Positions" value={positions.length}/>
            <Stat label="Net Delta Δ" value={(aggDelta>0?"+":"")+aggDelta.toFixed(3)} color={aggDelta>0?C.green:C.red} sub="Portfolio"/>
            <Stat label="Net Theta Θ" value={(aggTheta>0?"+":"")+aggTheta.toFixed(4)} color={aggTheta<0?C.red:C.green} sub="$/day"/>
            <Stat label="Net Vega V" value={(aggVega>0?"+":"")+aggVega.toFixed(4)} color={aggVega>0?C.green:C.red} sub="Per 1% IV"/>
          </div>

          {/* Upcoming expiries */}
          <div style={{...s.card,padding:"14px",marginBottom:16}}>
            <div style={{...s.label,marginBottom:10}}>Upcoming Expiries</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {sortedExpiries.map(expiry=>{
                const dl=getDaysLeft(expiry);
                const isUrgent=dl<=7, isNear=dl<=21&&dl>7;
                return(
                  <div key={expiry} style={{padding:"8px 13px",borderRadius:8,border:`1px solid ${isUrgent?C.red:isNear?C.amber:C.border}`,
                    background:isUrgent?"rgba(244,63,94,0.07)":isNear?"rgba(245,158,11,0.07)":C.surfaceHover}}>
                    <div style={{fontFamily:C.mono,fontWeight:700,fontSize:11,color:isUrgent?C.red:isNear?C.amber:C.text}}>{expiry}</div>
                    <div style={{fontFamily:C.mono,fontSize:9,color:C.textDim,marginTop:2}}>{dl}d · {expiryGroups[expiry].length} pos</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Positions */}
          <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:18}}>
            {positions.map(pos=>{
              const pnl=pnls[pos.id]||0;
              const dl=getDaysLeft(pos.expiry);
              return(
                <div key={pos.id} style={{...s.card,padding:"16px",border:`1px solid ${C.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
                        <span style={{fontWeight:700,fontSize:14}}>{pos.strategy}</span>
                        <span style={{fontSize:10,fontWeight:700,fontFamily:C.mono,padding:"2px 7px",borderRadius:100,background:RISK_BG[STRATEGIES[pos.strategy].risk],color:RISK_COL[STRATEGIES[pos.strategy].risk]}}>{STRATEGIES[pos.strategy].risk}</span>
                        {dl<=7&&<span style={{fontSize:10,fontWeight:700,fontFamily:C.mono,padding:"2px 7px",borderRadius:100,background:"rgba(244,63,94,0.1)",color:C.red,border:`1px solid ${C.red}50`}}>{dl}d EXPIRY</span>}
                        {dl>7&&dl<=21&&<span style={{fontSize:10,fontWeight:700,fontFamily:C.mono,padding:"2px 7px",borderRadius:100,background:"rgba(245,158,11,0.1)",color:C.amber}}>{dl}d to expiry</span>}
                      </div>
                      <div style={{display:"flex",gap:14,flexWrap:"wrap",marginBottom:8}}>
                        {[["Entry","$"+pos.spot],["IV",(pos.sigma*100).toFixed(0)+"%"],["Qty",pos.qty+" contract"+(pos.qty>1?"s":"")],["Expiry",pos.expiry],["Opened",pos.date]].map(([l,v])=>(
                          <span key={l} style={{color:C.textDim,fontSize:11,fontFamily:C.mono}}>{l}: <strong style={{color:C.textMid}}>{v}</strong></span>
                        ))}
                      </div>
                      <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                        {pos.legs.map((l,i)=>(
                          <span key={i} style={{fontSize:10,fontFamily:C.mono,padding:"2px 7px",borderRadius:4,
                            background:l.action==="buy"?C.accentDim:"rgba(244,63,94,0.07)",
                            color:l.action==="buy"?C.accent:C.red,
                            border:`1px solid ${l.action==="buy"?C.accentBorder:"rgba(244,63,94,0.2)"}`}}>
                            {l.action.toUpperCase()} {l.type.toUpperCase()} ${l.strike}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{textAlign:"right",marginLeft:16,flexShrink:0}}>
                      <div style={{fontFamily:C.mono,fontWeight:700,fontSize:18,color:pnl>=0?C.green:C.red}}>
                        {pnl>=0?"+$":"-$"}{Math.abs(pnl).toFixed(2)}
                      </div>
                      <div style={{color:C.textDim,fontSize:10,marginTop:2}}>Unrealized P&L</div>
                      <div style={{fontFamily:C.mono,fontSize:10,color:C.textDim,marginTop:4}}>
                        {pos.net.premium<0?"Paid":"Rcvd"} ${Math.abs(pos.netCost).toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Risk summary */}
          <div style={{...s.card,padding:"16px"}}>
            <div style={{...s.label,marginBottom:11}}>Portfolio Risk Summary & Alerts</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {aggTheta<-0.1&&<Warn icon="⏱" color="amber">Portfolio is theta-negative: losing ~${Math.abs(aggTheta*100).toFixed(2)}/day in time value across all positions.</Warn>}
              {Math.abs(aggDelta)>0.5&&<Warn icon="Δ" color="amber">Significant directional bias: net delta {aggDelta.toFixed(3)}. Verify this matches your market outlook.</Warn>}
              {positions.some(p=>getDaysLeft(p.expiry)<=7)&&<Warn icon="⚠" color="red">One or more positions expire within 7 days. Decide: close, roll, or let expire before theta accelerates further.</Warn>}
              {positions.some(p=>STRATEGIES[p.strategy].risk==="high")&&<Warn icon="🔴" color="red">Portfolio includes high-risk strategies. Ensure you have sufficient capital for maximum loss scenarios.</Warn>}
              {positions.some(p=>STRATEGIES[p.strategy].legs.some(l=>l.action==="sell"))&&<Warn icon="📋" color="amber">Portfolio contains short options — assignment risk exists. Monitor ITM short positions especially near ex-dividend dates.</Warn>}
              {aggTheta>=-0.1&&Math.abs(aggDelta)<=0.5&&!positions.some(p=>getDaysLeft(p.expiry)<=21)&&
                <Warn icon="✓" color="blue">No immediate risk flags detected. Continue monitoring Greeks and upcoming expiries.</Warn>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   ROOT
═══════════════════════════════════════════════════════════ */
export default function App(){
  const [screen,setScreen]=useState("onboarding");
  const [profile,setProfile]=useState(null);
  const [selectedStrategy,setSelectedStrategy]=useState("Bull Call Spread");
  const [params,setParams]=useState({spot:100,sigma:0.25,r:0.05,dte:30});
  const [positions,setPositions]=useState([]);

  const addPosition=useCallback(pos=>setPositions(prev=>[...prev,pos]),[]);

  if(screen==="onboarding")return <Onboarding onDone={p=>{setProfile(p);setScreen("home");}}/>;

  return(
    <div style={s.root}>
      <Nav screen={screen} setScreen={setScreen} posCount={positions.length}/>
      {screen==="home"&&<Home profile={profile} setSelectedStrategy={setSelectedStrategy} setScreen={setScreen}/>}
      {screen==="builder"&&<Builder selectedStrategy={selectedStrategy} setSelectedStrategy={setSelectedStrategy}
        params={params} setParams={setParams} setScreen={setScreen} addPosition={addPosition} profile={profile}/>}
      {screen==="lab"&&<VolLab/>}
      {screen==="dashboard"&&<Dashboard positions={positions} setScreen={setScreen}/>}
    </div>
  );
}
