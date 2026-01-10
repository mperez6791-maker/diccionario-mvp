import React, { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode.react";
import {
  PHASE,
  subscribePlayers,
  subscribeRoom,
  subscribeRound,
  subscribeSubmissions,
  subscribeVotes,
  startGame,
  submitDefinition,
  openVoting,
  openReaderReview,
  castVote,
  revealAndScore,
  nextOrFinish,
  finishGame,
  chooseWordForRound,
} from "../lib/game";
import { shuffle } from "../lib/util";

function byName(a,b){ return (a.name||"").localeCompare(b.name||""); }

const AVATARS = [
  "😀","😎","🤓","🥸","😺","👻","🦊","🐼","🐯","🐸","🐵","🐙",
  "🦄","🐝","🐲","🐧","🦁","🐰","🐨","🦉","🐢","🦋","🐬","🐺",
];

function hashUid(uid){
  const s = uid || "";
  let h = 0;
  for (let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function avatarForUid(uid){
  return AVATARS[hashUid(uid) % AVATARS.length];
}

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
  const [confirmOpen, setConfirmOpen] = useState(null); // { missing, proceed }
  const [showWinner, setShowWinner] = useState(false);

  useEffect(() => subscribeRoom(roomId, setRoom), [roomId]);
  useEffect(() => subscribePlayers(roomId, setPlayers), [roomId]);

  useEffect(() => {
    if (!room?.currentRoundId) return;
    const unsubRound = subscribeRound(roomId, room.currentRoundId, setRound);
    const unsubSubs = subscribeSubmissions(roomId, room.currentRoundId, setSubs);
    const unsubVotes = subscribeVotes(roomId, room.currentRoundId, setVotes);
    return () => { unsubRound(); unsubSubs(); unsubVotes(); };
  }, [roomId, room?.currentRoundId]);

  // Reset per-round local UI state.
  useEffect(() => {
    setMyText("");
    setMyVote(null);
    setConfirmOpen(null);
    setErr("");
  }, [room?.currentRoundId]);

  // Winner celebration overlay (shows immediately after Reveal + Score).
  useEffect(() => {
    if (room?.gameOver && room?.winnerUid) setShowWinner(true);
  }, [room?.gameOver, room?.winnerUid]);

  const me = useMemo(() => players.find(p => p.uid === uid), [players, uid]);
  const isHost = room?.hostUid === uid;
  const mode = room?.gameMode || "classic"; // classic | no_reader
  const isNoReader = mode === "no_reader";
  const currentPhase = room?.status || PHASE.LOBBY;
  const readerUid = round?.readerUid;
  const isReader = readerUid === uid;
  const isController = isNoReader ? isHost : isReader;

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
      .filter(s => isNoReader || s.uid !== readerUid)
      .map(s => ({ choiceId: s.uid, authorUid: s.uid, text: s.text, isReal: false }));

    if (round.options?.length) {
      return round.options.map(o => ({ ...o, isReal: o.choiceId === round.realChoiceId }));
    }
    return shuffle([real, ...fake]);
  }, [round, subs, isNoReader, readerUid]);

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
    const expected = isNoReader ? players.length : Math.max(0, players.length - 1);
    const submitted = subs.filter(s => (s.text || "").trim().length > 0).length;
    const missing = Math.max(0, expected - submitted);
    if (missing > 0){
      setConfirmOpen({ missing });
      return;
    }
    await doOpenVotingConfirmed();
  }

  async function doOpenVotingConfirmed(){
    setErr(""); setBusy(true);
    try { await openVoting(roomId, room.currentRoundId, uid); }
    catch(e){ setErr(e.message || String(e)); }
    finally { setBusy(false); }
  }

  async function doReview(){
    setErr(""); setBusy(true);
    try { await openReaderReview(roomId, room.currentRoundId, uid); }
    catch(e){ setErr(e.message || String(e)); }
    finally { setBusy(false); }
  }

  async function doChooseWord(wordId){
    setErr(""); setBusy(true);
    try { await chooseWordForRound(roomId, room.currentRoundId, uid, wordId); }
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
    try { await submitDefinition(roomId, room.currentRoundId, uid, t); setMyText(""); }
    catch(e){ setErr(e.message || String(e)); }
    finally { setBusy(false); }
  }

  async function doFinishGame(){
    setErr(""); setBusy(true);
    try { await finishGame(roomId, uid); }
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

  const phaseLabel = useMemo(() => {
    switch (room?.status) {
      case PHASE.LOBBY: return "Lobby";
      case PHASE.WORD_SELECT: return "Choose word";
      case PHASE.REVIEW: return "Reader review";
      case PHASE.WRITING: return "Write";
      case PHASE.VOTING: return "Vote";
      case PHASE.REVEAL: return "Results";
      case PHASE.FINISHED: return "Finished";
      default: return String(room?.status || "");
    }
  }, [room?.status]);

  const bgKey = useMemo(() => {
    const base = `${roomId}:${room?.currentRoundId || ""}:${room?.status || ""}`;
    let h = 0;
    for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) >>> 0;
    return h % 6; // pick a background variant
  }, [roomId, room?.currentRoundId, room?.status]);

  const bestBluff = useMemo(() => {
    if (!round || room?.status !== PHASE.REVEAL) return null;
    // Count votes per choiceId
    const counts = new Map();
    for (const v of votes) counts.set(v.choiceId, (counts.get(v.choiceId) || 0) + 1);
    // Find the most-voted fake
    let best = null;
    for (const o of options) {
      if (o.choiceId === "REAL") continue;
      const c = counts.get(o.choiceId) || 0;
      if (!best || c > best.votes) {
        best = { choiceId: o.choiceId, text: o.text, votes: c, authorUid: o.authorUid };
      }
    }
    if (!best) return null;
    const author = players.find(p => p.uid === best.authorUid)?.name || "Someone";
    return { ...best, author };
  }, [room?.status, round, votes, options, players]);

  if (!room) {
    return (
      <div className="container">
      <div className="shell">
          <h1>Loading room…</h1>
        </div>
      </div>
    );
  }

  const code = room.code;
  const target = room.targetScore ?? 50;

  return (
    <div className="container">
      <div className={`screen bgv${bgKey}`}>
        {confirmOpen && (
          <div className="overlay">
            <div className="modal">
              <h3 style={{ marginTop: 0 }}>Still waiting…</h3>
              <div className="muted" style={{ marginTop: 6 }}>
                Waiting for <strong>{confirmOpen.missing}</strong> player{confirmOpen.missing === 1 ? "" : "s"} to submit a definition.
              </div>
              <div style={{ marginTop: 12 }}>Open voting anyway?</div>
              <div className="modalActions">
                <button className="secondary" disabled={busy} onClick={() => setConfirmOpen(null)}>Cancel</button>
                <button disabled={busy} onClick={doOpenVotingConfirmed}>Open voting anyway</button>
              </div>
            </div>
          </div>
        )}

        {showWinner && room.gameOver && room.winnerUid && (
          <div className="overlay">
            <div className="modal" style={{ textAlign: "center" }}>
              <div aria-hidden style={{ fontSize: 44, lineHeight: 1 }}>🎉</div>
              <h2 style={{ margin: "10px 0 6px" }}>Winner!</h2>
              <div style={{ fontSize: 22, fontWeight: 900 }}>
                {players.find(p => p.uid === room.winnerUid)?.name || "Player"}
              </div>
              <div className="muted" style={{ marginTop: 6 }}>
                Reached the target score ({target}).
              </div>
              <div className="modalActions" style={{ justifyContent: "center" }}>
                <button className="secondary" onClick={() => setShowWinner(false)}>View results</button>
                {(isController || isHost) && (
                  <button className="secondary" onClick={doFinishGame}>Finish game</button>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="topRow" style={{ marginBottom: 12 }}>
          <div>
            <div style={{ color: "white", fontWeight: 900, fontSize: 16 }}>
              Room <span className="pill" style={{ marginLeft: 8 }}>{code}</span>
            </div>
            <div style={{ marginTop: 6 }}>
              <span className="phaseBadge">{phaseLabel}</span>
              <span className="pill ok" style={{ marginLeft: 8 }}>Target {target}</span>
            </div>
          </div>
          <button className="secondary" onClick={onExit}>Exit</button>
        </div>

        {/* Avatar strip */}
        <div className="panel" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {sortedPlayers.map(p => {
              const isPHost = p.uid === room.hostUid;
              const isPReader = p.uid === round?.readerUid;
              const isMe = p.uid === uid;
              return (
                <div key={p.uid} className="avatarChip">
                  <div className="avatarCircle" aria-hidden>{avatarForUid(p.uid)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900, lineHeight: 1.1 }}>
                      {p.name || "Player"}{isMe ? " (you)" : ""}
                    </div>
                    <div className="muted" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {isPHost && <span className="badge">host</span>}
                      {isPReader && <span className="badge">reader</span>}
                      <span className="badge">{p.score ?? 0} pts</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Main content */}
        {room.status === PHASE.LOBBY && (
          <div className="panel">
            <div className="topRow">
              <h2 style={{ margin: 0 }}>Lobby</h2>
              <span className="pill">Players {sortedPlayers.length}</span>
            </div>

            <div style={{ marginTop: 10 }} className="muted">
              Share this link (or QR) and start when everyone joined.
            </div>

            <div style={{ marginTop: 12 }} className="row">
              <div className="col">
                <div className="subcard">
                  <div className="muted">Join URL</div>
                  <div style={{ wordBreak: "break-all", marginTop: 6 }}>{joinUrl}</div>
                </div>
              </div>
              <div className="col" style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
                <QRCode value={joinUrl} size={160} />
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <button disabled={!isHost || busy || players.length < 2} onClick={doStart}>
                Start game
              </button>
              {!isHost && <span className="muted" style={{ marginLeft: 10 }}>Waiting for host…</span>}
            </div>
          </div>
        )}

        {room.status === PHASE.FINISHED && (
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>Game finished 🎉</h2>
            <div className="muted">Winner: {players.find(p => p.uid === room.winnerUid)?.name || sortedPlayers[0]?.name || "Player"}</div>
          </div>
        )}

        {room.status !== PHASE.LOBBY && room.status !== PHASE.FINISHED && (
          <div className="panel">
            {!round ? (
              <div className="muted">Preparing round…</div>
            ) : (
              <>
                {/* Word area */}
                {room.status !== PHASE.WORD_SELECT && (
                  <div className="wordCard">
                    <div className="muted">Language: {round.lang === "es" ? "Español" : "English"}</div>
                    <h2 className="wordTitle">{round.word}</h2>
                    {!isNoReader && isReader && (
                      <div className="subcard" style={{ marginTop: 10 }}>
                        <div className="muted">Reader-only: real definition</div>
                        <div style={{ marginTop: 6, fontWeight: 700 }}>{round.realDefinition}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Phase content */}
                {room.status === PHASE.WORD_SELECT && (
                  <div style={{ marginTop: 10 }}>
                    {isReader ? (
                      <>
                        <h2 style={{ marginTop: 0 }}>Pick the word</h2>
                        <div className="muted" style={{ marginBottom: 10 }}>
                          Read the word aloud (not the definition).
                        </div>
                        <div className="homeButtons">
                          {(round.wordCandidates || []).map(c => (
                            <button key={c.id} className="bigBtn secondary" disabled={busy} onClick={() => doChooseWord(c.id)}>
                              <div>
                                <div style={{ fontSize: 20, fontWeight: 900 }}>{c.word}</div>
                                <div className="btnHint">Tap to select</div>
                              </div>
                              <div aria-hidden style={{ fontSize: 20 }}>✅</div>
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="muted">Reader is choosing a word…</div>
                    )}
                  </div>
                )}

                {room.status === PHASE.WRITING && (
                  <div style={{ marginTop: 12 }}>
                    {isNoReader ? (
                      <>
                        <div className="muted" style={{ marginBottom: 6 }}>Write a believable definition:</div>
                        <textarea value={myText} onChange={(e) => setMyText(e.target.value)} placeholder="Invent a definition that sounds real…" />
                        <div style={{ marginTop: 10 }}>
                          <button disabled={busy} onClick={doSubmit}>Submit</button>
                          <span className="muted" style={{ marginLeft: 10 }}>
                            Submitted: {subs.filter(s => (s.text||"").trim().length>0).length}/{players.length}
                          </span>
                        </div>
                      </>
                    ) : isReader ? (
                      <>
                        <div className="muted">You are the reader. Review the submissions, then open voting.</div>
                        <div style={{ marginTop: 12 }}>
                          <button className="secondary" disabled={busy} onClick={doReview}>Review definitions</button>
                          <div className="muted" style={{ marginTop: 6 }}>
                            Submitted: {subs.filter(s => (s.text||"").trim().length>0).length}/{Math.max(0, players.length - 1)}
                          </div>
                          <div className="muted" style={{ marginTop: 6 }}>
                            Tip: you can review even if someone is still typing.
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="muted" style={{ marginBottom: 6 }}>Write a believable definition:</div>
                        <textarea value={myText} onChange={(e) => setMyText(e.target.value)} placeholder="Invent a definition that sounds real…" />
                        <div style={{ marginTop: 10 }}>
                          <button disabled={busy} onClick={doSubmit}>Submit</button>
                          <span className="muted" style={{ marginLeft: 10 }}>
                            Submitted: {subs.filter(s => (s.text||"").trim().length>0).length}/{Math.max(0, players.length - 1)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {room.status === PHASE.REVIEW && (
                  <div style={{ marginTop: 12 }}>
                    {isReader ? (
                      <>
                        <h2 style={{ marginTop: 0 }}>Reader review</h2>
                        <div className="muted" style={{ marginBottom: 10 }}>
                          These definitions are private to you. Read them aloud, then open voting for everyone.
                        </div>
                        <div>
                          {subs
                            .filter(s => (s.text||"").trim().length>0)
                            .map(s => {
                              const p = players.find(pp => pp.uid === s.uid);
                              return (
                                <div key={s.uid} className="subcard" style={{ marginBottom: 10 }}>
                                  <div className="muted">{p?.name || "Player"}</div>
                                  <div style={{ marginTop: 6, fontWeight: 900 }}>{s.text}</div>
                                </div>
                              );
                            })}
                        </div>
                        <div style={{ marginTop: 12 }}>
                          <button className="secondary" disabled={busy} onClick={doOpenVoting}>Open voting</button>
                          <div className="muted" style={{ marginTop: 6 }}>
                            Submitted: {subs.filter(s => (s.text||"").trim().length>0).length}/{Math.max(0, players.length - 1)}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="muted">Reader is reviewing definitions… get ready to vote.</div>
                    )}
                  </div>
                )}

                {room.status === PHASE.VOTING && (
                  <div style={{ marginTop: 12 }}>
                    <div className="muted" style={{ marginBottom: 10 }}>
                      {!isNoReader && isReader ? "Reader: read options aloud." : "Vote for the REAL definition (not your own)."}
                    </div>

                    {options.map((o, idx) => {
                      const isMine = o.choiceId === uid;
                      const checked = myVote === o.choiceId;
                      const label = String.fromCharCode(65 + idx);
                      return (
                        <div key={o.choiceId} className={`option ${checked ? "selected" : ""} ${isMine ? "mine" : ""}`} style={{ marginBottom: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div className="pill" style={{ background: "rgba(37,99,235,0.12)" }}>{label}</div>
                            {!( !isNoReader && isReader ) && (
                              <input
                                type="radio"
                                name="vote"
                                checked={checked}
                                disabled={isMine || busy}
                                onChange={() => doVote(o.choiceId)}
                              />
                            )}
                          </div>
                          <div style={{ marginTop: 8 }}>
                            <div style={{ fontWeight: 900 }}>Option {label}{isMine ? " (yours)" : ""}</div>
                            <div>{o.text}</div>
                          </div>
                        </div>
                      );
                    })}

                    <div className="muted">Votes: {votes.length}/{isNoReader ? players.length : Math.max(0, players.length - 1)}</div>

                    {isController && (
                      <div style={{ marginTop: 12 }}>
                        <button className="secondary" disabled={busy} onClick={doReveal}>Reveal + Score</button>
                      </div>
                    )}
                  </div>
                )}

                {room.status === PHASE.REVEAL && (
                  <div style={{ marginTop: 12 }}>
                    <div className="subcard">
                      <div className="muted">Correct definition</div>
                      <div style={{ marginTop: 6, fontWeight: 900 }}>{round.realDefinition}</div>
                    </div>

                    {bestBluff && (
                      <div className="subcard" style={{ marginTop: 10 }}>
                        <div className="muted">Best bluff</div>
                        <div style={{ marginTop: 6, fontWeight: 900 }}>{bestBluff.author} ({bestBluff.votes} votes)</div>
                        <div style={{ marginTop: 6 }}>{bestBluff.text}</div>
                      </div>
                    )}

                    <div style={{ marginTop: 12 }}>
                      <div className="muted" style={{ marginBottom: 6 }}>Votes</div>
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

                    {(isController || isHost) && (
                      <div style={{ marginTop: 12 }}>
                        {room.gameOver ? (
                          <button className="secondary" disabled={busy} onClick={doFinishGame}>Finish game</button>
                        ) : (
                          <button disabled={busy} onClick={doNext}>Next round</button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {err && <div style={{ marginTop: 12, color: "#b91c1c" }}><strong>Error:</strong> {err}</div>}
          </div>
        )}

        <div style={{ marginTop: 14, color: "rgba(255,255,255,0.75)", fontSize: 13 }}>
          {isNoReader
            ? "Scoring: +2 guess real • +1 per vote your fake gets."
            : "Scoring: +2 guess real • +1 per vote your fake gets • reader +1 per non‑real vote."}
        </div>
      </div>
    </div>
  );
}
