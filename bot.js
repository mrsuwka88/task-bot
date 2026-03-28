const TG_TOKEN = process.env.TG_TOKEN || "8771249918:AAF0QZ2KJyl2vpVXswiRrz6UZ5E8pjkoYf0";
const CHAT_ID  = process.env.CHAT_ID  || "1154482846";
const APP_URL  = process.env.APP_URL  || "https://thmtbottmai.netlify.app";

const sessions = {};
const tasks    = {};
const reminders= {};

async function tgApi(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)
  });
  return res.json();
}
async function send(chatId, text, extra={}) {
  return tgApi("sendMessage",{chat_id:chatId,text,parse_mode:"HTML",...extra});
}
async function sendKb(chatId, text, buttons) {
  return send(chatId,text,{reply_markup:{inline_keyboard:buttons}});
}
async function editMsg(chatId, msgId, text, buttons) {
  return tgApi("editMessageText",{chat_id:chatId,message_id:msgId,text,parse_mode:"HTML",reply_markup:buttons?{inline_keyboard:buttons}:undefined});
}
async function answerCb(id,text="") { return tgApi("answerCallbackQuery",{callback_query_id:id,text}); }

function priDot(p){return p==="Urgent"?"🔴":p==="Normal"?"🟡":"🔵";}
function catIcon(c){return{Personal:"👤",Business:"💼",Finance:"💰",Health:"🏥"}[c]||"📋";}
function srcIcon(s){return{Self:"✏️",WhatsApp:"💬",Email:"📧",Phone:"📞",Message:"💌"}[s]||"✏️";}

function parseDeadline(text){
  const t=text.toLowerCase().trim();
  if(["no deadline","skip","none","لا","later"].includes(t))return null;
  const now=new Date();
  let date=new Date(now);
  const timeM=t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  let h=12,m=0;
  if(timeM){
    h=parseInt(timeM[1]);
    m=timeM[2]?parseInt(timeM[2]):0;
    if(timeM[3]==="pm"&&h<12)h+=12;
    if(timeM[3]==="am"&&h===12)h=0;
  }
  const inH=t.match(/in\s+(\d+)\s*h/); const inM=t.match(/in\s+(\d+)\s*m/);
  if(inH){date.setHours(date.getHours()+parseInt(inH[1]));return date;}
  if(inM){date.setMinutes(date.getMinutes()+parseInt(inM[1]));return date;}
  if(t.includes("today")||t.includes("اليوم")){}
  else if(t.includes("tomorrow")||t.includes("غد")||t.includes("بكرة"))date.setDate(date.getDate()+1);
  else if(t.includes("next week"))date.setDate(date.getDate()+7);
  else{
    const days={monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6,sunday:0};
    for(const[day,dn]of Object.entries(days)){
      if(t.includes(day)){const diff=(dn-date.getDay()+7)%7||7;date.setDate(date.getDate()+diff);break;}
    }
  }
  date.setHours(h,m,0,0);
  return date;
}

function scheduleReminder(task){
  if(!task.deadline||!task.reminderBefore)return;
  clearRem(task.id);
  const delay=new Date(task.deadline).getTime()-task.reminderBefore-Date.now();
  if(delay>0)reminders[task.id]=setTimeout(()=>fireReminder(task.id),delay);
}
function clearRem(id){if(reminders[id]){clearTimeout(reminders[id]);delete reminders[id];}}

async function fireReminder(taskId){
  const task=tasks[taskId];
  if(!task||task.done)return;
  const priv=task.privacy==="private";
  const text=priv
    ?`⏰ <b>Task Reminder</b>\n🔒 Private task due soon.\nOpen <a href="${APP_URL}">Daily Command</a>`
    :`⏰ <b>Task Reminder</b>\n\n📌 <b>${task.title}</b>\n${catIcon(task.category)} ${task.category} · ${priDot(task.priority)} ${task.priority}\n⏰ ${new Date(task.deadline).toLocaleString("en-AE")}${task.note?"\n📝 "+task.note:""}`;
  await sendKb(task.chatId,text,[
    [{text:"✅ Done",callback_data:`done_${taskId}`},{text:"⏰ Snooze",callback_data:`snooze_${taskId}`}],
    [{text:"🔕 Stop Reminders",callback_data:`stop_${taskId}`}],
  ]);
}

