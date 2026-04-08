const https = require("https");
const http  = require("http");

const TG_TOKEN = process.env.TG_TOKEN || "8771249918:AAF0QZ2KJyl2vpVXswiRrz6UZ5E8pjkoYf0";
const CHAT_ID  = process.env.CHAT_ID  || "1154482846";
const APP_URL  = process.env.APP_URL  || "https://thmtbottmai.netlify.app";
const PORT     = process.env.PORT     || 3000;

const sessions = {};
const tasks    = {};
const reminders= {};

function apiCall(method, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${TG_TOKEN}/${method}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => { try { resolve(JSON.parse(raw)); } catch(e) { resolve({}); } });
    });
    req.on("error", reject);
    req.write(data); req.end();
  });
}

const send    = (cid, text, extra={}) => apiCall("sendMessage", { chat_id:cid, text, parse_mode:"HTML", ...extra });
const sendKb  = (cid, text, buttons) => send(cid, text, { reply_markup:{ inline_keyboard:buttons } });
const editMsg = (cid, mid, text, buttons) => apiCall("editMessageText", { chat_id:cid, message_id:mid, text, parse_mode:"HTML", ...(buttons?{reply_markup:{inline_keyboard:buttons}}:{}) });
const answerCb= (id, text="") => apiCall("answerCallbackQuery", { callback_query_id:id, text });

const priDot  = p => p==="Urgent"?"🔴":p==="Normal"?"🟡":"🔵";
const catIcon = c => ({Personal:"👤",Business:"💼",Finance:"💰",Health:"🏥"}[c]||"📋");
const srcIcon = s => ({Self:"✏️",WhatsApp:"💬",Email:"📧",Phone:"📞",Message:"💌"}[s]||"✏️");

function parseDeadline(text) {
  const t = text.toLowerCase().trim();
  if (["no deadline","skip","none","لا","later","no"].includes(t)) return null;
  const now = new Date();
  let date = new Date(now);
  const inH = t.match(/in\s+(\d+)\s*h/); 
  const inM = t.match(/in\s+(\d+)\s*m/);
  if (inH) { date.setHours(date.getHours()+parseInt(inH[1])); return date; }
  if (inM) { date.setMinutes(date.getMinutes()+parseInt(inM[1])); return date; }
  if (t.includes("tomorrow")||t.includes("غد")||t.includes("بكرة")) date.setDate(date.getDate()+1);
  else if (t.includes("next week")) date.setDate(date.getDate()+7);
  else {
    const days={monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6,sunday:0};
    for (const [day,dn] of Object.entries(days)) {
      if (t.includes(day)) { const diff=(dn-date.getDay()+7)%7||7; date.setDate(date.getDate()+diff); break; }
    }
  }
  const timeM = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (timeM) {
    let h=parseInt(timeM[1]), m=timeM[2]?parseInt(timeM[2]):0;
    if (timeM[3]==="pm"&&h<12) h+=12;
    if (timeM[3]==="am"&&h===12) h=0;
    if (!timeM[3]&&h<6) h+=12;
    date.setHours(h,m,0,0);
  } else { date.setHours(9,0,0,0); }
  return date;
}

function clearRem(id) { if(reminders[id]){clearTimeout(reminders[id]);delete reminders[id];} }

async function fireReminder(taskId) {
  const task = tasks[taskId];
  if (!task||task.done) return;
  const priv = task.privacy==="private";
  const text = priv
    ? `⏰ <b>Task Reminder</b>\n🔒 Private task due soon.\n<a href="${APP_URL}">Open Daily Command</a>`
    : `⏰ <b>Task Reminder</b>\n\n📌 <b>${task.title}</b>\n${catIcon(task.category)} ${task.category} · ${priDot(task.priority)} ${task.priority}\n⏰ ${new Date(task.deadline).toLocaleString("en-AE")}${task.note?"\n📝 "+task.note:""}`;
  await sendKb(task.chatId, text, [
    [{text:"✅ Done",callback_data:`done_${taskId}`},{text:"⏰ Snooze",callback_data:`snooze_${taskId}`}],
    [{text:"🔕 Stop Reminders",callback_data:`stop_${taskId}`}],
  ]);
  // Schedule again in 1 hour if not done
  reminders[taskId] = setTimeout(() => fireReminder(taskId), 3600000);
}

