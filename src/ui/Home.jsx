import React, { useState } from "react";
import { createRoom, joinRoomByCode } from "../lib/game";
import { formatRoomCode } from "../lib/util";

export default function Home({ uid, onEnterRoom }){
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [target, setTarget] = useState(50);
  const [langMode, setLangMode] = useState("both");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function onCreate(){
    setErr("");
    if (!name.trim()) return setErr("Enter your name.");
    setBusy(true);
    try {
      const { roomId, code } = await createRoom({ hostUid: uid, hostName: name.trim(), targetScore: Number(target)||50, langMode });
      onEnterRoom(roomId);
    } catch (e){
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onJoin(){
    setErr("");
    if (!name.trim()) return setErr("Enter your name.");
    const clean = formatRoomCode(code);
    if (clean.length < 4) return setErr("Enter the room code.");
    setBusy(true);
    try {
      const { roomId } = await joinRoomByCode({ code: clean, uid, name: name.trim() });
      onEnterRoom(roomId);
    } catch (e){
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="card">
        <div className="topbar">
          <div>
            <h1>El Diccionario <span className="pill">web MVP</span></h1>
            <div className="muted">Everyone joins from their phone. Wi‑Fi required.</div>
          </div>
        </div>

        <div className="grid2">
          <div className="card" style={{ background:"#f9fafb" }}>
            <h2>Create a room (host)</h2>
            <div className="row">
              <div className="col">
                <div className="muted" style={{ marginBottom:6 }}>Your name</div>
                <input value={name} onChange={e=>setName(e.target.value)} placeholder="Marcelo" />
              </div>
              <div className="col">
                <div className="muted" style={{ marginBottom:6 }}>Target score</div>
                <input value={target} onChange={e=>setTarget(e.target.value)} placeholder="50" />
              </div>
              <div className="col">
                <div className="muted" style={{ marginBottom:6 }}>Language mode</div>
                <select value={langMode} onChange={e=>setLangMode(e.target.value)}>
                  <option value="both">Both (ES/EN alternating)</option>
                  <option value="es">Spanish only</option>
                  <option value="en">English only</option>
                </select>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <button disabled={busy} onClick={onCreate}>Create room</button>
            </div>
          </div>

          <div className="card" style={{ background:"#f9fafb" }}>
            <h2>Join a room</h2>
            <div className="row">
              <div className="col">
                <div className="muted" style={{ marginBottom:6 }}>Your name</div>
                <input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" />
              </div>
              <div className="col">
                <div className="muted" style={{ marginBottom:6 }}>Room code</div>
                <input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="AB12CD" />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="secondary" disabled={busy} onClick={onJoin}>Join</button>
            </div>
          </div>
        </div>

        {err && <div style={{ marginTop: 12, color:"#b91c1c" }}><strong>Error:</strong> {err}</div>}

        <div style={{ marginTop: 14 }} className="muted">
          MVP notes: join only during lobby; host advances phases; anonymous login.
        </div>
      </div>
    </div>
  );
}
