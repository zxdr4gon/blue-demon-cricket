const CACHE="bd-player-cards-v1";
const SHELL=["./","./index.html","./styles.css","./app.js","./manifest.webmanifest","../icons/logo-160.png","../icons/icon-192.png"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));self.skipWaiting();});
self.addEventListener("activate",event=>{event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(key=>key.startsWith("bd-player-cards-")&&key!==CACHE).map(key=>caches.delete(key)));await self.clients.claim();})());});
self.addEventListener("fetch",event=>{
  const request=event.request;if(request.method!=="GET")return;
  const url=new URL(request.url);
  if(url.hostname.endsWith("google.com")||url.hostname.endsWith("googleusercontent.com"))return;
  if(url.origin!==location.origin)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE),cached=await cache.match(request,{ignoreSearch:true});
    try{const response=await fetch(request);if(response.ok)cache.put(request,response.clone());return response;}
    catch(error){return cached|| (request.mode==="navigate"?cache.match("./index.html"):Response.error());}
  })());
});