function scheduleReminder(task) {
  if (!task.deadline||!task.reminderBefore) return;
  clearRem(task.id);
  const delay = new Date(task.deadline).getTime() - task.reminderBefore - Date.now();
  if (delay > 0) reminders[task.id] = setTimeout(() => fireReminder(task.id), delay);
  else if (delay > -3600000) fireReminder(task.id); // fire immediately if just missed
}

function taskSummary(task) {
  const dl = task.deadline ? `\n⏰ Due: ${new Date(task.deadline).toLocaleString("en-AE")}` : "";
  const rem = task.reminderBefore ? `\n🔔 Reminder: ${task.reminderBefore/60000}min before` : "";
  return `✅ <b>Task Saved!</b>\n\n📌 <b>${task.title}</b>\n${catIcon(task.category)} ${task.category} · ${priDot(task.priority)} ${task.priority} · ${srcIcon(task.source)} ${task.source} · ${task.privacy==="private"?"🔒":"🔓"}${dl}${rem}\n\n<a href="${APP_URL}">View in Daily Command →</a>`;
}

function newSession(chatId, title) {
  sessions[chatId] = { step:"priority", task:{id:`t${Date.now()}`,chatId,title:title.trim(),category:null,priority:null,source:null,privacy:"open",deadline:null,note:null,reminderBefore:null,done:false,createdAt:new Date().toISOString()} };
}

const askPriority = (cid,mid) => {
  const t=sessions[cid].task;
  const text=`📌 <b>"${t.title}"</b>\n\nStep 1/5 — <b>Priority:</b>`;
  const b=[[{text:"🔴 Urgent",callback_data:"pri_Urgent"},{text:"🟡 Normal",callback_data:"pri_Normal"},{text:"🔵 Later",callback_data:"pri_Later"}]];
  return mid?editMsg(cid,mid,text,b):sendKb(cid,text,b);
};
const askCategory = (cid,mid) => {
  const t=sessions[cid].task;
  const text=`📌 <b>"${t.title}"</b> · ${priDot(t.priority)}\n\nStep 2/5 — <b>Category:</b>`;
  const b=[[{text:"👤 Personal",callback_data:"cat_Personal"},{text:"💼 Business",callback_data:"cat_Business"}],[{text:"💰 Finance",callback_data:"cat_Finance"},{text:"🏥 Health",callback_data:"cat_Health"}]];
  return mid?editMsg(cid,mid,text,b):sendKb(cid,text,b);
};
const askSource = (cid,mid) => {
  const text=`Step 3/5 — <b>Source:</b> Where did this come from?`;
  const b=[[{text:"✏️ Self",callback_data:"src_Self"},{text:"💬 WhatsApp",callback_data:"src_WhatsApp"},{text:"📧 Email",callback_data:"src_Email"}],[{text:"📞 Phone",callback_data:"src_Phone"},{text:"💌 Message",callback_data:"src_Message"}]];
  return mid?editMsg(cid,mid,text,b):sendKb(cid,text,b);
};
const askPrivacy = (cid,mid) => {
  const text=`Step 4/5 — <b>Privacy:</b>`;
  const b=[[{text:"🔓 Open — full details in reminders",callback_data:"priv_open"}],[{text:"🔒 Private — hide task details",callback_data:"priv_private"}]];
  return mid?editMsg(cid,mid,text,b):sendKb(cid,text,b);
};
const askDeadline = (cid) => send(cid,`Step 5/5 — ⏰ <b>Deadline?</b>\n\nType naturally:\n• <code>today 3pm</code>\n• <code>tomorrow 10am</code>\n• <code>friday 2:30pm</code>\n• <code>in 2 hours</code>\n• <code>skip</code> — no deadline`,{reply_markup:{inline_keyboard:[[{text:"⏭ No Deadline",callback_data:"dl_skip"}]]}});
const askNote    = (cid) => send(cid,`📝 <b>Any notes?</b> (or type <code>skip</code>)`,{reply_markup:{inline_keyboard:[[{text:"⏭ Skip",callback_data:"note_skip"}]]}});
const askReminder= (cid) => sendKb(cid,`🔔 <b>Remind me before deadline:</b>`,[[{text:"5min",callback_data:"rem_5"},{text:"15min",callback_data:"rem_15"},{text:"30min",callback_data:"rem_30"},{text:"1 hour",callback_data:"rem_60"}],[{text:"2 hours",callback_data:"rem_120"},{text:"6 hours",callback_data:"rem_360"},{text:"1 day",callback_data:"rem_1440"},{text:"⏭ Skip",callback_data:"rem_skip"}]]);