function taskSummary(task){
  const dl=task.deadline?`\n⏰ Due: ${new Date(task.deadline).toLocaleString("en-AE")}`:"";
  const rem=task.reminderBefore?`\n🔔 Reminder: ${task.reminderBefore/60000}min before`:" (no reminder)";
  return `✅ <b>Task Saved!</b>\n\n📌 <b>${task.title}</b>\n${catIcon(task.category)} ${task.category} · ${priDot(task.priority)} ${task.priority} · ${srcIcon(task.source)} ${task.source} · ${task.privacy==="private"?"🔒":"🔓"}${dl}${rem}\n\n<a href="${APP_URL}">View in Daily Command →</a>`;
}

function newSession(chatId,title){
  sessions[chatId]={step:"priority",task:{id:`t${Date.now()}`,chatId,title:title.trim(),category:null,priority:null,source:null,privacy:"open",deadline:null,note:null,reminderBefore:null,done:false,createdAt:new Date().toISOString()}};
}

async function askPriority(chatId,msgId){
  const s=sessions[chatId];
  const text=`📌 <b>"${s.task.title}"</b>\n\nStep 1/5 — Select <b>Priority</b>:`;
  const b=[[{text:"🔴 Urgent",callback_data:"pri_Urgent"},{text:"🟡 Normal",callback_data:"pri_Normal"},{text:"🔵 Later",callback_data:"pri_Later"}]];
  if(msgId)return editMsg(chatId,msgId,text,b);
  return sendKb(chatId,text,b);
}
async function askCategory(chatId,msgId){
  const s=sessions[chatId].task;
  const text=`📌 <b>"${s.title}"</b> · ${priDot(s.priority)}\n\nStep 2/5 — Select <b>Category</b>:`;
  const b=[[{text:"👤 Personal",callback_data:"cat_Personal"},{text:"💼 Business",callback_data:"cat_Business"}],[{text:"💰 Finance",callback_data:"cat_Finance"},{text:"🏥 Health",callback_data:"cat_Health"}]];
  if(msgId)return editMsg(chatId,msgId,text,b);
  return sendKb(chatId,text,b);
}
async function askSource(chatId,msgId){
  const s=sessions[chatId].task;
  const text=`📌 <b>"${s.title}"</b>\n\nStep 3/5 — Where did this come from?`;
  const b=[[{text:"✏️ Self",callback_data:"src_Self"},{text:"💬 WhatsApp",callback_data:"src_WhatsApp"},{text:"📧 Email",callback_data:"src_Email"}],[{text:"📞 Phone",callback_data:"src_Phone"},{text:"💌 Message",callback_data:"src_Message"}]];
  if(msgId)return editMsg(chatId,msgId,text,b);
  return sendKb(chatId,text,b);
}
async function askPrivacy(chatId,msgId){
  const text=`Step 4/5 — Select <b>Privacy</b>:`;
  const b=[[{text:"🔓 Open — full details in reminders",callback_data:"priv_open"}],[{text:"🔒 Private — hide task details",callback_data:"priv_private"}]];
  if(msgId)return editMsg(chatId,msgId,text,b);
  return sendKb(chatId,text,b);
}
async function askDeadline(chatId){
  await send(chatId,`Step 5/5 — ⏰ <b>Deadline?</b>\n\nType naturally:\n• <code>today 3pm</code>\n• <code>tomorrow 10am</code>\n• <code>friday 2:30pm</code>\n• <code>in 2 hours</code>\n• <code>skip</code> — no deadline`,
    {reply_markup:{inline_keyboard:[[{text:"⏭ No Deadline",callback_data:"dl_skip"}]]}});
}
async function askNote(chatId){
  await send(chatId,`📝 <b>Any notes?</b> (or <code>skip</code>)`,
    {reply_markup:{inline_keyboard:[[{text:"⏭ Skip",callback_data:"note_skip"}]]}});
}
async function askReminder(chatId){
  await sendKb(chatId,`🔔 <b>Remind me how long before deadline?</b>`,[[
    {text:"5m",callback_data:"rem_5"},{text:"15m",callback_data:"rem_15"},{text:"30m",callback_data:"rem_30"},{text:"1h",callback_data:"rem_60"},
  ],[
    {text:"2h",callback_data:"rem_120"},{text:"6h",callback_data:"rem_360"},{text:"1 day",callback_data:"rem_1440"},{text:"⏭ Skip",callback_data:"rem_skip"},
  ]]);
}
async function finalizeTask(chatId){
  const session=sessions[chatId];if(!session)return;
  const task=session.task;
  tasks[task.id]=task;
  if(task.deadline&&task.reminderBefore)scheduleReminder(task);
  delete sessions[chatId];
  await send(chatId,taskSummary(task));
}

