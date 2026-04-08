import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app  = express();
const PORT = process.env.PORT || 4000;

const allowedOrigins = [process.env.FRONTEND_URL,'http://localhost:3000'].filter(Boolean);
app.use(cors({
  origin:(origin,cb)=>{ if(!origin||allowedOrigins.includes(origin))return cb(null,true); cb(new Error('CORS')); },
  credentials:true,
}));
app.use(express.json());

function db(){return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);}

const ALL_SLOTS=['9:00 am','9:30 am','10:00 am','10:30 am','11:00 am','11:30 am',
  '12:00 pm','12:30 pm','1:00 pm','1:30 pm','2:00 pm','2:30 pm',
  '3:00 pm','3:30 pm','4:00 pm','4:30 pm','5:00 pm','5:30 pm',
  '6:00 pm','6:30 pm','7:00 pm','7:30 pm','8:00 pm'];

function parseTimeSlot(date,time){
  const[timePart,meridiem]=time.split(' ');
  let[hours,minutes]=timePart.split(':').map(Number);
  if(meridiem==='pm'&&hours!==12)hours+=12;
  if(meridiem==='am'&&hours===12)hours=0;
  // Use date string directly to avoid timezone issues
  return new Date(`${date}T${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:00+10:00`);
}

function slotFromISO(iso){
  const d=new Date(iso);
  const h=d.getHours();const m=d.getMinutes();
  const mer=h>=12?'pm':'am';const h12=h>12?h-12:h===0?12:h;
  return `${h12}:${String(m).padStart(2,'0')} ${mer}`;
}

app.get('/health',(_,res)=>res.json({status:'ok',clinic:'Manly Remedial & Thai Massage',ts:new Date().toISOString()}));

// POST /api/bookings/request
app.post('/api/bookings/request',async(req,res)=>{
  try{
    const{firstName,lastName,email,phone,date,time,service,duration,concern,fund,memberNo}=req.body;
    if(!firstName||!lastName||!email)return res.status(400).json({error:'Name and email required.'});

    const{data:client,error:clientErr}=await db().from('clients')
      .upsert({first_name:firstName.trim(),last_name:lastName.trim(),
        email:email.trim().toLowerCase(),phone:phone||null,updated_at:new Date().toISOString()},
        {onConflict:'email'}).select().single();
    if(clientErr)throw clientErr;

    let startsAt,endsAt;
    const durationMins=parseInt(duration)||60;
    if(date&&time){
      // Parse time like "9:00 am" or "2:30 pm"
      const[timePart,meridiem]=(time||'9:00 am').split(' ');
      let[hours,minutes]=timePart.split(':').map(Number);
      if(meridiem==='pm'&&hours!==12)hours+=12;
      if(meridiem==='am'&&hours===12)hours=0;
      // Sydney timezone: AEST (UTC+10) Apr-Oct, AEDT (UTC+11) Oct-Apr
      const mo=parseInt(date.split('-')[1]);
      const tzOffset=(mo>=4&&mo<=9)?'+10:00':'+11:00';
      const dtStr=`${date}T${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:00${tzOffset}`;
      startsAt=new Date(dtStr);
      console.log('Booking datetime:',dtStr,'->',startsAt.toISOString());
      endsAt=new Date(startsAt.getTime()+durationMins*60000);
    }else{
      startsAt=new Date(Date.now()+48*3600000);
      endsAt=new Date(startsAt.getTime()+durationMins*60000);
    }

    const notes=[
      service?`Service: ${service}`:'',
      duration?`Duration: ${duration}`:'',
      concern?`Notes: ${concern}`:'',
      fund?`Fund: ${fund}`:'',
      memberNo?`Member: ${memberNo}`:'',
    ].filter(Boolean).join(' | ');

    // Map service name to slug for database
    const svcSlug=(service||'remedial_massage')
      .toLowerCase().trim()
      .replace(/[^a-z0-9]+/g,'_')
      .replace(/^_|_$/g,'');

    await db().from('appointments').insert({
      client_id:client.id,
      service:svcSlug,
      status:'confirmed',
      starts_at:startsAt.toISOString(),
      ends_at:endsAt.toISOString(),
      duration_minutes:durationMins,
      price_cents:9500,
    });

    return res.status(201).json({ok:true,clientId:client.id,
      appointment:{date,time,service,duration,clientName:`${firstName} ${lastName}`},
      message:'Booking request received.'});
  }catch(err){
    console.error(err.message);
    return res.status(500).json({error:'Booking failed. Please call 0412 822 226.'});
  }
});

