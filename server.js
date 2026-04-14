const express=require('express');
const cors=require('cors');
const{createClient}=require('@supabase/supabase-js');
const app=express();
app.use(cors());
app.use(express.json());
const db=()=>createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);

async function sendEmail({to,subject,html}){
  if(!process.env.RESEND_API_KEY)return{ok:false};
  try{const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:'Manly Massage <noreply@manlyremedialthai.com.au>',to,subject,html})});return await r.json();}
  catch(e){console.error('Email:',e);return{ok:false};}
}

const PRICES={'Relaxation Massage':{30:65,45:85,60:105,90:155,120:210},'Remedial Massage':{30:70,45:90,60:110,90:160,120:210},'Traditional Thai Massage (Soft)':{30:65,45:85,60:105,90:155,120:210},'Traditional Thai Massage (Medium-Hard)':{30:70,45:95,60:115,90:165,120:230},'Deep Tissue Massage':{30:70,45:95,60:115,90:165,120:230},'Aromatherapy Oil Massage':{30:70,45:95,60:115,90:165,120:230},'Coconut Oil Massage':{30:70,45:95,60:115,90:165,120:230},'Hot Stone Massage':{60:120,90:170,120:235},'Pregnancy Massage':{30:70,45:95,60:115,90:165,120:230},'Foot Reflexology':{30:70,45:95,60:115,90:165,120:230},'Cupping Therapy':{20:49},'Remedial + Cupping':{75:139},'Head, Neck & Shoulders':{10:20,15:25,20:30},'Sport Boxing Oil Massage':{30:70,45:95,60:115,90:165,120:230},'Body Scrub':{30:70,45:95,60:115,90:165,120:230}};
function calcPrice(s,m){const t=PRICES[s]||{};return(t[m]||95)*100;}
function parseSydTime(date,time){const[tp,mer]=(time||'9:00 am').split(' ');let[h,m]=tp.split(':').map(Number);if(mer==='pm'&&h!==12)h+=12;if(mer==='am'&&h===12)h=0;const mo=parseInt((date||'').split('-')[1]);const tz=(mo>=4&&mo<=9)?'+10:00':'+11:00';return new Date(date+'T'+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':00'+tz);}

app.get('/health',(req,res)=>res.json({ok:true,time:new Date().toISOString()}));