async function handleUpdate(update){
  if(update.callback_query){
    const cb=update.callback_query;
    const chatId=cb.message.chat.id.toString();
    const msgId=cb.message.message_id;
    const data=cb.data;
    await answerCb(cb.id);

    if(data.startsWith("done_")){
      const id=data.replace("done_","");
      if(tasks[id]){tasks[id].done=true;clearRem(id);}
      await editMsg(chatId,msgId,`✅ <b>Done!</b> Great work Usama! 💪\n\n<a href="${APP_URL}">View Dashboard →</a>`,null);
      return;
    }
    if(data.startsWith("snooze_")){
      const taskId=data.replace("snooze_","");
      sessions[chatId]={step:"snooze",taskId,msgId};
      await sendKb(chatId,`⏰ <b>Snooze until when?</b>`,[[
        {text:"15 min",callback_data:`snz_15_${taskId}`},{text:"30 min",callback_data:`snz_30_${taskId}`},
        {text:"1 hour",callback_data:`snz_60_${taskId}`},{text:"2 hours",callback_data:`snz_120_${taskId}`},
      ],[
        {text:"Tonight 9pm",callback_data:`snz_tonight_${taskId}`},{text:"Tomorrow 9am",callback_data:`snz_tomorrow_${taskId}`},
      ],[
        {text:"✏️ Custom time...",callback_data:`snz_custom_${taskId}`},
      ]]);
      return;
    }
    if(data.startsWith("snz_")){
      const parts=data.split("_");
      const option=parts[1];
      const taskId=parts.slice(2).join("_");
      const task=tasks[taskId];if(!task)return;
      clearRem(taskId);
      if(option==="custom"){
        sessions[chatId]={step:"snooze_custom",taskId};
        await send(chatId,`⏰ Type when:\n• <code>in 45 minutes</code>\n• <code>tomorrow 2pm</code>\n• <code>friday 10am</code>`);
        return;
      }
      let snoozeMs=0;
      if(option==="tonight"){const t=new Date();t.setHours(21,0,0,0);snoozeMs=t.getTime()-Date.now();}
      else if(option==="tomorrow"){const t=new Date();t.setDate(t.getDate()+1);t.setHours(9,0,0,0);snoozeMs=t.getTime()-Date.now();}
      else snoozeMs=parseInt(option)*60*1000;
      if(snoozeMs>0){
        reminders[taskId]=setTimeout(()=>fireReminder(taskId),snoozeMs);
        const until=new Date(Date.now()+snoozeMs).toLocaleString("en-AE");
        await send(chatId,`⏰ Snoozed until <b>${until}</b>\n\nI'll remind you then! 🔔`);
      }
      return;
    }
    if(data.startsWith("stop_")){
      const id=data.replace("stop_","");
      clearRem(id);
      await editMsg(chatId,msgId,`🔕 Reminders stopped.\n<a href="${APP_URL}">Mark done in Dashboard →</a>`,null);
      return;
    }
    if(data==="dl_skip"){sessions[chatId].task.deadline=null;sessions[chatId].step="note";await askNote(chatId);return;}
    if(data==="note_skip"){
      sessions[chatId].task.note=null;
      if(sessions[chatId].task.deadline){sessions[chatId].step="reminder";await askReminder(chatId);}
      else await finalizeTask(chatId);
      return;
    }
    if(data.startsWith("rem_")){
      const val=data.replace("rem_","");
      sessions[chatId].task.reminderBefore=val==="skip"?null:parseInt(val)*60*1000;
      await finalizeTask(chatId);return;
    }
    if(data.startsWith("pri_")&&sessions[chatId]){sessions[chatId].task.priority=data.replace("pri_","");sessions[chatId].step="category";await askCategory(chatId,msgId);return;}
    if(data.startsWith("cat_")&&sessions[chatId]){sessions[chatId].task.category=data.replace("cat_","");sessions[chatId].step="source";await askSource(chatId,msgId);return;}
    if(data.startsWith("src_")&&sessions[chatId]){sessions[chatId].task.source=data.replace("src_","");sessions[chatId].step="privacy";await askPrivacy(chatId,msgId);return;}
    if(data.startsWith("priv_")&&sessions[chatId]){sessions[chatId].task.privacy=data.replace("priv_","");sessions[chatId].step="deadline";await editMsg(chatId,msgId,"✓ Privacy set.",null);await askDeadline(chatId);return;}
    return;
  }

  if(update.message?.text){
    const chatId=update.message.chat.id.toString();
    const text=update.message.text.trim();
    const session=sessions[chatId];

    if(text==="/start"){
      await send(chatId,`👋 <b>Salam Usama!</b>\n\nSend me any task — in English or Arabic — and I'll set it up step by step.\n\nExamples:\n• <i>Call Ahmed from SNB about the loan</i>\n• <i>اتصل بالمحامي بخصوص عقد داماك</i>\n• <i>Pay DAMAC installment by friday</i>\n\n/tasks — view pending\n/help — how to use`);
      return;
    }
    if(text==="/tasks"){
      const pending=Object.values(tasks).filter(t=>!t.done&&t.chatId===chatId);
      if(!pending.length){await send(chatId,"✅ No pending tasks! All clear. 🎉");return;}
      let msg=`📋 <b>Pending Tasks (${pending.length})</b>\n\n`;
      pending.sort((a,b)=>({Urgent:0,Normal:1,Later:2}[a.priority]||1)-({Urgent:0,Normal:1,Later:2}[b.priority]||1))
        .forEach((t,i)=>{
          const dl=t.deadline?`\n   ⏰ ${new Date(t.deadline).toLocaleString("en-AE")}`:""
          msg+=`${i+1}. ${priDot(t.priority)} <b>${t.title}</b>${dl}\n`;
        });
      msg+=`\n<a href="${APP_URL}">Open Dashboard →</a>`;
      await send(chatId,msg);return;
    }
    if(text==="/help"){
      await send(chatId,`<b>How to use:</b>\n\n1️⃣ Send any task description\n2️⃣ Set Priority → Category → Source → Privacy → Deadline → Reminder\n3️⃣ Task appears on your dashboard\n4️⃣ Bot reminds you before deadline\n5️⃣ Tap ✅ Done or ⏰ Snooze\n6️⃣ Snooze: pick time or enter custom\n7️⃣ Reminds again until marked done\n\n/tasks — list pending\n/start — welcome\n\n<a href="${APP_URL}">Dashboard →</a>`);
      return;
    }

    if(session?.step==="snooze_custom"){
      const snoozeDate=parseDeadline(text);
      const taskId=session.taskId;
      delete sessions[chatId];
      if(snoozeDate&&tasks[taskId]){
        const delay=snoozeDate.getTime()-Date.now();
        if(delay>0){
          reminders[taskId]=setTimeout(()=>fireReminder(taskId),delay);
          await send(chatId,`⏰ Snoozed until <b>${snoozeDate.toLocaleString("en-AE")}</b>`);
          return;
        }
      }
      await send(chatId,"⚠️ Couldn't parse that time. Task not snoozed.");
      return;
    }
    if(session?.step==="deadline"){
      const dl=parseDeadline(text);
      session.task.deadline=dl?dl.toISOString():null;
      session.step="note";
      if(dl)await send(chatId,`✓ Deadline: <b>${dl.toLocaleString("en-AE")}</b>`);
      await askNote(chatId);return;
    }
    if(session?.step==="note"){
      session.task.note=text==="skip"?null:text;
      if(session.task.deadline){session.step="reminder";await askReminder(chatId);}
      else await finalizeTask(chatId);
      return;
    }
    if(!text.startsWith("/")){
      newSession(chatId,text);
      await askPriority(chatId,null);
      return;
    }
  }
}

