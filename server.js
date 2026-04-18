const express=require('express'); const cors=require('cors'); const{createClient}=require('@supabase/supabase-js'); const app=express(); app.use(cors()); app.use(express.json()); const db=()=>createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);
async function sendEmail({to,subject,html}){to='chadmik711@gmail.com'; if(!process.env.RESEND_API_KEY)return{ok:false}; try{const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:'Manly Massage <onboarding@resend.dev>',to,subject,html})});return await r.json();}catch(e){console.error('Email:',e);return{ok:false};} }
const PRICES={'Relaxation Massage':{30:65,45:85,60:105,90:155,120:210},'Remedial Massage':{30:70,45:90,60:110,90:160,120:210},'Traditional Thai Massage (Soft)':{30:65,45:85,60:105,90:155,120:210},'Traditional Thai Massage (Medium-Hard)':{30:70,45:95,60:115,90:165,120:230},'Deep Tissue Massage':{30:70,45:95,60:115,90:165,120:230},'Aromatherapy Oil Massage':{30:70,45:95,60:115,90:165,120:230},'Coconut Oil Massage':{30:70,45:95,60:115,90:165,120:230},'Hot Stone Massage':{60:120,90:170,120:235},'Pregnancy Massage':{30:70,45:95,60:115,90:165,120:230},'Foot Reflexology':{30:70,45:95,60:115,90:165,120:230},'Cupping Therapy':{20:49},'Remedial + Cupping':{75:139},'Head, Neck & Shoulders':{10:20,15:25,20:30},'Sport Boxing Oil Massage':{30:70,45:95,60:115,90:165,120:230},'Body Scrub':{30:70,45:95,60:115,90:165,120:230}};
function calcPrice(s,m){const t=PRICES[s]||{};return(t[m]||95)*100;}
// DST: Sydney is +11 (AEDT) Oct-Mar, +10 (AEST) Apr-Sep
function sydTz(dateStr){const mo=parseInt((dateStr||'').split('-')[1]);return(mo>=4&&mo<=9)?'+10:00':'+11:00';}
function parseSydTime(date,time){const[tp,mer]=(time||'9:00 am').split(' ');let[h,m]=tp.split(':').map(Number);if(mer==='pm'&&h!==12)h+=12;if(mer==='am'&&h===12)h=0;const tz=sydTz(date);return new Date(date+'T'+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':00'+tz);}
function dayRange(date){const tz=sydTz(date);return{ds:new Date(date+'T00:00:00'+tz).toISOString(),de:new Date(date+'T23:59:59'+tz).toISOString()};}

app.get('/health',(req,res)=>res.json({ok:true,time:new Date().toISOString()}));

// -- SLOT CHECK --
app.get('/api/check-slot',async(req,res)=>{
  const{staffName,startISO,endISO}=req.query;
  if(!staffName||!startISO||!endISO)return res.json({available:true});
  if(staffName.toLowerCase()==='any available')return res.json({available:true});
  try{
    // Use first-name fuzzy match so 'Sakkharin T.' matches 'Sakkharin Taosuwan','Sakkharin' etc
    const firstName=staffName.split(/[\s.]+/)[0];
    const{data,error}=await db().from('appointments').select('id,starts_at,ends_at,staff_name')
      .ilike('staff_name',firstName+'%')
      .not('status','in','("cancelled","no_show")')
      .lt('starts_at',endISO)
      .gt('ends_at',startISO);
    if(error||!data)return res.json({available:true});
    if(data.length>0)return res.json({available:false,message:staffName+' is not available at that time. Please choose a different time or therapist.'});
    return res.json({available:true});
  }catch{return res.json({available:true});}
});