app.post('/api/bookings/request',async(req,res)=>{
  try{
    const{firstName,lastName,email,phone,date,time,service,duration,concern,fund,memberNo,staffPreference,isCouple,partnerFirstName,partnerLastName,partnerService,partnerDuration,giftVoucherCode}=req.body;
    if(!firstName||!lastName||!email)return res.status(400).json({error:'Name and email required.'});
    const{data:client,error:ce}=await db().from('clients').upsert({first_name:firstName.trim(),last_name:lastName.trim(),email:email.trim().toLowerCase(),phone:phone||null,updated_at:new Date().toISOString()},{onConflict:'email'}).select().single();
    if(ce)throw ce;
    const dMins=parseInt(duration)||60;
    let startsAt,endsAt;
    if(date&&time){startsAt=parseSydTime(date,time);endsAt=new Date(startsAt.getTime()+dMins*60000);}
    else{startsAt=new Date(Date.now()+48*3600000);endsAt=new Date(startsAt.getTime()+dMins*60000);}
    const svcSlug=(service||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')||'remedial_massage';
    const priceCents=calcPrice(service,dMins);
    const notes=[service?'Service: '+service:'',duration?'Duration: '+duration:'',concern?'Notes: '+concern:'',fund?'Fund: '+fund:'',memberNo?'Member: '+memberNo:'',staffPreference?'Therapist: '+staffPreference:'',isCouple?'COUPLE: '+(partnerFirstName||'')+' '+(partnerLastName||'')+' - '+(partnerService||'')+' '+(partnerDuration||''):'' ].filter(Boolean).join(' | ');
    let voucherUsed=null;
    if(giftVoucherCode){const{data:v}=await db().from('gift_vouchers').select('*').eq('code',giftVoucherCode.toUpperCase()).eq('status','active').single();if(v&&v.balance_cents>0)voucherUsed=v;}
    const{data:apt}=await db().from('appointments').insert({client_id:client.id,service:svcSlug,status:'confirmed',starts_at:startsAt.toISOString(),ends_at:endsAt.toISOString(),duration_minutes:dMins,price_cents:priceCents,notes:notes||null,health_fund:fund||null,member_number:memberNo||null,staff_name:staffPreference&&staffPreference!=='Any available therapist'?staffPreference:null,gift_voucher_code:giftVoucherCode||null}).select().single();
    if(voucherUsed&&apt){const nb=Math.max(0,voucherUsed.balance_cents-priceCents);await db().from('gift_vouchers').update({balance_cents:nb,status:nb===0?'redeemed':'active'}).eq('id',voucherUsed.id);}
    if(apt){try{ await db().from('loyalty_visits').insert({client_id:client.id,appointment_id:apt.id,points:1}); }catch(_){}await db().from('clients').update({total_visits:(client.total_visits||0)+1,total_spent_cents:(client.total_spent_cents||0)+priceCents,loyalty_points:(client.loyalty_points||0)+1}).eq('id',client.id);}
    if(email){const st=startsAt.toLocaleString('en-AU',{timeZone:'Australia/Sydney',weekday:'long',day:'numeric',month:'long',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true});await sendEmail({to:email,subject:'Booking Confirmed - Manly Remedial & Thai Massage',html:'<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:#1a5c8a;padding:20px;text-align:center"><h1 style="color:#fff;margin:0">Booking Confirmed</h1></div><div style="padding:20px;border:1px solid #e2e8f0"><p>Hi <strong>'+firstName+'</strong>!</p><p><strong>'+service+'</strong><br>'+st+'<br>'+duration+'<br>'+(staffPreference&&staffPreference!=='Any available therapist'?'Therapist: '+staffPreference+'<br>':'')+'<strong>$'+(priceCents/100).toFixed(2)+' AUD</strong></p>'+(isCouple?'<p>Couple booking: '+(partnerFirstName||'')+' - '+(partnerService||'')+'</p>':'')+'<p>Shop 2, 31 Belgrave St, Manly NSW 2095<br>0412 822 226</p></div></div>'}); }
    return res.status(201).json({ok:true,clientId:client.id,message:'Booking confirmed!'});
  }catch(err){console.error(err);return res.status(500).json({error:err.message});}
});
app.get('/api/bookings/availability',async(req,res)=>{
  try{const{date}=req.query;if(!date)return res.json({available:[]});const mo=parseInt(date.split('-')[1]);const tz=(mo>=4&&mo<=9)?'+10:00':'+11:00';const ds=new Date(date+'T00:00:00'+tz).toISOString();const de=new Date(date+'T23:59:59'+tz).toISOString();const{data}=await db().from('appointments').select('starts_at').gte('starts_at',ds).lte('starts_at',de).not('status','in','("cancelled","no_show")');const booked=(data||[]).map(a=>new Date(a.starts_at).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit',hour12:true,timeZone:'Australia/Sydney'}));const ALL=['9:00 am','9:30 am','10:00 am','10:30 am','11:00 am','11:30 am','12:00 pm','12:30 pm','1:00 pm','1:30 pm','2:00 pm','2:30 pm','3:00 pm','3:30 pm','4:00 pm','4:30 pm','5:00 pm','5:30 pm','6:00 pm','6:30 pm','7:00 pm','7:30 pm','8:00 pm'];return res.json({available:ALL});}
  catch(err){return res.status(500).json({error:err.message});}
});

app.patch('/api/appointments/:id/cancel',async(req,res)=>{
  try{const{reason}=req.body;const{data,error}=await db().from('appointments').update({status:'cancelled',cancelled_at:new Date().toISOString(),cancel_reason:reason||'Client request'}).eq('id',req.params.id).select('*,clients(email,first_name)').single();if(error)throw error;if(data?.clients?.email){await sendEmail({to:data.clients.email,subject:'Appointment Cancelled - Manly Remedial & Thai Massage',html:'<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h2>Hi '+data.clients.first_name+', your appointment has been cancelled.</h2><p>To rebook visit manly-clinic.vercel.app or call 0412 822 226</p></div>'});}return res.json({ok:true});}
  catch(err){return res.status(500).json({error:err.message});}
});

app.get('/api/appointments/today',async(req,res)=>{
  try{const today=new Date().toLocaleDateString('en-CA',{timeZone:'Australia/Sydney'});const mo=parseInt(today.split('-')[1]);const tz=(mo>=4&&mo<=9)?'+10:00':'+11:00';const ds=new Date(today+'T00:00:00'+tz).toISOString();const de=new Date(today+'T23:59:59'+tz).toISOString();const{data,error}=await db().from('appointments').select('*,clients(id,first_name,last_name,email,phone)').gte('starts_at',ds).lte('starts_at',de).not('status','in','("cancelled","no_show")').order('starts_at');if(error)throw error;return res.json(data||[]);}
  catch(err){return res.status(500).json({error:err.message});}
});

app.get('/api/appointments/date',async(req,res)=>{
  try{const{date}=req.query;if(!date)return res.json([]);const mo=parseInt(date.split('-')[1]);const tz=(mo>=4&&mo<=9)?'+10:00':'+11:00';const ds=new Date(date+'T00:00:00'+tz).toISOString();const de=new Date(date+'T23:59:59'+tz).toISOString();const{data,error}=await db().from('appointments').select('*,clients(id,first_name,last_name,email,phone)').gte('starts_at',ds).lte('starts_at',de).not('status','in','("cancelled","no_show")').order('starts_at');if(error)throw error;return res.json(data||[]);}
  catch(err){return res.status(500).json({error:err.message});}
});

app.patch('/api/appointments/:id/status',async(req,res)=>{
  try{const updates={...req.body};if(updates.status==='completed'){const{data:apt}=await db().from('appointments').select('*,clients(email,first_name)').eq('id',req.params.id).single();if(apt&&!apt.review_requested){updates.review_requested=true;if(apt.clients?.email){await sendEmail({to:apt.clients.email,subject:'How was your massage? Leave us a review',html:'<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h2>Hi '+apt.clients.first_name+'! Thank you for visiting us.</h2><div style="text-align:center;margin:20px 0"><a href="https://g.page/r/manlyremedialthai/review" style="background:#1a5c8a;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:16px">Leave a Google Review</a></div><p>Manly Remedial & Thai Massage | 0412 822 226</p></div>'});}}}const{data,error}=await db().from('appointments').update(updates).eq('id',req.params.id).select().single();if(error)throw error;return res.json(data);}
  catch(err){return res.status(500).json({error:err.message});}
});

app.post('/api/appointments/:id/soap',async(req,res)=>{
  try{const{subjective,objective,assessment,plan,authored_by}=req.body;const{data,error}=await db().from('soap_notes').upsert({appointment_id:req.params.id,subjective,objective,assessment,plan,authored_by},{onConflict:'appointment_id'}).select().single();if(error)throw error;return res.json(data);}catch(err){return res.status(500).json({error:err.message});}
});
app.get('/api/appointments/:id/soap',async(req,res)=>{
  try{const{data,error}=await db().from('soap_notes').select('*').eq('appointment_id',req.params.id).single();if(error&&error.code!=='PGRST116')throw error;return res.json(data||{});}catch(err){return res.status(500).json({error:err.message});}
});

app.post('/api/walkin',async(req,res)=>{
  try{const{firstName,lastName,phone,service,duration,staffName}=req.body;const now=new Date();const dMins=parseInt(duration)||60;const ea=new Date(now.getTime()+dMins*60000);const svc=(service||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')||'remedial_massage';const pc=calcPrice(service,dMins);let cid=null;const em='walkin_'+Date.now()+'@walkin.local';const{data:c}=await db().from('clients').upsert({first_name:firstName||'Walk-In',last_name:lastName||'',phone:phone||null,email:em,updated_at:new Date().toISOString()},{onConflict:'email'}).select().single();cid=c?.id;const{data:apt,error}=await db().from('appointments').insert({client_id:cid,service:svc,status:'arrived',starts_at:now.toISOString(),ends_at:ea.toISOString(),duration_minutes:dMins,price_cents:pc,staff_name:staffName||null,is_walkin:true}).select().single();if(error)throw error;return res.status(201).json({ok:true,appointment:apt});}catch(err){return res.status(500).json({error:err.message});}
});

app.post('/api/blocked-times',async(req,res)=>{
  try{const{staffName,date,startTime,endTime,reason}=req.body;const mo=parseInt((date||'').split('-')[1]);const tz=(mo>=4&&mo<=9)?'+10:00':'+11:00';const sa=new Date(date+'T'+startTime+':00'+tz).toISOString();const ea=new Date(date+'T'+endTime+':00'+tz).toISOString();const{data,error}=await db().from('blocked_times').insert({staff_name:staffName,starts_at:sa,ends_at:ea,reason:reason||'Blocked'}).select().single();if(error)throw error;return res.status(201).json({ok:true,data});}catch(err){return res.status(500).json({error:err.message});}
});
app.get('/api/blocked-times',async(req,res)=>{
  try{const{date}=req.query;if(!date)return res.json([]);const mo=parseInt(date.split('-')[1]);const tz=(mo>=4&&mo<=9)?'+10:00':'+11:00';const ds=new Date(date+'T00:00:00'+tz).toISOString();const de=new Date(date+'T23:59:59'+tz).toISOString();const{data}=await db().from('blocked_times').select('*').gte('starts_at',ds).lte('ends_at',de);return res.json(data||[]);}catch(err){return res.status(500).json({error:err.message});}
});
app.delete('/api/blocked-times/:id',async(req,res)=>{
  try{await db().from('blocked_times').delete().eq('id',req.params.id);return res.json({ok:true});}catch(err){return res.status(500).json({error:err.message});}
});

app.post('/api/vouchers/create',async(req,res)=>{
  try{const{amount,recipientName,recipientEmail,message,purchasedByClientId}=req.body;const code='GV'+Math.random().toString(36).substring(2,8).toUpperCase();const exp=new Date();exp.setFullYear(exp.getFullYear()+3);const{data,error}=await db().from('gift_vouchers').insert({code,amount_cents:amount*100,balance_cents:amount*100,purchased_by_client_id:purchasedByClientId||null,recipient_name:recipientName,recipient_email:recipientEmail,message,expires_at:exp.toISOString()}).select().single();if(error)throw error;if(recipientEmail){await sendEmail({to:recipientEmail,subject:"You've received a gift voucher!",html:'<div style="font-family:Arial,sans-serif;text-align:center;max-width:600px;margin:0 auto;padding:20px"><h1>Gift Voucher</h1><p>Hi '+recipientName+'!</p>'+(message?'<p>'+message+'</p>':'')+'<h2>'+code+'</h2><h3>$'+amount+' AUD</h3><p>Expires '+exp.toLocaleDateString('en-AU')+'</p><a href="https://manly-clinic.vercel.app/#booking" style="background:#1a5c8a;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">Book Now</a></div>'});}return res.status(201).json({ok:true,voucher:data});}catch(err){return res.status(500).json({error:err.message});}
});
app.get('/api/vouchers/:code',async(req,res)=>{
  try{const{data,error}=await db().from('gift_vouchers').select('*').eq('code',req.params.code.toUpperCase()).single();if(error||!data)return res.status(404).json({error:'Voucher not found'});if(data.status!=='active')return res.json({valid:false,reason:'Voucher already used or expired'});if(data.expires_at&&new Date(data.expires_at)<new Date())return res.json({valid:false,reason:'Voucher expired'});return res.json({valid:true,voucher:data,balance:data.balance_cents/100});}catch(err){return res.status(500).json({error:err.message});}
});

app.post('/api/waitlist',async(req,res)=>{
  try{const{clientId,clientName,clientEmail,clientPhone,preferredDate,preferredTime,service,duration,staffPreference}=req.body;const{data,error}=await db().from('waitlist').insert({client_id:clientId||null,client_name:clientName,client_email:clientEmail,client_phone:clientPhone,preferred_date:preferredDate,preferred_time:preferredTime,service,duration,staff_preference:staffPreference||'any'}).select().single();if(error)throw error;return res.status(201).json({ok:true,data});}catch(err){return res.status(500).json({error:err.message});}
});
app.get('/api/waitlist',async(req,res)=>{
  try{const{data}=await db().from('waitlist').select('*').eq('status','waiting').order('created_at');return res.json(data||[]);}catch(err){return res.status(500).json({error:err.message});}
});

app.post('/api/referral/generate',async(req,res)=>{
  try{const{clientId}=req.body;const code='REF'+Math.random().toString(36).substring(2,7).toUpperCase();const{data,error}=await db().from('referral_codes').insert({client_id:clientId,code,discount_percent:10}).select().single();if(error)throw error;await db().from('clients').update({referral_code:code}).eq('id',clientId);return res.status(201).json({ok:true,code});}catch(err){return res.status(500).json({error:err.message});}
});

app.get('/api/reports/daily',async(req,res)=>{
  try{const date=req.query.date||new Date().toLocaleDateString('en-CA',{timeZone:'Australia/Sydney'});const mo=parseInt(date.split('-')[1]);const tz=(mo>=4&&mo<=9)?'+10:00':'+11:00';const ds=new Date(date+'T00:00:00'+tz).toISOString();const de=new Date(date+'T23:59:59'+tz).toISOString();const{data:apts}=await db().from('appointments').select('*,clients(first_name,last_name,email)').gte('starts_at',ds).lte('starts_at',de).not('status','in','("cancelled","no_show")');const total=(apts||[]).reduce((s,a)=>s+(a.price_cents||0),0);const hicaps=(apts||[]).filter(a=>a.hicaps_processed).reduce((s,a)=>s+(a.price_cents||0),0);const byStaff={};for(const a of(apts||[])){const s=a.staff_name||'Unassigned';if(!byStaff[s])byStaff[s]={count:0,revenue:0};byStaff[s].count++;byStaff[s].revenue+=a.price_cents||0;}return res.json({date,totalAppointments:(apts||[]).length,totalRevenueCents:total,totalRevenueAUD:(total/100).toFixed(2),hicapsAUD:(hicaps/100).toFixed(2),cashAUD:((total-hicaps)/100).toFixed(2),appointments:apts||[],byStaff});}
  catch(err){return res.status(500).json({error:err.message});}
});

app.get('/api/reports/staff',async(req,res)=>{
  try{const{from,to}=req.query;const{data:apts}=await db().from('appointments').select('staff_name,price_cents,status').gte('starts_at',from||new Date(Date.now()-7*86400000).toISOString()).lte('starts_at',to||new Date().toISOString()).not('status','in','("cancelled","no_show")');const stats={};for(const a of(apts||[])){const s=a.staff_name||'Unassigned';if(!stats[s])stats[s]={appointments:0,revenue:0};stats[s].appointments++;stats[s].revenue+=a.price_cents||0;}return res.json(Object.entries(stats).map(([name,s])=>({name,...s,revenueAUD:(s.revenue/100).toFixed(2)})));}
  catch(err){return res.status(500).json({error:err.message});}
});

app.post('/api/reminders/send',async(req,res)=>{
  try{const t=new Date();t.setDate(t.getDate()+1);const date=t.toLocaleDateString('en-CA',{timeZone:'Australia/Sydney'});const mo=parseInt(date.split('-')[1]);const tz=(mo>=4&&mo<=9)?'+10:00':'+11:00';const ds=new Date(date+'T00:00:00'+tz).toISOString();const de=new Date(date+'T23:59:59'+tz).toISOString();const{data:apts}=await db().from('appointments').select('*,clients(email,first_name)').gte('starts_at',ds).lte('starts_at',de).eq('reminder_sent',false).eq('status','confirmed');let sent=0;for(const apt of(apts||[])){if(!apt.clients?.email)continue;const ts=new Date(apt.starts_at).toLocaleString('en-AU',{timeZone:'Australia/Sydney',weekday:'long',day:'numeric',month:'long',hour:'numeric',minute:'2-digit',hour12:true});await sendEmail({to:apt.clients.email,subject:'Reminder: Your massage appointment tomorrow',html:'<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h2>Hi '+apt.clients.first_name+'! Reminder about tomorrow.</h2><p>'+ts+'<br>'+apt.service.replace(/_/g,' ')+' ('+apt.duration_minutes+' min)</p><p>Shop 2, 31 Belgrave St, Manly | 0412 822 226</p></div>'});await db().from('appointments').update({reminder_sent:true}).eq('id',apt.id);sent++;}return res.json({ok:true,sent,total:(apts||[]).length});}
  catch(err){return res.status(500).json({error:err.message});}
});

const PORT=process.env.PORT||3001;
app.listen(PORT,()=>console.log('Server running on port '+PORT));
