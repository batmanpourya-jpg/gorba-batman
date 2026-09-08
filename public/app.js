const $=s=>document.querySelector(s);
let me=null; try{me=JSON.parse(localStorage.getItem("gb_me")||"null")}catch{localStorage.removeItem("gb_me")}
async function api(url,opt={}){
 const r=await fetch(url,{...opt,headers:{"content-type":"application/json",...(opt.headers||{})}});
 const d=await r.json().catch(()=>({ok:false,error:"پاسخ نامعتبر"}));
 if(!r.ok||d.ok===false) throw new Error(d.error||"خطا");
 return d;
}
function enter(){
 if(!me)return;
 $("#auth").classList.add("hidden");$("#app").classList.remove("hidden");
 $("#hello").textContent=me.name;$("#avatar").textContent=me.name.slice(0,1);
}
async function login(){
 const name=$("#name").value.trim();
 if(!name){$("#err").textContent="نام را وارد کن";return}
 $("#err").textContent="در حال ورود…";
 try{
  const d=await api("/api/login",{method:"POST",body:JSON.stringify({name})});
  if(!d.user||!d.user.id) throw new Error("حساب از سرور دریافت نشد");
  me=d.user;localStorage.setItem("gb_me",JSON.stringify(me));enter();
 }catch(e){$("#err").textContent=e.message||"ورود انجام نشد"}
}
$("#login").onclick=login;
$("#name").onkeydown=e=>{if(e.key==="Enter")login()};
$("#logout").onclick=()=>{localStorage.removeItem("gb_me");location.reload()};
if(me)enter();