// -- BOOKING REQUEST --
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
    const{data:apt}=await db().from('appointments').insert({client_id:client.id,service:svcSlug,status:'confirmed',starts_at:startsAt.toISOString(),ends_at:endsAt.toISOString(),duration_minutes:dMins,price_cents:priceCents,notes:notes||null,health_fund:fund||null,member_number:memberNo||null,staff_name:staffPreference&&staffPreference!=='Any available'?staffPreference:null,gift_voucher_code:giftVoucherCode||null}).select().single();
    if(voucherUsed&&apt){const nb=Math.max(0,voucherUsed.balance_cents-priceCents);await db().from('gift_vouchers').update({balance_cents:nb,status:nb===0?'redeemed':'active'}).eq('id',voucherUsed.id);}
    if(apt){try{await db().from('loyalty_visits').insert({client_id:client.id,appointment_id:apt.id,points:1});}catch(_){}await db().from('clients').update({total_visits:(client.total_visits||0)+1,total_spent_cents:(client.total_spent_cents||0)+priceCents,loyalty_points:(client.loyalty_points||0)+1}).eq('id',client.id);}
    if(email){const st=startsAt.toLocaleString('en-AU',{timeZone:'Australia/Sydney',weekday:'long',day:'numeric',month:'long',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true});await sendEmail({to:email,subject:'Booking Confirmed - Manly Remedial & Thai Massage',html:'<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:#1a5c8a;padding:20px;text-align:center"><h1 style="color:#fff;margin:0">Booking Confirmed</h1></div><div style="padding:20px;border:1px solid #e2e8f0"><p>Hi <strong>'+firstName+'</strong>!</p><p><strong>'+service+'</strong><br>'+st+'<br>'+duration+'<br>'+(staffPreference&&staffPreference!=='Any available'?'Therapist: '+staffPreference+'<br>':'')+'<strong>$'+(priceCents/100).toFixed(2)+' AUD</strong></p><p>Shop 2, 31 Belgrave St, Manly NSW 2095<br>0412 822 226</p></div></div>'});}
    // Partner appointment for couple booking
    if(isCouple&&partnerService&&partnerFirstName){const pDMins=parseInt(partnerDuration)||60;const pSvc=(partnerService||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')||'relaxation_massage';const pPrice=calcPrice(partnerService,pDMins);const pEnd=new Date(startsAt.getTime()+pDMins*60000);const pEmail='partner_'+Date.now()+'_'+email;const{data:pClient}=await db().from('clients').upsert({first_name:partnerFirstName.trim(),last_name:(partnerLastName||'').trim(),email:pEmail.slice(0,100),updated_at:new Date().toISOString()},{onConflict:'email'}).select().single();if(pClient){const pNotes='Service: '+partnerService+' | Duration: '+partnerDuration+' | COUPLE with: '+firstName+' '+lastName;await db().from('appointments').insert({client_id:pClient.id,service:pSvc,status:'confirmed',starts_at:startsAt.toISOString(),ends_at:pEnd.toISOString(),duration_minutes:pDMins,price_cents:pPrice,notes:pNotes,staff_name:null,is_walkin:false}).select().single();}}
    return res.status(201).json({ok:true,clientId:client.id,message:'Booking confirmed!'});
  }catch(err){console.error(err);return res.status(500).json({error:err.message});}
});

