export function nowMs(){ return Date.now(); }
export function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

export function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

export function formatRoomCode(code){
  return (code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

export function pickRandom(arr){
  if (!arr?.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

export function shuffle(arr){
  const a = [...arr];
  for (let i=a.length-1; i>0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