async function finalizeTask(chatId) {
  const session = sessions[chatId]; if (!session) return;
  const task = session.task;
  tasks[task.id] = task;
  if (task.deadline && task.reminderBefore) scheduleReminder(task);
  delete sessions[chatId];
  await send(chatId, taskSummary(task));
}

async function handleUpdate(update) {
  if (update.callback_query) {
    const cb=update.callback_query, chatId=String(cb.message.chat.id), msgId=cb.message.message_id, data=cb.data;
    await answerCb(cb.id);

    if (data.startsWith("done_")) {
      const id=data.replace("done_","");
      if (tasks[id]) { tasks[id].done=true; clearRem(id); }
      await editMsg(chatId,msgId,`✅ <b>Task Done!</b> Well done Usama! 💪\n\n<a href="${APP_URL}">Dashboard →</a>`,null);
      return;
    }
    if (data.startsWith("stop_")) {
      clearRem(data.replace("stop_",""));
      await editMsg(chatId,msgId,`🔕 Reminders stopped.\n<a href="${APP_URL}">Mark done in Dashboard →</a>`,null);
      return;
    }
    if (data.startsWith("snooze_")) {
      const taskId=data.replace("snooze_","");
      sessions[chatId]={step:"snooze",taskId,msgId};
      await sendKb(chatId,`⏰ <b>Snooze until when?</b>`,[
        [{text:"15 min",callback_data:`snz_15_${taskId}`},{text:"30 min",callback_data:`snz_30_${taskId}`},{text:"1 hour",callback_data:`snz_60_${taskId}`}],
        [{text:"2 hours",callback_data:`snz_120_${taskId}`},{text:"Tonight 9pm",callback_data:`snz_tonight_${taskId}`},{text:"Tomorrow 9am",callback_data:`snz_tomorrow_${taskId}`}],
        [{text:"✏️ Custom time...",callback_data:`snz_custom_${taskId}`}],
      ]); return;
    }
    if (data.startsWith("snz_")) {
      const parts=data.split("_"), option=parts[1], taskId=parts.slice(2).join("_");
      const task=tasks[taskId]; if (!task) return;
      clearRem(taskId);
      if (option==="custom") { sessions[chatId]={step:"snooze_custom",taskId}; await send(chatId,`⏰ <b>When should I remind you?</b>\n\nType:\n• <code>in 45 minutes</code>\n• <code>tomorrow 2pm</code>\n• <code>friday 10am</code>`); return; }
      let snoozeMs=0;
      if (option==="tonight") { const t=new Date(); t.setHours(21,0,0,0); snoozeMs=t.getTime()-Date.now(); }
      else if (option==="tomorrow") { const t=new Date(); t.setDate(t.getDate()+1); t.setHours(9,0,0,0); snoozeMs=t.getTime()-Date.now(); }
      else snoozeMs=parseInt(option)*60*1000;
      if (snoozeMs>0) {
        reminders[taskId]=setTimeout(()=>fireReminder(taskId),snoozeMs);
        await send(chatId,`⏰ Snoozed until <b>${new Date(Date.now()+snoozeMs).toLocaleString("en-AE")}</b>\n\nI'll remind you! 🔔`);
      } return;
    }
    if (data==="dl_skip") { sessions[chatId].task.deadline=null; sessions[chatId].step="note"; await askNote(chatId); return; }
    if (data==="note_skip") { sessions[chatId].task.note=null; sessions[chatId].step=sessions[chatId].task.deadline?"reminder":"done"; if(sessions[chatId].task.deadline) await askReminder(chatId); else await finalizeTask(chatId); return; }
    if (data.startsWith("rem_")) { const val=data.replace("rem_",""); sessions[chatId].task.reminderBefore=val==="skip"?null:parseInt(val)*60*1000; await finalizeTask(chatId); return; }
    if (data.startsWith("pri_")&&sessions[chatId]) { sessions[chatId].task.priority=data.replace("pri_",""); sessions[chatId].step="category"; await askCategory(chatId,msgId); return; }
    if (data.startsWith("cat_")&&sessions[chatId]) { sessions[chatId].task.category=data.replace("cat_",""); sessions[chatId].step="source"; await askSource(chatId,msgId); return; }
    if (data.startsWith("src_")&&sessions[chatId]) { sessions[chatId].task.source=data.replace("src_",""); sessions[chatId].step="privacy"; await askPrivacy(chatId,msgId); return; }
    if (data.startsWith("priv_")&&sessions[chatId]) { sessions[chatId].task.privacy=data.replace("priv_",""); sessions[chatId].step="deadline"; await editMsg(chatId,msgId,"✓ Privacy set.",null); await askDeadline(chatId); return; }
    return;
  }

  if (update.message?.text) {
    const chatId=String(update.message.chat.id), text=update.message.text.trim(), session=sessions[chatId];
    if (text==="/start") { await send(chatId,`👋 <b>Salam Usama!</b>\n\nSend me any task in English or Arabic:\n\n• <i>Call Ahmed from SNB about the loan tomorrow 10am</i>\n• <i>اتصل بالمحامي بخصوص عقد داماك</i>\n• <i>Pay DAMAC installment by friday</i>\n\n/tasks — view pending tasks\n/help — how to use`); return; }
    if (text==="/tasks") {
      const pending=Object.values(tasks).filter(t=>!t.done&&t.chatId===chatId);
      if (!pending.length) { await send(chatId,"✅ No pending tasks! All clear. 🎉"); return; }
      let msg=`📋 <b>Pending Tasks (${pending.length})</b>\n\n`;
      pending.sort((a,b)=>({Urgent:0,Normal:1,Later:2}[a.priority]||1)-({Urgent:0,Normal:1,Later:2}[b.priority]||1)).forEach((t,i)=>{
        const dl=t.deadline?`\n   ⏰ ${new Date(t.deadline).toLocaleString("en-AE")}`:""
        msg+=`${i+1}. ${priDot(t.priority)} <b>${t.title}</b>${dl}\n`;
      });
      msg+=`\n<a href="${APP_URL}">Open Dashboard →</a>`;
      await send(chatId,msg); return;
    }
    if (text==="/help") { await send(chatId,`<b>How to use:</b>\n\n1️⃣ Send any task description\n2️⃣ Set Priority → Category → Source → Privacy → Deadline → Reminder\n3️⃣ Task appears on your dashboard\n4️⃣ Bot reminds you before deadline\n5️⃣ Tap ✅ Done or ⏰ Snooze\n6️⃣ Snooze options: 15min, 1h, tonight, tomorrow, or custom time\n7️⃣ Keeps reminding until marked done\n\n/tasks — list pending\n\n<a href="${APP_URL}">Dashboard →</a>`); return; }
    if (session?.step==="snooze_custom") {
      const snoozeDate=parseDeadline(text), taskId=session.taskId;
      delete sessions[chatId];
      if (snoozeDate&&tasks[taskId]) {
        const delay=snoozeDate.getTime()-Date.now();
        if (delay>0) { reminders[taskId]=setTimeout(()=>fireReminder(taskId),delay); await send(chatId,`⏰ Snoozed until <b>${snoozeDate.toLocaleString("en-AE")}</b>`); return; }
      }
      await send(chatId,"⚠️ Couldn't parse that time. Try: <code>in 45 minutes</code> or <code>tomorrow 2pm</code>"); return;
    }
    if (session?.step==="deadline") {
      const dl=parseDeadline(text); session.task.deadline=dl?dl.toISOString():null; session.step="note";
      if (dl) await send(chatId,`✓ Deadline set: <b>${dl.toLocaleString("en-AE")}</b>`);
      await askNote(chatId); return;
    }
    if (session?.step==="note") {
      session.task.note=text==="skip"?null:text;
      if (session.task.deadline) { session.step="reminder"; await askReminder(chatId); }
      else await finalizeTask(chatId);
      return;
    }
    if (!text.startsWith("/")) { newSession(chatId,text); await askPriority(chatId,null); return; }
  }
}