// ── Server ────────────────────────────────────────────────────────────────────
const PORT=process.env.PORT||3000;
Bun.serve({
  port:PORT,
  async fetch(req){
    const url=new URL(req.url);
    if(url.pathname==="/webhook"&&req.method==="POST"){
      try{const u=await req.json();handleUpdate(u).catch(console.error);}catch(e){console.error(e);}
      return new Response("OK");
    }
    if(url.pathname==="/"){
      return new Response(JSON.stringify({status:"running",tasks:Object.keys(tasks).length,pending:Object.values(tasks).filter(t=>!t.done).length,uptime:process.uptime()}),{headers:{"Content-Type":"application/json"}});
    }
    if(url.pathname==="/tasks"){
      return new Response(JSON.stringify(Object.values(tasks)),{headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}});
    }
    if(url.pathname.startsWith("/done/")&&req.method==="POST"){
      const id=url.pathname.replace("/done/","");
      if(tasks[id]){tasks[id].done=true;clearRem(id);}
      return new Response(JSON.stringify({ok:true}),{headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}});
    }
    return new Response("Not found",{status:404});
  }
});
console.log(`🤖 Bot running on port ${PORT}`);

async function setWebhook(){
  const domain=process.env.RAILWAY_PUBLIC_DOMAIN;
  if(!domain){console.log("⚠️ Set RAILWAY_PUBLIC_DOMAIN env var");return;}
  const res=await tgApi("setWebhook",{url:`https://${domain}/webhook`,drop_pending_updates:true});
  console.log("✅ Webhook:",res.ok?"OK":res.description);
}
setTimeout(setWebhook,3000);
