import React, { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode.react";
import { PHASE, subscribePlayers, subscribeRoom, subscribeRound, subscribeSubmissions, subscribeVotes,
         startGame, submitDefinition, openVoting, castVote, revealAndScore, nextOrFinish } from "../lib/game";
import { shuffle } from "../lib/util";

function byName(a,b){ return (a.name||"").localeCompare(b.name||""); }

export default function Room({ uid, roomId, onExit }){
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [round, setRound] = useState(null);
  const [subs, setSubs] = useState([]);
  const [votes, setVotes] = useState([]);
  const [myText, setMyText] = useState("");
  const [myVote, setMyVote] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeRoom(roomId, setRoom), [roomId]);
  useEffect(() => subscribePlayers(roomId, setPlayers), [roomId]);

  useEffect(() => {
    if (!room?.currentRoundId) return;
    const unsubRound = subscribeRound(roomId, room.currentRoundId, setRound);
    const unsubSubs = subscribeSubmissions(roomId, room.currentRoundId, setSubs);
    const unsubVotes = subscribeVotes(roomId, room.currentRoundId, setVotes);
    return () => { unsubRound(); unsubSubs(); unsubVotes(); };
  }, [roomId, room?.currentRoundId]);

  const me = useMemo(() => players.find(p => p.uid === uid), [players, uid]);
  const isHost = room?.hostUid === uid;
  const currentPhase = room?.status || PHASE.LOBBY;
  const readerUid = round?.readerUid;
  const isReader = readerUid === uid;

  const joinUrl = useMemo(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("roomId", roomId);
    return url.toString();
  }, [roomId]);

  const options = useMemo(() => {
    if (!round) return [];
    if (round.phase !== PHASE.REVEAL && round.phase !== PHASE.VOTING) return [];
    // Build options locally for voting (until reveal stores options).
    const real = { choiceId: "REAL", text: round.realDefinition, authorUid: null, isReal: true };
    const fake = subs
      .filter(s => (s.text||"").trim().length > 0)
      .map(s => ({ choiceId: s.uid, authorUid: s.uid, text: s.text, isReal: false }));

    if (round.options?.length) {
      return round.options.map(o => ({ ...o, isReal: o.choiceId === round.realChoiceId }));
    }
    return shuffle([real, ...fake]);
  }, [round, subs]);

  useEffect(() => {
    const mine = votes.find(v => v.uid === uid);
    setMyVote(mine?.choiceId ?? null);
  }, [votes, uid]);

  async function doStart(){
    setErr(""); setBusy(true);
    try { await startGame(roomId, uid); }
    catch(e){ setErr(e.message || String(e)); }
    finally { setBusy(false); }
  }

  async function doOpenVoting(){
    setErr(""); setBusy(true);
    try { await openVoting(roomId, room.currentRoundId, uid); }
    catch(e){ setErr(e.message || String(e)); }
    finally { setBusy(false); }
  }

  async function doReveal(){
    setErr(""); setBusy(true);
    try { await revealAndScore(roomId, room.currentRoundId, uid); }
    catch(e){ setErr(e.message || String(e)); }
    finally { setBusy(false); }
  }

  async function doNext(){
    setErr(""); setBusy(true);
    try { await nextOrFinish(roomId, uid); setMyText(""); }
    catch(e){ setErr(e.message || String(e)); }
    finally { setBusy(false); }
  }

  async function doSubmit(){
    setErr("");
    const t = (myText || "").trim();
    if (!t) return setErr("Write a believable definition.");
    setBusy(true);
    try { await submitDefinition(roomId, room.currentRoundId, uid, t); }
    catch(e){ setErr(e.message || String(e)); }
    finally { setBusy(false); }
  }

  async function doVote(choiceId){
    setErr(""); setBusy(true);
    try { await castVote(roomId, room.currentRoundId, uid, choiceId); }
    catch(e){ setErr(e.message || String(e)); }
    finally { setBusy(false); }
  }

  const sortedPlayers = useMemo(() => [...players].sort(byName), [players]);

  if (!room) {
    return (
      <div className="container">
        <div className="card">
          <h1>Loading room…</h1>
        </div>
      </div>
    );
  }

  const code = room.code;
  const target = room.targetScore ?? 50;

  return (
    <div className="container">
      <div className="topbar">
        <div>
          <h1>Room <span className="pill">{code}</span></h1>
          <div className="muted">Target: {target} • Mode: {room.langMode || "both"} • Phase: {currentPhase}</div>
        </div>
        <div className="row">
          <button className="secondary" onClick={onExit}>Exit</button>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Players</h2>
          <ul className="list">
            {sortedPlayers.map(p => (
              <li key={p.uid}>
                <strong>{p.name || "Player"}</strong> — {p.score ?? 0}
                {p.uid === room.hostUid ? " (host)" : ""}
                {p.uid === round?.readerUid ? " (reader)" : ""}
                {p.uid === uid ? " (you)" : ""}
              </li>
            ))}
          </ul>

          {room.status === PHASE.LOBBY && (
            <div style={{ marginTop: 12 }}>
              <div className="muted" style={{ marginBottom: 10 }}>
                Share this code (or QR) so others join. For MVP, everyone must join before starting.
              </div>
              <div className="row">
                <div className="col">
                  <div className="card" style={{ background:"#f9fafb" }}>
                    <div className="muted">Join URL</div>
                    <div style={{ wordBreak:"break-all", marginTop:6 }}>{joinUrl}</div>
                  </div>
                </div>
                <div className="col" style={{ display:"flex", justifyContent:"center", alignItems:"center" }}>
                  <QRCode value={joinUrl} size={160} />
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <button disabled={!isHost || busy || players.length < 2} onClick={doStart}>
                  Start game
                </button>
                {!isHost && <span className="muted" style={{ marginLeft:10 }}>Waiting for host…</span>}
              </div>
            </div>
          )}

          {room.status === PHASE.FINISHED && (
            <div style={{ marginTop: 12 }}>
              <h2>Game finished 🎉</h2>
              <div className="muted">Winner: {sortedPlayers.sort((a,b)=>(b.score??0)-(a.score??0))[0]?.name}</div>
            </div>
          )}
        </div>

        <div className="card">
          <h2>Round</h2>

          {!round && room.status !== PHASE.LOBBY && (
            <div className="muted">Preparing round…</div>
          )}

          {round && (
            <div>
              <div className="muted">Language: {round.lang === "es" ? "Español" : "English"}</div>
              <div style={{ marginTop: 10 }}>
                <div className="muted">Word</div>
                <div style={{ fontSize: 28, fontWeight: 800 }}>{round.word}</div>
              </div>

              {isReader && (
                <div style={{ marginTop: 10 }} className="card">
                  <div className="muted">Real definition (reader only)</div>
                  <div style={{ marginTop: 6 }}>{round.realDefinition}</div>
                </div>
              )}

              {room.status === PHASE.WRITING && (
                <div style={{ marginTop: 12 }}>
                  {isReader ? (
                    <div className="muted">You are the reader. Wait until everyone submits, then advance to voting.</div>
                  ) : (
                    <div>
                      <div className="muted" style={{ marginBottom: 6 }}>Write a believable definition:</div>
                      <textarea value={myText} onChange={e=>setMyText(e.target.value)} placeholder="Invent a definition that sounds real…" />
                      <div style={{ marginTop: 10 }}>
                        <button disabled={busy} onClick={doSubmit}>Submit</button>
                        <span className="muted" style={{ marginLeft:10 }}>
                          Submitted: {subs.length}/{players.length - 1} (reader doesn't submit)
                        </span>
                      </div>
                    </div>
                  )}

                  {isReader && (
                    <div style={{ marginTop: 12 }}>
                      <button className="secondary" disabled={busy} onClick={doOpenVoting}>
                        Open voting
                      </button>
                      <div className="muted" style={{ marginTop: 6 }}>
                        Tip: only open voting after everyone (except reader) submitted.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {room.status === PHASE.VOTING && (
                <div style={{ marginTop: 12 }}>
                  <div className="muted" style={{ marginBottom: 10 }}>
                    {isReader
                      ? "You are the reader. Read the options aloud while others vote."
                      : "Vote for the REAL definition. You can’t vote your own."}
                  </div>

                  {options.map((o, idx) => {
                    const isMine = o.choiceId === uid;
                    const checked = myVote === o.choiceId;
                    return (
                      <div key={o.choiceId} className="option" style={{ opacity: isMine ? .55 : 1, marginBottom: 10 }}>
                        <div>
                          {isReader ? (
                            <div style={{ width: 18 }} />
                          ) : (
                            <input
                              type="radio"
                              name="vote"
                              checked={checked}
                              disabled={isMine || busy}
                              onChange={() => doVote(o.choiceId)}
                            />
                          )}
                        </div>
                        <div>
                          <strong>Option {idx+1}{isMine ? " (yours)" : ""}</strong>
                          <div>{o.text}</div>
                        </div>
                      </div>
                    );
                  })}

                  <div className="muted">Votes: {votes.length}/{Math.max(0, players.length - 1)}</div>

                  {isReader && (
                    <div style={{ marginTop: 12 }}>
                      <button className="secondary" disabled={busy} onClick={doReveal}>
                        Reveal + Score
                      </button>
                    </div>
                  )}
                </div>
              )}

              {room.status === PHASE.REVEAL && (
                <div style={{ marginTop: 12 }}>
                  <div className="card" style={{ background:"#f9fafb" }}>
                    <div className="muted">Correct definition</div>
                    <div style={{ marginTop: 6, fontWeight: 700 }}>
                      {round.realDefinition}
                    </div>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <div className="muted" style={{ marginBottom: 6 }}>How people voted</div>
                    <ul className="list">
                      {votes.map(v => {
                        const voter = players.find(p => p.uid === v.uid)?.name || "Player";
                        const picked = (v.choiceId === "REAL")
                          ? "REAL"
                          : (players.find(p => p.uid === v.choiceId)?.name ? `Fake by ${players.find(p => p.uid === v.choiceId)?.name}` : "Fake");
                        const ok = v.choiceId === "REAL";
                        return <li key={v.uid}>{voter}: <strong>{picked}</strong> {ok ? "✅" : "❌"}</li>;
                      })}
                    </ul>
                  </div>

                  {isReader && (
                    <div style={{ marginTop: 12 }}>
                      <button disabled={busy} onClick={doNext}>
                        Next round
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {err && <div style={{ marginTop: 12, color:"#b91c1c" }}><strong>Error:</strong> {err}</div>}
        </div>
      </div>

      <div style={{ marginTop: 14 }} className="muted">
        Scoring: +2 if you guess real, +1 for each vote your fake gets, reader gets +1 per non‑real vote.
      </div>
    </div>
  );
}
