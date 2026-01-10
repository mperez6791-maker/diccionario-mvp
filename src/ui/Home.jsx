import React, { useMemo, useState } from "react";
import { createRoom, joinRoomByCode } from "../lib/game";
import { formatRoomCode } from "../lib/util";

export default function Home({ uid, onEnterRoom }) {
  const [mode, setMode] = useState("menu"); // menu | create | join
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [target, setTarget] = useState(15);
  const [langMode, setLangMode] = useState("en");
  const [gameMode, setGameMode] = useState("classic");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const cleanCode = useMemo(() => formatRoomCode(code), [code]);

  async function onCreate() {
    setErr("");
    if (!name.trim()) return setErr("Enter your name.");
    setBusy(true);
    try {
      const { roomId } = await createRoom({
        hostUid: uid,
        hostName: name.trim(),
        targetScore: Number(target) || 15,
        langMode,
        gameMode,
      });
      onEnterRoom(roomId);
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onJoin() {
    setErr("");
    if (!name.trim()) return setErr("Enter your name.");
    if (cleanCode.length < 4) return setErr("Enter the room code.");
    setBusy(true);
    try {
      const { roomId } = await joinRoomByCode({ code: cleanCode, uid, name: name.trim() });
      onEnterRoom(roomId);
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="screen">
        <div style={{ background: "rgba(15,23,42,0.62)", padding: 14, borderRadius: 22, border: "1px solid rgba(255,255,255,0.18)", color: "white" }}>
          <h1 className="brandTitle">The Dictionary</h1>
          <div className="brandSubtitle">A bluffing party game — everyone joins from their phone.</div>
        </div>

        {mode === "menu" && (
          <>
            <div className="homeButtons">
              <button className="bigBtn primary" onClick={() => setMode("create")}>
                <div>
                  <div style={{ fontSize: 18 }}>Create Game</div>
                  <div className="btnHint">You’ll be the host</div>
                </div>
                <div aria-hidden style={{ fontSize: 20 }}>🎮</div>
              </button>

              <button className="bigBtn secondary" onClick={() => setMode("join")}>
                <div>
                  <div style={{ fontSize: 18 }}>Join Game</div>
                  <div className="btnHint">Enter a room code</div>
                </div>
                <div aria-hidden style={{ fontSize: 20 }}>📲</div>
              </button>
            </div>

            <div style={{ marginTop: 14, color: "rgba(255,255,255,0.78)", fontSize: 13 }}>
              Tip: Same Wi‑Fi helps when you’re playing in the same room.
            </div>
          </>
        )}

        {mode !== "menu" && (
          <div style={{ marginTop: 16 }} className="panel">
            <div className="topRow">
              <div>
                <h2 style={{ margin: 0 }}>{mode === "create" ? "Create a room" : "Join a room"}</h2>
                <div className="muted" style={{ marginTop: 4 }}>
                  {mode === "create" ? "Set up a room and share the code." : "Enter the code from your host."}
                </div>
              </div>
              <button className="secondary" onClick={() => setMode("menu")}>
                Back
              </button>
            </div>

            <div style={{ marginTop: 12 }} className="row">
              <div className="col">
                <div className="muted" style={{ marginBottom: 6 }}>Your name</div>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Marcelo" />
              </div>

              {mode === "join" && (
                <div className="col">
                  <div className="muted" style={{ marginBottom: 6 }}>Room code</div>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="AB12CD"
                  />
                  <div className="muted" style={{ marginTop: 6 }}>We’ll format it automatically.</div>
                </div>
              )}

              {mode === "create" && (
                <>
                  <div className="col">
                    <div className="muted" style={{ marginBottom: 6 }}>Game mode</div>
                    <select value={gameMode} onChange={(e) => setGameMode(e.target.value)}>
                      <option value="classic">Classic (with Reader)</option>
                      <option value="no_reader">No Reader (recommended for small groups)</option>
                    </select>
                  </div>
                  <div className="col">
                    <div className="muted" style={{ marginBottom: 6 }}>Target score</div>
                    <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="15" />
                  </div>
                  <div className="col">
                    <div className="muted" style={{ marginBottom: 6 }}>Language mode</div>
                    <select value={langMode} onChange={(e) => setLangMode(e.target.value)}>
                      <option value="en">English only</option>
                      <option value="es">Spanish only</option>
                      <option value="both">Both (ES/EN alternating)</option>
                    </select>
                  </div>
                </>
              )}
            </div>

            <div style={{ marginTop: 12 }}>
              {mode === "create" ? (
                <button disabled={busy} onClick={onCreate}>Create room</button>
              ) : (
                <button disabled={busy} onClick={onJoin}>Join</button>
              )}
            </div>

            {err && (
              <div style={{ marginTop: 10, color: "#b91c1c" }}>
                <strong>Error:</strong> {err}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