// ── HTTP Server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);
  if (url.pathname==="/webhook" && req.method==="POST") {
    let body="";
    req.on("data",c=>body+=c);
    req.on("end",async()=>{
      try { await handleUpdate(JSON.parse(body)); } catch(e) { console.error(e); }
      res.writeHead(200); res.end("OK");
    }); return;
  }
  if (url.pathname==="/") {
    res.writeHead(200,{"Content-Type":"application/json"});
    res.end(JSON.stringify({status:"running",tasks:Object.keys(tasks).length,pending:Object.values(tasks).filter(t=>!t.done).length,uptime:process.uptime()})); return;
  }
  if (url.pathname==="/tasks") {
    res.writeHead(200,{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"});
    res.end(JSON.stringify(Object.values(tasks))); return;
  }
  // AI proxy endpoint — forwards to Anthropic API bypassing CORS
  if (url.pathname==="/ai" && req.method==="POST") {
    res.setHeader("Access-Control-Allow-Origin","*");
    res.setHeader("Access-Control-Allow-Headers","Content-Type");
    let body="";
    req.on("data",c=>body+=c);
    req.on("end",async()=>{
      try {
        const parsed = JSON.parse(body);
        const data = JSON.stringify(parsed);
        const aiReq = https.request({
          hostname:"api.anthropic.com",
          path:"/v1/messages",
          method:"POST",
          headers:{
            "Content-Type":"application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY || "",
            "anthropic-version":"2023-06-01",
            "Content-Length": Buffer.byteLength(data)
          }
        }, aiRes => {
          let raw="";
          aiRes.on("data",c=>raw+=c);
          aiRes.on("end",()=>{
            res.writeHead(aiRes.statusCode,{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"});
            res.end(raw);
          });
        });
        aiReq.on("error",e=>{ res.writeHead(500); res.end(JSON.stringify({error:e.message})); });
        aiReq.write(data); aiReq.end();
      } catch(e){ res.writeHead(400); res.end(JSON.stringify({error:"Bad request"})); }
    }); return;
  }
  // CORS preflight
  if (req.method==="OPTIONS") {
    res.writeHead(200,{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST,GET","Access-Control-Allow-Headers":"Content-Type"});
    res.end(); return;
  }
  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`🤖 Bot running on port ${PORT}`);
  setTimeout(async () => {
    const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
    if (!domain) { console.log("⚠️ No RAILWAY_PUBLIC_DOMAIN set"); return; }
    const res = await apiCall("setWebhook",{url:`https://${domain}/webhook`,drop_pending_updates:true});
    console.log("✅ Webhook:", res.ok?"set to https://"+domain+"/webhook":res.description);
  }, 3000);
});