// -- AVAILABILITY --
app.get('/api/bookings/availability',async(req,res)=>{
  try{
    const{date}=req.query;if(!date)return res.json({available:[]});
    const{ds,de}=dayRange(date);
    const{data}=await db().from('appointments').select('starts_at').gte('starts_at',ds).lte('starts_at',de).not('status','in','("cancelled","no_show")');
    const booked=(data||[]).map(a=>new Date(a.starts_at).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit',hour12:true,timeZone:'Australia/Sydney'}));
    const ALL=['9:00 am','9:30 am','10:00 am','10:30 am','11:00 am','11:30 am','12:00 pm','12:30 pm','1:00 pm','1:30 pm','2:00 pm','2:30 pm','3:00 pm','3:30 pm','4:00 pm','4:30 pm','5:00 pm','5:30 pm','6:00 pm','6:30 pm','7:00 pm','7:30 pm','8:00 pm'];
    return res.json({available:ALL.filter(t=>!booked.includes(t)),booked});
  }catch(err){return res.status(500).json({error:err.message});}
});

// -- APPOINTMENTS --
app.patch('/api/appointments/:id/cancel',async(req,res)=>{try{const{reason}=req.body;const{data,error}=await db().from('appointments').update({status:'cancelled',cancelled_at:new Date().toISOString(),cancel_reason:reason||'Client request'}).eq('id',req.params.id).select('*,clients(email,first_name)').single();if(error)throw error;if(data?.clients?.email){await sendEmail({to:data.clients.email,subject:'Appointment Cancelled - Manly Remedial & Thai Massage',html:'<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h2>Hi '+data.clients.first_name+', your appointment has been cancelled.</h2><p>To rebook visit manly-clinic.vercel.app or call 0412 822 226</p></div>'});}return res.json({ok:true});}catch(err){return res.status(500).json({error:err.message});}});
app.get('/api/appointments/today',async(req,res)=>{try{const today=new Date().toLocaleDateString('en-CA',{timeZone:'Australia/Sydney'});const{ds,de}=dayRange(today);const{data,error}=await db().from('appointments').select('*,clients(id,first_name,last_name,email,phone)').gte('starts_at',ds).lte('starts_at',de).not('status','in','("cancelled","no_show")').order('starts_at');if(error)throw error;return res.json(data||[]);}catch(err){return res.status(500).json({error:err.message});}});
app.get('/api/appointments/date',async(req,res)=>{try{const{date}=req.query;if(!date)return res.json([]);const{ds,de}=dayRange(date);const{data,error}=await db().from('appointments').select('*,clients(id,first_name,last_name,email,phone)').gte('starts_at',ds).lte('starts_at',de).not('status','in','("cancelled","no_show")').order('starts_at');if(error)throw error;return res.json(data||[]);}catch(err){return res.status(500).json({error:err.message});}});
app.patch('/api/appointments/:id/status',async(req,res)=>{try{const updates={...req.body};if(updates.status==='completed'){const{data:apt}=await db().from('appointments').select('*,clients(email,first_name)').eq('id',req.params.id).single();if(apt&&!apt.review_requested){updates.review_requested=true;if(apt.clients?.email){await sendEmail({to:apt.clients.email,subject:'How was your massage? Leave us a review',html:'<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h2>Hi '+apt.clients.first_name+'! Thank you for visiting.</h2><div style="text-align:center;margin:20px 0"><a href="https://g.page/r/manlyremedialthai/review" style="background:#1a5c8a;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none">Leave a Google Review</a></div><p>Manly Remedial & Thai Massage | 0412 822 226</p></div>'});}}}const{data,error}=await db().from('appointments').update(updates).eq('id',req.params.id).select().single();if(error)throw error;return res.json(data);}catch(err){return res.status(500).json({error:err.message});}});
app.post('/api/appointments/:id/soap',async(req,res)=>{try{const{subjective,objective,assessment,plan,authored_by}=req.body;const{data,error}=await db().from('soap_notes').upsert({appointment_id:req.params.id,subjective,objective,assessment,plan,authored_by},{onConflict:'appointment_id'}).select().single();if(error)throw error;return res.json(data);}catch(err){return res.status(500).json({error:err.message});}});
app.get('/api/appointments/:id/soap',async(req,res)=>{try{const{data,error}=await db().from('soap_notes').select('*').eq('appointment_id',req.params.id).single();if(error&&error.code!=='PGRST116')throw error;return res.json(data||{});}catch(err){return res.status(500).json({error:err.message});}});

// -- WALK-IN --
app.post('/api/walkin',async(req,res)=>{
  try{
    const{firstName,lastName,phone,service,duration,staffName,startTime}=req.body;
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'Australia/Sydney'});
    let startsAt;
    if(startTime){const[hh,mm]=startTime.split(':').map(Number);const tz=sydTz(today);startsAt=new Date(today+'T'+String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0')+':00'+tz);}
    else{startsAt=new Date();}
    const dMins=parseInt(duration)||60;
    const endsAt=new Date(startsAt.getTime()+dMins*60000);
    // Conflict check
    if(staffName&&staffName.toLowerCase()!=='any available'){
      const{data:conflicts}=await db().from('appointments').select('id,starts_at,ends_at,clients(first_name,last_name)').ilike('staff_name',staffName).not('status','in','("cancelled","no_show")').lt('starts_at',endsAt.toISOString()).gt('ends_at',startsAt.toISOString());
      if(conflicts&&conflicts.length>0){const clash=conflicts[0];const clashName=clash.clients?(clash.clients.first_name+' '+clash.clients.last_name).trim():'another client';return res.status(409).json({error:'conflict',message:staffName+' is already booked at this time ('+clashName+'). Please choose a different time or therapist.'});}
    }
    const svc=(service||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')||'remedial_massage';
    const pc=calcPrice(service,dMins);
    const em='walkin_'+Date.now()+'@walkin.local';
    const{data:c}=await db().from('clients').upsert({first_name:firstName||'Walk-In',last_name:lastName||'',phone:phone||null,email:em,updated_at:new Date().toISOString()},{onConflict:'email'}).select().single();
    const{data:apt,error}=await db().from('appointments').insert({client_id:c?.id,service:svc,status:'arrived',starts_at:startsAt.toISOString(),ends_at:endsAt.toISOString(),duration_minutes:dMins,price_cents:pc,staff_name:staffName||null,is_walkin:true}).select().single();
    if(error)throw error;
    return res.status(201).json({ok:true,appointment:apt});
  }catch(err){return res.status(500).json({error:err.message});}
});

// -- STAFF SETTINGS --
app.get('/api/staff-settings',async(req,res)=>{try{const{data,error}=await db().from('staff_settings').select('*').order('sort_order');if(error)throw error;return res.json(data||[]);}catch(err){return res.status(500).json({error:err.message});}});
app.patch('/api/staff-settings/:staffId',async(req,res)=>{try{const{active}=req.body;const{data,error}=await db().from('staff_settings').update({active,updated_at:new Date().toISOString()}).eq('staff_id',req.params.staffId).select().single();if(error)throw error;return res.json(data);}catch(err){return res.status(500).json({error:err.message});}});

// -- REPORTS --
app.get('/api/reports/daily',async(req,res)=>{try{const date=req.query.date||new Date().toLocaleDateString('en-CA',{timeZone:'Australia/Sydney'});const{ds,de}=dayRange(date);const{data:apts}=await db().from('appointments').select('*,clients(first_name,last_name,email)').gte('starts_at',ds).lte('starts_at',de).not('status','in','("cancelled","no_show")');const total=(apts||[]).reduce((s,a)=>s+(a.price_cents||0),0);const hicaps=(apts||[]).filter(a=>a.hicaps_processed).reduce((s,a)=>s+(a.price_cents||0),0);const byStaff={};for(const a of(apts||[])){const s=a.staff_name||'Unassigned';if(!byStaff[s])byStaff[s]={count:0,revenue:0};byStaff[s].count++;byStaff[s].revenue+=a.price_cents||0;}return res.json({date,totalAppointments:(apts||[]).length,totalRevenueCents:total,totalRevenueAUD:(total/100).toFixed(2),hicapsAUD:(hicaps/100).toFixed(2),cashAUD:((total-hicaps)/100).toFixed(2),appointments:apts||[],byStaff});}catch(err){return res.status(500).json({error:err.message});}});
app.get('/api/reports/staff',async(req,res)=>{try{const{from,to}=req.query;const{data:apts}=await db().from('appointments').select('staff_name,price_cents,status').gte('starts_at',from||new Date(Date.now()-7*86400000).toISOString()).lte('starts_at',to||new Date().toISOString()).not('status','in','("cancelled","no_show")');const stats={};for(const a of(apts||[])){const s=a.staff_name||'Unassigned';if(!stats[s])stats[s]={appointments:0,revenue:0};stats[s].appointments++;stats[s].revenue+=a.price_cents||0;}return res.json(Object.entries(stats).map(([name,s])=>({name,...s,revenueAUD:(s.revenue/100).toFixed(2)})));}catch(err){return res.status(500).json({error:err.message});}});

// -- REMINDERS --
app.post('/api/reminders/send',async(req,res)=>{try{const t=new Date();t.setDate(t.getDate()+1);const date=t.toLocaleDateString('en-CA',{timeZone:'Australia/Sydney'});const{ds,de}=dayRange(date);const{data:apts}=await db().from('appointments').select('*,clients(email,first_name)').gte('starts_at',ds).lte('starts_at',de).eq('reminder_sent',false).eq('status','confirmed');let sent=0;for(const apt of(apts||[])){if(!apt.clients?.email)continue;const ts=new Date(apt.starts_at).toLocaleString('en-AU',{timeZone:'Australia/Sydney',weekday:'long',day:'numeric',month:'long',hour:'numeric',minute:'2-digit',hour12:true});await sendEmail({to:apt.clients.email,subject:'Reminder: Your massage appointment tomorrow',html:'<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h2>Hi '+apt.clients.first_name+'! Reminder for tomorrow.</h2><p>'+ts+'<br>'+apt.service.replace(/_/g,' ')+' ('+apt.duration_minutes+' min)</p><p>Shop 2, 31 Belgrave St, Manly | 0412 822 226</p></div>'});await db().from('appointments').update({reminder_sent:true}).eq('id',apt.id);sent++;}return res.json({ok:true,sent,total:(apts||[]).length});}catch(err){return res.status(500).json({error:err.message});}});

// -- VOUCHERS --
app.post('/api/vouchers/create',async(req,res)=>{try{const{amount,recipientName,recipientEmail,message,purchasedByClientId}=req.body;const code='GV'+Math.random().toString(36).substring(2,8).toUpperCase();const exp=new Date();exp.setFullYear(exp.getFullYear()+3);const{data,error}=await db().from('gift_vouchers').insert({code,amount_cents:amount*100,balance_cents:amount*100,purchased_by_client_id:purchasedByClientId||null,recipient_name:recipientName,recipient_email:recipientEmail,message,expires_at:exp.toISOString()}).select().single();if(error)throw error;if(recipientEmail){await sendEmail({to:recipientEmail,subject:"You've received a gift voucher!",html:'<div style="font-family:Arial,sans-serif;text-align:center;max-width:600px;margin:0 auto;padding:20px"><h1>Gift Voucher</h1><p>Hi '+recipientName+'!</p>'+(message?'<p>'+message+'</p>':'')+'<h2>'+code+'</h2><h3>$'+amount+' AUD</h3><p>Expires '+exp.toLocaleDateString('en-AU')+'</p><a href="https://manly-clinic.vercel.app/#booking" style="background:#1a5c8a;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">Book Now</a></div>'});}return res.status(201).json({ok:true,voucher:data});}catch(err){return res.status(500).json({error:err.message});}});
app.get('/api/vouchers/:code',async(req,res)=>{try{const{data,error}=await db().from('gift_vouchers').select('*').eq('code',req.params.code.toUpperCase()).single();if(error||!data)return res.status(404).json({error:'Voucher not found'});if(data.status!=='active')return res.json({valid:false,reason:'Already used or expired'});if(data.expires_at&&new Date(data.expires_at)<new Date())return res.json({valid:false,reason:'Voucher expired'});return res.json({valid:true,voucher:data,balance:data.balance_cents/100});}catch(err){return res.status(500).json({error:err.message});}});

// -- INTAKE FORM --
app.get('/api/intake-form',async(req,res)=>{const{clientId,email}=req.query;if(!clientId&&!email)return res.status(400).json({error:'clientId or email required'});try{let q=db().from('intake_forms').select('*').order('created_at',{ascending:false}).limit(1);if(clientId)q=q.eq('client_id',clientId);else q=q.eq('email',email);const{data}=await q.single();if(!data)return res.json({found:false});return res.json({found:true,intake:data.data,completedAt:data.completed_at});}catch{res.json({found:false});}});
app.post('/api/intake-form',async(req,res)=>{const{clientId,email,...intakeData}=req.body;if(!clientId&&!email)return res.status(400).json({error:'clientId or email required'});try{const{data:existing}=clientId?await db().from('intake_forms').select('id').eq('client_id',clientId).single():{data:null};if(existing?.id){await db().from('intake_forms').update({data:intakeData,completed_at:new Date().toISOString()}).eq('id',existing.id);}else{await db().from('intake_forms').insert({client_id:clientId||null,email:email||null,data:intakeData,completed_at:new Date().toISOString()});}if(clientId){const _cu={};if('date_of_birth' in intakeData)_cu.date_of_birth=intakeData.date_of_birth||null;if('has_private_health' in intakeData)_cu.has_private_health=intakeData.has_private_health;if('health_fund_provider' in intakeData)_cu.health_fund_provider=intakeData.health_fund_provider||null;if('health_fund_number' in intakeData)_cu.health_fund_number=intakeData.health_fund_number||null;if('referral_source' in intakeData)_cu.referral_source=intakeData.referral_source||null;if(Object.keys(_cu).length)await db().from('clients').update(_cu).eq('id',clientId);}return res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});

// -- STAFF SCHEDULE OVERRIDES (per-day availability) --
app.get('/api/staff-schedule/:staffId',async(req,res)=>{
  try{
    const{staffId}=req.params;const{date,from,to}=req.query;
    let q=db().from('staff_schedule_overrides').select('*').eq('staff_id',staffId);
    if(date)q=q.eq('date',date);
    if(from)q=q.gte('date',from);
    if(to)q=q.lte('date',to);
    const{data,error}=await q.order('date');
    if(error)throw error;
    return res.json(data||[]);
  }catch(e){return res.status(500).json({error:e.message});}
});

app.put('/api/staff-schedule/:staffId',async(req,res)=>{
  try{
    const{staffId}=req.params;
    const{date,is_working,start_time,end_time,note}=req.body||{};
    if(!date)return res.status(400).json({error:'date required (YYYY-MM-DD)'});
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({error:'date must be YYYY-MM-DD'});
    const row={
      staff_id:staffId,
      date,
      is_working:is_working!==false,
      start_time:start_time||null,
      end_time:end_time||null,
      note:note||null,
      updated_at:new Date().toISOString()
    };
    const{data,error}=await db().from('staff_schedule_overrides').upsert(row,{onConflict:'staff_id,date'}).select().single();
    if(error)throw error;
    return res.json(data);
  }catch(e){return res.status(500).json({error:e.message});}
});

app.delete('/api/staff-schedule/:staffId',async(req,res)=>{
  try{
    const{staffId}=req.params;const{date}=req.query;
    if(!date)return res.status(400).json({error:'date query param required'});
    const{error}=await db().from('staff_schedule_overrides').delete().eq('staff_id',staffId).eq('date',date);
    if(error)throw error;
    return res.json({ok:true});
  }catch(e){return res.status(500).json({error:e.message});}
});

const PORT=process.env.PORT||3001;

// -- CLIENT HISTORY --
app.get('/api/clients/:id/history',async(req,res)=>{
  try{
    const{data:client}=await db().from('clients').select('*').eq('id',req.params.id).single();
    if(!client)return res.status(404).json({error:'Not found'});
    const{data:apts}=await db().from('appointments').select('*').eq('client_id',req.params.id).order('starts_at',{ascending:false});
    const all=apts||[];
    const services={};const therapists={};
    for(const a of all){
      const s=a.service||'unknown';if(!services[s])services[s]=0;services[s]++;
      const t=a.staff_name||'Any available';if(!therapists[t])therapists[t]=0;therapists[t]++;
    }
    const attended=all.filter(a=>['completed','in_session','arrived'].includes(a.status));
    const totalSpent=attended.reduce((s,a)=>s+(a.price_cents||0),0);
    return res.json({client,stats:{total:all.length,attended:attended.length,noShows:all.filter(a=>a.status==='no_show').length,cancelled:all.filter(a=>a.status==='cancelled').length,confirmed:all.filter(a=>a.status==='confirmed').length,totalSpentAUD:(totalSpent/100).toFixed(2),attendanceRate:all.length>0?Math.round((attended.length/all.length)*100):0},services,therapists,appointments:all.slice(0,50)});
  }catch(err){return res.status(500).json({error:err.message});}
});

// -- EDIT BOOKING --
app.patch('/api/appointments/:id/edit',async(req,res)=>{
  try{
    const{date,time,service,duration,staffName,notes}=req.body;
    const updates={};
    if(date&&time){
      const dMins=parseInt(duration)||60;
      const tz=sydTz(date);
      const[tp,mer]=(time||'9:00 am').split(' ');
      let[h,m]=tp.split(':').map(Number);
      if(mer==='pm'&&h!==12)h+=12;if(mer==='am'&&h===12)h=0;
      const startsAt=new Date(date+'T'+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':00'+tz);
      updates.starts_at=startsAt.toISOString();
      updates.ends_at=new Date(startsAt.getTime()+dMins*60000).toISOString();
      updates.duration_minutes=dMins;
    }
    if(service){updates.service=service.toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');updates.price_cents=calcPrice(service,parseInt(duration)||60);}
    if(staffName!==undefined)updates.staff_name=staffName||null;
    if(notes!==undefined)updates.notes=notes;
    const{data,error}=await db().from('appointments').update(updates).eq('id',req.params.id).select('*,clients(id,first_name,last_name,email,phone)').single();
    if(error)throw error;
    if(data?.clients?.email&&req.body.notify!==false){try{const fn=(data.clients.first_name||'').split(' ')[0]||'there';const tn=(data.staff_name||'').split(' ')[0]||'your therapist';const dt=new Date(data.starts_at);const tzOpt={timeZone:'Australia/Sydney'};const dateStr=dt.toLocaleDateString('en-AU',{...tzOpt,weekday:'long',day:'numeric',month:'long',year:'numeric'});const timeStr=dt.toLocaleTimeString('en-AU',{...tzOpt,hour:'numeric',minute:'2-digit'}).toLowerCase();const svc=(data.service||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());const dur=data.duration_minutes||60;const html=`<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a2332;line-height:1.7"><h1 style="font-size:24px;font-weight:300;color:#1a5c8a;margin:0 0 16px">Your booking has been updated</h1><p>Hi ${fn},</p><p>Your upcoming massage appointment has been updated. Here are the new details:</p><div style="background:#fdf8f3;border:1px solid #e8ddd0;border-radius:12px;padding:20px 24px;margin:20px 0"><p style="margin:0 0 8px"><strong>Date:</strong> ${dateStr}</p><p style="margin:0 0 8px"><strong>Time:</strong> ${timeStr}</p><p style="margin:0 0 8px"><strong>Treatment:</strong> ${svc} (${dur} min)</p><p style="margin:0"><strong>Therapist:</strong> ${tn}</p></div><p>If these new details do not suit you, please reply to this email or call us on 0412 822 226 and we will find a better time.</p><p style="font-size:13px;color:#8b7355;margin-top:32px;border-top:1px solid #e8ddd0;padding-top:16px">Manly Remedial &amp; Thai Massage &middot; Shop 2, 31 Belgrave Street, Manly NSW 2095</p></div>`;await sendEmail({to:data.clients.email,subject:'Your booking has been updated',html});}catch(e){console.error('update email failed',e.message);}}
    return res.json({ok:true,appointment:data});
  }catch(err){return res.status(500).json({error:err.message});}
});


// -- CLIENT SEARCH by phone/name/email --
app.get('/api/clients/search',async(req,res)=>{
  try{
    const{q}=req.query;
    if(!q||q.trim().length<2)return res.json([]);
    const term=q.trim().replace(/\D/g,''); // strip non-digits for phone search
    const termRaw=q.trim();
    // Search by phone (digits only match), name, or email
    let results=[];
    // Phone search (if query looks like a phone number)
    if(term.length>=4){
      const{data:byPhone}=await db().from('clients').select('*').ilike('phone','%'+term+'%').limit(10);
      if(byPhone)results.push(...byPhone);
    }
    // Name/email search
    const{data:byName}=await db().from('clients').select('*').or('first_name.ilike.%'+termRaw+'%,last_name.ilike.%'+termRaw+'%,email.ilike.%'+termRaw+'%').limit(10);
    if(byName){
      for(const c of byName){
        if(!results.find(r=>r.id===c.id))results.push(c);
      }
    }
    // For each client get last appointment + counts
    const enriched=await Promise.all(results.slice(0,10).map(async client=>{
      const{data:apts}=await db().from('appointments').select('service,starts_at,staff_name,status,duration_minutes').eq('client_id',client.id).order('starts_at',{ascending:false}).limit(5);
      const all=apts||[];
      return{
        ...client,
        lastVisit:all[0]?.starts_at||null,
        lastService:all[0]?.service||null,
        lastStaff:all[0]?.staff_name||null,
        totalVisits:client.total_visits||0,
        totalSpent:((client.total_spent_cents||0)/100),
        favoriteService:(()=>{const c={};all.forEach(a=>{if(a.service)c[a.service]=(c[a.service]||0)+1;});const e=Object.entries(c).sort((a,b)=>b[1]-a[1])[0];return e?e[0]:null;})(),
        date_of_birth:client.date_of_birth||null,
        has_private_health:client.has_private_health??null,
        health_fund_provider:client.health_fund_provider||null,
        health_fund_number:client.health_fund_number||null,
        referral_source:client.referral_source||null,
        recentApts:all,
      };
    }));
    return res.json(enriched);
  }catch(err){return res.status(500).json({error:err.message});}
});

// -- QUICK BOOK for existing client --
app.post('/api/bookings/quick',async(req,res)=>{
  try{
    const{clientId,date,time,service,duration,staffName,notes,fund}=req.body;
    if(!clientId)return res.status(400).json({error:'clientId required'});
    const{data:client,error:ce}=await db().from('clients').select('*').eq('id',clientId).single();
    if(ce||!client)return res.status(404).json({error:'Client not found'});
    const dMins=parseInt(duration)||60;
    const tz=sydTz(date);
    const[tp,mer]=(time||'9:00 am').split(' ');
    let[h,m]=tp.split(':').map(Number);
    if(mer==='pm'&&h!==12)h+=12;if(mer==='am'&&h===12)h=0;
    const startsAt=new Date(date+'T'+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':00'+tz);
    const endsAt=new Date(startsAt.getTime()+dMins*60000);
    const svc=(service||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')||'remedial_massage';
    const priceCents=calcPrice(service,dMins);
    const{data:apt,error}=await db().from('appointments').insert({
      client_id:clientId,service:svc,status:'confirmed',
      starts_at:startsAt.toISOString(),ends_at:endsAt.toISOString(),
      duration_minutes:dMins,price_cents:priceCents,
      notes:notes||null,health_fund:fund||null,
      staff_name:staffName||null,is_walkin:false,
    }).select().single();
    if(error)throw error;
    await db().from('clients').update({total_visits:(client.total_visits||0)+1,total_spent_cents:(client.total_spent_cents||0)+priceCents,updated_at:new Date().toISOString()}).eq('id',clientId);
    return res.status(201).json({ok:true,appointment:apt,client});
  }catch(err){return res.status(500).json({error:err.message});}
});

app.post('/api/emails/rebooking-cron',async(req,res)=>{try{if(req.query.secret!==process.env.CRON_SECRET)return res.status(401).json({error:'unauthorized'});const h24=24*60*60*1000;const from=new Date(Date.now()-h24-60*60*1000).toISOString();const to=new Date(Date.now()-h24+60*60*1000).toISOString();const{data:appts,error}=await db().from('appointments').select('id,starts_at,staff_name,duration_minutes,client_id,clients(id,email,first_name)').eq('status','completed').gte('starts_at',from).lte('starts_at',to);if(error)throw error;let sent=0,skipped=0,errors=0;for(const a of appts||[]){const email=a.clients?.email;if(!email){skipped++;continue;}const{data:log}=await db().from('email_log').select('id').eq('appointment_id',a.id).eq('template','rebooking-24h').maybeSingle();if(log){skipped++;continue;}const fn=(a.clients?.first_name||'').split(' ')[0]||'there';const tn=(a.staff_name||'').split(' ')[0]||'your therapist';const sub=`How was your massage, ${fn}?`;const html=`<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a2332;line-height:1.7"><h1 style="font-size:24px;font-weight:300;color:#1a5c8a;margin:0 0 16px">Thank you for visiting us, ${fn}.</h1><p>We hope you enjoyed your session with ${tn} and you are feeling refreshed.</p><p>Regular massage works best when the benefits build over time. If you would like to book your next session, we would love to see you again.</p><p style="margin:28px 0"><a href="https://manly-clinic.vercel.app/#booking" style="background:#1a5c8a;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;display:inline-block">Book your next session</a></p><p style="font-size:13px;color:#8b7355;margin-top:32px;border-top:1px solid #e8ddd0;padding-top:16px">Manly Remedial &amp; Thai Massage &middot; Shop 2, 31 Belgrave Street, Manly NSW 2095 &middot; 0412 822 226</p></div>`;try{await sendEmail({to:email,subject:sub,html});await db().from('email_log').insert({appointment_id:a.id,client_id:a.clients?.id,template:'rebooking-24h',sent_to:email});sent++;}catch(e){console.error('send failed',a.id,e.message);errors++;}}res.json({sent,skipped,errors,total:appts?.length||0});}catch(e){res.status(500).json({error:e.message});}});

app.listen(PORT,()=>console.log('Server running on port '+PORT));