// GET /api/bookings/availability
app.get('/api/bookings/availability',async(req,res)=>{
  const{date}=req.query;
  if(!date)return res.status(400).json({error:'date required'});
  try{
    const{data}=await db().from('appointments').select('starts_at')
      .gte('starts_at',`${date}T00:00:00+10:00`).lte('starts_at',`${date}T23:59:59+11:00`)
      .not('status','in','("cancelled","no_show")');
    const booked=(data||[]).map(b=>slotFromISO(b.starts_at));
    const available=ALL_SLOTS.filter(s=>!booked.includes(s));
    return res.json({date,available,booked});
  }catch(err){
    return res.json({date,available:ALL_SLOTS,booked:[]});
  }
});

// GET /api/appointments/today
app.get('/api/appointments/today',async(req,res)=>{
  try{
    // Get today's date in Sydney timezone
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'Australia/Sydney'});
    // Query UTC range that covers full Sydney day (AEST = UTC+10)
    const dayStart=new Date(today+'T00:00:00+10:00').toISOString();
    const dayEnd=new Date(today+'T23:59:59+10:00').toISOString();
    const{data,error}=await db().from('appointments')
      .select('id,service,status,starts_at,ends_at,duration_minutes,price_cents,hicaps_processed,client_id')
      .gte('starts_at',dayStart).lte('starts_at',dayEnd)
      .order('starts_at');
    if(error)throw error;
    // Fetch client details separately
    const apts=data||[];
    const clientIds=[...new Set(apts.map(a=>a.client_id).filter(Boolean))];
    let clientMap={};
    if(clientIds.length>0){
      const{data:clients}=await db().from('clients').select('id,first_name,last_name,email,phone').in('id',clientIds);
      (clients||[]).forEach(c=>{clientMap[c.id]=c;});
    }
    const result=apts.map(a=>({...a,clients:clientMap[a.client_id]||null}));
    res.json(result);
  }catch(err){console.error('today error:',err.message);res.status(500).json({error:err.message});}
});

// GET /api/appointments/date
app.get('/api/appointments/date',async(req,res)=>{
  try{
    const date=req.query.date||new Date().toLocaleDateString('en-CA',{timeZone:'Australia/Sydney'});
    // Query UTC range that covers full Sydney day (AEST = UTC+10)
    const dayStart=new Date(date+'T00:00:00+10:00').toISOString();
    const dayEnd=new Date(date+'T23:59:59+10:00').toISOString();
    const{data,error}=await db().from('appointments')
      .select('id,service,status,starts_at,ends_at,duration_minutes,price_cents,hicaps_processed,client_id')
      .gte('starts_at',dayStart).lte('starts_at',dayEnd)
      .order('starts_at');
    if(error)throw error;
    const apts=data||[];
    const clientIds=[...new Set(apts.map(a=>a.client_id).filter(Boolean))];
    let clientMap={};
    if(clientIds.length>0){
      const{data:clients}=await db().from('clients').select('id,first_name,last_name,email,phone').in('id',clientIds);
      (clients||[]).forEach(c=>{clientMap[c.id]=c;});
    }
    const result=apts.map(a=>({...a,clients:clientMap[a.client_id]||null}));
    res.json(result);
  }catch(err){console.error('date error:',err.message);res.status(500).json({error:err.message});}
});

// PATCH /api/appointments/:id/status
app.patch('/api/appointments/:id/status',async(req,res)=>{
  try{
    const{status,hicaps_processed}=req.body;
    const updates={updated_at:new Date().toISOString()};
    if(status)updates.status=status;
    if(typeof hicaps_processed==='boolean')updates.hicaps_processed=hicaps_processed;
    const{data,error}=await db().from('appointments').update(updates).eq('id',req.params.id).select().single();
    if(error)throw error;
    res.json(data);
  }catch(err){res.status(500).json({error:err.message});}
});

// POST /api/appointments/:id/soap
app.post('/api/appointments/:id/soap',async(req,res)=>{
  try{
    const{subjective,objective,assessment,plan,authored_by}=req.body;
    const{data,error}=await db().from('soap_notes')
      .upsert({appointment_id:req.params.id,subjective:subjective||null,
        objective:objective||null,assessment:assessment||null,plan:plan||null,
        authored_by:authored_by||'Staff',updated_at:new Date().toISOString()},
        {onConflict:'appointment_id'}).select().single();
    if(error)throw error;
    res.json(data);
  }catch(err){res.status(500).json({error:err.message});}
});

// GET /api/appointments/:id/soap
app.get('/api/appointments/:id/soap',async(req,res)=>{
  try{
    const{data,error}=await db().from('soap_notes').select('*').eq('appointment_id',req.params.id).single();
    if(error&&error.code!=='PGRST116')throw error;
    res.json(data||{});
  }catch(err){res.status(500).json({error:err.message});}
});

app.use((_,res)=>res.status(404).json({error:'Not found'}));
app.use((err,_,res,__)=>res.status(500).json({error:err.message}));
app.listen(PORT,()=>console.log(`Manly Remedial & Thai Massage API on port ${PORT}`));
